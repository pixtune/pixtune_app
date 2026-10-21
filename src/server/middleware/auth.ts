/**
 * Middleware de autenticação JWT com sessão no banco de dados
 *
 * Valida:
 * 1. Token Bearer no header Authorization
 * 2. JWT assinatura válida
 * 3. Sessão ativa no banco de dados
 * 4. Isolamento de dados por userId
 */

import { HTTPException } from 'hono/http-exception'
import { verifyToken, validateSession } from '../services/auth'

interface ContextVariables {
  user: {
    userId: string
    email: string
  }
}

export async function authMiddleware(c: any, next: any) {
  const authHeader = c.req.header('authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new HTTPException(401, { message: 'Token de autenticação não fornecido' })
  }

  const token = authHeader.substring(7)

  // Validar JWT
  const payload = verifyToken(token)
  if (!payload) {
    throw new HTTPException(401, { message: 'Token inválido ou expirado' })
  }

  // Validar sessão no banco
  const sessionUser = await validateSession(token)
  if (!sessionUser) {
    throw new HTTPException(401, { message: 'Sessão inválida ou expirada' })
  }

  c.set('user', {
    userId: sessionUser.id,
    email: sessionUser.email,
  })

  return next()
}

export function getUserId(c: any): string {
  const user = c.get('user') as ContextVariables['user']
  return user?.userId || ''
}
