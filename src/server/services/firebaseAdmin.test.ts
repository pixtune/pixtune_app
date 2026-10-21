import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  isFirebaseConfigured,
  resolveFirebaseProjectId,
  verifyFirebaseIdToken,
} from './firebaseAdmin'

const ENV_KEYS = [
  'FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_PROJECT_ID',
  'GOOGLE_CLOUD_PROJECT',
  'GCLOUD_PROJECT',
  'FIREBASE_SERVICE_ACCOUNT',
  'GOOGLE_APPLICATION_CREDENTIALS',
] as const

let saved: Record<string, string | undefined> = {}

beforeEach(() => {
  saved = {}
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key]
    delete process.env[key]
  }
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
})

describe('resolveFirebaseProjectId', () => {
  it('devolve null sem configuração', () => {
    expect(resolveFirebaseProjectId()).toBeNull()
  })

  it('lê o project ID do bloco público VITE_FIREBASE_PROJECT_ID', () => {
    process.env.VITE_FIREBASE_PROJECT_ID = 'pixtune-82fe9'
    expect(resolveFirebaseProjectId()).toBe('pixtune-82fe9')
  })

  it('prioriza FIREBASE_PROJECT_ID e aceita GOOGLE_CLOUD_PROJECT', () => {
    process.env.VITE_FIREBASE_PROJECT_ID = 'web'
    process.env.FIREBASE_PROJECT_ID = 'servidor'
    expect(resolveFirebaseProjectId()).toBe('servidor')

    delete process.env.FIREBASE_PROJECT_ID
    delete process.env.VITE_FIREBASE_PROJECT_ID
    process.env.GOOGLE_CLOUD_PROJECT = 'cloud'
    expect(resolveFirebaseProjectId()).toBe('cloud')
  })

  it('lê o project_id da conta de serviço quando fornecida', () => {
    process.env.VITE_FIREBASE_PROJECT_ID = 'web'
    process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({ project_id: 'conta-servico' })
    expect(resolveFirebaseProjectId()).toBe('conta-servico')
  })

  it('ignora um FIREBASE_SERVICE_ACCOUNT inválido', () => {
    process.env.FIREBASE_SERVICE_ACCOUNT = '{isso não é json}'
    process.env.VITE_FIREBASE_PROJECT_ID = 'web'
    expect(resolveFirebaseProjectId()).toBe('web')
  })
})

describe('isFirebaseConfigured', () => {
  it('é falso sem nenhuma configuração', () => {
    expect(isFirebaseConfigured()).toBe(false)
  })

  it('é verdadeiro só com o project ID (sem conta de serviço)', () => {
    process.env.VITE_FIREBASE_PROJECT_ID = 'pixtune-82fe9'
    expect(isFirebaseConfigured()).toBe(true)
  })
})

describe('verifyFirebaseIdToken', () => {
  it('rejeita um token malformado sem exigir conta de serviço', async () => {
    process.env.VITE_FIREBASE_PROJECT_ID = 'pixtune-test-project'

    // Garante que a inicialização com apenas o project ID funciona (firebase-admin
    // modular) e que o erro vem do token, não da configuração do projeto.
    await expect(verifyFirebaseIdToken('isto-nao-e-um-jwt')).rejects.toThrow(/token/i)
  })
})
