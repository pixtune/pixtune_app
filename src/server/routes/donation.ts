import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { authMiddleware, getUserId } from '../middleware/auth'
import {
  processWebhookEvent,
  getLivePixConfig,
  getLivePixAccount,
  saveLivePixConfig,
  disconnectLivePix,
  getOrCreateWebhookToken,
  findUserIdByWebhookToken,
  LivePixService,
} from '../services/livepix'
import prisma from '../lib/prisma'
import {
  detectSpotifySongRequest,
  spotifySongRequestReasonMessage,
  type DetectedSpotifySong,
  type SpotifySongRequestReason,
} from '../services/spotifySongRequest'
import { parseSongRequest } from '../services/songRequest'
import { getSongRequestSettings } from '../services/songRequestSettings'
import { maybeStartItem } from '../services/queuePriority'
import { getSpotifyAccessToken, SpotifyError } from '../services/spotify'
import { findSpotifyTrackIdInText, spotifyTrackUrl } from '../../shared/spotify'

const donations = new Hono()

// ============================================================
// Webhook do Live Pix (público - recebe notificações do Live Pix)
//
// URL pública por streamer: POST /api/donations/webhook/:token
// O token identifica o streamer dono da doação. Copie a URL exibida em
// Configurações > Live Pix e cadastre-a no painel do Live Pix.
// ============================================================

// Formato oficial do webhook do LivePix: o provedor envia apenas o ID e o
// tipo do recurso; os detalhes são consultados na API oficial.
// O formato normalizado continua aceito para simulações e testes locais.
const officialWebhookSchema = z.object({
  userId: z.string().optional(),
  clientId: z.string().optional(),
  event: z.string(),
  resource: z.object({
    id: z.string(),
    reference: z.string().optional(),
    type: z.string().optional(),
  }),
})

const normalizedWebhookSchema = z.object({
  event: z.enum(['donation.created', 'donation.paid', 'payment', 'message']),
  data: z.object({
    id: z.string(),
    reference: z.string().optional(),
    description: z.string().optional(),
    amount: z.number().optional(),
    amountCents: z.number().optional(),
    currency: z.string().optional(),
    proof: z.string().optional(),
    username: z.string().optional(),
    message: z.string().optional(),
    flagged: z.boolean().optional(),
    checkout: z.string().optional(),
    metadata: z.record(z.unknown()).optional(),
    timestamp: z.string().optional(),
  }),
})

const webhookSchema = z.union([officialWebhookSchema, normalizedWebhookSchema])

