import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { apiMusic, apiQueue, apiSpotify, type MusicTrack } from '@client/api/client'
import { extractSpotifyTrackId, spotifyTrackUri } from '@shared/spotify'
import {
  isBrowserDrmReason,
  isAmbiguousSdkPlaybackError,
  isAutoplayBlockedReason,
  isDeviceReason,
  isMobileBrowser,
  isPremiumReason,
  isRestrictionReason,
  nextReconnectDelay,
  playbackErrorMessage,
  shouldAttemptAutoplay,
  SPOTIFY_AUTH_MESSAGE,
  SPOTIFY_DEVICE_MESSAGE,
  SPOTIFY_DRM_MESSAGE,
  SPOTIFY_GENERIC_MESSAGE,
  SPOTIFY_INIT_MESSAGE,
  SPOTIFY_MOBILE_AUTOPLAY_MESSAGE,
  SPOTIFY_NETWORK_MESSAGE,
  SPOTIFY_PREMIUM_MESSAGE,
  SPOTIFY_RESTRICTION_MESSAGE,
  SPOTIFY_TRACK_INVALID_MESSAGE,
} from './playbackPolicy'
import {
  drmProbeSummary,
  drmWorks,
  probeSpotifyDrm,
  type DrmProbeResult,
} from './spotifyDiagnostics'

/**
 * Player oficial do Spotify usando o Web Playback SDK.
 *
 * O SDK cria um dispositivo Spotify Connect no navegador e entrega somente
 * áudio. O PixTune não baixa, extrai nem contorna a reprodução: o Spotify
 * continua sendo quem entrega o stream.
 *
 * Regras importantes para mobile (Chrome Android / Safari iOS):
 * - O navegador só libera áudio depois de um gesto do usuário. Por isso
 *   `activateElement()` é chamado de forma síncrona no clique de Play/Pular e,
 *   também, no primeiro toque em qualquer lugar da página.
 * - Autoplay, avanço automático de faixa e retomada após recarregar a página
 *   NÃO tentam tocar sozinhos no celular. A interface mostra "toque em Play"
 *   em vez de repetir um erro de reprodução a cada polling.
 * - O token do SDK é renovado de verdade (`force`) quando o Spotify responde
 *   401, evitando repetir um token já recusado.
 */

interface SpotifyWebTrack {
  uri: string
  name: string
  artists?: Array<{ name?: string }>
}

interface SpotifyPlaybackState {
  paused: boolean
  position: number
  duration: number
  track_window: {
    current_track: SpotifyWebTrack
  }
}

interface SpotifyPlayer {
  connect(): Promise<boolean>
  disconnect(): void
  addListener(event: string, callback: (...args: any[]) => void): void
  removeListener(event: string, callback?: (...args: any[]) => void): void
  getCurrentState(): Promise<SpotifyPlaybackState | null>
  activateElement(): Promise<void>
  pause(): Promise<void>
  resume(): Promise<void>
  setVolume(volume: number): Promise<void>
  getVolume(): Promise<number>
  previousTrack(): Promise<void>
  nextTrack(): Promise<void>
  device_id?: string
}

interface SpotifyNamespace {
  Player: new (options: {
    name: string
    getOAuthToken: (callback: (token: string) => void) => void
    volume?: number
  }) => SpotifyPlayer
}

declare global {
  interface Window {
    Spotify?: SpotifyNamespace
    onSpotifyWebPlaybackSDKReady?: () => void
  }
}

function runtimeIsMobile(): boolean {
  if (typeof navigator === 'undefined') return false
  const userAgentData = (
    navigator as Navigator & { userAgentData?: { mobile?: boolean } }
  ).userAgentData
  const coarsePointer =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(pointer: coarse)').matches
      : false
  const screenWidth =
    typeof window !== 'undefined'
      ? window.innerWidth || window.screen?.width || 0
      : 0

  return isMobileBrowser({
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
    coarsePointer,
    screenWidth,
    userAgentMobile: userAgentData?.mobile,
  })
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'erro desconhecido'
}

/**
 * O probe é de Widevine. No iOS o EME usa FairPlay e no Safari desktop o
 * key system também não é Widevine; por isso o resultado só bloqueia a
 * reprodução no Android, que é o escopo desta correção. Em outras plataformas
 * o probe continua disponível no diagnóstico manual, sem bloquear o desktop.
 */
function runtimeIsAndroid(): boolean {
  if (typeof navigator === 'undefined') return false
  if (/Android/i.test(navigator.userAgent)) return true

  const userAgentData = (
    navigator as Navigator & { userAgentData?: { platform?: string } }
  ).userAgentData
  if (userAgentData?.platform === 'Android') return true

  // Android em "Site para desktop": UA vira Linux, mas o ponteiro continua
  // coarse e há toque. Windows/macOS/Linux desktop com mouse não entram.
  const coarsePointer =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches
  return (
    /Linux/i.test(navigator.platform) &&
    navigator.maxTouchPoints > 0 &&
    coarsePointer
  )
}

let sdkPromise: Promise<SpotifyNamespace> | null = null

function loadSpotifySdk(): Promise<SpotifyNamespace> {
  if (window.Spotify?.Player) return Promise.resolve(window.Spotify)
  if (sdkPromise) return sdkPromise

  sdkPromise = new Promise<SpotifyNamespace>((resolve, reject) => {
    let settled = false
    let script: HTMLScriptElement | null = null
    let interval: number | null = null

    const stopPolling = () => {
      if (interval !== null) {
        window.clearInterval(interval)
        interval = null
      }
    }

    const succeed = () => {
      const spotify = window.Spotify
      if (settled || !spotify?.Player) return
      settled = true
      stopPolling()
      resolve(spotify)
    }

    const fail = (message: string) => {
      if (settled) return
      settled = true
      stopPolling()
      // Remove o <script> que falhou para uma nova tentativa poder recarregar.
      script?.remove()
      reject(new Error(message))
    }

    const previousCallback = window.onSpotifyWebPlaybackSDKReady
    window.onSpotifyWebPlaybackSDKReady = () => {
      previousCallback?.()
      succeed()
    }

    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-pixtune-spotify-sdk]'
    )
    if (existing) {
      existing.addEventListener('error', () =>
        fail('Não foi possível carregar o player do Spotify.')
      )
    } else {
      script = document.createElement('script')
      script.src = 'https://sdk.scdn.co/spotify-player.js'
      script.async = true
      script.dataset.pixtuneSpotifySdk = 'true'
      script.onerror = () =>
        fail(
          'Não foi possível carregar o player do Spotify. Verifique bloqueadores de conteúdo e tente novamente.'
        )
      document.head.appendChild(script)
    }

    const startedAt = Date.now()
    interval = window.setInterval(() => {
      if (window.Spotify?.Player) {
        succeed()
        return
      }
      if (Date.now() - startedAt > 15_000) {
        fail('Tempo esgotado ao carregar o player do Spotify. Verifique sua conexão.')
      }
    }, 250)
  }).catch((error) => {
    sdkPromise = null
    throw error
  })

  return sdkPromise
}

/**
 * Erro já traduzido para o usuário. O caller não deve traduzir de novo.
 */
class PlaybackError extends Error {
  constructor(
    message: string,
    readonly needsActivation = false,
    /** Mensagem crua do Spotify/SDK para o painel de diagnóstico. */
    readonly detail: string | null = null
  ) {
    super(message)
    this.name = 'PlaybackError'
  }
}

let tokenCache: { token: string; expiresAt: number } | null = null

async function fetchSpotifyToken(force = false): Promise<string> {
  if (!force && tokenCache && tokenCache.expiresAt > Date.now() + 60_000) {
    return tokenCache.token
  }

  const response = await apiSpotify.token(force)
  if (!response.success || !response.data?.accessToken) {
    throw new Error(
      response.error?.message || 'Conecte sua conta do Spotify nas configurações.'
    )
  }

  const expiresAt = response.data.expiresAt
    ? new Date(response.data.expiresAt).getTime()
    : Date.now() + 50 * 60_000
  tokenCache = { token: response.data.accessToken, expiresAt }
  return response.data.accessToken
}

