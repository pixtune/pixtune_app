import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { authMiddleware, getUserId } from '../middleware/auth'
import prisma from '../lib/prisma'
import {
  donationAmountCents,
  findActiveItem,
  findNextPlayable,
  finishCurrent,
  queueItemInclude,
  startQueueItem,
} from '../services/queuePriority'
import { extractSpotifyTrackId } from '../../shared/spotify'
import {
  fetchSpotifyTrack,
  getSpotifyAccessToken,
  SpotifyError,
} from '../services/spotify'

const music = new Hono()

function trackPayload(track: any) {
  if (!track) return null
  return {
    id: track.id,
    title: track.title,
    artist: track.artist || '',
    album: track.album,
    artworkUrl: track.artworkUrl,
    durationMs: track.durationMs,
    sourceUrl: track.sourceUrl,
    provider: track.provider,
    providerId: track.providerId,
    amountCents: track.donationEvent?.amountCents ?? 0,
    donorName: track.donationEvent?.donorName ?? null,
    status: track.status,
    position: track.position,
  }
}

async function markPlaying(id: string) {
  return prisma.queueItem.update({
    where: { id },
    data: { status: 'playing', playedAt: new Date() },
    include: queueItemInclude,
  })
}

function spotifyError(c: any, error: unknown) {
  const code = error instanceof SpotifyError ? error.code : 'SPOTIFY_UNAVAILABLE'
  const message =
    error instanceof Error ? error.message : 'Não foi possível falar com o Spotify.'
  const status = code === 'NOT_CONNECTED' ? 401 : 502
  return c.json({ success: false, error: { code, message } }, status)
}

// Catálogo de músicas da fila do usuário
music.get('/catalog', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const tracks = await prisma.queueItem.findMany({
    where: { userId, provider: 'spotify' },
    select: {
      id: true,
      title: true,
      artist: true,
      album: true,
      artworkUrl: true,
      durationMs: true,
      provider: true,
      providerId: true,
      sourceUrl: true,
    },
    distinct: ['title', 'artist'],
    take: 50,
  })

  return c.json({
    success: true,
    data: {
      tracks,
      total: tracks.length,
    },
  })
})

// Status de reprodução atual
music.get('/status', authMiddleware, async (c) => {
  const userId = getUserId(c)

  const current = await prisma.queueItem.findFirst({
    where: { userId, provider: 'spotify', status: { in: ['playing', 'paused'] } },
    include: queueItemInclude,
    orderBy: [{ playedAt: 'desc' }, { createdAt: 'desc' }],
  })

  const [settings, pendingCount] = await Promise.all([
    prisma.settings.findUnique({ where: { userId } }),
    prisma.queueItem.count({
      where: { userId, provider: 'spotify', status: 'pending', providerId: { not: null } },
    }),
  ])

  return c.json({
    success: true,
    data: {
      isPlaying: current?.status === 'playing',
      currentTrack: trackPayload(current),
      volume: settings?.defaultVolume ?? 70,
      positionMs: 0,
      durationMs: current?.durationMs ?? 0,
      autoPlay: settings?.autoPlay ?? true,
      hasPending: pendingCount > 0,
      pendingCount,
    },
  })
})

// Resolver link/ID do Spotify em metadados (título, artista, capa e duração).
music.post(
  '/resolve',
  authMiddleware,
  zValidator('json', z.object({ url: z.string().min(1) })),
  async (c) => {
    const userId = getUserId(c)
    const { url } = c.req.valid('json')
    const trackId = extractSpotifyTrackId(url)

    if (!trackId) {
      return c.json(
        {
          success: false,
          error: {
            code: 'INVALID_SPOTIFY_URL',
            message: 'Informe um link ou ID válido de uma faixa do Spotify',
          },
        },
        400
      )
    }

    try {
      const accessToken = await getSpotifyAccessToken(userId)
      const track = await fetchSpotifyTrack(accessToken, trackId)
      return c.json({ success: true, data: track })
    } catch (error) {
      return spotifyError(c, error)
    }
  }
)

