import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { apiMusic, apiQueue, type MusicTrack } from '@client/api/client'
import { extractYouTubeId } from '@shared/youtube'

/**
 * Player de áudio do YouTube.
 *
 * Usa exclusivamente a IFrame Player API oficial. O vídeo fica em um
 * contêiner fora da tela; o usuário ouve apenas o áudio. Nenhum áudio é
 * baixado, extraído ou contornado: o YouTube continua sendo quem entrega
 * o stream para o navegador.
 */

interface YTPlayer {
  destroy(): void
  playVideo(): void
  pauseVideo(): void
  stopVideo(): void
  cueVideoById(videoId: string): void
  loadVideoById(videoId: string): void
  setVolume(volume: number): void
  getVolume(): number
  getPlayerState(): number
  getCurrentTime(): number
  getDuration(): number
}

interface YTPlayerEvent {
  target: YTPlayer
  data: number
}

interface YTPlayerOptions {
  height: string
  width: string
  playerVars: Record<string, string | number>
  events: {
    onReady: () => void
    onStateChange: (event: YTPlayerEvent) => void
    onError: (event: YTPlayerEvent) => void
  }
}

interface YTNamespace {
  Player: new (element: HTMLElement, options: YTPlayerOptions) => YTPlayer
}

declare global {
  interface Window {
    YT?: YTNamespace
    onYouTubeIframeAPIReady?: () => void
  }
}

let apiPromise: Promise<YTNamespace> | null = null

function loadYouTubeIframeApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT)
  if (apiPromise) return apiPromise

  apiPromise = new Promise<YTNamespace>((resolve, reject) => {
    const previousCallback = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      previousCallback?.()
      if (window.YT?.Player) resolve(window.YT)
    }

    const existing = document.querySelector<HTMLScriptElement>('script[data-pixtune-youtube-api]')
    if (!existing) {
      const script = document.createElement('script')
      script.src = 'https://www.youtube.com/iframe_api'
      script.async = true
      script.dataset.pixtuneYoutubeApi = 'true'
      script.onerror = () => reject(new Error('Não foi possível carregar o player do YouTube'))
      document.head.appendChild(script)
    }

    // Fallback caso o script já tenha sido carregado por outro player.
    const startedAt = Date.now()
    const check = window.setInterval(() => {
      if (window.YT?.Player) {
        window.clearInterval(check)
        resolve(window.YT)
      } else if (Date.now() - startedAt > 15000) {
        window.clearInterval(check)
        reject(new Error('Tempo esgotado ao carregar o player do YouTube'))
      }
    }, 250)
  }).catch((err) => {
    apiPromise = null
    throw err
  })

  return apiPromise
}

