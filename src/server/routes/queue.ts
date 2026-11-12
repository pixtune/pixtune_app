import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { authMiddleware, getUserId } from '../middleware/auth.js'
import prisma from '../lib/prisma.js'
import {
  findActiveItem,
  finishCurrent,
  maybeStartItem,
  promoteNextPlayable,
  queueItemInclude,
  sortQueueForDisplay,
} from '../services/queuePriority.js'
import { extractSpotifyTrackId, spotifyTrackUrl } from '../../shared/spotify.js'

import { DEMO_USER } from '../services/auth.js'

const queue = new Hono()

let demoQueueItems: any[] = [
  {
    id: 'demo-track-1',
    title: 'Evidências',
    artist: 'Chitãozinho & Xororó',
    album: 'Grandes Sucessos',
    artworkUrl: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=400&auto=format&fit=crop',
    durationMs: 279000,
    sourceUrl: 'https://open.spotify.com/track/2b9FJrXDumCs12WHGKVpWJ',
    provider: 'spotify',
    providerId: '2b9FJrXDumCs12WHGKVpWJ',
    position: 0,
    addedBy: 'LivePix',
    donationEventId: 'evt-demo-1',
    donationEvent: { amountCents: 5000, donorName: 'Superfan LivePix' },
    status: 'playing',
    playedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  },
  {
    id: 'demo-track-2',
    title: 'Bohemian Rhapsody',
    artist: 'Queen',
    album: 'A Night at the Opera',
    artworkUrl: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=400&auto=format&fit=crop',
    durationMs: 354000,
    sourceUrl: 'https://open.spotify.com/track/7tFiyTwD0nx5a1eklYtX2J',
    provider: 'spotify',
    providerId: '7tFiyTwD0nx5a1eklYtX2J',
    position: 1,
    addedBy: 'LivePix',
    donationEventId: 'evt-demo-2',
    donationEvent: { amountCents: 3500, donorName: 'Gamer_Stream_22' },
    status: 'pending',
    playedAt: null,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'demo-track-3',
    title: 'Blinding Lights',
    artist: 'The Weeknd',
    album: 'After Hours',
    artworkUrl: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=400&auto=format&fit=crop',
    durationMs: 200000,
    sourceUrl: 'https://open.spotify.com/track/0VjIjW4GlUZAMYd2vXMi3b',
    provider: 'spotify',
    providerId: '0VjIjW4GlUZAMYd2vXMi3b',
    position: 2,
    addedBy: 'LivePix',
    donationEventId: 'evt-demo-3',
    donationEvent: { amountCents: 1500, donorName: 'Anônimo' },
    status: 'pending',
    playedAt: null,
    createdAt: new Date().toISOString(),
  },
]

function trackPayload(track: any) {
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
    position: track.position,
    addedBy: track.addedBy,
    donationEventId: track.donationEventId,
    amountCents: track.donationEvent?.amountCents ?? 0,
    donorName: track.donationEvent?.donorName ?? null,
    status: track.status,
    playedAt: track.playedAt,
    createdAt: track.createdAt,
  }
}

// Listar fila do usuário. A ordem é: tocando, pendentes por valor e histórico.
queue.get('/', authMiddleware, async (c) => {
  const userId = getUserId(c)

  if (userId === DEMO_USER.id) {
    return c.json({
      success: true,
      data: {
        items: demoQueueItems.map(trackPayload),
        total: demoQueueItems.length,
      },
    })
  }

  try {
    const items = await prisma.queueItem.findMany({
      where: { userId },
      include: queueItemInclude,
    })
    const ordered = sortQueueForDisplay(items)

    return c.json({
      success: true,
      data: {
        items: ordered.map(trackPayload),
        total: ordered.length,
      },
    })
  } catch (error) {
    // Fallback gracioso caso banco esteja inacessível
    return c.json({
      success: true,
      data: {
        items: demoQueueItems.map(trackPayload),
        total: demoQueueItems.length,
      },
    })
  }
})

// Adicionar item à fila
const addSchema = z.object({
  title: z.string().trim().min(1).max(300),
  artist: z.string().trim().max(300).optional(),
  album: z.string().trim().max(300).optional(),
  artworkUrl: z.string().trim().max(2000).optional(),
  durationMs: z.number().int().min(0).max(24 * 60 * 60 * 1000).optional(),
  sourceUrl: z.string().trim().max(2000).optional(),
  provider: z.enum(['spotify', 'demo']).default('spotify'),
  providerId: z.string().trim().max(200).optional(),
  position: z.number().int().min(0).max(100_000).optional(),
})

