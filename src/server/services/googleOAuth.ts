/**
 * OAuth 2.0 / OpenID Connect com o Google.
 *
 * Dois usos, ambos oficiais e documentados:
 *  - Login no PixTune (OpenID Connect: openid, email, profile).
 *  - Conexão do canal do YouTube (YouTube Data API v3: youtube.readonly).
 *
 * Nenhum download, extração ou reprodução de áudio acontece aqui. A
 * conexão do YouTube apenas autoriza a leitura de dados públicos do canal
 * (nome, avatar, inscritos). O player continua usando a IFrame Player API
 * oficial e não é alterado por este login.
 *
 * Toda a configuração (Client ID/Secret) fica no servidor (.env). Nada é
 * enviado ao navegador além da URL de autorização.
 */

import crypto from 'crypto'
import JWT from 'jsonwebtoken'

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-change-in-production'

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo'
const YOUTUBE_CHANNELS_URL = 'https://www.googleapis.com/youtube/v3/channels'

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

/** Escopos para login (identidade apenas). */
export const GOOGLE_LOGIN_SCOPES = ['openid', 'email', 'profile']

/**
 * Escopos para conectar o canal do YouTube.
 * `youtube.readonly` é um escopo sensível: em produção o Google exige
 * verificação do app; em modo de teste apenas usuários de teste autorizam.
 */
export const YOUTUBE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/youtube.readonly',
]

export interface GoogleOAuthConfig {
  clientId: string
  clientSecret: string
  apiUrl: string
  appUrl: string
}

/** Lê a configuração do .env. Aceita GOOGLE_* ou YOUTUBE_* como nomes. */
export function getGoogleOAuthConfig(): GoogleOAuthConfig | null {
  const clientId = (process.env.GOOGLE_CLIENT_ID || process.env.YOUTUBE_CLIENT_ID || '').trim()
  const clientSecret = (
    process.env.GOOGLE_CLIENT_SECRET ||
    process.env.YOUTUBE_CLIENT_SECRET ||
    ''
  ).trim()

  if (!clientId || !clientSecret) return null

  return {
    clientId,
    clientSecret,
    apiUrl: (process.env.API_URL || 'http://localhost:3001')
      .replace(/\/+$/, '')
      .replace(/\/api$/, ''),
    appUrl: (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, ''),
  }
}

export function isGoogleOAuthConfigured(): boolean {
  return getGoogleOAuthConfig() !== null
}

/**
 * URL de callback registrada no Google Cloud. Precisa bater exatamente com
 * uma das "URIs de redirecionamento autorizados" do OAuth Client.
 */
export function googleRedirectUri(kind: 'login' | 'youtube'): string {
  const base = getGoogleOAuthConfig()?.apiUrl || 'http://localhost:3001'
  return kind === 'login'
    ? `${base}/api/auth/google/callback`
    : `${base}/api/youtube/callback`
}

// ---------------------------------------------------------------
// State (proteção CSRF)
// ---------------------------------------------------------------

export type OAuthStateKind = 'login' | 'youtube_start' | 'youtube'

export interface OAuthState {
  kind: OAuthStateKind
  nonce: string
  userId?: string
}

export function createNonce(): string {
  return crypto.randomBytes(16).toString('hex')
}

export function signOAuthState(payload: OAuthState): string {
  return JWT.sign(payload, JWT_SECRET, { expiresIn: '10m' })
}

export function verifyOAuthState(token: string): OAuthState | null {
  try {
    const decoded = JWT.verify(token, JWT_SECRET)
    if (!decoded || typeof decoded === 'string') return null
    const state = decoded as OAuthState
    if (!state.kind || !state.nonce) return null
    return state
  } catch {
    return null
  }
}

// ---------------------------------------------------------------
// Fluxo de autorização
// ---------------------------------------------------------------

export function buildGoogleAuthUrl(options: {
  kind: 'login' | 'youtube'
  state: string
  scopes: string[]
  prompt?: string
  loginHint?: string
}): string {
  const config = getGoogleOAuthConfig()
  if (!config) throw new GoogleOAuthError('OAuth do Google não configurado.', 'NOT_CONFIGURED')

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: googleRedirectUri(options.kind),
    response_type: 'code',
    scope: options.scopes.join(' '),
    state: options.state,
    access_type: 'offline',
    include_granted_scopes: 'true',
  })
  if (options.prompt) params.set('prompt', options.prompt)
  if (options.loginHint) params.set('login_hint', options.loginHint)

  return `${GOOGLE_AUTH_URL}?${params.toString()}`
}

