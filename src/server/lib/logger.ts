/**
 * Logs estruturados da API.
 *
 * Os chamadores passam apenas metadados seguros (etapa, código, status,
 * endpoint). Tokens, cookies, authorization codes e segredos nunca devem ser
 * enviados para cá.
 */

export type LogLevel = 'info' | 'warn' | 'error'

export interface ErrorDetails {
  name: string
  message: string
  code?: string
}

export function logEvent(level: LogLevel, event: string, fields: Record<string, unknown> = {}): void {
  const record = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...fields,
  }

  const line = JSON.stringify(record)
  if (level === 'error') {
    console.error(line)
  } else if (level === 'warn') {
    console.warn(line)
  } else {
    console.info(line)
  }
}

/** Extrai somente dados seguros de um erro para o log. */
export function describeError(error: unknown): ErrorDetails {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code
    return {
      name: error.name,
      message: error.message.slice(0, 500),
      ...(typeof code === 'string' && code ? { code } : {}),
    }
  }

  return {
    name: typeof error,
    message: String(error).slice(0, 500),
  }
}
