'use client'

import { LandingPage } from '@client/pages/LandingPage'
import { Logo } from '@client/components/ui/Logo'
import { Button } from '@client/components/ui/Button'
import { Music, Sparkles } from 'lucide-react'
import Link from 'next/link'

export default function Home() {
  return (
    <div className="min-h-screen bg-pixtune-bg text-pixtune-text flex flex-col">
      <header className="sticky top-0 z-30 border-b border-pixtune-border bg-pixtune-bg/80 px-4 sm:px-6 py-3 sm:py-4 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2" aria-label="PixTune Home">
            <Logo size="md" variant="full" />
          </Link>

          <nav className="flex items-center gap-3 sm:gap-4">
            <Link
              href="/login"
              className="text-pixtune-primary hover:text-pixtune-primaryHover transition-colors font-medium text-body-sm hidden sm:inline-flex items-center gap-1.5"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Testar Sistema
            </Link>
            <Link
              href="/login"
              className="text-pixtune-textSecondary hover:text-pixtune-text transition-colors font-medium text-body-sm"
            >
              Entrar
            </Link>
            <Link href="/login">
              <Button size="sm" className="gap-2 font-semibold">
                <Music className="w-4 h-4" />
                <span className="hidden sm:inline">Entrar com Spotify</span>
                <span className="sm:hidden">Spotify</span>
              </Button>
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <LandingPage />
      </main>

      <footer className="border-t border-pixtune-border px-6 py-8">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div>
              <div className="mb-4">
                <Logo size="sm" variant="full" />
              </div>
              <p className="text-pixtune-textSecondary text-body-sm leading-relaxed">
                Controle sua música durante a live via doações Live Pix. Feito para streamers, por streamers.
              </p>
            </div>
            <div>
              <h4 className="font-semibold text-body-sm mb-3">Produto</h4>
              <ul className="space-y-2 text-pixtune-textSecondary text-body-sm">
                <li>
                  <a href="/#funcionalidades" className="hover:text-pixtune-primary transition-colors">
                    Funcionalidades
                  </a>
                </li>
                <li>
                  <a href="/#como-funciona" className="hover:text-pixtune-primary transition-colors">
                    Como funciona
                  </a>
                </li>
                <li>
                  <a href="/#comecar" className="hover:text-pixtune-primary transition-colors">
                    Começar agora
                  </a>
                </li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold text-body-sm mb-3">Conta</h4>
              <ul className="space-y-2 text-pixtune-textSecondary text-body-sm">
                <li>
                  <Link href="/login" className="hover:text-pixtune-primary transition-colors">
                    Entrar com Spotify
                  </Link>
                </li>
                <li>
                  <Link href="/dashboard" className="hover:text-pixtune-primary transition-colors">
                    Painel do Streamer
                  </Link>
                </li>
              </ul>
            </div>
          </div>
          <div className="mt-8 border-t border-pixtune-border pt-6 text-center text-caption text-pixtune-textMuted">
            &copy; {new Date().getFullYear()} PixTune. Todos os direitos reservados.
          </div>
        </div>
      </footer>
    </div>
  )
}

