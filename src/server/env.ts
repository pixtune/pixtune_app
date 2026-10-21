/**
 * Carrega variáveis do arquivo .env sem depender de pacotes externos.
 *
 * O arquivo é opcional: em produção as variáveis podem vir do ambiente.
 * Variáveis já definidas no processo têm prioridade (útil em testes e CI).
 */

import fs from 'fs'
import path from 'path'

function stripQuotes(value: string): string {
  if (value.length >= 2) {
    const first = value[0]
    const last = value[value.length - 1]
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1)
    }
  }
  return value
}

function loadEnvFile(): void {
  const envPath = path.resolve(process.cwd(), '.env')
  if (!fs.existsSync(envPath)) return

  const content = fs.readFileSync(envPath, 'utf8')

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!match) continue

    const key = match[1]
    if (process.env[key] !== undefined) continue

    const value = stripQuotes(match[2].trim())
    process.env[key] = value
  }
}

loadEnvFile()
