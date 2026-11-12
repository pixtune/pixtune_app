# PixTune — Especificações do Sistema

## 🎨 Cores (Brandbook v1.0)
- **Fundo Principal:** Deep Navy (`#070F14`) e Black (`#03070B`) — imersão darkroom para streams.
- **Superfícies:** Surface (`#0B141A`) e Elevated (`#101B22`) com bordas sutis (`#1E2D36`).
- **Acento Primário:** PixTune Green (`#1ED760` / `#17BF54`) — energia néon e identidade musical.
- **Acento Secundário:** Cyan (`#00E0FF`) e Aqua (`#00EFFF`) — gradientes de destaque.
- **Tipografia:** Branco puro (`#FFFFFF`), Secundário (`#9DA0A2`) e Muted (`#7A8489`).
- **Feedback:** Sucesso (`#1ED760`), Alerta (`#FFB300`), Perigo (`#FF5A67`).

## ✍️ Tipologia e Tipografia
- **Font Display:** `Space Grotesk` — usada em títulos de impacto, métricas e no player.
- **Font Interface:** `Inter` — alta legibilidade em listas, labels, filas e tabelas.
- **Hierarquia:** Display (44–64px), Títulos (22–36px), Corpo (14–16px) e Legendas (12px).
- **Acessibilidade:** Suporte nativo a alto contraste e redução de animações (WCAG AA).

## ⚡ Funcionalidades Principais
1. **Live Pix com Prioridade por Valor:** Doações transformadas em música em tempo real; maiores doações furam a fila e tocam imediatamente.
2. **Player Spotify Web Playback SDK:** Reprodução oficial e contínua dentro do navegador do streamer via Spotify Connect.
3. **Modal de Playlists Spotify:** Importação de faixas em 1 clique direto no painel e na fila com busca instantânea.
4. **Modo de Teste / Demonstração:** Acesso imediato sem burocracia de login OAuth ou banco para validação do sistema.
5. **Responsividade Mobile:** Interface fluida para celular e desktop, com desbloqueio de áudio por toque (Web Audio API).
6. **Regras de Live:** Configuração de valor mínimo, moderação de palavras e comandos automáticos.
7. **Arquitetura Fullstack:** Next.js 14 App Router unificado com Hono API, autenticação JWT HttpOnly e Prisma ORM.

