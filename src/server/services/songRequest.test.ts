import { describe, expect, it, vi } from 'vitest'
import {
  detectSongRequest,
  parseSongRequest,
  scoreSongCandidate,
  scoreYouTubeCandidate,
  type SongCandidate,
} from './songRequest.js'

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const despacitoCandidate: SongCandidate = {
  trackName: 'Despacito',
  artistName: 'Luis Fonsi & Daddy Yankee',
  collectionName: 'VIDA',
  artworkUrl100: 'https://example.com/despacito.jpg',
  trackTimeMillis: 229000,
}

const youtubeItem = {
  videoId: 'dQw4w9WgXcQ',
  title: 'Luis Fonsi - Despacito ft. Daddy Yankee (Official Video)',
  channelTitle: 'LuisFonsiVEVO',
  thumbnailUrl: 'https://example.com/thumb.jpg',
}

describe('parseSongRequest', () => {
  it('remove verbos de pedido e mantém o nome da música', () => {
    expect(parseSongRequest('toca Despacito')).toMatchObject({
      kind: 'text',
      query: 'Despacito',
    })
    expect(parseSongRequest('coloca a música Evidências, por favor')).toMatchObject({
      kind: 'text',
      query: 'Evidências',
    })
  })

  it('aceita o formato "música: nome"', () => {
    expect(parseSongRequest('música: Evidências')).toMatchObject({
      kind: 'text',
      query: 'Evidências',
    })
  })

  it('ignora conversa comum e pedidos de comida', () => {
    expect(parseSongRequest('manda PIZZA!')).toMatchObject({
      reason: 'COMMON_MESSAGE',
    })
    expect(parseSongRequest('quero bolo')).toMatchObject({
      reason: 'COMMON_MESSAGE',
    })
    expect(parseSongRequest('boa noite')).toMatchObject({
      reason: 'COMMON_MESSAGE',
    })
    expect(parseSongRequest('essa é top')).toMatchObject({
      reason: 'COMMON_MESSAGE',
    })
  })

  it('detecta link do YouTube dentro da mensagem', () => {
    expect(parseSongRequest('toca https://youtu.be/dQw4w9WgXcQ')).toMatchObject({
      kind: 'youtube',
      videoId: 'dQw4w9WgXcQ',
    })
  })

  it('rejeita mensagem vazia e longa demais', () => {
    expect(parseSongRequest('   ')).toMatchObject({ reason: 'EMPTY_MESSAGE' })
    expect(parseSongRequest('a'.repeat(130))).toMatchObject({
      reason: 'MESSAGE_TOO_LONG',
    })
  })
})

describe('scoreSongCandidate', () => {
  it('prioriza título exato', () => {
    expect(scoreSongCandidate('Despacito', despacitoCandidate)).toBe(100)
  })

  it('dá bônus quando o artista é mencionado', () => {
    expect(
      scoreSongCandidate('Despacito Luis Fonsi', {
        ...despacitoCandidate,
        artistName: 'Luis Fonsi',
      })
    ).toBe(90)
  })

  it('penaliza karaokê/cover', () => {
    const karaoke = {
      ...despacitoCandidate,
      trackName: 'Despacito (Karaoke Version)',
      collectionName: 'Karaoke Hits',
    }
    expect(scoreSongCandidate('Despacito', karaoke)).toBeLessThan(70)
  })

  it('não aceita apenas o nome do artista', () => {
    expect(
      scoreSongCandidate('Luis Fonsi', {
        trackName: 'Despacito',
        artistName: 'Luis Fonsi',
      })
    ).toBe(0)
  })
})

describe('scoreYouTubeCandidate', () => {
  it('favorece canal oficial/VEVO e título com a música', () => {
    expect(
      scoreYouTubeCandidate(
        'Despacito Luis Fonsi',
        youtubeItem,
        'Despacito',
        'Luis Fonsi & Daddy Yankee'
      )
    ).toBeGreaterThanOrEqual(50)
  })
})

