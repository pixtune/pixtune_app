// Shared types between client and server

export type MusicProvider = 'demo' | 'youtube' | 'spotify' | 'local'

export interface Track {
  id: string
  title: string
  artist: string
  album?: string
  artworkUrl?: string
  durationMs?: number
  sourceUrl?: string
  provider: MusicProvider
  providerId?: string
}

export interface QueueItem extends Track {
  position: number
  addedBy: 'streamer' | 'donation' | 'demo'
  donationEventId?: string
  status: 'pending' | 'playing' | 'played' | 'skipped' | 'failed'
  playedAt?: Date | null
}

export interface DonationEvent {
  id: string
  livepixEventId: string
  donorName: string
  donorMessage?: string
  amountCents: number
  currency: string
  status: 'received' | 'validated' | 'processed' | 'failed' | 'duplicate'
  matchedRuleId?: string
  errorMessage?: string
  processedAt?: Date | null
  isDemo: boolean
  createdAt: Date
}

export interface DonationRule {
  id: string
  name: string
  description?: string
  minAmount: number
  maxAmount?: number
  keywords: string[]
  action: DonationAction
  actionData: Record<string, unknown>
  cooldownMs: number
  maxPerHour: number
  isActive: boolean
  priority: number
}

export type DonationAction =
  | 'add_to_queue'
  | 'play_next'
  | 'skip'
  | 'pause'
  | 'resume'
  | 'volume_up'
  | 'volume_down'
  | 'shuffle'

export interface UserSettings {
  livepixConnected: boolean
  musicProvider: MusicProvider
  musicConnected: boolean
  autoPlay: boolean
  defaultVolume: number
  crossfade: boolean
  theme: 'dark' | 'light' | 'system'
  compactMode: boolean
}

export interface LivePixConfig {
  clientId: string
  clientSecret: string
  webhookSecret?: string
}

export interface MusicProviderConfig {
  provider: MusicProvider
  accessToken?: string
  refreshToken?: string
  expiresAt?: number
}

export interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: {
    code: string
    message: string
    details?: unknown
  }
}

export interface PaginatedResponse<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
  hasMore: boolean
}

export type ConnectionStatus = 'connected' | 'disconnected' | 'connecting' | 'error'

export interface ConnectionState {
  livepix: ConnectionStatus
  music: ConnectionStatus
}