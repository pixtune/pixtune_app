/**
 * Conexão da conta do Spotify via OAuth 2.0 oficial.
 *
 * A reprodução é feita pelo Web Playback SDK no navegador. O servidor guarda
 * o refresh token e entrega ao cliente apenas um access token de curta
 * duração, necessário para registrar o dispositivo Spotify Connect.
 */

import crypto from 'crypto'
import JWT from 'jsonwebtoken'
import { Hono } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { authMiddleware, getUserId } from '../middleware/auth.js'
import prisma from '../lib/prisma.js'
import {
  SPOTIFY_SCOPES,
  buildSpotifyAuthUrl,
  exchangeSpotifyCode,
  fetchPlaylistTracks,
  fetchSpotifyProfile,
  fetchSpotifyPlaylists,
  fetchSpotifyTrack,
  getSpotifyAccessToken,
  getSpotifyConfig,
  isSpotifyConfigured,
  searchSpotifyTracks,
  spotifyConnectRedirectUri,
  SpotifyError,
  type SpotifyProfile,
} from '../services/spotify.js'
import { extractSpotifyPlaylistId, extractSpotifyTrackId } from '../../shared/spotify.js'

const spotify = new Hono()

const OAUTH_NONCE_COOKIE = 'pixtune_spotify_nonce'
const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-change-in-production'

interface SpotifyOAuthState {
  kind: 'spotify_start' | 'spotify'
  nonce: string
  userId?: string
}

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

function createNonce(): string {
  return crypto.randomBytes(16).toString('hex')
}

function signState(payload: SpotifyOAuthState): string {
  return JWT.sign(payload, JWT_SECRET, { expiresIn: '10m' })
}

