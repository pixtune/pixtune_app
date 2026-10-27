import { describe, expect, it } from 'vitest'
import {
  compareQueuePriority,
  decidePriorityAction,
  sortQueueForDisplay,
} from './queuePriorityCore.js'

function item(
  id: string,
  amountCents: number,
  createdAt: string,
  status = 'pending'
) {
  return {
    id,
    createdAt,
    position: 0,
    status,
    playedAt: null as string | null,
    donationEvent: amountCents > 0 ? { amountCents } : null,
  }
}

describe('compareQueuePriority', () => {
  it('coloca a maior doação primeiro', () => {
    const low = item('low', 500, '2026-01-01T10:00:00Z')
    const high = item('high', 2000, '2026-01-01T10:01:00Z')
    expect([low, high].sort(compareQueuePriority).map((i) => i.id)).toEqual(['high', 'low'])
  })

  it('em valores iguais, respeita a ordem de chegada', () => {
    const first = item('first', 1000, '2026-01-01T10:00:00Z')
    const second = item('second', 1000, '2026-01-01T10:01:00Z')
    expect([second, first].sort(compareQueuePriority).map((i) => i.id)).toEqual([
      'first',
      'second',
    ])
  })

  it('trata músicas manuais (sem doação) como valor zero', () => {
    const manual = item('manual', 0, '2026-01-01T09:00:00Z')
    const donation = item('donation', 100, '2026-01-01T10:00:00Z')
    expect([manual, donation].sort(compareQueuePriority).map((i) => i.id)).toEqual([
      'donation',
      'manual',
    ])
  })
})

describe('decidePriorityAction', () => {
  it('derruba a música atual quando a nova doação é maior', () => {
    expect(
      decidePriorityAction({
        hasCurrent: true,
        currentAmountCents: 500,
        newAmountCents: 1000,
        playable: true,
        autoPlay: true,
      })
    ).toBe('preempt')
  })

  it('não derruba em valor igual ou menor', () => {
    const base = {
      hasCurrent: true,
      currentAmountCents: 1000,
      playable: true,
      autoPlay: true,
    }
    expect(decidePriorityAction({ ...base, newAmountCents: 1000 })).toBe('queue')
    expect(decidePriorityAction({ ...base, newAmountCents: 500 })).toBe('queue')
  })

  it('inicia a fila parada quando autoPlay está ativo', () => {
    expect(
      decidePriorityAction({
        hasCurrent: false,
        currentAmountCents: 0,
        newAmountCents: 1000,
        playable: true,
        autoPlay: true,
      })
    ).toBe('start')
  })

  it('mantém na fila quando autoPlay está desligado e não há força de início', () => {
    expect(
      decidePriorityAction({
        hasCurrent: false,
        currentAmountCents: 0,
        newAmountCents: 1000,
        playable: true,
        autoPlay: false,
      })
    ).toBe('queue')
  })

  it('nunca antecipa pedido sem faixa do Spotify', () => {
    expect(
      decidePriorityAction({
        hasCurrent: true,
        currentAmountCents: 100,
        newAmountCents: 5000,
        playable: false,
        autoPlay: true,
      })
    ).toBe('queue')
  })
})

describe('sortQueueForDisplay', () => {
  it('mostra atual, pendentes por valor e histórico depois', () => {
    const items = [
      item('played', 5000, '2026-01-01T09:00:00Z', 'played'),
      item('low', 100, '2026-01-01T10:00:00Z'),
      item('current', 300, '2026-01-01T10:02:00Z', 'playing'),
      item('high', 900, '2026-01-01T10:01:00Z'),
    ]
    expect(sortQueueForDisplay(items).map((i) => i.id)).toEqual([
      'current',
      'high',
      'low',
      'played',
    ])
  })
})
