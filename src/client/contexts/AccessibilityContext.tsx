import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

type AccessibilityPreferences = {
  highContrast: boolean
  reducedMotion: boolean
}

type AccessibilityContextType = AccessibilityPreferences & {
  setHighContrast: (enabled: boolean) => void
  setReducedMotion: (enabled: boolean) => void
}

const STORAGE_HIGH_CONTRAST = 'pixtune_high_contrast'
const STORAGE_REDUCED_MOTION = 'pixtune_reduced_motion'

const AccessibilityContext = createContext<AccessibilityContextType | null>(null)

function readStoredFlag(key: string): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(key) === 'true'
  } catch {
    return false
  }
}

function persistFlag(key: string, enabled: boolean) {
  try {
    window.localStorage.setItem(key, String(enabled))
  } catch {
    // O modo continua funcionando nesta sessão mesmo sem localStorage.
  }
}

export function AccessibilityProvider({ children }: { children: ReactNode }) {
  const [highContrast, setHighContrastState] = useState(() => readStoredFlag(STORAGE_HIGH_CONTRAST))
  const [reducedMotion, setReducedMotionState] = useState(() => readStoredFlag(STORAGE_REDUCED_MOTION))

  useEffect(() => {
    document.documentElement.classList.toggle('high-contrast', highContrast)
    persistFlag(STORAGE_HIGH_CONTRAST, highContrast)
  }, [highContrast])

  useEffect(() => {
    document.documentElement.classList.toggle('reduce-motion', reducedMotion)
    persistFlag(STORAGE_REDUCED_MOTION, reducedMotion)
  }, [reducedMotion])

  const setHighContrast = useCallback((enabled: boolean) => setHighContrastState(enabled), [])
  const setReducedMotion = useCallback((enabled: boolean) => setReducedMotionState(enabled), [])

  const value = useMemo(
    () => ({ highContrast, reducedMotion, setHighContrast, setReducedMotion }),
    [highContrast, reducedMotion, setHighContrast, setReducedMotion]
  )

  return <AccessibilityContext.Provider value={value}>{children}</AccessibilityContext.Provider>
}

export function useAccessibility() {
  const context = useContext(AccessibilityContext)
  if (!context) {
    throw new Error('useAccessibility deve ser usado dentro de AccessibilityProvider')
  }
  return context
}
