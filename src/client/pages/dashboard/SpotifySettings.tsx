import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  ListMusic,
  Loader2,
  Music,
  RefreshCw,
  Unplug,
} from 'lucide-react'
import { Button } from '@client/components/ui/Button'
import { Card } from '@client/components/ui/Card'
import {
  API_BASE_URL,
  apiSpotify,
  type SpotifyPlaylist,
  type SpotifyStatus,
} from '@client/api/client'

interface SpotifySettingsProps {
  status: SpotifyStatus | null
  busy: boolean
  setBusy: (value: boolean) => void
  feedback: string
  setFeedback: (value: string) => void
  playlists: SpotifyPlaylist[]
  playlistsLoading: boolean
  importingPlaylistId: string | null
  onReload: () => Promise<void>
  onReloadPlaylists: () => Promise<void>
  onImportPlaylist: (playlistId: string) => Promise<void>
}

export function SpotifySettings({
  status,
  busy,
  setBusy,
  feedback,
  setFeedback,
  playlists,
  playlistsLoading,
  importingPlaylistId,
  onReload,
  onReloadPlaylists,
  onImportPlaylist,
}: SpotifySettingsProps) {
  const connectRedirect = status?.redirectUri || `${API_BASE_URL}/api/spotify/callback`
  const configured = status?.configured ?? false
  const connected = status?.connected ?? false
  const profile = status?.profile ?? null
  const premium = status?.premium ?? false

  async function handleConnect() {
    setBusy(true)
    setFeedback('')
    try {
      const res = await apiSpotify.connectUrl()
      if (res.success && res.data?.url) {
        window.location.href = res.data.url
        return
      }
      setFeedback(res.error?.message || 'Não foi possível iniciar a conexão com o Spotify.')
    } catch {
      setFeedback('Não foi possível iniciar a conexão. Verifique se a API está no ar.')
    } finally {
      setBusy(false)
    }
  }

  async function handleRefresh() {
    setBusy(true)
    setFeedback('')
    try {
      const res = await apiSpotify.refresh()
      if (res.success) {
        setFeedback('Dados da conta Spotify atualizados.')
        await onReload()
      } else {
        setFeedback(res.error?.message || 'Falha ao atualizar a conta do Spotify.')
      }
    } catch {
      setFeedback('Falha ao atualizar a conta do Spotify.')
    } finally {
      setBusy(false)
    }
  }

  async function handleDisconnect() {
    if (!window.confirm('Desconectar a conta do Spotify do PixTune?')) return
    setBusy(true)
    setFeedback('')
    try {
      const res = await apiSpotify.disconnect()
      if (res.success) {
        window.dispatchEvent(new Event('pixtune:spotify-disconnected'))
        setFeedback('Conta do Spotify desconectada.')
        await onReload()
      } else {
        setFeedback(res.error?.message || 'Falha ao desconectar.')
      }
    } catch {
      setFeedback('Falha ao desconectar a conta do Spotify.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="p-6">
      <div className="flex items-center gap-2 mb-6">
        <Music className="w-5 h-5 text-pixtune-primary" />
        <h2 className="text-body font-semibold text-pixtune-text">Conta do Spotify</h2>
      </div>

      <div className="space-y-6">
        <div className="rounded-lg border border-pixtune-border bg-pixtune-surfaceElevated/50 p-4">
          <h3 className="text-body-sm font-medium text-pixtune-text">O que esta conexão faz</h3>
          <ul className="mt-2 space-y-1 text-body-sm text-pixtune-textSecondary">
            <li>Conecta sua conta pelo OAuth 2.0 oficial do Spotify.</li>
            <li>Permite buscar faixas, importar playlists e controlar a reprodução.</li>
            <li>Cria um dispositivo Spotify Connect no navegador pelo Web Playback SDK oficial.</li>
          </ul>
          <h3 className="mt-4 text-body-sm font-medium text-pixtune-text">
            O que esta conexão NÃO faz
          </h3>
          <ul className="mt-2 space-y-1 text-body-sm text-pixtune-textSecondary">
            <li>Não baixa, extrai ou contorna a proteção de nenhum áudio.</li>
            <li>Não toca no servidor: o áudio sai do próprio Spotify para o navegador.</li>
            <li>Não funciona sem Spotify Premium nem com a aba do PixTune fechada.</li>
          </ul>
        </div>

        <div className="rounded-lg border border-pixtune-warning/40 bg-pixtune-warning/10 p-4 text-caption text-pixtune-warning">
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <div className="space-y-2">
              <p>
                <strong>Spotify Premium é obrigatório.</strong> O Web Playback SDK não reproduz
                áudio em contas gratuitas.
              </p>
              <p>
                O uso do Spotify em transmissões públicas ou comerciais é restrito pelos termos do
                próprio Spotify. O PixTune usa somente APIs oficiais, mas a conta ou o aplicativo
                podem ser limitados pelo Spotify.
              </p>
            </div>
          </div>
        </div>

        {!configured ? (
          <div className="rounded-lg border border-pixtune-warning/40 bg-pixtune-warning/10 p-4 text-caption text-pixtune-warning">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <div className="space-y-2">
                <p>
                  Integração com o Spotify não configurada. Crie um aplicativo no{' '}
                  <a
                    href="https://developer.spotify.com/dashboard"
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    Spotify for Developers
                  </a>{' '}
                  e preencha <span className="font-mono">SPOTIFY_CLIENT_ID</span> e{' '}
                  <span className="font-mono">SPOTIFY_CLIENT_SECRET</span> no{' '}
                  <span className="font-mono">.env</span>, depois reinicie a API.
                </p>
                <p>URI de redirecionamento autorizado que deve ser cadastrada:</p>
                <p className="font-mono break-all">{connectRedirect}</p>
                <p>
                  Em modo de desenvolvimento, o Spotify autoriza no máximo 5 contas. Para atender
                  mais streamers, cada instalação pode usar credenciais próprias ou o aplicativo
                  precisa de aprovação do Spotify.
                </p>
              </div>
            </div>
          </div>
        ) : connected ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-4 rounded-lg border border-pixtune-success/30 bg-pixtune-success/10 p-4">
              <div className="flex min-w-0 items-center gap-3">
                {profile?.imageUrl ? (
                  <img
                    src={profile.imageUrl}
                    alt={`Avatar de ${profile?.displayName || 'Spotify'}`}
                    className="h-12 w-12 rounded-full border border-pixtune-border object-cover"
                  />
                ) : (
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-pixtune-primary/10 text-pixtune-primary">
                    <Music className="h-6 w-6" />
                  </div>
                )}
                <div className="min-w-0">
                  <p className="truncate text-body-sm font-medium text-pixtune-text">
                    {profile?.displayName || 'Conta Spotify conectada'}
                  </p>
                  <p className="text-caption text-pixtune-textSecondary">
                    {profile
                      ? premium
                        ? 'Spotify Premium'
                        : 'Spotify gratuito'
                      : 'Plano não verificado'}
                    {profile?.country ? ` • ${profile.country}` : ''}
                  </p>
                </div>
              </div>
              <span className="flex flex-shrink-0 items-center gap-2 text-body-sm text-pixtune-success">
                <CheckCircle2 className="h-4 w-4" /> Conectado
              </span>
            </div>

            {profile && !premium && (
              <p className="flex items-start gap-2 rounded-lg border border-pixtune-warning/40 bg-pixtune-warning/10 p-3 text-caption text-pixtune-warning">
                <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                Esta conta não é Premium. O player não vai reproduzir áudio até a conta ser
                atualizada no Spotify.
              </p>
            )}

            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                variant="secondary"
                onClick={() => void handleRefresh()}
                disabled={busy}
                className="flex-1"
              >
                <RefreshCw className="w-4 h-4 mr-2" /> Atualizar dados
              </Button>
              <Button
                variant="danger"
                onClick={() => void handleDisconnect()}
                disabled={busy}
                className="flex-1"
              >
                <Unplug className="w-4 h-4 mr-2" /> Desconectar
              </Button>
            </div>

            <div className="rounded-lg border border-pixtune-border p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <ListMusic className="h-4 w-4 text-pixtune-primary" />
                  <h3 className="text-body-sm font-medium text-pixtune-text">
                    Suas playlists
                  </h3>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void onReloadPlaylists()}
                  disabled={playlistsLoading}
                >
                  <RefreshCw className="h-4 w-4 sm:mr-2" />
                  <span className="hidden sm:inline">Atualizar</span>
                </Button>
              </div>

              <p className="mb-3 text-caption text-pixtune-textSecondary">
                Importe até 100 faixas de uma playlist para a fila. As doações continuam tendo
                prioridade por valor e interrompem a playlist quando necessário.
              </p>

              {playlistsLoading ? (
                <p className="flex items-center gap-2 py-4 text-caption text-pixtune-textMuted">
                  <Loader2 className="h-4 w-4 animate-spin" /> Carregando playlists...
                </p>
              ) : playlists.length === 0 ? (
                <p className="py-4 text-caption text-pixtune-textMuted">
                  Nenhuma playlist encontrada nesta conta.
                </p>
              ) : (
                <div className="space-y-2">
                  {playlists.map((playlist) => (
                    <div
                      key={playlist.id}
                      className="flex items-center gap-3 rounded-lg border border-pixtune-border bg-pixtune-surfaceElevated/40 p-3"
                    >
                      <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg bg-pixtune-surfaceElevated">
                        {playlist.imageUrl ? (
                          <img
                            src={playlist.imageUrl}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <ListMusic className="h-5 w-5 text-pixtune-textMuted" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-body-sm font-medium text-pixtune-text">
                          {playlist.name}
                        </p>
                        <p className="truncate text-caption text-pixtune-textSecondary">
                          {playlist.trackCount} faixa(s)
                          {playlist.owner ? ` • ${playlist.owner}` : ''}
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void onImportPlaylist(playlist.id)}
                        disabled={importingPlaylistId !== null}
                      >
                        {importingPlaylistId === playlist.id ? (
                          <Loader2 className="h-4 w-4 sm:mr-2 animate-spin" />
                        ) : (
                          <ListMusic className="h-4 w-4 sm:mr-2" />
                        )}
                        <span className="hidden sm:inline">
                          {importingPlaylistId === playlist.id ? 'Importando' : 'Importar'}
                        </span>
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <Button
              variant="primary"
              onClick={() => void handleConnect()}
              disabled={busy}
              className="w-full"
            >
              <Music className="w-4 h-4 mr-2" /> Conectar conta do Spotify
            </Button>
            <p className="text-caption text-pixtune-textMuted">
              Você será redirecionado para a tela de consentimento oficial do Spotify. O PixTune
              guarda o refresh token apenas no servidor e usa o access token de curta duração no
              navegador para registrar o dispositivo de reprodução.
            </p>
          </div>
        )}

        <div className="rounded-lg border border-pixtune-border bg-pixtune-bg/40 p-4">
          <div className="flex items-start gap-2 text-caption text-pixtune-textMuted">
            <ExternalLink className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
            <span>
              A reprodução acontece no navegador onde o PixTune está aberto. Mantenha esta aba
              ativa durante a live. O Spotify pode exigir um primeiro clique em Play para liberar
              o áudio.
            </span>
          </div>
        </div>

        {feedback && (
          <p className="text-caption text-pixtune-textSecondary" role="status">
            {feedback}
          </p>
        )}
      </div>
    </Card>
  )
}
