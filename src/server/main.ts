import './env.js'
import { createServer, type IncomingMessage } from 'http'
import { parse } from 'url'
import { app } from './index.js'
import { responseHeadersForNode } from './lib/nodeHeaders.js'
import { assertRuntimeConfig } from './lib/runtimeConfig.js'
import { describeError, logEvent } from './lib/logger.js'

const port = process.env.PORT || 3001
const MAX_BODY_BYTES = 1024 * 1024 // 1 MiB

// Falha cedo em produção se JWT_SECRET/APP_URL estiverem ausentes ou se os
// callbacks do OAuth apontarem para outro domínio (o cookie nonce é host-only).
assertRuntimeConfig()

class PayloadTooLargeError extends Error {}

function readBody(req: IncomingMessage, limit = MAX_BODY_BYTES): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let tooLarge = false

    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) {
        tooLarge = true
        chunks.length = 0
        // Continua drenando para conseguir responder 413 sem resetar a
        // conexão no meio do upload.
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (tooLarge) {
        reject(new PayloadTooLargeError())
        return
      }
      resolve(Buffer.concat(chunks))
    })
    req.on('error', reject)
  })
}

function sendJson(
  res: import('http').ServerResponse,
  status: number,
  body: unknown
): void {
  if (res.writableEnded) return
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  res.end(JSON.stringify(body))
}

const server = createServer(async (req, res) => {
  try {
    const url = parse(req.url || '', true)
    const search = url.search || ''

    const headers: Record<string, string> = {}
    for (const [key, value] of Object.entries(req.headers || {})) {
      if (value !== undefined) {
        headers[key] = Array.isArray(value) ? value.join(', ') : String(value)
      }
    }

    const method = req.method || 'GET'
    const bodyMethods = ['POST', 'PUT', 'PATCH']
    let body: Uint8Array | undefined

    if (bodyMethods.includes(method)) {
      const buffer = await readBody(req)
      if (buffer.length > 0) body = buffer
    }

    const request = new Request(`http://localhost:${port}${url.pathname}${search}`, {
      method,
      headers,
      body,
    })

    const response = await app.fetch(request)

    // Preserva múltiplos Set-Cookie (callback apaga o nonce e define a sessão
    // na mesma resposta).
    res.writeHead(response.status, responseHeadersForNode(response.headers))

    const text = await response.text()
    res.end(text)
  } catch (error) {
    if (error instanceof PayloadTooLargeError) {
      logEvent('warn', 'server.payload_too_large', {
        method: req.method || 'GET',
        path: parse(req.url || '').pathname,
      })
      sendJson(res, 413, {
        success: false,
        error: {
          code: 'PAYLOAD_TOO_LARGE',
          message: 'O corpo da requisição excede o limite de 1 MB.',
        },
      })
      return
    }

    logEvent('error', 'server.request_failed', {
      method: req.method || 'GET',
      path: parse(req.url || '').pathname,
      error: describeError(error),
    })
    sendJson(res, 500, {
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Erro interno do servidor. Tente novamente em instantes.',
      },
    })
  }
})

server.listen(Number(port), () => {
  console.log(`🎵 PixTune API running on http://localhost:${port}`)
  console.log(`📋 Health check: http://localhost:${port}/health`)
})
