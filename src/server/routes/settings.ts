import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { authMiddleware, getUserId } from '../middleware/auth.js'
import prisma from '../lib/prisma.js'
import {
  getSongRequestSettings,
  saveSongRequestSettings,
  type SongRequestAction,
} from '../services/songRequestSettings.js'
import { isSpotifyConfigured } from '../services/spotify.js'

const settings = new Hono()

function parseMetadata(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

interface IntegrationFlags {
  livepix: { isActive: boolean; metadata: string | null } | null
  spotify: { isActive: boolean; accessToken: string | null } | null
}

function responsePayload(
  userSettings: any,
  songRequest: { enabled: boolean; minAmountCents: number; action: SongRequestAction },
  connections: IntegrationFlags
) {
  const livepixMeta = parseMetadata(connections.livepix?.metadata)
  // A fonte de verdade é a Integration. O Settings.livepixConnected nunca era
  // atualizado e podia ficar eternamente false mesmo com o LivePix conectado.
  const livepixConnected = Boolean(
    connections.livepix?.isActive &&
      livepixMeta.clientId &&
      livepixMeta.clientSecret &&
      livepixMeta.accountId
  )
  const musicConnected = Boolean(
    connections.spotify?.isActive && connections.spotify.accessToken
  )

  return {
    livepixConnected,
    musicProvider: userSettings?.musicProvider ?? 'spotify',
    musicConnected,
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
    spotifyConfigured: isSpotifyConfigured(),
  }
}

async function loadConnections(userId: string): Promise<IntegrationFlags> {
  const integrations = await prisma.integration.findMany({
    where: { userId, type: { in: ['livepix', 'spotify'] } },
    select: { type: true, isActive: true, accessToken: true, metadata: true },
  })

  return {
    livepix: integrations.find((item) => item.type === 'livepix') ?? null,
    spotify: integrations.find((item) => item.type === 'spotify') ?? null,
  }
}

// Obter configurações do usuário
settings.get('/', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const [userSettings, songRequest, connections] = await Promise.all([
    prisma.settings.findUnique({ where: { userId } }),
    getSongRequestSettings(userId),
    loadConnections(userId),
  ])

  return c.json({
    success: true,
    data: responsePayload(userSettings, songRequest, connections),
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

  const [userSettings, songRequest, connections] = await Promise.all([
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
    loadConnections(userId),
  ])

  return c.json({
    success: true,
    data: responsePayload(userSettings, songRequest, connections),
  })
})

export default settings