function verifyState(token: string): SpotifyOAuthState | null {
  try {
    const decoded = JWT.verify(token, JWT_SECRET)
    if (!decoded || typeof decoded === 'string') return null
    const state = decoded as SpotifyOAuthState
    if (!state.kind || !state.nonce) return null
    if (state.kind !== 'spotify_start' && state.kind !== 'spotify') return null
    return state
  } catch {
    return null
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

function profileFromMetadata(meta: Record<string, unknown>): SpotifyProfile | null {
  const profile = meta.profile as SpotifyProfile | undefined
  return profile && profile.id ? profile : null
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

function errorResponse(c: any, code: string, message: string, status: 400 | 401 | 404 | 409 | 422 | 502) {
  return c.json({ success: false, error: { code, message } }, status)
}

// ---------------------------------------------------------------
// Status
// ---------------------------------------------------------------

spotify.get('/status', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const integration = await prisma.integration.findUnique({
    where: { userId_type: { userId, type: 'spotify' } },
  })

  const meta = parseMetadata(integration?.metadata)
  const profile = profileFromMetadata(meta)
  const connected = Boolean(integration?.isActive && integration?.accessToken)

  return c.json({
    success: true,
    data: {
      configured: isSpotifyConfigured(),
      redirectUri: spotifyConnectRedirectUri(),
      connected,
      profile: connected ? profile : null,
      premium: connected ? profile?.product === 'premium' : false,
      connectedAt: connected ? ((meta.connectedAt as string) || null) : null,
      scopes: connected ? parseScopes(integration?.scopes) : [],
    },
  })
})

// ---------------------------------------------------------------
// OAuth
// ---------------------------------------------------------------

spotify.post('/connect-url', authMiddleware, (c) => {
  if (!isSpotifyConfigured()) {
    return errorResponse(
      c,
      'SPOTIFY_NOT_CONFIGURED',
      'Spotify não configurado no servidor (.env).',
      400
    )
  }

  const userId = getUserId(c)
  const nonce = createNonce()
  const startToken = signState({ kind: 'spotify_start', nonce, userId })
  const config = getSpotifyConfig()!

  // Amarra o início do OAuth ao navegador autenticado. Sem isso, um link
  // /start gerado por outra conta poderia conectar o Spotify da vítima à
  // conta errada (OAuth login CSRF).
  setCookie(c, OAUTH_NONCE_COOKIE, nonce, cookieOptions())

  return c.json({
    success: true,
    data: {
      url: `${config.apiUrl}/api/spotify/start?ct=${encodeURIComponent(startToken)}`,
      redirectUri: config.connectRedirectUri,
    },
  })
})

spotify.get('/start', (c) => {
  const startToken = c.req.query('ct')
  const state = startToken ? verifyState(startToken) : null
  const cookieNonce = getCookie(c, OAUTH_NONCE_COOKIE)

  if (
    !state ||
    state.kind !== 'spotify_start' ||
    !state.userId ||
    !cookieNonce ||
    state.nonce !== cookieNonce
  ) {
    return c.redirect(appUrl('/settings?section=spotify&spotify=invalid'))
  }
  if (!isSpotifyConfigured()) {
    return c.redirect(appUrl('/settings?section=spotify&spotify=not_configured'))
  }

  const oauthState = signState({ kind: 'spotify', nonce: state.nonce, userId: state.userId })
  return c.redirect(
    buildSpotifyAuthUrl({ state: oauthState, redirectUri: spotifyConnectRedirectUri() })
  )
})

spotify.get('/callback', async (c) => {
  const error = c.req.query('error')
  const code = c.req.query('code')
  const stateToken = c.req.query('state')
  const cookieNonce = getCookie(c, OAUTH_NONCE_COOKIE)
  deleteCookie(c, OAUTH_NONCE_COOKIE, { path: '/' })

  if (error) return c.redirect(appUrl('/settings?section=spotify&spotify=denied'))
  if (!code || !stateToken) {
    return c.redirect(appUrl('/settings?section=spotify&spotify=invalid'))
  }

  const state = verifyState(stateToken)
  if (
    !state ||
    state.kind !== 'spotify' ||
    !state.userId ||
    !cookieNonce ||
    state.nonce !== cookieNonce
  ) {
    return c.redirect(appUrl('/settings?section=spotify&spotify=state'))
  }

  try {
    const tokens = await exchangeSpotifyCode(code, fetch, spotifyConnectRedirectUri())
    const profile = await fetchSpotifyProfile(tokens.access_token)
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000)
    const metadata = { profile, connectedAt: new Date().toISOString() }

    await prisma.$transaction([
      prisma.integration.upsert({
        where: { userId_type: { userId: state.userId, type: 'spotify' } },
        update: {
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token || undefined,
          expiresAt,
          scopes: JSON.stringify(SPOTIFY_SCOPES),
          isActive: true,
          metadata: JSON.stringify(metadata),
        },
        create: {
          userId: state.userId,
          type: 'spotify',
          name: 'Spotify',
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token || null,
          expiresAt,
          scopes: JSON.stringify(SPOTIFY_SCOPES),
          isActive: true,
          metadata: JSON.stringify(metadata),
        },
      }),
      prisma.settings.upsert({
        where: { userId: state.userId },
        update: { musicProvider: 'spotify', musicConnected: true },
        create: {
          userId: state.userId,
          musicProvider: 'spotify',
          musicConnected: true,
        },
      }),
    ])

    return c.redirect(appUrl('/settings?section=spotify&spotify=connected'))
  } catch {
    return c.redirect(appUrl('/settings?section=spotify&spotify=failed'))
  }
})

spotify.post('/token', authMiddleware, async (c) => {
  const userId = getUserId(c)
  try {
    const accessToken = await getSpotifyAccessToken(userId)
    const integration = await prisma.integration.findUnique({
      where: { userId_type: { userId, type: 'spotify' } },
      select: { expiresAt: true },
    })

    return c.json({
      success: true,
      data: {
        accessToken,
        expiresAt: integration?.expiresAt?.toISOString() ?? null,
      },
    })
  } catch (error) {
    const code = error instanceof SpotifyError ? error.code : 'TOKEN_FAILED'
    const message =
      error instanceof Error ? error.message : 'Não foi possível obter o token do Spotify.'
    return errorResponse(c, code, message, code === 'NOT_CONNECTED' ? 401 : 502)
  }
})

spotify.post('/refresh', authMiddleware, async (c) => {
  const userId = getUserId(c)
  try {
    const accessToken = await getSpotifyAccessToken(userId)
    const profile = await fetchSpotifyProfile(accessToken)
    const integration = await prisma.integration.findUnique({
      where: { userId_type: { userId, type: 'spotify' } },
    })

    if (integration) {
      const meta = parseMetadata(integration.metadata)
      await prisma.integration.update({
        where: { id: integration.id },
        data: {
          metadata: JSON.stringify({
            ...meta,
            profile,
            connectedAt: (meta.connectedAt as string) || new Date().toISOString(),
          }),
        },
      })
    }

    return c.json({ success: true, data: { profile } })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Não foi possível atualizar a conta do Spotify.'
    return errorResponse(c, 'REFRESH_FAILED', message, 502)
  }
})

spotify.post('/disconnect', authMiddleware, async (c) => {
  const userId = getUserId(c)
  await prisma.$transaction([
    prisma.integration.deleteMany({ where: { userId, type: 'spotify' } }),
    prisma.settings.upsert({
      where: { userId },
      update: { musicConnected: false },
      create: { userId, musicProvider: 'spotify', musicConnected: false },
    }),
  ])
  return c.json({ success: true })
})

// ---------------------------------------------------------------
// Playlists
// ---------------------------------------------------------------

spotify.get('/playlists', authMiddleware, async (c) => {
  const userId = getUserId(c)
  try {
    const accessToken = await getSpotifyAccessToken(userId)
    const playlists = await fetchSpotifyPlaylists(accessToken)
    return c.json({ success: true, data: { playlists, total: playlists.length } })
  } catch (error) {
    const code = error instanceof SpotifyError ? error.code : 'PLAYLISTS_FAILED'
    const message = error instanceof Error ? error.message : 'Não foi possível listar as playlists.'
    return errorResponse(c, code, message, code === 'NOT_CONNECTED' ? 401 : 502)
  }
})

spotify.post('/playlists/:id/import', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const rawPlaylistId = c.req.param('id')
  const playlistId =
    extractSpotifyPlaylistId(rawPlaylistId) ||
    (/^[A-Za-z0-9]{22}$/.test(rawPlaylistId) ? rawPlaylistId : null)

  if (!playlistId) {
    return errorResponse(c, 'INVALID_PLAYLIST', 'Playlist do Spotify inválida.', 400)
  }

  try {
    const accessToken = await getSpotifyAccessToken(userId)
    const tracks = await fetchPlaylistTracks(accessToken, playlistId)

    const last = await prisma.queueItem.findFirst({
      where: { userId },
      orderBy: { position: 'desc' },
      select: { position: true },
    })
    const existing = await prisma.queueItem.findMany({
      where: {
        userId,
        provider: 'spotify',
        status: { in: ['pending', 'playing', 'paused'] },
        providerId: { not: null },
      },
      select: { providerId: true },
    })
    const existingIds = new Set(existing.map((item) => item.providerId).filter(Boolean))
    let position = (last?.position ?? -1) + 1
    let imported = 0
    let skipped = 0

    for (const track of tracks) {
      if (existingIds.has(track.id)) {
        skipped += 1
        continue
      }

      await prisma.queueItem.create({
        data: {
          userId,
          title: track.title,
          artist: track.artist,
          album: track.album,
          artworkUrl: track.artworkUrl,
          durationMs: track.durationMs || null,
          sourceUrl: track.sourceUrl,
          provider: 'spotify',
          providerId: track.id,
          position: position++,
          addedBy: 'playlist',
          status: 'pending',
          playedAt: null,
        },
      })
      existingIds.add(track.id)
      imported += 1
    }

    await prisma.settings.upsert({
      where: { userId },
      update: { musicProvider: 'spotify', musicConnected: true },
      create: { userId, musicProvider: 'spotify', musicConnected: true },
    })

    return c.json({
      success: true,
      data: { imported, skipped, total: tracks.length, playlistId },
    })
  } catch (error) {
    const code = error instanceof SpotifyError ? error.code : 'IMPORT_FAILED'
    const message = error instanceof Error ? error.message : 'Não foi possível importar a playlist.'
    return errorResponse(c, code, message, code === 'NOT_CONNECTED' ? 401 : 502)
  }
})

