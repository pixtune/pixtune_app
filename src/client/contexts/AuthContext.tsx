import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  apiAuth,
  isNetworkError,
  isUnauthorized,
  type ApiError,
  type SpotifyUser,
} from '@client/api/client'

interface User extends SpotifyUser {}

interface AuthContextType {
  user: User | null
  isAuthenticated: boolean
  isLoading: boolean
  isConnecting: boolean
  authError: string | null
  spotifyLogin: () => void
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isConnecting, setIsConnecting] = useState(false)
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

          if (isUnauthorized(err)) {
            // Sessão inexistente/expirada não é falha de API. Apenas limpamos
            // um Bearer antigo que possa ter ficado no localStorage.
            if (typeof localStorage !== 'undefined') {
              localStorage.removeItem('pixtune_token')
            }
          } else if (isNetworkError(err)) {
            setAuthError(
              'Não foi possível falar com a API. Verifique VITE_API_URL, CORS e se a API está online.'
            )
          } else if (err instanceof Error && (err as ApiError).status && (err as ApiError).status! >= 500) {
            setAuthError('A API respondeu com erro interno. Tente novamente em alguns instantes.')
          }
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
    if (isConnecting) return
    setAuthError(null)
    setIsConnecting(true)
    try {
      const res = await apiAuth.connectUrl()
      if (res.success && res.data?.url) {
        window.location.href = res.data.url
        return
      }
      setAuthError(res.error?.message || 'Não foi possível iniciar a conexão com o Spotify.')
    } catch (err) {
      const message = isNetworkError(err)
        ? 'Não foi possível falar com a API. Verifique VITE_API_URL, CORS e se a API está online.'
        : err instanceof Error
          ? err.message
          : 'Não foi possível iniciar a conexão com o Spotify.'
      setAuthError(message)
    } finally {
      setIsConnecting(false)
    }
  }, [isConnecting])

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
      isConnecting,
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
