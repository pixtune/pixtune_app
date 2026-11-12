import { describe, expect, it } from 'vitest'
import { DEMO_USER, generateToken, validateSession, verifyToken } from './auth.js'

describe('generateToken & session', () => {
  it('gera tokens diferentes para o mesmo usuário no mesmo segundo', () => {
    const first = generateToken({ userId: 'user-1' })
    const second = generateToken({ userId: 'user-1' })

    expect(first).not.toBe(second)
    expect(verifyToken(first)?.userId).toBe('user-1')
    expect(verifyToken(second)?.userId).toBe('user-1')
  })

  it('valida a sessão do usuário demo com sucesso imediato', async () => {
    const token = generateToken({ userId: DEMO_USER.id, sessionToken: 'demo-session-token' })
    const user = await validateSession(token)

    expect(user).not.toBeNull()
    expect(user?.id).toBe(DEMO_USER.id)
    expect(user?.spotifyId).toBe(DEMO_USER.spotifyId)
    expect(user?.email).toBe(DEMO_USER.email)
  })
})
