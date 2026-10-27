import { Button } from '@client/components/ui/Button'
import { Music } from 'lucide-react'
import { useAuth } from '@client/contexts/AuthContext'

/**
 * Página de entrada com único botão "Entrar com Spotify".
 * Nenhum formulário. Nenhuma senha.
 */
export function LoginPage() {
  const { spotifyLogin } = useAuth()

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
