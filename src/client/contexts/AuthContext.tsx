import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { getRedirectResult } from 'firebase/auth'
import { apiAuth } from '@client/api/client'
import { getFirebaseAuth } from '@client/lib/firebase'

interface User {
  id: string
  email: string
  name?: string
  avatarUrl?: string
}

interface AuthContextType {
  user: User | null
  isAuthenticated: boolean
  isLoading: boolean
  authError: string | null
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string, name: string) => Promise<void>
  firebaseLogin: (idToken: string) => Promise<void>
  logout: () => Promise<void>
  updateUser: (updates: Partial<User>) => void
}

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [authError, setAuthError] = useState<string | null>(null)
  const navigate = useNavigate()

  // Verificar sessão existente ao montar (e concluir login por redirecionamento).
  useEffect(() => {
    let cancelled = false

    const initAuth = async () => {
      try {
        // Conclui um login por redirecionamento do Firebase (fallback do popup).
        const firebaseAuth = getFirebaseAuth()
        if (firebaseAuth) {
          try {
            const redirectResult = await getRedirectResult(firebaseAuth)
            if (redirectResult?.user) {
              const idToken = await redirectResult.user.getIdToken()
              const res = await apiAuth.firebaseLogin(idToken)
              if (!cancelled && res.success && res.data) {
                localStorage.setItem('pixtune_token', res.data.token)
                setUser(res.data.user)
                return
              }
            }
          } catch {
            // Sem redirecionamento pendente: segue para a checagem do token.
          }
        }

        const token = localStorage.getItem('pixtune_token')
        if (token) {
          try {
            const res = await apiAuth.me()
            if (!cancelled && res.success && res.data?.user) {
              setUser(res.data.user)
            } else if (!cancelled) {
              localStorage.removeItem('pixtune_token')
              setUser(null)
            }
          } catch (err) {
            if (!cancelled) {
              localStorage.removeItem('pixtune_token')
              setUser(null)
              setAuthError(err instanceof Error ? err.message : 'Erro de autenticação')
            }
          }
        } else if (!cancelled) {
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

  const login = useCallback(async (email: string, password: string) => {
    setIsLoading(true)
    setAuthError(null)
    try {
      const res = await apiAuth.login({ email, password })
      if (res.success && res.data) {
        localStorage.setItem('pixtune_token', res.data.token)
        setUser(res.data.user)
        navigate('/dashboard', { replace: true })
      } else {
        throw new Error(res.error?.message || 'Credenciais inválidas')
      }
    } catch (err: any) {
      setAuthError(err.message || 'Erro ao fazer login')
      throw err
    } finally {
      setIsLoading(false)
    }
  }, [navigate])

  const register = useCallback(async (email: string, password: string, name: string) => {
    setIsLoading(true)
    setAuthError(null)
    try {
      const res = await apiAuth.register({ email, password, name })
      if (res.success && res.data) {
        localStorage.setItem('pixtune_token', res.data.token)
        setUser(res.data.user)
        navigate('/dashboard', { replace: true })
      } else {
        throw new Error(res.error?.message || 'Erro ao cadastrar')
      }
    } catch (err: any) {
      setAuthError(err.message || 'Erro ao cadastrar')
      throw err
    } finally {
      setIsLoading(false)
    }
  }, [navigate])

  // Login com Google: recebe o ID token do Firebase e troca por sessão PixTune.
  const firebaseLogin = useCallback(async (idToken: string) => {
    setIsLoading(true)
    setAuthError(null)
    try {
      const res = await apiAuth.firebaseLogin(idToken)
      if (res.success && res.data) {
        localStorage.setItem('pixtune_token', res.data.token)
        setUser(res.data.user)
        navigate('/dashboard', { replace: true })
      } else {
        throw new Error(res.error?.message || 'Não foi possível entrar com o Google')
      }
    } catch (err: any) {
      setAuthError(err.message || 'Erro ao entrar com o Google')
      throw err
    } finally {
      setIsLoading(false)
    }
  }, [navigate])

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

  const updateUser = useCallback((updates: Partial<User>) => {
    setUser(prev => prev ? { ...prev, ...updates } : null)
  }, [])

  return (
    <AuthContext.Provider value={{
      user,
      isAuthenticated: !!user,
      isLoading,
      authError,
      login,
      register,
      firebaseLogin,
      logout,
      updateUser,
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
