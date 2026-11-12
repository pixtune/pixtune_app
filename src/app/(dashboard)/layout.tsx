'use client'

import React, { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  LayoutDashboard,
  ListMusic,
  History,
  Settings,
  SlidersHorizontal,
  LogOut,
  User,
  ChevronLeft,
  Menu,
  AlertCircle,
  CheckCircle2,
  CircleOff,
  Loader2,
  Play,
  Plus,
  Radio,
  Sparkles,
  Music,
  Bell,
  type LucideIcon,
} from 'lucide-react'
import { useAuth } from '@client/contexts/AuthContext'
import { Button } from '@client/components/ui/Button'
import { Logo } from '@client/components/ui/Logo'
import { SpotifyPlaylistModal } from '@client/components/spotify/SpotifyPlaylistModal'
import { SpotifyAudioProvider, useAudioPlayer } from '@client/player/SpotifyAudioPlayer'
import { cn } from '@shared/utils'
import { apiDonations } from '@client/api/client'

const navigation = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { name: 'Fila', href: '/queue', icon: ListMusic },
  { name: 'Histórico', href: '/history', icon: History },
  { name: 'Regras', href: '/rules', icon: SlidersHorizontal },
  { name: 'Configurações', href: '/settings', icon: Settings },
]

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <SpotifyAudioProvider>
      <DashboardContent>{children}</DashboardContent>
    </SpotifyAudioProvider>
  )
}