queue.post('/', authMiddleware, zValidator('json', addSchema), async (c) => {
  const userId = getUserId(c)
  const { title, artist, album, artworkUrl, durationMs, sourceUrl, provider, providerId, position } =
    c.req.valid('json')

  // Normaliza links/IDs do Spotify para que a faixa seja reproduzível.
  const candidate = providerId || sourceUrl
  const spotifyId = candidate ? extractSpotifyTrackId(candidate) : null
  let normalizedProvider = provider
  let normalizedProviderId = providerId
  let normalizedSourceUrl = sourceUrl
  let normalizedArtworkUrl = artworkUrl

  if (provider === 'spotify' || spotifyId) {
    if (!spotifyId) {
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
    normalizedProvider = 'spotify'
    normalizedProviderId = spotifyId
    normalizedSourceUrl = sourceUrl || spotifyTrackUrl(spotifyId)
    normalizedArtworkUrl = artworkUrl
  }

  // Contagem, deslocamento e criação no mesmo transaction: duas adições
  // simultâneas não podem calcular a mesma posição nem intercalar updates.
  const item = await prisma.$transaction(async (tx) => {
    const newPosition =
      position !== undefined
        ? position
        : await tx.queueItem.count({ where: { userId } })

    await tx.queueItem.updateMany({
      where: { userId, position: { gte: newPosition } },
      data: { position: { increment: 1 } },
    })

    return tx.queueItem.create({
      data: {
        userId,
        title,
        artist,
        album,
        artworkUrl: normalizedArtworkUrl,
        durationMs,
        sourceUrl: normalizedSourceUrl,
        provider: normalizedProvider,
        providerId: normalizedProviderId,
        position: newPosition,
        addedBy: 'streamer',
        status: 'pending',
      },
    })
  })

  return c.json({ success: true, data: trackPayload(item) }, 201)
})

// Anexar/trocar a faixa do Spotify de um item da fila.
// Útil para corrigir um link removido ou um item antigo.
queue.patch(
  '/:id/link',
  authMiddleware,
  zValidator('json', z.object({ url: z.string().min(1) })),
  async (c) => {
    const userId = getUserId(c)
    const id = c.req.param('id')
    const { url } = c.req.valid('json')

    const item = await prisma.queueItem.findFirst({ where: { id, userId } })
    if (!item) {
      return c.json(
        { success: false, error: { code: 'NOT_FOUND', message: 'Item não encontrado' } },
        404
      )
    }

    const spotifyId = extractSpotifyTrackId(url)
    if (!spotifyId) {
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

    const updated = await prisma.queueItem.update({
      where: { id },
      data: {
        provider: 'spotify',
        providerId: spotifyId,
        sourceUrl: spotifyTrackUrl(spotifyId),
        // A capa antiga pode ser de outro provedor; evita exibir arte errada.
        artworkUrl: null,
      },
      include: queueItemInclude,
    })

    // Se o item veio de uma doação que aguardava link, o pedido agora está
    // resolvido e pode aparecer como processado no histórico.
    if (item.donationEventId) {
      await prisma.donationEvent.update({
        where: { id: item.donationEventId },
        data: { status: 'processed', errorMessage: null },
      })
    }

    // O link pode transformar um pedido "aguardando link" na maior doação.
    // Nesse caso ele derruba imediatamente a música de menor valor.
    const started = await maybeStartItem(userId, id)
    return c.json({ success: true, data: trackPayload(started ?? updated) })
  }
)

// Remover item da fila
queue.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')

  const item = await prisma.queueItem.findFirst({ where: { id, userId } })
  if (!item) {
    return c.json(
      { success: false, error: { code: 'NOT_FOUND', message: 'Item não encontrado' } },
      404
    )
  }

  // Remover e reindexar no mesmo transaction para não deixar posições
  // duplicadas se outra requisição chegar no meio.
  await prisma.$transaction(async (tx) => {
    await tx.queueItem.delete({ where: { id } })

    const remaining = await tx.queueItem.findMany({
      where: { userId },
      orderBy: { position: 'asc' },
      select: { id: true },
    })
    for (let i = 0; i < remaining.length; i++) {
      await tx.queueItem.update({
        where: { id: remaining[i].id },
        data: { position: i },
      })
    }
  })

  return c.json({ success: true, data: { removed: id } })
})

// Reordenar fila
queue.patch(
  '/reorder',
  authMiddleware,
  zValidator(
    'json',
    z.object({
      fromIndex: z.number().int().min(0),
      toIndex: z.number().int().min(0),
    })
  ),
  async (c) => {
    const userId = getUserId(c)
    const { fromIndex, toIndex } = c.req.valid('json')

    const donationItems = await prisma.queueItem.count({
      where: { userId, status: 'pending', donationEventId: { not: null } },
    })
    if (donationItems > 0) {
      return c.json(
        {
          success: false,
          error: {
            code: 'PRIORITY_LOCKED',
            message:
              'A ordem das músicas doadas é definida pelo valor da doação e não pode ser alterada.',
          },
        },
        409
      )
    }

    const items = await prisma.queueItem.findMany({
      where: { userId },
      orderBy: { position: 'asc' },
    })

    if (fromIndex >= items.length || toIndex >= items.length) {
      return c.json(
        { success: false, error: { code: 'INVALID_INDEX', message: 'Índice inválido' } },
        400
      )
    }

    const [moved] = items.splice(fromIndex, 1)
    items.splice(toIndex, 0, moved)

    await prisma.$transaction(async (tx) => {
      for (let i = 0; i < items.length; i++) {
        await tx.queueItem.update({
          where: { id: items[i].id },
          data: { position: i },
        })
      }
    })

    return c.json({ success: true, data: { items } })
  }
)