function errorMessage(code: number): string {
  switch (code) {
    case 2:
      return 'Não foi possível iniciar o vídeo automaticamente. Clique em play; se o problema continuar, verifique o link.'
    case 5:
      return 'O navegador não conseguiu reproduzir este vídeo.'
    case 100:
      return 'Vídeo não encontrado ou removido do YouTube.'
    case 101:
    case 150:
      return 'Este vídeo não permite reprodução incorporada.'
    default:
      return 'Não foi possível reproduzir este vídeo do YouTube.'
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

export function YouTubeAudioProvider({ children }: { children: ReactNode }) {
  const [track, setTrack] = useState<MusicTrack | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [isReady, setIsReady] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [volume, setVolume] = useState(70)
  const [positionMs, setPositionMs] = useState(0)
  const [durationMs, setDurationMs] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const mountRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<YTPlayer | null>(null)
  const trackRef = useRef<MusicTrack | null>(null)
  const isPlayingRef = useRef(false)
  const volumeRef = useRef(70)
  const loadedIdRef = useRef<string | null>(null)
  const syncInFlightRef = useRef(false)
  const autoPlayInFlightRef = useRef(false)
  const lastAutoPlayAttemptRef = useRef(0)
  const volumeChangedAtRef = useRef(0)
  const volumeDebounceRef = useRef<number | null>(null)
  const durationReportedRef = useRef<string | null>(null)
  const onEndedRef = useRef<() => void>(() => {})
  const onErrorRef = useRef<(code: number) => void>(() => {})

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

  /**
   * Carrega uma faixa no player. `autoplay` deve ser true quando a intenção
   * do backend é tocar; false apenas deixa o vídeo pausado/pronto.
   */
  const applyTrack = useCallback(
    (nextTrack: MusicTrack | null, autoplay: boolean) => {
      const player = playerRef.current

      if (!nextTrack) {
        if (player) player.stopVideo()
        loadedIdRef.current = null
        updatePlaying(false)
        updateTrack(null)
        setPositionMs(0)
        setDurationMs(0)
        setIsLoading(false)
        return
      }

      const videoId = nextTrack.providerId ? extractYouTubeId(nextTrack.providerId) : null
      if (!videoId) {
        setError('Esta faixa não tem um vídeo do YouTube configurado.')
        updatePlaying(false)
        if (player) player.stopVideo()
        loadedIdRef.current = null
        return
      }

      setError(null)
      updateTrack(nextTrack)

      if (!player) {
        // O onReady aplicará a faixa quando o player terminar de carregar.
        updatePlaying(autoplay)
        return
      }

      if (loadedIdRef.current !== videoId) {
        loadedIdRef.current = videoId
        setPositionMs(0)
        setDurationMs(nextTrack.durationMs ?? 0)
        setIsLoading(true)
        if (autoplay) {
          player.loadVideoById(videoId)

          // Alguns navegadores bloqueiam autoplay sem gesto do usuário.
          window.setTimeout(() => {
            if (!playerRef.current || loadedIdRef.current !== videoId) return
            const state = playerRef.current.getPlayerState()
            if (state !== 1 && state !== 3) {
              updatePlaying(false)
              setError('O navegador bloqueou a reprodução automática. Clique em play para iniciar o áudio.')
            }
          }, 4000)
        } else {
          player.cueVideoById(videoId)
        }
      } else if (autoplay) {
        player.playVideo()
      } else {
        player.pauseVideo()
      }

      updatePlaying(autoplay)
    },
    [updatePlaying, updateTrack]
  )

  const applyTrackRef = useRef(applyTrack)
  useEffect(() => {
    applyTrackRef.current = applyTrack
  }, [applyTrack])

  const handleEnded = useCallback(async () => {
    try {
      const res = await apiMusic.ended()
      const next = res.data?.track ?? null
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
    onEndedRef.current = () => {
      void handleEnded()
    }
  }, [handleEnded])

  const handlePlayerError = useCallback(
    (code: number) => {
      setError(errorMessage(code))
      updatePlaying(false)
      setIsLoading(false)
    },
    [updatePlaying]
  )

  useEffect(() => {
    onErrorRef.current = handlePlayerError
  }, [handlePlayerError])

  // Cria o player oficial em um contêiner fora da tela (áudio apenas).
  useEffect(() => {
    let cancelled = false
    const mount = mountRef.current
    if (!mount) return

    const holder = document.createElement('div')
    mount.appendChild(holder)
    loadedIdRef.current = null
    setIsReady(false)

    loadYouTubeIframeApi()
      .then((YT) => {
        if (cancelled) {
          holder.remove()
          return
        }

        playerRef.current = new YT.Player(holder, {
          height: '180',
          width: '320',
          playerVars: {
            autoplay: 0,
            controls: 0,
            disablekb: 1,
            fs: 0,
            modestbranding: 1,
            rel: 0,
            playsinline: 1,
            // O player é incorporado a partir de www.youtube.com (host padrão,
            // nunca youtube-nocookie.com). Assim, quando o navegador permite
            // cookies de terceiros do youtube.com e existe uma conta logada, o
            // próprio YouTube aplica os benefícios dela na reprodução — por
            // exemplo, Premium sem anúncios e vídeos com restrição de idade.
            // O PixTune não acessa, não lê e não controla essa sessão.
            origin: window.location.origin,
            widget_referrer: window.location.origin,
          },
          events: {
            onReady: () => {
              if (cancelled || !playerRef.current) return
              setIsReady(true)
              playerRef.current.setVolume(volumeRef.current)
              applyTrackRef.current(trackRef.current, isPlayingRef.current)
            },
            onStateChange: (event) => {
              switch (event.data) {
                case 0: // ENDED
                  updatePlaying(false)
                  onEndedRef.current()
                  break
                case 1: // PLAYING
                  setError(null)
                  setIsLoading(false)
                  updatePlaying(true)
                  break
                case 2: // PAUSED
                  updatePlaying(false)
                  setIsLoading(false)
                  break
                case 3: // BUFFERING
                  setIsLoading(true)
                  break
                case 5: // CUED
                  setIsLoading(false)
                  break
                default:
                  break
              }
            },
            onError: (event) => {
              onErrorRef.current(event.data)
            },
          },
        })
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Erro ao carregar o player do YouTube')
        }
      })

    return () => {
      cancelled = true
      try {
        playerRef.current?.destroy()
      } catch {
        // O iframe pode já ter sido removido pelo React.
      }
      playerRef.current = null
      loadedIdRef.current = null
      setIsReady(false)
      holder.remove()
    }
  }, [updatePlaying])

  // Sincroniza com o estado real da fila no backend.
  const refresh = useCallback(async () => {
    if (syncInFlightRef.current) return
    syncInFlightRef.current = true

    try {
      const res = await apiMusic.status()
      if (!res.success || !res.data) return

      const data = res.data

      if (Date.now() - volumeChangedAtRef.current > 2000 && volumeRef.current !== data.volume) {
        updateVolume(data.volume)
        playerRef.current?.setVolume(data.volume)
      }

      if (data.currentTrack) {
        const current = data.currentTrack
        const currentVideoId = current.providerId ? extractYouTubeId(current.providerId) : null
        const changed =
          trackRef.current?.id !== current.id || loadedIdRef.current !== currentVideoId

        if (changed) {
          applyTrack(current, data.isPlaying)
        } else {
          updateTrack(current)
          const player = playerRef.current
          if (player) {
            const state = player.getPlayerState()
            if (data.isPlaying && state !== 1 && state !== 3) player.playVideo()
            if (!data.isPlaying && state === 1) player.pauseVideo()
            if (state === 1 || state === 3) updatePlaying(true)
            else if (state === 2) updatePlaying(false)
          }
          if (current.durationMs) setDurationMs(current.durationMs)
        }
      } else if (trackRef.current) {
        applyTrack(null, false)
      }

      if (
        !data.currentTrack &&
        data.autoPlay &&
        data.hasPending &&
        !autoPlayInFlightRef.current &&
        Date.now() - lastAutoPlayAttemptRef.current > 5000
      ) {
        lastAutoPlayAttemptRef.current = Date.now()
        autoPlayInFlightRef.current = true
        try {
          const playRes = await apiMusic.play()
          const next = playRes.data?.track ?? null
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
  }, [applyTrack, updateTrack, updatePlaying, updateVolume])

  useEffect(() => {
    void refresh()
    const interval = window.setInterval(() => {
      void refresh()
    }, 4000)
    return () => window.clearInterval(interval)
  }, [refresh])

  // Posição e duração vêm do player oficial.
  useEffect(() => {
    const interval = window.setInterval(() => {
      const player = playerRef.current
      if (!player) return

      try {
        const duration = player.getDuration()
        if (duration > 0) {
          const ms = Math.round(duration * 1000)
          setDurationMs((previous) => (Math.abs(previous - ms) > 1000 ? ms : previous))

          const current = trackRef.current
          if (current && !current.durationMs && durationReportedRef.current !== current.id) {
            durationReportedRef.current = current.id
            void apiMusic.duration(current.id, ms).catch(() => {
              // Metadado auxiliar; uma falha não impede a reprodução.
            })
          }
        }

        if (player.getPlayerState() === 1) {
          updatePlaying(true)
          setPositionMs(Math.round(player.getCurrentTime() * 1000))
        } else if (player.getPlayerState() === 2) {
          updatePlaying(false)
        }
      } catch {
        // Player ainda não pronto.
      }
    }, 1000)

    return () => window.clearInterval(interval)
  }, [updatePlaying])

  const playTrack = useCallback(
    async (target: MusicTrack) => {
      const videoId = target.providerId ? extractYouTubeId(target.providerId) : null
      if (!videoId) {
        setError('Este item não tem um vídeo do YouTube configurado.')
        return
      }

      setError(null)
      try {
        const res = await apiMusic.play({ trackId: target.id })
        const next = res.data?.track ?? target
        applyTrack(next, true)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erro ao tocar a música')
        updatePlaying(false)
      }
    },
    [applyTrack, updatePlaying]
  )

  const togglePlay = useCallback(async () => {
    try {
      if (isPlayingRef.current) {
        await apiMusic.pause()
        playerRef.current?.pauseVideo()
        updatePlaying(false)
        return
      }

      const current = trackRef.current
      if (current) {
        const res = await apiMusic.play({ trackId: current.id })
        applyTrack(res.data?.track ?? current, true)
        return
      }

      const res = await apiMusic.play()
      const next = res.data?.track ?? null
      if (next) {
        applyTrack(next, true)
      } else {
        setError('Nenhuma música do YouTube na fila para tocar.')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao controlar a reprodução')
      updatePlaying(false)
    }
  }, [applyTrack, updatePlaying])

  const next = useCallback(async () => {
    setError(null)
    try {
      const res = await apiMusic.next()
      const nextTrack = res.data?.track ?? null
      if (nextTrack) {
        applyTrack(nextTrack, true)
      } else {
        applyTrack(null, false)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao pular a música')
      updatePlaying(false)
    }
  }, [applyTrack, updatePlaying])

  const previous = useCallback(async () => {
    setError(null)
    try {
      const res = await apiQueue.previous()
      const prev = (res.data?.track ?? null) as MusicTrack | null
      if (prev) {
        applyTrack(prev, true)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao voltar a música')
      updatePlaying(false)
    }
  }, [applyTrack, updatePlaying])

  const changeVolume = useCallback(
    (value: number) => {
      const nextVolume = Math.max(0, Math.min(100, Math.round(value)))
      volumeChangedAtRef.current = Date.now()
      updateVolume(nextVolume)
      playerRef.current?.setVolume(nextVolume)

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
      <div
        ref={mountRef}
        aria-hidden="true"
        className="pointer-events-none fixed overflow-hidden opacity-0"
        style={{ left: -10000, top: 0, width: 320, height: 180 }}
      />
    </AudioPlayerContext.Provider>
  )
}

export function useAudioPlayer() {
  const context = useContext(AudioPlayerContext)
  if (!context) {
    throw new Error('useAudioPlayer deve ser usado dentro de YouTubeAudioProvider')
  }
  return context
}
