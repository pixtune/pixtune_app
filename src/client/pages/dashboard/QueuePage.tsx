import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  ListMusic,
  Play,
  Pause,
  Plus,
  Trash2,
  ArrowLeft,
  Music as MusicIcon,
  Loader2,
  ExternalLink,
  AlertCircle,
  Search,
  Link2,
  Trophy,
} from 'lucide-react'
import { Button } from '@client/components/ui/Button'
import { Card } from '@client/components/ui/Card'
import { Badge } from '@client/components/ui/Badge'
import { Input } from '@client/components/ui/Input'
import { apiQueue, apiSpotify, type QueueItem, type SpotifyTrack } from '@client/api/client'
import { useAudioPlayer } from '@client/player/SpotifyAudioPlayer'
import { findSpotifyTrackIdInText } from '@shared/spotify'
import { formatCurrency, formatDuration } from '@shared/utils'

const YOUTUBE_LINK_PATTERN = /(?:https?:\/\/)?(?:www\.|m\.|music\.)?(?:youtube\.com|youtu\.be)\//i

export function QueuePage() {
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [loading, setLoading] = useState(true)
  const [spotifyInput, setSpotifyInput] = useState('')
  const [searchResults, setSearchResults] = useState<SpotifyTrack[]>([])
  const [searching, setSearching] = useState(false)
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)

  const { track: currentTrack, isPlaying, playTrack, togglePlay, next, refresh, error: playerError } = useAudioPlayer()

  useEffect(() => {
    loadQueue()
  }, [])

  async function loadQueue() {
    const res = await apiQueue.list()
    if (res.success && res.data) {
      setQueue(res.data.items)
    }
    setLoading(false)
  }

  async function addSpotifyTrack(track: SpotifyTrack) {
    setAdding(true)
    setAddError(null)

    try {
      const res = await apiQueue.add({
        title: track.title,
        artist: track.artist,
        album: track.album,
        artworkUrl: track.artworkUrl,
        durationMs: track.durationMs,
        sourceUrl: track.sourceUrl,
        provider: 'spotify',
        providerId: track.id,
      })

      if (!res.success) {
        setAddError(res.error?.message || 'Erro ao adicionar à fila.')
        return
      }

      setSpotifyInput('')
      setSearchResults([])
      await loadQueue()
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Erro ao adicionar à fila.')
    } finally {
      setAdding(false)
    }
  }

  async function handleAddTrack(e: React.FormEvent) {
    e.preventDefault()
    const value = spotifyInput.trim()

    if (!value) {
      setAddError('Cole um link do Spotify ou digite o nome da música.')
      return
    }

    setAddError(null)
    setSearchResults([])

    // Link/URI/ID do Spotify: resolve direto e adiciona. O link do Spotify
    // tem precedência mesmo quando a mensagem também contém outro link.
    const spotifyTrackId = findSpotifyTrackIdInText(value)
    if (spotifyTrackId) {
      setAdding(true)
      try {
        const resolved = await apiSpotify.resolve(spotifyTrackId)
        if (!resolved.success || !resolved.data) {
          setAddError(resolved.error?.message || 'Não foi possível identificar a faixa do Spotify.')
          return
        }
        await addSpotifyTrack(resolved.data)
      } catch (err) {
        setAddError(err instanceof Error ? err.message : 'Erro ao adicionar à fila.')
      } finally {
        setAdding(false)
      }
      return
    }

    if (YOUTUBE_LINK_PATTERN.test(value)) {
      setAddError('Links do YouTube não são aceitos. Use o nome da música ou um link do Spotify.')
      return
    }

    // Nome da música: busca oficial do Spotify e mostra os resultados.
    setSearching(true)
    try {
      const result = await apiSpotify.search(value)
      if (!result.success || !result.data) {
        setAddError(result.error?.message || 'Não foi possível buscar no Spotify.')
        return
      }

      if (result.data.tracks.length === 0) {
        setAddError('Nenhuma faixa encontrada no Spotify. Tente outro nome ou cole um link.')
        return
      }

      setSearchResults(result.data.tracks)
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Não foi possível buscar no Spotify.')
    } finally {
      setSearching(false)
    }
  }

  async function handlePlay(track: QueueItem) {
    if (currentTrack?.id === track.id && isPlaying) {
      await togglePlay()
    } else {
      await playTrack(track)
    }
    await loadQueue()
  }

  async function handleRemove(id: string) {
    await apiQueue.remove(id)
    await loadQueue()
    await refresh()
  }

  async function handleNext() {
    await next()
    await loadQueue()
  }

  async function handleAttachLink(track: QueueItem) {
    const url = window.prompt(
      `Cole o link do Spotify para "${track.title}":`,
      track.sourceUrl?.startsWith('https://open.spotify.com/') ? track.sourceUrl : ''
    )
    if (!url?.trim()) return

    try {
      const res = await apiQueue.attachLink(track.id, url.trim())
      if (!res.success) {
        setAddError(res.error?.message || 'Não foi possível anexar o link.')
        return
      }
      setAddError(null)
      await loadQueue()
      await refresh()
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Não foi possível anexar o link.')
    }
  }

  async function handleClear() {
    if (!window.confirm('Limpar toda a fila?')) return
    await apiQueue.clear()
    await loadQueue()
    await refresh()
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-pixtune-bg">
        <div className="animate-pulse-green w-12 h-12 border-4 border-pixtune-border border-t-pixtune-primary rounded-full" />
      </div>
    )
  }

  const pendingCount = queue.filter(
    (track) =>
      track.status === 'pending' && track.provider === 'spotify' && Boolean(track.providerId)
  ).length
  const historyCount = queue.filter(
    (track) => track.status === 'played' || track.status === 'skipped' || track.status === 'failed'
  ).length
  const hasActiveTrack =
    Boolean(currentTrack) ||
    queue.some((track) => track.status === 'playing' || track.status === 'paused')
  // A fila já chega ordenada pelo backend: o primeiro pendente com faixa do
  // Spotify é exatamente a próxima música que o servidor vai promover.
  const priorityPendingId = queue.find(
    (track) =>
      track.status === 'pending' && track.provider === 'spotify' && Boolean(track.providerId)
  )?.id

  return (
    <div className="space-y-8">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        <div>
          <h1 className="text-heading-lg font-bold text-pixtune-text md:text-page-title">Fila de Reprodução</h1>
          <p className="text-body-sm text-pixtune-textSecondary">
            A maior doação toca primeiro e interrompe a música atual de menor valor. A ordem por
            valor é imutável; você só define o valor mínimo nas configurações.
          </p>
        </div>
        <Link to="/dashboard" className="w-fit flex-shrink-0">
          <Button variant="ghost" className="whitespace-nowrap">
            <ArrowLeft className="w-4 h-4 mr-2" /> Voltar ao dashboard
          </Button>
        </Link>
      </div>

      <div className="flex items-start gap-3 rounded-lg border border-pixtune-primary/30 bg-pixtune-primary/5 p-4">
        <Trophy className="mt-0.5 h-5 w-5 flex-shrink-0 text-pixtune-primary" aria-hidden="true" />
        <div>
          <h2 className="text-body-sm font-medium text-pixtune-text">Prioridade por valor</h2>
          <p className="mt-1 text-body-sm text-pixtune-textSecondary">
            Em valores iguais, vale a ordem de chegada. O valor de cada doação é fixo.
          </p>
        </div>
      </div>

      <Card className="p-6">
        <form onSubmit={handleAddTrack} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
            <div className="flex flex-col gap-2 md:col-span-10">
              <label htmlFor="spotifyInput" className="text-body-sm font-medium text-pixtune-textSecondary">
                Música no Spotify <span className="text-pixtune-primary">*</span>
              </label>
              <Input
                id="spotifyInput"
                value={spotifyInput}
                onChange={(e) => {
                  setSpotifyInput(e.target.value)
                  setSearchResults([])
                  setAddError(null)
                }}
                placeholder="https://open.spotify.com/track/... ou nome da música"
                required
                helperText="Cole um link ou digite o nome. A busca e a reprodução usam as APIs oficiais do Spotify."
              />
            </div>
            <div className="flex items-end md:col-span-2">
              <Button
                type="submit"
                variant="primary"
                className="w-full"
                disabled={adding || searching}
              >
                {adding || searching ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : findSpotifyTrackIdInText(spotifyInput.trim()) ? (
                  <Plus className="w-4 h-4 mr-2" />
                ) : (
                  <Search className="w-4 h-4 mr-2" />
                )}
                {adding
                  ? 'Adicionando'
                  : searching
                    ? 'Buscando'
                    : findSpotifyTrackIdInText(spotifyInput.trim())
                      ? 'Adicionar'
                      : 'Buscar'}
              </Button>
            </div>
          </div>

          {addError && (
            <p className="flex items-center gap-2 text-caption text-pixtune-danger" role="alert">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {addError}
            </p>
          )}
        </form>

        {searchResults.length > 0 && (
          <div className="mt-5 border-t border-pixtune-border pt-5">
            <p className="mb-3 text-body-sm font-medium text-pixtune-text">Escolha a faixa</p>
            <div className="space-y-2">
              {searchResults.map((result) => (
                <div
                  key={result.id}
                  className="flex items-center gap-3 rounded-lg border border-pixtune-border bg-pixtune-surfaceElevated/40 p-3"
                >
                  <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg bg-pixtune-surfaceElevated">
                    {result.artworkUrl ? (
                      <img src={result.artworkUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <MusicIcon className="h-5 w-5 text-pixtune-textMuted" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-body-sm font-medium text-pixtune-text">{result.title}</p>
                    <p className="truncate text-caption text-pixtune-textSecondary">
                      {result.artist}
                      {result.album ? ` • ${result.album}` : ''}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void addSpotifyTrack(result)}
                    disabled={adding}
                  >
                    <Plus className="h-4 w-4 sm:mr-2" />
                    <span className="hidden sm:inline">Adicionar</span>
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>

      {playerError && (
        <div className="flex items-start gap-2 p-4 rounded-lg border border-pixtune-danger/40 bg-pixtune-danger/10 text-body-sm text-pixtune-danger" role="alert">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <span>{playerError}</span>
        </div>
      )}

      <Card className="p-0">
        <div className="border-b border-pixtune-border p-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-body font-semibold text-pixtune-text">
            Músicas na fila ({pendingCount})
            {historyCount > 0 && (
              <span className="ml-2 text-caption font-normal text-pixtune-textMuted">
                + {historyCount} no histórico
              </span>
            )}
          </h2>
          {currentTrack && (
            <span className="text-caption text-pixtune-textSecondary truncate">
              {isPlaying ? 'Tocando agora:' : 'Pausada:'} <span className="text-pixtune-text">{currentTrack.title}</span>
            </span>
          )}
        </div>
        {queue.length === 0 ? (
          <div className="p-8 text-center">
            <ListMusic className="w-12 h-12 text-pixtune-textMuted mx-auto mb-4" />
            <p className="text-pixtune-textSecondary">A fila está vazia</p>
            <p className="text-caption text-pixtune-textMuted mt-2">As doações com nome de música caem aqui automaticamente. Você também pode buscar faixas ou colar links do Spotify acima.</p>
          </div>
        ) : (
          <div className="divide-y divide-pixtune-border">
            {queue.map((track, index) => {
              const isCurrent =
                currentTrack?.id === track.id ||
                track.status === 'playing' ||
                track.status === 'paused'
              const isPriorityPending =
                track.status === 'pending' && track.id === priorityPendingId
              const canPlay =
                track.provider === 'spotify' &&
                Boolean(track.providerId) &&
                (isCurrent || (!hasActiveTrack && isPriorityPending))
              const statusLabel =
                track.status === 'playing'
                  ? 'Tocando'
                  : track.status === 'paused'
                    ? 'Pausada'
                    : track.status === 'played'
                      ? 'Tocada'
                      : track.status === 'skipped'
                        ? 'Pulada'
                        : track.status === 'pending' &&
                            (track.provider !== 'spotify' || !track.providerId)
                          ? 'Aguardando Spotify'
                          : isPriorityPending
                            ? 'Próxima'
                            : null

              return (
                <div
                  key={track.id}
                  aria-current={isCurrent ? 'true' : undefined}
                  className={`flex items-center gap-4 border-l-[3px] p-4 pl-[13px] transition-colors group ${
                    isCurrent
                      ? 'border-l-pixtune-primary bg-pixtune-surfaceElevated'
                      : 'border-l-transparent hover:bg-pixtune-surfaceElevated/50'
                  }`}
                >
                  <div className="hidden h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-pixtune-surfaceElevated text-caption font-bold sm:flex">
                    {index + 1}
                  </div>
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg border border-pixtune-border bg-pixtune-surfaceElevated sm:h-12 sm:w-12">
                    {track.provider === 'spotify' && track.providerId && track.artworkUrl ? (
                      <img src={track.artworkUrl} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <MusicIcon className="h-5 w-5 text-pixtune-textMuted sm:h-6 sm:w-6" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-body-sm font-medium text-pixtune-text truncate">{track.title}</p>
                    <p className="text-caption text-pixtune-textSecondary truncate">{track.artist || 'Artista desconhecido'}</p>
                    <div className="flex flex-wrap items-center gap-2 mt-1">
                      {statusLabel && (
                        <Badge variant={track.status === 'playing' ? 'success' : 'neutral'}>
                          {statusLabel}
                        </Badge>
                      )}
                      <Badge
                        variant={
                          track.provider === 'spotify' && track.providerId ? 'info' : 'default'
                        }
                      >
                        {track.provider === 'spotify' && track.providerId
                          ? 'Spotify'
                          : 'Item legado'}
                      </Badge>
                      <Badge variant={track.addedBy === 'donation' ? 'success' : 'neutral'}>
                        {track.addedBy === 'donation'
                          ? 'Doação'
                          : track.addedBy === 'playlist'
                            ? 'Playlist'
                            : 'Manual'}
                      </Badge>
                      {track.amountCents > 0 && (
                        <Badge variant="success">
                          <Trophy className="mr-1 h-3 w-3" aria-hidden="true" />
                          {formatCurrency(track.amountCents)}
                        </Badge>
                      )}
                      {track.donorName && (
                        <span className="text-caption text-pixtune-textMuted">
                          {track.donorName}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right hidden sm:block">
                    <p className="text-caption text-pixtune-textMuted font-mono">{track.durationMs ? formatDuration(track.durationMs) : '--:--'}</p>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-1 sm:gap-2">
                    {track.provider === 'spotify' && track.sourceUrl && (
                      <a
                        href={track.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="p-2 rounded-lg text-pixtune-textMuted hover:text-pixtune-primary hover:bg-pixtune-surfaceElevated transition-colors"
                        aria-label={`Abrir ${track.title} no Spotify`}
                      >
                        <ExternalLink className="w-4 h-4" />
                      </a>
                    )}
                    {(!track.providerId || track.provider !== 'spotify') && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void handleAttachLink(track)}
                        aria-label={`Anexar link do Spotify para ${track.title}`}
                        title="Anexar um link do Spotify a este pedido"
                      >
                        <Link2 className="w-4 h-4 sm:mr-2" />
                        <span className="hidden sm:inline">Anexar Spotify</span>
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handlePlay(track)}
                      disabled={!canPlay}
                      aria-label={isCurrent && isPlaying ? `Pausar ${track.title}` : `Tocar ${track.title}`}
                      title={
                        track.provider !== 'spotify' || !track.providerId
                          ? 'Adicione um link do Spotify a este item'
                          : track.status === 'pending' && (hasActiveTrack || !isPriorityPending)
                            ? 'Aguarde a vez: a maior doação toca primeiro'
                            : track.status === 'played' || track.status === 'skipped'
                              ? 'Só é possível tocar a música atual ou iniciar a fila quando ela está parada'
                              : 'Tocar este áudio'
                      }
                    >
                      {isCurrent && isPlaying ? (
                        <Pause className="w-4 h-4 text-pixtune-primary" />
                      ) : (
                        <Play className="w-4 h-4 text-pixtune-primary" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleRemove(track.id)}
                      aria-label={`Remover ${track.title} da fila`}
                    >
                      <Trash2 className="w-4 h-4 text-pixtune-textMuted hover:text-pixtune-danger" />
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
        <div className="border-t border-pixtune-border p-4 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 flex-wrap">
            <Button variant="ghost" size="sm" onClick={handleNext} disabled={pendingCount === 0}>
              <Play className="w-4 h-4 mr-2" /> Pular próxima
            </Button>
          </div>
          <Button variant="danger" size="sm" onClick={handleClear} disabled={queue.length === 0}>
            Limpar tudo
          </Button>
        </div>
      </Card>
    </div>
  )
}
