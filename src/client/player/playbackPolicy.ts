/**
 * Políticas de reprodução do Spotify Web Playback SDK.
 *
 * Este módulo é intencionalmente puro (sem React e sem DOM) para poder ser
 * testado no Vitest e para concentrar as mensagens que o usuário vê.
 *
 * Nada aqui simula reprodução: o áudio continua sendo entregue pelo SDK
 * oficial do Spotify. O objetivo é respeitar as políticas de autoplay dos
 * navegadores móveis e traduzir os erros do SDK/Web API em ações claras.
 */

export interface BrowserInfo {
  userAgent?: string
  platform?: string
  maxTouchPoints?: number
  /** `matchMedia('(pointer: coarse)').matches` — independe do modo desktop. */
  coarsePointer?: boolean
  /** Largura da viewport em CSS px. */
  screenWidth?: number
  /** `navigator.userAgentData.mobile`, quando o navegador expõe. */
  userAgentMobile?: boolean
}

/**
 * Detecta navegadores móveis.
 *
 * O iPadOS 13+ se apresenta como "MacIntel"; por isso também olhamos para
 * `maxTouchPoints`, que é maior que 1 em iPads com tela touch.
 *
 * O modo "Site para desktop" do Chrome no Android troca o user agent por um
 * de Linux/Windows. Se classificássemos como desktop, o PixTune tentaria
 * autoplay sem gesto e o Chrome bloquearia o áudio. Por isso o ponteiro
 * coarse/touch também conta como mobile em telas pequenas.
 */
export function isMobileBrowser(info: BrowserInfo = {}): boolean {
  const userAgent = info.userAgent || ''
  const platform = info.platform || ''
  const maxTouchPoints = info.maxTouchPoints || 0
  const coarsePointer = info.coarsePointer === true
  const screenWidth = info.screenWidth || 0

  if (
    /Android|iPhone|iPad|iPod|Mobile|CriOS|FxiOS|EdgiOS|Opera Mini|IEMobile/i.test(
      userAgent
    )
  ) {
    return true
  }

  if (info.userAgentMobile === true) return true

  if (platform === 'MacIntel' && maxTouchPoints > 1) return true

  // Android/iPad em "Site para desktop": UA desktop, mas entrada por toque e
  // viewport estreita. Tablets grandes (>= 1025 CSS px) ficam de fora.
  return coarsePointer && maxTouchPoints > 0 && screenWidth > 0 && screenWidth <= 1024
}

export interface AutoplayPolicyInput {
  /** Navegador móvel (iOS/Android). */
  mobile: boolean
  /** O elemento de áudio já foi liberado por um gesto do usuário. */
  audioUnlocked: boolean
  /** Uma falha anterior já sinalizou que o navegador exige um novo toque. */
  needsActivation: boolean
}

/**
 * Decide se o player pode tentar iniciar uma faixa sem um novo clique.
 *
 * Em desktop, tentamos (o navegador pode permitir por engajamento). Em mobile,
 * só tentamos depois que o usuário liberou o áudio com um gesto. Se uma falha
 * anterior pediu ativação, não insistimos sozinhos: isso evita o loop de
 * "Playback Error" a cada polling de 4 segundos.
 */
export function shouldAttemptAutoplay(input: AutoplayPolicyInput): boolean {
  if (input.needsActivation) return false
  if (input.mobile && !input.audioUnlocked) return false
  return true
}

/** Atraso exponencial (1s, 2s, 4s...) limitado a 30s. */
export function nextReconnectDelay(attempt: number): number {
  const safeAttempt = Number.isFinite(attempt) ? Math.max(0, Math.floor(attempt)) : 0
  return Math.min(1000 * 2 ** safeAttempt, 30_000)
}

function normalizeReason(message?: string | null): string {
  return (message || '').toLowerCase()
}

/**
 * O SDK do Spotify usa a mensagem genérica "Playback Error" em alguns
 * bloqueios de áudio no Chrome Android. Sem tratá-la como autoplay, o app
 * mostrava "verifique a conexão/plano" e repetia a tentativa sem gesto.
 */
export function isAmbiguousSdkPlaybackError(message?: string | null): boolean {
  return normalizeReason(message).trim() === 'playback error'
}

/** O navegador bloqueou a reprodução automática / exige um gesto. */
export function isAutoplayBlockedReason(message?: string | null): boolean {
  const text = normalizeReason(message)
  if (!text) return false

  return [
    'autoplay',
    'not allowed',
    'not been activated',
    'user gesture',
    'user interaction',
    'interact',
    'play() failed',
    'play() request was interrupted',
    'element was not activated',
    'activation',
    'requires a user',
    'requires interaction',
    'blocked',
    'policy',
  ].some((marker) => text.includes(marker))
}

/** A conta não tem o tipo de Premium aceito pelo Web Playback SDK. */
export function isPremiumReason(message?: string | null): boolean {
  const text = normalizeReason(message)
  if (!text) return false

  return [
    'premium',
    'account error',
    'free account',
    'subscription',
    'product',
  ].some((marker) => text.includes(marker))
}

/** O dispositivo Connect ainda não está disponível ou sumiu. */
export function isDeviceReason(message?: string | null): boolean {
  const text = normalizeReason(message)
  if (!text) return false

  return [
    'device not found',
    'no active device',
    'device is not',
    'device unavailable',
    'device is unavailable',
    'temporarily unavailable',
    'restricted device',
    'player command failed',
    'transfer',
    'not ready',
    'not connected',
  ].some((marker) => text.includes(marker))
}

