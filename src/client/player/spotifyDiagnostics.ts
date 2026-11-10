/**
 * Diagnóstico de DRM/EME para o Web Playback SDK do Spotify.
 *
 * O SDK exige um sistema de DRM (Widevine no Android/Chrome/Firefox). Em
 * alguns aparelhos o `requestMediaKeySystemAccess` responde, mas o
 * `createMediaKeys` falha com erros como:
 *
 * - EMEError: No supported keysystem was found
 * - MediaDrmBridge creation failed
 * - Unable to set L1 security level
 * - Device not provisioned during createSession()
 *
 * Esses erros chegam ao app como `playback_error: playback error`, sem
 * indicar a causa. O probe abaixo separa "o navegador não tem DRM" de
 * "o áudio foi bloqueado por autoplay" e permite mostrar uma orientação
 * correta em vez do texto genérico.
 */

export type DrmConfiguration = 'default' | 'L3' | 'L1'

export interface DrmProbeResult {
  label: string
  configuration: DrmConfiguration
  /** O navegador aceitou a configuração no requestMediaKeySystemAccess. */
  supported: boolean
  /** O createMediaKeys() realmente conseguiu criar as chaves. */
  mediaKeys: boolean
  error?: string
}

const AUDIO_CONTENT_TYPE = 'audio/mp4; codecs="mp4a.40.2"'
const PROBE_TIMEOUT_MS = 4_000

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'erro desconhecido'
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`tempo esgotado após ${ms} ms`))
    }, ms)

    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

export function isEmeAvailable(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.requestMediaKeySystemAccess === 'function'
  )
}

/**
 * Testa as três configurações usadas na prática pelo SDK/CDM:
 * padrão, L3 (SW_SECURE_CRYPTO) e L1 (HW_SECURE_CRYPTO).
 *
 * O resultado é uma lista; `drmWorks` só considera disponível quando ao menos
 * uma configuração criou MediaKeys de verdade.
 */
export async function probeSpotifyDrm(): Promise<DrmProbeResult[]> {
  if (!isEmeAvailable()) {
    return [
      {
        label: 'EME',
        configuration: 'default',
        supported: false,
        mediaKeys: false,
        error: 'requestMediaKeySystemAccess indisponível neste navegador',
      },
    ]
  }

  const configurations: Array<{
    label: string
    configuration: DrmConfiguration
    robustness?: string
  }> = [
    { label: 'Widevine padrão', configuration: 'default' },
    {
      label: 'Widevine L3 (SW_SECURE_CRYPTO)',
      configuration: 'L3',
      robustness: 'SW_SECURE_CRYPTO',
    },
    {
      label: 'Widevine L1 (HW_SECURE_CRYPTO)',
      configuration: 'L1',
      robustness: 'HW_SECURE_CRYPTO',
    },
  ]

  const results: DrmProbeResult[] = []

  for (const config of configurations) {
    try {
      const access = await withTimeout(
        navigator.requestMediaKeySystemAccess('com.widevine.alpha', [
          {
            initDataTypes: ['cenc'],
            audioCapabilities: [
              {
                contentType: AUDIO_CONTENT_TYPE,
                ...(config.robustness ? { robustness: config.robustness } : {}),
              },
            ],
          },
        ]),
        PROBE_TIMEOUT_MS
      )

      let mediaKeys = false
      let mediaKeysError: string | undefined

      try {
        const keys = await withTimeout(access.createMediaKeys(), PROBE_TIMEOUT_MS)
        mediaKeys = Boolean(keys)
      } catch (error) {
        mediaKeysError = `createMediaKeys: ${errorMessage(error)}`
      }

      results.push({
        label: config.label,
        configuration: config.configuration,
        supported: true,
        mediaKeys,
        ...(mediaKeysError ? { error: mediaKeysError } : {}),
      })
    } catch (error) {
      results.push({
        label: config.label,
        configuration: config.configuration,
        supported: false,
        mediaKeys: false,
        error: errorMessage(error),
      })
    }
  }

  return results
}

/** Resume o probe em uma linha legível para o painel de diagnóstico. */
export function drmProbeSummary(results: DrmProbeResult[]): string {
  return results
    .map((result) => {
      if (result.mediaKeys) return `${result.label}: OK`
      return `${result.label}: ${result.error || (result.supported ? 'sem MediaKeys' : 'não suportado')}`
    })
    .join(' | ')
}

/** O navegador consegue criar MediaKeys em pelo menos uma configuração. */
export function drmWorks(results: DrmProbeResult[]): boolean {
  return results.some((result) => result.mediaKeys)
}
