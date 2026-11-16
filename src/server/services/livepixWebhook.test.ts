/**
 * Testes do sistema de configuração automática do webhook do LivePix.
 * Referência da API: https://docs.livepix.gg/api
 */

import { describe, expect, it } from 'vitest'
import {
  buildWebhookUrl,
  isPixTuneWebhook,
  normalizeWebhookUrl,
  planWebhookReconciliation,
  resolvePublicOrigin,
} from './livepixWebhook.js'

const TOKEN = 'a'.repeat(48)

describe('livepixWebhook', () => {
  it('monta a URL pública com o token exclusivo do streamer', () => {
    expect(buildWebhookUrl('https://pixtune-app.pages.dev/', TOKEN)).toBe(
      `https://pixtune-app.pages.dev/api/donations/webhook/${TOKEN}`
    )
  })

  it('normaliza barra final, hash e mantém o token', () => {
    const base = `https://pixtune-app.pages.dev/api/donations/webhook/${TOKEN}`
    expect(normalizeWebhookUrl(`${base}/`)).toBe(base)
    expect(normalizeWebhookUrl(`${base}#fragmento`)).toBe(base)
    expect(normalizeWebhookUrl('')).toBe('')
  })

  it('reconhece apenas o caminho público de webhook do PixTune', () => {
    expect(isPixTuneWebhook(`https://x.dev/api/donations/webhook/${TOKEN}`)).toBe(true)
    expect(isPixTuneWebhook('https://x.dev/api/other')).toBe(false)
    expect(isPixTuneWebhook('nao-e-url')).toBe(false)
  })

  describe('resolvePublicOrigin', () => {
    it('prefere APP_URL', () => {
      expect(
        resolvePublicOrigin({
          APP_URL: 'https://pixtune-app.pages.dev/',
          PUBLIC_URL: 'https://ignorado.dev',
          NODE_ENV: 'production',
        })
      ).toBe('https://pixtune-app.pages.dev')
    })

    it('usa PUBLIC_URL quando APP_URL está ausente', () => {
      expect(
        resolvePublicOrigin({
          PUBLIC_URL: 'https://publico.dev',
          NODE_ENV: 'production',
        })
      ).toBe('https://publico.dev')
    })

    it('cai para localhost apenas fora de produção', () => {
      expect(resolvePublicOrigin({ NODE_ENV: 'development', PORT: '4321' })).toBe(
        'http://localhost:4321'
      )
      expect(resolvePublicOrigin({ NODE_ENV: 'production' })).toBeNull()
    })

    it('ignora protocolos não HTTP', () => {
      expect(
        resolvePublicOrigin({ APP_URL: 'ftp://invalido.dev', NODE_ENV: 'production' })
      ).toBeNull()
    })
  })

  describe('planWebhookReconciliation', () => {
    const desired = `https://pixtune-app.pages.dev/api/donations/webhook/${TOKEN}`

    it('mantém o webhook já correto e remove duplicados exatos', () => {
      const plan = planWebhookReconciliation(
        [
          { id: 'hook_1', url: desired },
          { id: 'hook_2', url: `${desired}/` },
          { id: 'hook_3', url: 'https://outro-servico.dev/webhook' },
        ],
        desired,
        TOKEN
      )

      expect(plan.create).toBe(false)
      expect(plan.keep?.id).toBe('hook_1')
      expect(plan.remove.map((hook) => hook.id)).toEqual(['hook_2'])
    })

    it('remove URL antiga do Render que carrega o mesmo token', () => {
      const plan = planWebhookReconciliation(
        [
          {
            id: 'hook_render',
            url: `https://pixtune-app.onrender.com/api/donations/webhook/${TOKEN}`,
          },
        ],
        desired,
        TOKEN
      )

      expect(plan.create).toBe(true)
      expect(plan.keep).toBeNull()
      expect(plan.remove.map((hook) => hook.id)).toEqual(['hook_render'])
    })

    it('remove token antigo no mesmo host público', () => {
      const plan = planWebhookReconciliation(
        [
          {
            id: 'hook_old',
            url: 'https://pixtune-app.pages.dev/api/donations/webhook/token_antigo',
          },
        ],
        desired,
        TOKEN
      )

      expect(plan.create).toBe(true)
      expect(plan.remove.map((hook) => hook.id)).toEqual(['hook_old'])
    })

    it('não toca em webhooks de outros serviços', () => {
      const plan = planWebhookReconciliation(
        [{ id: 'hook_outro', url: 'https://outro-servico.dev/webhook' }],
        desired,
        TOKEN
      )

      expect(plan.create).toBe(true)
      expect(plan.remove).toEqual([])
    })
  })
})
