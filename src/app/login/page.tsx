'use client'

import { Suspense, useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { Button } from '@client/components/ui/Button'
import { Logo } from '@client/components/ui/Logo'
import { Loader2, Music, ArrowLeft, Sparkles } from 'lucide-react'
import { apiAuth, isNetworkError } from '@client/api/client'
import { useAuth } from '@client/contexts/AuthContext'
import Link from 'next/link'

const SPOTIFY_ERRORS: Record<string, string> = {
  denied: 'A autorização no Spotify foi cancelada.',
  invalid:
    'O Spotify devolveu uma resposta inválida. Tente entrar novamente; se persistir, verifique a URL de callback no Spotify Dashboard.',
  state:
    'A validação de segurança do login falhou. O cookie de segurança não foi enviado; tente novamente em uma janela normal do navegador.',
  config:
    'A URL de callback do Spotify não confere com o domínio do PixTune. O administrador precisa cadastrar a URL exibida em Configurações → Spotify.',
  failed:
    'Não foi possível concluir o login. A API registrou a etapa exata da falha; tente novamente em instantes.',
  not_configured: 'O Spotify ainda não está configurado na API.',
  not_allowed:
    'Sua conta Spotify ainda não está autorizada neste aplicativo. Peça ao responsável para adicionar seu nome e e-mail em Spotify Developer Dashboard → Users Management (o app está em Development Mode).',
  scope:
    'O Spotify não concedeu todas as permissões necessárias. Tente novamente e aceite todas as permissões solicitadas.',
  forbidden:
    'O Spotify recusou a operação (403). Verifique se o app está em Development Mode e se sua conta está na lista de usuários autorizados.',
  rate_limited: 'O Spotify limitou temporariamente as requisições. Tente novamente em alguns minutos.',
  database:
    'O banco de dados da API não está com as migrations aplicadas. O administrador precisa executar prisma migrate deploy.',
  session: 'Não foi possível criar a sessão do PixTune. Tente novamente.',
}

function LoginForm() {
  const searchParams = useSearchParams()
  const spotifyStatus = searchParams.get('spotify')
  const [isConnecting, setIsConnecting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const { demoLogin } = useAuth()

  useEffect(() => {
    if (spotifyStatus && SPOTIFY_ERRORS[spotifyStatus]) {
      setErrorMessage(SPOTIFY_ERRORS[spotifyStatus])
    }
  }, [spotifyStatus])

  async function handleDemoLogin() {
    if (isConnecting) return
    setIsConnecting(true)
    setErrorMessage(null)

    try {
      await demoLogin()
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Não foi possível entrar no modo de teste.')
    } finally {
      setIsConnecting(false)
    }
  }

  async function handleSpotifyLogin() {
    if (isConnecting) return
    setIsConnecting(true)
    setErrorMessage(null)

    try {
      const res = await apiAuth.connectUrl()
      if (res.success && res.data?.url) {
        window.location.href = res.data.url
        return
      }
      setErrorMessage(res.error?.message || 'Não foi possível iniciar a conexão com o Spotify.')
    } catch (err) {
      const message = isNetworkError(err)
        ? 'Não foi possível conectar com o servidor. Verifique a conexão com a internet.'
        : err instanceof Error
          ? err.message
          : 'Não foi possível iniciar a conexão com o Spotify.'
      setErrorMessage(message)
    } finally {
      setIsConnecting(false)
    }
  }

  return (
    <div className="w-full max-w-md space-y-7 text-center relative z-10 p-8 sm:p-10 rounded-3xl border border-pixtune-border/80 bg-[#0B141A]/90 backdrop-blur-2xl shadow-2xl shadow-black/80">
      {/* Botão voltar */}
      <div className="flex justify-start -mt-2">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-caption text-pixtune-textMuted hover:text-pixtune-text transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Voltar ao início
        </Link>
      </div>

      {/* Logo com destaque generoso e nítido */}
      <div className="flex justify-center pt-1 pb-2">
        <Logo size="2xl" variant="full" />
      </div>

      <div className="space-y-2">
        <h1 className="text-2xl sm:text-[1.75rem] font-bold tracking-tight text-white font-display">
          Boas-vindas ao PixTune
        </h1>
        <p className="text-body-sm text-pixtune-textSecondary leading-relaxed max-w-xs mx-auto">
          Sua live, seu ritmo. Transforme doações em música.
        </p>
      </div>

      {/* Mensagem de erro somente se disparada por ação ou retorno */}
      {errorMessage && (
        <div
          role="alert"
          className="rounded-xl border border-pixtune-danger/40 bg-pixtune-danger/10 p-3.5 text-body-sm text-pixtune-danger animate-in fade-in duration-200"
        >
          {errorMessage}
        </div>
      )}

      <div className="space-y-4 pt-1">
        {/* Botão Oficial Spotify idêntico ao protótipo */}
        <button
          type="button"
          className="w-full h-13 py-3.5 px-6 rounded-full bg-[#1ED760] hover:bg-[#1fdf64] active:scale-[0.99] transition-all text-black font-bold text-[0.95rem] shadow-lg shadow-[#1ED760]/20 flex items-center justify-center gap-3 disabled:opacity-60 disabled:cursor-not-allowed"
          onClick={() => void handleSpotifyLogin()}
          disabled={isConnecting}
        >
          {isConnecting ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" />
              <span>Conectando...</span>
            </>
          ) : (
            <>
              {/* Ícone Spotify oficial em SVG */}
              <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
                <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.498 17.306c-.215.353-.676.466-1.028.25-2.825-1.727-6.381-2.118-10.57-1.16-.402.093-.805-.16-.897-.562-.093-.403.16-.805.562-.898 4.587-1.047 8.52-.598 11.685 1.341.352.216.465.677.248 1.029zm1.467-3.26c-.27.44-.847.58-1.287.31-3.233-1.987-8.163-2.56-11.986-1.4-1.498-.5-.99-1.285-.502-1.498.49-.214 1.285.5 1.498.502 4.372-1.326 9.805-.688 13.486 1.576.44.27.58.847.31 1.287l-.02.025zm.126-3.41c-3.877-2.302-10.279-2.514-13.98-1.39-.594.18-1.223-.153-1.403-.746-.18-.594.153-1.223.746-1.404 4.256-1.292 11.328-1.043 15.795 1.61.536.318.71 1.01.392 1.547-.317.536-1.01.71-1.55.383z" />
              </svg>
              <span>Entrar com Spotify</span>
            </>
          )}
        </button>

        {/* Divisor Visual */}
        <div className="relative py-1">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t border-pixtune-border/60" />
          </div>
          <div className="relative flex justify-center text-[10px] uppercase tracking-wider">
            <span className="bg-[#0B141A] px-3 text-pixtune-textMuted font-semibold">
              ou
            </span>
          </div>
        </div>

        {/* Botão de Acesso Imediato ao Modo de Teste */}
        <Button
          type="button"
          variant="secondary"
          size="lg"
          className="w-full h-12 text-body-sm font-semibold rounded-full border-pixtune-primary/40 text-pixtune-primary hover:bg-pixtune-primary/10 gap-2.5 transition-all shadow-md shadow-pixtune-primary/5 hover:border-pixtune-primary"
          onClick={() => void handleDemoLogin()}
          disabled={isConnecting}
        >
          <Sparkles className="w-4 h-4 text-pixtune-primary animate-pulse" />
          Entrar no Modo de Teste (Acesso Imediato)
        </Button>

        <p className="text-caption text-pixtune-textMuted pt-2 leading-relaxed">
          Ao entrar, você concorda com nossos{' '}
          <a href="#" className="underline hover:text-white transition-colors">
            Termos de Serviço
          </a>{' '}
          e{' '}
          <a href="#" className="underline hover:text-white transition-colors">
            Política de Privacidade
          </a>
          .
        </p>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-pixtune-bg px-4 py-12 relative overflow-hidden">
      {/* Luz ambiente de fundo verde néon */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[32rem] h-[32rem] bg-pixtune-primary/10 rounded-full blur-[120px] pointer-events-none" />

      <Suspense fallback={<div className="text-pixtune-textMuted">Carregando...</div>}>
        <LoginForm />
      </Suspense>
    </div>
  )
}

