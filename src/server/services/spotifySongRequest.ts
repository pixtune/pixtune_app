/**
 * Detecção de pedidos de música para o Spotify.
 *
 * Aceita:
 *  - link/URI de faixa do Spotify na mensagem;
 *  - nome da música/artista digitado na mensagem, resolvido pela busca oficial.
 *
 * Não há busca no YouTube nem reprodução fora do Spotify.
 */

import { findSpotifyTrackIdInText } from '../../shared/spotify'
import { parseSongRequest } from './songRequest'
import {
  fetchSpotifyTrack,
  searchSpotifyTrack,
  SpotifyError,
  type FetchLike,
  type SpotifyTrack,
} from './spotify'

export type SpotifySongRequestStatus = 'detected' | 'not_song' | 'error'

export type SpotifySongRequestReason =
  | 'EMPTY_MESSAGE'
  | 'COMMON_MESSAGE'
  | 'MESSAGE_TOO_LONG'
  | 'TOO_MANY_WORDS'
  | 'ONLY_NUMBERS'
  | 'NOT_FOUND'
  | 'TRACK_NOT_FOUND'
  | 'SPOTIFY_UNAVAILABLE'
  | 'SPOTIFY_NOT_CONNECTED'
  | 'YOUTUBE_LINK_NOT_SUPPORTED'

export interface DetectedSpotifySong {
  title: string
  artist: string
  album?: string
  artworkUrl?: string
  durationMs?: number
  providerId: string
  sourceUrl: string
  uri: string
}

export interface SpotifySongDetectionResult {
  status: SpotifySongRequestStatus
  query?: string
  song?: DetectedSpotifySong
  reason?: SpotifySongRequestReason
  source?: 'message_url' | 'spotify_search'
}

export interface DetectSpotifySongOptions {
  accessToken: string
  fetchImpl?: FetchLike
}

function toSong(track: SpotifyTrack): DetectedSpotifySong {
  return {
    title: track.title,
    artist: track.artist,
    album: track.album,
    artworkUrl: track.artworkUrl,
    durationMs: track.durationMs || undefined,
    providerId: track.id,
    sourceUrl: track.sourceUrl,
    uri: track.uri,
  }
}

export async function detectSpotifySongRequest(
  message: string,
  options: DetectSpotifySongOptions
): Promise<SpotifySongDetectionResult> {
  const raw = (message || '').trim()
  if (!raw) {
    return { status: 'not_song', query: '', reason: 'EMPTY_MESSAGE' }
  }

  const fetchImpl = options.fetchImpl || fetch
  const spotifyId = findSpotifyTrackIdInText(raw)

  if (spotifyId) {
    try {
      const track = await fetchSpotifyTrack(options.accessToken, spotifyId, fetchImpl)
      return {
        status: 'detected',
        query: raw,
        source: 'message_url',
        song: toSong(track),
      }
    } catch (error) {
      if (error instanceof SpotifyError && error.code === 'NOT_FOUND') {
        return { status: 'not_song', query: raw, reason: 'TRACK_NOT_FOUND' }
      }
      return { status: 'error', query: raw, reason: 'SPOTIFY_UNAVAILABLE' }
    }
  }

  const parsed = parseSongRequest(raw)
  if (parsed.reason) {
    return {
      status: 'not_song',
      query: parsed.query,
      reason: parsed.reason as SpotifySongRequestReason,
    }
  }

  // A mensagem contém um link do YouTube; o PixTune agora trabalha apenas
  // com o Spotify. O pedido é ignorado com uma explicação no histórico.
  if (parsed.kind === 'youtube') {
    return {
      status: 'not_song',
      query: parsed.query,
      reason: 'YOUTUBE_LINK_NOT_SUPPORTED',
    }
  }

  try {
    const track = await searchSpotifyTrack(options.accessToken, parsed.query, fetchImpl)
    if (!track) {
      return { status: 'not_song', query: parsed.query, reason: 'NOT_FOUND' }
    }
    return {
      status: 'detected',
      query: parsed.query,
      source: 'spotify_search',
      song: toSong(track),
    }
  } catch {
    return { status: 'error', query: parsed.query, reason: 'SPOTIFY_UNAVAILABLE' }
  }
}

/** Mensagem em português para exibir no histórico. */
export function spotifySongRequestReasonMessage(reason?: SpotifySongRequestReason): string {
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
      return 'Mensagem ignorada: nenhuma faixa correspondente foi encontrada no Spotify.'
    case 'TRACK_NOT_FOUND':
      return 'Faixa do Spotify não encontrada ou indisponível.'
    case 'SPOTIFY_UNAVAILABLE':
      return 'Não foi possível consultar o Spotify agora. Tente novamente.'
    case 'SPOTIFY_NOT_CONNECTED':
      return 'Conecte sua conta do Spotify em Configurações > Spotify para tocar os pedidos.'
    case 'YOUTUBE_LINK_NOT_SUPPORTED':
      return 'Links do YouTube não são mais aceitos. Use o nome da música ou um link do Spotify.'
    default:
      return 'Pedido de música não processado.'
  }
}