// ---------------------------------------------------------------
// Busca e resolução de faixa
// ---------------------------------------------------------------

spotify.get('/search', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const query = (c.req.query('q') || '').trim()

  if (!query) {
    return c.json({ success: true, data: { tracks: [], total: 0 } })
  }

  try {
    const accessToken = await getSpotifyAccessToken(userId)
    const tracks = await searchSpotifyTracks(accessToken, query)
    return c.json({ success: true, data: { tracks, total: tracks.length } })
  } catch (error) {
    const code = error instanceof SpotifyError ? error.code : 'SEARCH_FAILED'
    const message = error instanceof Error ? error.message : 'Não foi possível buscar no Spotify.'
    return errorResponse(c, code, message, code === 'NOT_CONNECTED' ? 401 : 502)
  }
})

spotify.post('/resolve', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const body = (await c.req.json().catch(() => ({}))) as { url?: string }
  const trackId = body.url ? extractSpotifyTrackId(body.url) : null

  if (!trackId) {
    return errorResponse(
      c,
      'INVALID_SPOTIFY_URL',
      'Informe um link ou ID válido de uma faixa do Spotify.',
      400
    )
  }

  try {
    const accessToken = await getSpotifyAccessToken(userId)
    const track = await fetchSpotifyTrack(accessToken, trackId)
    return c.json({ success: true, data: track })
  } catch (error) {
    const code = error instanceof SpotifyError ? error.code : 'RESOLVE_FAILED'
    const message = error instanceof Error ? error.message : 'Não foi possível resolver a faixa.'
    return errorResponse(
      c,
      code,
      message,
      code === 'NOT_CONNECTED' ? 401 : code === 'NOT_FOUND' ? 404 : 502
    )
  }
})

export default spotify