async function handleWebhook(token: string, payload: z.infer<typeof webhookSchema>) {
  const userId = await findUserIdByWebhookToken(token)
  if (!userId) {
    return { status: 404 as const, body: { success: false, error: { code: 'UNKNOWN_WEBHOOK', message: 'Webhook não reconhecido' } } }
  }

  const ignored = { status: 200 as const, body: { success: true, data: { status: 'ignored' } } }

  let event: z.infer<typeof normalizedWebhookSchema> | null = null

  if ('resource' in payload) {
    // Webhook oficial do LivePix (evento "new" para mensagens e pagamentos).
    if (payload.event !== 'new') return ignored

    const { id, type } = payload.resource
    if (type !== 'message' && type !== 'payment') return ignored

    const config = await getLivePixConfig(userId)
    if (!config?.clientId || !config?.clientSecret) {
      return {
        status: 503 as const,
        body: {
          success: false,
          error: {
            code: 'LIVEPIX_NOT_CONFIGURED',
            message: 'Configure o Client ID e o Client Secret do LivePix para consultar os detalhes do webhook.',
          },
        },
      }
    }

    try {
      const service = new LivePixService(config, userId)
      event = await service.resolveWebhookResource({ id, type })
    } catch (err: any) {
      console.error('Erro ao consultar detalhes do webhook no LivePix:', err)
      return {
        status: 502 as const,
        body: {
          success: false,
          error: {
            code: 'LIVEPIX_UNAVAILABLE',
            message: 'Não foi possível consultar os detalhes da doação no LivePix.',
          },
        },
      }
    }

    if (!event) return ignored
  } else {
    event = payload
  }

  try {
    const result = await processWebhookEvent(event, userId)

    // Se a doação foi paga, tentar aplicar o pedido musical da mensagem.
    if (result.status !== 'duplicate' && result.isPaid) {
      await applyDonationRules(result.donationId, result.amountCents, result.donorMessage)
    }

    // Relê o evento para devolver o status final.
    // Em duplicata, preserva o status original e não reaplica regras.
    const finalEvent = await prisma.donationEvent.findUnique({
      where: { id: result.donationId },
      select: {
        status: true,
        errorMessage: true,
        matchedRule: { select: { name: true, action: true } },
        queueItem: {
          select: {
            id: true,
            title: true,
            artist: true,
            providerId: true,
            sourceUrl: true,
            status: true,
          },
        },
      },
    })

    return {
      status: 200 as const,
      body: {
        success: true,
        data: {
          ...result,
          status: result.status === 'duplicate' ? 'duplicate' : (finalEvent?.status ?? result.status),
          matchedRuleName: finalEvent?.matchedRule?.name ?? null,
          matchedRuleAction: finalEvent?.matchedRule?.action ?? null,
          songTitle: finalEvent?.queueItem?.title ?? null,
          songArtist: finalEvent?.queueItem?.artist ?? null,
          spotifyTrackId: finalEvent?.queueItem?.providerId ?? null,
          queueItemStatus: finalEvent?.queueItem?.status ?? null,
          detectionNote: finalEvent?.errorMessage ?? null,
        },
      },
    }
  } catch (err: any) {
    console.error('Erro ao processar webhook Live Pix:', err)
    return {
      status: 200 as const,
      body: { success: false, error: { code: 'WEBHOOK_ERROR', message: err.message || 'Erro interno' } },
    }
  }
}

// Webhook com token do streamer (URL recomendada)
donations.post('/webhook/:token', zValidator('json', webhookSchema), async (c) => {
  const payload = c.req.valid('json')
  const { status, body } = await handleWebhook(c.req.param('token'), payload)
  return c.json(body, status)
})

// Webhook sem token (compatibilidade) - sempre 404, pois não há como rotear
donations.post('/webhook', zValidator('json', webhookSchema), async (c) => {
  return c.json(
    {
      success: false,
      error: { code: 'MISSING_WEBHOOK_TOKEN', message: 'Use a URL de webhook com token em Configurações > Live Pix' },
    },
    404
  )
})

// ============================================================
// Pipeline: mensagem da doação → música
// ============================================================

function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  })
}

async function markEvent(
  donationEventId: string,
  status: string,
  errorMessage: string | null,
  matchedRuleId?: string | null
): Promise<void> {
  await prisma.donationEvent.update({
    where: { id: donationEventId },
    data: {
      status,
      errorMessage,
      matchedRuleId: matchedRuleId ?? null,
      processedAt: new Date(),
    },
  })
}

interface EnqueueSongInput {
  userId: string
  donationEventId: string
  song: DetectedSpotifySong
}

/**
 * Coloca a música detectada na fila.
 *
 * A ordem é sempre definida pelo valor da doação. Não existe ação de regra
 * capaz de furar ou reordenar a prioridade.
 */
async function enqueueSong({ userId, donationEventId, song }: EnqueueSongInput) {
  const last = await prisma.queueItem.findFirst({
    where: { userId },
    orderBy: { position: 'desc' },
    select: { position: true },
  })

  const sourceUrl = song.sourceUrl || spotifyTrackUrl(song.providerId)

  const created = await prisma.queueItem.create({
    data: {
      userId,
      title: song.title,
      artist: song.artist,
      album: song.album,
      artworkUrl: song.artworkUrl,
      durationMs: song.durationMs,
      sourceUrl,
      provider: 'spotify',
      providerId: song.providerId,
      position: (last?.position ?? -1) + 1,
      addedBy: 'donation',
      donationEventId,
      status: 'pending',
      playedAt: null,
    },
  })

  // A doação já foi gravada com amountCents no DonationEvent, que é a fonte
  // imutável da prioridade. Se a nova faixa for a maior, ela derruba a atual.
  const started = await maybeStartItem(userId, created.id)

  return started ?? created
}

