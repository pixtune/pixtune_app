/**
 * Regras puras de prioridade da fila (sem banco de dados).
 *
 * A prioridade é definida exclusivamente pelo valor da doação:
 * - maior valor primeiro;
 * - valores iguais respeitam a ordem de chegada;
 * - a nova música só derruba a atual se o valor for estritamente maior.
 */

export type QueueLike = {
  createdAt: Date | string
  position: number
  status?: string
  playedAt?: Date | string | null
  donationEvent?: { amountCents: number } | null
}

export type PriorityDecision = 'preempt' | 'start' | 'queue'

function timeOf(value: Date | string | null | undefined): number {
  if (!value) return 0
  return value instanceof Date ? value.getTime() : new Date(value).getTime()
}

/** Valor que define a prioridade. Itens manuais valem 0. */
export function donationAmountCents(item: QueueLike): number {
  return item.donationEvent?.amountCents ?? 0
}

/** Maior valor primeiro; em empate, quem chegou primeiro. */
export function compareQueuePriority(a: QueueLike, b: QueueLike): number {
  const amountDiff = donationAmountCents(b) - donationAmountCents(a)
  if (amountDiff !== 0) return amountDiff

  const createdDiff = timeOf(a.createdAt) - timeOf(b.createdAt)
  if (createdDiff !== 0) return createdDiff

  return a.position - b.position
}

/**
 * Decide o que fazer com um item que acabou de ficar reproduzível.
 * A comparação é estritamente maior: valores iguais não derrubam a música atual.
 */
export function decidePriorityAction(input: {
  hasCurrent: boolean
  currentAmountCents: number
  newAmountCents: number
  playable: boolean
  autoPlay: boolean
  forceWhenIdle?: boolean
}): PriorityDecision {
  if (!input.playable) return 'queue'
  if (input.hasCurrent) {
    return input.newAmountCents > input.currentAmountCents ? 'preempt' : 'queue'
  }
  return input.autoPlay || input.forceWhenIdle ? 'start' : 'queue'
}

/** Ordem exibida na página Fila: atual, pendentes por valor e histórico. */
export function sortQueueForDisplay<T extends QueueLike>(items: T[]): T[] {
  const rank = (status?: string) => {
    if (status === 'playing') return 0
    if (status === 'paused') return 1
    if (status === 'pending') return 2
    return 3
  }

  return [...items].sort((a, b) => {
    const rankDiff = rank(a.status) - rank(b.status)
    if (rankDiff !== 0) return rankDiff

    if (a.status === 'pending' && b.status === 'pending') {
      return compareQueuePriority(a, b)
    }

    if (rank(a.status) === 0 || rank(a.status) === 1) {
      return timeOf(b.playedAt) - timeOf(a.playedAt)
    }

    const playedDiff = timeOf(b.playedAt) - timeOf(a.playedAt)
    if (playedDiff !== 0) return playedDiff
    return timeOf(b.createdAt) - timeOf(a.createdAt)
  })
}
