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
 * O cookie é host-only (sem Domain). Em produção usa SameSite=None + Secure
 * porque o retorno do Spotify (accounts.spotify.com → pages.dev) é uma
 * navegação cross-site. SameSite=Lax *deveria* permitir top-level GET, mas
 * navegadores com proteções agressivas (Safari ITP, Brave Shields) ainda
 * podem bloquear. O cookie é de uso único, HttpOnly, curta duração (10 min)
 * e só existe durante o handshake OAuth — risco mínimo.
 * Em desenvolvimento usa SameSite=Lax (HTTP localhost).
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
  const secure = isProduction()
  // SameSite=None + Secure é necessário em produção porque o callback do
  // Spotify é uma navegação cross-site (accounts.spotify.com → pages.dev).
  // SameSite=Lax *deveria* permitir top-level GET, mas navegadores com
  // proteções agressivas (Safari ITP, Brave Shields) ainda bloqueiam.
  // O cookie é de uso único (attemptId), HttpOnly, curta duração (10 min)
  // e só existe durante o handshake OAuth — risco mínimo.
  return {
    httpOnly: true,
    sameSite: secure ? ('None' as const) : ('Lax' as const),
    path: '/',
    maxAge,
    secure,
    // Host-only: não define Domain. O cookie é gravado no domínio do
    // Cloudflare Pages (via proxy) e lido no callback no mesmo host.
  }
}

export function oauthCookieClearOptions() {
  const secure = isProduction()
  return {
    path: '/',
    secure,
    sameSite: secure ? ('None' as const) : ('Lax' as const),
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
