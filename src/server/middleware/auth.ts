/**
 * Middleware de autenticação JWT com sessão no banco de dados
 *
 * Valida:
 * 1. Token Bearer no header Authorization
 * 2. JWT assinatura válida
 * 3. Sessão ativa no banco de dados
 * 4. Isolamento de dados por userId
 */

import { getCookie } from 'hono/cookie'
import { HTTPException } from 'hono/http-exception'
import { validateSession, type AuthUser } from '../services/auth.js'

const SESSION_COOKIE = 'pixtune_token'

interface ContextVariables {
  user: {
    userId: string
    email: string
  }
}

/**
 * O cliente pode enviar o token via Bearer (localStorage legado) e também ter
 * o cookie HttpOnly. Tentamos o Bearer primeiro, mas se ele estiver velho ou
 * inválido ainda aceitamos o cookie. Isso evita que um token antigo no
 * localStorage derrube uma sessão válida criada pelo OAuth.
 */
export function getSessionTokens(c: any): string[] {
  const authHeader = c.req.header('authorization')
  const bearer = authHeader?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim()
  const cookie = getCookie(c, SESSION_COOKIE)

  return [...new Set([bearer, cookie].filter((value): value is string => Boolean(value)))]
}

export async function resolveSessionUser(c: any): Promise<AuthUser | null> {
  for (const token of getSessionTokens(c)) {
    const user = await validateSession(token)
    if (user) return user
  }
  return null
}

export async function authMiddleware(c: any, next: any) {
  if (getSessionTokens(c).length === 0) {
    throw new HTTPException(401, { message: 'Token de autenticação não fornecido' })
  }

  // Valida o JWT e a sessão persistida no banco.
  const sessionUser = await resolveSessionUser(c)
  if (!sessionUser) {
    throw new HTTPException(401, { message: 'Sessão inválida ou expirada' })
  }

  c.set('user', {
    userId: sessionUser.id,
    email: sessionUser.email ?? '',
  })

  return next()
}

export function getUserId(c: any): string {
  const user = c.get('user') as ContextVariables['user']
  return user?.userId || ''
}
