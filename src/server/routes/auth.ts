/**
 * Autenticação 100% via Spotify OAuth 2.0.
 *
 * O PixTune não usa mais cadastro/login com email/senha.
 * O único ponto de entrada é o botão "Entrar com Spotify".
 *
 * Fluxo:
 * 1. Frontend chama POST /auth/spotify/connect-url
 * 2. Redirect para Spotify /authorize com state assinado (JWT)
 * 3. Spotify redireciona para /auth/spotify/callback com code
 * 4. Backend troca code por access_token + profile do Spotify
 * 5. Cria/sincroniza o usuário no banco (spotifyId, name, avatarUrl, email)
 * 6. Gera JWT da sessão PixTune + cookie HttpOnly
 * 7. Redireciona de volta ao frontend
 */

import { Hono } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import prisma from '../lib/prisma.js'
import {
  SPOTIFY_SCOPES,
  SpotifyError,
  buildSpotifyAuthUrl,
  exchangeSpotifyCode,
  fetchSpotifyProfile,
  getSpotifyConfig,
  isSpotifyConfigured,
  missingSpotifyScopes,
  parseSpotifyScopes,
} from '../services/spotify.js'
import { createSession, removeSession } from '../services/auth.js'
import { getSessionTokens, resolveSessionUser } from '../middleware/auth.js'
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

const auth = new Hono()

const SESSION_COOKIE = 'pixtune_token'