// Reproduzir música
music.post('/play', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const body = await c.req.json().catch(() => ({}))

  try {
    await getSpotifyAccessToken(userId)
  } catch (error) {
    return spotifyError(c, error)
  }

  // Se foi passado um trackId, só é permitido tocar a faixa atual ou a
  // próxima da fila (a de maior valor). A validação e a promoção acontecem
  // na mesma transação para não furar a prioridade em uma doação concorrente.
  if (body?.trackId) {
    const result = await startQueueItem(userId, body.trackId)

    if (!result.ok) {
      const status =
        result.code === 'NOT_FOUND' ? 404 : result.code === 'NO_SPOTIFY_TRACK' ? 422 : 409
      return c.json(
        { success: false, error: { code: result.code, message: result.message } },
        status
      )
    }

    return c.json({
      success: true,
      data: { isPlaying: true, track: trackPayload(result.track) },
    })
  }

  // Se já existe uma faixa ativa, retomá-la — a menos que uma doação de valor
  // maior esteja esperando na fila.
  const [active, next] = await Promise.all([
    findActiveItem(userId),
    findNextPlayable(userId),
  ])

  if (active && (!next || donationAmountCents(active) >= donationAmountCents(next))) {
    const playing = await markPlaying(active.id)
    return c.json({ success: true, data: { isPlaying: true, track: trackPayload(playing) } })
  }

  if (next) {
    await finishCurrent(userId, active ? 'skipped' : 'played')
    const playing = await markPlaying(next.id)
    return c.json({ success: true, data: { isPlaying: true, track: trackPayload(playing) } })
  }

  return c.json({
    success: true,
    data: {
      isPlaying: false,
      track: null,
      reason: 'NO_PLAYABLE_TRACK',
    },
  })
})

// Pausar reprodução
music.post('/pause', authMiddleware, async (c) => {
  const userId = getUserId(c)
  await prisma.queueItem.updateMany({
    where: { userId, provider: 'spotify', status: 'playing' },
    data: { status: 'paused' },
  })
  return c.json({ success: true, data: { isPlaying: false } })
})

// Pular para próxima
music.post('/next-track', authMiddleware, async (c) => {
  const userId = getUserId(c)

  await finishCurrent(userId, 'skipped')
  const next = await findNextPlayable(userId)

  if (next) {
    const playing = await markPlaying(next.id)
    return c.json({ success: true, data: { skipped: true, track: trackPayload(playing) } })
  }

  return c.json({ success: true, data: { skipped: true, track: null } })
})

// Faixa terminou naturalmente: marca como tocada e promove a próxima
music.post('/ended', authMiddleware, async (c) => {
  const userId = getUserId(c)

  await finishCurrent(userId, 'played')
  const next = await findNextPlayable(userId)

  if (next) {
    const playing = await markPlaying(next.id)
    return c.json({ success: true, data: { track: trackPayload(playing) } })
  }

  return c.json({ success: true, data: { track: null } })
})

// Persistir a duração real informada pelo player
music.post(
  '/duration',
  authMiddleware,
  zValidator('json', z.object({ trackId: z.string().min(1), durationMs: z.number().positive() })),
  async (c) => {
    const userId = getUserId(c)
    const { trackId, durationMs } = c.req.valid('json')

    await prisma.queueItem.updateMany({
      where: { id: trackId, userId, provider: 'spotify' },
      data: { durationMs: Math.round(durationMs) },
    })

    return c.json({ success: true, data: { trackId, durationMs: Math.round(durationMs) } })
  }
)

// Definir volume
music.post(
  '/volume',
  authMiddleware,
  zValidator('json', z.object({ volume: z.number().min(0).max(100) })),
  async (c) => {
    const userId = getUserId(c)
    const { volume } = c.req.valid('json')

    await prisma.settings.upsert({
      where: { userId },
      update: { defaultVolume: volume },
      create: { userId, defaultVolume: volume },
    })

    return c.json({ success: true, data: { volume } })
  }
)

export default music