function DashboardContent({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth()
  const pathname = usePathname()
  const router = useRouter()
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [playlistModalOpen, setPlaylistModalOpen] = useState(false)

  useEffect(() => {
    const handleOpenModal = () => setPlaylistModalOpen(true)
    window.addEventListener('pixtune:open-spotify-modal', handleOpenModal)
    return () => {
      window.removeEventListener('pixtune:open-spotify-modal', handleOpenModal)
    }
  }, [])

  return (
    <div className="min-h-screen bg-pixtune-bg flex">
      {/* Mobile overlay */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed lg:relative z-50 flex flex-col bg-pixtune-surface border-r border-pixtune-border transition-all duration-300',
          sidebarOpen ? 'w-64' : 'w-20',
          !sidebarOpen && 'lg:w-20',
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        )}
        aria-label="Navegação principal"
      >
        {/* Logo */}
        <div className="flex items-center justify-between h-16 px-4 border-b border-pixtune-border">
          <Link href="/dashboard" className="flex items-center overflow-hidden" aria-label="PixTune Dashboard">
            <Logo size={sidebarOpen ? 'md' : 'sm'} variant={sidebarOpen ? 'full' : 'icon'} />
          </Link>
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className={cn(
              'p-1.5 rounded-lg text-pixtune-textSecondary hover:text-pixtune-text hover:bg-pixtune-surfaceElevated transition-all flex items-center justify-center',
              !sidebarOpen && 'rotate-180'
            )}
            title={sidebarOpen ? 'Recolher menu lateral' : 'Expandir menu lateral'}
            aria-label={sidebarOpen ? 'Recolher menu lateral' : 'Expandir menu lateral'}
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-1.5 overflow-y-auto" role="navigation" aria-label="Menu principal">
          <Link
            href="/dashboard"
            onClick={() => setMobileMenuOpen(false)}
            className={cn(
              'flex items-center gap-3 px-3 py-2.5 rounded-xl text-body-sm transition-all duration-150',
              pathname === '/dashboard'
                ? 'bg-[#1ED760]/10 text-[#1ED760] font-semibold border border-[#1ED760]/20'
                : 'text-pixtune-textSecondary hover:text-white hover:bg-pixtune-surfaceElevated',
              !sidebarOpen && 'justify-center px-2'
            )}
          >
            <LayoutDashboard className="w-5 h-5 flex-shrink-0 text-[#1ED760]" />
            {!sidebarOpen ? null : <span>Dashboard</span>}
          </Link>

          <Link
            href="/queue"
            onClick={() => setMobileMenuOpen(false)}
            className={cn(
              'flex items-center gap-3 px-3 py-2.5 rounded-xl text-body-sm transition-all duration-150',
              pathname === '/queue'
                ? 'bg-[#1ED760]/10 text-[#1ED760] font-semibold border border-[#1ED760]/20'
                : 'text-pixtune-textSecondary hover:text-white hover:bg-pixtune-surfaceElevated',
              !sidebarOpen && 'justify-center px-2'
            )}
          >
            <ListMusic className="w-5 h-5 flex-shrink-0" />
            {!sidebarOpen ? null : <span>Fila de Pix</span>}
          </Link>

          <button
            onClick={() => {
              setPlaylistModalOpen(true)
              setMobileMenuOpen(false)
            }}
            className={cn(
              'flex w-full items-center gap-3 px-3 py-2.5 rounded-xl text-body-sm font-medium transition-all text-pixtune-textSecondary hover:text-white hover:bg-pixtune-surfaceElevated',
              !sidebarOpen && 'justify-center px-2'
            )}
          >
            <Music className="w-5 h-5 flex-shrink-0 text-[#1ED760]" />
            {!sidebarOpen ? null : <span>Playlists Spotify</span>}
          </button>

          <Link
            href="/rules"
            onClick={() => setMobileMenuOpen(false)}
            className={cn(
              'flex items-center gap-3 px-3 py-2.5 rounded-xl text-body-sm transition-all duration-150',
              pathname === '/rules'
                ? 'bg-[#1ED760]/10 text-[#1ED760] font-semibold border border-[#1ED760]/20'
                : 'text-pixtune-textSecondary hover:text-white hover:bg-pixtune-surfaceElevated',
              !sidebarOpen && 'justify-center px-2'
            )}
          >
            <SlidersHorizontal className="w-5 h-5 flex-shrink-0" />
            {!sidebarOpen ? null : <span>Regras da Live</span>}
          </Link>
        </nav>

        {/* Rodapé da Sidebar idêntico à Página 1 do documento */}
        <div className="p-3 border-t border-pixtune-border/80 space-y-3">
          {sidebarOpen && (
            <>
              {/* Card Status da Live */}
              <div className="rounded-xl border border-pixtune-border/60 bg-[#070F14]/70 p-3 space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-pixtune-textMuted block">
                  STATUS DA LIVE
                </span>
                <div className="flex items-center gap-2">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#1ED760] opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-[#1ED760]"></span>
                  </span>
                  <span className="text-caption font-semibold text-white">Conectado ao OBS</span>
                </div>
              </div>

              {/* Botão Modo de Teste */}
              <button
                type="button"
                onClick={() => setPlaylistModalOpen(true)}
                className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg border border-[#00E0FF]/30 bg-[#00E0FF]/10 text-[#00E0FF] text-caption font-semibold hover:bg-[#00E0FF]/20 transition-all"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Modo de Teste</span>
              </button>
            </>
          )}

          {/* User profile */}
          <div className={cn('flex items-center gap-3 px-2 py-2 rounded-xl bg-pixtune-surfaceElevated/40 border border-pixtune-border/60', !sidebarOpen && 'justify-center')}>
            <div className="relative w-9 h-9 rounded-full overflow-hidden border-2 border-[#1ED760] flex-shrink-0">
              {user?.avatarUrl ? (
                <img src={user.avatarUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full bg-[#1ED760]/20 flex items-center justify-center text-[#1ED760] font-bold text-xs">
                  AS
                </div>
              )}
            </div>
            {!sidebarOpen ? null : (
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-body-sm text-white truncate">{user?.name || 'Alex Streamer'}</p>
                <p className="text-[11px] font-bold text-[#1ED760] tracking-wide">Pro Plan</p>
              </div>
            )}
            {!sidebarOpen ? null : (
              <button
                onClick={async () => {
                  await logout()
                  router.push('/login')
                }}
                className="p-1.5 rounded-lg text-pixtune-textMuted hover:text-pixtune-danger hover:bg-pixtune-surface transition-colors"
                title="Sair"
              >
                <LogOut className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 pb-20 lg:pb-0 overflow-x-hidden">
        {/* Top bar responsiva idêntica ao design da Página 1 e 4 */}
        <header className="sticky top-0 z-30 flex h-14 sm:h-16 items-center justify-between border-b border-pixtune-border/80 bg-[#070F14]/90 px-3 sm:px-6 backdrop-blur-xl">
          {/* Lado Esquerdo */}
          <div className="flex items-center gap-3 min-w-0">
            {/* Mobile: Menu toggle + Status ao vivo OBS */}
            <div className="lg:hidden flex items-center gap-2">
              <button
                type="button"
                onClick={() => setMobileMenuOpen(true)}
                className="p-1.5 -ml-1 rounded-lg text-pixtune-textSecondary hover:text-white hover:bg-pixtune-surfaceElevated transition-colors"
                aria-label="Abrir menu lateral"
              >
                <Menu className="w-5 h-5" />
              </button>
              <span className="relative flex h-2 w-2 flex-shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#1ED760] opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-[#1ED760]"></span>
              </span>
              <span className="text-caption font-semibold text-white truncate max-w-[130px] sm:max-w-[200px]">
                OBS Conectado
              </span>
            </div>

            {/* Desktop: Título da tela */}
            <div className="hidden lg:flex items-center gap-3">
              <h1 className="text-xl font-bold text-white font-display">
                {pathname === '/dashboard'
                  ? 'Visão Geral'
                  : pathname === '/queue'
                    ? 'Fila de Músicas'
                    : pathname === '/rules'
                      ? 'Regras da Live'
                      : pathname === '/history'
                        ? 'Histórico'
                        : 'Configurações'}
              </h1>
            </div>
          </div>

          {/* Lado Direito */}
          <div className="flex items-center gap-3 sm:gap-6 flex-shrink-0">
            {/* Mobile: Pill Teste */}
            <div className="lg:hidden flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPlaylistModalOpen(true)}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#00E0FF]/15 border border-[#00E0FF]/30 text-[#00E0FF] text-[11px] font-semibold"
              >
                <Sparkles className="w-3 h-3" />
                <span>Teste</span>
              </button>

              <div className="relative w-8 h-8 rounded-full overflow-hidden border border-[#1ED760]">
                {user?.avatarUrl ? (
                  <img src={user.avatarUrl} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-[#1ED760]/20 flex items-center justify-center text-[#1ED760] font-bold text-xs">
                    AS
                  </div>
                )}
              </div>
            </div>

            {/* Desktop: Métricas no Header da Página 1 */}
            <div className="hidden lg:flex items-center gap-6">
              <div className="text-right">
                <span className="text-[11px] text-pixtune-textMuted block font-medium">Total Hoje</span>
                <span className="text-body-sm font-bold text-[#1ED760]">R$ 1.240,50</span>
              </div>

              <div className="h-7 w-[1px] bg-pixtune-border/80" />

              <div className="text-right">
                <span className="text-[11px] text-pixtune-textMuted block font-medium">Músicas na Fila</span>
                <span className="text-body-sm font-bold text-white">12 tracks</span>
              </div>

              <button
                type="button"
                className="p-2 rounded-full text-pixtune-textMuted hover:text-white hover:bg-pixtune-surfaceElevated transition-colors"
                title="Notificações"
              >
                <Bell className="w-4 h-4" />
              </button>
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 p-3 sm:p-4 lg:p-6 overflow-y-auto overflow-x-hidden">
          {children}
        </main>
      </div>

      {/* Mobile Bottom Navigation Bar idêntica à Página 4 */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-40 lg:hidden flex items-center justify-around h-16 bg-[#070F14]/95 border-t border-pixtune-border/80 backdrop-blur-xl px-2 shadow-2xl"
        role="navigation"
        aria-label="Menu móvel"
      >
        <Link
          href="/dashboard"
          className={cn(
            'flex flex-col items-center justify-center flex-1 py-1 gap-1 text-[11px] font-medium transition-colors',
            pathname === '/dashboard' ? 'text-[#1ED760]' : 'text-pixtune-textMuted hover:text-white'
          )}
        >
          <LayoutDashboard className="w-5 h-5" />
          <span>Home</span>
        </Link>

        <Link
          href="/queue"
          className={cn(
            'flex flex-col items-center justify-center flex-1 py-1 gap-1 text-[11px] font-medium transition-colors',
            pathname === '/queue' ? 'text-[#1ED760]' : 'text-pixtune-textMuted hover:text-white'
          )}
        >
          <ListMusic className="w-5 h-5" />
          <span>Fila</span>
        </Link>

        {/* Botão Central Flutuante (+) Verde Néon da Página 4 */}
        <div className="flex items-center justify-center flex-1 -mt-5">
          <button
            onClick={() => setPlaylistModalOpen(true)}
            className="flex h-12 w-12 items-center justify-center rounded-full bg-[#1ED760] text-black shadow-lg shadow-[#1ED760]/30 hover:scale-105 active:scale-95 transition-all"
            aria-label="Importar playlist ou adicionar música"
          >
            <Plus className="w-6 h-6 stroke-[2.5]" />
          </button>
        </div>

        <button
          onClick={() => setPlaylistModalOpen(true)}
          className="flex flex-col items-center justify-center flex-1 py-1 gap-1 text-[11px] font-medium text-pixtune-textMuted hover:text-white transition-colors"
        >
          <Music className="w-5 h-5 text-[#1ED760]" />
          <span>Spotify</span>
        </button>

        <Link
          href="/rules"
          className={cn(
            'flex flex-col items-center justify-center flex-1 py-1 gap-1 text-[11px] font-medium transition-colors',
            pathname === '/rules' ? 'text-[#1ED760]' : 'text-pixtune-textMuted hover:text-white'
          )}
        >
          <SlidersHorizontal className="w-5 h-5" />
          <span>Regras</span>
        </Link>
      </nav>

      {/* Modal global de Playlists do Spotify */}
      <SpotifyPlaylistModal
        isOpen={playlistModalOpen}
        onClose={() => setPlaylistModalOpen(false)}
        onPlaylistImported={() => {
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new Event('pixtune:queue-updated'))
          }
        }}
      />
    </div>
  )
}

type ConnectionState = 'connected' | 'connecting' | 'waiting' | 'error' | 'disconnected'

const CONNECTION_STATES: Record<
  ConnectionState,
  { label: string; icon: LucideIcon; color: string; spin?: boolean }
> = {
  connected: { label: 'Conectado', icon: CheckCircle2, color: 'text-pixtune-success' },
  connecting: { label: 'Conectando', icon: Loader2, color: 'text-pixtune-warning', spin: true },
  waiting: { label: 'Aguardando Play', icon: Play, color: 'text-pixtune-warning' },
  error: { label: 'Erro', icon: AlertCircle, color: 'text-pixtune-danger' },
  disconnected: { label: 'Desconectado', icon: CircleOff, color: 'text-pixtune-textMuted' },
}

function ConnectionIndicators() {
  const [livepixStatus, setLivepixStatus] = useState<'connected' | 'disconnected'>('disconnected')
  const { isReady, error, accountError, needsAudioActivation } = useAudioPlayer()

  useEffect(() => {
    let cancelled = false
    function load() {
      apiDonations
        .config()
        .then((lp) => {
          if (cancelled) return
          setLivepixStatus(lp.data?.connected ? 'connected' : 'disconnected')
        })
        .catch(() => {
          if (!cancelled) setLivepixStatus('disconnected')
        })
    }
    load()
    window.addEventListener('pixtune:livepix-changed', load)
    return () => {
      cancelled = true
      window.removeEventListener('pixtune:livepix-changed', load)
    }
  }, [])

  const needsSpotifyConnection = Boolean(
    error && /conecte sua conta|não configurado no servidor/i.test(error)
  )
  const isAutoplayBlocked = Boolean(
    needsAudioActivation || (error && /bloqueou o áudio|toque no botão play/i.test(error))
  )
  const playerError = !isAutoplayBlocked && (accountError || error)
  const musicStatus: ConnectionState = playerError
    ? needsSpotifyConnection
      ? 'disconnected'
      : 'error'
    : isAutoplayBlocked
      ? 'waiting'
      : isReady
        ? 'connected'
        : 'connecting'

  const playerDetail =
    accountError ||
    (isAutoplayBlocked
      ? 'Toque em Play para liberar o som neste dispositivo'
      : error || undefined)

  return (
    <div
      className="flex flex-row items-center gap-2 sm:gap-4 overflow-x-auto text-[11px] sm:text-caption"
      role="status"
      aria-live="polite"
    >
      <ConnectionBadge service="Live Pix" status={livepixStatus} />
      <ConnectionBadge service="Player" status={musicStatus} detail={playerDetail} />
    </div>
  )
}

function ConnectionBadge({
  service,
  status,
  detail,
}: {
  service: string
  status: ConnectionState
  detail?: string
}) {
  const state = CONNECTION_STATES[status] ?? CONNECTION_STATES.disconnected
  const Icon = state.icon

  return (
    <span
      className="flex items-center gap-1.5 whitespace-nowrap bg-pixtune-surfaceElevated/60 border border-pixtune-border/80 px-2.5 py-1 rounded-lg"
      title={`${service}: ${state.label}${detail ? ` — ${detail}` : ''}`}
    >
      <Icon
        className={cn('h-3.5 w-3.5 flex-shrink-0', state.color, state.spin && 'animate-spin')}
        aria-hidden="true"
      />
      <span className="font-medium text-pixtune-textMuted">
        {service} <span className={state.color}>{state.label}</span>
      </span>
    </span>
  )
}

