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

import crypto from 'crypto'
import JWT from 'jsonwebtoken'
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

const auth = new Hono()

const OAUTH_NONCE_COOKIE = 'pixtune_spotify_nonce'
const SESSION_COOKIE = 'pixtune_token'
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

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production'
}

function cookieOptions(maxAge = 600) {
  // Em produção o frontend e a API podem estar em domínios distintos. Nesse
  // caso o cookie precisa ser SameSite=None + Secure para ser enviado nos
  // fetch() com credentials: 'include'. Em desenvolvimento local usamos Lax
  // para o cookie funcionar em http://localhost.
  const secure = isProduction()
  return {
    httpOnly: true,
    sameSite: (secure ? 'None' : 'Lax') as 'None' | 'Lax',
    path: '/',
    maxAge,
    secure,
  }
}

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

  const nonce = createNonce()
  const startToken = signState({ kind: 'spotify_start', nonce })
  const config = getSpotifyConfig()!

  // Amarra o início do OAuth ao navegador via cookie nonce (anti-CSRF).
  setCookie(c, OAUTH_NONCE_COOKIE, nonce, cookieOptions())

  logEvent('info', 'auth.spotify_connect_url', {
    origin: c.req.header('origin') || null,
    cookieSecure: isProduction(),
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
  const state = startToken ? verifyState(startToken) : null
  const cookieNonce = getCookie(c, OAUTH_NONCE_COOKIE)

  if (!state || state.kind !== 'spotify_start' || !cookieNonce || state.nonce !== cookieNonce) {
    logEvent('warn', 'auth.spotify_start_rejected', {
      reason: !state
        ? 'invalid_state'
        : state.kind !== 'spotify_start'
          ? 'wrong_state_kind'
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

  const oauthState = signState({ kind: 'spotify', nonce: state.nonce })
  return c.redirect(buildSpotifyAuthUrl({ state: oauthState }))
})

auth.get('/spotify/callback', async (c) => {
  const error = c.req.query('error')
  const code = c.req.query('code')
  const stateToken = c.req.query('state')
  const cookieNonce = getCookie(c, OAUTH_NONCE_COOKIE)
  deleteCookie(c, OAUTH_NONCE_COOKIE, { path: '/' })

  if (error) {
    logEvent('warn', 'auth.spotify_callback_rejected', {
      reason: 'spotify_error',
      spotifyError: error,
    })
    return c.redirect(appUrl('/login?spotify=denied'))
  }
  if (!code || !stateToken) {
    logEvent('warn', 'auth.spotify_callback_rejected', {
      reason: !code ? 'missing_code' : 'missing_state',
    })
    return c.redirect(appUrl('/login?spotify=invalid'))
  }

  const state = verifyState(stateToken)
  if (!state || state.kind !== 'spotify' || !cookieNonce || state.nonce !== cookieNonce) {
    logEvent('warn', 'auth.spotify_callback_rejected', {
      reason: !state
        ? 'invalid_state'
        : state.kind !== 'spotify'
          ? 'wrong_state_kind'
          : !cookieNonce
            ? 'missing_nonce_cookie'
            : 'nonce_mismatch',
      hasState: Boolean(state),
      hasNonceCookie: Boolean(cookieNonce),
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

    // Armazena tokens do Spotify na integration. A sessão PixTune só é criada
    // depois que usuário e integração foram persistidos com sucesso.
    stage = 'integration_upsert'
    await prisma.integration.upsert({
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
    })

    // Cria sessão PixTune: o JWT é gravado em Session.token e enviado no
    // cookie HttpOnly. O mesmo token também funciona como Bearer.
    stage = 'session_create'
    const jwt = await createSession(user.id, 7)

    stage = 'cookie_set'
    setCookie(c, SESSION_COOKIE, jwt, cookieOptions(7 * 24 * 60 * 60))

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

  deleteCookie(c, SESSION_COOKIE, { path: '/' })
  logEvent('info', 'auth.logout', { sessionsRemoved: tokens.length })
  return c.json({ success: true })
})

export default auth
