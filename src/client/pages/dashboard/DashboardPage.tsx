import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Music, Play, Pause, SkipForward, SkipBack, TrendingUp, Clock, ShieldAlert, CheckCircle2, AlertCircle, Activity, Zap, ExternalLink, Trophy } from 'lucide-react'
import { Button } from '@client/components/ui/Button'
import { Card } from '@client/components/ui/Card'
import { Badge } from '@client/components/ui/Badge'
import { apiQueue, apiDonations } from '@client/api/client'
import { useAudioPlayer } from '@client/player/YouTubeAudioPlayer'
import { formatDuration, formatCurrency } from '@shared/utils'

export function DashboardPage() {
  const [queue, setQueue] = useState<any[]>([])
  const [donationEvents, setDonationEvents] = useState<any[]>([])
  const [livepixStatus, setLivepixStatus] = useState<'connected' | 'disconnected' | 'error'>('disconnected')
  const [loading, setLoading] = useState(true)
  const {
    track: currentTrack,
    isPlaying,
    isReady,
    volume,
    positionMs,
    durationMs,
    error: playerError,
    togglePlay,
    next: playNext,
    previous: playPrevious,
    setVolume,
  } = useAudioPlayer()

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    try {
      await Promise.all([
        loadQueue(),
        loadDonations(),
        checkLivePixStatus(),
      ])
    } catch (err) {
      console.error('Erro ao carregar dados:', err)
    } finally {
      setLoading(false)
    }
  }

  async function loadQueue() {
    const res = await apiQueue.list()
    if (res.success && res.data) {
      setQueue(res.data.items)
    }
  }

  async function loadDonations() {
    const res = await apiDonations.list()
    if (res.success && res.data) {
      setDonationEvents(res.data.events)
    }
  }

  async function checkLivePixStatus() {
    const res = await apiDonations.config()
    if (res.success && res.data) {
      setLivepixStatus(res.data.connected ? 'connected' : 'disconnected')
    }
  }

  const statusConfig = (status: string) => {
    switch (status) {
      case 'connected': return { color: 'bg-pixtune-success', label: 'Conectado', icon: <CheckCircle2 className="w-4 h-4" /> }
      case 'connecting': return { color: 'bg-yellow-500', label: 'Conectando...', icon: <Activity className="w-4 h-4" /> }
      case 'error': return { color: 'bg-pixtune-danger', label: 'Erro', icon: <AlertCircle className="w-4 h-4" /> }
      default: return { color: 'bg-pixtune-textMuted', label: 'Desconectado', icon: <ShieldAlert className="w-4 h-4" /> }
    }
  }

  const musicStatus: 'connected' | 'connecting' | 'error' = playerError
    ? 'error'
    : isReady
      ? 'connected'
      : 'connecting'

  const livepix = statusConfig(livepixStatus)
  const music = statusConfig(musicStatus)

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-pixtune-bg">
        <div className="animate-pulse-green w-12 h-12 border-4 border-pixtune-border border-t-pixtune-primary rounded-full" />
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        <div>
          <h1 className="text-heading-lg font-bold text-pixtune-text">Painel do Streamer</h1>
          <p className="text-body-sm text-pixtune-textSecondary">
            Gerencie sua fila e acompanhe doações em tempo real.
          </p>
        </div>
        <div className="flex items-center gap-4">
          <ConnectionBadge label="Live Pix" status={livepixStatus} config={livepix} />
          <ConnectionBadge label="Música" status={musicStatus} config={music} />
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard title="Agora tocando" value={currentTrack?.title || 'Nenhuma'} subtitle={currentTrack?.artist || ''} icon={<Music className="w-5 h-5" />} />
        <StatCard title="Na fila" value={queue.filter((q: any) => q.status === 'pending').length.toString()} subtitle="músicas aguardando" icon={<Clock className="w-5 h-5" />} />
        <StatCard title="Reproduzidas" value={queue.filter((q: any) => q.status === 'played').length.toString()} subtitle="no histórico" icon={<TrendingUp className="w-5 h-5" />} />
        <StatCard title="Hoje" value={donationEvents.filter((d: any) => !d.isDemo).length.toString()} subtitle="doações (real)" icon={<Zap className="w-5 h-5" />} />
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          <NowPlayingCard
            track={currentTrack}
            isPlaying={isPlaying}
            volume={volume}
            positionMs={positionMs}
            durationMs={durationMs}
            isReady={isReady}
            error={playerError}
            onTogglePlay={togglePlay}
            onPrevious={playPrevious}
            onNext={playNext}
            onVolumeChange={handleVolumeChange}
          />
          <QueueControlsCard onClear={handleClearQueue} />
        </div>
        <div className="min-w-0 space-y-6 lg:col-span-1">
          <RecentDonationsCard events={donationEvents.slice(0, 5)} />
          <QuickActionsCard onNext={handleNextTrack} />
        </div>
      </div>
    </div>
  )

  function handleVolumeChange(value: number) {
    setVolume(value)
  }

  async function handleClearQueue() {
    if (!window.confirm('Limpar toda a fila?')) return
    await apiQueue.clear()
    await loadData()
  }

  async function handleNextTrack() {
    await playNext()
    await loadQueue()
  }
}

