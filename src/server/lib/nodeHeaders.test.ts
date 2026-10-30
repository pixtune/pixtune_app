import { describe, expect, it } from 'vitest'
import { responseHeadersForNode } from './nodeHeaders.js'

describe('responseHeadersForNode', () => {
  it('preserva múltiplos Set-Cookie separados', () => {
    const headers = new Headers()
    headers.set('content-type', 'application/json')
    headers.append('set-cookie', 'pixtune_spotify_nonce=; Max-Age=0; Path=/')
    headers.append('set-cookie', 'pixtune_token=abc; Path=/; HttpOnly')

    const result = responseHeadersForNode(headers)

    expect(result['content-type']).toBe('application/json')
    expect(result['set-cookie']).toEqual([
      'pixtune_spotify_nonce=; Max-Age=0; Path=/',
      'pixtune_token=abc; Path=/; HttpOnly',
    ])
  })
})
