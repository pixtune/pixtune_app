/**
 * Serviço de integração com o LivePix
 *
 * O LivePix é operado em https://livepix.gg e expõe a API oficial em
 * https://api.livepix.gg/v2. A autenticação usa OAuth2 (client_credentials).
 *
 * Documentação oficial: https://docs.livepix.gg/api
 *
 * Não existe "LivePix CC" nem o domínio livepix.cc. A integração suporta
 * somente o LivePix (livepix.gg).
 */

import crypto from 'crypto'
import prisma from '../lib/prisma.js'

const LIVEPIX_API_BASE = 'https://api.livepix.gg'
const LIVEPIX_OAUTH_URL = 'https://oauth.livepix.gg/oauth2/token'
const LIVEPIX_SCOPES = 'account:read messages:read payments:read webhooks'

function parseMetadata(raw: string | null | undefined): Record<string, any> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

async function readErrorMessage(res: Response): Promise<string> {
  try {
    const json: any = await res.json()
    return json?.message || json?.error_description || json?.error || ''
  } catch {
    return ''
  }
}

function httpError(context: string, res: Response, detail: string): Error {
  return new Error(`${context} falhou (${res.status})${detail ? `: ${detail}` : ''}`)
}

// ============================================================
// Tipos
// ============================================================

export type LivePixProvider = 'gg'

export interface LivePixConfig {
  provider: LivePixProvider
  clientId?: string
  clientSecret?: string
  accessToken?: string
  refreshToken?: string
  tokenExpiresAt?: Date
  webhookUrl?: string
  webhookSecret?: string
}

/** Conta autenticada no LivePix (resultado de GET /v2/account). */
export interface LivePixAccountInfo {
  id: string
  username: string
  displayName?: string
}

/** Payload "magro" enviado pelo webhook oficial do LivePix. */
export interface LivePixWebhookPayload {
  userId?: string
  clientId?: string
  event: string
  resource: {
    id: string
    reference?: string
    type?: string
  }
}

/** Evento normalizado usado pelo pipeline interno do PixTune. */
export interface LivePixDonationEvent {
  event: 'donation.created' | 'donation.paid' | 'payment' | 'message'
  data: {
    id: string
    reference?: string
    description?: string
    /** Valor em reais (compatibilidade com simulações e payloads antigos). */
    amount?: number
    /** Valor em centavos, como a API oficial do LivePix retorna. */
    amountCents?: number
    currency?: string
    proof?: string
    username?: string
    message?: string
    flagged?: boolean
    timestamp?: string
    [key: string]: unknown
  }
  [key: string]: unknown
}

export interface LivePixMessage {
  id: string
  proof?: string
  reference?: string
  username?: string
  message?: string
  amount: number
  currency?: string
  flagged?: boolean
  createdAt?: string
}

export interface LivePixPayment {
  id: string
  proof?: string
  reference?: string
  amount: number
  currency?: string
  createdAt?: string
}

/** Converte uma mensagem da API oficial em evento normalizado. */
export function livePixMessageToEvent(message: LivePixMessage): LivePixDonationEvent {
  return {
    event: 'message',
    data: {
      id: message.id,
      reference: message.reference,
      username: message.username,
      message: message.message,
      amountCents: message.amount,
      currency: message.currency || 'BRL',
      proof: message.proof,
      flagged: message.flagged,
      timestamp: message.createdAt,
    },
  }
}

/** Converte um pagamento da API oficial em evento normalizado. */
export function livePixPaymentToEvent(payment: LivePixPayment): LivePixDonationEvent {
  return {
    event: 'payment',
    data: {
      id: payment.id,
      reference: payment.reference,
      amountCents: payment.amount,
      currency: payment.currency || 'BRL',
      proof: payment.proof,
      timestamp: payment.createdAt,
    },
  }
}

// ============================================================
// Cliente da API oficial (OAuth2 client_credentials)
// ============================================================

class LivePixClient {
  private accessToken?: string
  private expiresAt?: number

  constructor(
    private config: LivePixConfig,
    private userId?: string
  ) {
    this.accessToken = config.accessToken
    this.expiresAt = config.tokenExpiresAt?.getTime()
  }

