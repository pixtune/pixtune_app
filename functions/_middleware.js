/**
 * Proxy reverso same-origin do Cloudflare Pages para a aplicação PixTune no Render.
 *
 * Arquitetura:
 * - o navegador acessa apenas https://pixtune-app.pages.dev;
 * - esta Function encaminha TODAS as rotas (páginas, /_next/*, /api/*, webhooks)
 *   para a aplicação Next.js unificada hospedada no Render;
 * - cookies definidos pelo Render (host-only) passam a ser first-party no
 *   domínio pages.dev, preservando OAuth do Spotify e sessão JWT.
 *
 * Segurança:
 * - a origem de destino é fixa (env API_ORIGIN, definida no painel do Pages) e
 *   NUNCA vem da requisição, então não é um proxy aberto;
 * - apenas o host/protocolo originais são informados via X-Forwarded-*;
 * - respostas dinâmicas/autenticadas não são armazenadas em cache.
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

/**
 * Resolve a origem do Render a partir do ambiente do Pages.
 * Valores inválidos caem no padrão, evitando redirecionar o proxy para
 * destinos arbitrários.
 */
function resolveOrigin(env) {
  const raw = (env && env.API_ORIGIN) || DEFAULT_API_ORIGIN
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return DEFAULT_API_ORIGIN
    }
    return url.origin
  } catch {
    return DEFAULT_API_ORIGIN
  }
}

function isStaticAsset(pathname) {
  if (pathname.startsWith('/_next/static/')) return true
  return /\.(?:js|mjs|css|map|json|txt|xml|webmanifest|woff2?|ttf|otf|eot|png|jpe?g|gif|svg|ico|webp|avif|mp3|mp4|webm)$/i.test(
    pathname
  )
}

export async function onRequest(context) {
  const { request, env } = context
  const incomingUrl = new URL(request.url)
  const origin = resolveOrigin(env)
  const targetUrl = new URL(`${incomingUrl.pathname}${incomingUrl.search}`, `${origin}/`)

  const headers = new Headers(request.headers)
  // O fetch define o Host do destino; não repassamos o Host público.
  headers.delete('host')
  // Evita respostas comprimidas que o Worker teria de recompressar.
  headers.delete('accept-encoding')
  // Diagnóstico seguro: host e protocolo vistos pelo navegador. O Next/Hono
  // usam esses headers para montar URLs absolutas e validar o OAuth.
  headers.set('x-forwarded-host', incomingUrl.host)
  headers.set('x-forwarded-proto', incomingUrl.protocol.replace(':', ''))

  const init = {
    method: request.method,
    headers,
    // Não seguir redirecionamentos no Worker: o navegador precisa recebê-los.
    redirect: 'manual',
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = request.body
    // Necessário no runtime Node (testes locais); ignorado pelo workerd.
    init.duplex = 'half'
  }

  let upstream
  try {
    upstream = await fetch(targetUrl.toString(), init)
  } catch {
    return new Response(
      JSON.stringify({
        success: false,
        error: {
          code: 'BAD_GATEWAY',
          message: 'Não foi possível contatar o serviço de origem.',
        },
      }),
      {
        status: 502,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
        },
      }
    )
  }

  const responseHeaders = new Headers()
  for (const [key, value] of upstream.headers) {
    const lower = key.toLowerCase()
    // Set-Cookie é tratado individualmente abaixo; encoding/length são
    // recalculados pelo runtime ao devolver o corpo.
    if (lower === 'set-cookie' || lower === 'content-encoding' || lower === 'content-length') {
      continue
    }
    responseHeaders.set(key, value)
  }

  // Preserva cada cookie separadamente (o callback OAuth apaga o nonce e cria a
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

  // Redirecionamentos internos do Render permanecem no domínio público.
  // Redirecionamentos externos (Spotify, etc.) são mantidos intactos.
  const location = responseHeaders.get('location')
  if (location) {
    try {
      const redirectUrl = new URL(location, targetUrl)
      if (redirectUrl.origin === origin) {
        responseHeaders.set(
          'location',
          `${redirectUrl.pathname}${redirectUrl.search}${redirectUrl.hash}`
        )
      }
    } catch {
      // Location inválido: deixa o navegador tratar.
    }
  }

  // Respostas dinâmicas, autenticadas e redirecionamentos nunca são cacheados.
  // Apenas assets estáticos mantêm o Cache-Control imutável do Next.
  if (!isStaticAsset(incomingUrl.pathname)) {
    responseHeaders.set('cache-control', 'no-store')
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  })
}
