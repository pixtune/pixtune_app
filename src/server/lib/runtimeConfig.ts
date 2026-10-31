/**
 * Validação de configuração no boot.
 *
 * Falhar cedo em produção evita os sintomas confusos que já apareceram no
 * OAuth: sessão assinada com segredo de fallback, redirect URI apontando para
 * outro domínio e cookies first-party que nunca chegam ao callback.
 */

import { logEvent } from './logger.js'

function originOf(value: string | undefined | null): string | null {
  const trimmed = (value || '').trim()
  if (!trimmed) return null
  try {
    return new URL(trimmed).origin
  } catch {
    return null
  }
}

function hostnameOf(value: string | undefined | null): string | null {
  const trimmed = (value || '').trim()
  if (!trimmed) return null
  try {
    return new URL(trimmed).hostname
  } catch {
    return null
  }
}

function isHttps(value: string | undefined | null): boolean {
  const trimmed = (value || '').trim()
  return trimmed.startsWith('https://')
}

export function assertRuntimeConfig(): void {
  const isProduction = process.env.NODE_ENV === 'production'
  const problems: string[] = []
  const warnings: string[] = []

  const jwtSecret = (process.env.JWT_SECRET || '').trim()
  if (isProduction) {
    if (!jwtSecret) {
      problems.push('JWT_SECRET não definido.')
    } else if (
      jwtSecret === 'fallback-secret-change-in-production' ||
      jwtSecret.length < 32
    ) {
      problems.push('JWT_SECRET precisa ter pelo menos 32 caracteres e não pode ser o valor de exemplo.')
    }

    if (!process.env.CORS_ORIGINS) {
      warnings.push(
        'CORS_ORIGINS não definido. Requisições diretas ao Render podem ser recusadas; o proxy same-origin do Pages continua funcionando.'
      )
    }

    const appOrigin = originOf(process.env.APP_URL)
    const appHost = hostnameOf(process.env.APP_URL)
    if (!appOrigin || !appHost) {
      problems.push(
        'APP_URL não definido ou inválido. Em produção ele é obrigatório: o callback do OAuth precisa cair no mesmo domínio do cookie nonce (Cloudflare Pages).'
      )
    }

    const redirects: Array<[string, string | undefined]> = [
      ['SPOTIFY_REDIRECT_URI', process.env.SPOTIFY_REDIRECT_URI],
      ['SPOTIFY_CONNECT_REDIRECT_URI', process.env.SPOTIFY_CONNECT_REDIRECT_URI],
    ]

    for (const [name, value] of redirects) {
      if (!value) {
        warnings.push(
          `${name} não definido. O callback será derivado de APP_URL; cadastre essa URL no Spotify Dashboard.`
        )
        continue
      }
      if (!isHttps(value)) {
        problems.push(`${name} precisa usar https:// em produção.`)
        continue
      }
      const redirectHost = hostnameOf(value)
      if (appHost && redirectHost && redirectHost !== appHost) {
        warnings.push(
          `${name} aponta para ${redirectHost}, mas APP_URL é ${appHost}. ` +
            'O cookie nonce é host-only e não acompanha o redirect; o código usará o callback em APP_URL. ' +
            'Cadastre no Spotify Dashboard a URL do mesmo domínio do APP_URL.'
        )
      }
    }

    if (process.env.SPOTIFY_CLIENT_ID && !process.env.SPOTIFY_CLIENT_SECRET) {
      warnings.push('SPOTIFY_CLIENT_ID definido sem SPOTIFY_CLIENT_SECRET; o OAuth ficará desativado.')
    }
  }

  for (const warning of warnings) {
    logEvent('warn', 'config.warning', { message: warning })
  }

  if (problems.length > 0) {
    for (const problem of problems) {
      logEvent('error', 'config.invalid', { message: problem })
    }
    throw new Error(`Configuração inválida:\n- ${problems.join('\n- ')}`)
  }
}
