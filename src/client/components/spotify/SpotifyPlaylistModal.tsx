import { useState, useEffect } from 'react'
import {
  ListMusic,
  RefreshCw,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Search,
  X,
  Plus,
  Music,
} from 'lucide-react'
import { Button } from '@client/components/ui/Button'
import {
  apiSpotify,
  type SpotifyPlaylist,
  type SpotifyStatus,
  isNetworkError,
} from '@client/api/client'

interface SpotifyPlaylistModalProps {
  isOpen: boolean
  onClose: () => void
  onPlaylistImported?: () => void
}

export function SpotifyPlaylistModal({
  isOpen,
  onClose,
  onPlaylistImported,
}: SpotifyPlaylistModalProps) {
  const [status, setStatus] = useState<SpotifyStatus | null>(null)
  const [playlists, setPlaylists] = useState<SpotifyPlaylist[]>([])
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [importingId, setImportingId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [connecting, setConnecting] = useState(false)

  useEffect(() => {
    if (isOpen) {
      void loadData()
    } else {
      setFeedback(null)
      setSearchTerm('')
    }
  }, [isOpen])

  async function loadData() {
    setLoading(true)
    setFeedback(null)
    try {
      const statusRes = await apiSpotify.status()
      if (statusRes.success && statusRes.data) {
        setStatus(statusRes.data)
        if (statusRes.data.connected) {
          const plRes = await apiSpotify.playlists()
          if (plRes.success && plRes.data) {
            setPlaylists(plRes.data.playlists || [])
          }
        }
      }
    } catch (err) {
      console.error('Erro ao buscar dados do Spotify:', err)
      setFeedback({
        type: 'error',
        message: 'Não foi possível carregar as informações do Spotify.',
      })
    } finally {
      setLoading(false)
    }
  }

  async function handleConnect() {
    if (connecting) return
    setConnecting(true)
    setFeedback(null)
    try {
      const res = await apiSpotify.connectUrl()
      if (res.success && res.data?.url) {
        window.location.href = res.data.url
        return
      }
      setFeedback({
        type: 'error',
        message: res.error?.message || 'Falha ao iniciar autenticação com o Spotify.',
      })
    } catch (err) {
      const message = isNetworkError(err)
        ? 'Erro de rede ao conectar com o servidor.'
        : err instanceof Error
          ? err.message
          : 'Erro ao conectar ao Spotify.'
      setFeedback({ type: 'error', message })
    } finally {
      setConnecting(false)
    }
  }

  async function handleImport(playlist: SpotifyPlaylist) {
    if (importingId) return
    setImportingId(playlist.id)
    setFeedback(null)

    try {
      const res = await apiSpotify.importPlaylist(playlist.id)
      if (res.success) {
        const addedCount = res.data?.imported ?? 0
        setFeedback({
          type: 'success',
          message: `Playlist "${playlist.name}" importada com sucesso! ${addedCount > 0 ? `(${addedCount} músicas adicionadas à fila)` : ''}`,
        })
        if (onPlaylistImported) {
          onPlaylistImported()
        }
      } else {
        setFeedback({
          type: 'error',
          message: res.error?.message || 'Falha ao importar faixas da playlist.',
        })
      }
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Erro ao importar playlist.',
      })
    } finally {
      setImportingId(null)
    }
  }

  if (!isOpen) return null

  const filteredPlaylists = playlists.filter((pl) =>
    pl.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (pl.owner && pl.owner.toLowerCase().includes(searchTerm.toLowerCase()))
  )

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="spotify-modal-title"
    >
      <div className="relative w-full max-w-4xl max-h-[90vh] flex flex-col rounded-3xl border border-pixtune-border bg-[#0B141A] shadow-2xl shadow-black/90 overflow-hidden">
        {/* Header idêntico à página 2 */}
        <div className="flex items-start justify-between px-7 pt-7 pb-4">
          <div className="flex items-center gap-3.5">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[#1ED760]/10 text-[#1ED760] border border-[#1ED760]/20 flex-shrink-0">
              <svg className="w-6 h-6 fill-current" viewBox="0 0 24 24">
                <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.498 17.306c-.215.353-.676.466-1.028.25-2.825-1.727-6.381-2.118-10.57-1.16-.402.093-.805-.16-.897-.562-.093-.403.16-.805.562-.898 4.587-1.047 8.52-.598 11.685 1.341.352.216.465.677.248 1.029zm1.467-3.26c-.27.44-.847.58-1.287.31-3.233-1.987-8.163-2.56-11.986-1.4-1.498-.5-.99-1.285-.502-1.498.49-.214 1.285.5 1.498.502 4.372-1.326 9.805-.688 13.486 1.576.44.27.58.847.31 1.287l-.02.025zm.126-3.41c-3.877-2.302-10.279-2.514-13.98-1.39-.594.18-1.223-.153-1.403-.746-.18-.594.153-1.223.746-1.404 4.256-1.292 11.328-1.043 15.795 1.61.536.318.71 1.01.392 1.547-.317.536-1.01.71-1.55.383z" />
              </svg>
            </div>
            <div>
              <h2 id="spotify-modal-title" className="text-xl font-bold text-white font-display">
                Importar do Spotify
              </h2>
              <p className="text-caption text-pixtune-textSecondary mt-0.5">
                Selecione uma playlist para carregar na sua fila.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-2 text-pixtune-textMuted hover:bg-pixtune-surfaceElevated hover:text-white transition-colors"
            aria-label="Fechar modal"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-7 py-3 space-y-5">
          {feedback && (
            <div
              className={`flex items-start gap-2.5 p-3.5 rounded-xl border text-body-sm transition-all ${
                feedback.type === 'success'
                  ? 'border-pixtune-success/40 bg-pixtune-success/10 text-pixtune-success'
                  : 'border-pixtune-danger/40 bg-pixtune-danger/10 text-pixtune-danger'
              }`}
              role="alert"
            >
              {feedback.type === 'success' ? (
                <CheckCircle2 className="h-5 w-5 flex-shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="h-5 w-5 flex-shrink-0 mt-0.5" />
              )}
              <div className="flex-1">{feedback.message}</div>
            </div>
          )}

          {/* Campo de Busca conforme a página 2 */}
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-pixtune-textMuted" />
            <input
              type="text"
              placeholder="Buscar nas suas playlists ou álbuns..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-11 pr-4 py-3 bg-[#070F14]/70 border border-pixtune-border rounded-xl text-body-sm text-white placeholder-pixtune-textMuted focus:outline-none focus:border-[#1ED760] transition-colors"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-pixtune-textMuted hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 text-pixtune-textMuted space-y-3">
              <Loader2 className="h-8 w-8 animate-spin text-pixtune-primary" />
              <p className="text-body-sm">Carregando suas playlists...</p>
            </div>
          ) : !status?.connected && playlists.length === 0 ? (
            <div className="rounded-2xl border border-pixtune-border bg-pixtune-surfaceElevated/40 p-8 text-center space-y-4">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-pixtune-primary/10 border border-pixtune-primary/20 text-pixtune-primary">
                <Music className="h-8 w-8" />
              </div>
              <div className="space-y-1">
                <h3 className="text-body font-bold text-white">Conecte sua conta do Spotify</h3>
                <p className="text-caption text-pixtune-textSecondary max-w-md mx-auto">
                  Para importar suas playlists e controlar a trilha sonora da sua live, conecte sua conta oficial do Spotify.
                </p>
              </div>
              <Button
                variant="primary"
                size="lg"
                onClick={() => void handleConnect()}
                disabled={connecting}
                className="gap-2 mx-auto"
              >
                {connecting ? <Loader2 className="h-5 w-5 animate-spin" /> : <Music className="h-5 w-5" />}
                Conectar com Spotify agora
              </Button>
            </div>
          ) : (
            <div>
              {/* Grid 4 Colunas idêntico ao protótipo da Página 2 */}
              {filteredPlaylists.length === 0 ? (
                <div className="text-center py-12 text-pixtune-textMuted">
                  <ListMusic className="h-10 w-10 mx-auto mb-2 opacity-40" />
                  <p className="text-body-sm">
                    {searchTerm ? 'Nenhuma playlist encontrada.' : 'Nenhuma playlist disponível.'}
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 max-h-[52vh] overflow-y-auto pr-1">
                  {filteredPlaylists.map((pl) => {
                    const isSelected = selectedPlaylistId === pl.id
                    return (
                      <div
                        key={pl.id}
                        onClick={() => setSelectedPlaylistId(pl.id)}
                        className={`group cursor-pointer rounded-2xl p-3 border transition-all duration-200 flex flex-col ${
                          isSelected
                            ? 'border-[#1ED760] bg-[#1ED760]/10 shadow-lg shadow-[#1ED760]/10 ring-1 ring-[#1ED760]'
                            : 'border-pixtune-border/80 bg-[#070F14]/60 hover:bg-[#070F14] hover:border-pixtune-border'
                        }`}
                      >
                        {/* Capa do Álbum Quadrada */}
                        <div className="relative aspect-square w-full rounded-xl overflow-hidden bg-pixtune-surface mb-3">
                          {pl.imageUrl ? (
                            <img
                              src={pl.imageUrl}
                              alt={pl.name}
                              className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-300"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-pixtune-textMuted">
                              <Music className="h-8 w-8" />
                            </div>
                          )}

                          {isSelected && (
                            <div className="absolute top-2 right-2 flex h-6 w-6 items-center justify-center rounded-full bg-[#1ED760] text-black shadow-md">
                              <CheckCircle2 className="h-4 w-4" />
                            </div>
                          )}
                        </div>

                        {/* Metadados */}
                        <h4 className="font-semibold text-sm text-white truncate group-hover:text-[#1ED760] transition-colors">
                          {pl.name}
                        </h4>
                        <p className="text-[11px] font-bold text-pixtune-textMuted uppercase tracking-wider mt-1">
                          {pl.trackCount} MÚSICAS
                        </p>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Rodapé idêntico à página 2 */}
        <div className="flex flex-col sm:flex-row items-center justify-between px-7 py-5 border-t border-pixtune-border bg-[#070F14]/50 gap-3">
          <div className="flex items-center gap-2 text-caption text-pixtune-textSecondary">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#1ED760] opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-[#1ED760]"></span>
            </span>
            <span>Sincronizado com Spotify Connect</span>
          </div>

          <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 text-body-sm font-semibold text-pixtune-textSecondary hover:text-white transition-colors"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={!selectedPlaylistId || importingId !== null}
              onClick={() => {
                const selected = playlists.find((p) => p.id === selectedPlaylistId)
                if (selected) void handleImport(selected)
              }}
              className="px-6 py-2.5 rounded-full bg-[#1ED760] hover:bg-[#1fdf64] disabled:opacity-40 disabled:cursor-not-allowed transition-all text-black font-bold text-body-sm shadow-md shadow-[#1ED760]/20 flex items-center gap-2"
            >
              {importingId ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Importando...
                </>
              ) : (
                'Importar Seleção'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

