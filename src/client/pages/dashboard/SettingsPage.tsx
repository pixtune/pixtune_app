import { useState, useEffect } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Zap, Music, ListMusic, Shield, Palette, User, LogOut, AlertCircle, Contrast, Accessibility, RefreshCw, Unplug, CheckCircle2, LayoutDashboard } from 'lucide-react'
import { Button } from '@client/components/ui/Button'
import { Card } from '@client/components/ui/Card'
import { Input } from '@client/components/ui/Input'
import { apiSettings, apiDonations, apiSpotify, type SpotifyStatus, type SpotifyPlaylist } from '@client/api/client'
import { useAuth } from '@client/contexts/AuthContext'
import { useAccessibility } from '@client/contexts/AccessibilityContext'
import { SpotifySettings } from './SpotifySettings'

const SETTINGS_SECTIONS = ['general', 'livepix', 'spotify', 'music', 'appearance', 'security'] as const
type SettingsSection = (typeof SETTINGS_SECTIONS)[number]

/** Avisa o restante da interface (badge do topo) que o status do LivePix mudou. */
function notifyLivePixChanged() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('pixtune:livepix-changed'))
  }
}

/** Copia texto com fallback para navegadores/contextos sem Clipboard API. */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // segue para o fallback
  }

  try {
    const field = document.createElement('textarea')
    field.value = text
    field.setAttribute('readonly', '')
    field.style.position = 'fixed'
    field.style.opacity = '0'
    document.body.appendChild(field)
    field.select()
    const copied = document.execCommand('copy')
    document.body.removeChild(field)
    return copied
  } catch {
    return false
  }
}

