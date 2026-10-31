/**
 * Assinatura e validação de JWT da API.
 *
 * O segredo é lido em tempo de execução (e não no import do módulo) para que
 * a ordem de carregamento do `.env` não congele um valor vazio. Em produção,
 * o servidor recusa iniciar sem um segredo forte — ver runtimeConfig.ts.
 */

import JWT, { type SignOptions } from 'jsonwebtoken'

const FALLBACK_SECRET = 'fallback-secret-change-in-production'
const MIN_SECRET_LENGTH = 32

export function getJwtSecret(): string {
  const secret = (process.env.JWT_SECRET || '').trim()

  if (secret.length >= MIN_SECRET_LENGTH && secret !== FALLBACK_SECRET) {
    return secret
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'JWT_SECRET ausente ou fraco. Defina um segredo com pelo menos 32 caracteres em produção.'
    )
  }

  return secret || FALLBACK_SECRET
}

export function signJwt(
  payload: Record<string, unknown>,
  expiresIn: string,
  options: JWT.SignOptions = {}
): string {
  return JWT.sign(payload, getJwtSecret(), {
    expiresIn: expiresIn as SignOptions['expiresIn'],
    ...options,
  })
}

export function verifyJwt<T extends object>(token: string): (T & JWT.JwtPayload) | null {
  try {
    const decoded = JWT.verify(token, getJwtSecret())
    if (!decoded || typeof decoded === 'string') return null
    return decoded as T & JWT.JwtPayload
  } catch {
    return null
  }
}