/**
 * Processa a mensagem de uma doação paga:
 * - detecta a música pedida;
 * - ignora mensagens que não são pedidos musicais;
 * - enfileira a música e aplica a prioridade por valor;
 * - registra o resultado no histórico.
 *
 * Não há palavras-chave nem ações de comando: a prioridade por valor é a
 * única regra de reprodução do sistema.
 */
async function applyDonationRules(
  donationEventId: string,
  amountCents: number,
  donorMessage?: string
): Promise<void> {
  const donationEvent = await prisma.donationEvent.findUnique({
    where: { id: donationEventId },
  })

  if (!donationEvent) return

  const userId = donationEvent.userId
  const message = (donorMessage ?? donationEvent.donorMessage ?? '').trim()
  const settings = await getSongRequestSettings(userId)

  if (!message) {
    await markEvent(donationEventId, 'ignored', spotifySongRequestReasonMessage('EMPTY_MESSAGE'))
    return
  }

  if (!settings.enabled) {
    await markEvent(
      donationEventId,
      'ignored',
      'Pedidos de música estão desativados nas configurações.'
    )
    return
  }

  // Mensagens que claramente não são pedidos (ou que usam link do YouTube)
  // devem ser ignoradas mesmo quando o Spotify ainda não foi conectado.
  // Um link do Spotify tem prioridade sobre a heurística de texto.
  if (!findSpotifyTrackIdInText(message)) {
    const parsed = parseSongRequest(message)
    if (parsed.reason) {
      await markEvent(
        donationEventId,
        'ignored',
        spotifySongRequestReasonMessage(parsed.reason as SpotifySongRequestReason)
      )
      return
    }
    if (parsed.kind === 'youtube') {
      await markEvent(
        donationEventId,
        'ignored',
        spotifySongRequestReasonMessage('YOUTUBE_LINK_NOT_SUPPORTED')
      )
      return
    }
  }

  let accessToken: string
  try {
    accessToken = await getSpotifyAccessToken(userId)
  } catch (err) {
    const message =
      err instanceof SpotifyError && err.code === 'NOT_CONNECTED'
        ? spotifySongRequestReasonMessage('SPOTIFY_NOT_CONNECTED')
        : 'Não foi possível falar com o Spotify agora. Tente novamente.'
    await markEvent(donationEventId, 'failed', message)
    return
  }

  let detection
  try {
    detection = await detectSpotifySongRequest(message, { accessToken })
  } catch (err) {
    await markEvent(
      donationEventId,
      'failed',
      err instanceof Error ? err.message : 'Erro ao detectar a música pedida.'
    )
    return
  }

  // A prioridade por valor é a única regra de reprodução. Mensagens que não
  // são pedidos musicais são ignoradas, sem comandos por palavra-chave.
  if (detection.status === 'not_song') {
    await markEvent(
      donationEventId,
      'ignored',
      spotifySongRequestReasonMessage(detection.reason)
    )
    return
  }

  if (detection.status === 'error' || !detection.song) {
    await markEvent(
      donationEventId,
      'failed',
      spotifySongRequestReasonMessage(detection.reason)
    )
    return
  }

  if (amountCents < settings.minAmountCents) {
    await markEvent(
      donationEventId,
      'ignored',
      `Pedido ignorado: o valor mínimo para pedir música é ${formatBRL(
        settings.minAmountCents
      )}.`
    )
    return
  }

  try {
    await enqueueSong({
      userId,
      donationEventId,
      song: detection.song,
    })

    await markEvent(donationEventId, 'processed', null)
  } catch (err) {
    await markEvent(
      donationEventId,
      'failed',
      err instanceof Error ? err.message : 'Erro ao adicionar a música à fila.'
    )
  }
}

