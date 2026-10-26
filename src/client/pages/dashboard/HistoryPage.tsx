import { useState, useEffect } from 'react'
import { Clock, AlertCircle, CheckCircle2, Zap, Music, ExternalLink } from 'lucide-react'
import { Card } from '@client/components/ui/Card'
import { Badge } from '@client/components/ui/Badge'
import { Input } from '@client/components/ui/Input'
import { apiDonations, type DonationEvent } from '@client/api/client'
import { formatCurrency, formatRelativeTime } from '@shared/utils'

const actionLabels: Record<string, string> = {
  add_to_queue: 'Pedido de música',
  play_next: 'Pedido de música (prioridade por valor)',
  skip: 'Pular música',
  pause: 'Pausar',
  resume: 'Retomar',
  volume_up: 'Aumentar volume',
  volume_down: 'Diminuir volume',
  shuffle: 'Embaralhar músicas manuais',
}

export function HistoryPage() {
  const [events, setEvents] = useState<DonationEvent[]>([])
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadEvents()
  }, [])

  async function loadEvents() {
    const res = await apiDonations.list()
    if (res.success && res.data) {
      setEvents(res.data.events)
    }
    setLoading(false)
  }

  const filteredEvents = events.filter((event) => {
    const needle = search.toLowerCase()
    const matchesSearch =
      event.donorName.toLowerCase().includes(needle) ||
      (event.donorMessage || '').toLowerCase().includes(needle) ||
      (event.queueItem?.title || '').toLowerCase().includes(needle) ||
      (event.queueItem?.artist || '').toLowerCase().includes(needle)
    const matchesStatus = statusFilter === 'all' || event.status === statusFilter
    return matchesSearch && matchesStatus
  })

  const statusConfig: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
    received: { label: 'Recebido', color: 'bg-pixtune-textMuted', icon: <Clock className="w-3 h-3" /> },
    validated: { label: 'Validação antiga', color: 'bg-pixtune-warning', icon: <Zap className="w-3 h-3" /> },
    ignored: { label: 'Ignorada', color: 'bg-pixtune-textMuted', icon: <AlertCircle className="w-3 h-3" /> },
    processed: { label: 'Processado', color: 'bg-pixtune-success', icon: <CheckCircle2 className="w-3 h-3" /> },
    failed: { label: 'Falhou', color: 'bg-pixtune-danger', icon: <AlertCircle className="w-3 h-3" /> },
    duplicate: { label: 'Duplicado', color: 'bg-pixtune-cyan', icon: <AlertCircle className="w-3 h-3" /> },
  }

  function eventLabel(event: DonationEvent): string {
    return statusConfig[event.status]?.label || event.status
  }

  function resultBadge(event: DonationEvent) {
    if (event.queueItem) {
      return event.queueItem.provider === 'spotify' && event.queueItem.providerId
        ? { variant: 'success' as const, label: 'Música na fila' }
        : { variant: 'warning' as const, label: 'Item legado' }
    }
    if (event.matchedRuleId) {
      return { variant: 'success' as const, label: 'Regra/comando aplicado' }
    }
    if (event.status === 'ignored') {
      return { variant: 'neutral' as const, label: 'Ignorada' }
    }
    if (event.status === 'failed') {
      return { variant: 'danger' as const, label: 'Erro' }
    }
    return { variant: 'neutral' as const, label: 'Sem ação' }
  }

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
          <h1 className="text-heading-lg font-bold text-pixtune-text md:text-page-title">Histórico de Doações</h1>
          <p className="text-body-sm text-pixtune-textSecondary">
            Veja a música detectada em cada mensagem e o resultado do processamento.
          </p>
        </div>
        <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center lg:w-auto">
          <Input
            id="searchHistory"
            placeholder="Buscar doador, mensagem ou música..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full sm:w-64"
          />
          <label htmlFor="statusFilter" className="sr-only">Filtrar por status</label>
          <select
            id="statusFilter"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-full rounded-lg border border-pixtune-border bg-pixtune-surfaceElevated px-4 py-2.5 text-body-sm text-pixtune-text focus:border-pixtune-primary sm:w-auto"
          >
            <option value="all">Todos os status</option>
            <option value="processed">Processado</option>
            <option value="validated">Validação antiga</option>
            <option value="ignored">Ignorada</option>
            <option value="received">Recebido</option>
            <option value="failed">Falhou</option>
            <option value="duplicate">Duplicado</option>
          </select>
        </div>
      </div>

      <Card className="p-0">
        <div className="border-b border-pixtune-border p-4 flex justify-between items-center">
          <h2 className="text-body font-semibold text-pixtune-text">Eventos ({filteredEvents.length})</h2>
          {filteredEvents.length !== events.length && (
            <span className="text-caption text-pixtune-textMuted">{events.length} no total</span>
          )}
        </div>
        {filteredEvents.length === 0 ? (
          <div className="p-8 text-center">
            <AlertCircle className="w-12 h-12 text-pixtune-textMuted mx-auto mb-4" />
            <p className="text-pixtune-textSecondary">Nenhuma doação encontrada</p>
            <p className="text-caption text-pixtune-textMuted mt-2">Tente ajustar os filtros de busca.</p>
          </div>
        ) : (
          <div className="divide-y divide-pixtune-border">
            {filteredEvents.map((event) => {
              const config = statusConfig[event.status] || statusConfig.received
              const badge = resultBadge(event)
              return (
                <div key={event.id} className="flex items-start justify-between gap-4 p-4 hover:bg-pixtune-surfaceElevated/50 transition-colors group">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${config.color}`} aria-label={eventLabel(event)} />
                        <span className="text-caption font-medium text-pixtune-textMuted">{eventLabel(event)}</span>
                        {!event.isDemo && (
                          <Badge variant="warning" className="ml-2">REAL</Badge>
                        )}
                      </div>
                      <p className="text-body-sm font-medium text-pixtune-text truncate">{event.donorName}</p>
                    </div>

                    {event.donorMessage && (
                      <p className="text-body-sm text-pixtune-textSecondary mt-1 truncate">"{event.donorMessage}"</p>
                    )}

                    {event.queueItem && (
                      <div className="flex items-center gap-2 mt-2 text-caption text-pixtune-textSecondary">
                        <Music className="w-3.5 h-3.5 text-pixtune-primary flex-shrink-0" />
                        <span className="truncate">
                          {event.queueItem.title}
                          {event.queueItem.artist ? ` — ${event.queueItem.artist}` : ''}
                        </span>
                        {event.queueItem.provider === 'spotify' &&
                          event.queueItem.providerId &&
                          event.queueItem.sourceUrl && (
                            <a
                              href={event.queueItem.sourceUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-pixtune-primary hover:text-pixtune-primaryHover flex-shrink-0"
                            >
                              Spotify
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                      </div>
                    )}

                    {event.errorMessage && (event.status === 'ignored' || event.status === 'failed' || event.status === 'validated') && (
                      <p
                        className={`text-caption mt-1 ${
                          event.status === 'failed'
                            ? 'text-pixtune-danger'
                            : event.status === 'validated'
                              ? 'text-pixtune-warning'
                              : 'text-pixtune-textMuted'
                        }`}
                      >
                        {event.errorMessage}
                      </p>
                    )}

                    {!event.queueItem && event.matchedRuleAction && (
                      <p className="text-caption text-pixtune-textMuted mt-1">
                        Comando: {actionLabels[event.matchedRuleAction] || event.matchedRuleAction}
                      </p>
                    )}

                    <div className="flex items-center gap-2 mt-2">
                      <p className="text-caption text-pixtune-textMuted">{formatRelativeTime(event.createdAt)}</p>
                      <span className="w-px h-3 bg-pixtune-border" />
                      <p className="text-caption font-mono text-pixtune-textMuted">{formatCurrency(event.amountCents)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge variant={badge.variant}>
                      {badge.label}
                    </Badge>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Card>
    </div>
  )
}
