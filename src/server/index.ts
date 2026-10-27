import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { prettyJSON } from 'hono/pretty-json'
import authRoutes from './routes/auth.js'
import donationRoutes from './routes/donation.js'
import queueRoutes from './routes/queue.js'
import musicRoutes from './routes/music.js'
import settingsRoutes from './routes/settings.js'
import rulesRoutes from './routes/rules.js'
import spotifyRoutes from './routes/spotify.js'

const app = new Hono()

// Origens permitidas: por padrão o dev local. Em produção defina CORS_ORIGINS
// com as URLs separadas por vírgula.
const corsOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3000,http://127.0.0.1:3000')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

// Middleware
app.use('*', logger())
app.use('*', prettyJSON())
app.use('*', cors({
  origin: corsOrigins,
  credentials: true,
}))

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

export { app }
export type AppType = typeof app