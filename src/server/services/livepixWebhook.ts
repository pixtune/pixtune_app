/**
 * Configuração automática do webhook oficial do LivePix.
 *
 * Documentação oficial: https://docs.livepix.gg/api
 *
 * Regras da aplicação:
 * - a URL pública é sempre derivada de APP_URL (domínio público do Pages),
 *   nunca de um domínio interno do Render;
 * - cada streamer tem um token exclusivo em `/api/donations/webhook/:token`,
 *   então o LivePix consegue associar cada evento à conta correta;
 * - o token OAuth2 em cache é reaproveitado para respeitar o limite de
 *   emissão de tokens documentado pelo LivePix;
 * - a sincronização é idempotente: mantém um único webhook apontando para a
 *   URL atual e remove duplicados/URLs antigas (ex.: onrender.com);
 * - falhas remotas são reportadas, mas não apagam credenciais nem quebram o
 *   pipeline de doações.
 */

import {
  LivePixService,
  getLivePixConfig,
  getLivePixMetadata,
  getOrCreateWebhookToken,
  updateLivePixMetadata,
} from './livepix.js'

/** Caminho público que recebe os eventos do LivePix. */
export const LIVEPIX_WEBHOOK_PATH = '/api/donations/webhook/'

export interface RemoteWebhook {
  id: string
  url: string
}

export interface WebhookReconciliationPlan {
  /** Webhook já apontando para a URL desejada (não recriar). */
  keep: RemoteWebhook | null
  /** Precisa criar um novo webhook. */
  create: boolean
  /** Webhooks desta instalação que devem ser removidos. */
  remove: RemoteWebhook[]
}

export interface LivePixWebhookStatus {
  /** URL atualmente registrada (ou a esperada, quando ainda não registrada). */
  url: string | null
  /** URL que o PixTune espera que o LivePix chame. */
  expectedUrl: string | null
  /** ID do webhook no LivePix, quando conhecido. */
  id: string | null
  registered: boolean
  matchesExpected: boolean
  syncedAt: string | null
  lastError: string | null
  /** Caminho relativo com o token exclusivo do streamer. */
  path: string
}

export interface LivePixWebhookSyncResult extends LivePixWebhookStatus {
  created: boolean
  removed: number
  errors: string[]
}

