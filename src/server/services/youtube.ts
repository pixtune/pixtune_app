/**
 * Metadados públicos de um vídeo do YouTube via oEmbed.
 *
 * O oEmbed é um endpoint público e documentado do YouTube. Não requer
 * chave de API, OAuth, download ou extração de áudio.
 */

import { youTubeThumbnailUrl, youTubeWatchUrl } from '../../shared/youtube'

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export interface ResolvedYouTubeVideo {
  videoId: string
  title: string
  artist: string
  artworkUrl: string
  sourceUrl: string
}

export async function resolveYouTubeVideo(
  videoId: string,
  fetchImpl: FetchLike = fetch
): Promise<ResolvedYouTubeVideo> {
  const fallback: ResolvedYouTubeVideo = {
    videoId,
    title: 'Vídeo do YouTube',
    artist: 'YouTube',
    artworkUrl: youTubeThumbnailUrl(videoId),
    sourceUrl: youTubeWatchUrl(videoId),
  }

  try {
    const oembed = `https://www.youtube.com/oembed?url=${encodeURIComponent(
      youTubeWatchUrl(videoId)
    )}&format=json`
    const res = await fetchImpl(oembed, { signal: AbortSignal.timeout(6000) })

    if (!res.ok) return fallback

    const data = (await res.json()) as {
      title?: string
      author_name?: string
      thumbnail_url?: string
    }

    return {
      videoId,
      title: data.title || fallback.title,
      artist: data.author_name || fallback.artist,
      artworkUrl: data.thumbnail_url || fallback.artworkUrl,
      sourceUrl: fallback.sourceUrl,
    }
  } catch {
    // Sem internet ou oEmbed indisponível: o player ainda pode tocar pelo ID.
    return fallback
  }
}
