import { useEffect, useState } from 'react'
import { CheckCircle2, Music, ShieldCheck, Trophy, Zap } from 'lucide-react'
import { Button } from '@client/components/ui/Button'
import { Card } from '@client/components/ui/Card'
import { Badge } from '@client/components/ui/Badge'
import { Input } from '@client/components/ui/Input'
import { apiSettings, type UserSettings } from '@client/api/client'
import { formatCurrency } from '@shared/utils'

const priorityPoints = [
  {
    title: 'A maior doação toca primeiro',
    description:
      'Toda doação com pedido de música entra na fila. A faixa de maior valor assume a frente.',
  },
  {
    title: 'Doação maior interrompe na hora',
    description:
      'Se uma doação maior chegar enquanto outra música toca, a atual é encerrada e a maior começa imediatamente.',
  },
  {
    title: 'Valores iguais respeitam a chegada',
    description:
      'Duas doações de mesmo valor não se interrompem: a que chegou primeiro toca primeiro (FIFO).',
  },
  {
    title: 'A música derrubada não volta',
    description:
      'A faixa interrompida é marcada como pulada e permanece no histórico, mas não retorna sozinha para a fila.',
  },
  {
    title: 'O valor de cada doação é imutável',
    description:
      'O streamer não edita, aumenta nem reordena o valor de uma doação para furar a prioridade.',
  },
  {
    title: 'Se a faixa não for encontrada no Spotify',
    description:
      'A doação fica no histórico e não interrompe a música atual. O doador pode usar o nome exato da música ou colar um link do Spotify.',
  },
]

const flowSteps = [
  'O doador escreve o nome da música na mensagem do Live Pix.',
  'O PixTune detecta o pedido, valida a música e busca a faixa oficial no Spotify.',
  'A fila é ordenada pelo valor da doação, não pela ordem de criação.',
  'A maior doação toca; se ela chegar durante outra música, a menor é derrubada.',
]

