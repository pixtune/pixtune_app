/**
 * Prioridade da fila musical (acesso ao banco).
 *
 * Regra imutável do produto:
 * - a maior doação sempre tem prioridade;
 * - se a nova música tiver valor maior que a música atual, ela derruba a
 *   música atual na hora e começa a tocar;
 * - valores iguais respeitam a ordem de chegada (FIFO);
 * - o streamer não altera a ordem por valor: só define o valor mínimo nas
 *   configurações/regras. O valor de cada doação é fixo.
 *
 * O campo `position` continua existindo por compatibilidade, mas a ordem
 * efetiva é calculada a partir de `DonationEvent.amountCents`.
 */

import prisma from '../lib/prisma'
import {
  compareQueuePriority,
  decidePriorityAction,
  donationAmountCents,
} from './queuePriorityCore'

export {
  compareQueuePriority,
  decidePriorityAction,
  donationAmountCents,
  sortQueueForDisplay,
} from './queuePriorityCore'
export type { PriorityDecision, QueueLike } from './queuePriorityCore'

export const queueItemInclude = {
  donationEvent: {
    select: {
      amountCents: true,
      donorName: true,
      donorMessage: true,
    },
  },
} as const

export async function findActiveItem(userId: string) {
  return prisma.queueItem.findFirst({
    where: { userId, provider: 'spotify', status: { in: ['playing', 'paused'] } },
    include: queueItemInclude,
    orderBy: [{ playedAt: 'desc' }, { createdAt: 'desc' }],
  })
}

/** Próxima faixa pendente que realmente pode ser reproduzida. */
export async function findNextPlayable(userId: string) {
  const pending = await prisma.queueItem.findMany({
    where: {
      userId,
      provider: 'spotify',
      status: 'pending',
      providerId: { not: null },
    },
    include: queueItemInclude,
  })

  return pending.sort(compareQueuePriority)[0] ?? null
}

/** Marca a faixa atual como encerrada/pulada. */
export async function finishCurrent(userId: string, status: 'played' | 'skipped') {
  await prisma.queueItem.updateMany({
    where: { userId, provider: 'spotify', status: { in: ['playing', 'paused'] } },
    data: { status, playedAt: new Date() },
  })
}

export type StartQueueItemResult =
  | { ok: true; track: any }
  | {
      ok: false
      code: 'NOT_FOUND' | 'NO_SPOTIFY_TRACK' | 'PRIORITY_LOCKED'
      message: string
    }

/**
 * Inicia ou retoma um item específico dentro de uma transação.
 *
 * A checagem de prioridade acontece no mesmo transaction da promoção para
 * evitar que uma doação maior chegue entre a validação e o início da faixa.
 */
export async function startQueueItem(
  userId: string,
  itemId: string
): Promise<StartQueueItemResult> {
  return prisma.$transaction(async (tx) => {
    const item = await tx.queueItem.findFirst({
      where: { id: itemId, userId },
      include: queueItemInclude,
    })

    if (!item) {
      return { ok: false, code: 'NOT_FOUND', message: 'Item não encontrado na fila' }
    }
    if (item.provider !== 'spotify' || !item.providerId) {
      return {
        ok: false,
        code: 'NO_SPOTIFY_TRACK',
        message: 'Este item não tem uma faixa do Spotify configurada',
      }
    }

    if (item.status === 'playing') {
      return { ok: true, track: item }
    }

    if (item.status === 'paused') {
      const playing = await tx.queueItem.update({
        where: { id: item.id },
        data: { status: 'playing', playedAt: new Date() },
        include: queueItemInclude,
      })
      return { ok: true, track: playing }
    }

    if (item.status !== 'pending') {
      return {
        ok: false,
        code: 'PRIORITY_LOCKED',
        message: 'Só é possível tocar a música atual ou a próxima da fila.',
      }
    }

    const pending = await tx.queueItem.findMany({
      where: {
        userId,
        provider: 'spotify',
        status: 'pending',
        providerId: { not: null },
      },
      include: queueItemInclude,
    })
    const next = pending.sort(compareQueuePriority)[0] ?? null

    if (!next || next.id !== item.id) {
      return {
        ok: false,
        code: 'PRIORITY_LOCKED',
        message: 'A próxima música é definida pelo maior valor de doação.',
      }
    }

    const current = await tx.queueItem.findFirst({
      where: {
        userId,
        provider: 'spotify',
        status: { in: ['playing', 'paused'] },
      },
      include: queueItemInclude,
      orderBy: [{ playedAt: 'desc' }, { createdAt: 'desc' }],
    })

    // Valores iguais não derrubam a música atual (FIFO).
    if (current && donationAmountCents(current) >= donationAmountCents(item)) {
      return {
        ok: false,
        code: 'PRIORITY_LOCKED',
        message: 'A próxima música é definida pelo maior valor de doação.',
      }
    }

    if (current) {
      await tx.queueItem.update({
        where: { id: current.id },
        data: { status: 'skipped', playedAt: new Date() },
      })
    }

    const playing = await tx.queueItem.update({
      where: { id: item.id },
      data: { status: 'playing', playedAt: new Date() },
      include: queueItemInclude,
    })

    return { ok: true, track: playing }
  })
}

