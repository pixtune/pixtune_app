import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiAuth, type SpotifyUser } from '@client/api/client'

interface User extends SpotifyUser {}

interface AuthContextType {
  user: User | null
  isAuthenticated: boolean
  isLoading: boolean
  authError: string | null
  spotifyLogin: () => void
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [authError, setAuthError] = useState<string | null>(null)
  const navigate = useNavigate()

  // Verificar sessão existente ao montar.
  useEffect(() => {
    let cancelled = false

    const initAuth = async () => {
      try {
        const res = await apiAuth.me()
        if (!cancelled && res.success && res.data?.user) {
          setUser(res.data.user)
        } else if (!cancelled) {
          setUser(null)
        }
      } catch (err) {
        if (!cancelled) {
          setUser(null)
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    initAuth()

    return () => {
      cancelled = true
    }
  }, [])

  const spotifyLogin = useCallback(async () => {
    setAuthError(null)
    try {
      const res = await apiAuth.connectUrl()
      if (res.success && res.data?.url) {
        window.location.href = res.data.url
        return
      }
      setAuthError(res.error?.message || 'Não foi possível iniciar a conexão com o Spotify.')
    } catch (err) {
      setAuthError(
        err instanceof Error ? err.message : 'Não foi possível iniciar a conexão com o Spotify.'
      )
    }
  }, [])

  const logout = useCallback(async () => {
    try {
      await apiAuth.logout()
    } catch {
      // Ignorar erro de logout
    }
    localStorage.removeItem('pixtune_token')
    setUser(null)
    setAuthError(null)
    navigate('/login', { replace: true })
  }, [navigate])

  return (
    <AuthContext.Provider value={{
      user,
      isAuthenticated: !!user,
      isLoading,
      authError,
      spotifyLogin,
      logout,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth deve ser usado dentro de AuthProvider')
  }
  return context
}