export function RulesPage() {
  const [settings, setSettings] = useState<UserSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [minAmount, setMinAmount] = useState('0.00')
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null
  )

  useEffect(() => {
    let active = true

    async function loadSettings() {
      try {
        const res = await apiSettings.get()
        const data = res.data ?? null
        if (active) {
          setSettings(data)
          setMinAmount(((data?.songRequestMinAmount ?? 0) / 100).toFixed(2))
        }
      } catch (err) {
        if (active) {
          setError(
            err instanceof Error
              ? err.message
              : 'Não foi possível carregar o valor mínimo configurado.'
          )
        }
      } finally {
        if (active) setLoading(false)
      }
    }

    void loadSettings()
    return () => {
      active = false
    }
  }, [])

  async function saveMinAmount() {
    const value = Number(minAmount.replace(',', '.'))
    if (!Number.isFinite(value) || value < 0) {
      setSaveStatus({ type: 'error', message: 'Informe um valor válido (ex.: 5,00).' })
      return
    }

    setSaving(true)
    setSaveStatus(null)
    try {
      const res = await apiSettings.update({ songRequestMinAmount: Math.round(value * 100) })
      const data = res.data ?? null
      if (data) {
        setSettings(data)
        setMinAmount(((data.songRequestMinAmount ?? 0) / 100).toFixed(2))
      }
      setSaveStatus({ type: 'success', message: 'Valor mínimo salvo.' })
    } catch (err) {
      setSaveStatus({
        type: 'error',
        message:
          err instanceof Error ? err.message : 'Não foi possível salvar o valor mínimo.',
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-heading-lg font-bold text-pixtune-text md:text-page-title">Regras de Doação</h1>
        <p className="mt-1 text-body-sm text-pixtune-textSecondary">
          A prioridade por valor é a regra padrão do sistema. Não há palavras-chave, links fixos,
          ações de comando ou ordenação manual.
        </p>
      </div>

      <Card className="border-pixtune-primary/30 bg-gradient-to-br from-pixtune-primary/10 via-pixtune-surface to-pixtune-surface p-6 sm:p-8">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-pixtune-primary/15 text-pixtune-primary">
              <Trophy className="h-6 w-6" aria-hidden="true" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-heading-sm font-bold text-pixtune-text">
                  Prioridade por valor
                </h2>
                <Badge variant="success">Ativa por padrão</Badge>
              </div>
              <p className="mt-2 max-w-3xl text-body-sm text-pixtune-textSecondary">
                A maior doação sempre tem prioridade. O sistema não usa palavras-chave para decidir
                quem toca primeiro: usa exclusivamente o valor da doação registrado pelo Live Pix.
              </p>
            </div>
          </div>
        </div>

        <ul className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-2">
          {priorityPoints.map((point) => (
            <li
              key={point.title}
              className="flex items-start gap-3 rounded-lg border border-pixtune-border bg-pixtune-bg/40 p-4"
            >
              <CheckCircle2
                className="mt-0.5 h-4 w-4 flex-shrink-0 text-pixtune-primary"
                aria-hidden="true"
              />
              <div>
                <p className="text-body-sm font-medium text-pixtune-text">{point.title}</p>
                <p className="mt-1 text-caption text-pixtune-textSecondary">
                  {point.description}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="p-6">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-pixtune-primary/10 text-pixtune-primary">
              <Zap className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <p className="text-caption uppercase tracking-wider text-pixtune-textMuted">
                Valor mínimo inicial
              </p>
              <p className="mt-1 text-heading-sm font-bold text-pixtune-text">
                {loading ? '—' : formatCurrency(settings?.songRequestMinAmount ?? 0)}
              </p>
              <p className="mt-1 max-w-xl text-caption text-pixtune-textSecondary">
                Doações abaixo deste valor não viram pedido de música. O streamer define apenas
                esse valor inicial; o valor de cada doação continua fixo e imutável.
              </p>
            </div>
          </div>
          <form
            className="w-full space-y-2 lg:w-64 lg:flex-shrink-0"
            onSubmit={(event) => {
              event.preventDefault()
              void saveMinAmount()
            }}
          >
            <label
              htmlFor="rulesSongRequestMinAmount"
              className="block text-body-sm font-medium text-pixtune-textSecondary"
            >
              Valor mínimo (R$)
            </label>
            <Input
              id="rulesSongRequestMinAmount"
              type="number"
              min="0"
              step="0.50"
              value={minAmount}
              onChange={(e) => {
                setMinAmount(e.target.value)
                setSaveStatus(null)
              }}
              placeholder="0,00"
              helperText="Use 0 para não exigir mínimo."
            />
            <Button type="submit" isLoading={saving} className="w-full">
              Salvar valor
            </Button>
            {saveStatus && (
              <p
                role="status"
                className={
                  saveStatus.type === 'success'
                    ? 'text-caption text-pixtune-success'
                    : 'text-caption text-pixtune-danger'
                }
              >
                {saveStatus.message}
              </p>
            )}
          </form>
        </div>

        {error && (
          <p
            role="alert"
            className="mt-4 rounded-lg border border-pixtune-warning/40 bg-pixtune-warning/10 p-3 text-caption text-pixtune-warning"
          >
            {error}
          </p>
        )}
      </Card>

      <Card className="p-6">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-pixtune-cyan/10 text-pixtune-cyan">
            <Music className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-body font-semibold text-pixtune-text">
              Como o pedido entra na fila
            </h2>
            <p className="mt-1 text-body-sm text-pixtune-textSecondary">
              O doador escreve a música na mensagem da doação. O PixTune faz o resto.
            </p>
          </div>
        </div>

        <ol className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {flowSteps.map((step, index) => (
            <li
              key={step}
              className="flex items-start gap-3 rounded-lg border border-pixtune-border bg-pixtune-surfaceElevated/40 p-4"
            >
              <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-pixtune-primary/15 text-caption font-bold text-pixtune-primary">
                {index + 1}
              </span>
              <span className="text-body-sm text-pixtune-textSecondary">{step}</span>
            </li>
          ))}
        </ol>
      </Card>

      <Card className="border-pixtune-cyan/20 bg-pixtune-cyan/5 p-5">
        <div className="flex items-start gap-3">
          <ShieldCheck
            className="mt-0.5 h-5 w-5 flex-shrink-0 text-pixtune-cyan"
            aria-hidden="true"
          />
          <div>
            <p className="text-body-sm font-medium text-pixtune-text">
              Sem palavras-chave ou regras manuais
            </p>
            <p className="mt-1 text-caption text-pixtune-textSecondary">
              Não existe campo de palavras-chave nesta versão. A prioridade por valor é a única
              regra de reprodução: não há ações de pular, pausar, embaralhar ou alterar volume por
              doação, nem cooldown ou limite por hora configurável. A ordem é sempre calculada pelo
              valor da doação.
            </p>
          </div>
        </div>
      </Card>
    </div>
  )
}
