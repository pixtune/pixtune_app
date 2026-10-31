/**
 * Conexão da conta do Spotify via OAuth 2.0 oficial.
 *
 * A reprodução é feita pelo Web Playback SDK no navegador. O servidor guarda
 * o refresh token e entrega ao cliente apenas um access token de curta
 * duração, necessário para registrar o dispositivo Spotify Connect.
 */

import { Hono } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { authMiddleware, getUserId, resolveSessionUser } from '../middleware/auth.js'
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
  missingSpotifyScopes,
  parseSpotifyScopes,
  searchSpotifyTracks,
  spotifyConnectRedirectUri,
  spotifyErrorStatus,
  SpotifyError,
  withSpotifyAccessToken,
  type SpotifyProfile,
} from '../services/spotify.js'
import { extractSpotifyPlaylistId, extractSpotifyTrackId } from '../../shared/spotify.js'
import { describeError, logEvent } from '../lib/logger.js'
import {
  appUrl,
  createOAuthAttempt,
  isProduction,
  oauthCookieClearOptions,
  oauthCookieOptions,
  oauthNonceCookieName,
  signOAuthState,
  verifyOAuthState,
} from '../lib/spotifyOAuth.js'

const spotify = new Hono()

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

function errorResponse(
  c: any,
  code: string,
  message: string,
  status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 502 | 503
) {
  return c.json({ success: false, error: { code, message } }, status)
}

function connectionErrorStatus(error: unknown): string {
  if (error instanceof SpotifyError) {
    if (error.code === 'SPOTIFY_USER_NOT_ALLOWED') return 'not_allowed'
    if (error.code === 'SPOTIFY_INSUFFICIENT_SCOPE') return 'scope'
    if (error.code === 'SPOTIFY_FORBIDDEN') return 'forbidden'
    if (error.code === 'SPOTIFY_RATE_LIMITED') return 'rate_limited'
    if (error.code === 'TOKEN_EXCHANGE_FAILED') return 'failed'
  }

  const code = (error as { code?: unknown } | null)?.code
  if (typeof code === 'string' && code.startsWith('P')) return 'database'
  return 'failed'
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
  const { attemptId, nonce } = createOAuthAttempt()
  const startToken = signOAuthState({
    kind: 'spotify_start',
    flow: 'connect',
    attemptId,
    nonce,
    userId,
  })
  const config = getSpotifyConfig()!

  // Amarra o início do OAuth ao navegador autenticado. Sem isso, um link
  // /start gerado por outra conta poderia conectar o Spotify da vítima à
  // conta errada (OAuth login CSRF). O nome do cookie inclui o attemptId:
  // tentativas simultâneas não sobrescrevem o nonce uma da outra.
  setCookie(c, oauthNonceCookieName(attemptId), nonce, oauthCookieOptions())

  logEvent('info', 'spotify.connect_url', {
    userId,
    origin: c.req.header('origin') || null,
    cookieSecure: isProduction(),
    redirectUri: config.connectRedirectUri,
  })

  return c.json({
    success: true,
    data: {
      // URL relativa para manter o nonce em contexto first-party no navegador
      // (Cloudflare Pages em produção, proxy do Vite em desenvolvimento).
      url: `/api/spotify/start?ct=${encodeURIComponent(startToken)}`,
      redirectUri: config.connectRedirectUri,
    },
  })
})

spotify.get('/start', async (c) => {
  const startToken = c.req.query('ct')
  const state = startToken ? verifyOAuthState(startToken) : null
  const cookieName = state ? oauthNonceCookieName(state.attemptId) : null
  const cookieNonce = cookieName ? getCookie(c, cookieName) : undefined

  if (
    !state ||
    state.kind !== 'spotify_start' ||
    state.flow !== 'connect' ||
    !state.userId ||
    !cookieNonce ||
    state.nonce !== cookieNonce
  ) {
    logEvent('warn', 'spotify.start_rejected', {
      reason: !state
        ? 'invalid_state'
        : state.kind !== 'spotify_start'
          ? 'wrong_state_kind'
          : state.flow !== 'connect'
            ? 'wrong_flow'
            : !state.userId
              ? 'missing_user'
              : !cookieNonce
                ? 'missing_nonce_cookie'
                : 'nonce_mismatch',
      hasState: Boolean(state),
      hasUserId: Boolean(state?.userId),
      hasNonceCookie: Boolean(cookieNonce),
    })
    return c.redirect(appUrl('/settings?section=spotify&spotify=invalid'))
  }
  if (!isSpotifyConfigured()) {
    return c.redirect(appUrl('/settings?section=spotify&spotify=not_configured'))
  }

  // A conexão pertence a um usuário PixTune. Se a sessão expirou ou trocou
  // entre o clique e o redirect, não conecte a conta ao usuário errado.
  const sessionUser = await resolveSessionUser(c)
  if (!sessionUser || sessionUser.id !== state.userId) {
    logEvent('warn', 'spotify.start_rejected', {
      reason: !sessionUser ? 'missing_session' : 'session_user_mismatch',
      stateUserId: state.userId,
      sessionUserId: sessionUser?.id ?? null,
    })
    return c.redirect(appUrl('/settings?section=spotify&spotify=session'))
  }

  const oauthState = signOAuthState({
    kind: 'spotify',
    flow: 'connect',
    attemptId: state.attemptId,
    nonce: state.nonce,
    userId: state.userId,
  })
  return c.redirect(
    buildSpotifyAuthUrl({ state: oauthState, redirectUri: spotifyConnectRedirectUri() })
  )
})