/** Problema de DRM/EME/Widevine no navegador. */
export function isBrowserDrmReason(message?: string | null): boolean {
  const text = normalizeReason(message)
  if (!text) return false

  return [
    'encrypted media',
    'encrypted-media',
    'encrypted media extensions',
    'emeerror',
    'eme error',
    'widevine',
    'drm',
    'cdm',
    'protected content',
    'protected media',
    'playback of protected',
    'browser not supported',
    'unsupported browser',
    'media key',
    'media keys',
    'mediadrm',
    'keysystem',
    'key system',
    'security level',
    'sw_secure_crypto',
    'hw_secure_crypto',
    'l1 security',
    'l3 security',
    'not provisioned',
    'failed to create',
    'create media keys',
    'decrypt',
    'cannot handle',
  ].some((marker) => text.includes(marker))
}

/** Token/sessão inválidos. */
export function isAuthReason(message?: string | null): boolean {
  const text = normalizeReason(message)
  if (!text) return false

  return [
    'authentication',
    'unauthorized',
    'invalid token',
    'expired token',
    'session',
    'login',
    'token',
    '401',
  ].some((marker) => text.includes(marker))
}

/** Faixa restrita/indisponível na conta ou região. */
export function isRestrictionReason(message?: string | null): boolean {
  const text = normalizeReason(message)
  if (!text) return false

  return [
    'restriction',
    'not available in your country',
    'not available in your region',
    'track unavailable',
    'track is unavailable',
    'track is not available',
    'content unavailable',
    'content is unavailable',
    'explicit',
  ].some((marker) => text.includes(marker))
}

/** Rate limit do Spotify. */
export function isRateLimitReason(message?: string | null): boolean {
  const text = normalizeReason(message)
  if (!text) return false
  return ['rate limit', 'too many requests', '429'].some((marker) => text.includes(marker))
}

export const SPOTIFY_PREMIUM_MESSAGE =
  'O Spotify exige uma conta Premium para reproduzir no navegador. Planos Premium comprados pelo celular (App Store/Google Play) não são aceitos pelo Web Playback SDK.'

export const SPOTIFY_MOBILE_AUTOPLAY_MESSAGE =
  'O navegador bloqueou o áudio. Toque no botão Play no PixTune para liberar o som deste dispositivo.'

export const SPOTIFY_AUTOPLAY_MESSAGE =
  'O navegador bloqueou a reprodução automática. Clique em Play para iniciar o áudio.'

export const SPOTIFY_DRM_MESSAGE =
  'Este navegador/aparelho não conseguiu abrir o áudio protegido (DRM/Widevine) do Spotify. Atualize o Chrome/Firefox e o Android System WebView, permita conteúdo protegido para este site e tente novamente. Se persistir, ouça pelo app Spotify.'

export const SPOTIFY_INIT_MESSAGE =
  'Não foi possível inicializar o player do Spotify neste navegador. Atualize o navegador, permita conteúdo protegido para este site e tente novamente.'

export const SPOTIFY_TRACK_INVALID_MESSAGE =
  'Esta faixa não é uma música válida do Spotify. Peça outra música ou reconecte a conta em Configurações > Spotify.'

export const SPOTIFY_AUTH_MESSAGE =
  'Sua sessão do Spotify expirou. Reconecte a conta em Configurações > Spotify.'

export const SPOTIFY_DEVICE_MESSAGE =
  'O dispositivo PixTune ainda não apareceu no Spotify. Aguarde alguns segundos e toque em Play novamente.'

export const SPOTIFY_RESTRICTION_MESSAGE =
  'O Spotify não permitiu reproduzir esta faixa. Ela pode estar indisponível na sua região ou conta.'

export const SPOTIFY_RATE_LIMIT_MESSAGE =
  'O Spotify limitou temporariamente as requisições. Aguarde alguns segundos e tente novamente.'

export const SPOTIFY_NETWORK_MESSAGE =
  'Falha de conexão com o Spotify. Verifique a internet e tente novamente.'

export const SPOTIFY_GENERIC_MESSAGE =
  'Não foi possível reproduzir no Spotify. Verifique a conexão, o plano Premium e tente novamente.'

/**
 * Converte mensagens do SDK/Web API (normalmente em inglês) em uma orientação
 * acionável em português. A mensagem original continua sendo registrada no
 * console para diagnóstico, sem tokens ou segredos.
 */
export function playbackErrorMessage(
  message?: string | null,
  context: { mobile?: boolean } = {}
): string {
  const text = normalizeReason(message)

  if (isPremiumReason(text)) return SPOTIFY_PREMIUM_MESSAGE
  if (isRateLimitReason(text)) return SPOTIFY_RATE_LIMIT_MESSAGE
  // DRM antes de auth/autoplay: erros de EME podem conter "session"
  // (createSession) e "blocked" (protected content is blocked).
  if (isBrowserDrmReason(text)) return SPOTIFY_DRM_MESSAGE
  if (isAuthReason(text)) return SPOTIFY_AUTH_MESSAGE
  // Restrição antes de dispositivo: a API usa "Player command failed:
  // Restriction violated", que também casa com o prefixo genérico de device.
  if (isRestrictionReason(text)) return SPOTIFY_RESTRICTION_MESSAGE
  if (context.mobile && isAmbiguousSdkPlaybackError(text)) {
    return SPOTIFY_MOBILE_AUTOPLAY_MESSAGE
  }
  if (isAutoplayBlockedReason(text)) {
    return context.mobile ? SPOTIFY_MOBILE_AUTOPLAY_MESSAGE : SPOTIFY_AUTOPLAY_MESSAGE
  }
  if (isDeviceReason(text)) return SPOTIFY_DEVICE_MESSAGE

  return SPOTIFY_GENERIC_MESSAGE
}
