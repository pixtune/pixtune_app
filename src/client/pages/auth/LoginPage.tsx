import { Button } from '@client/components/ui/Button'
import { Music } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '@client/contexts/AuthContext'

const SPOTIFY_ERRORS: Record<string, string> = {
  denied: 'A autorização no Spotify foi cancelada.',
  invalid: 'A resposta do Spotify foi inválida. Tente novamente.',
  state:
    'A validação de segurança do login falhou. Verifique se os cookies estão liberados neste navegador e tente novamente.',
  failed:
    'Não foi possível concluir o login. Verifique os logs da API no Render para identificar a causa.',
  not_configured: 'O Spotify ainda não está configurado na API.',
}

/**
 * Página de entrada com único botão "Entrar com Spotify".
 * Nenhum formulário. Nenhuma senha.
 */
export function LoginPage() {
  const { spotifyLogin, authError } = useAuth()
  const [searchParams] = useSearchParams()
  const spotifyStatus = searchParams.get('spotify')
  const message = authError || (spotifyStatus ? SPOTIFY_ERRORS[spotifyStatus] : null)

  return (
    <div className="flex min-h-screen items-center justify-center bg-pixtune-bg px-4">
      <div className="w-full max-w-sm space-y-6 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-pixtune-border bg-pixtune-primary/10">
          <Music className="h-8 w-8 text-pixtune-primary" />
        </div>

        <div>
          <h1 className="text-heading-lg font-bold tracking-tight text-pixtune-text">PixTune</h1>
          <p className="mt-1 text-body-sm text-pixtune-textSecondary">
            Faça login com sua conta do Spotify para começar a usar.
          </p>
        </div>

        {message && (
          <p
            role="alert"
            className="rounded-lg border border-pixtune-danger/40 bg-pixtune-danger/10 px-4 py-3 text-body-sm text-pixtune-danger"
          >
            {message}
          </p>
        )}

        <Button
          variant="primary"
          size="lg"
          className="w-full"
          onClick={spotifyLogin}
        >
          <Music className="w-5 h-5 mr-2" />
          Entrar com Spotify
        </Button>

        <p className="pt-2 text-caption text-pixtune-textMuted">
          Não tem uma conta? Pode começar direto com o Spotify.
        </p>
      </div>
    </div>
  )
}