function ConnectionBadge({ label, status, config }: { label: string; status: string; config: any }) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-pixtune-surfaceElevated border border-pixtune-border text-body-sm">
      <div className={`w-2 h-2 rounded-full ${config.color} animate-pulse`} aria-label={`${label}: ${config.label}`} />
      <span className={`font-medium ${status === 'connected' ? 'text-pixtune-success' : status === 'error' ? 'text-pixtune-danger' : 'text-pixtune-textSecondary'}`}>
        {config.label}
      </span>
    </div>
  )
}

function StatCard({ title, value, subtitle, icon }: { title: string; value: string | number; subtitle: string; icon: React.ReactNode }) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-caption text-pixtune-textMuted uppercase tracking-wider">{title}</p>
          <p className="text-heading-sm font-bold text-pixtune-text truncate" title={String(value)}>
            {value}
          </p>
          <p className="text-caption text-pixtune-textSecondary truncate" title={subtitle}>
            {subtitle}
          </p>
        </div>
        <div className="w-8 h-8 flex-shrink-0 rounded-lg bg-pixtune-primary/10 text-pixtune-primary flex items-center justify-center">
          {icon}
        </div>
      </div>
    </Card>
  )
}

function NowPlayingCard({
  track,
  isPlaying,
  volume,
  positionMs,
  durationMs,
  isReady,
  error,
  onTogglePlay,
  onPrevious,
  onNext,
  onVolumeChange,
}: {
  track: any
  isPlaying: boolean
  volume: number
  positionMs: number
  durationMs: number
  isReady: boolean
  error: string | null
  onTogglePlay: () => void
  onPrevious: () => void
  onNext: () => void
  onVolumeChange: (v: number) => void
}) {
  const navigate = useNavigate()
  const totalMs = durationMs || track?.durationMs || 0
  const progress = totalMs > 0 ? Math.min(100, (positionMs / totalMs) * 100) : 0
  const playable = Boolean(track?.providerId)

  return (
    <Card className="p-6">
      <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h3 className="text-body font-semibold text-pixtune-text">Agora tocando</h3>
          <p className="text-caption text-pixtune-textSecondary">
            Áudio do YouTube, sem exibir o vídeo • a maior doação toca primeiro
          </p>
        </div>
        <Badge variant="info" className="w-fit flex-shrink-0">YouTube • áudio</Badge>
      </div>
      <div className="space-y-6">
        {track ? (
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="w-24 h-24 rounded-xl bg-pixtune-surfaceElevated border border-pixtune-border flex-shrink-0 relative overflow-hidden">
                {track.artworkUrl ? (
                  <img src={track.artworkUrl} alt={track.title} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-pixtune-textMuted">
                    <Music className="w-10 h-10" />
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-heading-sm font-bold text-pixtune-text truncate">{track.title}</p>
                <p className="text-body-sm text-pixtune-textSecondary truncate">{track.artist || 'Artista desconhecido'}</p>
                {track.album && (
                  <p className="text-caption text-pixtune-textMuted truncate">{track.album}</p>
                )}
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <Badge variant={track.provider === 'youtube' ? 'info' : 'default'}>{track.provider === 'youtube' ? 'YouTube' : track.provider}</Badge>
                  {track.amountCents > 0 && (
                    <Badge variant="success">
                      <Trophy className="mr-1 h-3 w-3" aria-hidden="true" />
                      {formatCurrency(track.amountCents)}
                      {track.donorName ? ` • ${track.donorName}` : ''}
                    </Badge>
                  )}
                  {track.sourceUrl && (
                    <a
                      href={track.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-caption text-pixtune-primary hover:text-pixtune-primaryHover"
                    >
                      Abrir no YouTube <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
              </div>
              <div className="text-right hidden sm:block">
                <p className="text-body font-mono text-pixtune-text">{totalMs ? formatDuration(totalMs) : '--:--'}</p>
              </div>
            </div>

            <div className="space-y-1">
              <div
                className="h-1.5 w-full rounded-full bg-pixtune-border overflow-hidden"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(progress)}
                aria-label="Progresso da música"
              >
                <div className="h-full bg-pixtune-primary transition-all duration-500" style={{ width: `${progress}%` }} />
              </div>
              <div className="flex items-center justify-between text-caption text-pixtune-textMuted font-mono">
                <span>{formatDuration(positionMs)}</span>
                <span>{totalMs ? formatDuration(totalMs) : '--:--'}</span>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Button variant="ghost" size="icon" onClick={onPrevious} aria-label="Música anterior">
                <SkipBack className="w-5 h-5" />
              </Button>
              <Button
                variant="primary"
                size="lg"
                className="w-14 h-14 rounded-full"
                onClick={onTogglePlay}
                disabled={!playable || !isReady}
                aria-label={isPlaying ? 'Pausar áudio' : 'Tocar áudio'}
              >
                {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
              </Button>
              <Button variant="ghost" size="icon" onClick={onNext} aria-label="Próxima música">
                <SkipForward className="w-5 h-5" />
              </Button>
              {!isReady && (
                <span className="text-caption text-pixtune-textMuted">Carregando player do YouTube...</span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <span className="text-caption text-pixtune-textMuted">Volume</span>
              <input
                type="range"
                min="0"
                max="100"
                value={volume}
                onChange={(e) => onVolumeChange(parseInt(e.target.value))}
                className="w-24 h-2 bg-pixtune-border rounded-lg appearance-none cursor-pointer accent-pixtune-primary"
                aria-label="Volume do player"
              />
              <span className="text-caption text-pixtune-textMuted font-mono">{volume}%</span>
            </div>

            {!playable && (
              <p className="text-caption text-pixtune-warning" role="status">
                Este item não tem um link do YouTube. Abra a fila e adicione um link para poder ouvir.
              </p>
            )}
            {error && (
              <p className="text-caption text-pixtune-danger" role="alert">
                {error}
              </p>
            )}
          </div>
        ) : (
          <div className="text-center py-8">
            <Music className="w-12 h-12 text-pixtune-textMuted mx-auto mb-4" />
            <p className="text-pixtune-textSecondary">Nenhuma música na fila</p>
            <Button variant="outline" onClick={() => navigate('/queue')} className="mt-4">
              Adicionar música
            </Button>
          </div>
        )}
      </div>
    </Card>
  )
}

function QueueControlsCard({ onClear }: { onClear: () => void | Promise<void> }) {
  const navigate = useNavigate()
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-body font-semibold text-pixtune-text">Controles da fila</h3>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Button variant="outline" className="w-full" onClick={() => navigate('/queue')}>
          <Music className="w-4 h-4 mr-2" /> Abrir fila
        </Button>
        <Button variant="outline" className="w-full" onClick={onClear}>
          <TrashIcon className="w-4 h-4 mr-2" /> Limpar fila
        </Button>
      </div>
    </Card>
  )
}

function RecentDonationsCard({ events }: { events: any[] }) {
  const statusLabel: Record<string, string> = {
    processed: 'Processado',
    validated: 'Aguardando link',
    ignored: 'Ignorada',
    received: 'Recebido',
    failed: 'Falhou',
    duplicate: 'Duplicado',
  }

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="min-w-0 truncate text-body font-semibold text-pixtune-text">Doações recentes</h3>
        <Link to="/history" className="flex-shrink-0 text-caption font-medium text-pixtune-primary hover:text-pixtune-primaryHover">Ver tudo</Link>
      </div>
      <div className="space-y-3">
        {events.length === 0 ? (
          <div className="text-center py-4">
            <p className="text-caption text-pixtune-textMuted">Nenhuma doação registrada</p>
          </div>
        ) : (
          <div className="space-y-2">
            {events.map((event: any) => (
              <div key={event.id} className="flex items-center justify-between p-2 rounded-lg bg-pixtune-surfaceElevated/50">
                <div className="flex-1 min-w-0">
                  <p className="text-body-sm font-medium text-pixtune-text truncate">{event.donorName}</p>
                  <p className="text-caption text-pixtune-textSecondary truncate">
                    {event.queueItem
                      ? `Música: ${event.queueItem.title}${event.queueItem.artist ? ` — ${event.queueItem.artist}` : ''}`
                      : event.donorMessage || 'Sem mensagem'}
                  </p>
                  {event.status === 'ignored' && event.errorMessage && (
                    <p className="text-[10px] text-pixtune-textMuted truncate">{event.errorMessage}</p>
                  )}
                </div>
                <div className="text-right flex-shrink-0 ml-2">
                  <p className="text-body-sm font-bold text-pixtune-text">{formatCurrency(event.amountCents)}</p>
                  <Badge
                    variant={event.status === 'processed' ? 'success' : event.status === 'failed' ? 'danger' : 'neutral'}
                    className="text-[10px]"
                  >
                    {statusLabel[event.status] || event.status}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  )
}

function QuickActionsCard({ onNext }: { onNext: () => void | Promise<void> }) {
  const navigate = useNavigate()
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-body font-semibold text-pixtune-text">Ações rápidas</h3>
      </div>
      <div className="space-y-3">
        <Button variant="outline" className="w-full" onClick={() => navigate('/queue')}>
          <Music className="w-4 h-4 mr-2" /> Adicionar à fila
        </Button>
        <Button variant="outline" className="w-full" onClick={onNext}>
          <Play className="w-4 h-4 mr-2" /> Pular próxima
        </Button>
      </div>
    </Card>
  )
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path d="M3 6h18M19 6v14c0 1 0 1.5-.5 2h-2C13 21.5 13 20 13 19v-5a2 2 0 012-2h6a2 2 0 012 2v5c0 1 0 1-.5 2h-2c-.5 0-.5-.5-.5-2v-14Z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}