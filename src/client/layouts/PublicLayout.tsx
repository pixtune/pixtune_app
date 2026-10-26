import { Outlet, Link } from 'react-router-dom'
import { UserPlus } from 'lucide-react'
import { Button } from '@client/components/ui/Button'

export function PublicLayout() {
  return (
    <div className="min-h-screen bg-pixtune-bg text-pixtune-text flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-pixtune-border bg-pixtune-bg/80 px-6 py-4 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2" aria-label="PixTune Home">
            <svg className="w-8 h-8 text-pixtune-primary" viewBox="0 0 32 32" fill="none" aria-hidden="true">
              <rect width="32" height="32" rx="8" fill="#03070B" />
              <path d="M8 16C8 11.5817 11.5817 8 16 8C20.4183 8 24 11.5817 24 16C24 20.4183 20.4183 24 16 24C11.5817 24 8 20.4183 8 16Z" stroke="#1ED760" strokeWidth="2" />
              <path d="M16 8V16L21 19" stroke="#1ED760" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="24" cy="8" r="2" fill="#00E0FF" />
            </svg>
            <span className="font-display font-bold text-heading-md tracking-tight">PixTune</span>
          </Link>

          <nav className="hidden md:flex items-center gap-4">
            <Link to="/login" className="text-pixtune-textSecondary hover:text-pixtune-text transition-colors font-medium">
              Entrar
            </Link>
            <Link to="/register">
              <Button className="gap-2">
                <UserPlus className="w-4 h-4" />
                Começar grátis
              </Button>
            </Link>
          </nav>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1">
        <Outlet />
      </main>

      {/* Footer */}
      <footer className="border-t border-pixtune-border px-6 py-8">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div>
              <h3 className="font-semibold text-body-lg mb-4">PixTune</h3>
              <p className="text-pixtune-textSecondary text-body-sm leading-relaxed">
                Controle sua música durante a live via doações Live Pix.
                Feito para streamers, por streamers.
              </p>
            </div>
            <div>
              <h4 className="font-semibold text-body-sm mb-3">Produto</h4>
              <ul className="space-y-2 text-pixtune-textSecondary text-body-sm">
                <li><a href="/#funcionalidades" className="hover:text-pixtune-primary transition-colors">Funcionalidades</a></li>
                <li><a href="/#como-funciona" className="hover:text-pixtune-primary transition-colors">Como funciona</a></li>
                <li><a href="/#comecar" className="hover:text-pixtune-primary transition-colors">Começar agora</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold text-body-sm mb-3">Conta</h4>
              <ul className="space-y-2 text-pixtune-textSecondary text-body-sm">
                <li><Link to="/login" className="hover:text-pixtune-primary transition-colors">Entrar</Link></li>
                <li><Link to="/register" className="hover:text-pixtune-primary transition-colors">Criar conta</Link></li>
                <li><Link to="/dashboard" className="hover:text-pixtune-primary transition-colors">Abrir painel</Link></li>
              </ul>
            </div>
          </div>
          <div className="mt-8 pt-8 border-t border-pixtune-border">
            <p className="text-pixtune-textMuted text-caption">
              © 2026 PixTune. Não afiliado ao Spotify ou ao Live Pix.
            </p>
          </div>
        </div>
      </footer>
    </div>
  )
}
