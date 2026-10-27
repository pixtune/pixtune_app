import { describe, expect, it } from 'vitest'
import {
  LivePixService,
  livePixMessageToEvent,
  livePixPaymentToEvent,
} from './livepix.js'

describe('livepix', () => {
  it('converte mensagem oficial mantendo o valor em centavos', () => {
    const event = livePixMessageToEvent({
      id: 'msg_1',
      reference: 'ref_1',
      username: 'Maria',
      message: 'toca Evidências',
      amount: 750,
      currency: 'BRL',
      proof: 'pix_123',
      flagged: false,
      createdAt: '2026-01-01T00:00:00-03:00',
    })

    expect(event.event).toBe('message')
    expect(event.data.amountCents).toBe(750)
    expect(event.data.username).toBe('Maria')
    expect(event.data.message).toBe('toca Evidências')
    expect(event.data.proof).toBe('pix_123')
  })

  it('converte pagamento oficial mantendo o valor em centavos', () => {
    const event = livePixPaymentToEvent({
      id: 'pay_1',
      amount: 1000,
      currency: 'BRL',
      proof: 'pix_456',
    })

    expect(event.event).toBe('payment')
    expect(event.data.amountCents).toBe(1000)
    expect(event.data.currency).toBe('BRL')
  })

  it('não considera configurado sem Client ID e Client Secret', () => {
    expect(new LivePixService({ provider: 'gg' }).isConfigured()).toBe(false)
    expect(
      new LivePixService({ provider: 'gg', clientId: 'id' }).isConfigured()
    ).toBe(false)
    expect(
      new LivePixService({
        provider: 'gg',
        clientId: 'id',
        clientSecret: 'secret',
      }).isConfigured()
    ).toBe(true)
  })
})
