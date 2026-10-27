/**
 * Detecção de pedidos de música escritos na mensagem da doação.
 *
 * Fluxo:
 * 1. Normaliza a mensagem e remove verbos de pedido ("toca", "coloca"...).
 * 2. Descarta mensagens vazias, longas ou que são apenas conversa comum.
 * 3. Se a mensagem contém um link do YouTube, usa o próprio link.
 * 4. Caso contrário, valida o nome no catálogo público do iTunes Search.
 * 5. Com YOUTUBE_API_KEY configurada, busca o vídeo na YouTube Data API v3.
 *
 * Nenhuma API é inventada: iTunes Search e YouTube Data API v3 são serviços
 * públicos e documentados. Sem a chave do YouTube, a música é detectada e
 * entra na fila aguardando um link (a fila permite anexar o link depois).
 */

import { findYouTubeIdInText, youTubeWatchUrl } from '../../shared/youtube.js'
import { resolveYouTubeVideo, type FetchLike } from './youtube.js'

export type SongRequestStatus = 'detected' | 'needs_video' | 'not_song' | 'error'

export type SongRequestReason =
  | 'EMPTY_MESSAGE'
  | 'COMMON_MESSAGE'
  | 'MESSAGE_TOO_LONG'
  | 'TOO_MANY_WORDS'
  | 'ONLY_NUMBERS'
  | 'NOT_FOUND'
  | 'ITUNES_UNAVAILABLE'
  | 'YOUTUBE_API_KEY_MISSING'
  | 'VIDEO_NOT_FOUND'
  | 'YOUTUBE_UNAVAILABLE'

export interface ParsedSongRequest {
  kind: 'youtube' | 'text'
  query: string
  videoId?: string
  reason?: SongRequestReason
}

export interface SongCandidate {
  trackName: string
  artistName: string
  collectionName?: string
  artworkUrl100?: string
  trackTimeMillis?: number
  trackViewUrl?: string
  previewUrl?: string
}

export interface YouTubeSearchItem {
  videoId: string
  title: string
  channelTitle: string
  thumbnailUrl?: string
}

export interface DetectedSong {
  title: string
  artist: string
  album?: string
  artworkUrl?: string
  durationMs?: number
  videoId?: string
  sourceUrl?: string
  youtubeTitle?: string
  youtubeChannel?: string
}

export interface SongDetectionResult {
  status: SongRequestStatus
  query?: string
  song?: DetectedSong
  reason?: SongRequestReason
  source?: 'message_url' | 'itunes_youtube' | 'itunes' | 'youtube'
}

export interface DetectSongOptions {
  youtubeApiKey?: string
  fetchImpl?: FetchLike
}

export class SongDetectionError extends Error {
  readonly reason: SongRequestReason

  constructor(reason: SongRequestReason, message: string) {
    super(message)
    this.name = 'SongDetectionError'
    this.reason = reason
  }
}

/** Normaliza texto para comparação: sem acentos, pontuação ou caixa. */
export function normalizeForMatch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

/**
 * Mensagens que são conversa/commands comuns e não devem ser confundidas
 * com nomes de música. A lista é intencionalmente conservadora: termos
 * ambíguos como "amor" e "saudade" continuam válidos como títulos.
 */