  private async getAccessToken(force = false): Promise<string> {
    if (
      !force &&
      this.accessToken &&
      (!this.expiresAt || this.expiresAt > Date.now() + 60_000)
    ) {
      return this.accessToken
    }

    if (!this.config.clientId || !this.config.clientSecret) {
      throw new Error('LivePix: Client ID e Client Secret não configurados')
    }

    const res = await fetch(LIVEPIX_OAUTH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        scope: LIVEPIX_SCOPES,
      }),
    })

    if (!res.ok) {
      const detail = await readErrorMessage(res)
      throw httpError('Autenticação OAuth2 do LivePix', res, detail)
    }

    const json: any = await res.json()
    if (!json?.access_token) {
      throw new Error('LivePix: resposta OAuth2 sem access_token')
    }

    const accessToken: string = json.access_token
    this.accessToken = accessToken
    this.expiresAt = Date.now() + Number(json.expires_in || 3600) * 1000

    // Guarda o token para evitar novas emissões a cada webhook.
    if (this.userId) {
      try {
        await prisma.integration.updateMany({
          where: { userId: this.userId, type: 'livepix' },
          data: {
            accessToken: accessToken,
            expiresAt: new Date(this.expiresAt),
          },
        })
      } catch {
        // Persistir o token é otimização; não deve impedir a chamada.
      }
    }

    return accessToken
  }

  private async request<T>(path: string, init?: RequestInit, retry = true): Promise<T> {
    const token = await this.getAccessToken()
    const res = await fetch(`${LIVEPIX_API_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(init?.headers || {}),
      },
    })

    if (res.status === 401 && retry) {
      await this.getAccessToken(true)
      return this.request<T>(path, init, false)
    }

    if (!res.ok) {
      const detail = await readErrorMessage(res)
      throw httpError(`API do LivePix (${path})`, res, detail)
    }

    if (res.status === 204) return undefined as T
    return (await res.json()) as T
  }

  async getAccount(): Promise<{ id: string; email: string; username: string; displayName?: string }> {
    const json = await this.request<{ data: any }>('/v2/account')
    return json.data
  }

  getTokenInfo(): { accessToken?: string; expiresAt?: Date } {
    return {
      accessToken: this.accessToken,
      expiresAt: this.expiresAt ? new Date(this.expiresAt) : undefined,
    }
  }

  async listMessages(params?: { page?: number; limit?: number }): Promise<LivePixMessage[]> {
    const qs = new URLSearchParams()
    if (params?.page) qs.set('page', String(params.page))
    if (params?.limit) qs.set('limit', String(params.limit))
    const suffix = qs.toString() ? `?${qs}` : ''
    const json = await this.request<{ data: LivePixMessage[] }>(`/v2/messages${suffix}`)
    return json.data || []
  }

  async getMessage(messageId: string): Promise<LivePixMessage> {
    const json = await this.request<{ data: LivePixMessage }>(
      `/v2/messages/${encodeURIComponent(messageId)}`
    )
    return json.data
  }

  async listPayments(params?: { page?: number; limit?: number }): Promise<LivePixPayment[]> {
    const qs = new URLSearchParams()
    if (params?.page) qs.set('page', String(params.page))
    if (params?.limit) qs.set('limit', String(params.limit))
    const suffix = qs.toString() ? `?${qs}` : ''
    const json = await this.request<{ data: LivePixPayment[] }>(`/v2/payments${suffix}`)
    return json.data || []
  }

  async getPayment(paymentId: string): Promise<LivePixPayment> {
    const json = await this.request<{ data: LivePixPayment }>(
      `/v2/payments/${encodeURIComponent(paymentId)}`
    )
    return json.data
  }

  async createWebhook(url: string): Promise<{ id: string }> {
    const json = await this.request<{ data: { id: string } }>('/v2/webhooks', {
      method: 'POST',
      body: JSON.stringify({ url }),
    })
    return json.data
  }

  async listWebhooks(): Promise<Array<{ id: string; url: string }>> {
    const json = await this.request<{ data: Array<{ id: string; url: string }> }>(
      '/v2/webhooks'
    )
    return json.data || []
  }

  async deleteWebhook(webhookId: string): Promise<void> {
    await this.request<void>(`/v2/webhooks/${encodeURIComponent(webhookId)}`, {
      method: 'DELETE',
    })
  }
}

// ============================================================
// Serviço unificado do LivePix
// ============================================================

export class LivePixService {
  private client: LivePixClient | null = null

  constructor(config: LivePixConfig, userId?: string) {
    if (config.clientId && config.clientSecret) {
      this.client = new LivePixClient(config, userId)
    }
  }

  /** Verifica se a integração está configurada. */
  isConfigured(): boolean {
    return this.client !== null
  }

  /** Valida as credenciais consultando a conta autenticada. */
  async checkHealth(): Promise<{
    ok: boolean
    account?: { id: string; username: string; displayName?: string }
    accessToken?: string
    tokenExpiresAt?: Date
    reason?: string
  }> {
    if (!this.client) {
      return { ok: false, reason: 'Client ID e Client Secret não configurados' }
    }
    try {
      const account = await this.client.getAccount()
      const token = this.client.getTokenInfo()
      return {
        ok: true,
        account: {
          id: account.id,
          username: account.username,
          displayName: account.displayName,
        },
        accessToken: token.accessToken,
        tokenExpiresAt: token.expiresAt,
      }
    } catch (err: any) {
      return { ok: false, reason: err?.message || 'Não foi possível validar as credenciais' }
    }
  }

  /**
   * O webhook oficial envia apenas o ID e o tipo do recurso. Busca os
   * detalhes na API oficial antes de alimentar o pipeline.
   */
  async resolveWebhookResource(resource: {
    id: string
    type?: string
  }): Promise<LivePixDonationEvent | null> {
    if (!this.client) {
      throw new Error('LivePix não configurado para consultar os detalhes do webhook')
    }

    if (resource.type === 'message') {
      return livePixMessageToEvent(await this.client.getMessage(resource.id))
    }
    if (resource.type === 'payment') {
      return livePixPaymentToEvent(await this.client.getPayment(resource.id))
    }
    return null
  }

  /** Processa um evento já normalizado (webhook, simulação ou polling). */
  async processWebhookEvent(
    event: LivePixDonationEvent,
    userId: string,
    isDemo = false
  ): Promise<{
    donationId: string
    amountCents: number
    donorName: string
    donorMessage?: string
    status: 'received' | 'validated' | 'processed' | 'duplicate'
    isPaid: boolean
  }> {
    const { event: eventType, data } = event

    const amountCents =
      typeof data.amountCents === 'number'
        ? Math.round(data.amountCents)
        : Math.round((typeof data.amount === 'number' ? data.amount : 0) * 100)
    const currency = data.currency || 'BRL'
    const isPaid =
      eventType === 'donation.paid' ||
      eventType === 'payment' ||
      eventType === 'message' ||
      !!data.proof

    let donorName = 'Doador'
    let donorMessage: string | undefined

    if (data.username) donorName = data.username
    if (data.message) donorMessage = data.message
    if (data.description && !data.username) donorName = data.description

    // Verificar duplicidade por livepixEventId
    const existing = await prisma.donationEvent.findUnique({
      where: { livepixEventId: data.id },
    })

    if (existing) {
      return {
        donationId: existing.id,
        amountCents: existing.amountCents,
        donorName: existing.donorName,
        donorMessage: existing.donorMessage ?? undefined,
        status: 'duplicate',
        isPaid,
      }
    }

    const donationEvent = await prisma.donationEvent.create({
      data: {
        userId,
        livepixEventId: data.id,
        donorName,
        donorMessage,
        amountCents,
        currency,
        status: isPaid ? 'validated' : 'received',
        isDemo,
        rawPayload: JSON.stringify(event),
      },
    })

    return {
      donationId: donationEvent.id,
      amountCents: donationEvent.amountCents,
      donorName,
      donorMessage,
      status: isPaid ? 'validated' : 'received',
      isPaid,
    }
  }

  /** Cria um webhook no LivePix. */
  async configureWebhook(url: string): Promise<{ id: string }> {
    if (!this.client) throw new Error('LivePix não configurado')
    return this.client.createWebhook(url)
  }

  /** Lista os webhooks do LivePix. */
  async listWebhooks(): Promise<Array<{ id: string; url: string }>> {
    if (!this.client) throw new Error('LivePix não configurado')
    return this.client.listWebhooks()
  }

  /** Remove um webhook no LivePix. */
  async deleteWebhook(webhookId: string): Promise<void> {
    if (!this.client) throw new Error('LivePix não configurado')
    return this.client.deleteWebhook(webhookId)
  }
}

/** Busca a configuração de LivePix de um usuário no banco. */
export async function getLivePixConfig(userId: string): Promise<LivePixConfig | null> {
  const integration = await prisma.integration.findFirst({
    where: { userId, type: 'livepix', isActive: true },
  })
  if (!integration) return null

  const meta = parseMetadata(integration.metadata)

  return {
    provider: 'gg',
    clientId: meta.clientId as string | undefined,
    clientSecret: meta.clientSecret as string | undefined,
    accessToken: integration.accessToken || undefined,
    refreshToken: integration.refreshToken || undefined,
    tokenExpiresAt: integration.expiresAt || undefined,
    webhookUrl: meta.webhookUrl as string | undefined,
    webhookSecret: meta.webhookSecret as string | undefined,
  }
}

/** Salva ou atualiza a integração LivePix de um usuário. */
export async function saveLivePixConfig(
  userId: string,
  config: LivePixConfig,
  account?: LivePixAccountInfo | null
): Promise<void> {
  const existing = await prisma.integration.findUnique({
    where: { userId_type: { userId, type: 'livepix' } },
  })

  // Parte do metadata existente e só sobrescreve o que foi informado, para não
  // apagar o secret quando o formulário é salvo sem redigitá-lo.
  const meta: Record<string, unknown> = {
    ...parseMetadata(existing?.metadata),
    provider: 'gg',
  }
  if (config.clientId !== undefined) meta.clientId = config.clientId
  if (config.clientSecret) meta.clientSecret = config.clientSecret
  if (config.webhookUrl !== undefined) meta.webhookUrl = config.webhookUrl
  if (config.webhookSecret !== undefined) meta.webhookSecret = config.webhookSecret

  if (account) {
    meta.accountId = account.id
    meta.accountUsername = account.username
    meta.accountDisplayName = account.displayName || account.username
    meta.lastVerifiedAt = new Date().toISOString()
  }

  await prisma.integration.upsert({
    where: { userId_type: { userId, type: 'livepix' } },
    update: {
      accessToken: config.accessToken || null,
      refreshToken: config.refreshToken || null,
      expiresAt: config.tokenExpiresAt || null,
      isActive: true,
      metadata: JSON.stringify(meta),
    },
    create: {
      userId,
      type: 'livepix',
      name: 'LivePix',
      accessToken: config.accessToken || null,
      refreshToken: config.refreshToken || null,
      expiresAt: config.tokenExpiresAt || null,
      isActive: true,
      metadata: JSON.stringify(meta),
    },
  })
}

/** Conta LivePix validada por último (cache) e quando isso aconteceu. */
export async function getLivePixAccount(userId: string): Promise<{
  account: LivePixAccountInfo | null
  lastVerifiedAt: string | null
}> {
  const integration = await prisma.integration.findUnique({
    where: { userId_type: { userId, type: 'livepix' } },
  })
  const meta = parseMetadata(integration?.metadata)

  const account =
    typeof meta.accountId === 'string' && typeof meta.accountUsername === 'string'
      ? {
          id: meta.accountId,
          username: meta.accountUsername,
          displayName:
            typeof meta.accountDisplayName === 'string' ? meta.accountDisplayName : undefined,
        }
      : null

  return {
    account,
    lastVerifiedAt: typeof meta.lastVerifiedAt === 'string' ? meta.lastVerifiedAt : null,
  }
}

/**
 * Desconecta a integração de verdade:
 * 1. tenta remover no LivePix os webhooks que apontam para esta instalação
 *    (melhor esforço — a API pode estar limitada ou fora do ar);
 * 2. apaga Client ID, Client Secret, tokens e a conta em cache;
 * 3. marca a integração como inativa, então o webhook passa a responder 503.
 *
 * O token da URL de webhook é mantido: assim, ao reconectar, a mesma URL
 * volta a funcionar sem precisar cadastrá-la de novo no LivePix.
 */
export async function disconnectLivePix(userId: string): Promise<{
  remoteWebhooksRemoved: number
  remoteError?: string
}> {
  const integration = await prisma.integration.findUnique({
    where: { userId_type: { userId, type: 'livepix' } },
  })
  if (!integration) {
    return { remoteWebhooksRemoved: 0 }
  }

  const meta = parseMetadata(integration.metadata)
  let remoteWebhooksRemoved = 0
  let remoteError: string | undefined

  const config = await getLivePixConfig(userId)
  if (config?.clientId && config.clientSecret) {
    try {
      const service = new LivePixService(config, userId)
      const webhooks = await service.listWebhooks()
      const webhookToken = typeof meta.webhookToken === 'string' ? meta.webhookToken : null
      const ours = webhooks.filter((hook) =>
        webhookToken
          ? hook.url.includes(webhookToken)
          : hook.url.includes('/api/donations/webhook/')
      )
      for (const hook of ours) {
        try {
          await service.deleteWebhook(hook.id)
          remoteWebhooksRemoved += 1
        } catch (err: any) {
          remoteError = err?.message || 'Falha ao remover webhook no LivePix'
        }
      }
    } catch (err: any) {
      remoteError = err?.message || 'Falha ao consultar webhooks no LivePix'
    }
  }

  const nextMeta: Record<string, unknown> = { ...meta, provider: 'gg' }
  delete nextMeta.clientId
  delete nextMeta.clientSecret
  delete nextMeta.webhookUrl
  delete nextMeta.webhookSecret
  delete nextMeta.accountId
  delete nextMeta.accountUsername
  delete nextMeta.accountDisplayName
  delete nextMeta.lastVerifiedAt

  await prisma.integration.update({
    where: { userId_type: { userId, type: 'livepix' } },
    data: {
      isActive: false,
      accessToken: null,
      refreshToken: null,
      expiresAt: null,
      metadata: JSON.stringify(nextMeta),
    },
  })

  return { remoteWebhooksRemoved, remoteError }
}

/**
 * Obtém (ou cria) o token único de webhook do streamer.
 * O token é inserido na URL pública: /api/donations/webhook/:token
 * Assim o LivePix consegue associar cada notificação ao streamer correto.
 */
export async function getOrCreateWebhookToken(userId: string): Promise<string> {
  const integration = await prisma.integration.findUnique({
    where: { userId_type: { userId, type: 'livepix' } },
  })
  const meta = parseMetadata(integration?.metadata)

  if (meta.webhookToken) return meta.webhookToken as string

  const token = crypto.randomBytes(24).toString('hex')

  if (integration) {
    await prisma.integration.update({
      where: { id: integration.id },
      data: { metadata: JSON.stringify({ ...meta, webhookToken: token }) },
    })
  } else {
    await prisma.integration.create({
      data: {
        userId,
        type: 'livepix',
        name: 'LivePix',
        metadata: JSON.stringify({ webhookToken: token }),
      },
    })
  }

  return token
}

/** Resolve o userId a partir do token de webhook. */
export async function findUserIdByWebhookToken(token: string): Promise<string | null> {
  if (!token) return null

  // O token é hexadecimal (48 chars) e fica no metadata JSON. Filtrar no banco
  // evita carregar todas as integrações; a comparação exata abaixo descarta
  // qualquer falso positivo de substring.
  const candidates = await prisma.integration.findMany({
    where: { type: 'livepix', metadata: { contains: token } },
    select: { userId: true, metadata: true },
    take: 10,
  })

  for (const integration of candidates) {
    const meta = parseMetadata(integration.metadata)
    if (meta.webhookToken === token) return integration.userId
  }
  return null
}

/** Processa um webhook normalizado (função standalone para uso em rotas). */
export async function processWebhookEvent(
  event: LivePixDonationEvent,
  userId: string,
  isDemo = false
): Promise<{
  donationId: string
  amountCents: number
  donorName: string
  donorMessage?: string
  status: 'received' | 'validated' | 'processed' | 'duplicate'
  isPaid: boolean
}> {
  if (!userId) throw new Error('userId é obrigatório para processar o webhook')

  const service = new LivePixService({ provider: 'gg' })
  return service.processWebhookEvent(event, userId, isDemo)
}
