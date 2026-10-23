import fs from 'node:fs'

const DB = 'C:/Users/mario/AppData/Local/Temp/opencode/pixtune-live.db'
const BASE = 'http://localhost:3001'
const EMAIL = 'ui1792447378655@pixtune.test'
const PASSWORD = 'senha123'
const CLIENT_ID = 'ba5f3498-286a-4b6b-9552-6639b0059d2d'

const raw = fs.readFileSync(DB).toString('latin1')
const candidates = new Set<string>()
const re = /"clientId":"([^"]+)"[^{}]{0,80}?"clientSecret":"([^"]+)"/g
let match: RegExpExecArray | null
while ((match = re.exec(raw))) {
  if (match[1] === CLIENT_ID && match[2].length >= 8) candidates.add(match[2])
}

console.log('candidatos:', candidates.size)
if (candidates.size === 0) process.exit(1)

const login = (await (await fetch(`${BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
})).json()) as any
const token = login?.data?.token
if (!token) throw new Error('login falhou')

for (const clientSecret of candidates) {
  const res = await fetch(`${BASE}/api/donations/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ clientId: CLIENT_ID, clientSecret }),
  })
  const body = (await res.json()) as any
  console.log('tentativa:', res.status, '| connected:', body?.data?.connected ?? false, '| conta:', body?.data?.account?.username ?? null)
  if (res.ok) process.exit(0)
}

process.exit(1)
