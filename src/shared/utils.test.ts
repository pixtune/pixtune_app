import { describe, expect, it } from 'vitest'
import { clamp, formatCurrency, formatDuration } from './utils'

describe('formatCurrency', () => {
  it('formata centavos em reais', () => {
    expect(formatCurrency(1234)).toMatch(/12,34/)
    expect(formatCurrency(0)).toMatch(/0,00/)
    expect(formatCurrency(1050, 'USD')).toMatch(/10,50/)
  })
})

describe('formatDuration', () => {
  it('formata milissegundos como minutos e segundos', () => {
    expect(formatDuration(0)).toBe('0:00')
    expect(formatDuration(65000)).toBe('1:05')
    expect(formatDuration(3599000)).toBe('59:59')
  })
})

describe('clamp', () => {
  it('mantém o valor dentro do intervalo', () => {
    expect(clamp(50, 0, 100)).toBe(50)
    expect(clamp(-10, 0, 100)).toBe(0)
    expect(clamp(150, 0, 100)).toBe(100)
  })
})