export interface LivePixWebhookRemoveResult extends LivePixWebhookStatus {
  removed: number
  error: string | null
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/**
 * Normaliza a URL para comparação: ignora barra final, hash e diferenças de
 * caixa no host. Mantém o token (path) intacto.
 */
export function normalizeWebhookUrl(value: string | null | undefined): string {
  const trimmed = (value || '').trim()
  if (!trimmed) return ''

  try {
    const url = new URL(trimmed)
    url.hash = ''
    url.pathname = url.pathname.replace(/\/+$/, '')
    return url.toString().replace(/\/$/, '')
  } catch {
    return trimmed.replace(/\/+$/, '')
  }
}

/** Monta a URL pública do webhook a partir da origem e do token do streamer. */
export function buildWebhookUrl(origin: string, token: string): string {
  const base = origin.trim().replace(/\/+$/, '')
  return `${base}${LIVEPIX_WEBHOOK_PATH}${token}`
}

/**
 * Resolve a origem pública usada pelo LivePix para chamar o webhook.
 * Em produção exige APP_URL (Pages); em desenvolvimento aceita localhost.
 */
export function resolvePublicOrigin(
  env: Record<string, string | undefined> = process.env
): string | null {
  for (const raw of [env.APP_URL, env.PUBLIC_URL]) {
    const trimmed = (raw || '').trim()
    if (!trimmed) continue
    try {
      const url = new URL(trimmed)
      if (url.protocol !== 'http:' && url.protocol !== 'https:') continue
      return url.origin
    } catch {
      // valor inválido: tenta o próximo
    }
  }

  if (env.NODE_ENV !== 'production') {
    const port = (env.PORT || '3000').trim()
    return `http://localhost:${port}`
  }

  return null
}

/** Verifica se a URL pertence ao endpoint público de webhook do PixTune. */
export function isPixTuneWebhook(url: string): boolean {
  try {
    return new URL(url).pathname.startsWith(LIVEPIX_WEBHOOK_PATH)
  } catch {
    return url.includes(LIVEPIX_WEBHOOK_PATH)
  }
}

/**
 * Decide o que fazer com a lista remota de webhooks.
 *
 * Só remove webhooks que claramente pertencem a esta instalação:
 * - mesmo host da URL desejada (URL antiga com token antigo), ou
 * - a URL contém o token atual (host antigo, ex.: onrender.com), ou
 * - é uma duplicata exata da URL desejada.
 */
export function planWebhookReconciliation(
  remote: RemoteWebhook[],
  desiredUrl: string,
  token: string
): WebhookReconciliationPlan {
  const desired = normalizeWebhookUrl(desiredUrl)
  const matches = remote.filter(
    (hook) => normalizeWebhookUrl(hook.url) === desired
  )
  const keep = matches[0] ?? null

  let desiredHost = ''
  try {
    desiredHost = new URL(desired).host
  } catch {
    desiredHost = ''
  }

  const remove: RemoteWebhook[] = []
  for (const hook of remote) {
    if (keep && hook.id === keep.id) continue
    if (!isPixTuneWebhook(hook.url)) continue

    let hookHost = ''
    try {
      hookHost = new URL(hook.url).host
    } catch {
      hookHost = ''
    }

    const belongsToUs =
      (desiredHost !== '' && hookHost === desiredHost) ||
      (token !== '' && hook.url.includes(token))

    if (belongsToUs) remove.push(hook)
  }

  return { keep, create: keep === null, remove }
}

/** Lê o status do webhook sem chamar a API do LivePix (cache no metadata). */
export async function getLivePixWebhookStatus(
  userId: string
): Promise<LivePixWebhookStatus> {
  const meta = await getLivePixMetadata(userId)
  const token = typeof meta.webhookToken === 'string' ? meta.webhookToken : ''
  const origin = resolvePublicOrigin()
  const expectedUrl = token && origin ? buildWebhookUrl(origin, token) : null
  const storedUrl = typeof meta.webhookUrl === 'string' ? meta.webhookUrl : null
  const id = typeof meta.webhookId === 'string' ? meta.webhookId : null
  const url = storedUrl || expectedUrl

  return {
    url,
    expectedUrl,
    id,
    registered: Boolean(id || storedUrl),
    matchesExpected: Boolean(
      url &&
        expectedUrl &&
        normalizeWebhookUrl(url) === normalizeWebhookUrl(expectedUrl)
    ),
    syncedAt:
      typeof meta.webhookSyncedAt === 'string' ? meta.webhookSyncedAt : null,
    lastError:
      typeof meta.webhookLastError === 'string' ? meta.webhookLastError : null,
    path: token ? `${LIVEPIX_WEBHOOK_PATH}${token}` : '',
  }
}

/**
 * Registra (ou repara) o webhook no LivePix.
 *
 * Idempotente: consulta os webhooks existentes, remove os antigos/duplicados
 * desta instalação e só cria quando não existe um apontando para a URL atual.
 */
export async function syncLivePixWebhook(
  userId: string
): Promise<LivePixWebhookSyncResult> {
  const config = await getLivePixConfig(userId)
  if (!config?.clientId || !config.clientSecret) {
    throw new Error(
      'Configure o Client ID e o Client Secret do LivePix antes de ativar o webhook.'
    )
  }

  const origin = resolvePublicOrigin()
  if (!origin) {
    throw new Error(
      'APP_URL não configurado. Defina a URL pública (ex.: https://pixtune-app.pages.dev) para registrar o webhook.'
    )
  }

  const token = await getOrCreateWebhookToken(userId)
  const desiredUrl = buildWebhookUrl(origin, token)
  const service = new LivePixService(config, userId)

  const remote = await service.listWebhooks()
  const plan = planWebhookReconciliation(remote, desiredUrl, token)

  const errors: string[] = []
  let removed = 0

  for (const hook of plan.remove) {
    try {
      await service.deleteWebhook(hook.id)
      removed += 1
    } catch (error) {
      errors.push(`Falha ao remover webhook ${hook.id}: ${errorMessage(error)}`)
    }
  }

  let id = plan.keep?.id ?? null
  let created = false

  if (plan.create) {
    try {
      const createdHook = await service.configureWebhook(desiredUrl)
      id = createdHook.id
      created = true
    } catch (error) {
      const message = errorMessage(error)
      await updateLivePixMetadata(userId, { webhookLastError: message })
      throw error
    }
  }

  await updateLivePixMetadata(userId, {
    webhookUrl: desiredUrl,
    webhookId: id ?? undefined,
    webhookSyncedAt: new Date().toISOString(),
    webhookLastError: errors.length > 0 ? errors.join('; ') : undefined,
  })

  const status = await getLivePixWebhookStatus(userId)
  return { ...status, created, removed, errors }
}

/** Remove do LivePix todos os webhooks desta instalação. */
export async function removeLivePixWebhook(
  userId: string
): Promise<LivePixWebhookRemoveResult> {
  const config = await getLivePixConfig(userId)
  const meta = await getLivePixMetadata(userId)
  const token = typeof meta.webhookToken === 'string' ? meta.webhookToken : ''
  const id = typeof meta.webhookId === 'string' ? meta.webhookId : null

  let removed = 0
  let error: string | null = null

  if (config?.clientId && config.clientSecret) {
    try {
      const service = new LivePixService(config, userId)
      const remote = await service.listWebhooks()
      const ours = remote.filter(
        (hook) =>
          (id !== null && hook.id === id) ||
          (token !== '' && hook.url.includes(token)) ||
          isPixTuneWebhook(hook.url)
      )

      for (const hook of ours) {
        try {
          await service.deleteWebhook(hook.id)
          removed += 1
        } catch (err) {
          error = errorMessage(err)
        }
      }
    } catch (err) {
      error = errorMessage(err)
    }
  }

  await updateLivePixMetadata(userId, {
    webhookId: undefined,
    webhookUrl: undefined,
    webhookSyncedAt: undefined,
    webhookLastError: undefined,
  })

  const status = await getLivePixWebhookStatus(userId)
  return { ...status, removed, error }
}

/** Lista os webhooks remotos e marca qual é o atual do PixTune. */
export async function listLivePixWebhooks(
  userId: string
): Promise<Array<RemoteWebhook & { current: boolean }>> {
  const config = await getLivePixConfig(userId)
  if (!config?.clientId || !config.clientSecret) {
    throw new Error('LivePix não configurado.')
  }

  const service = new LivePixService(config, userId)
  const remote = await service.listWebhooks()
  const status = await getLivePixWebhookStatus(userId)
  const expected = normalizeWebhookUrl(status.expectedUrl)

  return remote.map((hook) => ({
    ...hook,
    current: expected !== '' && normalizeWebhookUrl(hook.url) === expected,
  }))
}
