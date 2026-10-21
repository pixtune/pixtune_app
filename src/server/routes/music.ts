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
} from '../services/queuePriority'
import { extractYouTubeId, youTubeThumbnailUrl, youTubeWatchUrl } from '../../shared/youtube'
import { resolveYouTubeVideo } from '../services/youtube'

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

// Catálogo de músicas da fila do usuário
music.get('/catalog', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const tracks = await prisma.queueItem.findMany({
    where: { userId },
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
    where: { userId, status: { in: ['playing', 'paused'] } },
    include: queueItemInclude,
    orderBy: [{ playedAt: 'desc' }, { createdAt: 'desc' }],
  })

  const [settings, pendingCount] = await Promise.all([
    prisma.settings.findUnique({ where: { userId } }),
    prisma.queueItem.count({ where: { userId, status: 'pending', providerId: { not: null } } }),
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

// Resolver link/ID do YouTube em metadados (título, autor e thumbnail).
// Usa o endpoint público oEmbed do YouTube; não requer chave de API.
music.post('/resolve', authMiddleware, zValidator('json', z.object({ url: z.string().min(1) })), async (c) => {
  const { url } = c.req.valid('json')
  const videoId = extractYouTubeId(url)

  if (!videoId) {
    return c.json(
      {
        success: false,
        error: {
          code: 'INVALID_YOUTUBE_URL',
          message: 'Informe um link ou ID válido do YouTube',
        },
      },
      400
    )
  }

  const fallback = {
    videoId,
    title: 'Vídeo do YouTube',
    artist: 'YouTube',
    artworkUrl: youTubeThumbnailUrl(videoId),
    sourceUrl: youTubeWatchUrl(videoId),
  }

  try {
    const resolved = await resolveYouTubeVideo(videoId)
    return c.json({ success: true, data: resolved })
  } catch {
    // Sem internet ou oEmbed indisponível: o player ainda pode tocar pelo ID.
    return c.json({ success: true, data: fallback })
  }
})

// Reproduzir música
music.post('/play', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const body = await c.req.json().catch(() => ({}))

  // Se foi passado um trackId, só é permitido tocar a faixa atual ou a
  // próxima da fila (a de maior valor). Isso preserva a regra imutável de
  // prioridade, mesmo com cliques manuais do streamer.
  if (body?.trackId) {
    const track = await prisma.queueItem.findFirst({
      where: { id: body.trackId, userId },
      include: queueItemInclude,
    })

    if (!track) {
      return c.json(
        { success: false, error: { code: 'NOT_FOUND', message: 'Item não encontrado na fila' } },
        404
      )
    }

    if (!track.providerId || !extractYouTubeId(track.providerId)) {
      return c.json(
        {
          success: false,
          error: {
            code: 'NO_YOUTUBE_VIDEO',
            message: 'Este item não tem um vídeo do YouTube configurado',
          },
        },
        422
      )
    }

    if (track.status === 'pending') {
      const [next, current] = await Promise.all([
        findNextPlayable(userId),
        findActiveItem(userId),
      ])
      const outranksCurrent =
        !current ||
        current.id === track.id ||
        donationAmountCents(track) > donationAmountCents(current)

      if (!next || next.id !== track.id || !outranksCurrent) {
        return c.json(
          {
            success: false,
            error: {
              code: 'PRIORITY_LOCKED',
              message: 'A próxima música é definida pelo maior valor de doação.',
            },
          },
          409
        )
      }
    } else if (track.status !== 'playing' && track.status !== 'paused') {
      return c.json(
        {
          success: false,
          error: {
            code: 'PRIORITY_LOCKED',
            message: 'Só é possível tocar a música atual ou a próxima da fila.',
          },
        },
        409
      )
    }

    await finishCurrent(userId, 'played')
    const playing = await markPlaying(track.id)

    return c.json({ success: true, data: { isPlaying: true, track: trackPayload(playing) } })
  }

  // Se existe uma faixa pausada, retomá-la — a menos que uma doação de valor
  // maior esteja esperando na fila.
  const [paused, next] = await Promise.all([
    prisma.queueItem.findFirst({
      where: { userId, status: 'paused', providerId: { not: null } },
      include: queueItemInclude,
      orderBy: [{ playedAt: 'desc' }, { createdAt: 'desc' }],
    }),
    findNextPlayable(userId),
  ])

  if (paused && (!next || donationAmountCents(paused) >= donationAmountCents(next))) {
    await finishCurrent(userId, 'played')
    const playing = await markPlaying(paused.id)
    return c.json({ success: true, data: { isPlaying: true, track: trackPayload(playing) } })
  }

  if (next) {
    await finishCurrent(userId, paused ? 'skipped' : 'played')
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
    where: { userId, status: 'playing' },
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

// Persistir a duração real informada pelo player do YouTube
music.post(
  '/duration',
  authMiddleware,
  zValidator('json', z.object({ trackId: z.string().min(1), durationMs: z.number().positive() })),
  async (c) => {
    const userId = getUserId(c)
    const { trackId, durationMs } = c.req.valid('json')

    await prisma.queueItem.updateMany({
      where: { id: trackId, userId },
      data: { durationMs: Math.round(durationMs) },
    })

    return c.json({ success: true, data: { trackId, durationMs: Math.round(durationMs) } })
  }
)

// Definir volume
music.post('/volume', authMiddleware, zValidator('json', z.object({ volume: z.number().min(0).max(100) })), async (c) => {
  const userId = getUserId(c)
  const { volume } = c.req.valid('json')

  await prisma.settings.upsert({
    where: { userId },
    update: { defaultVolume: volume },
    create: { userId, defaultVolume: volume },
  })

  return c.json({ success: true, data: { volume } })
})

export default music
