import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  GoogleOAuthError,
  buildGoogleAuthUrl,
  createNonce,
  fetchYouTubeChannel,
  getGoogleOAuthConfig,
  googleRedirectUri,
  isGoogleOAuthConfigured,
  signOAuthState,
  verifyOAuthState,
  type FetchLike,
} from './googleOAuth.js'

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const ENV_KEYS = [
  'YOUTUBE_CLIENT_ID',
  'YOUTUBE_CLIENT_SECRET',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'API_URL',
  'APP_URL',
] as const

let saved: Record<string, string | undefined> = {}

beforeEach(() => {
  saved = {}
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key]
    delete process.env[key]
  }
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
})

describe('configuração OAuth do Google', () => {
  it('fica desativada sem Client ID/Secret', () => {
    expect(isGoogleOAuthConfigured()).toBe(false)
    expect(getGoogleOAuthConfig()).toBeNull()
  })

  it('lê YOUTUBE_CLIENT_ID/SECRET e aceita aliases GOOGLE_*', () => {
    process.env.YOUTUBE_CLIENT_ID = 'yt-id'
    process.env.YOUTUBE_CLIENT_SECRET = 'yt-secret'
    expect(getGoogleOAuthConfig()).toMatchObject({ clientId: 'yt-id', clientSecret: 'yt-secret' })

    delete process.env.YOUTUBE_CLIENT_ID
    delete process.env.YOUTUBE_CLIENT_SECRET
    process.env.GOOGLE_CLIENT_ID = 'g-id'
    process.env.GOOGLE_CLIENT_SECRET = 'g-secret'
    expect(getGoogleOAuthConfig()).toMatchObject({ clientId: 'g-id', clientSecret: 'g-secret' })
  })

  it('monta as URIs de callback corretas', () => {
    process.env.YOUTUBE_CLIENT_ID = 'id'
    process.env.YOUTUBE_CLIENT_SECRET = 'secret'
    process.env.API_URL = 'http://localhost:3001'
    expect(googleRedirectUri('login')).toBe('http://localhost:3001/api/auth/google/callback')
    expect(googleRedirectUri('youtube')).toBe('http://localhost:3001/api/youtube/callback')
  })
})

describe('state OAuth', () => {
  it('assina e verifica o state', () => {
    const nonce = createNonce()
    const token = signOAuthState({ kind: 'login', nonce })
    expect(verifyOAuthState(token)).toMatchObject({ kind: 'login', nonce })
  })

  it('rejeita state adulterado ou inválido', () => {
    const token = signOAuthState({ kind: 'login', nonce: createNonce() })
    expect(verifyOAuthState(`${token}x`)).toBeNull()
    expect(verifyOAuthState('nao-e-um-jwt')).toBeNull()
  })
})

describe('buildGoogleAuthUrl', () => {
  it('inclui client_id, redirect_uri, escopos, state e access_type', () => {
    process.env.YOUTUBE_CLIENT_ID = 'client-123'
    process.env.YOUTUBE_CLIENT_SECRET = 'secret'
    process.env.API_URL = 'http://localhost:3001'

    const url = new URL(
      buildGoogleAuthUrl({
        kind: 'login',
        state: 'abc',
        scopes: ['openid', 'email', 'profile'],
        prompt: 'select_account',
      })
    )

    expect(`${url.origin}${url.pathname}`).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(url.searchParams.get('client_id')).toBe('client-123')
    expect(url.searchParams.get('redirect_uri')).toBe(
      'http://localhost:3001/api/auth/google/callback'
    )
    expect(url.searchParams.get('scope')).toBe('openid email profile')
    expect(url.searchParams.get('state')).toBe('abc')
    expect(url.searchParams.get('access_type')).toBe('offline')
    expect(url.searchParams.get('prompt')).toBe('select_account')
  })

  it('falha quando o OAuth não está configurado', () => {
    expect(() => buildGoogleAuthUrl({ kind: 'login', state: 'x', scopes: [] })).toThrow(
      GoogleOAuthError
    )
  })
})

describe('fetchYouTubeChannel', () => {
  it('mapeia o primeiro canal retornado', async () => {
    const fakeFetch = vi.fn(async () =>
      jsonResponse({
        items: [
          {
            id: 'UC123',
            snippet: {
              title: 'Meu Canal',
              customUrl: '@meucanal',
              thumbnails: { high: { url: 'https://x/thumb.jpg' } },
            },
            statistics: { subscriberCount: '1500', videoCount: '42', viewCount: '90000' },
          },
        ],
      })
    ) as unknown as FetchLike

    const channel = await fetchYouTubeChannel('token', fakeFetch)
    expect(channel).toMatchObject({
      id: 'UC123',
      title: 'Meu Canal',
      customUrl: '@meucanal',
      thumbnailUrl: 'https://x/thumb.jpg',
      subscriberCount: 1500,
      videoCount: 42,
      viewCount: 90000,
    })
  })

  it('retorna null quando não há canal', async () => {
    const fakeFetch = vi.fn(async () => jsonResponse({ items: [] })) as unknown as FetchLike
    expect(await fetchYouTubeChannel('token', fakeFetch)).toBeNull()
  })

  it('lança erro em resposta de erro', async () => {
    const fakeFetch = vi.fn(async () =>
      jsonResponse({ error: { message: 'forbidden' } }, 403)
    ) as unknown as FetchLike
    await expect(fetchYouTubeChannel('token', fakeFetch)).rejects.toBeInstanceOf(GoogleOAuthError)
  })
})