function redirectForSpotifyError(error: unknown): string {
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

function errorResponse(c: any, code: string, message: string, status: 400 | 401 | 404 | 409 | 422 | 502) {
  return c.json({ success: false, error: { code, message } }, status)
}

// ---------------------------------------------------------------
// Status de autenticação
// ---------------------------------------------------------------

auth.get('/me', async (c) => {
  if (getSessionTokens(c).length === 0) {
    return errorResponse(c, 'NOT_AUTHENTICATED', 'Não autenticado.', 401)
  }

  const user = await resolveSessionUser(c)
  if (!user) {
    return errorResponse(c, 'SESSION_EXPIRED', 'Sessão expirada.', 401)
  }

  return c.json({
    success: true,
    data: {
      user: {
        id: user.id,
        spotifyId: user.spotifyId,
        name: user.name ?? null,
        email: user.email,
        avatarUrl: user.avatarUrl ?? null,
      },
    },
  })
})

// ---------------------------------------------------------------
// OAuth Spotify
// ---------------------------------------------------------------

auth.post('/spotify/connect-url', async (c) => {
  if (!isSpotifyConfigured()) {
    return errorResponse(c, 'SPOTIFY_NOT_CONFIGURED', 'Spotify não configurado no servidor.', 400)
  }

  const { attemptId, nonce } = createOAuthAttempt()
  const startToken = signOAuthState({
    kind: 'spotify_start',
    flow: 'login',
    attemptId,
    nonce,
  })
  const config = getSpotifyConfig()!

  // Amarra o início do OAuth ao navegador via cookie nonce (anti-CSRF).
  // O nome inclui o attemptId para que tentativas simultâneas (duas abas,
  // duplo clique) tenham cookies independentes.
  setCookie(c, oauthNonceCookieName(attemptId), nonce, oauthCookieOptions())

  logEvent('info', 'auth.spotify_connect_url', {
    // Nunca registrar o state, o nonce ou o attemptId.
    origin: c.req.header('origin') || null,
    cookieSecure: isProduction(),
    redirectUri: config.redirectUri,
  })

  return c.json({
    success: true,
    data: {
      // URL relativa: o frontend usa o mesmo domínio da API (proxy do
      // Cloudflare Pages em produção ou proxy do Vite em desenvolvimento).
      // Isso mantém o cookie nonce em contexto first-party no Brave/Safari.
      url: `/api/auth/spotify/start?ct=${encodeURIComponent(startToken)}`,
      redirectUri: config.redirectUri,
    },
  })
})

auth.get('/spotify/start', (c) => {
  const startToken = c.req.query('ct')
  const state = startToken ? verifyOAuthState(startToken) : null
  const cookieName = state ? oauthNonceCookieName(state.attemptId) : null
  const cookieNonce = cookieName ? getCookie(c, cookieName) : undefined

  if (
    !state ||
    state.kind !== 'spotify_start' ||
    state.flow !== 'login' ||
    !cookieNonce ||
    state.nonce !== cookieNonce
  ) {
    logEvent('warn', 'auth.spotify_start_rejected', {
      reason: !state
        ? 'invalid_state'
        : state.kind !== 'spotify_start'
          ? 'wrong_state_kind'
          : state.flow !== 'login'
            ? 'wrong_flow'
            : !cookieNonce
              ? 'missing_nonce_cookie'
              : 'nonce_mismatch',
      hasState: Boolean(state),
      hasNonceCookie: Boolean(cookieNonce),
    })
    return c.redirect(appUrl('/login?spotify=invalid'))
  }
  if (!isSpotifyConfigured()) {
    return c.redirect(appUrl('/login?spotify=not_configured'))
  }

  const oauthState = signOAuthState({
    kind: 'spotify',
    flow: 'login',
    attemptId: state.attemptId,
    nonce: state.nonce,
  })
  return c.redirect(buildSpotifyAuthUrl({ state: oauthState }))
})

auth.get('/spotify/callback', async (c) => {
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
    logEvent('warn', 'auth.spotify_callback_rejected', {
      reason: 'spotify_error',
      spotifyError: error,
    })
    return c.redirect(
      appUrl(
        configError
          ? '/login?spotify=config'
          : error === 'access_denied'
            ? '/login?spotify=denied'
            : '/login?spotify=failed'
      )
    )
  }
  if (!code || !stateToken) {
    logEvent('warn', 'auth.spotify_callback_rejected', {
      reason: !code ? 'missing_code' : 'missing_state',
    })
    return c.redirect(appUrl('/login?spotify=invalid'))
  }

  if (
    !state ||
    state.kind !== 'spotify' ||
    state.flow !== 'login' ||
    !cookieNonce ||
    state.nonce !== cookieNonce
  ) {
    logEvent('warn', 'auth.spotify_callback_rejected', {
      reason: !state
        ? 'invalid_state'
        : state.kind !== 'spotify'
          ? 'wrong_state_kind'
          : state.flow !== 'login'
            ? 'wrong_flow'
            : !cookieNonce
              ? 'missing_nonce_cookie'
              : 'nonce_mismatch',
      hasState: Boolean(state),
      hasNonceCookie: Boolean(cookieNonce),
      callbackHost: c.req.header('host') || null,
      forwardedHost: c.req.header('x-forwarded-host') || null,
    })
    return c.redirect(appUrl('/login?spotify=state'))
  }

  let stage = 'token_exchange'
  try {
    const tokens = await exchangeSpotifyCode(code)

    stage = 'profile'
    const profile = await fetchSpotifyProfile(tokens.access_token)
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000)
    const grantedScopes = parseSpotifyScopes(tokens.scope)
    const scopes = grantedScopes.length > 0 ? grantedScopes : SPOTIFY_SCOPES
    const missingScopes = tokens.scope ? missingSpotifyScopes(tokens.scope) : []

    // Cria ou sincroniza o usuário no banco com dados do Spotify.
    stage = 'user_upsert'
    const user = await prisma.user.upsert({
      where: { spotifyId: profile.id },
      update: {
        name: profile.displayName || null,
        avatarUrl: profile.imageUrl || null,
        email: profile.email || null,
        updatedAt: new Date(),
      },
      create: {
        spotifyId: profile.id,
        name: profile.displayName || null,
        avatarUrl: profile.imageUrl || null,
        email: profile.email || null,
      },
    })

    // Armazena tokens do Spotify na integration e mantém o Settings coerente
    // (a UI de Configurações consulta os dois). A sessão PixTune só é criada
    // depois que usuário e integração foram persistidos com sucesso.
    stage = 'integration_upsert'
    await prisma.$transaction([
      prisma.integration.upsert({
        where: { userId_type: { userId: user.id, type: 'spotify' } },
        update: {
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token || undefined,
          expiresAt,
          scopes: JSON.stringify(scopes),
          isActive: true,
          metadata: JSON.stringify({
            profile,
            connectedAt: new Date().toISOString(),
          }),
        },
        create: {
          userId: user.id,
          type: 'spotify',
          name: 'Spotify',
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token || null,
          expiresAt,
          scopes: JSON.stringify(scopes),
          isActive: true,
          metadata: JSON.stringify({
            profile,
            connectedAt: new Date().toISOString(),
          }),
        },
      }),
      prisma.settings.upsert({
        where: { userId: user.id },
        update: { musicProvider: 'spotify', musicConnected: true },
        create: {
          userId: user.id,
          musicProvider: 'spotify',
          musicConnected: true,
        },
      }),
    ])

    // Cria sessão PixTune: o JWT é gravado em Session.token e enviado no
    // cookie HttpOnly. O mesmo token também funciona como Bearer.
    stage = 'session_create'
    const jwt = await createSession(user.id, 7)

    stage = 'cookie_set'
    setCookie(c, SESSION_COOKIE, jwt, oauthCookieOptions(7 * 24 * 60 * 60))

    logEvent('info', 'auth.login_success', {
      userId: user.id,
      missingScopes,
    })

    return c.redirect(appUrl('/dashboard'))
  } catch (error) {
    const details = describeError(error)
    logEvent('error', 'auth.login_failed', {
      stage,
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

    const status = stage === 'session_create' || stage === 'cookie_set'
      ? 'session'
      : redirectForSpotifyError(error)
    return c.redirect(appUrl(`/login?spotify=${status}`))
  }
})

// ---------------------------------------------------------------
// Logout
// ---------------------------------------------------------------

auth.post('/logout', async (c) => {
  const tokens = getSessionTokens(c)

  for (const token of tokens) {
    await removeSession(token)
  }

  deleteCookie(c, SESSION_COOKIE, oauthCookieClearOptions())
  logEvent('info', 'auth.logout', { sessionsRemoved: tokens.length })
  return c.json({ success: true })
})

export default auth
