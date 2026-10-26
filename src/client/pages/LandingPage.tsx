import { Link } from 'react-router-dom'
import { Music, Zap, Play, ArrowRight, ShieldCheck, Users, Clock, Layers } from 'lucide-react'
import { Button } from '@client/components/ui/Button'
import { Card } from '@client/components/ui/Card'
import { Badge } from '@client/components/ui/Badge'

export function LandingPage() {
  return (
    <div className="min-h-screen bg-pixtune-bg text-pixtune-text">
      {/* Hero Section */}
      <section className="hero-glow relative overflow-hidden px-6 py-12 md:px-12 md:py-20">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 gap-12 lg:grid-cols-2 lg:items-center">
            <div className="space-y-6">
              <Badge variant="info">A trilha sonora da sua live</Badge>
              <h1 className="text-display-sm font-bold text-pixtune-text leading-tight md:text-display-md">
                Doe, escreva o nome da música e ela toca na sua <span className="gradient-text">live</span>
              </h1>
              <p className="text-body-lg text-pixtune-textSecondary leading-relaxed">
                O doador escreve o nome da música na mensagem do Live Pix. O PixTune detecta o
                pedido, busca a faixa no Spotify e coloca na fila. Mensagens que não são pedidos de
                música são ignoradas — <span className="text-pixtune-text">sem URLs fixas e sem trabalho manual.</span>
              </p>
              <div className="flex flex-col sm:flex-row gap-4">
                <Link to="/login">
                  <Button variant="primary" size="lg" className="w-full sm:w-auto">
                    <Play className="w-5 h-5 mr-2" /> Entrar no painel
                  </Button>
                </Link>
                <Link to="/register">
                  <Button variant="secondary" size="lg" className="w-full sm:w-auto">
                    Criar conta grátis
                  </Button>
                </Link>
              </div>
              <div className="flex items-center gap-4 text-caption text-pixtune-textMuted">
                <div className="flex items-center gap-1">
                  <ShieldCheck className="w-4 h-4" />
                  <span>Sem cartão de crédito para testar</span>
                </div>
                <div className="w-px h-4 bg-pixtune-border" />
                <div className="flex items-center gap-1">
                  <Users className="w-4 h-4" />
                  <span>Seus dados, isolados por usuário</span>
                </div>
              </div>
            </div>

            <div className="relative hidden lg:block">
              <div className="bg-pixtune-surface border border-pixtune-border rounded-2xl shadow-pixtune-lg p-6 relative overflow-hidden">
                <div className="absolute top-0 right-0 -mx-4 -my-4 p-4 bg-pixtune-primary/5 rounded-bl-2xl">
                  <div className="flex items-center gap-2 text-pixtune-primary">
                    <div className="w-2 h-2 rounded-full bg-pixtune-primary animate-pulse" />
                    <span className="text-xs font-medium">Live Pix conectado</span>
                  </div>
                </div>
                <div className="space-y-4">
                  <div className="flex items-center justify-between p-4 bg-pixtune-surfaceElevated rounded-lg border border-pixtune-border">
                    <div>
                      <p className="text-caption text-pixtune-textMuted">Agora tocando</p>
                      <p className="text-body font-semibold text-pixtune-text">Blinding Lights</p>
                      <p className="text-caption text-pixtune-textSecondary">The Weeknd</p>
                    </div>
                    <div className="w-10 h-10 rounded-lg gradient-brand flex items-center justify-center shadow-glow-green">
                      <Play className="w-5 h-5 text-pixtune-black" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <p className="text-caption font-semibold text-pixtune-textSecondary uppercase tracking-wider">Próximas na fila</p>
                    <div className="space-y-2">
                      {[
                        { title: 'Levitating', artist: 'Dua Lipa', time: '3:23' },
                        { title: 'Stay', artist: 'The Kid LAROI', time: '2:18' },
                        { title: 'Good 4 U', artist: 'Olivia Rodrigo', time: '2:58' },
                      ].map((track, i) => (
                        <div key={i} className="flex items-center gap-3 p-2 rounded-lg hover:bg-pixtune-border/50 transition-colors">
                          <div className="w-8 h-8 rounded bg-pixtune-surfaceElevated flex items-center justify-center text-caption font-medium">
                            {i + 1}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-body-sm font-medium text-pixtune-text truncate">{track.title}</p>
                            <p className="text-caption text-pixtune-textMuted truncate">{track.artist}</p>
                          </div>
                          <span className="text-caption text-pixtune-textMuted">{track.time}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="funcionalidades" className="py-20 border-y border-pixtune-border bg-pixtune-surface/30">
        <div className="max-w-7xl mx-auto px-6 md:px-12">
          <div className="text-center mb-16">
            <h2 className="text-heading-md font-bold text-pixtune-text mb-4 md:text-heading-lg">Tudo o que um streamer precisa</h2>
            <p className="text-body text-pixtune-textSecondary max-w-2xl mx-auto">
              Uma ponte simples entre a mensagem da doação e a música que toca ao vivo.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <FeatureCard
              icon={Zap}
              title="Pedido pela mensagem"
              description="O doador escreve o nome da música no Live Pix. O PixTune detecta o pedido, ignora conversas e coloca a faixa na fila."
            />
            <FeatureCard
              icon={Layers}
              title="Fila Inteligente"
              description="Reproduza playlists e faixas do Spotify no navegador, com controle de volume, pausa e avanço. A conta do streamer precisa de Premium."
            />
            <FeatureCard
              icon={ShieldCheck}
              title="Prioridade por Valor"
              description="A maior doação toca primeiro e derruba a música atual de menor valor. Sem palavras-chave, links fixos ou reordenação manual."
            />
            <FeatureCard
              icon={Clock}
              title="Histórico Completo"
              description="Veja a música detectada em cada mensagem, os pedidos ignorados e o resultado do processamento."
            />
            <FeatureCard
              icon={Music}
              title="Simulação Local"
              description="Teste o pipeline real com uma doação simulada e uma mensagem como “Evidências” ou “Despacito”."
            />
            <FeatureCard
              icon={Users}
              title="Isolamento de Dados"
              description="Cada streamer acessa apenas suas próprias configurações, músicas e fila. Seus dados nunca são misturados com os de outros usuários."
            />
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="como-funciona" className="py-20 bg-pixtune-bg">
        <div className="max-w-7xl mx-auto px-6 md:px-12">
          <div className="text-center mb-16">
            <h2 className="text-heading-md font-bold text-pixtune-text mb-4 md:text-heading-lg">Como funciona</h2>
            <p className="text-body text-pixtune-textSecondary max-w-2xl mx-auto">
              Três passos para colocar o PixTune na sua transmissão.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
            <StepCard number="1" title="Conecte suas contas" description="Crie sua conta, conecte o Spotify Premium e configure o Live Pix para receber doações reais." />
            <StepCard number="2" title="Defina o valor mínimo" description="Escolha o valor mínimo inicial. A maior doação sempre toca primeiro; não há ação manual nem palavras-chave." />
            <StepCard number="3" title="Receba o pedido" description="O doador escreve o nome da música na mensagem. O PixTune detecta, busca no Spotify e toca — ou ignora se não for música." />
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section id="comecar" className="py-20">
        <div className="max-w-3xl mx-auto px-6 md:px-12 text-center">
          <div className="bg-pixtune-surface border border-pixtune-border rounded-2xl p-8 md:p-12 shadow-pixtune">
            <h2 className="text-heading-md font-bold text-pixtune-text mb-4 md:text-heading-lg">Pronto para começar?</h2>
            <p className="text-body text-pixtune-textSecondary mb-8 max-w-lg mx-auto">
              Comece gratuitamente, sem cartão de crédito. Crie sua conta, configure o valor mínimo e conecte o Live Pix quando estiver pronto.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link to="/login">
                <Button variant="primary" size="lg">
                  <ArrowRight className="w-5 h-5 mr-2" /> Acessar painel
                </Button>
              </Link>
            </div>
            <p className="mt-6 text-caption text-pixtune-textMuted">
              PixTune não é um processador de pagamentos e não substitui o Live Pix.
            </p>
          </div>
        </div>
      </section>
    </div>
  )
}

function FeatureCard({ icon: Icon, title, description }: { icon: React.ComponentProps<typeof Music> extends never ? never : React.ElementType; title: string; description: string }) {
  return (
    <Card className="group h-full p-6 transition-colors hover:border-pixtune-primary/30">
      <div className="w-10 h-10 rounded-lg bg-pixtune-primary/10 text-pixtune-primary flex items-center justify-center mb-4 transition-colors group-hover:bg-pixtune-primary group-hover:text-pixtune-black">
        <Icon className="w-5 h-5" />
      </div>
      <h3 className="text-heading-sm font-semibold text-pixtune-text mb-2">{title}</h3>
      <p className="text-body-sm text-pixtune-textSecondary leading-relaxed">{description}</p>
    </Card>
  )
}

function StepCard({ number, title, description }: { number: string; title: string; description: string }) {
  return (
    <div className="flex flex-col items-center text-center">
      <div className="w-12 h-12 rounded-full gradient-brand text-pixtune-black flex items-center justify-center font-display font-bold text-body-lg mb-4 shadow-glow-green">
        {number}
      </div>
      <h3 className="text-heading-sm font-semibold text-pixtune-text mb-2">{title}</h3>
      <p className="text-body-sm text-pixtune-textSecondary leading-relaxed max-w-xs">{description}</p>
    </div>
  )
}