/** Promove a música de maior valor entre as pendentes reproduzíveis. */
export async function promoteNextPlayable(userId: string) {
  return prisma.$transaction(async (tx) => {
    const pending = await tx.queueItem.findMany({
      where: {
        userId,
        provider: 'spotify',
        status: 'pending',
        providerId: { not: null },
      },
      include: queueItemInclude,
    })
    const active = await tx.queueItem.findFirst({
      where: {
        userId,
        provider: 'spotify',
        status: { in: ['playing', 'paused'] },
      },
      include: queueItemInclude,
      orderBy: [{ playedAt: 'desc' }, { createdAt: 'desc' }],
    })

    const next = pending.sort(compareQueuePriority)[0] ?? null
    if (!next) return null

    // Outra requisição pode ter iniciado uma doação maior nesse meio-tempo.
    if (active && donationAmountCents(active) >= donationAmountCents(next)) {
      return active
    }

    if (active) {
      await tx.queueItem.update({
        where: { id: active.id },
        data: { status: 'skipped', playedAt: new Date() },
      })
    }

    return tx.queueItem.update({
      where: { id: next.id },
      data: { status: 'playing', playedAt: new Date() },
      include: queueItemInclude,
    })
  })
}

/**
 * Se o item pendente tiver prioridade, começa a tocá-lo.
 * - valor maior que a música atual: derruba a atual (skipped) e toca;
 * - fila parada: toca se autoPlay estiver ativo (ou se a ação pedir).
 */
export async function maybeStartItem(
  userId: string,
  itemId: string,
  options: { forceWhenIdle?: boolean } = {}
) {
  // A decisão é recalculada dentro da transação: duas doações simultâneas
  // não podem deixar a de menor valor como "playing".
  return prisma.$transaction(async (tx) => {
    const item = await tx.queueItem.findFirst({
      where: { id: itemId, userId },
      include: queueItemInclude,
    })
    const current = await tx.queueItem.findFirst({
      where: {
        userId,
        provider: 'spotify',
        status: { in: ['playing', 'paused'] },
      },
      include: queueItemInclude,
      orderBy: [{ playedAt: 'desc' }, { createdAt: 'desc' }],
    })
    const settings = await tx.settings.findUnique({ where: { userId } })

    if (!item || item.status !== 'pending') return null

    const decision = decidePriorityAction({
      hasCurrent: Boolean(current),
      currentAmountCents: current ? donationAmountCents(current) : 0,
      newAmountCents: donationAmountCents(item),
      playable: item.provider === 'spotify' && Boolean(item.providerId),
      autoPlay: settings?.autoPlay ?? true,
      forceWhenIdle: options.forceWhenIdle,
    })

    if (decision === 'queue') return null

    if (decision === 'preempt') {
      // "Derruba" a música de menor valor: ela não volta para a fila.
      await tx.queueItem.updateMany({
        where: {
          userId,
          provider: 'spotify',
          status: { in: ['playing', 'paused'] },
        },
        data: { status: 'skipped', playedAt: new Date() },
      })
    }

    return tx.queueItem.update({
      where: { id: item.id },
      data: { status: 'playing', playedAt: new Date() },
      include: queueItemInclude,
    })
  })
}
