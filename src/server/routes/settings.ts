import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { authMiddleware, getUserId } from '../middleware/auth'
import prisma from '../lib/prisma'
import {
  getSongRequestSettings,
  saveSongRequestSettings,
  type SongRequestAction,
} from '../services/songRequestSettings'

const settings = new Hono()

function responsePayload(userSettings: any, songRequest: { enabled: boolean; minAmountCents: number; action: SongRequestAction }) {
  return {
    livepixConnected: userSettings?.livepixConnected ?? false,
    musicProvider: userSettings?.musicProvider ?? 'youtube',
    musicConnected: userSettings?.musicConnected ?? false,
    autoPlay: userSettings?.autoPlay ?? true,
    defaultVolume: userSettings?.defaultVolume ?? 70,
    crossfade: userSettings?.crossfade ?? false,
    // Campos legados mantidos para compatibilidade com bancos existentes.
    // A aparência agora é controlada por preferências locais de acessibilidade.
    theme: userSettings?.theme ?? 'dark',
    compactMode: userSettings?.compactMode ?? false,
    songRequestEnabled: songRequest.enabled,
    songRequestMinAmount: songRequest.minAmountCents,
    songRequestAction: songRequest.action,
    youtubeSearchConfigured: Boolean(process.env.YOUTUBE_API_KEY?.trim()),
  }
}

// Obter configurações do usuário
settings.get('/', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const [userSettings, songRequest] = await Promise.all([
    prisma.settings.findUnique({ where: { userId } }),
    getSongRequestSettings(userId),
  ])

  return c.json({
    success: true,
    data: responsePayload(userSettings, songRequest),
  })
})

// Atualizar configurações
const updateSchema = z.object({
  autoPlay: z.boolean().optional(),
  defaultVolume: z.number().min(0).max(100).optional(),
  crossfade: z.boolean().optional(),
  theme: z.enum(['dark', 'light', 'system']).optional(),
  compactMode: z.boolean().optional(),
  musicProvider: z.enum(['demo', 'youtube', 'spotify', 'local']).optional(),
  songRequestEnabled: z.boolean().optional(),
  songRequestMinAmount: z.number().int().min(0).max(100_000_00).optional(),
  songRequestAction: z.enum(['add_to_queue', 'play_next', 'ignore']).optional(),
})

settings.patch('/', authMiddleware, zValidator('json', updateSchema), async (c) => {
  const userId = getUserId(c)
  const {
    songRequestEnabled,
    songRequestMinAmount,
    songRequestAction,
    ...userSettingsUpdates
  } = c.req.valid('json')

  const hasUserSettingsUpdates = Object.keys(userSettingsUpdates).length > 0

  const [userSettings, songRequest] = await Promise.all([
    hasUserSettingsUpdates
      ? prisma.settings.upsert({
          where: { userId },
          update: userSettingsUpdates,
          create: { userId, ...userSettingsUpdates },
        })
      : prisma.settings.findUnique({ where: { userId } }),
    songRequestEnabled !== undefined ||
    songRequestMinAmount !== undefined ||
    songRequestAction !== undefined
      ? saveSongRequestSettings(userId, {
          enabled: songRequestEnabled,
          minAmountCents: songRequestMinAmount,
          action: songRequestAction,
        })
      : getSongRequestSettings(userId),
  ])

  return c.json({
    success: true,
    data: responsePayload(userSettings, songRequest),
  })
})

export default settings
