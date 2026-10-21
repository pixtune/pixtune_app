import { useState, useEffect } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Zap, Music, Shield, Palette, User, LogOut, Youtube, AlertCircle, Contrast, Accessibility, RefreshCw, Unplug, CheckCircle2, ExternalLink } from 'lucide-react'
import { Button } from '@client/components/ui/Button'
import { Card } from '@client/components/ui/Card'
import { Input } from '@client/components/ui/Input'
import { apiSettings, apiDonations, apiYouTube, API_BASE_URL, type YouTubeStatus, type YouTubeChannelInfo } from '@client/api/client'
import { useAuth } from '@client/contexts/AuthContext'
import { useAccessibility } from '@client/contexts/AccessibilityContext'

const SETTINGS_SECTIONS = ['general', 'livepix', 'youtube', 'music', 'appearance', 'security'] as const
type SettingsSection = (typeof SETTINGS_SECTIONS)[number]

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
  const [youtubeStatus, setYoutubeStatus] = useState<YouTubeStatus | null>(null)
  const [youtubeBusy, setYoutubeBusy] = useState(false)
  const [youtubeFeedback, setYoutubeFeedback] = useState('')
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
      await Promise.all([loadSettings(), loadLivePixConfig(), loadYouTube()])
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
    }
  }

  async function loadYouTube() {
    try {
      const res = await apiYouTube.status()
      if (res.success && res.data) {
        setYoutubeStatus(res.data)
      }
    } catch (err) {
      console.error('Erro ao carregar integração YouTube:', err)
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

  const youtubeParam = searchParams.get('youtube')
  const youtubeNotice =
    (youtubeParam &&
      {
        connected: { kind: 'success' as const, text: 'Canal do YouTube conectado com sucesso.' },
        denied: { kind: 'error' as const, text: 'Autorização do Google cancelada.' },
        invalid: { kind: 'error' as const, text: 'Resposta inválida do Google. Tente conectar novamente.' },
        state: { kind: 'error' as const, text: 'A sessão de conexão expirou. Tente novamente.' },
        failed: { kind: 'error' as const, text: 'Não foi possível conectar o canal. Tente novamente.' },
        not_configured: { kind: 'error' as const, text: 'OAuth do Google não configurado no servidor.' },
      }[youtubeParam]) ||
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
          <h1 className="text-heading-lg font-bold text-pixtune-text">Configurações</h1>
          <p className="text-body-sm text-pixtune-textSecondary">
            Gerencie suas preferências de conta e integrações.
          </p>
        </div>
        <Link to="/dashboard">
          <Button variant="ghost">
            <User className="w-4 h-4 mr-2" /> Voltar ao dashboard
          </Button>
        </Link>
      </div>

      {youtubeNotice && (
        <div
          role="status"
          className={
            youtubeNotice.kind === 'success'
              ? 'flex items-center gap-2 rounded-xl border border-pixtune-success/30 bg-pixtune-success/10 p-3 text-body-sm text-pixtune-success'
              : 'flex items-center gap-2 rounded-xl border border-pixtune-danger/30 bg-pixtune-danger/10 p-3 text-body-sm text-pixtune-danger'
          }
        >
          {youtubeNotice.kind === 'success' ? (
            <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
          ) : (
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
          )}
          {youtubeNotice.text}
        </div>
      )}

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
        <div className="grid grid-cols-2 gap-2 lg:col-span-3 lg:block lg:space-y-2">
          <SettingsNavItem icon={User} label="Conta" active={section === 'general'} onClick={() => setSection('general')} />
          <SettingsNavItem icon={Zap} label="Live Pix" active={section === 'livepix'} onClick={() => setSection('livepix')} />
          <SettingsNavItem icon={Youtube} label="YouTube" active={section === 'youtube'} onClick={() => setSection('youtube')} />
          <SettingsNavItem icon={Music} label="Música" active={section === 'music'} onClick={() => setSection('music')} />
          <SettingsNavItem icon={Palette} label="Aparência" active={section === 'appearance'} onClick={() => setSection('appearance')} />
          <SettingsNavItem icon={Shield} label="Segurança" active={section === 'security'} onClick={() => setSection('security')} />
        </div>

        <div className="min-w-0 lg:col-span-9">
          {section === 'general' && <GeneralSettings settings={settings} />}
          {section === 'livepix' && <LivePixSettings config={livepixConfig} form={livepixForm} setForm={setLivepixForm} />}
          {section === 'youtube' && (
            <YouTubeSettings
              status={youtubeStatus}
              busy={youtubeBusy}
              setBusy={setYoutubeBusy}
              feedback={youtubeFeedback}
              setFeedback={setYoutubeFeedback}
              onReload={loadYouTube}
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

function LivePixSettings({ config, form, setForm }: { config: any; form: any; setForm: any }) {
  return (
    <Card className="p-6">
      <div className="flex items-center gap-2 mb-6">
        <Zap className="w-5 h-5 text-pixtune-primary" />
        <h2 className="text-body font-semibold text-pixtune-text">Integração LivePix</h2>
      </div>
      <div className="space-y-6">
        <div className="flex items-center justify-between p-4 rounded-lg bg-pixtune-surfaceElevated border border-pixtune-border">
          <div>
            <h3 className="text-body-sm font-medium text-pixtune-text">Status da conexão</h3>
            <p className="text-caption text-pixtune-textMuted">Receba notificações de doações via Live Pix</p>
          </div>
          <div className="flex items-center gap-3">
            <span className={`w-2 h-2 rounded-full ${config.configured ? 'bg-pixtune-success' : 'bg-pixtune-textMuted'}`} />
            <span className={`text-body-sm ${config.configured ? 'text-pixtune-success' : 'text-pixtune-textSecondary'}`}>
              {config.configured ? 'Conectado' : 'Desconectado'}
            </span>
          </div>
        </div>

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
              placeholder="Client Secret da aplicação LivePix"
              autoComplete="new-password"
              helperText="Crie a aplicação em livepix.gg → Configurações → Desenvolvedores. Escopos: account:read, messages:read, payments:read e webhooks."
            />
          </div>
          <p className="text-caption text-pixtune-textMuted">
            A autenticação usa OAuth2 oficial do LivePix. O Client Secret fica salvo apenas no banco
            local desta instalação.
          </p>
        </div>

        <div className="space-y-2">
          <label className="text-body-sm font-medium text-pixtune-textSecondary">
            URL de webhook desta conta
          </label>
          <div className="flex gap-2">
            <Input
              id="streamerWebhook"
              readOnly
              value={
                config.webhookPath
                  ? `${typeof window !== 'undefined' ? window.location.origin : ''}${config.webhookPath}`
                  : 'Carregando...'
              }
            />
            <Button
              type="button"
              variant="secondary"
              disabled={!config.webhookPath}
              onClick={() => {
                if (!config.webhookPath) return
                navigator.clipboard?.writeText(`${window.location.origin}${config.webhookPath}`)
              }}
            >
              Copiar
            </Button>
          </div>
          <p className="text-caption text-pixtune-textMuted">
            Cadastre esta URL no painel do Live Pix. Ela contém um token exclusivo da sua conta.
            Para receber doações reais, a aplicação precisa estar acessível publicamente
            (ex.: <span className="font-mono">ngrok http 3001</span> em desenvolvimento).
          </p>
        </div>

        <div className="p-4 rounded-lg bg-pixtune-surfaceElevated/50 border border-pixtune-border">
          <h4 className="text-caption font-medium text-pixtune-textSecondary mb-2">Sobre o LivePix</h4>
          <p className="text-body-sm text-pixtune-textSecondary">
            O PixTune usa a API oficial do LivePix (livepix.gg). O webhook do LivePix envia apenas
            o identificador do evento; os detalhes da mensagem são consultados na API com as
            credenciais acima. Nenhuma senha bancária ou credencial financeira do doador é
            armazenada.
          </p>
        </div>

        <Button
          variant="outline"
          onClick={async () => {
            const res = await apiDonations.saveConfig(form)
            if (res.success) {
              alert('Configuração salva com sucesso!')
            } else {
              alert('Erro ao salvar: ' + res.error?.message)
            }
          }}
        >
          Salvar configuração Live Pix
        </Button>
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
            <Youtube className="w-5 h-5 text-pixtune-primary" />
            <h3 className="text-body-sm font-medium text-pixtune-text">Player: YouTube (áudio)</h3>
          </div>
          <p className="text-body-sm text-pixtune-textSecondary">
            As músicas são reproduzidas pelo player oficial do YouTube. O vídeo não é exibido:
            somente o áudio é reproduzido. Nenhum arquivo é baixado e nenhuma proteção do YouTube
            é contornada.
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
            A detecção usa o catálogo público do iTunes Search e a busca oficial da YouTube Data
            API v3. A prioridade por valor é a única regra de reprodução: não há palavras-chave,
            links fixos, ações de comando ou ordenação manual. O valor mínimo inicial é definido
            na página{' '}
            <Link to="/rules" className="text-pixtune-primary hover:underline">
              Regras
            </Link>
            .
          </p>

          {settings && !settings.youtubeSearchConfigured && (
            <div className="flex items-start gap-2 p-3 rounded-lg border border-pixtune-warning/40 bg-pixtune-warning/10 text-caption text-pixtune-warning">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>
                Busca automática no YouTube desativada. Defina <span className="font-mono">YOUTUBE_API_KEY</span>{' '}
                no arquivo <span className="font-mono">.env</span> e reinicie a API para tocar a
                música detectada automaticamente. Sem a chave, o pedido entra na fila como
                “aguardando link” e você pode anexar o link pela página Fila.
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

function formatCount(value?: number): string | null {
  if (value === undefined) return null
  return value.toLocaleString('pt-BR')
}

function YouTubeSettings({
  status,
  busy,
  setBusy,
  feedback,
  setFeedback,
  onReload,
}: {
  status: YouTubeStatus | null
  busy: boolean
  setBusy: (value: boolean) => void
  feedback: string
  setFeedback: (value: string) => void
  onReload: () => Promise<void>
}) {
  const connectRedirect = `${API_BASE_URL}/api/youtube/callback`

  async function handleConnect() {
    setBusy(true)
    setFeedback('')
    try {
      const res = await apiYouTube.connectUrl()
      if (res.success && res.data?.url) {
        window.location.href = res.data.url
        return
      }
      setFeedback(res.error?.message || 'Não foi possível iniciar a conexão.')
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
      const res = await apiYouTube.refresh()
      if (res.success) {
        setFeedback('Dados do canal atualizados.')
        await onReload()
      } else {
        setFeedback(res.error?.message || 'Falha ao atualizar os dados do canal.')
      }
    } catch {
      setFeedback('Falha ao atualizar os dados do canal.')
    } finally {
      setBusy(false)
    }
  }

  async function handleDisconnect() {
    if (!window.confirm('Desconectar o canal do YouTube do PixTune?')) return
    setBusy(true)
    setFeedback('')
    try {
      const res = await apiYouTube.disconnect()
      if (res.success) {
        setFeedback('Canal desconectado.')
        await onReload()
      } else {
        setFeedback(res.error?.message || 'Falha ao desconectar.')
      }
    } catch {
      setFeedback('Falha ao desconectar o canal.')
    } finally {
      setBusy(false)
    }
  }

  const channel: YouTubeChannelInfo | null = status?.channel ?? null
  const configured = status?.configured ?? false
  const connected = status?.connected ?? false

  return (
    <Card className="p-6">
      <div className="flex items-center gap-2 mb-6">
        <Youtube className="w-5 h-5 text-pixtune-primary" />
        <h2 className="text-body font-semibold text-pixtune-text">Conta do YouTube</h2>
      </div>

      <div className="space-y-6">
        <div className="rounded-lg border border-pixtune-border bg-pixtune-surfaceElevated/50 p-4">
          <h3 className="text-body-sm font-medium text-pixtune-text">O que esta conexão faz</h3>
          <ul className="mt-2 space-y-1 text-body-sm text-pixtune-textSecondary">
            <li>Autoriza, via OAuth 2.0 oficial do Google, a leitura dos dados do seu canal.</li>
            <li>Mostra nome, avatar e inscritos do canal conectado.</li>
          </ul>
          <h3 className="mt-4 text-body-sm font-medium text-pixtune-text">
            O que esta conexão NÃO faz
          </h3>
          <ul className="mt-2 space-y-1 text-body-sm text-pixtune-textSecondary">
            <li>
              Não é o que toca a música. A reprodução usa a IFrame Player API oficial e não depende
              deste login.
            </li>
            <li>
              Não dá acesso a YouTube Music, biblioteca do YT Music, remoção de anúncios ou vídeos
              com restrição de idade por conta própria — nada disso possui API pública oficial.
            </li>
          </ul>
        </div>

        <div className="rounded-lg border border-pixtune-primary/30 bg-pixtune-primary/5 p-4">
          <h3 className="text-body-sm font-medium text-pixtune-text">
            Reprodução na sua conta (Premium / sem anúncios)
          </h3>
          <p className="mt-2 text-body-sm text-pixtune-textSecondary">
            Quem reconhece a sua conta durante a reprodução é o <strong>próprio YouTube</strong>,
            usando a sessão do navegador onde o PixTune está aberto — não o login OAuth acima. Não
            existe API oficial para "tocar como a conta"; o caminho oficial é este. Para aproveitar
            sua conta:
          </p>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-body-sm text-pixtune-textSecondary">
            <li>
              Faça login em{' '}
              <a
                href="https://www.youtube.com"
                target="_blank"
                rel="noreferrer"
                className="text-pixtune-primary hover:underline"
              >
                youtube.com
              </a>{' '}
              neste mesmo navegador, na conta correta.
            </li>
            <li>
              Permita cookies de terceiros para <span className="font-mono">youtube.com</span> (o
              player roda em um iframe do YouTube). No Chrome, ajuste no ícone de cadeado da barra
              de endereço.
            </li>
            <li>
              Com <strong>YouTube Premium</strong>, os anúncios normalmente não aparecem e vídeos
              com restrição de idade podem tocar. Sem Premium, anúncios podem aparecer e não há API
              oficial para removê-los.
            </li>
          </ol>
          <p className="mt-3 flex items-start gap-2 text-caption text-pixtune-textMuted">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
            <span>
              O PixTune não lê nem guarda a sua sessão do YouTube. Se o navegador bloquear cookies
              de terceiros do youtube.com, o player toca sem a conta — a música continua
              funcionando normalmente.
            </span>
          </p>
        </div>

        {!configured ? (
          <div className="rounded-lg border border-pixtune-warning/40 bg-pixtune-warning/10 p-4 text-caption text-pixtune-warning">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <div className="space-y-2">
                <p>
                  Conexão do canal do YouTube não configurada. Crie um{' '}
                  <strong>OAuth Client ID</strong> do tipo “Aplicativo da Web” no Google Cloud Console
                  e preencha <span className="font-mono">YOUTUBE_CLIENT_ID</span> e{' '}
                  <span className="font-mono">YOUTUBE_CLIENT_SECRET</span> no{' '}
                  <span className="font-mono">.env</span>, depois reinicie a API. O login no PixTune é
                  feito pelo Firebase Authentication (veja o README) — este OAuth serve só para ler o
                  canal do YouTube.
                </p>
                <p>URI de redirecionamento autorizado que deve ser cadastrada:</p>
                <ul className="space-y-1">
                  <li className="font-mono break-all">{connectRedirect}</li>
                </ul>
                <p>
                  Na tela de consentimento, adicione o escopo{' '}
                  <span className="font-mono">youtube.readonly</span> e inclua sua conta como usuário
                  de teste enquanto o app estiver em modo de teste.
                </p>
              </div>
            </div>
          </div>
        ) : connected && channel ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-4 rounded-lg border border-pixtune-success/30 bg-pixtune-success/10 p-4">
              <div className="flex items-center gap-3 min-w-0">
                {channel.thumbnailUrl ? (
                  <img
                    src={channel.thumbnailUrl}
                    alt={`Avatar do canal ${channel.title}`}
                    className="h-12 w-12 rounded-full object-cover border border-pixtune-border"
                  />
                ) : (
                  <div className="h-12 w-12 rounded-full bg-pixtune-primary/10 text-pixtune-primary flex items-center justify-center">
                    <Youtube className="h-6 w-6" />
                  </div>
                )}
                <div className="min-w-0">
                  <p className="truncate text-body-sm font-medium text-pixtune-text">{channel.title}</p>
                  {channel.customUrl && (
                    <a
                      href={`https://www.youtube.com/${channel.customUrl}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-caption text-pixtune-primary hover:underline"
                    >
                      {channel.customUrl}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              </div>
              <span className="flex items-center gap-2 text-body-sm text-pixtune-success flex-shrink-0">
                <CheckCircle2 className="h-4 w-4" /> Conectado
              </span>
            </div>

            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'Inscritos', value: formatCount(channel.subscriberCount) },
                { label: 'Vídeos', value: formatCount(channel.videoCount) },
                { label: 'Visualizações', value: formatCount(channel.viewCount) },
              ].map((stat) => (
                <div
                  key={stat.label}
                  className="rounded-lg border border-pixtune-border bg-pixtune-surfaceElevated/50 p-3 text-center"
                >
                  <p className="text-body-sm font-semibold text-pixtune-text">{stat.value ?? '—'}</p>
                  <p className="text-caption text-pixtune-textMuted">{stat.label}</p>
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <Button variant="secondary" onClick={() => void handleRefresh()} disabled={busy} className="flex-1">
                <RefreshCw className="w-4 h-4 mr-2" /> Atualizar dados
              </Button>
              <Button variant="danger" onClick={() => void handleDisconnect()} disabled={busy} className="flex-1">
                <Unplug className="w-4 h-4 mr-2" /> Desconectar
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {connected && !channel && (
              <p className="text-caption text-pixtune-textSecondary">
                Canal conectado, mas os dados ainda não foram carregados. Clique em “Atualizar
                dados” para sincronizar.
              </p>
            )}
            <Button variant="primary" onClick={() => void handleConnect()} disabled={busy} className="w-full">
              <Youtube className="w-4 h-4 mr-2" /> Conectar conta do YouTube
            </Button>
            <p className="text-caption text-pixtune-textMuted">
              Você será redirecionado para a tela de consentimento oficial do Google. O PixTune
              recebe um token de atualização e o guarda apenas no banco local.
            </p>
          </div>
        )}

        {feedback && (
          <p className="text-caption text-pixtune-textSecondary" role="status">
            {feedback}
          </p>
        )}
      </div>
    </Card>
  )
}