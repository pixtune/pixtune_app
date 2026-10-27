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
import prisma from '../lib/prisma'
import {
  SPOTIFY_SCOPES,
  buildSpotifyAuthUrl,
  exchangeSpotifyCode,
  fetchSpotifyProfile,
  getSpotifyConfig,
  isSpotifyConfigured,
  SpotifyError,
  type SpotifyProfile,
} from '../services/spotify'

const auth = new Hono()

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

function errorResponse(c: any, code: string, message: string, status: 400 | 401 | 404 | 409 | 422 | 502) {
  return c.json({ success: false, error: { code, message } }, status)
}

// ---------------------------------------------------------------
// Status de autenticação
// ---------------------------------------------------------------

auth.get('/me', async (c) => {
  const sessionToken = c.req.header('Authorization')?.replace('Bearer ', '')
  if (!sessionToken) {
    return errorResponse(c, 'NOT_AUTHENTICATED', 'Não autenticado.', 401)
  }

  const session = await prisma.session.findUnique({
    where: { token: sessionToken },
    include: { user: true },
  })

  if (!session || session.expiresAt < new Date()) {
    if (session) {
      await prisma.session.delete({ where: { id: session.id } })
    }
    return errorResponse(c, 'SESSION_EXPIRED', 'Sessão expirada.', 401)
  }

  return c.json({
    success: true,
    data: {
      user: {
        id: session.user.id,
        spotifyId: session.user.spotifyId,
        name: session.user.name,
        email: session.user.email,
        avatarUrl: session.user.avatarUrl,
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

  return c.json({
    success: true,
    data: {
      url: `${config.apiUrl}/api/auth/spotify/start?ct=${encodeURIComponent(startToken)}`,
      redirectUri: config.redirectUri,
    },
  })
})

auth.get('/spotify/start', (c) => {
  const startToken = c.req.query('ct')
  const state = startToken ? verifyState(startToken) : null
  const cookieNonce = getCookie(c, OAUTH_NONCE_COOKIE)

  if (!state || state.kind !== 'spotify_start' || !cookieNonce || state.nonce !== cookieNonce) {
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

  if (error) return c.redirect(appUrl('/login?spotify=denied'))
  if (!code || !stateToken) {
    return c.redirect(appUrl('/login?spotify=invalid'))
  }

  const state = verifyState(stateToken)
  if (!state || state.kind !== 'spotify' || !cookieNonce || state.nonce !== cookieNonce) {
    return c.redirect(appUrl('/login?spotify=state'))
  }

  try {
    const tokens = await exchangeSpotifyCode(code)
    const profile = await fetchSpotifyProfile(tokens.access_token)
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000)

    // Cria ou sincroniza o usuário no banco com dados do Spotify
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

    // Armazena tokens do Spotify na integration
    await prisma.integration.upsert({
      where: { userId_type: { userId: user.id, type: 'spotify' } },
      update: {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || undefined,
        expiresAt,
        scopes: JSON.stringify(SPOTIFY_SCOPES),
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
        scopes: JSON.stringify(SPOTIFY_SCOPES),
        isActive: true,
        metadata: JSON.stringify({
          profile,
          connectedAt: new Date().toISOString(),
        }),
      },
    })

    // Cria sessão PixTune
    const sessionToken = crypto.randomBytes(32).toString('hex')
    const sessionExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 dias

    await prisma.session.create({
      data: {
        token: sessionToken,
        userId: user.id,
        expiresAt: sessionExpiresAt,
      },
    })

    // Cookie HttpOnly anti-CSRF + JWT
    const jwt = JWT.sign({ userId: user.id, sessionToken }, JWT_SECRET, {
      expiresIn: '7d',
    })

    setCookie(c, 'pixtune_token', jwt, {
      ...cookieOptions(),
      maxAge: 7 * 24 * 60 * 60,
    })

    return c.redirect(appUrl('/dashboard'))
  } catch {
    return c.redirect(appUrl('/login?spotify=failed'))
  }
})

// ---------------------------------------------------------------
// Logout
// ---------------------------------------------------------------

auth.post('/logout', async (c) => {
  const token = c.req.header('Authorization')?.replace('Bearer ', '') ||
    c.req.cookie('pixtune_token')

  if (token) {
    const session = await prisma.session.findUnique({ where: { token } })
    if (session) {
      await prisma.session.delete({ where: { id: session.id } })
    }
  }

  deleteCookie(c, 'pixtune_token', { path: '/' })
  return c.json({ success: true })
})

export default auth
