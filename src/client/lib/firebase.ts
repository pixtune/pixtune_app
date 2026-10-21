/**
 * Inicialização do Firebase no cliente (Authentication com Google).
 *
 * Tudo vem de variáveis `VITE_FIREBASE_*` (config pública do app Web do
 * Firebase). Nenhum segredo é exposto aqui: a verificação do ID token
 * acontece no servidor, com o firebase-admin.
 *
 * Se as variáveis não estiverem preenchidas, `getFirebaseAuth()` devolve
 * `null` e o botão de login com Google fica desabilitado — o login por
 * e-mail/senha continua funcionando normalmente.
 */

import { initializeApp, getApps, type FirebaseApp, type FirebaseOptions } from 'firebase/app'
import { getAuth, GoogleAuthProvider, type Auth } from 'firebase/auth'

function readConfig(): FirebaseOptions {
  return {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined,
    appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined,
  }
}

export function isFirebaseConfigured(): boolean {
  const config = readConfig()
  return Boolean(config.apiKey && config.authDomain && config.projectId && config.appId)
}

let app: FirebaseApp | null = null
let auth: Auth | null = null

export function getFirebaseAuth(): Auth | null {
  if (!isFirebaseConfigured()) return null
  if (!auth) {
    app = getApps().length ? getApps()[0] : initializeApp(readConfig())
    auth = getAuth(app)
  }
  return auth
}

export function createGoogleProvider(): GoogleAuthProvider {
  const provider = new GoogleAuthProvider()
  provider.setCustomParameters({ prompt: 'select_account' })
  return provider
}
