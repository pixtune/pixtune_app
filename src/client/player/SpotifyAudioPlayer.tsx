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
import { spotifyTrackUri } from '@shared/spotify'

/**
 * Player oficial do Spotify usando o Web Playback SDK.
 *
 * O SDK cria um dispositivo Spotify Connect no navegador e entrega somente
 * áudio. O PixTune não baixa, extrai nem contorna a reprodução: o Spotify
 * continua sendo quem entrega o stream.
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

let sdkPromise: Promise<SpotifyNamespace> | null = null

function loadSpotifySdk(): Promise<SpotifyNamespace> {
  if (window.Spotify?.Player) return Promise.resolve(window.Spotify)
  if (sdkPromise) return sdkPromise

  sdkPromise = new Promise<SpotifyNamespace>((resolve, reject) => {
    const previousCallback = window.onSpotifyWebPlaybackSDKReady
    window.onSpotifyWebPlaybackSDKReady = () => {
      previousCallback?.()
      if (window.Spotify?.Player) resolve(window.Spotify)
    }

    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-pixtune-spotify-sdk]'
    )
    if (!existing) {
      const script = document.createElement('script')
      script.src = 'https://sdk.scdn.co/spotify-player.js'
      script.async = true
      script.dataset.pixtuneSpotifySdk = 'true'
      script.onerror = () => reject(new Error('Não foi possível carregar o player do Spotify'))
      document.head.appendChild(script)
    }

    const startedAt = Date.now()
    const check = window.setInterval(() => {
      if (window.Spotify?.Player) {
        window.clearInterval(check)
        resolve(window.Spotify)
      } else if (Date.now() - startedAt > 15000) {
        window.clearInterval(check)
        reject(new Error('Tempo esgotado ao carregar o player do Spotify'))
      }
    }, 250)
  }).catch((error) => {
    sdkPromise = null
    throw error
  })

  return sdkPromise
}

let tokenCache: { token: string; expiresAt: number } | null = null

async function fetchSpotifyToken(force = false): Promise<string> {
  if (!force && tokenCache && tokenCache.expiresAt > Date.now() + 60_000) {
    return tokenCache.token
  }

  const response = await apiSpotify.token()
  if (!response.success || !response.data?.accessToken) {
    throw new Error(response.error?.message || 'Conecte sua conta do Spotify nas configurações.')
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
  const response = await fetch(`https://api.spotify.com/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.headers || {}),
    },
  })

  if (response.status === 401 && retry) {
    tokenCache = null
    return spotifyApiFetch(path, init, false)
  }

  return response
}

async function transferPlayback(deviceId: string): Promise<void> {
  const response = await spotifyApiFetch('/me/player', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_ids: [deviceId], play: false }),
  })

  if (!response.ok && response.status !== 204 && response.status !== 404) {
    throw new Error('Não foi possível ativar o dispositivo PixTune no Spotify.')
  }
}

async function playSpotifyUri(deviceId: string, uri: string): Promise<void> {
  const request = () =>
    spotifyApiFetch(`/me/player/play?device_id=${encodeURIComponent(deviceId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uris: [uri] }),
    })

  let response = await request()

  if (response.status === 404) {
    await transferPlayback(deviceId)
    response = await request()
  }

  if (response.status === 403) {
    throw new Error(
      'O Spotify recusou a reprodução. Verifique se a conta tem Spotify Premium e se o app está autorizado.'
    )
  }

  if (!response.ok && response.status !== 204) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: { message?: string }
    }
    throw new Error(body.error?.message || `Spotify respondeu ${response.status}`)
  }
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
  playTrack: (track: MusicTrack) => Promise<void>
  togglePlay: () => Promise<void>
  next: () => Promise<void>
  previous: () => Promise<void>
  setVolume: (volume: number) => void
  refresh: () => Promise<void>
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
  const [spotifyConnected, setSpotifyConnected] = useState<boolean | null>(null)

  const playerRef = useRef<SpotifyPlayer | null>(null)
  const deviceIdRef = useRef<string | null>(null)
  const trackRef = useRef<MusicTrack | null>(null)
  const isPlayingRef = useRef(false)
  const volumeRef = useRef(70)
  const loadedUriRef = useRef<string | null>(null)
  const endedUriRef = useRef<string | null>(null)
  const syncInFlightRef = useRef(false)
  const autoPlayInFlightRef = useRef(false)
  const lastAutoPlayAttemptRef = useRef(0)
  const volumeChangedAtRef = useRef(0)
  const volumeDebounceRef = useRef<number | null>(null)
  const refreshRef = useRef<() => Promise<void>>(async () => {})
  const handleEndedRef = useRef<() => Promise<void>>(async () => {})

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

  const startSpotifyUri = useCallback(async (uri: string) => {
    const player = playerRef.current
    const deviceId = deviceIdRef.current
    if (!player || !deviceId) {
      throw new Error('Player do Spotify ainda não está pronto. Aguarde alguns segundos.')
    }

    await player.activateElement().catch(() => {
      // Em desktop o SDK costuma tocar sem esse gesto; em mobile ele é
      // necessário e será cobrado no primeiro clique do usuário.
    })
    await playSpotifyUri(deviceId, uri)
  }, [])

  const applyTrack = useCallback(
    (nextTrack: MusicTrack | null, autoplay: boolean) => {
      if (!nextTrack) {
        loadedUriRef.current = null
        endedUriRef.current = null
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
        updatePlaying(false)
        loadedUriRef.current = null
        return
      }

      const uri = spotifyTrackUri(nextTrack.providerId)
      const changed = loadedUriRef.current !== uri

      setError(null)
      updateTrack(nextTrack)
      setDurationMs(nextTrack.durationMs ?? 0)

      if (autoplay) {
        if (!changed && isPlayingRef.current) return
        loadedUriRef.current = uri
        endedUriRef.current = null
        setIsLoading(true)
        void startSpotifyUri(uri)
          .then(() => {
            setIsLoading(false)
            updatePlaying(true)
          })
          .catch((err) => {
            setIsLoading(false)
            updatePlaying(false)
            setError(err instanceof Error ? err.message : 'Não foi possível tocar no Spotify.')
          })
        return
      }

      loadedUriRef.current = uri
      if (isPlayingRef.current) {
        void playerRef.current?.pause().catch(() => {})
      }
      updatePlaying(false)
      setIsLoading(false)
    },
    [startSpotifyUri, updatePlaying, updateTrack]
  )

  const handleEnded = useCallback(async () => {
    try {
      const response = await apiMusic.ended()
      const next = response.data?.track ?? null
      if (next) {
        applyTrack(next, true)
      } else {
        applyTrack(null, false)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao avançar a fila')
      updatePlaying(false)
    }
  }, [applyTrack, updatePlaying])

  useEffect(() => {
    handleEndedRef.current = handleEnded
  }, [handleEnded])

  const maybeFinish = useCallback((state: SpotifyPlaybackState | null) => {
    if (!state || !state.duration) return

    const currentUri = loadedUriRef.current
    if (!currentUri) return
    if (state.position < state.duration - 1000) return
    if (endedUriRef.current === currentUri) return

    endedUriRef.current = currentUri
    void handleEndedRef.current()
  }, [])

  // Só carrega o SDK quando a conta já está conectada. Sem isso, o SDK
  // tentaria obter um token inexistente e o navegador exibiria um erro de DRM.
  useEffect(() => {
    let cancelled = false

    void apiSpotify
      .status()
      .then((response) => {
        if (cancelled) return
        if (!response.success || !response.data) {
          setSpotifyConnected(false)
          setError('Não foi possível verificar a conexão com o Spotify.')
          return
        }
        if (!response.data.configured) {
          setSpotifyConnected(false)
          setError('Spotify não configurado no servidor. Abra Configurações > Spotify.')
          return
        }
        if (!response.data.connected) {
          setSpotifyConnected(false)
          setError('Conecte sua conta do Spotify em Configurações > Spotify.')
          return
        }
        setSpotifyConnected(true)
        setError(null)
      })
      .catch(() => {
        if (!cancelled) {
          setSpotifyConnected(false)
          setError('Não foi possível verificar a conexão com o Spotify.')
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  // Reage à desconexão feita em Configurações sem exigir recarregar a página.
  useEffect(() => {
    const handleDisconnected = () => {
      tokenCache = null
      try {
        playerRef.current?.disconnect()
      } catch {
        // O player pode já ter sido removido.
      }
      playerRef.current = null
      deviceIdRef.current = null
      loadedUriRef.current = null
      endedUriRef.current = null
      syncInFlightRef.current = false
      autoPlayInFlightRef.current = false
      updateTrack(null)
      updatePlaying(false)
      setIsReady(false)
      setIsLoading(false)
      setSpotifyConnected(false)
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
  }, [updatePlaying, updateTrack])

  // Cria o dispositivo Spotify Connect no navegador.
  useEffect(() => {
    if (spotifyConnected !== true) return
    let cancelled = false

    loadSpotifySdk()
      .then((Spotify) => {
        if (cancelled) return

        const player = new Spotify.Player({
          name: 'PixTune',
          volume: volumeRef.current / 100,
          getOAuthToken: (callback) => {
            void fetchSpotifyToken()
              .then(callback)
              .catch((err) => {
                setError(
                  err instanceof Error
                    ? err.message
                    : 'Conecte sua conta do Spotify nas configurações.'
                )
              })
          },
        })

        playerRef.current = player

        player.addListener('ready', ({ device_id }: { device_id: string }) => {
          deviceIdRef.current = device_id
          setIsReady(true)
          setError(null)
          void player.setVolume(volumeRef.current / 100).catch(() => {})
          void refreshRef.current()
        })

        player.addListener('not_ready', () => {
          setIsReady(false)
          deviceIdRef.current = null
        })

        player.addListener('player_state_changed', (state: SpotifyPlaybackState | null) => {
          if (!state) return
          setPositionMs(state.position)
          setDurationMs(state.duration)
          updatePlaying(!state.paused)
          maybeFinish(state)
        })

        player.addListener('initialization_error', ({ message }: { message: string }) => {
          setError(message || 'Não foi possível inicializar o player do Spotify.')
        })
        player.addListener('authentication_error', ({ message }: { message: string }) => {
          tokenCache = null
          setError(
            message ||
              'Sessão do Spotify expirada. Reconecte a conta em Configurações > Spotify.'
          )
        })
        player.addListener('account_error', () => {
          setError('O Spotify exige uma conta Premium para usar o Web Playback SDK.')
        })
        player.addListener('playback_error', ({ message }: { message: string }) => {
          setError(message || 'Não foi possível reproduzir esta faixa.')
        })

        void player.connect().then((connected) => {
          if (!connected && !cancelled) {
            setError('Não foi possível conectar o dispositivo PixTune ao Spotify.')
          }
        })
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Erro ao carregar o player do Spotify')
        }
      })

    return () => {
      cancelled = true
      try {
        playerRef.current?.disconnect()
      } catch {
        // O player pode já ter sido removido.
      }
      playerRef.current = null
      deviceIdRef.current = null
      setIsReady(false)
    }
  }, [maybeFinish, spotifyConnected, updatePlaying])

  // Sincroniza com o estado real da fila no backend.
  const refresh = useCallback(async () => {
    if (syncInFlightRef.current) return
    syncInFlightRef.current = true

    try {
      const response = await apiMusic.status()
      if (!response.success || !response.data) return

      const data = response.data

      if (Date.now() - volumeChangedAtRef.current > 2000 && volumeRef.current !== data.volume) {
        updateVolume(data.volume)
        void playerRef.current?.setVolume(data.volume / 100).catch(() => {})
      }

      if (data.currentTrack) {
        const current = data.currentTrack
        const uri = current.providerId ? spotifyTrackUri(current.providerId) : null
        const changed = trackRef.current?.id !== current.id || loadedUriRef.current !== uri

        if (changed) {
          applyTrack(current, data.isPlaying)
        } else {
          updateTrack(current)
          if (data.isPlaying && !isPlayingRef.current && uri) {
            void startSpotifyUri(uri)
              .then(() => updatePlaying(true))
              .catch(() => {
                // O navegador pode exigir um clique; o erro fica visível.
              })
          } else if (!data.isPlaying && isPlayingRef.current) {
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
        !autoPlayInFlightRef.current &&
        Date.now() - lastAutoPlayAttemptRef.current > 5000
      ) {
        lastAutoPlayAttemptRef.current = Date.now()
        autoPlayInFlightRef.current = true
        try {
          const playResponse = await apiMusic.play()
          const next = playResponse.data?.track ?? null
          if (next) applyTrack(next, true)
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
    spotifyConnected,
    startSpotifyUri,
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
          maybeFinish(state)
        })
        .catch(() => {
          // Player ainda não pronto.
        })
    }, 1000)

    return () => window.clearInterval(interval)
  }, [maybeFinish])

  // Confere Premium e conexão sem impedir o restante da interface.
  useEffect(() => {
    void apiSpotify
      .status()
      .then((response) => {
        if (!response.data?.connected) return
        if (!response.data.premium) {
          setError('O Spotify exige uma conta Premium para usar o Web Playback SDK.')
        }
      })
      .catch(() => {
        // O erro real aparecerá quando o player tentar obter o token.
      })
  }, [])

  const playTrack = useCallback(
    async (target: MusicTrack) => {
      if (target.provider !== 'spotify' || !target.providerId) {
        setError('Este item não tem uma faixa do Spotify configurada.')
        return
      }

      setError(null)
      void playerRef.current?.activateElement().catch(() => {})

      try {
        const response = await apiMusic.play({ trackId: target.id })
        const next = response.data?.track ?? target
        applyTrack(next, true)
      } catch (err) {
        // A faixa atual pode continuar tocando; não force o ícone para pausado.
        setError(err instanceof Error ? err.message : 'Erro ao tocar a música')
      }
    },
    [applyTrack]
  )

  const togglePlay = useCallback(async () => {
    void playerRef.current?.activateElement().catch(() => {})

    try {
      if (isPlayingRef.current) {
        await apiMusic.pause()
        await playerRef.current?.pause().catch(() => {})
        updatePlaying(false)
        return
      }

      const current = trackRef.current
      if (current && loadedUriRef.current) {
        // Confirma a prioridade no servidor antes de retomar o áudio local.
        await apiMusic.play({ trackId: current.id })
        try {
          await playerRef.current?.resume()
        } catch {
          await startSpotifyUri(loadedUriRef.current)
        }
        updatePlaying(true)
        return
      }

      const response = await apiMusic.play()
      const next = response.data?.track ?? null
      if (next) {
        applyTrack(next, true)
      } else {
        setError('Nenhuma música do Spotify na fila para tocar.')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao controlar a reprodução')
    }
  }, [applyTrack, startSpotifyUri, updatePlaying])

  const next = useCallback(async () => {
    setError(null)
    try {
      const response = await apiMusic.next()
      const nextTrack = response.data?.track ?? null
      if (nextTrack) {
        applyTrack(nextTrack, true)
      } else {
        applyTrack(null, false)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao pular a música')
    }
  }, [applyTrack])

  const previous = useCallback(async () => {
    setError(null)
    try {
      const response = await apiQueue.previous()
      const previousTrack = (response.data?.track ?? null) as MusicTrack | null
      if (previousTrack) {
        applyTrack(previousTrack, true)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao voltar a música')
    }
  }, [applyTrack])

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

  useEffect(() => {
    return () => {
      if (volumeDebounceRef.current) window.clearTimeout(volumeDebounceRef.current)
    }
  }, [])

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
        playTrack,
        togglePlay,
        next,
        previous,
        setVolume: changeVolume,
        refresh,
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
