import { describe, expect, it } from 'vitest'
import {
  fetchPlaylistTracks,
  normalizeSpotifyPlaylist,
  normalizeSpotifyTrack,
  scoreSpotifyTrack,
  searchSpotifyTrack,
  type FetchLike,
} from './spotify'

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
    images: [
      { url: 'https://i.scdn.co/image/small', width: 64 },
      { url: 'https://i.scdn.co/image/large', width: 640 },
    ],
  },
}

describe('normalizeSpotifyTrack', () => {
  it('converte a resposta da API em faixa da fila', () => {
    expect(normalizeSpotifyTrack(track)).toEqual({
      id: TRACK_ID,
      uri: `spotify:track:${TRACK_ID}`,
      title: 'Evidências',
      artist: 'Chitãozinho & Xororó',
      album: 'Evidências',
      artworkUrl: 'https://i.scdn.co/image/large',
      durationMs: 280000,
      sourceUrl: `https://open.spotify.com/track/${TRACK_ID}`,
      isPlayable: true,
    })
  })

  it('ignora itens sem ID', () => {
    expect(normalizeSpotifyTrack(null)).toBeNull()
    expect(normalizeSpotifyTrack({ name: 'Sem ID' })).toBeNull()
  })
})

describe('scoreSpotifyTrack', () => {
  it('prefere o título exato e o artista correto', () => {
    const exact = scoreSpotifyTrack('Evidências', {
      title: 'Evidências',
      artist: 'Chitãozinho & Xororó',
    })
    const karaoke = scoreSpotifyTrack('Evidências', {
      title: 'Evidências (Karaoke)',
      artist: 'Karaoke',
    })
    expect(exact).toBeGreaterThan(karaoke)
  })

  it('rejeita título sem relação', () => {
    expect(scoreSpotifyTrack('Evidências', { title: 'Outra música', artist: 'Outro' })).toBe(0)
  })
})

describe('searchSpotifyTrack', () => {
  it('escolhe o melhor resultado da busca oficial', async () => {
    const fakeFetch: FetchLike = async () =>
      new Response(
        JSON.stringify({
          tracks: {
            items: [
              track,
              {
                ...track,
                id: '0VjIjW4GlUZAMYd2vXMi3b',
                name: 'Evidências (Karaoke)',
                artists: [{ name: 'Karaoke' }],
              },
            ],
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )

    const result = await searchSpotifyTrack('token', 'Evidências', fakeFetch)
    expect(result?.id).toBe(TRACK_ID)
  })

  it('retorna null quando nenhum resultado é bom o suficiente', async () => {
    const fakeFetch: FetchLike = async () =>
      new Response(
        JSON.stringify({
          tracks: {
            items: [{ ...track, name: 'Música completamente diferente' }],
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )

    expect(await searchSpotifyTrack('token', 'Evidências', fakeFetch)).toBeNull()
  })
})

describe('fetchPlaylistTracks', () => {
  it('usa /items e pagina em blocos de 50 até o limite', async () => {
    const requestedUrls: string[] = []
    const fakeFetch: FetchLike = async (input) => {
      requestedUrls.push(input)
      const offset = new URL(input).searchParams.get('offset')
      const count = offset === '0' ? 50 : 1
      const items = Array.from({ length: count }, (_, index) => ({
        item: {
          ...track,
          id: `A${String((offset === '0' ? index : 50) + index).padStart(21, '0')}`,
        },
      }))

      return new Response(JSON.stringify({ items }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const result = await fetchPlaylistTracks('token', 'playlist-id', fakeFetch, 100)

    expect(result).toHaveLength(51)
    expect(requestedUrls[0]).toContain('/playlists/playlist-id/items?limit=50&offset=0')
    expect(requestedUrls[1]).toContain('/playlists/playlist-id/items?limit=50&offset=50')
  })
})

describe('normalizeSpotifyPlaylist', () => {
  it('converte playlist da API', () => {
    expect(
      normalizeSpotifyPlaylist({
        id: '37i9dQZF1DXcBWIGoYBM5M',
        name: 'Top Brasil',
        description: 'As mais tocadas',
        images: [{ url: 'https://i.scdn.co/image/playlist', width: 300 }],
        tracks: { total: 50 },
        owner: { display_name: 'Spotify' },
        public: true,
      })
    ).toEqual({
      id: '37i9dQZF1DXcBWIGoYBM5M',
      name: 'Top Brasil',
      description: 'As mais tocadas',
      imageUrl: 'https://i.scdn.co/image/playlist',
      trackCount: 50,
      owner: 'Spotify',
      public: true,
      collaborative: undefined,
    })
  })
})
