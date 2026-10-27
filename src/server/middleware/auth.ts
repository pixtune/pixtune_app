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
import { validateSession } from '../services/auth.js'

const SESSION_COOKIE = 'pixtune_token'

interface ContextVariables {
  user: {
    userId: string
    email: string
  }
}

export async function authMiddleware(c: any, next: any) {
  const authHeader = c.req.header('authorization')
  const bearer = authHeader?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim()
  const token = bearer || getCookie(c, SESSION_COOKIE)

  if (!token) {
    throw new HTTPException(401, { message: 'Token de autenticação não fornecido' })
  }

  // Valida o JWT e a sessão persistida no banco.
  const sessionUser = await validateSession(token)
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