export function SettingsPage() {
  const [searchParams] = useSearchParams()
  const [section, setSection] = useState<SettingsSection>(() => {
    const requested = searchParams.get('section')
    return SETTINGS_SECTIONS.includes(requested as SettingsSection)
      ? (requested as SettingsSection)
      : 'general'
  })
  const [settings, setSettings] = useState<any>(null)
  const [livepixConfig, setLivepixConfig] = useState<any>(null)
  const [spotifyStatus, setSpotifyStatus] = useState<SpotifyStatus | null>(null)
  const [spotifyBusy, setSpotifyBusy] = useState(false)
  const [spotifyFeedback, setSpotifyFeedback] = useState('')
  const [playlists, setPlaylists] = useState<SpotifyPlaylist[]>([])
  const [playlistsLoading, setPlaylistsLoading] = useState(false)
  const [importingPlaylistId, setImportingPlaylistId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [livepixForm, setLivepixForm] = useState({
    clientId: '',
    clientSecret: '',
    webhookUrl: '',
  })

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    try {
      await Promise.all([loadSettings(), loadLivePixConfig(), loadSpotify()])
    } catch (err) {
      console.error('Erro ao carregar configurações:', err)
    } finally {
      setLoading(false)
    }
  }

  async function loadSettings() {
    const res = await apiSettings.get()
    if (res.success && res.data) {
      setSettings(res.data)
    }
  }

  async function loadLivePixConfig() {
    const res = await apiDonations.config()
    if (res.success && res.data) {
      setLivepixConfig(res.data)
      // Pré-preenche o Client ID salvo (o secret nunca volta do servidor).
      setLivepixForm((previous) => ({
        ...previous,
        clientId: previous.clientId || res.data?.clientId || '',
      }))
    }
  }

  async function loadSpotify() {
    try {
      const res = await apiSpotify.status()
      if (res.success && res.data) {
        setSpotifyStatus(res.data)
        if (res.data.connected) {
          void loadPlaylists()
        }
      }
    } catch (err) {
      console.error('Erro ao carregar integração Spotify:', err)
    }
  }

  async function loadPlaylists() {
    setPlaylistsLoading(true)
    try {
      const res = await apiSpotify.playlists()
      if (res.success && res.data) {
        setPlaylists(res.data.playlists)
      }
    } catch (err) {
      console.error('Erro ao carregar playlists do Spotify:', err)
    } finally {
      setPlaylistsLoading(false)
    }
  }

  async function handleImportPlaylist(playlistId: string) {
    setImportingPlaylistId(playlistId)
    setSpotifyFeedback('')
    try {
      const res = await apiSpotify.importPlaylist(playlistId)
      if (!res.success || !res.data) {
        setSpotifyFeedback(res.error?.message || 'Não foi possível importar a playlist.')
        return
      }
      const { imported, skipped } = res.data
      setSpotifyFeedback(
        imported > 0
          ? `${imported} faixa(s) adicionada(s) à fila.${skipped ? ` ${skipped} já estavam na fila.` : ''}`
          : `Nenhuma faixa nova foi adicionada.${skipped ? ` ${skipped} já estavam na fila.` : ''}`
      )
    } catch (err) {
      setSpotifyFeedback(err instanceof Error ? err.message : 'Não foi possível importar a playlist.')
    } finally {
      setImportingPlaylistId(null)
    }
  }

  async function updateSettings(patch: Record<string, unknown>) {
    setSettings((previous: any) => ({ ...previous, ...patch }))
    try {
      const res = await apiSettings.update(patch as any)
      if (res.success && res.data) {
        setSettings((previous: any) => ({ ...previous, ...res.data }))
      }
    } catch (err) {
      console.error('Erro ao salvar configuração:', err)
    }
  }

  const spotifyParam = searchParams.get('spotify')
  const spotifyNotice =
    (spotifyParam &&
      {
        connected: { kind: 'success' as const, text: 'Conta do Spotify conectada com sucesso.' },
        denied: { kind: 'error' as const, text: 'Autorização do Spotify cancelada.' },
        invalid: { kind: 'error' as const, text: 'Resposta inválida do Spotify. Tente conectar novamente.' },
        state: { kind: 'error' as const, text: 'A sessão de conexão expirou ou o cookie de segurança não foi enviado. Tente novamente.' },
        failed: { kind: 'error' as const, text: 'Não foi possível conectar a conta do Spotify. A API registrou a etapa exata da falha.' },
        not_configured: { kind: 'error' as const, text: 'OAuth do Spotify não configurado no servidor.' },
        not_allowed: { kind: 'error' as const, text: 'Sua conta Spotify não está autorizada no app (Development Mode). Peça para adicionar seu e-mail em Users Management.' },
        scope: { kind: 'error' as const, text: 'O Spotify não concedeu todas as permissões necessárias. Tente novamente e aceite todas.' },
        forbidden: { kind: 'error' as const, text: 'O Spotify recusou a conexão (403). Verifique o Development Mode e a lista de usuários autorizados.' },
        rate_limited: { kind: 'error' as const, text: 'O Spotify limitou temporariamente as requisições. Tente novamente em alguns minutos.' },
        database: { kind: 'error' as const, text: 'O banco de dados da API não está migrado. O administrador precisa aplicar as migrations.' },
      }[spotifyParam]) ||
    null

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-pixtune-bg">
        <div className="animate-pulse-green w-12 h-12 border-4 border-pixtune-border border-t-pixtune-primary rounded-full" />
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-heading-lg font-bold text-pixtune-text md:text-page-title">Configurações</h1>
          <p className="text-body-sm text-pixtune-textSecondary">
            Gerencie suas preferências de conta e integrações.
          </p>
        </div>
        <Link to="/dashboard" className="w-fit flex-shrink-0">
          <Button variant="ghost" className="whitespace-nowrap">
            <LayoutDashboard className="w-4 h-4 mr-2" /> Voltar ao dashboard
          </Button>
        </Link>
      </div>

      {spotifyNotice && (
        <div
          role="status"
          className={
            spotifyNotice.kind === 'success'
              ? 'flex items-center gap-2 rounded-xl border border-pixtune-success/30 bg-pixtune-success/10 p-3 text-body-sm text-pixtune-success'
              : 'flex items-center gap-2 rounded-xl border border-pixtune-danger/30 bg-pixtune-danger/10 p-3 text-body-sm text-pixtune-danger'
          }
        >
          {spotifyNotice.kind === 'success' ? (
            <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
          ) : (
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
          )}
          {spotifyNotice.text}
        </div>
      )}

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
        <div className="grid grid-cols-2 gap-2 lg:col-span-3 lg:block lg:space-y-2">
          <SettingsNavItem icon={User} label="Conta" active={section === 'general'} onClick={() => setSection('general')} />
          <SettingsNavItem icon={Zap} label="Live Pix" active={section === 'livepix'} onClick={() => setSection('livepix')} />
          <SettingsNavItem icon={Music} label="Spotify" active={section === 'spotify'} onClick={() => setSection('spotify')} />
          <SettingsNavItem icon={ListMusic} label="Música" active={section === 'music'} onClick={() => setSection('music')} />
          <SettingsNavItem icon={Palette} label="Aparência" active={section === 'appearance'} onClick={() => setSection('appearance')} />
          <SettingsNavItem icon={Shield} label="Segurança" active={section === 'security'} onClick={() => setSection('security')} />
        </div>

        <div className="min-w-0 lg:col-span-9">
          {section === 'general' && <GeneralSettings settings={settings} />}
          {section === 'livepix' && (
            <LivePixSettings
              config={livepixConfig}
              form={livepixForm}
              setForm={setLivepixForm}
              onReload={loadLivePixConfig}
            />
          )}
          {section === 'spotify' && (
            <SpotifySettings
              status={spotifyStatus}
              busy={spotifyBusy}
              setBusy={setSpotifyBusy}
              feedback={spotifyFeedback}
              setFeedback={setSpotifyFeedback}
              playlists={playlists}
              playlistsLoading={playlistsLoading}
              importingPlaylistId={importingPlaylistId}
              onReload={loadSpotify}
              onReloadPlaylists={loadPlaylists}
              onImportPlaylist={handleImportPlaylist}
            />
          )}
          {section === 'music' && <MusicSettings settings={settings} onUpdate={updateSettings} />}
          {section === 'appearance' && <AppearanceSettings settings={settings} onUpdate={updateSettings} />}
          {section === 'security' && <SecuritySettings />}
        </div>
      </div>
    </div>
  )
}

