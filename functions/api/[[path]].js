/**
 * Proxy same-origin do Cloudflare Pages para a API no Render.
 *
 * Por que existe: o frontend e a API estavam em sites diferentes
 * (pages.dev x onrender.com). Brave, Safari e Firefox bloqueiam o cookie
 * pixtune_spotify_nonce/pixtune_token como cookie de terceiro, então o OAuth
 * falhava antes mesmo de chegar ao Spotify.
 *
 * Com este proxy, o navegador conversa apenas com https://pixtune-app.pages.dev.
 * Os cookies definidos pelo Render passam a ser first-party e o OAuth funciona
 * sem desativar nenhuma proteção do navegador.
 *
 * Configure API_ORIGIN no Cloudflare Pages (opcional; o padrão é o Render).
 */

const DEFAULT_API_ORIGIN = 'https://pixtune-app.onrender.com'

/**
 * Separa múltiplos Set-Cookie sem quebrar a vírgula de "Expires=Wed, 21 Oct".
 * Usado apenas no fallback, quando o runtime não expõe getSetCookie().
 */
function splitSetCookie(header) {
  return header
    .split(/,(?=\s*[^;,=\s]+=)/g)
    .map((value) => value.trim())
    .filter(Boolean)
}

function apiOrigin(env) {
  const value = (env && env.API_ORIGIN) || DEFAULT_API_ORIGIN
  return value.replace(/\/+$/, '')
}

export async function onRequest(context) {
  const { request, env } = context
  const incomingUrl = new URL(request.url)
  const origin = apiOrigin(env)
  const targetUrl = new URL(`${incomingUrl.pathname}${incomingUrl.search}`, `${origin}/`)

  const headers = new Headers(request.headers)
  headers.delete('host')
  // Evita respostas comprimidas que o Worker teria de recompressar.
  headers.delete('accept-encoding')
  // Diagnóstico seguro: o host público e o protocolo vistos pelo navegador.
  // O callback precisa acontecer neste host para receber o cookie nonce.
  headers.set('x-forwarded-host', incomingUrl.host)
  headers.set('x-forwarded-proto', incomingUrl.protocol.replace(':', ''))

  const init = {
    method: request.method,
    headers,
    redirect: 'manual',
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = request.body
  }

  const upstream = await fetch(targetUrl.toString(), init)

  const responseHeaders = new Headers()
  for (const [key, value] of upstream.headers) {
    const lower = key.toLowerCase()
    if (lower === 'set-cookie' || lower === 'content-encoding' || lower === 'content-length') {
      continue
    }
    responseHeaders.set(key, value)
  }

  // Preserva cada cookie separadamente (o callback apaga o nonce e cria a
  // sessão na mesma resposta).
  if (typeof upstream.headers.getSetCookie === 'function') {
    for (const cookie of upstream.headers.getSetCookie()) {
      responseHeaders.append('set-cookie', cookie)
    }
  } else {
    const cookie = upstream.headers.get('set-cookie')
    for (const value of cookie ? splitSetCookie(cookie) : []) {
      responseHeaders.append('set-cookie', value)
    }
  }

  // Se a API redirecionar para a própria origem, mantenha o navegador no
  // proxy. Redirecionamentos para o frontend ou para o Spotify são mantidos.
  const location = responseHeaders.get('location')
  if (location) {
    try {
      const redirectUrl = new URL(location, targetUrl)
      if (redirectUrl.origin === new URL(origin).origin) {
        responseHeaders.set('location', `${redirectUrl.pathname}${redirectUrl.search}${redirectUrl.hash}`)
      }
    } catch {
      // Location inválido: deixa o navegador tratar.
    }
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  })
}