spotify.get('/callback', async (c) => {
  const error = c.req.query('error')
  const code = c.req.query('code')
  const stateToken = c.req.query('state')
  const state = stateToken ? verifyOAuthState(stateToken) : null
  const cookieName = state ? oauthNonceCookieName(state.attemptId) : null
  const cookieNonce = cookieName ? getCookie(c, cookieName) : undefined
  if (cookieName) deleteCookie(c, cookieName, oauthCookieClearOptions())

  if (error) {
    const configError = [
      'invalid_client',
      'invalid_request',
      'unauthorized_client',
      'redirect_uri_mismatch',
    ].includes(error)
    logEvent('warn', 'spotify.callback_rejected', {
      reason: 'spotify_error',
      spotifyError: error,
    })
    return c.redirect(
      appUrl(
        configError
          ? '/settings?section=spotify&spotify=config'
          : error === 'access_denied'
            ? '/settings?section=spotify&spotify=denied'
            : '/settings?section=spotify&spotify=failed'
      )
    )
  }
  if (!code || !stateToken) {
    logEvent('warn', 'spotify.callback_rejected', {
      reason: !code ? 'missing_code' : 'missing_state',
    })
    return c.redirect(appUrl('/settings?section=spotify&spotify=invalid'))
  }

  if (
    !state ||
    state.kind !== 'spotify' ||
    state.flow !== 'connect' ||
    !state.userId ||
    !cookieNonce ||
    state.nonce !== cookieNonce
  ) {
    logEvent('warn', 'spotify.callback_rejected', {
      reason: !state
        ? 'invalid_state'
        : state.kind !== 'spotify'
          ? 'wrong_state_kind'
          : state.flow !== 'connect'
            ? 'wrong_flow'
            : !state.userId
              ? 'missing_user'
              : !cookieNonce
                ? 'missing_nonce_cookie'
                : 'nonce_mismatch',
      hasState: Boolean(state),
      hasNonceCookie: Boolean(cookieNonce),
      callbackHost: c.req.header('host') || null,
      forwardedHost: c.req.header('x-forwarded-host') || null,
    })
    return c.redirect(appUrl('/settings?section=spotify&spotify=state'))
  }

  let stage = 'token_exchange'
  try {
    const tokens = await exchangeSpotifyCode(code, fetch, spotifyConnectRedirectUri())

    stage = 'profile'
    const profile = await fetchSpotifyProfile(tokens.access_token)
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000)
    const metadata = { profile, connectedAt: new Date().toISOString() }
    const grantedScopes = parseSpotifyScopes(tokens.scope)
    const scopes = grantedScopes.length > 0 ? grantedScopes : SPOTIFY_SCOPES
    const missingScopes = tokens.scope ? missingSpotifyScopes(tokens.scope) : []

    stage = 'integration_upsert'
    await prisma.$transaction([
      prisma.integration.upsert({
        where: { userId_type: { userId: state.userId, type: 'spotify' } },
        update: {
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token || undefined,
          expiresAt,
          scopes: JSON.stringify(scopes),
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
          scopes: JSON.stringify(scopes),
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

    logEvent('info', 'spotify.connected', {
      userId: state.userId,
      missingScopes,
    })

    return c.redirect(appUrl('/settings?section=spotify&spotify=connected'))
  } catch (error) {
    const details = describeError(error)
    logEvent('error', 'spotify.connect_failed', {
      stage,
      userId: state.userId,
      error: details,
      ...(error instanceof SpotifyError
        ? {
            spotifyCode: error.code,
            spotifyStatus: error.status ?? null,
            spotifyEndpoint: error.endpoint ?? null,
            spotifyReason: error.spotifyReason ?? null,
          }
        : {}),
    })
    return c.redirect(
      appUrl(`/settings?section=spotify&spotify=${connectionErrorStatus(error)}`)
    )
  }
})

spotify.post('/token', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const forceRefresh = c.req.query('force') === '1'
  try {
    const accessToken = await getSpotifyAccessToken(userId, fetch, { forceRefresh })
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
    logEvent('error', 'spotify.token_failed', {
      stage: 'access_token',
      userId,
      error: describeError(error),
      ...(error instanceof SpotifyError
        ? {
            spotifyCode: error.code,
            spotifyStatus: error.status ?? null,
            spotifyEndpoint: error.endpoint ?? null,
            spotifyReason: error.spotifyReason ?? null,
          }
        : {}),
    })
    return errorResponse(c, code, message, spotifyErrorStatus(error))
  }
})

spotify.post('/refresh', authMiddleware, async (c) => {
  const userId = getUserId(c)
  try {
    const accessToken = await getSpotifyAccessToken(userId, fetch, { forceRefresh: true })
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
    logEvent('error', 'spotify.refresh_failed', {
      stage: 'profile',
      userId,
      error: describeError(error),
      ...(error instanceof SpotifyError
        ? {
            spotifyCode: error.code,
            spotifyStatus: error.status ?? null,
            spotifyEndpoint: error.endpoint ?? null,
            spotifyReason: error.spotifyReason ?? null,
          }
        : {}),
    })
    return errorResponse(c, 'REFRESH_FAILED', message, spotifyErrorStatus(error))
  }
})

spotify.post('/disconnect', authMiddleware, async (c) => {
  const userId = getUserId(c)
  await prisma.$transaction([
    prisma.integration.deleteMany({ where: { userId, type: 'spotify' } }),
    prisma.settings.upsert({
      where: { userId },
      update: {
        musicConnected: false,
        musicAccessToken: null,
        musicRefreshToken: null,
        musicTokenExpiresAt: null,
      },
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
    const playlists = await withSpotifyAccessToken(userId, (accessToken) =>
      fetchSpotifyPlaylists(accessToken)
    )
    return c.json({ success: true, data: { playlists, total: playlists.length } })
  } catch (error) {
    const code = error instanceof SpotifyError ? error.code : 'PLAYLISTS_FAILED'
    const message = error instanceof Error ? error.message : 'Não foi possível listar as playlists.'
    return errorResponse(c, code, message, spotifyErrorStatus(error))
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
    const tracks = await withSpotifyAccessToken(userId, (accessToken) =>
      fetchPlaylistTracks(accessToken, playlistId)
    )

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
    let skipped = 0
    const rows: Array<{
      userId: string
      title: string
      artist: string
      album?: string
      artworkUrl?: string
      durationMs: number | null
      sourceUrl: string
      provider: string
      providerId: string
      position: number
      addedBy: string
      status: string
      playedAt: null
    }> = []

    for (const track of tracks) {
      if (existingIds.has(track.id)) {
        skipped += 1
        continue
      }

      rows.push({
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
      })
      existingIds.add(track.id)
    }

    if (rows.length > 0) {
      await prisma.queueItem.createMany({ data: rows })
    }

    await prisma.settings.upsert({
      where: { userId },
      update: { musicProvider: 'spotify', musicConnected: true },
      create: { userId, musicProvider: 'spotify', musicConnected: true },
    })

    return c.json({
      success: true,
      data: { imported: rows.length, skipped, total: tracks.length, playlistId },
    })
  } catch (error) {
    const code = error instanceof SpotifyError ? error.code : 'IMPORT_FAILED'
    const message = error instanceof Error ? error.message : 'Não foi possível importar a playlist.'
    return errorResponse(c, code, message, spotifyErrorStatus(error))
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
    const tracks = await withSpotifyAccessToken(userId, (accessToken) =>
      searchSpotifyTracks(accessToken, query)
    )
    return c.json({ success: true, data: { tracks, total: tracks.length } })
  } catch (error) {
    const code = error instanceof SpotifyError ? error.code : 'SEARCH_FAILED'
    const message = error instanceof Error ? error.message : 'Não foi possível buscar no Spotify.'
    return errorResponse(c, code, message, spotifyErrorStatus(error))
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
    const track = await withSpotifyAccessToken(userId, (accessToken) =>
      fetchSpotifyTrack(accessToken, trackId)
    )
    return c.json({ success: true, data: track })
  } catch (error) {
    const code = error instanceof SpotifyError ? error.code : 'RESOLVE_FAILED'
    const message = error instanceof Error ? error.message : 'Não foi possível resolver a faixa.'
    return errorResponse(
      c,
      code,
      message,
      spotifyErrorStatus(error)
    )
  }
})

export default spotify