const NON_SONG_MESSAGES = new Set(
  [
    'oi',
    'ola',
    'hello',
    'hi',
    'hey',
    'eae',
    'eai',
    'salve',
    'bom dia',
    'boa tarde',
    'boa noite',
    'boa madrugada',
    'tudo bem',
    'como vai',
    'beleza',
    'blz',
    'obrigado',
    'obrigada',
    'valeu',
    'vlw',
    'brigado',
    'brigada',
    'teste',
    'test',
    'testando',
    'funcionando',
    'kkk',
    'kkkk',
    'kkkkk',
    'haha',
    'hahaha',
    'rsrs',
    'rs',
    'lol',
    'primeira',
    'primeiro',
    'segunda',
    'segundo',
    'terceira',
    'terceiro',
    'quarta',
    'quinto',
    'ultima',
    'ultimo',
    'pizza',
    'bolo',
    'cerveja',
    'agua',
    'cafe',
    'lanche',
    'hamburguer',
    'batata',
    'sorvete',
    'chocolate',
    'refrigerante',
    'coxinha',
    'pastel',
    'marmita',
    'comida',
    'fome',
    'sem regra',
    'sem mensagem',
    'manda ver',
    'essa',
    'essa e top',
    'essa musica',
    'essa e boa',
    'boa',
    'top',
    'show',
    'legal',
    'parabens',
    'muito bom',
    'gostei',
    'amei',
    'lindo',
    'linda',
    'bonito',
    'bonita',
    'nossa',
    'caraca',
    'meu deus',
    'deus',
    'jesus',
    'amem',
    'tamo junto',
    'familia',
    'jogo',
    'gol',
    'gol do brasil',
    'vai brasil',
    'forca',
    'apoio',
    'feliz',
    'feliz aniversario',
    'nao',
    'sim',
    'pode',
    'nada',
    'manda',
    'cheguei',
    'live',
    'boa live',
    'primeira vez',
    'segue',
    'curte',
    'inscreve',
    'compartilha',
    'like',
    'sub',
    'pular',
    'skip',
    'proxima',
    'pause',
    'pausa',
    'play',
    'toca',
    'toca essa',
    'coloca',
    'quero',
    'quero ouvir',
  ].map(normalizeForMatch)
)

const REQUEST_PREFIXES = [
  /^(por favor|porfavor|pfv|pf)[\s,:-]+/i,
  /^(toca|toque|coloca|coloque|manda|mande|me manda|me coloca|quero ouvir|quero escutar|quero|play|dj)[\s,:-]+/i,
]