function SettingsNavItem({ icon: Icon, label, active, onClick }: { icon: React.ElementType; label: string; active: boolean; onClick: () => void }) {
  return (
    <Button variant={active ? 'primary' : 'ghost'} onClick={onClick} className="w-full justify-start gap-3" size="sm">
      <Icon className="w-4 h-4" />
      <span className="font-medium">{label}</span>
    </Button>
  )
}

function GeneralSettings({ settings }: { settings: any }) {
  const { user } = useAuth()
  return (
    <Card className="p-6">
      <div className="flex items-center gap-2 mb-6">
        <User className="w-5 h-5 text-pixtune-primary" />
        <h2 className="text-body font-semibold text-pixtune-text">Informações da conta</h2>
      </div>
      <div className="space-y-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-pixtune-primary/10 text-pixtune-primary flex items-center justify-center">
            <User className="w-6 h-6" />
          </div>
          <div>
            <p className="text-body-sm font-medium text-pixtune-text">{user?.name || 'Streamer'}</p>
            <p className="text-caption text-pixtune-textMuted">{settings ? 'Conectado' : 'Carregando...'}</p>
          </div>
        </div>
        <div className="p-4 rounded-lg bg-pixtune-surfaceElevated/50 border border-pixtune-border">
          <p className="text-caption text-pixtune-textMuted mb-2">E-mail</p>
          <p className="text-body-sm font-mono text-pixtune-text">{user?.email || '—'}</p>
        </div>
        <div className="p-4 rounded-lg bg-pixtune-surfaceElevated/50 border border-pixtune-border">
          <p className="text-caption text-pixtune-textMuted mb-2">ID do usuário</p>
          <p className="text-body-sm font-mono text-pixtune-text break-all">{user?.id || '—'}</p>
        </div>
      </div>
    </Card>
  )
}

