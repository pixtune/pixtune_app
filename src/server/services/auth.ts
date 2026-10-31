/**
 * Serviço de autenticação
 *
 * O PixTune autentica exclusivamente via Spotify OAuth 2.0 (ver routes/auth.ts).
 * Este serviço cuida da sessão PixTune: JWT assinado, persistência na tabela
 * Session e resolução do usuário autenticado.
 *
 * Não há mais cadastro/login com email e senha: o modelo User não possui
 * passwordHash e o email do Spotify é opcional e não é único.
 */

import crypto from 'crypto'
import prisma from '../lib/prisma.js'
import { signJwt, verifyJwt } from '../lib/jwt.js'

export interface TokenPayload {
  userId: string
  /** Token opaco da sessão, quando o JWT apenas o transporta (formato OAuth). */
  sessionToken?: string
}

export interface AuthUser {
  id: string
  spotifyId: string
  email: string | null
  name?: string
  avatarUrl?: string
}

/** Gera JWT */
export function generateToken(payload: TokenPayload, expiresIn = '7d'): string {
  return signJwt(payload as unknown as Record<string, unknown>, expiresIn, {
    // Sem o jti, dois logins do mesmo usuário no mesmo segundo geram o mesmo
    // JWT (iat com precisão de segundos), colidindo com Session.token unique.
    jwtid: crypto.randomUUID(),
  })
}

/** Valida JWT e devolve um payload utilizável */
export function verifyToken(token: string): TokenPayload | null {
  const decoded = verifyJwt<Partial<TokenPayload>>(token)
  if (!decoded) return null

  if (typeof decoded.userId !== 'string' || !decoded.userId) return null

  return {
    userId: decoded.userId,
    ...(typeof decoded.sessionToken === 'string' ? { sessionToken: decoded.sessionToken } : {}),
  }
}

/** Cria sessão no banco e devolve o token que o cliente deve usar */
export async function createSession(userId: string, expiresInDays = 7): Promise<string> {
  const token = generateToken({ userId }, `${expiresInDays}d`)
  const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)

  await prisma.session.create({
    data: {
      userId,
      token,
      expiresAt,
    },
  })

  return token
}

/**
 * O token recebido pode ser:
 * - o próprio token gravado em Session.token (formato atual);
 * - um JWT que carrega um token opaco de sessão em `sessionToken`.
 *
 * Tentamos as duas formas para manter compatibilidade com sessões criadas
 * antes da unificação do formato.
 */
async function findSession(token: string) {
  const payload = verifyToken(token)
  const candidates =
    payload?.sessionToken && payload.sessionToken !== token
      ? [payload.sessionToken, token]
      : [token]

  for (const candidate of candidates) {
    const session = await prisma.session.findUnique({
      where: { token: candidate },
      include: { user: true },
    })
    if (session) return session
  }

  return null
}

function toAuthUser(user: {
  id: string
  spotifyId: string
  email: string | null
  name: string | null
  avatarUrl: string | null
}): AuthUser {
  return {
    id: user.id,
    spotifyId: user.spotifyId,
    email: user.email,
    name: user.name ?? undefined,
    avatarUrl: user.avatarUrl ?? undefined,
  }
}

/** Valida sessão existente */
export async function validateSession(token: string): Promise<AuthUser | null> {
  const session = await findSession(token)
  if (!session) return null

  if (session.expiresAt < new Date()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {})
    return null
  }

  return toAuthUser(session.user)
}

/** Remove sessão (logout) */
export async function removeSession(token: string): Promise<void> {
  const session = await findSession(token)
  if (session) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {})
  }
}

/** Busca usuário por ID */
export async function findUserById(id: string): Promise<AuthUser | null> {
  const user = await prisma.user.findUnique({ where: { id } })
  if (!user) return null
  return toAuthUser(user)
}
