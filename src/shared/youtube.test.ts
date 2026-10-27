import { describe, expect, it } from 'vitest'
import {
  extractYouTubeId,
  findYouTubeIdInText,
  normalizeYouTubeTrack,
  youTubeWatchUrl,
} from './youtube.js'

describe('extractYouTubeId', () => {
  it('aceita ID puro', () => {
    expect(extractYouTubeId('dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
  })

  it('aceita links watch, youtu.be, shorts, embed e live', () => {
    expect(extractYouTubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
    expect(extractYouTubeId('https://youtu.be/dQw4w9WgXcQ?si=abc')).toBe('dQw4w9WgXcQ')
    expect(extractYouTubeId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
    expect(extractYouTubeId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
    expect(extractYouTubeId('https://www.youtube.com/live/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
  })

  it('aceita Music e links sem protocolo', () => {
    expect(extractYouTubeId('music.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
    expect(extractYouTubeId('youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
  })

  it('rejeita entradas inválidas ou de outros domínios', () => {
    expect(extractYouTubeId('')).toBeNull()
    expect(extractYouTubeId('abc')).toBeNull()
    expect(extractYouTubeId('https://vimeo.com/123456')).toBeNull()
    expect(extractYouTubeId('https://www.youtube.com/watch?v=curto')).toBeNull()
    expect(extractYouTubeId('https://www.youtube.com/watch?list=PL123')).toBeNull()
  })
})

describe('normalizeYouTubeTrack', () => {
  it('gera URL canônica e thumbnail', () => {
    const track = normalizeYouTubeTrack('https://youtu.be/dQw4w9WgXcQ')
    expect(track).toEqual({
      videoId: 'dQw4w9WgXcQ',
      sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      artworkUrl: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
    })
    expect(youTubeWatchUrl('dQw4w9WgXcQ')).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
  })

  it('retorna null para link inválido', () => {
    expect(normalizeYouTubeTrack('https://example.com/video')).toBeNull()
  })
})

describe('findYouTubeIdInText', () => {
  it('encontra um link dentro da mensagem da doação', () => {
    expect(
      findYouTubeIdInText('toca https://youtu.be/dQw4w9WgXcQ por favor')
    ).toBe('dQw4w9WgXcQ')
    expect(
      findYouTubeIdInText('música: https://www.youtube.com/watch?v=dQw4w9WgXcQ!')
    ).toBe('dQw4w9WgXcQ')
  })

  it('não confunde texto comum com link', () => {
    expect(findYouTubeIdInText('Despacito')).toBeNull()
    expect(findYouTubeIdInText('https://vimeo.com/123456')).toBeNull()
  })
})
