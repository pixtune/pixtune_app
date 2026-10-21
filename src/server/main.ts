import './env'
import { createServer, type IncomingMessage } from 'http'
import { parse } from 'url'
import { app } from './index'

const port = process.env.PORT || 3001

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
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

    res.writeHead(response.status, Object.fromEntries(response.headers.entries()))

    const text = await response.text()
    res.end(text)
  } catch (err) {
    console.error(err)
    if (!res.writableEnded) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Internal server error' }))
    }
  }
})

server.listen(Number(port), () => {
  console.log(`🎵 PixTune API running on http://localhost:${port}`)
  console.log(`📋 Health check: http://localhost:${port}/health`)
})
