/**
 * Regras puras de correspondência de doações.
 *
 * Ficam separadas do banco de dados para poderem ser testadas sem
 * levantar servidor, Prisma ou rede. As verificações que dependem de
 * estado (cooldown e limite por hora) permanecem na camada de aplicação.
 */

export interface DonationRuleMatchInput {
  amountCents: number
  donorMessage?: string | null
}

export interface DonationRuleLike {
  minAmount: number
  maxAmount?: number | null
  keywords?: string | null
}

/** Lê a lista de palavras-chave com tolerância a JSON inválido/legado. */
export function parseKeywords(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : []
  } catch {
    return []
  }
}

/**
 * Retorna `true` quando a doação satisfaz valor mínimo/máximo e, se a
 * regra tiver palavras-chave, quando a mensagem contém ao menos uma delas
 * (comparação sem diferenciar maiúsculas/minúsculas).
 */
export function matchesAmountAndKeywords(
  rule: DonationRuleLike,
  input: DonationRuleMatchInput
): boolean {
  const { amountCents, donorMessage } = input

  if (amountCents < rule.minAmount) return false
  if (rule.maxAmount != null && rule.maxAmount > 0 && amountCents > rule.maxAmount) return false

  const keywords = parseKeywords(rule.keywords)
  if (keywords.length === 0) return true

  if (!donorMessage) return false
  const message = donorMessage.toLowerCase()
  return keywords.some((keyword) => message.includes(keyword.toLowerCase()))
}
