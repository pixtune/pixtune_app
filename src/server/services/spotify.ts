/**
 * Integração oficial com o Spotify.
 *
 * - OAuth 2.0 Authorization Code (client secret) para conectar a conta.
 * - Web API para perfil, playlists, busca e metadados de faixas.
 * - A reprodução em si acontece no navegador pelo Web Playback SDK oficial.
 *
 * Nenhum áudio é baixado, extraído ou contornado. Tokens de acesso ficam
 * apenas no servidor; o navegador recebe um access token de curta duração
 * porque o Web Playback SDK exige isso para registrar o dispositivo.
 */

import prisma from '../lib/prisma'
import { spotifyTrackUrl, spotifyTrackUri } from '../../shared/spotify'

const SPOTIFY_AUTH_URL = 'https://accounts.spotify.com/authorize'
const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token'
const SPOTIFY_API_BASE = 'https://api.spotify.com/v1'

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export const SPOTIFY_SCOPES = [
  'streaming',
  'user-read-email',
  'user-read-private',
  'user-read-playback-state',
  'user-modify-playback-state',
  'playlist-read-private',
  'playlist-read-collaborative',
]

export interface SpotifyConfig {
  clientId: string
  clientSecret: string
  apiUrl: string
  appUrl: string
  redirectUri: string
}

export function getSpotifyConfig(): SpotifyConfig | null {
  const clientId = (process.env.SPOTIFY_CLIENT_ID || '').trim()
  const clientSecret = (process.env.SPOTIFY_CLIENT_SECRET || '').trim()
  if (!clientId || !clientSecret) return null

  const apiUrl = (process.env.API_URL || 'http://localhost:3001').replace(/\/$/, '')
  const appUrl = (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '')
  const redirectUri = (
    process.env.SPOTIFY_REDIRECT_URI || `${apiUrl}/api/auth/spotify/callback`
  ).trim()

  return { clientId, clientSecret, apiUrl, appUrl, redirectUri }
}

export function isSpotifyConfigured(): boolean {
  return getSpotifyConfig() !== null
}

export function spotifyRedirectUri(): string {
  return getSpotifyConfig()?.redirectUri || 'http://localhost:3001/api/spotify/callback'
}

export function buildSpotifyAuthUrl(options: {
  state: string
  showDialog?: boolean
}): string {
  const config = getSpotifyConfig()
  if (!config) throw new SpotifyError('Spotify não configurado.', 'NOT_CONFIGURED')

  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: 'code',
    redirect_uri: config.redirectUri,
    scope: SPOTIFY_SCOPES.join(' '),
    state: options.state,
  })
  if (options.showDialog) params.set('show_dialog', 'true')

  return `${SPOTIFY_AUTH_URL}?${params.toString()}`
}

export class SpotifyError extends Error {
  constructor(message: string, readonly code: string) {
    super(message)
    this.name = 'SpotifyError'
  }
}

export interface SpotifyTokenResponse {
  access_token: string
  token_type: string
  scope?: string
  expires_in: number
  refresh_token?: string
}

function basicAuth(config: SpotifyConfig): string {
  return Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')
}

export async function exchangeSpotifyCode(
  code: string,
  fetchImpl: FetchLike = fetch
): Promise<SpotifyTokenResponse> {
  const config = getSpotifyConfig()
  if (!config) throw new SpotifyError('Spotify não configurado.', 'NOT_CONFIGURED')

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.redirectUri,
  })

  const res = await fetchImpl(SPOTIFY_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth(config)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
    signal: AbortSignal.timeout(10000),
  })

  const data = (await res.json().catch(() => ({}))) as Partial<SpotifyTokenResponse> & {
    error?: string
    error_description?: string
  }

  if (!res.ok || !data.access_token) {
    throw new SpotifyError(
      data.error_description || data.error || `Spotify respondeu ${res.status}`,
      'TOKEN_EXCHANGE_FAILED'
    )
  }

  return data as SpotifyTokenResponse
}

export async function refreshSpotifyToken(
  refreshToken: string,
  fetchImpl: FetchLike = fetch
): Promise<SpotifyTokenResponse> {
  const config = getSpotifyConfig()
  if (!config) throw new SpotifyError('Spotify não configurado.', 'NOT_CONFIGURED')

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  })

  const res = await fetchImpl(SPOTIFY_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth(config)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
    signal: AbortSignal.timeout(10000),
  })

  const data = (await res.json().catch(() => ({}))) as Partial<SpotifyTokenResponse> & {
    error?: string
    error_description?: string
  }

  if (!res.ok || !data.access_token) {
    throw new SpotifyError(
      data.error_description || data.error || `Spotify respondeu ${res.status}`,
      'REFRESH_FAILED'
    )
  }

  return data as SpotifyTokenResponse
}

