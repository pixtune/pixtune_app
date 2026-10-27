/**
 * Conexão do canal do YouTube via OAuth 2.0 + YouTube Data API v3.
 *
 * LIMITAÇÕES OFICIAIS (importantes):
 *  - Não existe API oficial para "tocar como o usuário logado". A reprodução
 *    continua pela IFrame Player API e funciona sem login.
 *  - Login NÃO desbloqueia YouTube Music, Premium, biblioteca do YT Music,
 *    remoção de anúncios ou restrições de idade/região.
 *  - Esta conexão serve apenas para ler dados públicos do canal (nome,
 *    avatar, inscritos). Os tokens ficam salvos no banco local.
 */

import { Hono } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { authMiddleware, getUserId } from '../middleware/auth.js'
import prisma from '../lib/prisma.js'
import {
  YOUTUBE_SCOPES,
  buildGoogleAuthUrl,
  createNonce,
  exchangeGoogleCode,
  fetchYouTubeChannel,
  getGoogleOAuthConfig,
  isGoogleOAuthConfigured,
  refreshGoogleToken,
  signOAuthState,
  verifyOAuthState,
  type YouTubeChannelInfo,
} from '../services/googleOAuth.js'

const youtube = new Hono()

const OAUTH_NONCE_COOKIE = 'pixtune_youtube_nonce'

function appUrl(path: string): string {
  const base = (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '')
  return `${base}${path}`
}

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'Lax' as const,
    path: '/',
    maxAge: 600,
    secure: (process.env.API_URL || '').startsWith('https'),
  }
}

