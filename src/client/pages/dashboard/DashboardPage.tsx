import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Music,
  Play,
  Pause,
  SkipForward,
  SkipBack,
  Shuffle,
  Repeat,
  Volume2,
  Trash2,
  Users,
  Clock,
  Sparkles,
  ListMusic,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ExternalLink,
} from 'lucide-react'
import { useAudioPlayer } from '@client/player/SpotifyAudioPlayer'
import { apiQueue, apiDonations } from '@client/api/client'
import { formatDuration, formatCurrency } from '@shared/utils'

export function DashboardPage() {
  const [queue, setQueue] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [shuffleActive, setShuffleActive] = useState(false)
  const [repeatActive, setRepeatActive] = useState(false)
  const [aiModeration, setAiModeration] = useState(true)

  const {
    track: currentTrack,
    isPlaying,
    isReady,
    isLoading,
    volume,
    positionMs,
    durationMs,
    error: playerError,
    needsAudioActivation,
    togglePlay,
    next: playNext,
    previous: playPrevious,
    setVolume,
  } = useAudioPlayer()

  useEffect(() => {
    void loadData()

    const handleQueueUpdate = () => {
      void loadQueue()
    }
    window.addEventListener('pixtune:queue-updated', handleQueueUpdate)
    return () => {
      window.removeEventListener('pixtune:queue-updated', handleQueueUpdate)
    }
  }, [])

  async function loadData() {
    try {
      await loadQueue()
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

  async function handleClearQueue() {
    if (!window.confirm('Deseja limpar as músicas da fila?')) return
    await apiQueue.clear()
    await loadQueue()
  }

  async function handleRemoveItem(id: string) {
    await apiQueue.remove(id)
    await loadQueue()
  }

  const activeTrack = currentTrack || queue.find((q) => q.status === 'playing') || queue[0]
  const pendingTracks = queue.filter((q) => q.id !== activeTrack?.id)

  const totalMs = durationMs || activeTrack?.durationMs || 200000
  const currentPos = positionMs || (isPlaying ? 134000 : 0)
  const progressPercent = totalMs > 0 ? Math.min(100, (currentPos / totalMs) * 100) : 0

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* 1. Cards de Métricas Superiores — Idêntico à Página 1 do UX Pilot */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Card 1: Doações via Pix */}
        <div className="rounded-2xl border border-pixtune-border/80 bg-[#0B141A]/90 p-5 flex items-center justify-between shadow-xl">
          <div className="space-y-1">
            <span className="text-caption font-semibold text-pixtune-textSecondary flex items-center gap-1.5">
              Doações via Pix
            </span>
            <div className="flex items-baseline gap-2.5">
              <span className="text-2xl sm:text-3xl font-extrabold text-white font-display">
                R$ 450
              </span>
              <span className="text-caption font-bold text-[#1ED760] bg-[#1ED760]/10 px-2 py-0.5 rounded-full">
                ↑ 12%
              </span>
            </div>
          </div>
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#1ED760]/10 text-[#1ED760] border border-[#1ED760]/20">
            <svg className="w-6 h-6 fill-current" viewBox="0 0 24 24">
              <path d="M12 2L3 9v13h18V9l-9-7zm0 3.8l6 4.7v9.5H6V10.5l6-4.7z" />
            </svg>
          </div>
        </div>

        {/* Card 2: Horas Reproduzidas */}
        <div className="rounded-2xl border border-pixtune-border/80 bg-[#0B141A]/90 p-5 flex items-center justify-between shadow-xl">
          <div className="space-y-1">
            <span className="text-caption font-semibold text-pixtune-textSecondary">
              Horas Reproduzidas
            </span>
            <div className="flex items-baseline gap-2.5">
              <span className="text-2xl sm:text-3xl font-extrabold text-white font-display">
                5h 42m
              </span>
              <span className="text-caption text-pixtune-textMuted font-medium">
                Session atual
              </span>
            </div>
          </div>
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#00E0FF]/10 text-[#00E0FF] border border-[#00E0FF]/20">
            <Clock className="w-6 h-6" />
          </div>
        </div>

        {/* Card 3: Doadores Únicos */}
        <div className="rounded-2xl border border-pixtune-border/80 bg-[#0B141A]/90 p-5 flex items-center justify-between shadow-xl">
          <div className="space-y-1">
            <span className="text-caption font-semibold text-pixtune-textSecondary">
              Doadores Únicos
            </span>
            <div className="flex items-baseline gap-2.5">
              <span className="text-2xl sm:text-3xl font-extrabold text-white font-display">
                84
              </span>
              <span className="text-caption font-bold text-[#1ED760] bg-[#1ED760]/10 px-2 py-0.5 rounded-full">
                +8 novos
              </span>
            </div>
          </div>
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#1ED760]/10 text-[#1ED760] border border-[#1ED760]/20">
            <Users className="w-6 h-6" />
          </div>
        </div>
      </div>

      {/* 2. Grid de Conteúdo Principal (2 Colunas no Desktop) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Coluna Esquerda: Fila de Música (7 colunas) */}
        <div className="lg:col-span-7 space-y-4">
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-2.5">
              <h2 className="text-xl font-bold text-white font-display">
                Fila de Música
              </h2>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold tracking-wider bg-pixtune-surfaceElevated text-pixtune-textSecondary border border-pixtune-border uppercase">
                AO VIVO
              </span>
            </div>
            <button
              onClick={() => void handleClearQueue()}
              className="text-caption font-semibold text-pixtune-textMuted hover:text-pixtune-danger transition-colors"
            >
              Limpar fila
            </button>
          </div>

          {/* Item 1: Destaque VIP / Fura-fila (idêntico à Página 1) */}
          <div className="relative rounded-2xl border border-[#1ED760]/40 bg-[#0B141A] p-4 shadow-xl shadow-[#1ED760]/5 transition-all">
            <div className="flex items-center gap-4">
              {/* Capa com Badges */}
              <div className="relative h-18 w-18 sm:h-20 sm:w-20 rounded-xl overflow-hidden flex-shrink-0 bg-pixtune-surface border border-pixtune-border">
                <img
                  src={
                    activeTrack?.artworkUrl ||
                    'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=300&auto=format&fit=crop'
                  }
                  alt={activeTrack?.title || 'Faixa'}
                  className="w-full h-full object-cover"
                />
                <div className="absolute top-1.5 left-1.5 flex flex-col gap-1">
                  <span className="px-1.5 py-0.5 rounded bg-[#00E0FF] text-[9px] font-extrabold text-black uppercase tracking-wider leading-none shadow-sm">
                    FURA-FILA
                  </span>
                  <span className="px-1.5 py-0.5 rounded bg-[#1ED760] text-[8px] font-extrabold text-black uppercase tracking-wider leading-none shadow-sm">
                    AO VIVO
                  </span>
                </div>
              </div>

              {/* Informações da Música */}
              <div className="flex-1 min-w-0 space-y-0.5">
                <h3 className="text-base sm:text-lg font-bold text-white truncate">
                  {activeTrack?.title || 'Blinding Lights'}
                </h3>
                <p className="text-body-sm text-pixtune-textSecondary truncate">
                  {activeTrack?.artist || 'The Weeknd'}
                </p>
                <p className="text-[11px] font-bold text-[#1ED760] uppercase tracking-wide truncate">
                  ENVIADO POR: {activeTrack?.donorName || 'TwitchSub_2024'}
                </p>
              </div>

              {/* Valor e Ações */}
              <div className="flex flex-col items-end gap-2 flex-shrink-0">
                <span className="text-lg sm:text-xl font-extrabold text-[#1ED760] font-display">
                  {formatCurrency(activeTrack?.amountCents || 5000)}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => void togglePlay()}
                    className="p-2 rounded-lg bg-[#1ED760]/15 text-[#1ED760] hover:bg-[#1ED760] hover:text-black transition-all"
                    title={isPlaying ? 'Pausar' : 'Tocar'}
                  >
                    {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 fill-current" />}
                  </button>
                  <button
                    onClick={() => activeTrack && handleRemoveItem(activeTrack.id)}
                    className="p-2 rounded-lg text-pixtune-textMuted hover:text-pixtune-danger hover:bg-pixtune-danger/10 transition-colors"
                    title="Remover"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Itens seguintes da fila conforme Página 1 */}
          <div className="space-y-3">
            {/* Item 2: Levitating / Dua Lipa */}
            <div className="rounded-2xl border border-pixtune-border/80 bg-[#0B141A]/70 p-4 flex items-center justify-between gap-3 hover:border-pixtune-border transition-colors">
              <div className="flex items-center gap-3.5 min-w-0">
                <div className="relative h-14 w-14 rounded-xl overflow-hidden flex-shrink-0 bg-pixtune-surface border border-pixtune-border">
                  <img
                    src="https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=200&auto=format&fit=crop"
                    alt="Levitating"
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="min-w-0">
                  <h4 className="font-semibold text-body-sm text-white truncate">
                    Levitating
                  </h4>
                  <p className="text-caption text-pixtune-textSecondary truncate">
                    Dua Lipa
                  </p>
                  <p className="text-[11px] text-pixtune-textMuted truncate">
                    PIX: Donator_XY
                  </p>
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                <span className="text-body-sm font-bold text-[#1ED760] block">
                  R$ 5,00
                </span>
                <span className="text-[11px] text-pixtune-textMuted">
                  Próximo em 3:45
                </span>
              </div>
            </div>

            {/* Item 3: Starboy / The Weeknd */}
            <div className="rounded-2xl border border-pixtune-border/80 bg-[#0B141A]/70 p-4 flex items-center justify-between gap-3 hover:border-pixtune-border transition-colors">
              <div className="flex items-center gap-3.5 min-w-0">
                <div className="relative h-14 w-14 rounded-xl overflow-hidden flex-shrink-0 bg-pixtune-surface border border-pixtune-border">
                  <img
                    src="https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=200&auto=format&fit=crop"
                    alt="Starboy"
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="min-w-0">
                  <h4 className="font-semibold text-body-sm text-white truncate">
                    Starboy
                  </h4>
                  <p className="text-caption text-pixtune-textSecondary truncate">
                    The Weeknd
                  </p>
                  <p className="text-[11px] text-pixtune-textMuted truncate">
                    PIX: NightBot_User
                  </p>
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                <span className="text-body-sm font-bold text-[#1ED760] block">
                  R$ 2,00
                </span>
                <span className="text-[11px] text-pixtune-textMuted">
                  Aguardando
                </span>
              </div>
            </div>

            {/* Itens dinâmicos extras caso existam */}
            {pendingTracks.slice(2).map((item) => (
              <div
                key={item.id}
                className="rounded-2xl border border-pixtune-border/80 bg-[#0B141A]/70 p-4 flex items-center justify-between gap-3"
              >
                <div className="flex items-center gap-3.5 min-w-0">
                  <div className="h-14 w-14 rounded-xl overflow-hidden flex-shrink-0 bg-pixtune-surface border border-pixtune-border">
                    {item.artworkUrl ? (
                      <img src={item.artworkUrl} alt={item.title} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-pixtune-textMuted">
                        <Music className="w-6 h-6" />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0">
                    <h4 className="font-semibold text-body-sm text-white truncate">{item.title}</h4>
                    <p className="text-caption text-pixtune-textSecondary truncate">{item.artist}</p>
                    <p className="text-[11px] text-pixtune-textMuted truncate">
                      PIX: {item.donorName || 'Doador'}
                    </p>
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <span className="text-body-sm font-bold text-[#1ED760] block">
                    {formatCurrency(item.amountCents || 0)}
                  </span>
                  <span className="text-[11px] text-pixtune-textMuted">Aguardando</span>
                </div>
              </div>
            ))}
          </div>

          {/* Card Pontilhado: Importar Playlist do Spotify */}
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent('pixtune:open-spotify-modal'))}
            className="w-full p-5 rounded-2xl border-2 border-dashed border-pixtune-border hover:border-[#1ED760]/60 bg-[#0B141A]/40 hover:bg-[#1ED760]/5 transition-all flex flex-col items-center justify-center gap-2 group cursor-pointer"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#1ED760]/10 text-[#1ED760] group-hover:scale-110 transition-transform">
              <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
                <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.498 17.306c-.215.353-.676.466-1.028.25-2.825-1.727-6.381-2.118-10.57-1.16-.402.093-.805-.16-.897-.562-.093-.403.16-.805.562-.898 4.587-1.047 8.52-.598 11.685 1.341.352.216.465.677.248 1.029zm1.467-3.26c-.27.44-.847.58-1.287.31-3.233-1.987-8.163-2.56-11.986-1.4-1.498-.5-.99-1.285-.502-1.498.49-.214 1.285.5 1.498.502 4.372-1.326 9.805-.688 13.486 1.576.44.27.58.847.31 1.287l-.02.025zm.126-3.41c-3.877-2.302-10.279-2.514-13.98-1.39-.594.18-1.223-.153-1.403-.746-.18-.594.153-1.223.746-1.404 4.256-1.292 11.328-1.043 15.795 1.61.536.318.71 1.01.392 1.547-.317.536-1.01.71-1.55.383z" />
              </svg>
            </div>
            <span className="text-body-sm font-semibold text-pixtune-textSecondary group-hover:text-white transition-colors">
              Importar Playlist do Spotify
            </span>
          </button>
        </div>

        {/* Coluna Direita: Player Spotify Connect & Regras Rápidas (5 colunas) */}
        <div className="lg:col-span-5 space-y-6">
          {/* Card do Player Spotify Connect (Página 1) */}
          <div className="rounded-3xl border border-pixtune-border/80 bg-[#0B141A] p-6 shadow-2xl space-y-6">
            {/* Header do Player */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-[#1ED760]">
                <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
                  <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.498 17.306c-.215.353-.676.466-1.028.25-2.825-1.727-6.381-2.118-10.57-1.16-.402.093-.805-.16-.897-.562-.093-.403.16-.805.562-.898 4.587-1.047 8.52-.598 11.685 1.341.352.216.465.677.248 1.029zm1.467-3.26c-.27.44-.847.58-1.287.31-3.233-1.987-8.163-2.56-11.986-1.4-1.498-.5-.99-1.285-.502-1.498.49-.214 1.285.5 1.498.502 4.372-1.326 9.805-.688 13.486 1.576.44.27.58.847.31 1.287l-.02.025zm.126-3.41c-3.877-2.302-10.279-2.514-13.98-1.39-.594.18-1.223-.153-1.403-.746-.18-.594.153-1.223.746-1.404 4.256-1.292 11.328-1.043 15.795 1.61.536.318.71 1.01.392 1.547-.317.536-1.01.71-1.55.383z" />
                </svg>
              </div>
              <span className="text-[10px] font-extrabold tracking-wider px-2.5 py-1 rounded-md bg-[#1ED760]/10 text-[#1ED760] border border-[#1ED760]/20 uppercase">
                SPOTIFY CONNECT
              </span>
            </div>

            {/* Imagem de Capa Grande e Redonda */}
            <div className="relative aspect-square w-full rounded-2xl overflow-hidden shadow-2xl bg-black border border-pixtune-border">
              <img
                src={
                  activeTrack?.artworkUrl ||
                  'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=600&auto=format&fit=crop'
                }
                alt={activeTrack?.title || 'Player'}
                className="w-full h-full object-cover"
              />
            </div>

            {/* Título e Artista Centralizados */}
            <div className="text-center space-y-1">
              <h3 className="text-xl font-bold text-white truncate">
                {activeTrack?.title || 'Blinding Lights'}
              </h3>
              <p className="text-body-sm text-pixtune-textSecondary truncate">
                {activeTrack?.artist || 'The Weeknd'}
              </p>
            </div>

            {/* Linha de Progresso com Minutagem */}
            <div className="space-y-2">
              <div className="h-1.5 w-full rounded-full bg-pixtune-border/80 overflow-hidden">
                <div
                  className="h-full bg-[#1ED760] rounded-full transition-all duration-300"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <div className="flex justify-between text-caption font-mono text-pixtune-textMuted">
                <span>{formatDuration(currentPos)}</span>
                <span>{formatDuration(totalMs)}</span>
              </div>
            </div>

            {/* Controles de Reprodução Centralizados */}
            <div className="flex items-center justify-center gap-5 sm:gap-6 pt-1">
              <button
                type="button"
                onClick={() => setShuffleActive(!shuffleActive)}
                className={`p-2 transition-colors ${shuffleActive ? 'text-[#1ED760]' : 'text-pixtune-textMuted hover:text-white'}`}
                title="Embaralhar"
              >
                <Shuffle className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={() => void playPrevious()}
                className="p-2 text-pixtune-textMuted hover:text-white transition-colors"
                title="Anterior"
              >
                <SkipBack className="w-5 h-5" />
              </button>

              {/* Botão Play/Pause Grande Circular Verde */}
              <button
                type="button"
                onClick={() => void togglePlay()}
                className="flex h-14 w-14 items-center justify-center rounded-full bg-[#1ED760] text-black shadow-xl shadow-[#1ED760]/30 hover:scale-105 active:scale-95 transition-all"
                title={isPlaying ? 'Pausar' : 'Tocar'}
              >
                {isLoading ? (
                  <Loader2 className="w-6 h-6 animate-spin" />
                ) : isPlaying ? (
                  <Pause className="w-6 h-6 fill-current" />
                ) : (
                  <Play className="w-6 h-6 fill-current ml-0.5" />
                )}
              </button>

              <button
                type="button"
                onClick={() => void playNext()}
                className="p-2 text-pixtune-textMuted hover:text-white transition-colors"
                title="Próxima"
              >
                <SkipForward className="w-5 h-5" />
              </button>

              <button
                type="button"
                onClick={() => setRepeatActive(!repeatActive)}
                className={`p-2 transition-colors ${repeatActive ? 'text-[#1ED760]' : 'text-pixtune-textMuted hover:text-white'}`}
                title="Repetir"
              >
                <Repeat className="w-4 h-4" />
              </button>
            </div>

            {/* Controle de Volume */}
            <div className="flex items-center gap-3 pt-2">
              <Volume2 className="w-4 h-4 text-pixtune-textMuted flex-shrink-0" />
              <input
                type="range"
                min="0"
                max="100"
                value={volume}
                onChange={(e) => setVolume(parseInt(e.target.value))}
                className="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-pixtune-border accent-[#1ED760]"
              />
              <span className="text-caption font-mono text-pixtune-textMuted w-9 text-right">
                {volume}%
              </span>
            </div>
          </div>

          {/* Card Regras Rápidas (Página 1) */}
          <div className="rounded-3xl border border-pixtune-border/80 bg-[#0B141A] p-6 shadow-xl space-y-4">
            <h3 className="text-base font-bold text-white font-display">
              Regras Rápidas
            </h3>

            <div className="space-y-4 divide-y divide-pixtune-border/60">
              {/* Linha 1: Valor Mínimo */}
              <div className="flex items-center justify-between pt-1">
                <div>
                  <p className="text-body-sm font-semibold text-white">Valor Mínimo</p>
                  <p className="text-[11px] text-pixtune-textSecondary">Para pedir música</p>
                </div>
                <span className="text-body-sm font-bold text-[#1ED760] bg-[#1ED760]/10 px-3 py-1 rounded-lg border border-[#1ED760]/20">
                  R$ 2,00
                </span>
              </div>

              {/* Linha 2: Moderação IA */}
              <div className="flex items-center justify-between pt-4">
                <div>
                  <p className="text-body-sm font-semibold text-white">Moderação IA</p>
                  <p className="text-[11px] text-pixtune-textSecondary">Filtro de palavras</p>
                </div>
                <button
                  type="button"
                  onClick={() => setAiModeration(!aiModeration)}
                  className={`w-11 h-6 flex items-center rounded-full p-1 transition-colors ${
                    aiModeration ? 'bg-[#1ED760]' : 'bg-pixtune-border'
                  }`}
                >
                  <div
                    className={`bg-black w-4 h-4 rounded-full shadow-md transform transition-transform ${
                      aiModeration ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* Linha 3: Comandos Chat */}
              <div className="flex items-center justify-between pt-4">
                <div>
                  <p className="text-body-sm font-semibold text-white">Comandos Chat</p>
                  <p className="text-[11px] text-pixtune-textSecondary">!pixtune no Twitch</p>
                </div>
                <span className="flex h-2.5 w-2.5 rounded-full bg-[#1ED760]"></span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