async function spotifyRequest<T>(
  path: string,
  accessToken: string,
  fetchImpl: FetchLike,
  init: RequestInit = {}
): Promise<T> {
  const res = await fetchImpl(`${SPOTIFY_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init.headers || {}),
    },
    signal: AbortSignal.timeout(10000),
  })

  const data = (await res.json().catch(() => ({}))) as T & {
    error?: { message?: string; status?: number }
  }

  if (!res.ok) {
    throw new SpotifyError(
      data?.error?.message || `Spotify respondeu ${res.status}`,
      res.status === 401 ? 'UNAUTHORIZED' : res.status === 404 ? 'NOT_FOUND' : 'SPOTIFY_FAILED'
    )
  }

  return data as T
}

// ---------------------------------------------------------------
// Perfil
// ---------------------------------------------------------------

export interface SpotifyProfile {
  id: string
  displayName: string
  email?: string
  imageUrl?: string
  product: string
  country?: string
}

export async function fetchSpotifyProfile(
  accessToken: string,
  fetchImpl: FetchLike = fetch
): Promise<SpotifyProfile> {
  const data = await spotifyRequest<{
    id: string
    display_name?: string
    email?: string
    images?: Array<{ url?: string }>
    product?: string
    country?: string
  }>('/me', accessToken, fetchImpl)

  return {
    id: data.id,
    displayName: data.display_name || 'Conta Spotify',
    email: data.email,
    imageUrl: data.images?.[0]?.url,
    product: data.product || 'unknown',
    country: data.country,
  }
}

// ---------------------------------------------------------------
// Faixas
// ---------------------------------------------------------------

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

export interface SpotifyApiTrack {
  id?: string | null
  name?: string
  uri?: string
  duration_ms?: number
  is_playable?: boolean
  external_urls?: { spotify?: string }
  artists?: Array<{ name?: string }>
  album?: {
    name?: string
    images?: Array<{ url?: string; width?: number; height?: number }>
  }
}

function largestImage(images?: Array<{ url?: string; width?: number; height?: number }>): string | undefined {
  if (!images?.length) return undefined
  return [...images].sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]?.url
}

export function normalizeSpotifyTrack(item: SpotifyApiTrack | null | undefined): SpotifyTrack | null {
  if (!item?.id) return null
  const artist = (item.artists || [])
    .map((value) => value.name)
    .filter(Boolean)
    .join(', ')

  return {
    id: item.id,
    uri: item.uri || spotifyTrackUri(item.id),
    title: item.name || 'Faixa do Spotify',
    artist: artist || 'Artista desconhecido',
    album: item.album?.name,
    artworkUrl: largestImage(item.album?.images),
    durationMs: item.duration_ms ?? 0,
    sourceUrl: item.external_urls?.spotify || spotifyTrackUrl(item.id),
    isPlayable: item.is_playable !== false,
  }
}

export async function fetchSpotifyTrack(
  accessToken: string,
  trackId: string,
  fetchImpl: FetchLike = fetch
): Promise<SpotifyTrack> {
  const data = await spotifyRequest<SpotifyApiTrack>(
    `/tracks/${encodeURIComponent(trackId)}`,
    accessToken,
    fetchImpl
  )
  const track = normalizeSpotifyTrack(data)
  if (!track) throw new SpotifyError('Faixa não encontrada no Spotify.', 'NOT_FOUND')
  return track
}

export function normalizeForMatch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

const LOW_QUALITY_MARKERS = ['karaoke', 'cover', 'tribute', 'made famous', 'instrumental']

/** Pontua um resultado da busca do Spotify contra o texto digitado. */
export function scoreSpotifyTrack(
  query: string,
  track: Pick<SpotifyTrack, 'title' | 'artist' | 'album'>
): number {
  const q = normalizeForMatch(query)
  const title = normalizeForMatch(track.title)
  const artist = normalizeForMatch(track.artist || '')
  const album = normalizeForMatch(track.album || '')

  if (!q || !title) return 0

  let score = 0
  if (title === q) score = 100
  else if (title.startsWith(`${q} `) || title.startsWith(`${q}(`) || title.startsWith(`${q}[`)) {
    score = 84
  } else if (q.startsWith(`${title} `) || q.startsWith(`${title}(`)) {
    score = 78
  } else if (q.includes(' ') && title.includes(q) && q.length >= 5) {
    score = 68
  } else if (q.length >= 4 && title.includes(q)) {
    score = 55
  }

  if (score === 0) return 0
  if (artist && q.includes(artist)) score += 8
  if (album && q.includes(album)) score += 2

  const titleAndAlbum = `${title} ${album}`
  if (LOW_QUALITY_MARKERS.some((marker) => titleAndAlbum.includes(marker))) score -= 30

  return Math.max(0, Math.min(100, score))
}

export async function searchSpotifyTracks(
  accessToken: string,
  query: string,
  fetchImpl: FetchLike = fetch,
  limit = 10
): Promise<SpotifyTrack[]> {
  const data = await spotifyRequest<{ tracks?: { items?: SpotifyApiTrack[] } }>(
    `/search?q=${encodeURIComponent(query)}&type=track&limit=${limit}`,
    accessToken,
    fetchImpl
  )

  return (data.tracks?.items || [])
    .map((item) => normalizeSpotifyTrack(item))
    .filter((item): item is SpotifyTrack => Boolean(item && item.isPlayable))
}

export async function searchSpotifyTrack(
  accessToken: string,
  query: string,
  fetchImpl: FetchLike = fetch
): Promise<SpotifyTrack | null> {
  const tracks = await searchSpotifyTracks(accessToken, query, fetchImpl)
  let best: { track: SpotifyTrack; score: number } | null = null

  for (const track of tracks) {
    const score = scoreSpotifyTrack(query, track)
    if (!best || score > best.score) best = { track, score }
  }

  return best && best.score >= 45 ? best.track : null
}

// ---------------------------------------------------------------
// Playlists
// ---------------------------------------------------------------

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

interface SpotifyApiPlaylist {
  id?: string
  name?: string
  description?: string | null
  images?: Array<{ url?: string; width?: number; height?: number }>
  tracks?: { total?: number }
  owner?: { display_name?: string }
  public?: boolean | null
  collaborative?: boolean
}

export function normalizeSpotifyPlaylist(
  item: SpotifyApiPlaylist | null | undefined
): SpotifyPlaylist | null {
  if (!item?.id) return null
  return {
    id: item.id,
    name: item.name || 'Playlist do Spotify',
    description: item.description || undefined,
    imageUrl: largestImage(item.images),
    trackCount: item.tracks?.total ?? 0,
    owner: item.owner?.display_name,
    public: item.public ?? undefined,
    collaborative: item.collaborative,
  }
}

export async function fetchSpotifyPlaylists(
  accessToken: string,
  fetchImpl: FetchLike = fetch
): Promise<SpotifyPlaylist[]> {
  const data = await spotifyRequest<{ items?: SpotifyApiPlaylist[] }>(
    '/me/playlists?limit=50&offset=0',
    accessToken,
    fetchImpl
  )

  return (data.items || [])
    .map((item) => normalizeSpotifyPlaylist(item))
    .filter((item): item is SpotifyPlaylist => Boolean(item))
}

export async function fetchPlaylistTracks(
  accessToken: string,
  playlistId: string,
  fetchImpl: FetchLike = fetch,
  limit = 100
): Promise<SpotifyTrack[]> {
  // O endpoint atual é /items (o antigo /tracks está deprecated) e aceita no
  // máximo 50 itens por página. Buscamos duas páginas para chegar a 100.
  const pageSize = Math.min(50, Math.max(1, limit))
  const tracks: SpotifyTrack[] = []
  let offset = 0

  while (tracks.length < limit) {
    const data = await spotifyRequest<{
      items?: Array<{ track?: SpotifyApiTrack | null; item?: SpotifyApiTrack | null }>
    }>(
      `/playlists/${encodeURIComponent(playlistId)}/items?limit=${pageSize}&offset=${offset}`,
      accessToken,
      fetchImpl
    )

    const items = data.items || []
    if (items.length === 0) break

    for (const entry of items) {
      const track = normalizeSpotifyTrack(entry.item || entry.track)
      if (track && track.isPlayable) tracks.push(track)
      if (tracks.length >= limit) break
    }

    if (items.length < pageSize) break
    offset += items.length
  }

  return tracks
}

// ---------------------------------------------------------------
// Tokens por usuário
// ---------------------------------------------------------------

/** Lê o token válido do usuário, renovando quando necessário. */
export async function getSpotifyAccessToken(
  userId: string,
  fetchImpl: FetchLike = fetch
): Promise<string> {
  const integration = await prisma.integration.findUnique({
    where: { userId_type: { userId, type: 'spotify' } },
  })

  if (!integration?.isActive || !integration.accessToken) {
    throw new SpotifyError('Conecte sua conta do Spotify nas configurações.', 'NOT_CONNECTED')
  }

  const expiresSoon =
    !integration.expiresAt || integration.expiresAt.getTime() < Date.now() + 60_000

  if (expiresSoon) {
    if (!integration.refreshToken) {
      throw new SpotifyError('Sessão do Spotify expirada. Reconecte a conta.', 'NOT_CONNECTED')
    }

    let refreshed: SpotifyTokenResponse
    try {
      refreshed = await refreshSpotifyToken(integration.refreshToken, fetchImpl)
    } catch (error) {
      if (error instanceof SpotifyError && error.code === 'REFRESH_FAILED') {
        throw new SpotifyError('Sessão do Spotify expirada. Reconecte a conta.', 'NOT_CONNECTED')
      }
      throw error
    }
    await prisma.integration.update({
      where: { id: integration.id },
      data: {
        accessToken: refreshed.access_token,
        refreshToken: refreshed.refresh_token || integration.refreshToken,
        expiresAt: new Date(Date.now() + refreshed.expires_in * 1000),
        scopes: JSON.stringify(refreshed.scope ? refreshed.scope.split(' ') : SPOTIFY_SCOPES),
      },
    })
    return refreshed.access_token
  }

  return integration.accessToken
}
