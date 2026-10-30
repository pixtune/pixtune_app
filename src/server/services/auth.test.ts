import { describe, expect, it } from 'vitest'
import { generateToken, verifyToken } from './auth.js'

describe('generateToken', () => {
  it('gera tokens diferentes para o mesmo usuário no mesmo segundo', () => {
    const first = generateToken({ userId: 'user-1' })
    const second = generateToken({ userId: 'user-1' })

    expect(first).not.toBe(second)
    expect(verifyToken(first)?.userId).toBe('user-1')
    expect(verifyToken(second)?.userId).toBe('user-1')
  })
})
