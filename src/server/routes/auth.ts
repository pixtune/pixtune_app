import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import crypto from 'crypto'
import { createUser, verifyUserCredentials, createSession, hashPassword } from '../services/auth'
import prisma from '../lib/prisma'
import { isFirebaseConfigured, verifyFirebaseIdToken } from '../services/firebaseAdmin'

const auth = new Hono()

const registerSchema = z.object({
  email: z.string().email('E-mail inválido'),
  password: z.string().min(6, 'Senha deve ter pelo menos 6 caracteres'),
  name: z.string().min(1, 'Nome é obrigatório').optional(),
})

const loginSchema = z.object({
  email: z.string().email('E-mail inválido'),
  password: z.string().min(1, 'Senha é obrigatória'),
})

auth.post('/register', zValidator('json', registerSchema), async (c) => {
  const { email, password, name } = c.req.valid('json')

  try {
    const user = await createUser({ email, password, name })
    const token = await createSession(user.id)

    return c.json({
      success: true,
      data: {
        user: { id: user.id, email: user.email, name: user.name },
        token,
      },
    })
  } catch (err: any) {
    if (err.message === 'Usuário já cadastrado') {
      return c.json(
        { success: false, error: { code: 'USER_EXISTS', message: 'Usuário já cadastrado' } },
        409
      )
    }
    return c.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Erro ao cadastrar usuário' } },
      500
    )
  }
})

auth.post('/login', zValidator('json', loginSchema), async (c) => {
  const { email, password } = c.req.valid('json')

  const user = await verifyUserCredentials(email, password)
  if (!user) {
    return c.json(
      { success: false, error: { code: 'INVALID_CREDENTIALS', message: 'Credenciais inválidas' } },
      401
    )
  }

  const token = await createSession(user.id)

  return c.json({
    success: true,
    data: {
      user: { id: user.id, email: user.email, name: user.name },
      token,
    },
  })
})

auth.get('/me', async (c) => {
  const authHeader = c.req.header('authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Não autorizado' } }, 401)
  }

  const token = authHeader.substring(7)
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { validateSession } = await import('../services/auth')
  const sessionUser = await validateSession(token)

  if (!sessionUser) {
    return c.json({ success: false, error: { code: 'INVALID_TOKEN', message: 'Token inválido' } }, 401)
  }

  return c.json({
    success: true,
    data: {
      user: {
        id: sessionUser.id,
        email: sessionUser.email,
        name: sessionUser.name,
        avatarUrl: sessionUser.avatarUrl,
      },
    },
  })
})

auth.post('/logout', async (c) => {
  const authHeader = c.req.header('authorization')
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.substring(7)
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { removeSession } = await import('../services/auth')
    await removeSession(token)
  }
  return c.json({ success: true })
})

// ============================================================
// Login com Google via Firebase Authentication
// ============================================================
// O cliente autentica no Firebase (popup/redirect do provedor Google) e
// envia o ID token. Aqui validamos o token com o firebase-admin e trocamos
// por uma sessão PixTune — o mesmo mecanismo dos logins por e-mail/senha.
// Nenhum segredo do Firebase fica no navegador.

const firebaseLoginSchema = z.object({
  idToken: z.string().min(10, 'ID token inválido'),
})

auth.get('/firebase/status', (c) => {
  return c.json({ success: true, data: { configured: isFirebaseConfigured() } })
})

auth.post('/firebase', zValidator('json', firebaseLoginSchema), async (c) => {
  if (!isFirebaseConfigured()) {
    return c.json(
      {
        success: false,
        error: {
          code: 'FIREBASE_NOT_CONFIGURED',
          message: 'Login com Firebase não está configurado no servidor.',
        },
      },
      503
    )
  }

  const { idToken } = c.req.valid('json')

  try {
    const info = await verifyFirebaseIdToken(idToken)

    if (!info.email) {
      return c.json(
        {
          success: false,
          error: { code: 'FIREBASE_NO_EMAIL', message: 'A conta Google não retornou um e-mail.' },
        },
        400
      )
    }

    const email = info.email.toLowerCase()
    let user = await prisma.user.findFirst({
      where: { OR: [{ firebaseUid: info.uid }, { email }] },
    })

    if (!user) {
      // Conta criada pelo Google/Firebase: senha aleatória inutilizável.
      const passwordHash = await hashPassword(crypto.randomBytes(32).toString('hex'))
      user = await prisma.user.create({
        data: {
          email,
          passwordHash,
          name: info.name,
          avatarUrl: info.picture,
          firebaseUid: info.uid,
        },
      })
      await prisma.settings.create({ data: { userId: user.id } }).catch(() => {})
    } else if (!user.firebaseUid) {
      // Conta já existente (e-mail/senha): vincula o UID do Firebase.
      user = await prisma.user.update({
        where: { id: user.id },
        data: { firebaseUid: info.uid },
      })
    }

    const session = await createSession(user.id)

    return c.json({
      success: true,
      data: {
        user: { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl },
        token: session,
      },
    })
  } catch {
    return c.json(
      {
        success: false,
        error: {
          code: 'FIREBASE_TOKEN_INVALID',
          message: 'Não foi possível validar o login do Firebase.',
        },
      },
      401
    )
  }
})

export default auth
