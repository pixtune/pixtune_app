import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { HTTPException } from 'hono/http-exception'
import { prettyJSON } from 'hono/pretty-json'
import authRoutes from './routes/auth.js'
import donationRoutes from './routes/donation.js'
import queueRoutes from './routes/queue.js'
import musicRoutes from './routes/music.js'
import settingsRoutes from './routes/settings.js'
import rulesRoutes from './routes/rules.js'
import spotifyRoutes from './routes/spotify.js'
import { describeError, logEvent } from './lib/logger.js'

const app = new Hono()

const isProduction = process.env.NODE_ENV === 'production'

function normalizeOrigin(origin: string): string {
  return origin.trim().replace(/\/+$/, '')
}

// Origens permitidas: por padrão o dev local. Em produção use CORS_ORIGINS
// (URLs separadas por vírgula) ou APP_URL. O proxy same-origin do Cloudflare
// Pages não depende de CORS; isso serve apenas para acesso direto à API.
const configuredOrigins = (
  process.env.CORS_ORIGINS ||
  (isProduction
    ? process.env.APP_URL || ''
    : 'http://localhost:3000,http://127.0.0.1:3000')
)
  .split(',')
  .map(normalizeOrigin)
  .filter(Boolean)

const corsOrigins = configuredOrigins.length > 0 ? configuredOrigins : undefined

// Log enxuto: nunca registra query string (authorization code/state do OAuth).
app.use('*', async (c, next) => {
  const startedAt = Date.now()
  await next()
  console.info(`${c.req.method} ${c.req.path} ${c.res.status} ${Date.now() - startedAt}ms`)
})

app.use('*', async (c, next) => {
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('Referrer-Policy', 'no-referrer')
  c.header('X-Frame-Options', 'DENY')
  if (c.req.path.startsWith('/api/')) {
    c.header('Cache-Control', 'no-store')
  }
  await next()
})

app.use(
  '*',
  cors({
    origin: corsOrigins,
    credentials: true,
  })
)

// Em desenvolvimento o JSON identado ajuda no debug; em produção ele só
// aumenta a resposta.
if (!isProduction) {
  app.use('*', prettyJSON())
}

// Normaliza os erros do zValidator, que por padrão respondem
// { success: false, error: { issues: [...] } } sem uma mensagem legível.
// O cliente PixTune espera sempre { success: false, error: { code, message } }.
app.use('*', async (c, next) => {
  await next()

  if (c.res.status !== 400) return
  const contentType = c.res.headers.get('content-type') || ''
  if (!contentType.includes('application/json')) return

  const body = (await c.res
    .clone()
    .json()
    .catch(() => null)) as
    | { success?: boolean; error?: { code?: string; message?: string; issues?: unknown } }
    | null

  if (!body || body.success !== false || !body.error) return
  if (body.error.code === 'VALIDATION_ERROR' || body.error.message) return

  const issues = Array.isArray(body.error.issues) ? body.error.issues : []
  const message =
    issues.length > 0
      ? issues
          .map((issue) => {
            const value = issue as { path?: unknown; message?: unknown }
            const path = Array.isArray(value.path) ? value.path.join('.') : ''
            const detail =
              typeof value.message === 'string' ? value.message : 'valor inválido'
            return path ? `${path}: ${detail}` : detail
          })
          .join('; ')
      : 'Dados inválidos na requisição.'

  c.res = c.json(
    {
      success: false,
      error: { code: 'VALIDATION_ERROR', message, details: issues },
    },
    400
  )
})

// Health check
app.get('/health', (c) => {
  return c.json({ status: 'ok', service: 'pixtune-api', timestamp: new Date().toISOString() })
})

// Routes
app.route('/api/auth', authRoutes)
app.route('/api/donations', donationRoutes)
app.route('/api/queue', queueRoutes)
app.route('/api/music', musicRoutes)
app.route('/api/settings', settingsRoutes)
app.route('/api/rules', rulesRoutes)
app.route('/api/spotify', spotifyRoutes)

app.notFound((c) => {
  return c.json(
    { success: false, error: { code: 'NOT_FOUND', message: 'Rota não encontrada.' } },
    404
  )
})

app.onError((error, c) => {
  if (error instanceof HTTPException) {
    const status = error.status
    const message =
      error.message ||
      (status === 401
        ? 'Não autenticado.'
        : status === 403
          ? 'Acesso negado.'
          : 'Requisição inválida.')
    return c.json(
      {
        success: false,
        error: {
          code:
            status === 401
              ? 'UNAUTHORIZED'
              : status === 403
                ? 'FORBIDDEN'
                : status === 404
                  ? 'NOT_FOUND'
                  : 'HTTP_ERROR',
          message,
        },
      },
      status
    )
  }

  // Corpo JSON malformado ou tipos inválidos não são erro 500.
  if (error instanceof SyntaxError) {
    return c.json(
      {
        success: false,
        error: { code: 'INVALID_JSON', message: 'O corpo da requisição não é um JSON válido.' },
      },
      400
    )
  }

  logEvent('error', 'api.unhandled_error', {
    method: c.req.method,
    path: c.req.path,
    error: describeError(error),
  })

  return c.json(
    {
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Erro interno do servidor. Tente novamente em instantes.',
      },
    },
    500
  )
})

export { app }
export type AppType = typeof app