// ============================================================
// Rotas autenticadas
// ============================================================

// Listar doações do usuário autenticado
donations.get('/', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const events = await prisma.donationEvent.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    include: {
      matchedRule: { select: { id: true, name: true, action: true } },
      queueItem: {
        select: {
          id: true,
          title: true,
          artist: true,
          provider: true,
          providerId: true,
          sourceUrl: true,
          artworkUrl: true,
          status: true,
        },
      },
    },
  })

  return c.json({
    success: true,
    data: {
      events: events.map((e) => ({
        id: e.id,
        livepixEventId: e.livepixEventId,
        donorName: e.donorName,
        donorMessage: e.donorMessage,
        amountCents: e.amountCents,
        currency: e.currency,
        status: e.status,
        matchedRuleId: e.matchedRuleId,
        matchedRuleName: e.matchedRule?.name,
        matchedRuleAction: e.matchedRule?.action,
        errorMessage: e.errorMessage,
        processedAt: e.processedAt,
        isDemo: e.isDemo,
        createdAt: e.createdAt,
        queueItem: e.queueItem,
      })),
      total: events.length,
    },
  })
})

// Obter configuração de Live Pix do usuário
donations.get('/config', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const config = await getLivePixConfig(userId)
  const webhookToken = await getOrCreateWebhookToken(userId)
  const { account, lastVerifiedAt } = await getLivePixAccount(userId)

  const configured = !!(config?.clientId && config?.clientSecret)

  return c.json({
    success: true,
    data: {
      configured,
      // "connected" só é verdadeiro quando as credenciais já foram aceitas
      // pelo LivePix (conta validada em cache), e não apenas quando existem.
      connected: configured && Boolean(account),
      account,
      lastVerifiedAt,
      clientId: config?.clientId ?? '',
      hasSecret: Boolean(config?.clientSecret),
      provider: 'gg',
      webhookUrl: config?.webhookUrl,
      webhookToken,
      webhookPath: `/api/donations/webhook/${webhookToken}`,
    },
  })
})

// Simulação local de doação (apenas fora de produção).
// Executa o MESMO pipeline do webhook real: grava no banco, evita duplicidade
// e processa a música pedida na mensagem. Serve para testar sem o Live Pix.
const simulateSchema = z.object({
  amount: z.number().positive(),
  donorName: z.string().min(1).default('Doador Teste'),
  message: z.string().optional(),
})

