import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { createUser, verifyUserCredentials, createSession } from '../services/auth'

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

export default auth