function cleanQuery(raw: string): string {
  let query = raw
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, ' ')
    .replace(/^[\s"'“”‘’`]+|[\s"'“”‘’`]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  const labelled = query.match(/^(?:a\s+)?(?:m[uú]sica|som)\s*[:\-]\s*(.+)$/i)
  if (labelled) query = labelled[1].trim()

  query = query.replace(/^a\s+m[uú]sica\s+/i, '').trim()

  for (let i = 0; i < 3; i++) {
    const before = query
    for (const prefix of REQUEST_PREFIXES) {
      query = query.replace(prefix, '').trim()
    }
    query = query.replace(/^a\s+m[uú]sica\s+/i, '').trim()
    if (query === before) break
  }

  query = query
    .replace(/\s+(por favor|porfavor|pfv|pf|please|obrigado|obrigada|valeu|vlw)\s*$/i, '')
    .replace(/[.!?]+$/g, '')
    .replace(/^[\s,;:\-]+|[\s,;:\-]+$/g, '')
    .trim()

  return query
}

/**
 * Interpreta uma mensagem de doação. Não faz chamadas de rede.
 */
export function parseSongRequest(raw: string): ParsedSongRequest {
  const original = (raw || '').trim()
  if (!original) {
    return { kind: 'text', query: '', reason: 'EMPTY_MESSAGE' }
  }

  const videoId = findYouTubeIdInText(original)
  if (videoId) {
    return { kind: 'youtube', query: cleanQuery(original), videoId }
  }

  const query = cleanQuery(original)
  if (!query) {
    return { kind: 'text', query: '', reason: 'EMPTY_MESSAGE' }
  }

  if (query.length > 120) {
    return { kind: 'text', query, reason: 'MESSAGE_TOO_LONG' }
  }

  const words = query.split(/\s+/).filter(Boolean)
  if (words.length > 12) {
    return { kind: 'text', query, reason: 'TOO_MANY_WORDS' }
  }

  const normalized = normalizeForMatch(query)
  if (normalized.length < 2) {
    return { kind: 'text', query, reason: 'COMMON_MESSAGE' }
  }

  if (/^[\d\s.,]+$/.test(query)) {
    return { kind: 'text', query, reason: 'ONLY_NUMBERS' }
  }

  if (NON_SONG_MESSAGES.has(normalized)) {
    return { kind: 'text', query, reason: 'COMMON_MESSAGE' }
  }

  return { kind: 'text', query }
}

const LOW_QUALITY_MARKERS = ['karaoke', 'cover', 'tribute', 'made famous', 'instrumental']

/** Pontua um resultado do iTunes contra o texto digitado pelo doador. */
export function scoreSongCandidate(query: string, candidate: SongCandidate): number {
  const q = normalizeForMatch(query)
  const title = normalizeForMatch(candidate.trackName)
  const artist = normalizeForMatch(candidate.artistName)
  const collection = normalizeForMatch(candidate.collectionName || '')

  if (!q || !title) return 0

  let score = 0

  if (title === q) {
    score = 100
  } else if (
    title.startsWith(`${q} `) ||
    title.startsWith(`${q}(`) ||
    title.startsWith(`${q}[`) ||
    title.startsWith(`${q} -`)
  ) {
    score = 88
  } else if (q.startsWith(`${title} `) || q.startsWith(`${title}(`) || q.startsWith(`${title} -`)) {
    score = 84
  } else if (q.includes(' ') && title.includes(q) && q.length >= 6) {
    score = 72
  }

  if (score === 0) return 0

  if (artist && q.includes(artist)) score += 6

  const titleAndCollection = `${title} ${collection}`
  if (LOW_QUALITY_MARKERS.some((marker) => titleAndCollection.includes(marker))) {
    score -= 35
  }

  return Math.max(0, Math.min(100, score))
}

async function searchITunes(query: string, fetchImpl: FetchLike): Promise<SongCandidate | null> {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(
    query
  )}&entity=song&limit=12&country=BR`
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(7000) })

  if (!res.ok) {
    throw new SongDetectionError('ITUNES_UNAVAILABLE', `iTunes respondeu ${res.status}`)
  }

  const data = (await res.json()) as { results?: Array<Record<string, unknown>> }
  const results = Array.isArray(data.results) ? data.results : []

  let best: { candidate: SongCandidate; score: number } | null = null

  for (let index = 0; index < results.length; index++) {
    const result = results[index]
    const candidate: SongCandidate = {
      trackName: String(result.trackName || ''),
      artistName: String(result.artistName || ''),
      collectionName: result.collectionName ? String(result.collectionName) : undefined,
      artworkUrl100: result.artworkUrl100 ? String(result.artworkUrl100) : undefined,
      trackTimeMillis:
        typeof result.trackTimeMillis === 'number' ? result.trackTimeMillis : undefined,
      trackViewUrl: result.trackViewUrl ? String(result.trackViewUrl) : undefined,
      previewUrl: result.previewUrl ? String(result.previewUrl) : undefined,
    }

    if (!candidate.trackName) continue

    const score = scoreSongCandidate(query, candidate) + Math.max(0, 3 - index)
    if (!best || score > best.score) best = { candidate, score }
  }

  if (!best || best.score < 70) return null
  return best.candidate
}

/** Pontua um resultado da busca do YouTube contra a música esperada. */
export function scoreYouTubeCandidate(
  query: string,
  item: YouTubeSearchItem,
  trackName?: string,
  artistName?: string
): number {
  const title = normalizeForMatch(item.title)
  const channel = normalizeForMatch(item.channelTitle)
  const q = normalizeForMatch(query)
  const track = trackName ? normalizeForMatch(trackName) : ''
  const artist = artistName ? normalizeForMatch(artistName) : ''

  let score = 0

  if (track) {
    if (title === track) score += 70
    else if (
      title.startsWith(`${track} `) ||
      title.startsWith(`${track}(`) ||
      title.startsWith(`${track}[`) ||
      title.startsWith(`${track} -`)
    ) {
      score += 58
    } else if (title.includes(track)) {
      score += 45
    }
  } else if (q) {
    if (title === q) score += 55
    else if (title.startsWith(`${q} `)) score += 50
    else if (title.includes(q)) score += 45
  }

  if (artist && (title.includes(artist) || channel.includes(artist))) score += 22
  if (channel.includes('vevo') || channel.includes('topic')) score += 12
  if (channel.includes('official')) score += 4

  if (LOW_QUALITY_MARKERS.some((marker) => title.includes(marker))) score -= 35

  return score
}

async function searchYouTube(
  query: string,
  youtubeApiKey: string,
  fetchImpl: FetchLike,
  trackName?: string,
  artistName?: string
): Promise<YouTubeSearchItem | null> {
  const url =
    'https://www.googleapis.com/youtube/v3/search' +
    `?part=snippet&type=video&videoCategoryId=10&maxResults=6` +
    `&q=${encodeURIComponent(query)}&key=${encodeURIComponent(youtubeApiKey)}&safeSearch=none`

  const res = await fetchImpl(url, { signal: AbortSignal.timeout(7000) })

  if (!res.ok) {
    let detail = `YouTube respondeu ${res.status}`
    try {
      const error = (await res.json()) as { error?: { message?: string } }
      if (error.error?.message) detail = error.error.message
    } catch {
      // Resposta sem JSON; mantém a mensagem com o status.
    }
    throw new SongDetectionError('YOUTUBE_UNAVAILABLE', detail)
  }

  const data = (await res.json()) as {
    items?: Array<{
      id?: { videoId?: string }
      snippet?: {
        title?: string
        channelTitle?: string
        thumbnails?: Record<string, { url?: string }>
      }
    }>
  }

  const items: YouTubeSearchItem[] = (data.items || [])
    .map((item) => ({
      videoId: item.id?.videoId || '',
      title: item.snippet?.title || '',
      channelTitle: item.snippet?.channelTitle || '',
      thumbnailUrl:
        item.snippet?.thumbnails?.high?.url ||
        item.snippet?.thumbnails?.medium?.url ||
        item.snippet?.thumbnails?.default?.url,
    }))
    .filter((item) => item.videoId && item.title)

  let best: { item: YouTubeSearchItem; score: number } | null = null
  for (const item of items) {
    const score = scoreYouTubeCandidate(query, item, trackName, artistName)
    if (!best || score > best.score) best = { item, score }
  }

  if (!best || best.score < 50) return null
  return best.item
}

function reasonForThrown(error: unknown): SongRequestReason {
  if (error instanceof SongDetectionError) return error.reason
  return 'ITUNES_UNAVAILABLE'
}

export function isYouTubeSearchConfigured(): boolean {
  return Boolean(process.env.YOUTUBE_API_KEY?.trim())
}

/**
 * Detecta a música pedida na mensagem. Pode fazer chamadas ao iTunes e ao
 * YouTube, por isso aceita `fetchImpl` para testes determinísticos.
 */
export async function detectSongRequest(
  message: string,
  options: DetectSongOptions = {}
): Promise<SongDetectionResult> {
  const parsed = parseSongRequest(message)

  if (parsed.reason) {
    return { status: 'not_song', query: parsed.query, reason: parsed.reason }
  }

  if (parsed.kind === 'youtube' && parsed.videoId) {
    const metadata = await resolveYouTubeVideo(parsed.videoId, options.fetchImpl)
    return {
      status: 'detected',
      query: parsed.query,
      source: 'message_url',
      song: {
        title: metadata.title,
        artist: metadata.artist,
        artworkUrl: metadata.artworkUrl,
        videoId: metadata.videoId,
        sourceUrl: metadata.sourceUrl,
      },
    }
  }

  const fetchImpl = options.fetchImpl || fetch
  const youtubeApiKey = options.youtubeApiKey?.trim()

  let candidate: SongCandidate | null = null
  let itunesFailed = false

  try {
    candidate = await searchITunes(parsed.query, fetchImpl)
  } catch {
    itunesFailed = true
  }

  if (candidate) {
    if (!youtubeApiKey) {
      return {
        status: 'needs_video',
        query: parsed.query,
        source: 'itunes',
        reason: 'YOUTUBE_API_KEY_MISSING',
        song: {
          title: candidate.trackName,
          artist: candidate.artistName,
          album: candidate.collectionName,
          artworkUrl: candidate.artworkUrl100,
          durationMs: candidate.trackTimeMillis,
        },
      }
    }

    try {
      const youtube = await searchYouTube(
        `${candidate.trackName} ${candidate.artistName}`.trim(),
        youtubeApiKey,
        fetchImpl,
        candidate.trackName,
        candidate.artistName
      )

      if (!youtube) {
        return {
          status: 'needs_video',
          query: parsed.query,
          source: 'itunes',
          reason: 'VIDEO_NOT_FOUND',
          song: {
            title: candidate.trackName,
            artist: candidate.artistName,
            album: candidate.collectionName,
            artworkUrl: candidate.artworkUrl100,
            durationMs: candidate.trackTimeMillis,
          },
        }
      }

      return {
        status: 'detected',
        query: parsed.query,
        source: 'itunes_youtube',
        song: {
          title: candidate.trackName,
          artist: candidate.artistName,
          album: candidate.collectionName,
          artworkUrl: youtube.thumbnailUrl || candidate.artworkUrl100,
          durationMs: candidate.trackTimeMillis,
          videoId: youtube.videoId,
          sourceUrl: youTubeWatchUrl(youtube.videoId),
          youtubeTitle: youtube.title,
          youtubeChannel: youtube.channelTitle,
        },
      }
    } catch (error) {
      return {
        status: 'needs_video',
        query: parsed.query,
        source: 'itunes',
        reason: reasonForThrown(error) === 'YOUTUBE_UNAVAILABLE' ? 'YOUTUBE_UNAVAILABLE' : 'VIDEO_NOT_FOUND',
        song: {
          title: candidate.trackName,
          artist: candidate.artistName,
          album: candidate.collectionName,
          artworkUrl: candidate.artworkUrl100,
          durationMs: candidate.trackTimeMillis,
        },
      }
    }
  }

  // O iTunes não encontrou (ou está indisponível). Com chave do YouTube,
  // tenta uma busca direta e exige um resultado com título fortemente
  // relacionado ao texto digitado.
  if (youtubeApiKey) {
    try {
      const youtube = await searchYouTube(parsed.query, youtubeApiKey, fetchImpl)
      if (youtube) {
        return {
          status: 'detected',
          query: parsed.query,
          source: 'youtube',
          song: {
            title: parsed.query,
            artist: youtube.channelTitle,
            artworkUrl: youtube.thumbnailUrl,
            videoId: youtube.videoId,
            sourceUrl: youTubeWatchUrl(youtube.videoId),
            youtubeTitle: youtube.title,
            youtubeChannel: youtube.channelTitle,
          },
        }
      }
    } catch {
      if (itunesFailed) {
        return { status: 'error', query: parsed.query, reason: 'ITUNES_UNAVAILABLE' }
      }
    }
  }

  if (itunesFailed) {
    return { status: 'error', query: parsed.query, reason: 'ITUNES_UNAVAILABLE' }
  }

  return { status: 'not_song', query: parsed.query, reason: 'NOT_FOUND' }
}

/** URL de busca do YouTube usada enquanto um pedido aguarda link. */
export function youTubeSearchUrl(title: string, artist?: string): string {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(
    [title, artist].filter(Boolean).join(' ')
  )}`
}

/** Mensagem em português para exibir no histórico. */
export function songRequestReasonMessage(reason?: SongRequestReason): string {
  switch (reason) {
    case 'EMPTY_MESSAGE':
      return 'Doação sem mensagem: nenhum pedido de música.'
    case 'COMMON_MESSAGE':
      return 'Mensagem ignorada: não parece ser um pedido de música.'
    case 'MESSAGE_TOO_LONG':
      return 'Mensagem ignorada: texto longo demais para um nome de música.'
    case 'TOO_MANY_WORDS':
      return 'Mensagem ignorada: muitas palavras para um nome de música.'
    case 'ONLY_NUMBERS':
      return 'Mensagem ignorada: a mensagem contém apenas números.'
    case 'NOT_FOUND':
      return 'Mensagem ignorada: nenhuma música correspondente foi encontrada.'
    case 'ITUNES_UNAVAILABLE':
      return 'Não foi possível consultar o catálogo de músicas agora. Tente novamente.'
    case 'YOUTUBE_API_KEY_MISSING':
      return 'Música detectada, mas a busca no YouTube não está configurada (YOUTUBE_API_KEY).'
    case 'VIDEO_NOT_FOUND':
      return 'Música detectada, mas nenhum vídeo do YouTube foi encontrado.'
    case 'YOUTUBE_UNAVAILABLE':
      return 'Música detectada, mas a busca no YouTube falhou. Verifique a chave e a cota.'
    default:
      return 'Pedido de música não processado.'
  }
}