donations.post('/simulate', authMiddleware, zValidator('json', simulateSchema), async (c) => {
  if (process.env.NODE_ENV === 'production') {
    return c.json(
      { success: false, error: { code: 'DISABLED', message: 'Simulação desativada em produção' } },
      403
    )
  }

  const userId = getUserId(c)
  const { amount, donorName, message } = c.req.valid('json')

  const result = await processWebhookEvent(
    {
      event: 'donation.paid',
      data: {
        id: `sim_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        username: donorName,
        message,
        amountCents: Math.round(amount * 100),
        currency: 'BRL',
        proof: 'simulated',
      },
    },
    userId,
    true
  )

  await applyDonationRules(result.donationId, result.amountCents, result.donorMessage)

  const finalEvent = await prisma.donationEvent.findUnique({
    where: { id: result.donationId },
    select: {
      status: true,
      errorMessage: true,
      matchedRule: { select: { name: true, action: true } },
      queueItem: {
        select: {
          id: true,
          title: true,
          artist: true,
          providerId: true,
          sourceUrl: true,
          status: true,
        },
      },
    },
  })

  return c.json({
    success: true,
    data: {
      ...result,
      status: finalEvent?.status ?? result.status,
      matchedRuleName: finalEvent?.matchedRule?.name ?? null,
      matchedRuleAction: finalEvent?.matchedRule?.action ?? null,
      songTitle: finalEvent?.queueItem?.title ?? null,
      songArtist: finalEvent?.queueItem?.artist ?? null,
      spotifyTrackId: finalEvent?.queueItem?.providerId ?? null,
      queueItemStatus: finalEvent?.queueItem?.status ?? null,
      detectionNote: finalEvent?.errorMessage ?? null,
    },
  })
})

// Salvar configuração do LivePix (valida as credenciais antes de gravar)
const livepixConfigSchema = z.object({
  clientId: z.string().min(1, 'Informe o Client ID'),
  // Opcional: em branco mantém o secret já salvo (o formulário nunca o recebe de volta).
  clientSecret: z.string().optional(),
  webhookUrl: z.string().url().optional().or(z.literal('')),
  webhookSecret: z.string().optional(),
})

donations.post('/config', authMiddleware, zValidator('json', livepixConfigSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')

  const existing = await getLivePixConfig(userId)
  const clientSecret = body.clientSecret?.trim() || existing?.clientSecret

  if (!clientSecret) {
    return c.json(
      {
        success: false,
        error: {
          code: 'MISSING_SECRET',
          message: 'Informe o Client Secret da aplicação LivePix.',
        },
      },
      400
    )
  }

  const config = {
    provider: 'gg' as const,
    clientId: body.clientId.trim(),
    clientSecret,
    webhookUrl: body.webhookUrl || existing?.webhookUrl,
    webhookSecret: body.webhookSecret ?? existing?.webhookSecret,
  }

  // Valida de verdade: emite/usa o token OAuth2 e consulta GET /v2/account.
  const service = new LivePixService(config, userId)
  const health = await service.checkHealth()
  if (!health.ok) {
    return c.json(
      {
        success: false,
        error: {
          code: 'LIVEPIX_ERROR',
          message: `Não foi possível validar as credenciais no LivePix: ${
            health.reason || 'verifique os dados'
          }`,
        },
      },
      422
    )
  }

  await saveLivePixConfig(
    userId,
    { ...config, accessToken: health.accessToken, tokenExpiresAt: health.tokenExpiresAt },
    health.account
  )

  const webhookToken = await getOrCreateWebhookToken(userId)

  return c.json({
    success: true,
    data: {
      configured: true,
      connected: true,
      account: health.account ?? null,
      lastVerifiedAt: new Date().toISOString(),
      webhookToken,
      webhookPath: `/api/donations/webhook/${webhookToken}`,
    },
  })
})

// Revalida a conexão agora. Usa o token em cache (só emite novo se expirado),
// respeitando o limite de emissão de tokens do LivePix.
donations.post('/config/verify', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const config = await getLivePixConfig(userId)

  if (!config?.clientId || !config.clientSecret) {
    return c.json(
      {
        success: false,
        error: { code: 'NOT_CONFIGURED', message: 'Integração LivePix não está configurada.' },
      },
      400
    )
  }

  const service = new LivePixService(config, userId)
  const health = await service.checkHealth()

  if (!health.ok) {
    return c.json(
      {
        success: false,
        error: {
          code: 'LIVEPIX_ERROR',
          message: `Falha ao conectar no LivePix: ${
            health.reason || 'verifique as credenciais'
          }`,
        },
      },
      422
    )
  }

  await saveLivePixConfig(
    userId,
    { ...config, accessToken: health.accessToken, tokenExpiresAt: health.tokenExpiresAt },
    health.account
  )

  return c.json({
    success: true,
    data: {
      connected: true,
      account: health.account ?? null,
      lastVerifiedAt: new Date().toISOString(),
    },
  })
})

// Desconectar de verdade: limpa credenciais e tokens e tenta remover o webhook
// cadastrado no LivePix (melhor esforço).
donations.post('/config/disconnect', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const result = await disconnectLivePix(userId)
  const webhookToken = await getOrCreateWebhookToken(userId)

  return c.json({
    success: true,
    data: {
      configured: false,
      connected: false,
      account: null,
      lastVerifiedAt: null,
      remoteWebhooksRemoved: result.remoteWebhooksRemoved,
      warning: result.remoteError ?? null,
      webhookToken,
      webhookPath: `/api/donations/webhook/${webhookToken}`,
    },
  })
})

export default donations
