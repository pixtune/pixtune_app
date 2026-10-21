/**
 * Verificação de ID tokens do Firebase Authentication (login com Google).
 *
 * Usa a API modular do `firebase-admin` v14 (`firebase-admin/app` +
 * `firebase-admin/auth`), carregada de forma preguiçosa. Sem configuração, o
 * login via Firebase fica indisponível — mas o login por e-mail/senha continua
 * funcionando normalmente.
 *
 * A verificação do ID token NÃO exige obrigatoriamente uma conta de serviço:
 * a assinatura é validada com as chaves públicas do Google e o `aud` (projeto)
 * é conferido a partir do project ID. Basta informar o project ID (que já vem
 * no bloco público VITE_FIREBASE_PROJECT_ID). Uma conta de serviço é opcional
 * e apenas habilita a checagem extra de revogação de token.
 *
 * Credenciais aceitas (todas opcionais):
 * - FIREBASE_PROJECT_ID / VITE_FIREBASE_PROJECT_ID: project ID do Firebase.
 * - FIREBASE_SERVICE_ACCOUNT: o JSON da conta de serviço em uma linha.
 * - GOOGLE_APPLICATION_CREDENTIALS: caminho para o JSON da conta de serviço.
 * - Application Default Credentials (Cloud Run / Cloud Functions / gcloud).
 *
 * O SDK só é usado no servidor. Nenhum segredo do Firebase é enviado ao
 * navegador: o cliente só conhece a configuração pública do app Web.
 */

import fs from 'fs'
import path from 'path'

interface AdminAuth {
  verifyIdToken(idToken: string, checkRevoked?: boolean): Promise<Record<string, unknown>>
}

let adminAuth: AdminAuth | null = null

/** Lê a conta de serviço a partir do ambiente, se existir. */
function readServiceAccount(): Record<string, unknown> | null {
  const inline = process.env.FIREBASE_SERVICE_ACCOUNT?.trim()
  if (inline) {
    try {
      return JSON.parse(inline)
    } catch {
      return null
    }
  }

  const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
  if (credentialsPath && fs.existsSync(path.resolve(credentialsPath))) {
    try {
      return JSON.parse(fs.readFileSync(path.resolve(credentialsPath), 'utf8'))
    } catch {
      return null
    }
  }

  return null
}

/** Há uma conta de serviço utilizável (permite checar revogação de token). */
function hasCredentials(): boolean {
  return Boolean(readServiceAccount())
}

/** Descobre o project ID do Firebase a partir do ambiente ou da conta de serviço. */
export function resolveFirebaseProjectId(): string | null {
  const serviceAccount = readServiceAccount()
  if (serviceAccount && typeof serviceAccount.project_id === 'string') {
    return serviceAccount.project_id
  }

  return (
    process.env.FIREBASE_PROJECT_ID?.trim() ||
    // O bloco público do app Web já contém o project ID e é reaproveitado aqui.
    process.env.VITE_FIREBASE_PROJECT_ID?.trim() ||
    process.env.GOOGLE_CLOUD_PROJECT?.trim() ||
    process.env.GCLOUD_PROJECT?.trim() ||
    null
  )
}

/**
 * Há configuração suficiente para verificar tokens do Firebase?
 * Basta o project ID; a conta de serviço é opcional.
 */
export function isFirebaseConfigured(): boolean {
  if (hasCredentials()) return true

  const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
  if (credentialsPath && fs.existsSync(path.resolve(credentialsPath))) return true

  // Em Cloud Run / Cloud Functions as credenciais vêm do ambiente.
  if (process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT) return true

  return Boolean(resolveFirebaseProjectId())
}

async function getAdminAuth(): Promise<AdminAuth> {
  if (adminAuth) return adminAuth

  const { initializeApp, getApps, cert, applicationDefault } = await import('firebase-admin/app')
  const { getAuth } = await import('firebase-admin/auth')

  let app = getApps()[0]
  if (!app) {
    const serviceAccount = readServiceAccount()
    const projectId = resolveFirebaseProjectId()
    const options = projectId ? { projectId } : {}

    if (serviceAccount) {
      app = initializeApp({ ...options, credential: cert(serviceAccount as any) })
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      app = initializeApp({ ...options, credential: applicationDefault() })
    } else {
      // Sem conta de serviço: a verificação usa as chaves públicas do Google
      // e o project ID apenas para conferir o `aud` do token.
      app = initializeApp(options)
    }
  }

  adminAuth = getAuth(app) as unknown as AdminAuth
  return adminAuth
}

export interface FirebaseUserInfo {
  uid: string
  email: string | null
  emailVerified: boolean
  name: string | null
  picture: string | null
}

/**
 * Valida um ID token do Firebase (assinatura, expiração e projeto) e devolve os
 * dados básicos da conta. Lança erro se o token for inválido.
 *
 * A checagem de revogação só é feita quando há conta de serviço configurada,
 * pois ela exige credenciais para consultar a API do Identity Toolkit.
 */
export async function verifyFirebaseIdToken(idToken: string): Promise<FirebaseUserInfo> {
  const auth = await getAdminAuth()
  const decoded = await auth.verifyIdToken(idToken, hasCredentials())

  return {
    uid: String(decoded.uid),
    email: typeof decoded.email === 'string' ? decoded.email : null,
    emailVerified: decoded.email_verified === true,
    name: typeof decoded.name === 'string' ? decoded.name : null,
    picture: typeof decoded.picture === 'string' ? decoded.picture : null,
  }
}
