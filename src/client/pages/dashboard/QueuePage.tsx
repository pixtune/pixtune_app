import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  ListMusic,
  Play,
  Pause,
  Plus,
  Trash2,
  Clock,
  Music as MusicIcon,
  Loader2,
  ExternalLink,
  AlertCircle,
  Youtube,
  Trophy,
} from 'lucide-react'
import { Button } from '@client/components/ui/Button'
import { Card } from '@client/components/ui/Card'
import { Badge } from '@client/components/ui/Badge'
import { Input } from '@client/components/ui/Input'
import { apiQueue, apiMusic, type QueueItem } from '@client/api/client'
import { useAudioPlayer } from '@client/player/YouTubeAudioPlayer'
import { formatCurrency, formatDuration } from '@shared/utils'

export function QueuePage() {
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [loading, setLoading] = useState(true)
  const [youtubeUrl, setYoutubeUrl] = useState('')
  const [trackTitle, setTrackTitle] = useState('')
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

  async function handleAddTrack(e: React.FormEvent) {
    e.preventDefault()
    const url = youtubeUrl.trim()

    if (!url) {
      setAddError('Cole um link do YouTube para adicionar uma música.')
      return
    }

    setAdding(true)
    setAddError(null)

    try {
      const resolved = await apiMusic.resolve(url)
      if (!resolved.success || !resolved.data) {
        setAddError(resolved.error?.message || 'Não foi possível identificar o vídeo do YouTube.')
        return
      }

      const video = resolved.data
      const res = await apiQueue.add({
        title: trackTitle.trim() || video.title,
        artist: video.artist,
        artworkUrl: video.artworkUrl,
        sourceUrl: video.sourceUrl,
        provider: 'youtube',
        providerId: video.videoId,
      })

      if (res.success) {
        setYoutubeUrl('')
        setTrackTitle('')
        await loadQueue()
      } else {
        setAddError(res.error?.message || 'Erro ao adicionar à fila.')
      }
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Erro ao adicionar à fila.')
    } finally {
      setAdding(false)
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
      `Cole o link do YouTube para "${track.title}":`,
      track.sourceUrl?.startsWith('https://www.youtube.com/results')
        ? ''
        : track.sourceUrl || ''
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

  const pendingCount = queue.filter((track) => track.status === 'pending').length
  const historyCount = queue.filter(
    (track) => track.status === 'played' || track.status === 'skipped' || track.status === 'failed'
  ).length
  const hasActiveTrack =
    Boolean(currentTrack) ||
    queue.some((track) => track.status === 'playing' || track.status === 'paused')
  // A fila já chega ordenada pelo backend: o primeiro pendente com vídeo é
  // exatamente a próxima música que o servidor vai promover.
  const priorityPendingId = queue.find(
    (track) => track.status === 'pending' && track.providerId
  )?.id

  return (
    <div className="space-y-8">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        <div>
          <h1 className="text-heading-lg font-bold text-pixtune-text">Fila de Reprodução</h1>
          <p className="text-body-sm text-pixtune-textSecondary">
            A maior doação toca primeiro e interrompe a música atual de menor valor. A ordem por
            valor é imutável; você só define o valor mínimo nas configurações.
          </p>
        </div>
        <Link to="/dashboard">
          <Button variant="ghost">
            <Clock className="w-4 h-4 mr-2" /> Voltar ao dashboard
          </Button>
        </Link>
      </div>

      <div className="flex items-start gap-3 rounded-lg border border-pixtune-primary/30 bg-pixtune-primary/5 p-4">
        <Trophy className="mt-0.5 h-5 w-5 flex-shrink-0 text-pixtune-primary" aria-hidden="true" />
        <div>
          <h2 className="text-body-sm font-medium text-pixtune-text">Prioridade por valor</h2>
          <p className="mt-1 text-body-sm text-pixtune-textSecondary">
            Se uma doação maior chegar enquanto outra música toca, a menor é derrubada na hora e a
            maior começa imediatamente. Em valores iguais, vale a ordem de chegada. O valor de cada
            doação é fixo e não pode ser alterado pelo streamer.
          </p>
        </div>
      </div>

      <Card className="p-6">
        <form onSubmit={handleAddTrack} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
            <div className="flex flex-col gap-2 md:col-span-6">
              <label htmlFor="youtubeUrl" className="text-body-sm font-medium text-pixtune-textSecondary">
                Link do YouTube <span className="text-pixtune-primary">*</span>
              </label>
              <Input
                id="youtubeUrl"
                value={youtubeUrl}
                onChange={(e) => setYoutubeUrl(e.target.value)}
                placeholder="https://www.youtube.com/watch?v=..."
                required
                helperText="O vídeo não será exibido; o player reproduz apenas o áudio."
              />
            </div>
            <div className="flex flex-col gap-2 md:col-span-4">
              <label htmlFor="trackTitle" className="text-body-sm font-medium text-pixtune-textSecondary">
                Título (opcional)
              </label>
              <Input
                id="trackTitle"
                value={trackTitle}
                onChange={(e) => setTrackTitle(e.target.value)}
                placeholder="Preenchido automaticamente"
              />
            </div>
            <div className="flex items-end md:col-span-2">
              <Button type="submit" variant="primary" className="w-full" disabled={adding}>
                {adding ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
                {adding ? 'Adicionando' : 'Adicionar'}
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
            <p className="text-caption text-pixtune-textMuted mt-2">As doações com nome de música caem aqui automaticamente. Você também pode adicionar links do YouTube acima.</p>
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
                        : track.status === 'pending' && !track.providerId
                          ? 'Aguardando link'
                          : isPriorityPending
                            ? 'Próxima'
                            : null

              return (
                <div
                  key={track.id}
                  className={`flex items-center gap-4 p-4 transition-colors group ${isCurrent ? 'bg-pixtune-primaryMuted/40' : 'hover:bg-pixtune-surfaceElevated/50'}`}
                >
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center text-caption font-bold bg-pixtune-surfaceElevated">
                    {index + 1}
                  </div>
                  <div className="w-12 h-12 rounded-lg bg-pixtune-surfaceElevated border border-pixtune-border flex-shrink-0 relative overflow-hidden flex items-center justify-center">
                    {track.artworkUrl ? (
                      <img src={track.artworkUrl} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <MusicIcon className="w-6 h-6 text-pixtune-textMuted" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-body-sm font-medium text-pixtune-text truncate">{track.title}</p>
                      {statusLabel && (
                        <Badge variant={track.status === 'playing' ? 'success' : 'neutral'} className="text-[10px]">
                          {statusLabel}
                        </Badge>
                      )}
                    </div>
                    <p className="text-caption text-pixtune-textSecondary truncate">{track.artist || 'Artista desconhecido'}</p>
                    <div className="flex flex-wrap items-center gap-2 mt-1">
                      <Badge variant={track.provider === 'youtube' ? 'info' : 'default'} className="text-[10px]">
                        {track.provider === 'youtube' ? 'YouTube' : track.provider}
                      </Badge>
                      <Badge variant={track.addedBy === 'donation' ? 'success' : 'neutral'} className="text-[10px]">
                        {track.addedBy === 'donation' ? 'Doação' : 'Manual'}
                      </Badge>
                      {track.amountCents > 0 && (
                        <Badge variant="success" className="text-[10px]">
                          <Trophy className="mr-1 h-3 w-3" aria-hidden="true" />
                          {formatCurrency(track.amountCents)}
                        </Badge>
                      )}
                      {track.donorName && (
                        <span className="text-[10px] text-pixtune-textMuted">
                          {track.donorName}
                        </span>
                      )}
                      {!track.providerId && (
                        <span className="text-[10px] text-pixtune-warning">Sem vídeo do YouTube</span>
                      )}
                    </div>
                  </div>
                  <div className="text-right hidden sm:block">
                    <p className="text-caption text-pixtune-textMuted font-mono">{track.durationMs ? formatDuration(track.durationMs) : '--:--'}</p>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-1 sm:gap-2">
                    {track.sourceUrl && (
                      <a
                        href={track.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="p-2 rounded-lg text-pixtune-textMuted hover:text-pixtune-primary hover:bg-pixtune-surfaceElevated transition-colors"
                        aria-label={
                          canPlay
                            ? `Abrir ${track.title} no YouTube`
                            : `Buscar ${track.title} no YouTube`
                        }
                      >
                        <ExternalLink className="w-4 h-4" />
                      </a>
                    )}
                    {!track.providerId && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void handleAttachLink(track)}
                        aria-label={`Anexar link do YouTube para ${track.title}`}
                        title="Anexar um link do YouTube a este pedido"
                      >
                        <Youtube className="w-4 h-4 sm:mr-2" />
                        <span className="hidden sm:inline">Anexar link</span>
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handlePlay(track)}
                      disabled={!canPlay}
                      aria-label={isCurrent && isPlaying ? `Pausar ${track.title}` : `Tocar ${track.title}`}
                      title={
                        !track.providerId
                          ? 'Adicione um link do YouTube a este item'
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
            <span className="text-caption text-pixtune-textMuted">
              A ordem das doações é definida pelo valor e não pode ser embaralhada.
            </span>
          </div>
          <Button variant="danger" size="sm" onClick={handleClear} disabled={queue.length === 0}>
            Limpar tudo
          </Button>
        </div>
      </Card>
    </div>
  )
}
