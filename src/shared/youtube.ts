/**
 * Utilitários de YouTube compartilhados entre cliente e servidor.
 *
 * Extrai o ID do vídeo de links comuns (watch, youtu.be, shorts, embed, live)
 * sem depender de chaves de API. A reprodução é feita pelo player oficial
 * (IFrame Player API).
 */

const YOUTUBE_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
])

/**
 * Extrai o ID de 11 caracteres de um vídeo do YouTube.
 * Aceita URL completa, URL sem protocolo ou o próprio ID.
 */
export function extractYouTubeId(input: string): string | null {
  const value = input?.trim()
  if (!value) return null

  // ID puro
  if (YOUTUBE_ID_PATTERN.test(value)) return value

  let url: URL
  try {
    url = new URL(value.includes('://') ? value : `https://${value}`)
  } catch {
    return null
  }

  const host = url.hostname.toLowerCase()

  if (host === 'youtu.be' || host === 'www.youtu.be') {
    const id = url.pathname.split('/').filter(Boolean)[0]
    return id && YOUTUBE_ID_PATTERN.test(id) ? id : null
  }

  if (!YOUTUBE_HOSTS.has(host)) return null

  const v = url.searchParams.get('v')
  if (v && YOUTUBE_ID_PATTERN.test(v)) return v

  const segments = url.pathname.split('/').filter(Boolean)
  const [prefix, id] = segments
  if (['shorts', 'embed', 'live', 'v'].includes(prefix) && id && YOUTUBE_ID_PATTERN.test(id)) {
    return id
  }

  return null
}

/**
 * Procura um link do YouTube dentro de um texto maior.
 * Ex.: "toca https://youtu.be/dQw4w9WgXcQ por favor".
 */
export function findYouTubeIdInText(input: string): string | null {
  const value = input?.trim()
  if (!value) return null

  const direct = extractYouTubeId(value)
  if (direct) return direct

  const match = value.match(/https?:\/\/[^\s]+/i)
  if (!match) return null

  const cleaned = match[0].replace(/[),.;!?]+$/g, '')
  return extractYouTubeId(cleaned)
}

/** URL canônica de um vídeo do YouTube. */
export function youTubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`
}

/** URL de thumbnail oficial do YouTube. */
export function youTubeThumbnailUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
}

/** Normaliza um link/ID do YouTube em um objeto pronto para a fila. */
export function normalizeYouTubeTrack(input: string): {
  videoId: string
  sourceUrl: string
  artworkUrl: string
} | null {
  const videoId = extractYouTubeId(input)
  if (!videoId) return null
  return {
    videoId,
    sourceUrl: youTubeWatchUrl(videoId),
    artworkUrl: youTubeThumbnailUrl(videoId),
  }
}
