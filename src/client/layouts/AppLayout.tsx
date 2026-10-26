import { useState, useEffect } from 'react'
import { Outlet, Link, NavLink } from 'react-router-dom'
import {
  LayoutDashboard,
  ListMusic,
  History,
  Settings,
  SlidersHorizontal,
  LogOut,
  User,
  ChevronLeft,
  AlertCircle,
  CheckCircle2,
  CircleOff,
  Loader2,
  type LucideIcon,
} from 'lucide-react'
import { useAuth } from '@client/contexts/AuthContext'
import { Button } from '@client/components/ui/Button'
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

export function AppLayout() {
  return (
    <SpotifyAudioProvider>
      <AppLayoutContent />
    </SpotifyAudioProvider>
  )
}

function AppLayoutContent() {
  const { user, logout } = useAuth()
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const isCompact = false // Could come from settings

  return (
    <div className="min-h-screen bg-pixtune-bg flex">
      {/* Mobile overlay */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed lg:relative z-50 flex flex-col bg-pixtune-surface border-r border-pixtune-border transition-all duration-normal',
          sidebarOpen ? 'w-64' : 'w-20',
          !sidebarOpen && 'lg:w-20',
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        )}
        aria-label="Navegação principal"
      >
        {/* Logo */}
        <div className="flex items-center justify-between h-16 px-4 border-b border-pixtune-border">
          <Link to="/dashboard" className="flex items-center gap-2" aria-label="PixTune Dashboard">
            <svg className="w-8 h-8 text-pixtune-primary flex-shrink-0" viewBox="0 0 32 32" fill="none" aria-hidden="true">
              <rect width="32" height="32" rx="8" fill="#03070B" />
              <path d="M8 16C8 11.5817 11.5817 8 16 8C20.4183 8 24 11.5817 24 16C24 20.4183 20.4183 24 16 24C11.5817 24 8 20.4183 8 16Z" stroke="#1ED760" strokeWidth="2" />
              <path d="M16 8V16L21 19" stroke="#1ED760" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="24" cy="8" r="2" fill="#00E0FF" />
            </svg>
            {sidebarOpen && !isCompact && (
              <span className="font-display font-bold text-heading-sm tracking-tight truncate">PixTune</span>
            )}
          </Link>
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className={cn(
              'p-1.5 rounded-lg text-pixtune-textSecondary hover:text-pixtune-text hover:bg-pixtune-surfaceElevated transition-colors lg:hidden',
              sidebarOpen && 'rotate-180'
            )}
            aria-label={sidebarOpen ? 'Recolher menu' : 'Expandir menu'}
            aria-expanded={sidebarOpen}
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto" role="navigation" aria-label="Menu principal">
          {navigation.map((item) => (
            <NavLink
              key={item.name}
              to={item.href}
              className={({ isActive }) => cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-body-sm font-medium transition-all duration-fast',
                isActive
                  ? 'bg-pixtune-primaryMuted text-pixtune-primary'
                  : 'text-pixtune-textSecondary hover:text-pixtune-text hover:bg-pixtune-surfaceElevated',
                !sidebarOpen && !isCompact && 'justify-center px-2'
              )}
              title={sidebarOpen || isCompact ? undefined : item.name}
              onClick={() => setMobileMenuOpen(false)}
            >
              <item.icon className="w-5 h-5 flex-shrink-0" aria-hidden="true" />
              {!sidebarOpen && !isCompact ? null : <span className="truncate">{item.name}</span>}
            </NavLink>
          ))}
        </nav>

        {/* User section */}
        <div className="p-3 border-t border-pixtune-border">
          <div className={cn('flex items-center gap-3 px-2 py-2 rounded-lg', !sidebarOpen && !isCompact && 'justify-center')}>
            <div className="w-8 h-8 rounded-full bg-pixtune-primaryMuted flex items-center justify-center flex-shrink-0">
              {user?.avatarUrl ? (
                <img src={user.avatarUrl} alt="" className="w-8 h-8 rounded-full" />
              ) : (
                <User className="w-5 h-5 text-pixtune-primary" aria-hidden="true" />
              )}
            </div>
            {!sidebarOpen && !isCompact ? null : (
              <div className="flex-1 min-w-0">
                <p className="font-medium text-body-sm truncate">{user?.name}</p>
                <p className="text-caption text-pixtune-textMuted truncate">{user?.email}</p>
              </div>
            )}
            {!sidebarOpen && !isCompact ? null : (
              <button
                onClick={logout}
                className="p-1.5 rounded-lg text-pixtune-textMuted hover:text-pixtune-danger hover:bg-pixtune-surfaceElevated transition-colors"
                aria-label="Sair"
              >
                <LogOut className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-pixtune-border bg-pixtune-surface/80 px-6 backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden rounded-lg p-2 text-pixtune-textSecondary transition-colors hover:bg-pixtune-surfaceElevated hover:text-pixtune-text"
              aria-label="Abrir menu"
              aria-expanded={mobileMenuOpen}
            >
              <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <Link to="/dashboard" className="font-display font-bold tracking-tight text-pixtune-text lg:hidden">
              PixTune
            </Link>
          </div>

          <div className="flex flex-1 items-center justify-end gap-3">
            <ConnectionIndicators />

            {/* No desktop, o usuário e a saída ficam na barra lateral. */}
            <div className="hidden items-center gap-3 rounded-lg border border-pixtune-border bg-pixtune-surfaceElevated px-3 py-1.5 sm:flex lg:hidden">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-pixtune-primaryMuted">
                <User className="h-4 w-4 text-pixtune-primary" />
              </div>
              <span className="max-w-[120px] truncate text-body-sm font-medium">{user?.name}</span>
              <Button variant="ghost" size="sm" onClick={logout} aria-label="Sair da conta">
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 p-6 lg:p-8 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

type ConnectionState = 'connected' | 'connecting' | 'error' | 'disconnected'

/**
 * O estado nunca depende só da cor: cada indicador mostra um ícone e um texto
 * com o nome do serviço, inclusive no celular.
 */
const CONNECTION_STATES: Record<
  ConnectionState,
  { label: string; icon: LucideIcon; color: string; spin?: boolean }
> = {
  connected: { label: 'Conectado', icon: CheckCircle2, color: 'text-pixtune-success' },
  connecting: { label: 'Conectando', icon: Loader2, color: 'text-pixtune-warning', spin: true },
  error: { label: 'Erro', icon: AlertCircle, color: 'text-pixtune-danger' },
  disconnected: { label: 'Desconectado', icon: CircleOff, color: 'text-pixtune-textMuted' },
}

function ConnectionIndicators() {
  const { livepixStatus } = useConnectionStatus()
  const { isReady, error } = useAudioPlayer()
  const needsSpotifyConnection = Boolean(
    error && /conecte sua conta|não configurado no servidor/i.test(error)
  )
  const musicStatus: ConnectionState = error
    ? needsSpotifyConnection
      ? 'disconnected'
      : 'error'
    : isReady
      ? 'connected'
      : 'connecting'

  return (
    <div
      className="flex flex-col items-end gap-0.5 sm:flex-row sm:items-center sm:gap-4"
      role="status"
      aria-live="polite"
    >
      <ConnectionIndicator service="Live Pix" status={livepixStatus} />
      <ConnectionIndicator
        service="Player"
        status={musicStatus}
        detail={error ?? undefined}
      />
    </div>
  )
}

function ConnectionIndicator({
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
      className="flex items-center gap-1.5 whitespace-nowrap"
      title={`${service}: ${state.label}${detail ? ` — ${detail}` : ''}`}
    >
      <Icon
        className={cn('h-4 w-4 flex-shrink-0', state.color, state.spin && 'animate-spin')}
        aria-hidden="true"
      />
      <span className="text-caption font-medium text-pixtune-textMuted">
        {service} <span className={state.color}>{state.label}</span>
      </span>
    </span>
  )
}

function useConnectionStatus() {
  const [livepixStatus, setLivepixStatus] = useState<'connected' | 'disconnected'>('disconnected')

  useEffect(() => {
    let cancelled = false

    function load() {
      apiDonations
        .config()
        .then((lp) => {
          if (cancelled) return
          // Só mostra "Conectado" quando as credenciais já foram validadas
          // pelo LivePix (conta em cache), não apenas quando estão salvas.
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

  return { livepixStatus }
}