// Limpar fila
queue.delete('/', authMiddleware, async (c) => {
  const userId = getUserId(c)
  await prisma.queueItem.deleteMany({ where: { userId } })
  return c.json({ success: true, data: { cleared: true } })
})

// Embaralhar somente itens manuais. Doações mantêm a prioridade por valor.
queue.post('/shuffle', authMiddleware, async (c) => {
  const userId = getUserId(c)

  const items = await prisma.queueItem.findMany({
    where: { userId, provider: 'spotify', status: 'pending', donationEventId: null },
    orderBy: { position: 'asc' },
  })

  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[items[i], items[j]] = [items[j], items[i]]
  }

  const slots = items.map((item) => item.position).sort((a, b) => a - b)
  await prisma.$transaction(async (tx) => {
    for (let i = 0; i < items.length; i++) {
      await tx.queueItem.update({
        where: { id: items[i].id },
        data: { position: slots[i] },
      })
    }
  })

  return c.json({
    success: true,
    data: {
      items,
      note: 'Somente músicas manuais foram embaralhadas; doações seguem a prioridade por valor.',
    },
  })
})

// Tocar próxima (marcar atual como skipped, maior valor pendente como playing)
queue.post('/next', authMiddleware, async (c) => {
  const userId = getUserId(c)

  if (userId === DEMO_USER.id) {
    const currentPlaying = demoQueueItems.find((i) => i.status === 'playing')
    if (currentPlaying) currentPlaying.status = 'skipped'
    const nextPending = demoQueueItems.find((i) => i.status === 'pending')
    if (nextPending) {
      nextPending.status = 'playing'
      nextPending.playedAt = new Date().toISOString()
    }
    return c.json({
      success: true,
      data: { track: nextPending ? trackPayload(nextPending) : null },
    })
  }

  try {
    await finishCurrent(userId, 'skipped')
    const playing = await promoteNextPlayable(userId)

    return c.json({
      success: true,
      data: { track: playing ? trackPayload(playing) : null },
    })
  } catch (error) {
    return c.json({ success: true, data: { track: null } })
  }
})

// Tocar anterior
queue.post('/previous', authMiddleware, async (c) => {
  const userId = getUserId(c)

  // Enquanto houver doações pendentes, voltar poderia furar a prioridade
  // por valor. O streamer deve usar "Pular próxima" para seguir a fila.
  const pendingDonation = await prisma.queueItem.count({
    where: {
      userId,
      provider: 'spotify',
      status: 'pending',
      providerId: { not: null },
      donationEventId: { not: null },
    },
  })
  if (pendingDonation > 0) {
    return c.json(
      {
        success: false,
        error: {
          code: 'PRIORITY_LOCKED',
          message: 'A fila tem doações pendentes com prioridade por valor. Use Pular próxima.',
        },
      },
      409
    )
  }

  // Buscar última faixa tocada ou pulada
  const lastPlayed = await prisma.queueItem.findFirst({
    where: {
      userId,
      provider: 'spotify',
      providerId: { not: null },
      status: { in: ['played', 'skipped'] },
      playedAt: { not: null },
    },
    include: queueItemInclude,
    orderBy: { playedAt: 'desc' },
  })

  if (!lastPlayed) {
    return c.json({ success: true, data: { track: null } })
  }

  const current = await findActiveItem(userId)
  if (lastPlayed.donationEventId || current?.donationEventId) {
    return c.json(
      {
        success: false,
        error: {
          code: 'PRIORITY_LOCKED',
          message:
            'Voltar não é permitido para músicas doadas: a prioridade é definida pelo valor.',
        },
      },
      409
    )
  }

  // Marcar atual como pending (se houver)
  await prisma.queueItem.updateMany({
    where: { userId, provider: 'spotify', status: { in: ['playing', 'paused'] } },
    data: { status: 'pending', playedAt: null },
  })

  // Marcar lastPlayed como playing
  const playing = await prisma.queueItem.update({
    where: { id: lastPlayed.id },
    data: { status: 'playing', playedAt: new Date() },
    include: queueItemInclude,
  })

  return c.json({ success: true, data: { track: trackPayload(playing) } })
})

export default queue
