/**
 * Converte Headers da Web API para o formato aceito por http.ServerResponse.
 *
 * `Headers.entries()` combina múltiplos Set-Cookie em uma única string, o que
 * quebra o login quando o callback apaga o nonce e define a sessão na mesma
 * resposta. Esta função preserva cada cookie em um item do array.
 */
export function responseHeadersForNode(headers: Headers): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {}

  for (const [key, value] of headers.entries()) {
    if (key.toLowerCase() !== 'set-cookie') {
      result[key] = value
    }
  }

  const getSetCookie = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie
  if (typeof getSetCookie === 'function') {
    const cookies = getSetCookie.call(headers)
    if (cookies.length > 0) result['set-cookie'] = cookies
  } else {
    const combined = headers.get('set-cookie')
    if (combined) result['set-cookie'] = combined
  }

  return result
}
