import { Button } from '@client/components/ui/Button'
import { Loader2, Music } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '@client/contexts/AuthContext'

const SPOTIFY_ERRORS: Record<string, string> = {
  denied: 'A autorização no Spotify foi cancelada.',
  invalid:
    'O Spotify devolveu uma resposta inválida. Tente entrar novamente; se persistir, verifique a URL de callback no Spotify Dashboard.',
  state:
    'A validação de segurança do login falhou. O cookie de segurança não foi enviado; tente novamente em uma janela normal do navegador.',
  config:
    'A URL de callback do Spotify não confere com o domínio do PixTune. O administrador precisa cadastrar a URL exibida em Configurações → Spotify.',
  failed:
    'Não foi possível concluir o login. A API registrou a etapa exata da falha; tente novamente em instantes.',
  not_configured: 'O Spotify ainda não está configurado na API.',
  not_allowed:
    'Sua conta Spotify ainda não está autorizada neste aplicativo. Peça ao responsável para adicionar seu nome e e-mail em Spotify Developer Dashboard → Users Management (o app está em Development Mode).',
  scope:
    'O Spotify não concedeu todas as permissões necessárias. Tente novamente e aceite todas as permissões solicitadas.',
  forbidden:
    'O Spotify recusou a operação (403). Verifique se o app está em Development Mode e se sua conta está na lista de usuários autorizados.',
  rate_limited: 'O Spotify limitou temporariamente as requisições. Tente novamente em alguns minutos.',
  database:
    'O banco de dados da API não está com as migrations aplicadas. O administrador precisa executar prisma migrate deploy no Render.',
  session: 'Não foi possível criar a sessão do PixTune. Tente novamente.',
}

/**
 * Página de entrada com único botão "Entrar com Spotify".
 * Nenhum formulário. Nenhuma senha.
 */
export function LoginPage() {
  const { spotifyLogin, authError, isConnecting } = useAuth()
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
          disabled={isConnecting}
        >
          {isConnecting ? (
            <>
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              Redirecionando...
            </>
          ) : (
            <>
              <Music className="w-5 h-5 mr-2" />
              Entrar com Spotify
            </>
          )}
        </Button>

        <p className="pt-2 text-caption text-pixtune-textMuted">
          Não tem uma conta? Pode começar direto com o Spotify.
        </p>
      </div>
    </div>
  )
}