function LivePixSettings({
  config,
  form,
  setForm,
  onReload,
}: {
  config: any
  form: any
  setForm: any
  onReload: () => Promise<void>
}) {
  const [busy, setBusy] = useState<'save' | 'verify' | 'disconnect' | null>(null)
  const [checking, setChecking] = useState(false)
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [verifyError, setVerifyError] = useState<string | null>(null)

  const configured = Boolean(config?.configured)
  const connected = Boolean(config?.connected)
  const hasSecret = Boolean(config?.hasSecret)
  const account = config?.account as { username?: string; displayName?: string } | null

  // Ao abrir a seção, confirma na API do LivePix se as credenciais salvas
  // continuam válidas. Usa o token em cache (só emite novo se expirado), então
  // não consome o limite de emissão de tokens do LivePix.
  useEffect(() => {
    if (!configured) return
    let cancelled = false
    setChecking(true)
    apiDonations
      .verifyConfig()
      .then(async () => {
        if (cancelled) return
        setVerifyError(null)
        await onReload()
      })
      .catch((err: any) => {
        if (!cancelled) {
          setVerifyError(err?.message || 'Falha ao verificar a conexão com o LivePix.')
        }
      })
      .finally(() => {
        if (!cancelled) setChecking(false)
      })
    return () => {
      cancelled = true
    }
    // Executa uma vez ao abrir a seção.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const status = checking
    ? {
        dot: 'bg-yellow-500',
        text: 'text-yellow-400',
        label: 'Verificando conexão...',
        detail: 'Consultando a API do LivePix.',
      }
    : verifyError
      ? {
          dot: 'bg-pixtune-danger',
          text: 'text-pixtune-danger',
          label: 'Falha na conexão',
          detail: verifyError,
        }
      : !configured
        ? {
            dot: 'bg-pixtune-textMuted',
            text: 'text-pixtune-textSecondary',
            label: 'Desconectado',
            detail: 'Informe o Client ID e o Client Secret da sua aplicação LivePix.',
          }
        : connected
          ? {
              dot: 'bg-pixtune-success',
              text: 'text-pixtune-success',
              label: 'Conectado',
              detail: account?.username
                ? `Conta LivePix: @${account.username}`
                : 'Credenciais validadas na API do LivePix.',
            }
          : {
              dot: 'bg-yellow-500',
              text: 'text-yellow-400',
              label: 'Configurado, não verificado',
              detail: 'Clique em “Testar conexão” para confirmar as credenciais.',
            }

  // Formulário de credenciais e URL de webhook só aparecem quando não há uma
  // conexão válida. Conectado, a tela mostra apenas status, ações e um atalho
  // para copiar a URL do webhook.
  const showCredentialsForm = !configured || Boolean(verifyError) || (!connected && !checking)

  const webhookUrl =
    typeof window !== 'undefined' && config?.webhookPath
      ? `${window.location.origin}${config.webhookPath}`
      : ''

  async function handleSave() {
    if (!form.clientId.trim()) {
      setFeedback({ kind: 'error', text: 'Informe o Client ID da aplicação LivePix.' })
      return
    }
    if (!form.clientSecret.trim() && !hasSecret) {
      setFeedback({ kind: 'error', text: 'Informe o Client Secret da aplicação LivePix.' })
      return
    }

    setBusy('save')
    setFeedback(null)
    setVerifyError(null)
    try {
      const res = await apiDonations.saveConfig({
        clientId: form.clientId.trim(),
        // Em branco = mantém o secret já salvo no servidor.
        clientSecret: form.clientSecret.trim() || undefined,
      })
      const username = res.data?.account?.username
      setForm((previous: any) => ({ ...previous, clientSecret: '' }))
      await onReload()
      notifyLivePixChanged()
      setFeedback({
        kind: 'success',
        text: username
          ? `Configuração salva e validada. Conectado à conta @${username}.`
          : 'Configuração salva e validada na API do LivePix.',
      })
    } catch (err: any) {
      setFeedback({
        kind: 'error',
        text:
          err?.message ||
          'Não foi possível salvar: o LivePix recusou as credenciais informadas.',
      })
    } finally {
      setBusy(null)
    }
  }

  async function handleVerify() {
    setBusy('verify')
    setFeedback(null)
    setVerifyError(null)
    try {
      const res = await apiDonations.verifyConfig()
      await onReload()
      setFeedback({
        kind: 'success',
        text: res.data?.account?.username
          ? `Conexão confirmada com a conta @${res.data.account.username}.`
          : 'Conexão confirmada com a API do LivePix.',
      })
    } catch (err: any) {
      const message = err?.message || 'Falha ao verificar a conexão com o LivePix.'
      setVerifyError(message)
      setFeedback({ kind: 'error', text: message })
    } finally {
      setBusy(null)
    }
  }

  async function handleDisconnect() {
    const confirmed = window.confirm(
      'Desconectar o Live Pix? As credenciais e os tokens salvos serão apagados e o webhook desta conta deixará de aceitar doações até você conectar novamente.'
    )
    if (!confirmed) return

    setBusy('disconnect')
    setFeedback(null)
    setVerifyError(null)
    try {
      const res = await apiDonations.disconnectConfig()
      setForm({ clientId: '', clientSecret: '', webhookUrl: '' })
      await onReload()
      notifyLivePixChanged()
      const removed = res.data?.remoteWebhooksRemoved ?? 0
      const warning = res.data?.warning
      setFeedback(
        warning
          ? {
              kind: 'error',
              text: `Desconectado nesta instalação, mas o webhook no LivePix não pôde ser removido automaticamente (${warning}). Remova-o manualmente no painel do LivePix.`,
            }
          : {
              kind: 'success',
              text:
                removed > 0
                  ? `Desconectado. ${removed} webhook(s) removido(s) no LivePix.`
                  : 'Desconectado. Credenciais e tokens apagados.',
            }
      )
    } catch (err: any) {
      setFeedback({ kind: 'error', text: err?.message || 'Não foi possível desconectar.' })
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card className="p-6">
      <div className="flex items-center gap-2 mb-6">
        <Zap className="w-5 h-5 text-pixtune-primary" />
        <h2 className="text-body font-semibold text-pixtune-text">Integração LivePix</h2>
      </div>
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4 p-4 rounded-lg bg-pixtune-surfaceElevated border border-pixtune-border">
          <div className="min-w-0">
            <h3 className="text-body-sm font-medium text-pixtune-text">Status da conexão</h3>
            <p className="text-caption text-pixtune-textMuted">{status.detail}</p>
            {config?.lastVerifiedAt && !verifyError && (
              <p className="mt-1 text-caption text-pixtune-textMuted">
                Última verificação: {new Date(config.lastVerifiedAt).toLocaleString('pt-BR')}
              </p>
            )}
          </div>
          <div className="flex flex-shrink-0 items-center gap-3">
            <span
              className={`h-2 w-2 rounded-full ${status.dot} ${checking ? 'animate-pulse' : ''}`}
              aria-hidden="true"
            />
            <span className={`text-body-sm font-medium ${status.text}`}>{status.label}</span>
          </div>
        </div>

        {feedback && (
          <div
            role={feedback.kind === 'error' ? 'alert' : 'status'}
            className={
              feedback.kind === 'success'
                ? 'flex items-start gap-2 rounded-xl border border-pixtune-success/30 bg-pixtune-success/10 p-3 text-body-sm text-pixtune-success'
                : 'flex items-start gap-2 rounded-xl border border-pixtune-danger/30 bg-pixtune-danger/10 p-3 text-body-sm text-pixtune-danger'
            }
          >
            {feedback.kind === 'success' ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0" />
            ) : (
              <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            )}
            <span>{feedback.text}</span>
          </div>
        )}

        {showCredentialsForm && (
          <div className="space-y-4">
            <div>
              <label className="text-body-sm font-medium text-pixtune-textSecondary" htmlFor="clientId">
                Client ID
              </label>
              <Input
                id="clientId"
                value={form.clientId}
                onChange={(e) => setForm({ ...form, clientId: e.target.value })}
                placeholder="Client ID da aplicação LivePix"
                autoComplete="off"
              />
            </div>
            <div>
              <label className="text-body-sm font-medium text-pixtune-textSecondary" htmlFor="clientSecret">
                Client Secret
              </label>
              <Input
                id="clientSecret"
                type="password"
                value={form.clientSecret}
                onChange={(e) => setForm({ ...form, clientSecret: e.target.value })}
                placeholder={
                  hasSecret ? '•••••••••••••••• (salvo — deixe em branco para manter)' : 'Client Secret da aplicação LivePix'
                }
                autoComplete="new-password"
                helperText="Crie a aplicação em livepix.gg → Configurações → Desenvolvedores. Escopos: account:read, messages:read, payments:read e webhooks."
              />
            </div>
            <p className="text-caption text-pixtune-textMuted">
              A autenticação usa OAuth2 oficial do LivePix. O Client Secret fica salvo apenas no banco
              local desta instalação e nunca é exibido de volta pelo servidor.
            </p>
          </div>
        )}

        {showCredentialsForm && (
          <div className="space-y-2">
            <label className="text-body-sm font-medium text-pixtune-textSecondary">
              URL de webhook desta conta
            </label>
            <div className="flex gap-2">
              <Input id="streamerWebhook" readOnly value={webhookUrl || 'Carregando...'} />
              <Button
                type="button"
                variant="secondary"
                disabled={!webhookUrl}
                onClick={async () => {
                  const copied = await copyToClipboard(webhookUrl)
                  setFeedback(
                    copied
                      ? { kind: 'success', text: 'URL do webhook copiada.' }
                      : { kind: 'error', text: 'Selecione a URL ao lado e copie manualmente.' }
                  )
                }}
              >
                Copiar
              </Button>
            </div>
            <p className="text-caption text-pixtune-textMuted">
              Cadastre esta URL no painel do Live Pix. Ela contém um token exclusivo da sua conta.
              Para receber doações reais, o PixTune precisa estar acessível publicamente.
            </p>
          </div>
        )}

        <div className="p-4 rounded-lg bg-pixtune-surfaceElevated/50 border border-pixtune-border">
          <h4 className="text-caption font-medium text-pixtune-textSecondary mb-2">Sobre o LivePix</h4>
          <p className="text-body-sm text-pixtune-textSecondary">
            O PixTune usa a API oficial do LivePix. Nenhuma senha bancária ou credencial financeira
            do doador é armazenada.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {showCredentialsForm && (
            <Button variant="primary" onClick={handleSave} disabled={busy !== null} isLoading={busy === 'save'}>
              Salvar configuração
            </Button>
          )}
          <Button
            variant="secondary"
            onClick={handleVerify}
            disabled={busy !== null || !configured}
            isLoading={busy === 'verify'}
          >
            <RefreshCw className="h-4 w-4" /> Testar conexão
          </Button>
          <Button
            variant="ghost"
            onClick={handleDisconnect}
            disabled={busy !== null || !configured}
            isLoading={busy === 'disconnect'}
            className="text-pixtune-danger hover:bg-pixtune-danger/10 hover:text-pixtune-danger"
          >
            <Unplug className="h-4 w-4" /> Desconectar
          </Button>
        </div>

        {!showCredentialsForm && (
          <p className="text-caption text-pixtune-textMuted">
            Para trocar as credenciais, clique em <strong>Desconectar</strong>.
          </p>
        )}
      </div>
    </Card>
  )
}

function MusicSettings({
  settings,
  onUpdate,
}: {
  settings: any
  onUpdate: (patch: Record<string, unknown>) => void | Promise<void>
}) {
  return (
    <Card className="p-6">
      <div className="flex items-center gap-2 mb-6">
        <Music className="w-5 h-5 text-pixtune-primary" />
        <h2 className="text-body font-semibold text-pixtune-text">Configurações de música</h2>
      </div>
      <div className="space-y-6">
        <div className="p-4 rounded-lg bg-pixtune-surfaceElevated/50 border border-pixtune-border">
          <div className="flex items-center gap-2 mb-2">
            <Music className="w-5 h-5 text-pixtune-primary" />
            <h3 className="text-body-sm font-medium text-pixtune-text">Player: Spotify</h3>
          </div>
          <p className="text-body-sm text-pixtune-textSecondary">
            As músicas são reproduzidas pelo Web Playback SDK oficial do Spotify, no navegador.
            Nenhum arquivo é baixado e nenhuma proteção do Spotify é contornada. A conta do
            streamer precisa ter Spotify Premium e a aba do PixTune precisa permanecer aberta.
          </p>
        </div>

        <div className="p-4 rounded-lg border border-pixtune-primary/30 bg-pixtune-primary/5 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-body-sm font-medium text-pixtune-text">
                Pedidos de música pela mensagem
              </h3>
              <p className="text-caption text-pixtune-textSecondary mt-1">
                O doador escreve o nome da música na mensagem do Live Pix. O PixTune detecta o
                pedido e o coloca na fila. Mensagens comuns são ignoradas.
              </p>
            </div>
            <label className="flex items-center gap-2 cursor-pointer flex-shrink-0">
              <input
                type="checkbox"
                checked={settings?.songRequestEnabled ?? true}
                onChange={(e) => void onUpdate({ songRequestEnabled: e.target.checked })}
                className="w-4 h-4 rounded accent-pixtune-primary focus:ring-pixtune-primary"
                aria-label="Ativar pedidos de música pela mensagem"
              />
            </label>
          </div>

          <div className="rounded-lg border border-pixtune-border bg-pixtune-bg/40 p-4">
            <h4 className="text-body-sm font-medium text-pixtune-text">Prioridade por valor</h4>
            <p className="mt-1 text-caption text-pixtune-textSecondary">
              A maior doação sempre toca primeiro. Se uma doação maior chegar durante outra
              música, a menor é interrompida na hora e a maior começa imediatamente. Em valores
              iguais, vale a ordem de chegada.
            </p>
            <p className="mt-2 text-caption text-pixtune-textMuted">
              O streamer define apenas o valor mínimo inicial na página{' '}
              <Link to="/rules" className="text-pixtune-primary hover:underline">
                Regras
              </Link>
              . O valor de cada doação é fixo e imutável; não é possível reordenar ou aumentar a
              prioridade manualmente.
            </p>
          </div>

          <p className="text-caption text-pixtune-textMuted">
            A detecção usa a busca oficial do Spotify. A prioridade por valor é a única regra de
            reprodução: não há palavras-chave, links fixos, ações de comando ou ordenação manual.
            O valor mínimo inicial é definido na página{' '}
            <Link to="/rules" className="text-pixtune-primary hover:underline">
              Regras
            </Link>
            .
          </p>

          {settings && !settings.spotifyConfigured && (
            <div className="flex items-start gap-2 p-3 rounded-lg border border-pixtune-warning/40 bg-pixtune-warning/10 text-caption text-pixtune-warning">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>
                Spotify não configurado no servidor. Defina{' '}
                <span className="font-mono">SPOTIFY_CLIENT_ID</span> e{' '}
                <span className="font-mono">SPOTIFY_CLIENT_SECRET</span> no arquivo{' '}
                <span className="font-mono">.env</span> e reinicie a API para conectar a conta.
              </span>
            </div>
          )}
        </div>

        <div className="space-y-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={settings?.autoPlay ?? true}
              onChange={(e) => void onUpdate({ autoPlay: e.target.checked })}
              className="w-4 h-4 rounded accent-pixtune-primary focus:ring-pixtune-primary"
            />
            <span className="text-body-sm text-pixtune-text">Reprodução automática</span>
          </label>
          <p className="text-caption text-pixtune-textMuted">
            Inicia a próxima música automaticamente quando a atual terminar e quando uma doação
            chegar com o player parado. O navegador pode exigir um primeiro clique em Play.
          </p>
        </div>
        <div className="space-y-2">
          <label className="block text-body-sm font-medium text-pixtune-textSecondary">Volume padrão</label>
          <input
            type="range"
            min="0"
            max="100"
            value={settings?.defaultVolume ?? 70}
            onChange={(e) => void onUpdate({ defaultVolume: parseInt(e.target.value) })}
            className="w-full h-2 bg-pixtune-border rounded-lg appearance-none cursor-pointer accent-pixtune-primary"
          />
          <div className="flex justify-between text-caption text-pixtune-textMuted">
            <span>0%</span>
            <span>{settings?.defaultVolume ?? 70}%</span>
            <span>100%</span>
          </div>
        </div>
      </div>
    </Card>
  )
}

function AppearanceSettings({
  settings: _settings,
  onUpdate: _onUpdate,
}: {
  settings: any
  onUpdate: (patch: Record<string, unknown>) => void | Promise<void>
}) {
  const { highContrast, reducedMotion, setHighContrast, setReducedMotion } = useAccessibility()

  return (
    <Card className="p-6">
      <div className="flex items-center gap-2 mb-6">
        <Palette className="w-5 h-5 text-pixtune-primary" />
        <h2 className="text-body font-semibold text-pixtune-text">Aparência e acessibilidade</h2>
      </div>
      <div className="space-y-5">
        <div className="rounded-xl border border-pixtune-border bg-pixtune-surfaceElevated/50 p-4">
          <div className="flex items-center gap-2">
            <span className="h-8 w-8 rounded-lg gradient-brand" aria-hidden="true" />
            <div>
              <p className="text-body-sm font-medium text-pixtune-text">PixTune Dark</p>
              <p className="text-caption text-pixtune-textMuted">
                Tema oficial do produto, com fundo Deep Navy e acentos verde/ciano.
              </p>
            </div>
          </div>
        </div>

        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-pixtune-border p-4 transition-colors hover:border-pixtune-primary/30">
          <input
            type="checkbox"
            checked={highContrast}
            onChange={(e) => setHighContrast(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded accent-pixtune-primary focus:ring-pixtune-primary"
          />
          <span>
            <span className="flex items-center gap-2 text-body-sm font-medium text-pixtune-text">
              <Contrast className="h-4 w-4 text-pixtune-cyan" aria-hidden="true" />
              Modo de alto contraste
            </span>
            <span className="mt-1 block text-caption text-pixtune-textSecondary">
              Aumenta o contraste do texto e das bordas. As cores neon permanecem apenas como
              acento, seguindo o modo acessível do brandbook.
            </span>
          </span>
        </label>

        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-pixtune-border p-4 transition-colors hover:border-pixtune-primary/30">
          <input
            type="checkbox"
            checked={reducedMotion}
            onChange={(e) => setReducedMotion(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded accent-pixtune-primary focus:ring-pixtune-primary"
          />
          <span>
            <span className="flex items-center gap-2 text-body-sm font-medium text-pixtune-text">
              <Accessibility className="h-4 w-4 text-pixtune-cyan" aria-hidden="true" />
              Reduzir animações
            </span>
            <span className="mt-1 block text-caption text-pixtune-textSecondary">
              Desativa transições e animações decorativas. A preferência do sistema operacional
              também é respeitada automaticamente.
            </span>
          </span>
        </label>

        <p className="text-caption text-pixtune-textMuted">
          Estas preferências são salvas neste navegador e não alteram os dados da sua conta.
        </p>
      </div>
    </Card>
  )
}

function SecuritySettings() {
  const { logout } = useAuth()
  return (
    <Card className="p-6">
      <div className="flex items-center gap-2 mb-6">
        <Shield className="w-5 h-5 text-pixtune-primary" />
        <h2 className="text-body font-semibold text-pixtune-text">Segurança</h2>
      </div>
      <div className="space-y-6">
        <div className="p-4 rounded-lg bg-pixtune-surfaceElevated/50 border border-pixtune-border">
          <h3 className="text-body-sm font-medium text-pixtune-text mb-2">Isolamento de dados</h3>
          <p className="text-body-sm text-pixtune-textSecondary">
            Suas configurações, músicas e fila são isoladas por usuário. Nenhum outro streamer pode acessar ou modificar seus dados.
          </p>
        </div>
        <div className="p-4 rounded-lg bg-pixtune-surfaceElevated/50 border border-pixtune-border">
          <h3 className="text-body-sm font-medium text-pixtune-text mb-2">Credenciais</h3>
          <p className="text-body-sm text-pixtune-textSecondary">
            O PixTune nunca solicita ou armazena senhas bancárias, credenciais financeiras pessoais ou dados desnecessários dos doadores.
          </p>
        </div>
        <Button variant="danger" className="w-full" onClick={() => { void logout() }}>
          <LogOut className="w-4 h-4 mr-2" /> Sair da conta
        </Button>
      </div>
    </Card>
  )
}
