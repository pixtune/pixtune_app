import { describe, expect, it } from 'vitest'
import { matchesAmountAndKeywords, parseKeywords } from './rules.js'

const baseRule = { minAmount: 500, maxAmount: 1000, keywords: null as string | null }

describe('matchesAmountAndKeywords', () => {
  it('exige o valor mínimo', () => {
    expect(matchesAmountAndKeywords(baseRule, { amountCents: 499 })).toBe(false)
    expect(matchesAmountAndKeywords(baseRule, { amountCents: 500 })).toBe(true)
  })

  it('respeita o valor máximo', () => {
    expect(matchesAmountAndKeywords(baseRule, { amountCents: 1000 })).toBe(true)
    expect(matchesAmountAndKeywords(baseRule, { amountCents: 1001 })).toBe(false)
  })

  it('trata máximo nulo ou zero como sem limite superior', () => {
    expect(matchesAmountAndKeywords({ minAmount: 0, maxAmount: null }, { amountCents: 999999 })).toBe(true)
    expect(matchesAmountAndKeywords({ minAmount: 0, maxAmount: 0 }, { amountCents: 999999 })).toBe(true)
  })

  it('aceita qualquer mensagem quando não há palavras-chave', () => {
    expect(matchesAmountAndKeywords({ minAmount: 0, keywords: '[]' }, { amountCents: 100 })).toBe(true)
    expect(matchesAmountAndKeywords({ minAmount: 0, keywords: null }, { amountCents: 100 })).toBe(true)
  })

  it('exige uma palavra-chave presente na mensagem, sem diferenciar caixa', () => {
    const rule = { minAmount: 0, keywords: JSON.stringify(['pizza', 'Sushi']) }
    expect(matchesAmountAndKeywords(rule, { amountCents: 100, donorMessage: 'Quero PIZZA!' })).toBe(true)
    expect(matchesAmountAndKeywords(rule, { amountCents: 100, donorMessage: 'manda um sushi' })).toBe(true)
    expect(matchesAmountAndKeywords(rule, { amountCents: 100, donorMessage: 'quero um bolo' })).toBe(false)
  })

  it('rejeita doação sem mensagem quando a regra tem palavras-chave', () => {
    const rule = { minAmount: 0, keywords: JSON.stringify(['pizza']) }
    expect(matchesAmountAndKeywords(rule, { amountCents: 100 })).toBe(false)
    expect(matchesAmountAndKeywords(rule, { amountCents: 100, donorMessage: '' })).toBe(false)
  })
})

describe('parseKeywords', () => {
  it('devolve lista vazia para JSON inválido ou vazio', () => {
    expect(parseKeywords('')).toEqual([])
    expect(parseKeywords(null)).toEqual([])
    expect(parseKeywords('{')).toEqual([])
    expect(parseKeywords('"pizza"')).toEqual([])
  })

  it('ignora itens que não são texto', () => {
    expect(parseKeywords('["pizza", 1, null, "sushi"]')).toEqual(['pizza', 'sushi'])
  })
})
