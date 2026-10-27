/**
 * Cliente de API PixTune
 * Conecta o frontend ao backend real via HTTP.
 * Nenhum dado mockado - tudo vem do servidor.
 */

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001'

/** URL base da API, exposta para diagnósticos e integrações. */
export const API_BASE_URL = API_URL

interface ApiError extends Error {
  status?: number
  code?: string
  details?: unknown
}

async function request<T = unknown>(
  path: string,
  options: RequestInit = {}
): Promise<{ success: boolean; data?: T; error?: { code: string; message: string; details?: unknown } }> {
  const url = `${API_URL}${path}`
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (options.headers) {
    new Headers(options.headers).forEach((value, key) => {
      headers[key] = value
    })
  }

  // Adicionar token de autenticação se disponível
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('pixtune_token') : null
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const res = await fetch(url, {
    // Necessário para o cookie HttpOnly do OAuth do Spotify entre a web e a API.
    credentials: 'include',
    ...options,
    headers,
  })

  let body: any
  try {
    body = await res.json()
  } catch {
    body = {}
  }

  if (!res.ok) {
    const error: ApiError = new Error(body?.error?.message || `Request failed: ${res.status}`)
    error.status = res.status
    error.code = body?.error?.code
    error.details = body?.error?.details
    throw error
  }

  return body as { success: boolean; data?: T; error?: { code: string; message: string; details?: unknown } }
}

// ============================================================
// Auth — apenas Entrar com Spotify
// ============================================================

export interface SpotifyUser {
  id: string
  spotifyId: string
  name?: string | null
  email?: string | null
  avatarUrl?: string | null
}

export const apiAuth = {
  /** Inicia o fluxo OAuth do Spotify e retorna a URL de autorização. */
  connectUrl: () =>
    request<{ url: string; redirectUri: string }>('/api/auth/spotify/connect-url', {
      method: 'POST',
    }),

  /** Recupera o usuário da sessão atual (cookie HttpOnly ou Authorization Bearer). */
  me: () => request<{ user: SpotifyUser }>('/api/auth/me'),

  /** Encerra a sessão. */
  logout: () => request('/api/auth/logout', { method: 'POST' }),
}

/** Redireciona o navegador para a tela de autorização do Spotify. */
export function spotifyLogin() {
  apiAuth.connectUrl().then((res) => {
    if (res.success && res.data?.url) {
      window.location.href = res.data.url
    } else {
      console.error(res.error?.message || 'Não foi possível iniciar a conexão com o Spotify.')
    }
  })
}

// ============================================================
// Donations
// ============================================================

export interface DonationQueueItem {
  id: string
  title: string
  artist?: string
  provider: string
  providerId?: string
  sourceUrl?: string
  artworkUrl?: string
  status: string
}

export interface DonationEvent {
  id: string
  livepixEventId: string
  donorName: string
  donorMessage?: string
  amountCents: number
  currency: string
  status: string
  matchedRuleId?: string
  matchedRuleName?: string
  matchedRuleAction?: string
  errorMessage?: string
  processedAt?: string
  isDemo: boolean
  createdAt: string
  queueItem?: DonationQueueItem | null
}

export interface LivePixConfig {
  clientId: string
  /** Em branco mantém o secret já salvo (o servidor nunca o devolve). */
  clientSecret?: string
  webhookUrl?: string
  webhookSecret?: string
}

export interface LivePixAccount {
  id: string
  username: string
  displayName?: string
}

export interface LivePixConfigStatus {
  configured: boolean
  connected: boolean
  account: LivePixAccount | null
  lastVerifiedAt: string | null
  clientId: string
  hasSecret: boolean
  provider?: string
  webhookUrl?: string
  webhookToken?: string
  webhookPath?: string
}

export interface LivePixActionResult {
  configured: boolean
  connected: boolean
  account: LivePixAccount | null
  lastVerifiedAt: string | null
  webhookToken?: string
  webhookPath?: string
  remoteWebhooksRemoved?: number
  warning?: string | null
}