async function spotifyApiFetch(
  path: string,
  init: RequestInit = {},
  retry = true
): Promise<Response> {
  const token = await fetchSpotifyToken()
  let response: Response

  try {
    response = await fetch(`https://api.spotify.com/v1${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.headers || {}),
      },
    })
  } catch {
    throw new PlaybackError(
      SPOTIFY_NETWORK_MESSAGE,
      false,
      'Falha de rede/CORS ao acessar api.spotify.com'
    )
  }

  if (response.status === 401 && retry) {
    // O Spotify recusou o token mesmo antes do vencimento local. Precisamos
    // pedir ao backend um token novo de verdade; sem `force` ele devolveria o
    // mesmo token em cache e a reprodução continuaria falhando.
    tokenCache = null
    await fetchSpotifyToken(true)
    return spotifyApiFetch(path, init, false)
  }

  return response
}

interface SpotifyApiErrorBody {
  error?: {
    status?: number
    message?: string
    reason?: string
  }
}

async function readSpotifyError(
  response: Response
): Promise<{ message: string; reason: string }> {
  const body = (await response.json().catch(() => ({}))) as SpotifyApiErrorBody
  return {
    message: body?.error?.message || '',
    reason: body?.error?.reason || '',
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

async function transferPlayback(deviceId: string, mobile: boolean): Promise<void> {
  const response = await spotifyApiFetch('/me/player', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_ids: [deviceId], play: false }),
  })

  if (response.ok || response.status === 204 || response.status === 404) return

  const { message, reason } = await readSpotifyError(response)
  const raw = [message, reason].filter(Boolean).join(' — ')
  throw new PlaybackError(
    playbackErrorMessage(raw, { mobile }),
    false,
    `HTTP ${response.status} em PUT /me/player: ${raw || '(sem corpo)'}`
  )
}

/**
 * Inicia uma faixa no dispositivo PixTune.
 *
 * Em mobile o dispositivo pode demorar alguns instantes para aparecer no
 * Spotify Connect. Em vez de falhar no primeiro 404, tentamos transferir e
 * repetir o play algumas vezes. Erros de Premium/restrição não são repetidos.
 */
async function playSpotifyUri(
  deviceId: string,
  uri: string,
  mobile: boolean
): Promise<void> {
  const request = () =>
    spotifyApiFetch(`/me/player/play?device_id=${encodeURIComponent(deviceId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uris: [uri] }),
    })

  let lastMessage = ''
  let lastStatus = 0

  // No máximo 3 tentativas: a primeira + uma após transferir o device + uma
  // última para um 404 transitório. Erros de DRM, faixa inválida, Premium,
  // autoplay e restrição não são repetidos.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await request()
    if (response.ok || response.status === 204) return

    lastStatus = response.status
    const { message, reason } = await readSpotifyError(response)
    lastMessage = [message, reason].filter(Boolean).join(' — ')
    const detail = `HTTP ${response.status} em PUT /me/player/play: ${lastMessage || '(sem corpo)'}`

    if (response.status === 401) {
      throw new PlaybackError(SPOTIFY_AUTH_MESSAGE, false, detail)
    }
    if (response.status === 429) {
      throw new PlaybackError(
        playbackErrorMessage('rate limit', { mobile }),
        false,
        detail
      )
    }
    if (response.status === 400) {
      // URI inválida, episódio enviado como faixa, mercado etc. Repetir não
      // resolve e só gera chamadas desnecessárias à API.
      throw new PlaybackError(
        SPOTIFY_TRACK_INVALID_MESSAGE,
        false,
        detail
      )
    }
    if (response.status === 403) {
      if (isPremiumReason(lastMessage)) {
        throw new PlaybackError(SPOTIFY_PREMIUM_MESSAGE, false, detail)
      }
      if (isRestrictionReason(lastMessage)) {
        throw new PlaybackError(SPOTIFY_RESTRICTION_MESSAGE, false, detail)
      }
      // DRM antes de autoplay: "protected content is blocked" contém
      // "blocked", mas a causa não é gesto do usuário.
      if (isBrowserDrmReason(lastMessage)) {
        throw new PlaybackError(SPOTIFY_DRM_MESSAGE, false, detail)
      }
      // Autoplay precisa de um novo gesto; não adianta repetir a chamada.
      if (isAutoplayBlockedReason(lastMessage)) {
        throw new PlaybackError(
          playbackErrorMessage(lastMessage, { mobile }),
          true,
          detail
        )
      }
      // DRM/erros desconhecidos: repetir o play não melhora. Só
      // transfere/repeti quando o device ainda não estava disponível.
      if (lastMessage && !isDeviceReason(lastMessage)) {
        throw new PlaybackError(
          playbackErrorMessage(lastMessage, { mobile }),
          false,
          detail
        )
      }
      // 403 sem corpo: pode ser o device ainda registrando. Transfere uma vez.
      if (!lastMessage && attempt === 0) {
        await transferPlayback(deviceId, mobile).catch(() => {
          // A segunda tentativa abaixo é a última.
        })
      }
    }
    if (response.status === 404 || isDeviceReason(lastMessage)) {
      // Device ainda registrando. Transferimos uma única vez e repetimos.
      if (attempt === 0) {
        await transferPlayback(deviceId, mobile).catch(() => {
          // O dispositivo pode ainda não estar disponível; a segunda
          // tentativa abaixo é a última.
        })
      }
      if (attempt < 2) {
        await sleep(600)
        continue
      }
    }

    // 403 sem corpo ou 5xx: uma última tentativa, sem transferir de novo.
    if (attempt < 2) {
      await sleep(600)
      continue
    }
  }

  const fallback =
    lastStatus === 404 || lastStatus === 403 || isDeviceReason(lastMessage)
      ? 'device not found'
      : 'playback failed'
  throw new PlaybackError(
    playbackErrorMessage(lastMessage || fallback, { mobile }),
    false,
    `HTTP ${lastStatus || '?'} em PUT /me/player/play: ${lastMessage || fallback}`
  )
}

function toPlaybackErrorInfo(
  error: unknown,
  mobile: boolean
): { message: string; needsActivation: boolean; detail: string | null } {
  if (error instanceof PlaybackError) {
    return {
      message: error.message,
      needsActivation: error.needsActivation,
      detail: error.detail,
    }
  }

  const raw = error instanceof Error ? error.message : ''
  if (!raw) return { message: SPOTIFY_GENERIC_MESSAGE, needsActivation: false, detail: null }

  if (
    /conecte sua conta|sessão do spotify|reconecte a conta|invalid_grant|invalid token|refresh token|token expirado|token revogado|unauthorized/i.test(
      raw
    )
  ) {
    return { message: SPOTIFY_AUTH_MESSAGE, needsActivation: false, detail: raw }
  }

  // Mensagens da nossa API já estão em português e são mais específicas
  // (ex.: "Aguarde a vez: a maior doação toca primeiro").
  if (/[ãáâàéêíóôõúç]/i.test(raw) || /não|toque|verifique|aguarde|player|spotify/i.test(raw)) {
    return { message: raw, needsActivation: false, detail: raw }
  }

  if (isAutoplayBlockedReason(raw) || (mobile && isAmbiguousSdkPlaybackError(raw))) {
    return { message: playbackErrorMessage(raw, { mobile }), needsActivation: true, detail: raw }
  }

  return { message: playbackErrorMessage(raw, { mobile }), needsActivation: false, detail: raw }
}

interface AudioPlayerContextValue {
  track: MusicTrack | null
  isPlaying: boolean
  isReady: boolean
  isLoading: boolean
  volume: number
  positionMs: number
  durationMs: number
  error: string | null
  /** Mensagem crua do SDK/API para diagnóstico (sem tokens). */
  errorDetail: string | null
  /** Problema de conta (ex.: Spotify sem Premium), separado de erros de reprodução. */
  accountError: string | null
  /** O navegador bloqueou o áudio e o usuário precisa tocar em Play. */
  needsAudioActivation: boolean
  /** O navegador atual é móvel. */
  isMobile: boolean
  playTrack: (track: MusicTrack) => Promise<void>
  togglePlay: () => Promise<void>
  next: () => Promise<void>
  previous: () => Promise<void>
  setVolume: (volume: number) => void
  refresh: () => Promise<void>
  /** Recria/reconecta o player e tenta buscar o status novamente. */
  reconnect: () => Promise<void>
  /** Coleta um relatório técnico (sem tokens) para diagnosticar o mobile. */
  diagnose: () => Promise<string>
}

const AudioPlayerContext = createContext<AudioPlayerContextValue | null>(null)