function parseMetadata(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function channelFromMetadata(meta: Record<string, unknown>): YouTubeChannelInfo | null {
  const channel = meta.channel as YouTubeChannelInfo | undefined
  return channel && channel.id ? channel : null
}

function parseScopes(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

// ---------------------------------------------------------------
// Status da conexão (autenticado)
// ---------------------------------------------------------------

youtube.get('/status', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const integration = await prisma.integration.findUnique({
    where: { userId_type: { userId, type: 'youtube' } },
  })

  const meta = parseMetadata(integration?.metadata)
  const connected = Boolean(integration && integration.isActive)

  return c.json({
    success: true,
    data: {
      configured: isGoogleOAuthConfigured(),
      connected,
      channel: connected ? channelFromMetadata(meta) : null,
      connectedAt: connected ? ((meta.connectedAt as string) || null) : null,
      scopes: connected ? parseScopes(integration?.scopes) : [],
    },
  })
})

// ---------------------------------------------------------------
// Início do fluxo (autenticado): gera URL de início de uso único
// ---------------------------------------------------------------

youtube.post('/connect-url', authMiddleware, (c) => {
  const config = getGoogleOAuthConfig()
  if (!config) {
    return c.json(
      {
        success: false,
        error: {
          code: 'GOOGLE_NOT_CONFIGURED',
          message: 'OAuth do Google não configurado no servidor (.env).',
        },
      },
      400
    )
  }

  const userId = getUserId(c)
  const startToken = signOAuthState({ kind: 'youtube_start', nonce: createNonce(), userId })

  return c.json({
    success: true,
    data: { url: `${config.apiUrl}/api/youtube/start?ct=${encodeURIComponent(startToken)}` },
  })
})

// Navegação top-level: define o cookie anti-CSRF e redireciona ao Google.
youtube.get('/start', (c) => {
  const startToken = c.req.query('ct')
  const state = startToken ? verifyOAuthState(startToken) : null

  if (!state || state.kind !== 'youtube_start' || !state.userId) {
    return c.redirect(appUrl('/settings?section=youtube&youtube=invalid'))
  }
  if (!isGoogleOAuthConfigured()) {
    return c.redirect(appUrl('/settings?section=youtube&youtube=not_configured'))
  }

  setCookie(c, OAUTH_NONCE_COOKIE, state.nonce, cookieOptions())

  const oauthState = signOAuthState({ kind: 'youtube', nonce: state.nonce, userId: state.userId })
  const url = buildGoogleAuthUrl({
    kind: 'youtube',
    state: oauthState,
    scopes: YOUTUBE_SCOPES,
    prompt: 'consent',
  })

  return c.redirect(url)
})

// Retorno do Google (navegação top-level, sem header Authorization).
youtube.get('/callback', async (c) => {
  const error = c.req.query('error')
  const code = c.req.query('code')
  const stateToken = c.req.query('state')
  const cookieNonce = getCookie(c, OAUTH_NONCE_COOKIE)
  deleteCookie(c, OAUTH_NONCE_COOKIE, { path: '/' })

  if (error) return c.redirect(appUrl('/settings?section=youtube&youtube=denied'))
  if (!code || !stateToken) return c.redirect(appUrl('/settings?section=youtube&youtube=invalid'))

  const state = verifyOAuthState(stateToken)
  if (
    !state ||
    state.kind !== 'youtube' ||
    !state.userId ||
    !cookieNonce ||
    state.nonce !== cookieNonce
  ) {
    return c.redirect(appUrl('/settings?section=youtube&youtube=state'))
  }

  try {
    const tokens = await exchangeGoogleCode(code, 'youtube')
    const channel = await fetchYouTubeChannel(tokens.access_token)
    const expiresAt = tokens.expires_in
      ? new Date(Date.now() + tokens.expires_in * 1000)
      : null
    const metadata = { channel, connectedAt: new Date().toISOString() }

    await prisma.integration.upsert({
      where: { userId_type: { userId: state.userId, type: 'youtube' } },
      update: {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || undefined,
        expiresAt,
        scopes: JSON.stringify(YOUTUBE_SCOPES),
        isActive: true,
        metadata: JSON.stringify(metadata),
      },
      create: {
        userId: state.userId,
        type: 'youtube',
        name: 'YouTube',
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || null,
        expiresAt,
        scopes: JSON.stringify(YOUTUBE_SCOPES),
        isActive: true,
        metadata: JSON.stringify(metadata),
      },
    })

    return c.redirect(appUrl('/settings?section=youtube&youtube=connected'))
  } catch {
    return c.redirect(appUrl('/settings?section=youtube&youtube=failed'))
  }
})

// ---------------------------------------------------------------
// Ações autenticadas: atualizar dados e desconectar
// ---------------------------------------------------------------

youtube.post('/refresh', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const integration = await prisma.integration.findUnique({
    where: { userId_type: { userId, type: 'youtube' } },
  })

  if (!integration || !integration.isActive) {
    return c.json(
      { success: false, error: { code: 'NOT_CONNECTED', message: 'Nenhum canal conectado.' } },
      404
    )
  }

  try {
    let accessToken = integration.accessToken || ''
    const expiringSoon =
      !integration.expiresAt || integration.expiresAt.getTime() < Date.now() + 60_000

    if (expiringSoon && integration.refreshToken) {
      const refreshed = await refreshGoogleToken(integration.refreshToken)
      accessToken = refreshed.access_token
      await prisma.integration.update({
        where: { id: integration.id },
        data: {
          accessToken: refreshed.access_token,
          expiresAt: refreshed.expires_in
            ? new Date(Date.now() + refreshed.expires_in * 1000)
            : integration.expiresAt,
        },
      })
    }

    const channel = await fetchYouTubeChannel(accessToken)
    const metadata = { channel, connectedAt: new Date().toISOString() }
    await prisma.integration.update({
      where: { id: integration.id },
      data: { metadata: JSON.stringify(metadata) },
    })

    return c.json({ success: true, data: { channel } })
  } catch {
    return c.json(
      {
        success: false,
        error: {
          code: 'REFRESH_FAILED',
          message: 'Não foi possível atualizar os dados do canal. Reconecte a conta.',
        },
      },
      502
    )
  }
})

youtube.post('/disconnect', authMiddleware, async (c) => {
  const userId = getUserId(c)
  await prisma.integration.deleteMany({ where: { userId, type: 'youtube' } })
  return c.json({ success: true })
})

export default youtube
