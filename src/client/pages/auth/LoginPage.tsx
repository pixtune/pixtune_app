import { useState } from 'react'
import { Link } from 'react-router-dom'
import { User, Lock, Mail, ArrowRight } from 'lucide-react'
import { Button } from '@client/components/ui/Button'
import { Input } from '@client/components/ui/Input'
import { Card } from '@client/components/ui/Card'
import { useAuth } from '@client/contexts/AuthContext'

export function LoginPage() {
  const { login, isLoading } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    try {
      await login(email, password)
    } catch (err: any) {
      setError(err.message || 'Erro ao fazer login. Tente novamente.')
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-pixtune-bg px-6">
      <Card className="w-full max-w-md shadow-pixtune-lg">
        <div className="p-8">
          <div className="text-center mb-8">
            <div className="w-12 h-12 rounded-full gradient-brand flex items-center justify-center mx-auto mb-4 shadow-glow-green">
              <User className="w-6 h-6 text-pixtune-black" />
            </div>
            <h2 className="text-heading-md font-bold text-pixtune-text mb-2 md:text-heading-lg">Bem-vindo de volta</h2>
            <p className="text-body-sm text-pixtune-textSecondary">
              Acesse sua conta para gerenciar suas transmissões.
            </p>
          </div>

          {error && (
            <div className="mb-6 rounded-lg border border-pixtune-danger/30 bg-pixtune-danger/10 p-3 text-body-sm text-pixtune-danger">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label className="block text-body-sm font-medium text-pixtune-textSecondary">
                E-mail
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-3 w-4 h-4 text-pixtune-textMuted" />
                <Input
                  id="email"
                  type="email"
                  placeholder="seu@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-10"
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="block text-body-sm font-medium text-pixtune-textSecondary">
                Senha
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-3 w-4 h-4 text-pixtune-textMuted" />
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-10"
                  required
                />
              </div>
            </div>

            <Button
              type="submit"
              variant="primary"
              className="w-full"
              isLoading={isLoading}
            >
              <ArrowRight className="w-4 h-4 mr-2" />
              Entrar
            </Button>
          </form>

          <div className="mt-6 pt-6 border-t border-pixtune-border text-center">
            <p className="text-body-sm text-pixtune-textSecondary">
              Não tem uma conta?{' '}
              <Link to="/register" className="text-pixtune-primary hover:text-pixtune-primaryHover font-medium">
                Cadastre-se
              </Link>
            </p>
            <p className="mt-2 text-caption text-pixtune-textMuted">
              Autenticação real com senha criptografada. Seus dados são isolados por conta.
            </p>
          </div>
        </div>
      </Card>
    </div>
  )
}