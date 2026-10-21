import { useState } from 'react'
import { signInWithPopup, signInWithRedirect } from 'firebase/auth'
import { Button } from '@client/components/ui/Button'
import { useAuth } from '@client/contexts/AuthContext'
import { createGoogleProvider, getFirebaseAuth, isFirebaseConfigured } from '@client/lib/firebase'

function GoogleIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.3-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.6 39.6 16.2 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.2-4.1 5.6l6.2 5.2C41.2 35.9 44 30.4 44 24c0-1.2-.1-2.3-.4-3.5z"
      />
    </svg>
  )
}

/** Mensagens em português para os erros mais comuns do Firebase Auth. */
const FIREBASE_ERRORS: Record<string, string> = {
  'auth/network-request-failed': 'Falha de rede. Verifique sua conexão e tente novamente.',
  'auth/unauthorized-domain': 'Este domínio não está autorizado no Firebase Authentication.',
  'auth/operation-not-allowed': 'O provedor Google não está ativado no Firebase Authentication.',
  'auth/invalid-api-key': 'Configuração do Firebase inválida (verifique as variáveis VITE_FIREBASE_*).',
  'auth/invalid-credential': 'Não foi possível validar o login. Tente novamente.',
}

interface GoogleAuthButtonProps {
  label?: string
}

/**
 * Login com Google via Firebase Authentication.
 *
 * O Firebase abre o popup do Google, devolve um ID token e o enviamos ao
 * backend, que valida o token com o firebase-admin e cria a sessão PixTune.
 * Se o navegador bloquear o popup, cai automaticamente para redirecionamento.
 */
export function GoogleAuthButton({ label = 'Continuar com Google' }: GoogleAuthButtonProps) {
  const { firebaseLogin, isLoading } = useAuth()
  const configured = isFirebaseConfigured()
  const [error, setError] = useState('')

  const handleClick = async () => {
    setError('')
    const auth = getFirebaseAuth()
    if (!auth) return

    try {
      const result = await signInWithPopup(auth, createGoogleProvider())
      const idToken = await result.user.getIdToken()
      await firebaseLogin(idToken)
    } catch (err: any) {
      const code = typeof err?.code === 'string' ? err.code : ''

      // Popup bloqueado/indisponível: tenta o redirecionamento.
      if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') {
        try {
          await signInWithRedirect(auth, createGoogleProvider())
          return
        } catch {
          // Sem sucesso no redirecionamento: mostra o erro abaixo.
        }
      }

      // Cancelamento do usuário não é erro.
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        return
      }

      setError(FIREBASE_ERRORS[code] || err?.message || 'Não foi possível entrar com o Google.')
    }
  }

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="secondary"
        className="w-full"
        disabled={!configured}
        isLoading={isLoading}
        onClick={handleClick}
      >
        <GoogleIcon />
        {label}
      </Button>
      {error && <p className="text-caption text-pixtune-danger text-center">{error}</p>}
      {!configured && (
        <p className="text-caption text-pixtune-textMuted text-center">
          Login com Google indisponível: preencha as variáveis VITE_FIREBASE_* no .env e reinicie o
          servidor web.
        </p>
      )}
    </div>
  )
}