export const apiDonations = {
  list: () => request<{ events: DonationEvent[]; total: number }>('/api/donations'),

  config: () => request<LivePixConfigStatus>('/api/donations/config'),

  saveConfig: (config: LivePixConfig) =>
    request<LivePixActionResult>('/api/donations/config', {
      method: 'POST',
      body: JSON.stringify(config),
    }),

  /** Revalida as credenciais agora, consultando a API do LivePix. */
  verifyConfig: () =>
    request<LivePixActionResult>('/api/donations/config/verify', { method: 'POST' }),

  /** Apaga credenciais/tokens e tenta remover o webhook no LivePix. */
  disconnectConfig: () =>
    request<LivePixActionResult>('/api/donations/config/disconnect', { method: 'POST' }),
}

// ============================================================
// Queue
// ============================================================

export interface QueueItem {
  id: string
  title: string
  artist?: string
  album?: string
  artworkUrl?: string
  durationMs?: number
  sourceUrl?: string
  provider: string
  providerId?: string
  position: number
  addedBy: 'streamer' | 'donation' | 'demo' | 'playlist'
  donationEventId?: string
  /** Valor da doação que define a prioridade. Itens manuais valem 0. */
  amountCents: number
  donorName?: string | null
  status: 'pending' | 'playing' | 'played' | 'skipped' | 'failed' | 'paused'
  playedAt?: string
  createdAt: string
}