export class GoogleOAuthError extends Error {
  constructor(message: string, readonly code: string) {
    super(message)
    this.name = 'GoogleOAuthError'
  }
}

export interface GoogleTokenResponse {
  access_token: string
  expires_in: number
  refresh_token?: string
  scope?: string
  token_type?: string
  id_token?: string
}

export async function exchangeGoogleCode(
  code: string,
  kind: 'login' | 'youtube',
  fetchImpl: FetchLike = fetch
): Promise<GoogleTokenResponse> {
  const config = getGoogleOAuthConfig()
  if (!config) throw new GoogleOAuthError('OAuth do Google não configurado.', 'NOT_CONFIGURED')

  const body = new URLSearchParams({
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: googleRedirectUri(kind),
    grant_type: 'authorization_code',
  })

  const res = await fetchImpl(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(10000),
  })

  const data = (await res.json().catch(() => ({}))) as Partial<GoogleTokenResponse> & {
    error?: string
    error_description?: string
  }

  if (!res.ok || !data.access_token) {
    throw new GoogleOAuthError(
      data.error_description || data.error || `Google respondeu ${res.status}`,
      'TOKEN_EXCHANGE_FAILED'
    )
  }

  return data as GoogleTokenResponse
}

export async function refreshGoogleToken(
  refreshToken: string,
  fetchImpl: FetchLike = fetch
): Promise<GoogleTokenResponse> {
  const config = getGoogleOAuthConfig()
  if (!config) throw new GoogleOAuthError('OAuth do Google não configurado.', 'NOT_CONFIGURED')

  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  })

  const res = await fetchImpl(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(10000),
  })

  const data = (await res.json().catch(() => ({}))) as Partial<GoogleTokenResponse> & {
    error?: string
    error_description?: string
  }

  if (!res.ok || !data.access_token) {
    throw new GoogleOAuthError(
      data.error_description || data.error || `Google respondeu ${res.status}`,
      'REFRESH_FAILED'
    )
  }

  return data as GoogleTokenResponse
}

// ---------------------------------------------------------------
// Dados do usuário e do canal
// ---------------------------------------------------------------

export interface GoogleUserInfo {
  sub: string
  email: string
  email_verified?: boolean
  name?: string
  picture?: string
}

export async function fetchGoogleUserInfo(
  accessToken: string,
  fetchImpl: FetchLike = fetch
): Promise<GoogleUserInfo> {
  const res = await fetchImpl(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10000),
  })

  const data = (await res.json().catch(() => ({}))) as GoogleUserInfo & { error?: string }
  if (!res.ok || !data.email) {
    throw new GoogleOAuthError(data.error || 'Não foi possível ler o perfil Google.', 'USERINFO_FAILED')
  }
  return data
}

export interface YouTubeChannelInfo {
  id: string
  title: string
  description?: string
  customUrl?: string
  thumbnailUrl?: string
  subscriberCount?: number
  videoCount?: number
  viewCount?: number
}

interface YouTubeChannelApiItem {
  id: string
  snippet?: {
    title?: string
    description?: string
    customUrl?: string
    thumbnails?: { high?: { url?: string }; medium?: { url?: string }; default?: { url?: string } }
  }
  statistics?: { subscriberCount?: string; videoCount?: string; viewCount?: string }
}

function toNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

/** Lista o canal do próprio usuário autorizado (mine=true). */
export async function fetchYouTubeChannel(
  accessToken: string,
  fetchImpl: FetchLike = fetch
): Promise<YouTubeChannelInfo | null> {
  const url = `${YOUTUBE_CHANNELS_URL}?part=snippet,statistics&mine=true`
  const res = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10000),
  })

  if (!res.ok) {
    throw new GoogleOAuthError(
      `YouTube respondeu ${res.status}`,
      res.status === 401 || res.status === 403 ? 'YOUTUBE_FORBIDDEN' : 'YOUTUBE_FAILED'
    )
  }

  const data = (await res.json().catch(() => ({}))) as { items?: YouTubeChannelApiItem[] }
  const item = data.items?.[0]
  if (!item) return null

  const thumbs = item.snippet?.thumbnails
  return {
    id: item.id,
    title: item.snippet?.title || 'Canal do YouTube',
    description: item.snippet?.description,
    customUrl: item.snippet?.customUrl,
    thumbnailUrl: thumbs?.high?.url || thumbs?.medium?.url || thumbs?.default?.url,
    subscriberCount: toNumber(item.statistics?.subscriberCount),
    videoCount: toNumber(item.statistics?.videoCount),
    viewCount: toNumber(item.statistics?.viewCount),
  }
}
