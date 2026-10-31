/**
 * Peças compartilhadas dos dois fluxos OAuth do Spotify:
 * - login (`/api/auth/spotify/*`)
 * - conexão da conta (`/api/spotify/*`)
 *
 * Segurança do state:
 * - o `state` é um JWT assinado com validade curta;
 * - cada tentativa tem um `attemptId` aleatório e um nonce próprio;
 * - o nonce fica em um cookie HttpOnly com nome derivado do `attemptId`.
 *
 * O nome por tentativa é importante: com um único cookie compartilhado,
 * abrir duas abas (ou clicar duas vezes) sobrescrevia o nonce da primeira
 * tentativa e o callback falhava com "state"/"invalid". Cada tentativa agora
 * tem seu próprio cookie, então tentativas simultâneas não se atrapalham.
 *
 * O cookie é host-only (sem Domain), SameSite=Lax e Secure em produção. O
 * callback precisa acontecer no mesmo domínio em que o cookie foi gravado —
 * por isso o redirect_uri é sempre resolvido para o domínio do APP_URL e o
 * Cloudflare Pages faz proxy de /api para o Render. SameSite=None não é
 * necessário: o retorno do Spotify é uma navegação top-level GET.
 */

import crypto from 'crypto'
import { signJwt, verifyJwt } from './jwt.js'

export const OAUTH_COOKIE_PREFIX = 'pixtune_oauth_'
const ATTEMPT_ID_PATTERN = /^[a-f0-9]{32}$/

export type SpotifyOAuthFlow = 'login' | 'connect'
export type SpotifyOAuthKind = 'spotify_start' | 'spotify'

export interface SpotifyOAuthAttempt {
  attemptId: string
  nonce: string
}

export interface SpotifyOAuthState {
  kind: SpotifyOAuthKind
  flow: SpotifyOAuthFlow
  attemptId: string
  nonce: string
  userId?: string
}

export function createOAuthAttempt(): SpotifyOAuthAttempt {
  return {
    attemptId: crypto.randomBytes(16).toString('hex'),
    nonce: crypto.randomBytes(16).toString('hex'),
  }
}

export function oauthNonceCookieName(attemptId: string): string {
  return `${OAUTH_COOKIE_PREFIX}${attemptId}`
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production'
}

export function oauthCookieOptions(maxAge = 600) {
  return {
    httpOnly: true,
    sameSite: 'Lax' as const,
    path: '/',
    maxAge,
    secure: isProduction(),
    // Host-only: não define Domain. O cookie precisa ser enviado exatamente
    // ao host que atende /api (Pages em produção, localhost em dev).
  }
}

export function oauthCookieClearOptions() {
  return {
    path: '/',
    secure: isProduction(),
    sameSite: 'Lax' as const,
  }
}

export function appUrl(path: string): string {
  const base = (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '')
  return `${base}${path}`
}

export function signOAuthState(payload: SpotifyOAuthState, expiresIn = '10m'): string {
  return signJwt(payload as unknown as Record<string, unknown>, expiresIn)
}

export function verifyOAuthState(token: string): SpotifyOAuthState | null {
  const decoded = verifyJwt<Partial<SpotifyOAuthState>>(token)
  if (!decoded) return null

  if (decoded.kind !== 'spotify_start' && decoded.kind !== 'spotify') return null
  if (decoded.flow !== 'login' && decoded.flow !== 'connect') return null
  if (typeof decoded.attemptId !== 'string' || !ATTEMPT_ID_PATTERN.test(decoded.attemptId)) {
    return null
  }
  if (typeof decoded.nonce !== 'string' || !decoded.nonce) return null
  if (decoded.userId !== undefined && typeof decoded.userId !== 'string') return null

  return {
    kind: decoded.kind,
    flow: decoded.flow,
    attemptId: decoded.attemptId,
    nonce: decoded.nonce,
    ...(decoded.userId ? { userId: decoded.userId } : {}),
  }
}