export const apiQueue = {
  list: () => request<{ items: QueueItem[]; total: number }>('/api/queue'),

  add: (data: {
    title: string
    artist?: string
    album?: string
    artworkUrl?: string
    durationMs?: number
    sourceUrl?: string
    provider?: string
    providerId?: string
    position?: number
  }) =>
    request<QueueItem>('/api/queue', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  remove: (id: string) => request(`/api/queue/${id}`, { method: 'DELETE' }),

  reorder: (fromIndex: number, toIndex: number) =>
    request('/api/queue/reorder', {
      method: 'PATCH',
      body: JSON.stringify({ fromIndex, toIndex }),
    }),

  clear: () => request('/api/queue', { method: 'DELETE' }),

  shuffle: () => request('/api/queue/shuffle', { method: 'POST' }),

  next: () => request<{ track: QueueItem | null }>('/api/queue/next', { method: 'POST' }),

  previous: () => request<{ track: QueueItem | null }>('/api/queue/previous', { method: 'POST' }),

  attachLink: (id: string, url: string) =>
    request<QueueItem>(`/api/queue/${id}/link`, {
      method: 'PATCH',
      body: JSON.stringify({ url }),
    }),
}

// ============================================================
// Music
// ============================================================

export interface MusicTrack {
  id: string
  title: string
  artist?: string
  album?: string
  artworkUrl?: string
  durationMs?: number
  sourceUrl?: string
  provider: string
  providerId?: string
  amountCents?: number
  donorName?: string | null
  status?: 'pending' | 'playing' | 'played' | 'skipped' | 'failed' | 'paused'
}

export interface PlaybackStatus {
  isPlaying: boolean
  currentTrack: MusicTrack | null
  volume: number
  positionMs: number
  durationMs: number
  autoPlay: boolean
  hasPending: boolean
  pendingCount: number
}

export const apiMusic = {
  catalog: () => request<{ tracks: MusicTrack[]; total: number }>('/api/music/catalog'),

  status: () => request<PlaybackStatus>('/api/music/status'),

  play: (data?: { trackId?: string }) =>
    request<{ isPlaying: boolean; track?: MusicTrack | null; reason?: string }>('/api/music/play', {
      method: 'POST',
      body: JSON.stringify(data || {}),
    }),

  pause: () => request<{ isPlaying: boolean }>('/api/music/pause', { method: 'POST' }),

  next: () => request<{ skipped: boolean; track?: MusicTrack | null }>('/api/music/next-track', {
    method: 'POST',
  }),

  ended: () => request<{ track?: MusicTrack | null }>('/api/music/ended', {
    method: 'POST',
  }),

  duration: (trackId: string, durationMs: number) =>
    request<{ trackId: string; durationMs: number }>('/api/music/duration', {
      method: 'POST',
      body: JSON.stringify({ trackId, durationMs }),
    }),

  volume: (volume: number) =>
    request<{ volume: number }>('/api/music/volume', {
      method: 'POST',
      body: JSON.stringify({ volume }),
    }),
}

// ============================================================
// Rules
// ============================================================

export interface DonationRule {
  id: string
  name: string
  description?: string
  minAmount: number
  maxAmount?: number
  keywords: string[]
  action: string
  actionData: Record<string, unknown>
  cooldownMs: number
  maxPerHour: number
  isActive: boolean
  priority: number
  createdAt: string
  updatedAt: string
}

export const apiRules = {
  list: () => request<{ rules: DonationRule[]; total: number }>('/api/rules'),

  create: (data: {
    name: string
    description?: string
    minAmount: number
    maxAmount?: number
    keywords: string[]
    action: string
    actionData: Record<string, unknown>
    cooldownMs: number
    maxPerHour: number
    isActive: boolean
    priority: number
  }) =>
    request<DonationRule>('/api/rules', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (id: string, data: Partial<DonationRule>) =>
    request<DonationRule>(`/api/rules/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  remove: (id: string) => request(`/api/rules/${id}`, { method: 'DELETE' }),

  toggle: (id: string) =>
    request(`/api/rules/${id}/toggle`, { method: 'PATCH' }),
}

// ============================================================
// Settings
// ============================================================

export interface UserSettings {
  livepixConnected: boolean
  musicProvider: string
  musicConnected: boolean
  autoPlay: boolean
  defaultVolume: number
  crossfade: boolean
  theme: 'dark' | 'light' | 'system'
  compactMode: boolean
  songRequestEnabled: boolean
  songRequestMinAmount: number
  songRequestAction: 'add_to_queue' | 'play_next' | 'ignore'
  spotifyConfigured: boolean
}

export const apiSettings = {
  get: () => request<UserSettings>('/api/settings'),

  update: (data: Partial<UserSettings>) =>
    request<UserSettings>('/api/settings', {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
}

// ============================================================
// Spotify (OAuth + Web Playback SDK)
// ============================================================

export interface SpotifyProfile {
  id: string
  displayName: string
  email?: string
  imageUrl?: string
  product: string
  country?: string
}

export interface SpotifyStatus {
  configured: boolean
  redirectUri: string
  connected: boolean
  profile: SpotifyProfile | null
  premium: boolean
  connectedAt: string | null
  scopes: string[]
}

export interface SpotifyTrack {
  id: string
  uri: string
  title: string
  artist: string
  album?: string
  artworkUrl?: string
  durationMs: number
  sourceUrl: string
  isPlayable: boolean
}

export interface SpotifyPlaylist {
  id: string
  name: string
  description?: string
  imageUrl?: string
  trackCount: number
  owner?: string
  public?: boolean
  collaborative?: boolean
}

export const apiSpotify = {
  status: () => request<SpotifyStatus>('/api/spotify/status'),

  connectUrl: () =>
    request<{ url: string; redirectUri: string }>('/api/spotify/connect-url', {
      method: 'POST',
    }),

  token: () =>
    request<{ accessToken: string; expiresAt: string | null }>('/api/spotify/token', {
      method: 'POST',
    }),

  refresh: () =>
    request<{ profile: SpotifyProfile }>('/api/spotify/refresh', { method: 'POST' }),

  disconnect: () => request('/api/spotify/disconnect', { method: 'POST' }),

  playlists: () =>
    request<{ playlists: SpotifyPlaylist[]; total: number }>('/api/spotify/playlists'),

  importPlaylist: (playlistId: string) =>
    request<{ imported: number; skipped: number; total: number; playlistId: string }>(
      `/api/spotify/playlists/${encodeURIComponent(playlistId)}/import`,
      { method: 'POST' }
    ),

  search: (query: string) =>
    request<{ tracks: SpotifyTrack[]; total: number }>(
      `/api/spotify/search?q=${encodeURIComponent(query)}`
    ),

  resolve: (url: string) =>
    request<SpotifyTrack>('/api/spotify/resolve', {
      method: 'POST',
      body: JSON.stringify({ url }),
    }),
}