describe('detectSongRequest', () => {
  it('não chama nenhuma API para conversa comum', async () => {
    const fetchImpl = vi.fn()
    const result = await detectSongRequest('pizza', { fetchImpl })
    expect(result.status).toBe('not_song')
    expect(result.reason).toBe('COMMON_MESSAGE')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('detecta a música pelo iTunes e fica aguardando link sem chave do YouTube', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toContain('itunes.apple.com')
      return jsonResponse({ resultCount: 1, results: [despacitoCandidate] })
    })

    const result = await detectSongRequest('toca Despacito', {
      fetchImpl: fetchImpl as any,
    })

    expect(result.status).toBe('needs_video')
    expect(result.reason).toBe('YOUTUBE_API_KEY_MISSING')
    expect(result.song).toMatchObject({
      title: 'Despacito',
      artist: 'Luis Fonsi & Daddy Yankee',
    })
  })

  it('busca o vídeo oficial quando a chave do YouTube está configurada', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('itunes.apple.com')) {
        return jsonResponse({ resultCount: 1, results: [despacitoCandidate] })
      }
      if (url.includes('googleapis.com/youtube/v3/search')) {
        return jsonResponse({ items: [{ id: { videoId: 'dQw4w9WgXcQ' }, snippet: {
          title: youtubeItem.title,
          channelTitle: youtubeItem.channelTitle,
          thumbnails: { high: { url: youtubeItem.thumbnailUrl } },
        } }] })
      }
      throw new Error(`URL inesperada: ${url}`)
    })

    const result = await detectSongRequest('Despacito', {
      fetchImpl: fetchImpl as any,
      youtubeApiKey: 'test-key',
    })

    expect(result.status).toBe('detected')
    expect(result.source).toBe('itunes_youtube')
    expect(result.song?.videoId).toBe('dQw4w9WgXcQ')
    expect(result.song?.sourceUrl).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
  })

  it('usa a busca direta do YouTube quando o iTunes não encontra', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('itunes.apple.com')) {
        return jsonResponse({ resultCount: 0, results: [] })
      }
      if (url.includes('googleapis.com/youtube/v3/search')) {
        return jsonResponse({ items: [{ id: { videoId: 'dQw4w9WgXcQ' }, snippet: {
          title: youtubeItem.title,
          channelTitle: youtubeItem.channelTitle,
          thumbnails: { high: { url: youtubeItem.thumbnailUrl } },
        } }] })
      }
      throw new Error(`URL inesperada: ${url}`)
    })

    const result = await detectSongRequest('Despacito', {
      fetchImpl: fetchImpl as any,
      youtubeApiKey: 'test-key',
    })

    expect(result.status).toBe('detected')
    expect(result.source).toBe('youtube')
    expect(result.song?.videoId).toBe('dQw4w9WgXcQ')
  })

  it('aceita um link do YouTube e resolve os metadados via oEmbed', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toContain('youtube.com/oembed')
      return jsonResponse({
        title: 'Despacito',
        author_name: 'Luis Fonsi',
        thumbnail_url: 'https://example.com/thumb.jpg',
      })
    })

    const result = await detectSongRequest('toca https://youtu.be/dQw4w9WgXcQ', {
      fetchImpl: fetchImpl as any,
    })

    expect(result.status).toBe('detected')
    expect(result.source).toBe('message_url')
    expect(result.song).toMatchObject({
      title: 'Despacito',
      artist: 'Luis Fonsi',
      videoId: 'dQw4w9WgXcQ',
    })
  })

  it('retorna erro quando o catálogo está indisponível e não há chave', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ message: 'fora do ar' }, 503))
    const result = await detectSongRequest('Despacito', {
      fetchImpl: fetchImpl as any,
    })
    expect(result.status).toBe('error')
    expect(result.reason).toBe('ITUNES_UNAVAILABLE')
  })
})
