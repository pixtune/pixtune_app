import { describe, expect, it } from 'vitest'
import { detectSpotifySongRequest, spotifySongRequestReasonMessage } from './spotifySongRequest'
import type { FetchLike } from './spotify'

const TRACK_ID = '4cOdK2wGLETKBW3PvgPWqT'

const track = {
  id: TRACK_ID,
  name: 'Evidências',
  uri: `spotify:track:${TRACK_ID}`,
  duration_ms: 280000,
  is_playable: true,
  external_urls: { spotify: `https://open.spotify.com/track/${TRACK_ID}` },
  artists: [{ name: 'Chitãozinho & Xororó' }],
  album: {
    name: 'Evidências',
    images: [{ url: 'https://i.scdn.co/image/large', width: 640 }],
  },
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('detectSpotifySongRequest', () => {
  it('resolve um link de faixa do Spotify', async () => {
    const fakeFetch: FetchLike = async (url) => {
      expect(url).toContain(`/tracks/${TRACK_ID}`)
      return jsonResponse(track)
    }

    const result = await detectSpotifySongRequest(
      `toca https://open.spotify.com/track/${TRACK_ID}`,
      { accessToken: 'token', fetchImpl: fakeFetch }
    )

    expect(result.status).toBe('detected')
    expect(result.source).toBe('message_url')
    expect(result.song?.providerId).toBe(TRACK_ID)
    expect(result.song?.title).toBe('Evidências')
  })

  it('busca pelo nome quando não há link', async () => {
    const fakeFetch: FetchLike = async (url) => {
      expect(url).toContain('/search')
      return jsonResponse({ tracks: { items: [track] } })
    }

    const result = await detectSpotifySongRequest('toca Evidências', {
      accessToken: 'token',
      fetchImpl: fakeFetch,
    })

    expect(result.status).toBe('detected')
    expect(result.source).toBe('spotify_search')
    expect(result.song?.providerId).toBe(TRACK_ID)
  })

  it('ignora link do YouTube', async () => {
    const result = await detectSpotifySongRequest(
      'toca https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      { accessToken: 'token' }
    )
    expect(result.status).toBe('not_song')
    expect(result.reason).toBe('YOUTUBE_LINK_NOT_SUPPORTED')
  })

  it('ignora conversa comum', async () => {
    const result = await detectSpotifySongRequest('oi', { accessToken: 'token' })
    expect(result.status).toBe('not_song')
    expect(result.reason).toBe('COMMON_MESSAGE')
  })

  it('retorna não encontrado quando a busca não tem bom resultado', async () => {
    const fakeFetch: FetchLike = async () =>
      jsonResponse({
        tracks: {
          items: [{ ...track, name: 'Música completamente diferente' }],
        },
      })

    const result = await detectSpotifySongRequest('Evidências', {
      accessToken: 'token',
      fetchImpl: fakeFetch,
    })
    expect(result.status).toBe('not_song')
    expect(result.reason).toBe('NOT_FOUND')
  })

  it('explica a ausência de conexão', () => {
    expect(spotifySongRequestReasonMessage('SPOTIFY_NOT_CONNECTED')).toContain(
      'Configurações > Spotify'
    )
  })
})
