import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { authMiddleware, getUserId } from '../middleware/auth'
import prisma from '../lib/prisma'
import {
  findActiveItem,
  finishCurrent,
  maybeStartItem,
  promoteNextPlayable,
  queueItemInclude,
  sortQueueForDisplay,
} from '../services/queuePriority'
import { extractSpotifyTrackId, spotifyTrackUrl } from '../../shared/spotify'

const queue = new Hono()

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
})

// Adicionar item à fila
const addSchema = z.object({
  title: z.string().min(1),
  artist: z.string().optional(),
  album: z.string().optional(),
  artworkUrl: z.string().optional(),
  durationMs: z.number().optional(),
  sourceUrl: z.string().optional(),
  provider: z.string().default('spotify'),
  providerId: z.string().optional(),
  position: z.number().optional(),
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
  } else if (provider !== 'demo') {
    return c.json(
      {
        success: false,
        error: {
          code: 'UNSUPPORTED_PROVIDER',
          message: 'O PixTune trabalha apenas com faixas do Spotify.',
        },
      },
      400
    )
  }

  const newPosition = position !== undefined ? position : (await prisma.queueItem.count({ where: { userId } }))

  // Deslocar posições existentes
  await prisma.queueItem.updateMany({
    where: { userId, position: { gte: newPosition } },
    data: { position: { increment: 1 } },
  })

  const item = await prisma.queueItem.create({
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

  await prisma.queueItem.delete({ where: { id } })

  // Reindexar posições
  const remaining = await prisma.queueItem.findMany({
    where: { userId },
    orderBy: { position: 'asc' },
  })
  for (let i = 0; i < remaining.length; i++) {
    await prisma.queueItem.update({
      where: { id: remaining[i].id },
      data: { position: i },
    })
  }

  return c.json({ success: true, data: { removed: id } })
})

// Reordenar fila
queue.patch('/reorder', authMiddleware, zValidator('json', z.object({ fromIndex: z.number(), toIndex: z.number() })), async (c) => {
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
          message: 'A ordem das músicas doadas é definida pelo valor da doação e não pode ser alterada.',
        },
      },
      409
    )
  }

  const items = await prisma.queueItem.findMany({
    where: { userId },
    orderBy: { position: 'asc' },
  })

  if (fromIndex < 0 || fromIndex >= items.length || toIndex < 0 || toIndex >= items.length) {
    return c.json(
      { success: false, error: { code: 'INVALID_INDEX', message: 'Índice inválido' } },
      400
    )
  }

  const [moved] = items.splice(fromIndex, 1)
  items.splice(toIndex, 0, moved)

  for (let i = 0; i < items.length; i++) {
    await prisma.queueItem.update({
      where: { id: items[i].id },
      data: { position: i },
    })
  }

  return c.json({ success: true, data: { items } })
})

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
  for (let i = 0; i < items.length; i++) {
    await prisma.queueItem.update({
      where: { id: items[i].id },
      data: { position: slots[i] },
    })
  }

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

  await finishCurrent(userId, 'skipped')
  const playing = await promoteNextPlayable(userId)

  return c.json({
    success: true,
    data: { track: playing ? trackPayload(playing) : null },
  })
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
