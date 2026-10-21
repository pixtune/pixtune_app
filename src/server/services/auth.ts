/**
 * Serviço de autenticação
 * - Hash de senha com crypto nativo do Node.js (scrypt)
 * - Geração e validação de JWT
 * - Sessões no banco de dados
 */

import crypto from 'crypto'
import JWT, { type SignOptions } from 'jsonwebtoken'
import prisma from '../lib/prisma'

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-change-in-production'

export interface TokenPayload {
  userId: string
  email: string
}

export interface AuthUser {
  id: string
  email: string
  name?: string
  avatarUrl?: string
}

/** Hash de senha usando scrypt (nativo do Node.js) */
export async function hashPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString('hex')
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) reject(err)
      resolve(salt + ':' + derivedKey.toString('hex'))
    })
  })
}

/** Verifica senha */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const [salt, key] = hash.split(':')
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) reject(err)
      resolve(key === derivedKey.toString('hex'))
    })
  })
}

/** Gera JWT */
export function generateToken(payload: TokenPayload, expiresIn = '7d'): string {
  return JWT.sign(payload, JWT_SECRET, { expiresIn: expiresIn as SignOptions['expiresIn'] })
}

/** Valida JWT */
export function verifyToken(token: string): TokenPayload | null {
  try {
    return JWT.verify(token, JWT_SECRET) as TokenPayload
  } catch {
    return null
  }
}

/** Cria sessão no banco */
export async function createSession(userId: string, expiresInDays = 7): Promise<string> {
  const token = generateToken({ userId, email: '' }, `${expiresInDays}d`)
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

/** Valida sessão existente */
export async function validateSession(token: string): Promise<AuthUser | null> {
  const payload = verifyToken(token)
  if (!payload) return null

  const session = await prisma.session.findUnique({
    where: { token },
    include: { user: true },
  })

  if (!session || session.expiresAt < new Date()) {
    await prisma.session.delete({ where: { token } }).catch(() => {})
    return null
  }

  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name ?? undefined,
    avatarUrl: session.user.avatarUrl ?? undefined,
  }
}

/** Remove sessão (logout) */
export async function removeSession(token: string): Promise<void> {
  await prisma.session.delete({ where: { token } }).catch(() => {})
}

/** Busca usuário por email */
export async function findUserByEmail(email: string): Promise<AuthUser | null> {
  const user = await prisma.user.findUnique({ where: { email } })
  if (!user) return null
  return {
    id: user.id,
    email: user.email,
    name: user.name ?? undefined,
    avatarUrl: user.avatarUrl ?? undefined,
  }
}

/** Verifica credenciais e retorna o usuário, ou null */
export async function verifyUserCredentials(email: string, password: string): Promise<AuthUser | null> {
  const user = await prisma.user.findUnique({ where: { email } })
  if (!user) return null

  const valid = await verifyPassword(password, user.passwordHash)
  if (!valid) return null

  return {
    id: user.id,
    email: user.email,
    name: user.name ?? undefined,
    avatarUrl: user.avatarUrl ?? undefined,
  }
}

/** Busca usuário por ID */
export async function findUserById(id: string): Promise<AuthUser | null> {
  const user = await prisma.user.findUnique({ where: { id } })
  if (!user) return null
  return {
    id: user.id,
    email: user.email,
    name: user.name ?? undefined,
    avatarUrl: user.avatarUrl ?? undefined,
  }
}

/** Criar usuário */
export async function createUser(data: {
  email: string
  password: string
  name?: string
}): Promise<AuthUser> {
  const existing = await findUserByEmail(data.email)
  if (existing) throw new Error('Usuário já cadastrado')

  const passwordHash = await hashPassword(data.password)
  const user = await prisma.user.create({
    data: {
      email: data.email,
      passwordHash,
      name: data.name,
    },
  })

  await prisma.settings.create({
    data: {
      userId: user.id,
    },
  })

  return {
    id: user.id,
    email: user.email,
    name: user.name ?? undefined,
    avatarUrl: user.avatarUrl ?? undefined,
  }
}
