import { describe, expect, it } from 'vitest'
import {
  isAutoplayBlockedReason,
  isBrowserDrmReason,
  isDeviceReason,
  isMobileBrowser,
  isPremiumReason,
  nextReconnectDelay,
  playbackErrorMessage,
  shouldAttemptAutoplay,
  SPOTIFY_AUTH_MESSAGE,
  SPOTIFY_DRM_MESSAGE,
  SPOTIFY_MOBILE_AUTOPLAY_MESSAGE,
  SPOTIFY_PREMIUM_MESSAGE,
  SPOTIFY_RESTRICTION_MESSAGE,
} from './playbackPolicy'

describe('isMobileBrowser', () => {
  it('detecta Android, iPhone e iPad', () => {
    expect(isMobileBrowser({ userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/120' })).toBe(true)
    expect(isMobileBrowser({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)' })).toBe(true)
    expect(isMobileBrowser({ userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0)' })).toBe(true)
  })

  it('detecta iPadOS 13+ que se apresenta como MacIntel', () => {
    expect(
      isMobileBrowser({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)', platform: 'MacIntel', maxTouchPoints: 5 })
    ).toBe(true)
  })

  it('detecta Android em modo "Site para desktop" pelo ponteiro coarse', () => {
    expect(
      isMobileBrowser({
        userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120',
        platform: 'Linux x86_64',
        maxTouchPoints: 5,
        coarsePointer: true,
        screenWidth: 980,
      })
    ).toBe(true)
  })

  it('usa o Client Hint mobile quando disponível', () => {
    expect(
      isMobileBrowser({
        userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/120',
        platform: 'Linux x86_64',
        userAgentMobile: true,
      })
    ).toBe(true)
  })

  it('não trata desktop como mobile', () => {
    expect(
      isMobileBrowser({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120',
        platform: 'Win32',
        maxTouchPoints: 0,
        coarsePointer: false,
        screenWidth: 1920,
      })
    ).toBe(false)
    expect(
      isMobileBrowser({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)',
        platform: 'MacIntel',
        maxTouchPoints: 0,
        coarsePointer: false,
        screenWidth: 1440,
      })
    ).toBe(false)
  })
})

describe('shouldAttemptAutoplay', () => {
  it('permite autoplay no desktop enquanto não houver falha de ativação', () => {
    expect(shouldAttemptAutoplay({ mobile: false, audioUnlocked: false, needsActivation: false })).toBe(true)
  })

  it('trata o "Playback Error" genérico do SDK como autoplay no mobile', () => {
    expect(playbackErrorMessage('Playback Error', { mobile: true })).toBe(
      SPOTIFY_MOBILE_AUTOPLAY_MESSAGE
    )
    expect(playbackErrorMessage('Playback Error', { mobile: false })).not.toBe(
      SPOTIFY_MOBILE_AUTOPLAY_MESSAGE
    )
  })

  it('bloqueia autoplay no mobile até o usuário liberar o áudio', () => {
    expect(shouldAttemptAutoplay({ mobile: true, audioUnlocked: false, needsActivation: false })).toBe(false)
    expect(shouldAttemptAutoplay({ mobile: true, audioUnlocked: true, needsActivation: false })).toBe(true)
  })

  it('respeita a sinalização de novo toque mesmo no desktop', () => {
    expect(shouldAttemptAutoplay({ mobile: false, audioUnlocked: true, needsActivation: true })).toBe(false)
  })
})

describe('nextReconnectDelay', () => {
  it('cresce exponencialmente e limita a 30 segundos', () => {
    expect(nextReconnectDelay(0)).toBe(1000)
    expect(nextReconnectDelay(1)).toBe(2000)
    expect(nextReconnectDelay(2)).toBe(4000)
    expect(nextReconnectDelay(10)).toBe(30_000)
  })

  it('tolera valores inválidos', () => {
    expect(nextReconnectDelay(Number.NaN)).toBe(1000)
    expect(nextReconnectDelay(-3)).toBe(1000)
  })
})

describe('classificação de erros do Spotify', () => {
  it('reconhece autoplay bloqueado', () => {
    expect(isAutoplayBlockedReason('The play() request was interrupted because the user did not interact')).toBe(true)
    expect(isAutoplayBlockedReason('Element was not activated')).toBe(true)
    expect(isAutoplayBlockedReason('Premium required')).toBe(false)
  })

  it('reconhece Premium, dispositivo e DRM', () => {
    expect(isPremiumReason('Player command failed: Premium required')).toBe(true)
    expect(isDeviceReason('Device not found')).toBe(true)
    expect(isDeviceReason('No active device found')).toBe(true)
    expect(isDeviceReason('The device is temporarily unavailable')).toBe(true)
    expect(isBrowserDrmReason('Encrypted Media Extensions not supported')).toBe(true)
    expect(isBrowserDrmReason('A temporary failure occurred')).toBe(false)
  })

  it('não confunde restrição de faixa com dispositivo ausente', () => {
    expect(
      playbackErrorMessage('Player command failed: Restriction violated')
    ).toBe(SPOTIFY_RESTRICTION_MESSAGE)
    expect(
      playbackErrorMessage('Track not available in your region')
    ).toBe(SPOTIFY_RESTRICTION_MESSAGE)
    expect(playbackErrorMessage('Restricted device')).toContain('dispositivo PixTune')
  })

  it('traduz erros conhecidos para mensagens acionáveis', () => {
    expect(playbackErrorMessage('Premium required')).toBe(SPOTIFY_PREMIUM_MESSAGE)
    expect(playbackErrorMessage('Element was not activated', { mobile: true })).toBe(
      SPOTIFY_MOBILE_AUTOPLAY_MESSAGE
    )
    expect(playbackErrorMessage('Encrypted Media Extensions not supported')).toBe(SPOTIFY_DRM_MESSAGE)
    expect(playbackErrorMessage('The access token expired')).toBe(SPOTIFY_AUTH_MESSAGE)
  })

  it('usa uma mensagem genérica para erros desconhecidos', () => {
    expect(playbackErrorMessage('algo inesperado')).toContain('Não foi possível reproduzir')
    expect(playbackErrorMessage('')).toContain('Não foi possível reproduzir')
  })
})

describe('DRM/EME no Android', () => {
  it('reconhece os erros reais de Widevine/MediaDrm', () => {
    expect(
      isBrowserDrmReason('EMEError: No supported keysystem was found')
    ).toBe(true)
    expect(isBrowserDrmReason('Unable to set L1 security level')).toBe(true)
    expect(isBrowserDrmReason('MediaDrmBridge creation failed')).toBe(true)
    expect(
      isBrowserDrmReason(
        'Device not provisioned during createSession()'
      )
    ).toBe(true)
    expect(isBrowserDrmReason('playback of protected content is blocked')).toBe(
      true
    )
    expect(isBrowserDrmReason('Element was not activated')).toBe(false)
  })

  it('não confunde "Element" com a sigla EME', () => {
    expect(isBrowserDrmReason('Element was not activated')).toBe(false)
    expect(
      playbackErrorMessage('Element was not activated', { mobile: true })
    ).toBe(SPOTIFY_MOBILE_AUTOPLAY_MESSAGE)
  })

  it('traduz erro de DRM para a orientação de conteúdo protegido', () => {
    expect(
      playbackErrorMessage('EMEError: No supported keysystem was found')
    ).toBe(SPOTIFY_DRM_MESSAGE)
    expect(playbackErrorMessage('Unable to set L1 security level')).toBe(
      SPOTIFY_DRM_MESSAGE
    )
    expect(playbackErrorMessage('MediaDrmBridge creation failed')).toBe(
      SPOTIFY_DRM_MESSAGE
    )
    expect(
      playbackErrorMessage('Device not provisioned during createSession()')
    ).toBe(SPOTIFY_DRM_MESSAGE)
    expect(playbackErrorMessage('protected content is blocked')).toBe(
      SPOTIFY_DRM_MESSAGE
    )
  })
})
