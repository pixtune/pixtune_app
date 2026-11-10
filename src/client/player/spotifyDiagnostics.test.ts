import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  drmProbeSummary,
  drmWorks,
  probeSpotifyDrm,
  type DrmProbeResult,
} from './spotifyDiagnostics'

function result(overrides: Partial<DrmProbeResult>): DrmProbeResult {
  return {
    label: 'Widevine',
    configuration: 'default',
    supported: false,
    mediaKeys: false,
    ...overrides,
  }
}

describe('drmWorks', () => {
  it('aceita quando qualquer configuração criou MediaKeys', () => {
    expect(
      drmWorks([
        result({ label: 'padrão', supported: false }),
        result({ label: 'L3', supported: true, mediaKeys: true }),
      ])
    ).toBe(true)
  })

  it('recusa quando todas as configurações falharam', () => {
    expect(
      drmWorks([
        result({ label: 'padrão', error: 'No supported keysystem' }),
        result({ label: 'L1', supported: true, error: 'createMediaKeys: L1' }),
      ])
    ).toBe(false)
  })
})

describe('probeSpotifyDrm', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('confirma MediaKeys quando o CDM cria as chaves', async () => {
    vi.stubGlobal('navigator', {
      requestMediaKeySystemAccess: vi.fn(async () => ({
        createMediaKeys: vi.fn(async () => ({})),
      })),
    })

    const results = await probeSpotifyDrm()

    expect(results).toHaveLength(3)
    expect(results.every((item) => item.supported && item.mediaKeys)).toBe(true)
    expect(drmWorks(results)).toBe(true)
  })

  it('registra falha de createMediaKeys sem fingir suporte', async () => {
    vi.stubGlobal('navigator', {
      requestMediaKeySystemAccess: vi.fn(async () => ({
        createMediaKeys: vi.fn(async () => {
          throw new Error('Unable to set L1 security level')
        }),
      })),
    })

    const results = await probeSpotifyDrm()

    expect(results).toHaveLength(3)
    expect(results.every((item) => item.mediaKeys)).toBe(false)
    expect(results[0]?.error).toContain('Unable to set L1 security level')
    expect(drmWorks(results)).toBe(false)
  })

  it('registra requestMediaKeySystemAccess rejeitado', async () => {
    vi.stubGlobal('navigator', {
      requestMediaKeySystemAccess: vi.fn(async () => {
        throw new Error('No supported keysystem was found')
      }),
    })

    const results = await probeSpotifyDrm()

    expect(results).toHaveLength(3)
    expect(results.every((item) => !item.supported && !item.mediaKeys)).toBe(true)
    expect(results[0]?.error).toContain('No supported keysystem')
  })
})

describe('drmProbeSummary', () => {
  it('mostra OK, erro de createMediaKeys e configuração não suportada', () => {
    const summary = drmProbeSummary([
      result({ label: 'Widevine padrão', mediaKeys: true, supported: true }),
      result({
        label: 'Widevine L1',
        supported: true,
        error: 'createMediaKeys: Unable to set L1 security level',
      }),
      result({
        label: 'Widevine L3',
        supported: false,
        error: 'No supported keysystem was found',
      }),
    ])

    expect(summary).toContain('Widevine padrão: OK')
    expect(summary).toContain('Widevine L1: createMediaKeys: Unable to set L1 security level')
    expect(summary).toContain('Widevine L3: No supported keysystem was found')
  })

  it('descreve configuração aceita que não criou MediaKeys', () => {
    expect(
      drmProbeSummary([
        result({ label: 'Widevine L3', supported: true, mediaKeys: false }),
      ])
    ).toBe('Widevine L3: sem MediaKeys')
  })
})
