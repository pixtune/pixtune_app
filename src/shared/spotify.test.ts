import { describe, expect, it } from 'vitest'
import {
  extractSpotifyPlaylistId,
  extractSpotifyTrackId,
  findSpotifyTrackIdInText,
  normalizeSpotifyTrack,
  spotifyTrackUrl,
  spotifyTrackUri,
} from './spotify'

const TRACK_ID = '4cOdK2wGLETKBW3PvgPWqT'
const PLAYLIST_ID = '37i9dQZF1DXcBWIGoYBM5M'

describe('extractSpotifyTrackId', () => {
  it('aceita ID puro', () => {
    expect(extractSpotifyTrackId(TRACK_ID)).toBe(TRACK_ID)
  })

  it('aceita URL e URI do Spotify', () => {
    expect(extractSpotifyTrackId(`https://open.spotify.com/track/${TRACK_ID}`)).toBe(TRACK_ID)
    expect(extractSpotifyTrackId(`https://open.spotify.com/intl-pt/track/${TRACK_ID}?si=abc`)).toBe(
      TRACK_ID
    )
    expect(extractSpotifyTrackId(`spotify:track:${TRACK_ID}`)).toBe(TRACK_ID)
  })

  it('rejeita links de outros serviços e playlists', () => {
    expect(extractSpotifyTrackId('')).toBeNull()
    expect(extractSpotifyTrackId('abc')).toBeNull()
    expect(extractSpotifyTrackId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBeNull()
    expect(extractSpotifyTrackId(`https://open.spotify.com/playlist/${PLAYLIST_ID}`)).toBeNull()
  })
})

describe('extractSpotifyPlaylistId', () => {
  it('aceita URL e URI de playlist', () => {
    expect(extractSpotifyPlaylistId(`https://open.spotify.com/playlist/${PLAYLIST_ID}`)).toBe(
      PLAYLIST_ID
    )
    expect(extractSpotifyPlaylistId(`spotify:playlist:${PLAYLIST_ID}`)).toBe(PLAYLIST_ID)
  })

  it('não confunde faixa com playlist', () => {
    expect(extractSpotifyPlaylistId(`https://open.spotify.com/track/${TRACK_ID}`)).toBeNull()
  })
})

describe('findSpotifyTrackIdInText', () => {
  it('encontra o link no meio de uma mensagem', () => {
    expect(
      findSpotifyTrackIdInText(`toca https://open.spotify.com/track/${TRACK_ID} por favor`)
    ).toBe(TRACK_ID)
    expect(findSpotifyTrackIdInText(`música: spotify:track:${TRACK_ID}!`)).toBe(TRACK_ID)
  })

  it('encontra o link do Spotify mesmo quando outro link vem antes', () => {
    expect(
      findSpotifyTrackIdInText(
        `olha https://www.youtube.com/watch?v=dQw4w9WgXcQ e toca https://open.spotify.com/track/${TRACK_ID}`
      )
    ).toBe(TRACK_ID)
  })

  it('retorna null quando não há link do Spotify', () => {
    expect(findSpotifyTrackIdInText('Despacito')).toBeNull()
    expect(findSpotifyTrackIdInText('https://vimeo.com/123456')).toBeNull()
  })
})

describe('normalizeSpotifyTrack', () => {
  it('normaliza link em ID e URL canônica', () => {
    expect(normalizeSpotifyTrack(`https://open.spotify.com/track/${TRACK_ID}?si=x`)).toEqual({
      spotifyId: TRACK_ID,
      sourceUrl: `https://open.spotify.com/track/${TRACK_ID}`,
    })
  })

  it('gera URI e URL oficiais', () => {
    expect(spotifyTrackUri(TRACK_ID)).toBe(`spotify:track:${TRACK_ID}`)
    expect(spotifyTrackUrl(TRACK_ID)).toBe(`https://open.spotify.com/track/${TRACK_ID}`)
  })
})