export function SpotifyAudioProvider({ children }: { children: ReactNode }) {
  const [track, setTrack] = useState<MusicTrack | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [isReady, setIsReady] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [volume, setVolume] = useState(70)
  const [positionMs, setPositionMs] = useState(0)
  const [durationMs, setDurationMs] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [errorDetail, setErrorDetail] = useState<string | null>(null)
  const [accountError, setAccountError] = useState<string | null>(null)
  const [needsAudioActivation, setNeedsAudioActivationState] = useState(false)
  const [spotifyConnected, setSpotifyConnected] = useState<boolean | null>(null)
  const [statusReloadToken, setStatusReloadToken] = useState(0)
  const [sdkReloadToken, setSdkReloadToken] = useState(0)

  const [isMobile] = useState(() => runtimeIsMobile())

  const playerRef = useRef<SpotifyPlayer | null>(null)
  const deviceIdRef = useRef<string | null>(null)
  const trackRef = useRef<MusicTrack | null>(null)
  const loadedTrackRef = useRef<MusicTrack | null>(null)
  const isPlayingRef = useRef(false)
  const volumeRef = useRef(70)
  const loadedUriRef = useRef<string | null>(null)
  const endedUriRef = useRef<string | null>(null)
  const lastPositionRef = useRef(0)
  const lastDurationRef = useRef(0)
  const syncInFlightRef = useRef(false)
  const autoPlayInFlightRef = useRef(false)
  const lastAutoPlayAttemptRef = useRef(0)
  const volumeChangedAtRef = useRef(0)
  const volumeDebounceRef = useRef<number | null>(null)
  const refreshRef = useRef<() => Promise<void>>(async () => {})
  const handleEndedRef = useRef<(trackId?: string) => Promise<void>>(async () => {})
  const isMobileRef = useRef(isMobile)

  const audioUnlockedRef = useRef(false)
  const needsActivationRef = useRef(false)
  const activationPromiseRef = useRef<Promise<boolean> | null>(null)
  /** Último erro cru do activateElement(), exibido no diagnóstico. */
  const lastActivationErrorRef = useRef<string | null>(null)
  /** Probe de DRM/EME executado uma única vez por página. */
  const drmProbeRef = useRef<Promise<DrmProbeResult[]> | null>(null)
  const [drmSummary, setDrmSummary] = useState<string | null>(null)
  /**
   * Erro fatal (DRM, Premium, faixa inválida) que impede o polling de tentar
   * o play repetidamente. É limpo apenas por um gesto explícito do usuário.
   */
  const fatalPlaybackRef = useRef<string | null>(null)
  const diagnosticsInFlightRef = useRef<Promise<string> | null>(null)
  const loadSeqRef = useRef(0)
  const endedInFlightRef = useRef(false)
  const startingUriRef = useRef<string | null>(null)
  const startingPromiseRef = useRef<Promise<void> | null>(null)
  /** URI que o SDK realmente começou a tocar (para diferenciar resume de play). */
  const startedUriRef = useRef<string | null>(null)
  /** Última vez que o usuário pediu play; evita pausar o servidor durante o clique. */
  const lastUserPlayAtRef = useRef(0)

  const connectingRef = useRef(false)
  const connectAttemptRef = useRef(0)
  const reconnectTimerRef = useRef<number | null>(null)
  const scheduleReconnectRef = useRef<() => void>(() => {})

  const updateTrack = useCallback((next: MusicTrack | null) => {
    trackRef.current = next
    setTrack(next)
  }, [])

  const updatePlaying = useCallback((next: boolean) => {
    isPlayingRef.current = next
    setIsPlaying(next)
  }, [])

  const updateVolume = useCallback((next: number) => {
    volumeRef.current = next
    setVolume(next)
  }, [])

  const setNeedsAudioActivation = useCallback((value: boolean) => {
    needsActivationRef.current = value
    setNeedsAudioActivationState(value)
  }, [])

  const markAudioUnlocked = useCallback(() => {
    audioUnlockedRef.current = true
    needsActivationRef.current = false
    setNeedsAudioActivationState(false)
  }, [])

  const markFatalPlayback = useCallback((reason: string) => {
    fatalPlaybackRef.current = reason
  }, [])

  const clearFatalPlayback = useCallback(() => {
    fatalPlaybackRef.current = null
  }, [])

  const getDrmProbe = useCallback((): Promise<DrmProbeResult[]> => {
    if (!drmProbeRef.current) {
      drmProbeRef.current = probeSpotifyDrm()
        .then((results) => {
          setDrmSummary(drmProbeSummary(results))
          return results
        })
        .catch((error) => {
          const results: DrmProbeResult[] = [
            {
              label: 'Widevine',
              configuration: 'default',
              supported: false,
              mediaKeys: false,
              error: errorMessage(error),
            },
          ]
          setDrmSummary(drmProbeSummary(results))
          return results
        })
    }
    return drmProbeRef.current
  }, [])

  /**
   * Libera o elemento de áudio do SDK. Precisa ser chamado dentro de um gesto
   * do usuário (clique/toque); por isso nunca é chamado pelo polling.
   *
   * O erro do activateElement() não é engolido: ele é anexado ao diagnóstico.
   * Em alguns aparelhos ele falha por DRM, e a mensagem original é a única
   * forma de separar DRM de bloqueio de autoplay.
   */
  const activateAudio = useCallback((force = false): Promise<boolean> => {
    // Se uma falha de autoplay já sinalizou necessidade de novo gesto, não
    // confie no estado antigo: o elemento pode ter sido suspenso pelo sistema.
    // Chamamos activateElement() de novo dentro do clique do usuário.
    if (!force && audioUnlockedRef.current && !needsActivationRef.current) {
      return Promise.resolve(true)
    }

    const existing = activationPromiseRef.current
    if (existing) return existing

    const player = playerRef.current
    if (!player?.activateElement) {
      const message = 'player.activateElement indisponível'
      lastActivationErrorRef.current = message
      return Promise.resolve(false)
    }

    let promise: Promise<boolean>
    promise = player
      .activateElement()
      .then(() => {
        lastActivationErrorRef.current = null
        markAudioUnlocked()
        return true
      })
      .catch((error) => {
        const message = errorMessage(error)
        lastActivationErrorRef.current = message
        setErrorDetail((current) => {
          const line = `activateElement: ${message}`
          if (!current) return line
          return current.includes(line) ? current : `${current}\n${line}`
        })
        return false
      })
      .finally(() => {
        if (activationPromiseRef.current === promise) {
          activationPromiseRef.current = null
        }
      })

    activationPromiseRef.current = promise
    return promise
  }, [markAudioUnlocked])

  const canAutoPlayNow = useCallback(
    () =>
      shouldAttemptAutoplay({
        mobile: isMobileRef.current,
        audioUnlocked: audioUnlockedRef.current,
        needsActivation: needsActivationRef.current,
      }),
    []
  )

  /**
   * Alinha o estado do servidor quando o navegador não pode iniciar o áudio.
   * Não pausa se o usuário acabou de pedir play: o `play()` dele pode estar
   * em andamento e um pause atrasado interromperia a reprodução recém-iniciada.
   */
  const pauseServerForActivation = useCallback(() => {
    if (Date.now() - lastUserPlayAtRef.current < 10_000) return
    void apiMusic.pause().catch(() => {})
  }, [])

  const startSpotifyUri = useCallback(async (uri: string) => {
    const player = playerRef.current
    const deviceId = deviceIdRef.current
    if (!player || !deviceId) {
      throw new PlaybackError(
        SPOTIFY_DEVICE_MESSAGE,
        false,
        `Player ${player ? 'presente' : 'ausente'}, deviceId ${deviceId ? 'presente' : 'ausente'}`
      )
    }

    // Espera a ativação disparada pelo clique, mas não tenta criar uma nova
    // ativação fora de um gesto (isso seria bloqueado no mobile).
    const pendingActivation = activationPromiseRef.current
    if (pendingActivation) await pendingActivation.catch(() => false)

    await playSpotifyUri(deviceId, uri, isMobileRef.current)
  }, [])

  /**
   * Evita dois `PUT /me/player/play` simultâneos para a mesma faixa.
   *
   * O polling de 4s e o avanço automático podiam iniciar a mesma faixa em
   * paralelo, gerando 404/erros repetidos no mobile enquanto o dispositivo
   * ainda estava sendo registrado. Chamadas para a mesma URI reaproveitam a
   * promessa em andamento; uma URI nova substitui a anterior.
   */
  const startUri = useCallback(
    (uri: string): Promise<void> => {
      if (startingUriRef.current === uri && startingPromiseRef.current) {
        return startingPromiseRef.current
      }

      let promise: Promise<void>
      promise = startSpotifyUri(uri).finally(() => {
        if (startingPromiseRef.current === promise) {
          startingPromiseRef.current = null
          startingUriRef.current = null
        }
      })

      startingUriRef.current = uri
      startingPromiseRef.current = promise
      return promise
    },
    [startSpotifyUri]
  )

  const applyTrack = useCallback(
    (nextTrack: MusicTrack | null, autoplay: boolean) => {
      const seq = ++loadSeqRef.current

      if (!nextTrack) {
        loadedTrackRef.current = null
        loadedUriRef.current = null
        endedUriRef.current = null
        startedUriRef.current = null
        lastPositionRef.current = 0
        lastDurationRef.current = 0
        setError((current) => {
          if (!current) return null
          return /conecte sua conta|não configurado no servidor|não foi possível verificar|sessão do spotify/i.test(
            current
          )
            ? current
            : null
        })
        setNeedsAudioActivation(false)
        void playerRef.current?.pause().catch(() => {})
        updatePlaying(false)
        updateTrack(null)
        setPositionMs(0)
        setDurationMs(0)
        setIsLoading(false)
        return
      }

      if (nextTrack.provider !== 'spotify' || !nextTrack.providerId) {
        setError('Esta faixa não está disponível no Spotify.')
        setErrorDetail(`provider inválido: ${nextTrack.provider || '(vazio)'}`)
        void playerRef.current?.pause().catch(() => {})
        updatePlaying(false)
        setIsLoading(false)
        loadedTrackRef.current = null
        loadedUriRef.current = null
        endedUriRef.current = null
        startedUriRef.current = null
        return
      }

      // Aceita ID puro, URI ou URL do Spotify. Se não for uma faixa válida
      // (ex.: episódio de podcast salvo como track), não chama a API.
      const spotifyId = extractSpotifyTrackId(nextTrack.providerId)
      if (!spotifyId) {
        setError(SPOTIFY_TRACK_INVALID_MESSAGE)
        setErrorDetail(`providerId inválido para faixa: ${nextTrack.providerId}`)
        markFatalPlayback('invalid_track')
        void playerRef.current?.pause().catch(() => {})
        updatePlaying(false)
        setIsLoading(false)
        loadedTrackRef.current = null
        loadedUriRef.current = null
        endedUriRef.current = null
        startedUriRef.current = null
        return
      }

      const uri = spotifyTrackUri(spotifyId)
      const changed = loadedUriRef.current !== uri

      // Limpa erros de reprodução, mas preserva avisos de conta/configuração:
      // o polling da fila não deve apagar a mensagem de reconexão do Spotify.
      setError((current) => {
        if (!current) return null
        return /conecte sua conta|não configurado no servidor|não foi possível verificar|sessão do spotify/i.test(
          current
        )
          ? current
          : null
      })
      updateTrack(nextTrack)
      setDurationMs(nextTrack.durationMs ?? 0)

      if (changed) {
        endedUriRef.current = null
        startedUriRef.current = null
        lastPositionRef.current = 0
        lastDurationRef.current = nextTrack.durationMs ?? 0
      }

      if (autoplay) {
        if (!changed && isPlayingRef.current) return

        // Depois de um erro fatal (DRM, faixa inválida, Premium), o polling
        // não deve continuar chamando o Spotify. Um gesto explícito do usuário
        // limpa esse bloqueio antes de chegar aqui.
        if (
          fatalPlaybackRef.current &&
          Date.now() - lastUserPlayAtRef.current > 10_000
        ) {
          updatePlaying(false)
          setIsLoading(false)
          return
        }

        loadedTrackRef.current = nextTrack
        loadedUriRef.current = uri
        endedUriRef.current = null

        if (!deviceIdRef.current) {
          // O dispositivo ainda não ficou pronto. Não trate como erro: o
          // evento `ready` chama o refresh e decide se pode tocar.
          updatePlaying(false)
          setIsLoading(false)
          return
        }

        if (!canAutoPlayNow()) {
          updatePlaying(false)
          setIsLoading(false)
          setNeedsAudioActivation(true)
          return
        }

        setIsLoading(true)
        void startUri(uri)
          .then(() => {
            if (loadSeqRef.current !== seq) return
            startedUriRef.current = uri
            setIsLoading(false)
            updatePlaying(true)
            setNeedsAudioActivation(false)
          })
          .catch((err) => {
            if (loadSeqRef.current !== seq) return
            const info = toPlaybackErrorInfo(err, isMobileRef.current)
            setIsLoading(false)
            updatePlaying(false)
            if (info.needsActivation) {
              audioUnlockedRef.current = false
              activationPromiseRef.current = null
              setNeedsAudioActivation(true)
            } else {
              markFatalPlayback(info.detail || info.message)
            }
            setError(info.message)
            setErrorDetail(info.detail)
            if (err instanceof Error) {
              console.warn('[PixTune] Spotify playback start failed:', err.message)
            }
          })
        return
      }

      loadedTrackRef.current = nextTrack
      loadedUriRef.current = uri
      if (isPlayingRef.current) {
        void playerRef.current?.pause().catch(() => {})
      }
      updatePlaying(false)
      setIsLoading(false)
    },
    [
      canAutoPlayNow,
      markFatalPlayback,
      setNeedsAudioActivation,
      startUri,
      updatePlaying,
      updateTrack,
    ]
  )

  const handleEnded = useCallback(
    async (finishedTrackId?: string) => {
      if (endedInFlightRef.current) return
      endedInFlightRef.current = true

      try {
        const response = await apiMusic.ended(finishedTrackId)
        const next = response.data?.track ?? null

        if (!next) {
          applyTrack(null, false)
          return
        }

        const canAuto = canAutoPlayNow() && !fatalPlaybackRef.current
        applyTrack(next, canAuto)
        if (!canAuto && !fatalPlaybackRef.current) {
          // A próxima faixa já foi promovida para `playing` no servidor; como
          // este navegador precisa de um gesto, marcamos como pausada até o
          // usuário tocar em Play.
          pauseServerForActivation()
          setNeedsAudioActivation(true)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erro ao avançar a fila.')
        setErrorDetail(`queue_ended: ${errorMessage(err)}`)
        updatePlaying(false)
      } finally {
        endedInFlightRef.current = false
      }
    },
    [applyTrack, canAutoPlayNow, pauseServerForActivation, setNeedsAudioActivation, updatePlaying]
  )

  useEffect(() => {
    handleEndedRef.current = handleEnded
  }, [handleEnded])

  /**
   * Detecta o fim da faixa comparando a URI que o SDK está tocando com a URI
   * que nós carregamos. Sem isso, um estado atrasado de uma faixa anterior
   * podia encerrar a faixa seguinte.
   */
  const maybeFinish = useCallback((state: SpotifyPlaybackState | null) => {
    if (!state || !state.duration) return

    const currentUri = loadedUriRef.current
    if (!currentUri) return

    const stateUri = state.track_window?.current_track?.uri
    if (stateUri && stateUri !== currentUri) return

    const position = state.position
    const duration = state.duration
    const nearEnd = position >= duration - 1000
    const resetAtEnd =
      state.paused &&
      position === 0 &&
      lastDurationRef.current > 0 &&
      lastPositionRef.current >= lastDurationRef.current - 1500

    if (!nearEnd && !resetAtEnd) {
      lastPositionRef.current = position
      lastDurationRef.current = duration
      return
    }

    if (endedUriRef.current === currentUri) return

    endedUriRef.current = currentUri
    lastPositionRef.current = position
    lastDurationRef.current = duration
    void handleEndedRef.current(loadedTrackRef.current?.id)
  }, [])

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }
  }, [])

  const connectPlayer = useCallback(async (): Promise<boolean> => {
    if (deviceIdRef.current) return true
    if (connectingRef.current) return false

    const player = playerRef.current
    if (!player) return false

    connectingRef.current = true
    try {
      return await player.connect()
    } catch {
      return false
    } finally {
      connectingRef.current = false
    }
  }, [])

  const scheduleReconnect = useCallback(() => {
    if (reconnectTimerRef.current !== null) return
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      // Em mobile o navegador suspende a aba em segundo plano. Tentaremos de
      // novo quando o usuário voltar, em vez de gastar tentativas dormindo.
      return
    }

    const attempt = connectAttemptRef.current
    if (attempt >= 6) {
      setError(
        'Não foi possível reconectar o player do Spotify. Verifique a internet e toque em "Tentar novamente".'
      )
      return
    }

    connectAttemptRef.current = attempt + 1
    const delay = nextReconnectDelay(attempt)

    reconnectTimerRef.current = window.setTimeout(() => {
      reconnectTimerRef.current = null
      void connectPlayer().then((connected) => {
        if (!connected) scheduleReconnectRef.current()
      })
    }, delay)
  }, [connectPlayer])

  useEffect(() => {
    scheduleReconnectRef.current = scheduleReconnect
  }, [scheduleReconnect])

  // Status da integração. Um cold start do Render ou uma troca de rede no
  // celular não deve marcar a conta como desconhecida para sempre.
  useEffect(() => {
    let cancelled = false
    let attempt = 0
    let timer: number | null = null

    const load = async () => {
      try {
        const response = await apiSpotify.status()
        if (cancelled) return
        if (!response.success || !response.data) {
          throw new Error('invalid_status')
        }

        const data = response.data
        if (!data.configured) {
          setSpotifyConnected(false)
          setAccountError(null)
          setError('Spotify não configurado no servidor. Abra Configurações > Spotify.')
          return
        }
        if (!data.connected) {
          setSpotifyConnected(false)
          setAccountError(null)
          setError('Conecte sua conta do Spotify em Configurações > Spotify.')
          return
        }

        setSpotifyConnected(true)
        setAccountError(data.premium ? null : SPOTIFY_PREMIUM_MESSAGE)
        setError((current) => {
          if (!current) return null
          return /conecte sua conta|não configurado no servidor|não foi possível verificar/i.test(
            current
          )
            ? null
            : current
        })
      } catch {
        if (cancelled) return
        attempt += 1
        if (attempt < 3) {
          timer = window.setTimeout(load, attempt * 2000)
          return
        }
        setSpotifyConnected(false)
        setError(
          'Não foi possível verificar a conexão com o Spotify. Verifique a internet e toque em "Tentar novamente".'
        )
        setErrorDetail('status: falha ao consultar /api/spotify/status após 3 tentativas')
      }
    }

    void load()

    return () => {
      cancelled = true
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [statusReloadToken])

  // Reage à desconexão feita em Configurações sem exigir recarregar a página.
  useEffect(() => {
    const handleDisconnected = () => {
      tokenCache = null
      clearReconnectTimer()
      try {
        playerRef.current?.disconnect()
      } catch {
        // O player pode já ter sido removido.
      }
      playerRef.current = null
      deviceIdRef.current = null
      loadedTrackRef.current = null
      loadedUriRef.current = null
      endedUriRef.current = null
      startedUriRef.current = null
      lastPositionRef.current = 0
      lastDurationRef.current = 0
      syncInFlightRef.current = false
      autoPlayInFlightRef.current = false
      endedInFlightRef.current = false
      activationPromiseRef.current = null
      connectingRef.current = false
      // Invalida qualquer play em andamento para ele não reativar a UI depois
      // que a conta foi desconectada.
      loadSeqRef.current += 1
      startingUriRef.current = null
      startingPromiseRef.current = null
      audioUnlockedRef.current = false
      needsActivationRef.current = false
      setNeedsAudioActivationState(false)
      updateTrack(null)
      updatePlaying(false)
      setIsReady(false)
      setIsLoading(false)
      setSpotifyConnected(false)
      setAccountError(null)
      setPositionMs(0)
      setDurationMs(0)
      setError('Conecte sua conta do Spotify em Configurações > Spotify.')
    }

    window.addEventListener('pixtune:spotify-disconnected', handleDisconnected)

    return () => {
      window.removeEventListener('pixtune:spotify-disconnected', handleDisconnected)
      // Evita que um token de uma sessão anterior sobreviva ao logout.
      tokenCache = null
    }
  }, [clearReconnectTimer, updatePlaying, updateTrack])

  // Cria o dispositivo Spotify Connect no navegador.
  useEffect(() => {
    if (spotifyConnected !== true) return

    let cancelled = false
    const localPlayerRef: { current: SpotifyPlayer | null } = { current: null }

    clearReconnectTimer()

    void loadSpotifySdk()
      .then((Spotify) => {
        if (cancelled) return

        if (playerRef.current) {
          try {
            playerRef.current.disconnect()
          } catch {
            // Player antigo já removido.
          }
          playerRef.current = null
          deviceIdRef.current = null
        }

        const player = new Spotify.Player({
          name: 'PixTune',
          volume: volumeRef.current / 100,
          getOAuthToken: (callback) => {
            void fetchSpotifyToken()
              .then((token) => callback(token))
              .catch((err) => {
                const info = toPlaybackErrorInfo(err, isMobileRef.current)
                setError(info.message)
                setErrorDetail(info.detail)
              })
          },
        })

        localPlayerRef.current = player
        playerRef.current = player

        player.addListener('ready', ({ device_id }: { device_id: string }) => {
          if (cancelled) return
          clearReconnectTimer()
          connectAttemptRef.current = 0
          deviceIdRef.current = device_id
          setIsReady(true)

          // Um device novo pode resolver falhas transitórias de conexão. Não
          // limpa erros fatais de DRM/conta/faixa inválida: eles não melhoram
          // só porque o Connect reconectou.
          const fatal = fatalPlaybackRef.current
          if (
            fatal &&
            !/drm|account|invalid_track|initialization_error|playback_error/i.test(
              fatal
            )
          ) {
            clearFatalPlayback()
          }
          setError((current) => {
            if (!current) return null
            // Limpa somente avisos de conexão/carregamento; um erro real de
            // reprodução ou de conta continua visível.
            return /conect|player|dispositivo|carregar|inicializar/i.test(current)
              ? null
              : current
          })
          void player.setVolume(volumeRef.current / 100).catch(() => {})
          void refreshRef.current()
        })

        player.addListener('not_ready', ({ device_id }: { device_id?: string }) => {
          if (cancelled) return
          setIsReady(false)
          deviceIdRef.current = null
          startedUriRef.current = null
          // O device caiu; o elemento de áudio pode precisar de um novo gesto
          // quando o Spotify reconectar.
          audioUnlockedRef.current = false
          activationPromiseRef.current = null
          updatePlaying(false)
          setErrorDetail(
            `not_ready: device ${device_id ? device_id.slice(0, 8) : 'desconhecido'} saiu do Spotify Connect`
          )
          scheduleReconnectRef.current()
        })

        player.addListener(
          'player_state_changed',
          (state: SpotifyPlaybackState | null) => {
            if (cancelled || !state) return
            setPositionMs(state.position)
            setDurationMs(state.duration)
            if (!state.paused) {
              const stateUri = state.track_window?.current_track?.uri
              if (stateUri) startedUriRef.current = stateUri
              // O SDK está realmente tocando: o elemento está liberado e a UI
              // não precisa mais pedir um novo gesto.
              audioUnlockedRef.current = true
              setNeedsAudioActivation(false)
            }
            updatePlaying(!state.paused)
            maybeFinish(state)
          }
        )

        player.addListener(
          'initialization_error',
          ({ message }: { message: string }) => {
            if (cancelled) return
            setIsReady(false)
            deviceIdRef.current = null
            startedUriRef.current = null
            audioUnlockedRef.current = false
            activationPromiseRef.current = null
            markFatalPlayback(`initialization_error: ${message || '(sem mensagem)'}`)
            setNeedsAudioActivation(false)
            setError(
              isBrowserDrmReason(message)
                ? SPOTIFY_DRM_MESSAGE
                : playbackErrorMessage(message, { mobile: isMobileRef.current })
            )
            setErrorDetail(`initialization_error: ${message || '(sem mensagem)'}`)
            if (message) {
              console.warn('[PixTune] Spotify initialization_error:', message)
            }

            // O initialization_error quase sempre é EME/Widevine. Confirma com
            // o probe e substitui o texto genérico pela causa real.
            void getDrmProbe().then((results) => {
              if (cancelled) return
              setErrorDetail((current) =>
                `${current || 'initialization_error'}\nDRM: ${drmProbeSummary(results)}`
              )
              if (runtimeIsAndroid() && !drmWorks(results)) {
                setError(SPOTIFY_DRM_MESSAGE)
              } else if (!isBrowserDrmReason(message)) {
                setError(SPOTIFY_INIT_MESSAGE)
              }
            })
          }
        )

        player.addListener(
          'authentication_error',
          ({ message }: { message: string }) => {
            if (cancelled) return
            tokenCache = null
            setIsReady(false)
            deviceIdRef.current = null
            startedUriRef.current = null
            audioUnlockedRef.current = false
            activationPromiseRef.current = null
            setError(SPOTIFY_AUTH_MESSAGE)
            setErrorDetail(`authentication_error: ${message || '(sem mensagem)'}`)
            setSpotifyConnected(false)
            if (message) {
              console.warn('[PixTune] Spotify authentication_error:', message)
            }
          }
        )

        player.addListener('account_error', ({ message }: { message?: string }) => {
          if (cancelled) return
          setAccountError(SPOTIFY_PREMIUM_MESSAGE)
          setErrorDetail(`account_error: ${message || '(sem mensagem)'}`)
          setNeedsAudioActivation(false)
          markFatalPlayback(`account_error: ${message || 'Premium'}`)
        })

        // Evento oficial emitido quando o navegador recusa o autoplay. Sem
        // isso, o mobile podia continuar tentando sem um novo gesto.
        player.addListener('autoplay_failed', () => {
          if (cancelled) return
          audioUnlockedRef.current = false
          activationPromiseRef.current = null
          setIsLoading(false)
          updatePlaying(false)
          setNeedsAudioActivation(true)
          setError(SPOTIFY_MOBILE_AUTOPLAY_MESSAGE)
          setErrorDetail('autoplay_failed: o navegador recusou o áudio sem gesto')
          console.warn('[PixTune] Spotify autoplay_failed')
        })

        player.addListener(
          'playback_error',
          ({ message }: { message: string }) => {
            if (cancelled) return
            setIsLoading(false)
            updatePlaying(false)
            startedUriRef.current = null

            const blocked =
              isAutoplayBlockedReason(message) ||
              (isMobileRef.current && isAmbiguousSdkPlaybackError(message))

            if (blocked) {
              // Força um novo activateElement() no próximo clique.
              audioUnlockedRef.current = false
              activationPromiseRef.current = null
              setNeedsAudioActivation(true)
            } else {
              // DRM, faixa inválida, Premium ou erro desconhecido: não deixa o
              // polling de 4s chamar o play repetidamente.
              markFatalPlayback(`playback_error: ${message || '(sem mensagem)'}`)
              setNeedsAudioActivation(false)
            }

            setError(playbackErrorMessage(message, { mobile: isMobileRef.current }))
            setErrorDetail(
              `playback_error: ${message || '(sem mensagem)'}${
                lastActivationErrorRef.current
                  ? `\nactivateElement: ${lastActivationErrorRef.current}`
                  : ''
              }`
            )
            if (message) {
              console.warn('[PixTune] Spotify playback_error:', message)
            }

            // "playback error" é genérico. O probe de DRM separa autoplay de
            // EME/Widevine e permite mostrar a causa real no card.
            void getDrmProbe().then((results) => {
              if (cancelled) return
              setErrorDetail((current) =>
                `${current || 'playback_error'}\nDRM: ${drmProbeSummary(results)}`
              )
              if (runtimeIsAndroid() && !drmWorks(results)) {
                setError(SPOTIFY_DRM_MESSAGE)
                setNeedsAudioActivation(false)
                markFatalPlayback(
                  `playback_error sem DRM: ${message || '(sem mensagem)'}`
                )
              } else if (blocked) {
                setError(SPOTIFY_MOBILE_AUTOPLAY_MESSAGE)
              }
            })
          }
        )

        connectingRef.current = true
        void player
          .connect()
          .then((connected) => {
            if (!connected && !cancelled) {
              setError(
                'Não foi possível conectar o dispositivo PixTune ao Spotify. Tentando novamente...'
              )
              setErrorDetail('connect: player.connect() retornou false')
              scheduleReconnectRef.current()
            }
          })
          .catch((error) => {
            if (!cancelled) {
              setError(
                'Não foi possível conectar o dispositivo PixTune ao Spotify. Tentando novamente...'
              )
              setErrorDetail(`connect: ${errorMessage(error)}`)
              scheduleReconnectRef.current()
            }
          })
          .finally(() => {
            connectingRef.current = false
          })
      })
      .catch((err) => {
        if (!cancelled) {
          setIsReady(false)
          setError(
            err instanceof Error
              ? err.message
              : 'Erro ao carregar o player do Spotify. Tente novamente.'
          )
          setErrorDetail(`sdk_load: ${errorMessage(err)}`)
        }
      })

    return () => {
      cancelled = true
      clearReconnectTimer()
      connectingRef.current = false

      // Usa a referência local para não desconectar um player criado por uma
      // inicialização mais nova (StrictMode/recarregamento do SDK).
      const current = localPlayerRef.current
      localPlayerRef.current = null
      if (playerRef.current === current) playerRef.current = null
      deviceIdRef.current = null
      // Invalida um apply/start antigo; o próximo player começa do zero.
      loadSeqRef.current += 1
      startingUriRef.current = null
      startingPromiseRef.current = null
      startedUriRef.current = null
      setIsReady(false)
      updatePlaying(false)

      if (current) {
        try {
          current.disconnect()
        } catch {
          // Player já removido.
        }
      }

      // O novo player terá outro elemento de áudio; exige novo gesto.
      audioUnlockedRef.current = false
      activationPromiseRef.current = null
    }
  }, [
    clearFatalPlayback,
    clearReconnectTimer,
    getDrmProbe,
    markFatalPlayback,
    maybeFinish,
    sdkReloadToken,
    setNeedsAudioActivation,
    spotifyConnected,
    updatePlaying,
  ])

  // Pré-checagem de DRM/EME no mobile. Se o aparelho não criar MediaKeys,
  // não adianta tentar autoplay repetidamente: o problema é o pipeline de
  // áudio protegido, não o gesto do usuário.
  useEffect(() => {
    if (!runtimeIsAndroid() || spotifyConnected !== true) return

    let cancelled = false
    void getDrmProbe().then((results) => {
      if (cancelled) return
      if (drmWorks(results)) return

      setError((current) => current || SPOTIFY_DRM_MESSAGE)
      setErrorDetail((current) => current || `DRM: ${drmProbeSummary(results)}`)
      setNeedsAudioActivation(false)
      markFatalPlayback('drm_probe')
    })

    return () => {
      cancelled = true
    }
  }, [getDrmProbe, markFatalPlayback, setNeedsAudioActivation, spotifyConnected])

  // Qualquer toque/clique/tecla pode liberar o áudio no mobile. Também
  // aproveitamos o primeiro gesto para tentar registrar o dispositivo, caso
  // o connect() automático tenha sido bloqueado pelo navegador.
  useEffect(() => {
    if (spotifyConnected !== true) return

    let lastAttempt = 0
    const unlock = () => {
      if (!deviceIdRef.current) {
        void connectPlayer()
      }
      if (audioUnlockedRef.current) return

      const now = Date.now()
      if (now - lastAttempt < 1500) return
      lastAttempt = now
      void activateAudio()
    }

    window.addEventListener('pointerdown', unlock, true)
    window.addEventListener('keydown', unlock, true)
    window.addEventListener('touchstart', unlock, { capture: true, passive: true })

    return () => {
      window.removeEventListener('pointerdown', unlock, true)
      window.removeEventListener('keydown', unlock, true)
      window.removeEventListener('touchstart', unlock, true)
    }
  }, [activateAudio, connectPlayer, spotifyConnected])

  // Sincroniza com o estado real da fila no backend.
  const refresh = useCallback(async () => {
    if (syncInFlightRef.current) return
    syncInFlightRef.current = true

    try {
      const response = await apiMusic.status()
      if (!response.success || !response.data) return

      const data = response.data

      if (
        Date.now() - volumeChangedAtRef.current > 2000 &&
        volumeRef.current !== data.volume
      ) {
        updateVolume(data.volume)
        void playerRef.current?.setVolume(data.volume / 100).catch(() => {})
      }

      const canAuto =
        spotifyConnected === true &&
        canAutoPlayNow() &&
        !fatalPlaybackRef.current

      if (data.currentTrack) {
        const current = data.currentTrack
        const uri = current.providerId ? spotifyTrackUri(current.providerId) : null
        const changed =
          trackRef.current?.id !== current.id || loadedUriRef.current !== uri

        if (changed) {
          applyTrack(current, data.isPlaying && canAuto)
          if (
            data.isPlaying &&
            !canAuto &&
            spotifyConnected === true &&
            !fatalPlaybackRef.current
          ) {
            // O servidor achava que estava tocando, mas este navegador não
            // pode iniciar áudio sem um gesto. Alinha o estado para a UI e a
            // fila não ficarem "tocando" sem som.
            pauseServerForActivation()
            setNeedsAudioActivation(true)
          }
        } else {
          updateTrack(current)

          if (data.isPlaying && !isPlayingRef.current && uri) {
            if (canAuto && deviceIdRef.current) {
              void startUri(uri)
                .then(() => {
                  if (loadedUriRef.current !== uri) return
                  startedUriRef.current = uri
                  updatePlaying(true)
                  setNeedsAudioActivation(false)
                })
                .catch((err) => {
                  if (loadedUriRef.current !== uri) return
                  const info = toPlaybackErrorInfo(err, isMobileRef.current)
                  if (info.needsActivation) {
                    setNeedsAudioActivation(true)
                  } else {
                    markFatalPlayback(info.detail || info.message)
                  }
                  setError(info.message)
                  setErrorDetail(info.detail)
                })
            } else if (!deviceIdRef.current) {
              // Aguarda o evento `ready`; tentar agora geraria um 404 de
              // dispositivo inexistente no mobile.
            } else if (spotifyConnected === true && !fatalPlaybackRef.current) {
              pauseServerForActivation()
              setNeedsAudioActivation(true)
            }
          } else if (
            !data.isPlaying &&
            isPlayingRef.current &&
            Date.now() - lastUserPlayAtRef.current > 10_000
          ) {
            void playerRef.current?.pause().catch(() => {})
            updatePlaying(false)
          }

          if (current.durationMs) setDurationMs(current.durationMs)
        }
      } else if (trackRef.current) {
        applyTrack(null, false)
      }

      if (
        spotifyConnected === true &&
        !data.currentTrack &&
        data.autoPlay &&
        data.hasPending &&
        !fatalPlaybackRef.current &&
        !autoPlayInFlightRef.current &&
        Date.now() - lastAutoPlayAttemptRef.current > 5000
      ) {
        lastAutoPlayAttemptRef.current = Date.now()
        autoPlayInFlightRef.current = true

        try {
          const playResponse = await apiMusic.play()
          const next = playResponse.data?.track ?? null
          if (next) {
            applyTrack(next, canAuto)
            if (!canAuto) {
              pauseServerForActivation()
              setNeedsAudioActivation(true)
            }
          }
        } catch (err) {
          const info = toPlaybackErrorInfo(err, isMobileRef.current)
          setError(info.message)
          setErrorDetail(info.detail)
        } finally {
          autoPlayInFlightRef.current = false
        }
      }
    } catch {
      // Falhas temporárias de rede não devem interromper o áudio já carregado.
    } finally {
      syncInFlightRef.current = false
    }
  }, [
    applyTrack,
    canAutoPlayNow,
    markFatalPlayback,
    pauseServerForActivation,
    setNeedsAudioActivation,
    spotifyConnected,
    startUri,
    updatePlaying,
    updateTrack,
    updateVolume,
  ])

  useEffect(() => {
    refreshRef.current = refresh
  }, [refresh])

  useEffect(() => {
    void refresh()
    const interval = window.setInterval(() => {
      void refresh()
    }, 4000)
    return () => window.clearInterval(interval)
  }, [refresh])

  // Ao voltar de segundo plano (muito comum no celular), atualiza o estado e
  // tenta reconectar o dispositivo se o Spotify o removeu enquanto a aba
  // estava suspensa. Se a conexão ainda não foi confirmada, reconsulta o
  // status (o usuário pode ter conectado o Spotify em outra aba).
  useEffect(() => {
    const handleVisible = () => {
      if (document.visibilityState !== 'visible') return

      if (spotifyConnected !== true) {
        setStatusReloadToken((value) => value + 1)
        return
      }

      void refreshRef.current()
      if (!deviceIdRef.current) {
        // Ao voltar para a aba, damos uma nova rodada de tentativas.
        connectAttemptRef.current = 0
        scheduleReconnectRef.current()
      }
    }

    document.addEventListener('visibilitychange', handleVisible)
    window.addEventListener('online', handleVisible)

    return () => {
      document.removeEventListener('visibilitychange', handleVisible)
      window.removeEventListener('online', handleVisible)
    }
  }, [spotifyConnected])

  // Posição, duração e fim de faixa vêm do player oficial.
  useEffect(() => {
    const interval = window.setInterval(() => {
      const player = playerRef.current
      if (!player) return

      void player
        .getCurrentState()
        .then((state) => {
          if (!state) return
          setPositionMs(state.position)
          setDurationMs(state.duration)
          if (!state.paused) {
            const stateUri = state.track_window?.current_track?.uri
            if (stateUri) startedUriRef.current = stateUri
            audioUnlockedRef.current = true
            setNeedsAudioActivation(false)
          }
          // O polling corrige a UI mesmo quando o evento
          // player_state_changed é atrasado/suspenso no celular.
          updatePlaying(!state.paused)
          maybeFinish(state)
        })
        .catch(() => {
          // Player ainda não pronto.
        })
    }, 1000)

    return () => window.clearInterval(interval)
  }, [maybeFinish, setNeedsAudioActivation, updatePlaying])

  const playTrack = useCallback(
    async (target: MusicTrack) => {
      if (target.provider !== 'spotify' || !target.providerId) {
        setError('Este item não tem uma faixa do Spotify configurada.')
        return
      }

      clearFatalPlayback()
      setError(null)
      setErrorDetail(null)
      lastUserPlayAtRef.current = Date.now()
      // Precisa ser síncrono, ainda dentro do gesto do usuário.
      const activation = activateAudio(true)

      try {
        const response = await apiMusic.play({ trackId: target.id })
        const next = response.data?.track ?? target
        await activation.catch(() => false)
        applyTrack(next, true)
      } catch (err) {
        // A faixa atual pode continuar tocando; não force o ícone para pausado.
        const info = toPlaybackErrorInfo(err, isMobileRef.current)
        if (info.needsActivation) {
          setNeedsAudioActivation(true)
        } else {
          markFatalPlayback(info.detail || info.message)
        }
        setError(info.message)
        setErrorDetail(info.detail)
      }
    },
    [
      activateAudio,
      applyTrack,
      clearFatalPlayback,
      markFatalPlayback,
      setNeedsAudioActivation,
    ]
  )

  const togglePlay = useCallback(async () => {
    // Também precisa ser síncrono: é o gesto que libera o áudio no iOS.
    const activation = activateAudio(true)
    clearFatalPlayback()
    setError(null)
    setErrorDetail(null)

    try {
      if (isPlayingRef.current) {
        await apiMusic.pause()
        await playerRef.current?.pause().catch(() => {})
        updatePlaying(false)
        return
      }

      lastUserPlayAtRef.current = Date.now()
      const current = trackRef.current
      const loadedUri = loadedUriRef.current
      if (current && loadedUri) {
        // Confirma a prioridade no servidor antes de retomar o áudio local.
        await apiMusic.play({ trackId: current.id })
        await activation.catch(() => false)

        // `resume()` só faz sentido se este mesmo URI já foi realmente
        // iniciado e está pausado no meio. No primeiro play do celular (ou
        // após erro/reconexão) o SDK não tem faixa carregada; aí é preciso
        // enviar o play com a URI, senão o botão mudaria para "tocando" sem
        // áudio nenhum.
        const player = playerRef.current
        const canResume =
          startedUriRef.current === loadedUri &&
          (lastPositionRef.current > 0 || isPlayingRef.current)

        if (player && canResume) {
          try {
            await player.resume()
            startedUriRef.current = loadedUri
            endedUriRef.current = null
            updatePlaying(true)
            setNeedsAudioActivation(false)
            return
          } catch {
            // O estado do Connect pode ter sido perdido (troca de aba,
            // reconexão). Cai para iniciar a faixa do começo.
          }
        }

        await startUri(loadedUri)
        startedUriRef.current = loadedUri
        endedUriRef.current = null
        updatePlaying(true)
        setNeedsAudioActivation(false)
        return
      }

      const response = await apiMusic.play()
      const next = response.data?.track ?? null
      if (next) {
        await activation.catch(() => false)
        applyTrack(next, true)
      } else {
        setError('Nenhuma música do Spotify na fila para tocar.')
      }
    } catch (err) {
      const info = toPlaybackErrorInfo(err, isMobileRef.current)
      if (info.needsActivation) setNeedsAudioActivation(true)
      setError(info.message)
      setErrorDetail(info.detail)
    }
  }, [
    activateAudio,
    applyTrack,
    clearFatalPlayback,
    setNeedsAudioActivation,
    startUri,
    updatePlaying,
  ])

  const next = useCallback(async () => {
    clearFatalPlayback()
    setError(null)
    setErrorDetail(null)
    lastUserPlayAtRef.current = Date.now()
    void activateAudio(true)

    try {
      const response = await apiMusic.next()
      const nextTrack = response.data?.track ?? null
      if (nextTrack) {
        applyTrack(nextTrack, true)
      } else {
        applyTrack(null, false)
      }
    } catch (err) {
      const info = toPlaybackErrorInfo(err, isMobileRef.current)
      if (info.needsActivation) {
        setNeedsAudioActivation(true)
      } else {
        markFatalPlayback(info.detail || info.message)
      }
      setError(info.message)
      setErrorDetail(info.detail)
    }
  }, [
    activateAudio,
    applyTrack,
    clearFatalPlayback,
    markFatalPlayback,
    setNeedsAudioActivation,
  ])

  const previous = useCallback(async () => {
    clearFatalPlayback()
    setError(null)
    setErrorDetail(null)
    lastUserPlayAtRef.current = Date.now()
    void activateAudio(true)

    try {
      const response = await apiQueue.previous()
      const previousTrack = (response.data?.track ?? null) as MusicTrack | null
      if (previousTrack) {
        applyTrack(previousTrack, true)
      }
    } catch (err) {
      const info = toPlaybackErrorInfo(err, isMobileRef.current)
      if (info.needsActivation) {
        setNeedsAudioActivation(true)
      } else {
        markFatalPlayback(info.detail || info.message)
      }
      setError(info.message)
      setErrorDetail(info.detail)
    }
  }, [
    activateAudio,
    applyTrack,
    clearFatalPlayback,
    markFatalPlayback,
    setNeedsAudioActivation,
  ])

  const changeVolume = useCallback(
    (value: number) => {
      const nextVolume = Math.max(0, Math.min(100, Math.round(value)))
      volumeChangedAtRef.current = Date.now()
      updateVolume(nextVolume)
      void playerRef.current?.setVolume(nextVolume / 100).catch(() => {})

      if (volumeDebounceRef.current) window.clearTimeout(volumeDebounceRef.current)
      volumeDebounceRef.current = window.setTimeout(() => {
        void apiMusic.volume(nextVolume).catch(() => {
          // Preferência local continua válida mesmo se a persistência falhar.
        })
      }, 400)
    },
    [updateVolume]
  )

  const reconnect = useCallback(async () => {
    clearFatalPlayback()
    setError(null)
    setErrorDetail(null)
    lastActivationErrorRef.current = null
    // O usuário pode ter atualizado o Chrome/WebView ou mudado permissões de
    // conteúdo protegido; refaz o probe em vez de reutilizar um resultado velho.
    drmProbeRef.current = null
    setDrmSummary(null)
    // O botão "Tentar novamente" é um gesto do usuário: aproveitamos para
    // liberar o áudio no mobile antes de sincronizar com o servidor.
    const activation = activateAudio(true)
    connectAttemptRef.current = 0
    clearReconnectTimer()

    if (spotifyConnected !== true) {
      setStatusReloadToken((value) => value + 1)
      return
    }

    if (!playerRef.current) {
      // O SDK não chegou a inicializar (script bloqueado, por exemplo).
      // Recria o player do zero.
      setSdkReloadToken((value) => value + 1)
      return
    }

    if (!deviceIdRef.current) {
      const connected = await connectPlayer()
      if (!connected) {
        setError(
          'Não foi possível reconectar o player do Spotify. Tentando novamente...'
        )
        scheduleReconnectRef.current()
        return
      }
    }

    await activation.catch(() => false)

    // Se o DRM do aparelho realmente não cria MediaKeys, não adianta tentar
    // tocar: mostra a causa e para os retries automáticos.
    if (runtimeIsAndroid()) {
      const drm = await getDrmProbe()
      if (!drmWorks(drm)) {
        setError(SPOTIFY_DRM_MESSAGE)
        setErrorDetail(`DRM: ${drmProbeSummary(drm)}`)
        setNeedsAudioActivation(false)
        markFatalPlayback('drm_reconnect')
        return
      }
    }

    await refreshRef.current()
  }, [
    activateAudio,
    clearFatalPlayback,
    clearReconnectTimer,
    connectPlayer,
    getDrmProbe,
    markFatalPlayback,
    setNeedsAudioActivation,
    spotifyConnected,
  ])

  /**
   * Relatório técnico manual. Não roda no polling e não expõe tokens.
   * Faz no máximo: 1 refresh de token, 1 status, 1 devices, 1 player atual.
   */
  const diagnose = useCallback(async (): Promise<string> => {
    if (diagnosticsInFlightRef.current) return diagnosticsInFlightRef.current

    const run = async (): Promise<string> => {
      const userAgentData = (
        navigator as Navigator & { userAgentData?: { mobile?: boolean } }
      ).userAgentData

      const report: Record<string, unknown> = {
        build: 'pixtune-mobile-diagnostic-2026-11-10',
        generatedAt: new Date().toISOString(),
        browser: {
          userAgent: navigator.userAgent,
          platform: navigator.platform,
          language: navigator.language,
          online: navigator.onLine,
          visibility: document.visibilityState,
          secureContext: window.isSecureContext,
          mobile: isMobileRef.current,
          userAgentMobile: userAgentData?.mobile ?? null,
          maxTouchPoints: navigator.maxTouchPoints,
          coarsePointer:
            typeof window.matchMedia === 'function'
              ? window.matchMedia('(pointer: coarse)').matches
              : null,
          viewport: {
            width: window.innerWidth,
            height: window.innerHeight,
            devicePixelRatio: window.devicePixelRatio,
          },
        },
        player: {
          sdkLoaded: Boolean(playerRef.current),
          ready: isReady,
          spotifyConnected,
          deviceIdPrefix: deviceIdRef.current
            ? deviceIdRef.current.slice(0, 8)
            : null,
          audioUnlocked: audioUnlockedRef.current,
          needsActivation: needsActivationRef.current,
          lastActivationError: lastActivationErrorRef.current,
          error,
          errorDetail,
          accountError,
          fatalPlayback: fatalPlaybackRef.current,
          drmSummary,
          track: trackRef.current
            ? {
                id: trackRef.current.id,
                provider: trackRef.current.provider,
                providerId: trackRef.current.providerId,
                uri: loadedUriRef.current,
              }
            : null,
          startedUri: startedUriRef.current,
        },
        drm: await getDrmProbe(),
      }

      try {
        const status = await apiSpotify.status()
        report.spotifyStatus = status.success
          ? status.data
          : { error: status.error }
      } catch (error) {
        report.spotifyStatusError = errorMessage(error)
      }

      try {
        await fetchSpotifyToken(true)
        report.tokenRefresh = 'ok'
      } catch (error) {
        report.tokenRefreshError = errorMessage(error)
      }

      try {
        const response = await spotifyApiFetch('/me/player/devices')
        if (response.ok) {
          const body = (await response.json()) as {
            devices?: Array<Record<string, unknown>>
          }
          report.devices = (body.devices || []).map((device) => ({
            idPrefix:
              typeof device.id === 'string' ? device.id.slice(0, 8) : null,
            name: device.name ?? null,
            type: device.type ?? null,
            isActive: device.is_active ?? null,
            isRestricted: device.is_restricted ?? null,
            volumePercent: device.volume_percent ?? null,
          }))
        } else {
          report.devicesError = `HTTP ${response.status}: ${(
            await response.text().catch(() => '')
          ).slice(0, 300)}`
        }
      } catch (error) {
        report.devicesError = errorMessage(error)
      }

      try {
        const response = await spotifyApiFetch('/me/player')
        if (response.status === 204) {
          report.currentPlayback = null
        } else if (response.ok) {
          const body = (await response.json()) as {
            device?: Record<string, unknown> | null
            is_playing?: boolean
            progress_ms?: number
            item?: Record<string, unknown> | null
            actions?: unknown
          }
          report.currentPlayback = {
            device: body.device
              ? {
                  idPrefix:
                    typeof body.device.id === 'string'
                      ? body.device.id.slice(0, 8)
                      : null,
                  name: body.device.name ?? null,
                  type: body.device.type ?? null,
                  isActive: body.device.is_active ?? null,
                  isRestricted: body.device.is_restricted ?? null,
                }
              : null,
            isPlaying: body.is_playing ?? null,
            progressMs: body.progress_ms ?? null,
            item: body.item
              ? {
                  type: body.item.type ?? null,
                  id: body.item.id ?? null,
                  uri: body.item.uri ?? null,
                  name: body.item.name ?? null,
                }
              : null,
            actions: body.actions ?? null,
          }
        } else {
          report.currentPlaybackError = `HTTP ${response.status}: ${(
            await response.text().catch(() => '')
          ).slice(0, 300)}`
        }
      } catch (error) {
        report.currentPlaybackError = errorMessage(error)
      }

      try {
        const state = await playerRef.current?.getCurrentState()
        report.localState = state
          ? {
              paused: state.paused,
              position: state.position,
              duration: state.duration,
              uri: state.track_window?.current_track?.uri ?? null,
            }
          : null
      } catch (error) {
        report.localStateError = errorMessage(error)
      }

      report.audioElements = Array.from(document.querySelectorAll('audio')).map(
        (audio) => ({
          paused: audio.paused,
          readyState: audio.readyState,
          muted: audio.muted,
          volume: audio.volume,
          error: audio.error?.message ?? null,
          srcPrefix: audio.src ? audio.src.slice(0, 80) : null,
        })
      )

      return JSON.stringify(report, null, 2)
    }

    const promise = run().finally(() => {
      diagnosticsInFlightRef.current = null
    })
    diagnosticsInFlightRef.current = promise
    return promise
  }, [
    accountError,
    drmSummary,
    error,
    errorDetail,
    getDrmProbe,
    isReady,
    spotifyConnected,
  ])

  useEffect(() => {
    return () => {
      if (volumeDebounceRef.current) window.clearTimeout(volumeDebounceRef.current)
      clearReconnectTimer()
    }
  }, [clearReconnectTimer])

  return (
    <AudioPlayerContext.Provider
      value={{
        track,
        isPlaying,
        isReady,
        isLoading,
        volume,
        positionMs,
        durationMs,
        error,
        errorDetail,
        accountError,
        needsAudioActivation,
        isMobile,
        playTrack,
        togglePlay,
        next,
        previous,
        setVolume: changeVolume,
        refresh,
        reconnect,
        diagnose,
      }}
    >
      {children}
    </AudioPlayerContext.Provider>
  )
}

export function useAudioPlayer() {
  const context = useContext(AudioPlayerContext)
  if (!context) {
    throw new Error('useAudioPlayer deve ser usado dentro de SpotifyAudioProvider')
  }
  return context
}
