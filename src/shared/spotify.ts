/**
 * Utilitários de Spotify compartilhados entre cliente e servidor.
 *
 * Extrai IDs de faixas e playlists de links comuns sem depender de chaves.
 * A reprodução é feita pelo Web Playback SDK oficial do Spotify.
 */

const SPOTIFY_ID_PATTERN = /^[A-Za-z0-9]{22}$/

const SPOTIFY_HOSTS = new Set(['open.spotify.com', 'play.spotify.com'])

function spotifyUrlSegments(input: string): string[] | null {
  const value = input?.trim()
  if (!value) return null

  let url: URL
  try {
    url = new URL(value.includes('://') ? value : `https://${value}`)
  } catch {
    return null
  }

  if (!SPOTIFY_HOSTS.has(url.hostname.toLowerCase())) return null
  return url.pathname.split('/').filter(Boolean)
}

/**
 * Extrai o ID de uma faixa do Spotify.
 * Aceita URL completa, URL sem protocolo, URI `spotify:track:...` ou o ID puro.
 */
export function extractSpotifyTrackId(input: string): string | null {
  const value = input?.trim()
  if (!value) return null

  if (value.startsWith('spotify:track:')) {
    const id = value.slice('spotify:track:'.length).split('?')[0]
    return SPOTIFY_ID_PATTERN.test(id) ? id : null
  }

  if (SPOTIFY_ID_PATTERN.test(value)) return value

  const segments = spotifyUrlSegments(value)
  if (!segments) return null

  const trackIndex = segments.indexOf('track')
  if (trackIndex >= 0) {
    const id = segments[trackIndex + 1]
    return id && SPOTIFY_ID_PATTERN.test(id) ? id : null
  }

  return null
}

/** Extrai o ID de uma playlist do Spotify. */
export function extractSpotifyPlaylistId(input: string): string | null {
  const value = input?.trim()
  if (!value) return null

  if (value.startsWith('spotify:playlist:')) {
    const id = value.slice('spotify:playlist:'.length).split('?')[0]
    return SPOTIFY_ID_PATTERN.test(id) ? id : null
  }

  const segments = spotifyUrlSegments(value)
  if (!segments) return null

  const playlistIndex = segments.indexOf('playlist')
  if (playlistIndex >= 0) {
    const id = segments[playlistIndex + 1]
    return id && SPOTIFY_ID_PATTERN.test(id) ? id : null
  }

  return null
}

/** Procura um link de faixa do Spotify dentro de um texto maior. */
export function findSpotifyTrackIdInText(input: string): string | null {
  const value = input?.trim()
  if (!value) return null

  const direct = extractSpotifyTrackId(value)
  if (direct) return direct

  const uriMatch = value.match(/spotify:track:[A-Za-z0-9]{22}/)
  if (uriMatch) return extractSpotifyTrackId(uriMatch[0])

  // Procura em todos os links da mensagem: o do Spotify pode não ser o primeiro.
  const links = value.match(/(?:https?:\/\/)?(?:open|play)\.spotify\.com\/[^\s]+/gi) || []
  for (const link of links) {
    const cleaned = link.replace(/[),.;!?]+$/g, '')
    const id = extractSpotifyTrackId(cleaned)
    if (id) return id
  }

  return null
}

/** URI canônica de uma faixa do Spotify. */
export function spotifyTrackUri(trackId: string): string {
  return `spotify:track:${trackId}`
}

/** URL canônica de uma faixa do Spotify. */
export function spotifyTrackUrl(trackId: string): string {
  return `https://open.spotify.com/track/${trackId}`
}

/** URL canônica de uma playlist do Spotify. */
export function spotifyPlaylistUrl(playlistId: string): string {
  return `https://open.spotify.com/playlist/${playlistId}`
}

/** Normaliza um link/ID do Spotify em dados básicos para a fila. */
export function normalizeSpotifyTrack(input: string): {
  spotifyId: string
  sourceUrl: string
} | null {
  const spotifyId = extractSpotifyTrackId(input)
  if (!spotifyId) return null
  return {
    spotifyId,
    sourceUrl: spotifyTrackUrl(spotifyId),
  }
}
