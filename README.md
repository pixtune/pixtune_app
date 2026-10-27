# PixTune

Plataforma musical para streamers que transforma a **mensagem da doação do Live Pix** em música.

O doador escreve o nome da música na mensagem da doação. O PixTune detecta o pedido, busca a faixa no Spotify e coloca na fila. Mensagens que não são pedidos de música são ignoradas. A reprodução usa exclusivamente o **Web Playback SDK oficial do Spotify**.

O PixTune **não** processa pagamentos, **não** recebe dinheiro, **não** armazena saldos e **não** substitui o Live Pix. Ele apenas recebe notificações de doações já processadas pelo provedor e reage à mensagem escrita pelo doador.

---

## Como o pedido funciona

```
Doador escreve "toca Evidências" no Live Pix
        ↓
Webhook do Live Pix chega ao PixTune
        ↓
Mensagem é normalizada e classificada
        ↓
Spotify Search encontra a faixa
        ↓
A maior doação assume a frente (derruba a menor)
        ↓
Web Playback SDK oficial do Spotify reproduz no navegador
```

- **Prioridade imutável por valor:** a doação de maior valor sempre toca primeiro. Se ela chegar enquanto uma música de menor valor está tocando, a menor é interrompida na hora e a maior começa imediatamente. Em valores iguais, vale a ordem de chegada.
- O streamer define apenas o **valor mínimo inicial** na página **Regras**. O valor de cada doação vem do Live Pix e é fixo: não há como reordenar, aumentar ou trocar a prioridade manualmente.
- Verbos comuns são removidos: `toca`, `coloca`, `quero ouvir`, `play`, `dj`, `por favor`, entre outros.
- Mensagens como `pizza`, `boa noite`, `obrigado`, `oi`, `essa é top` e `manda ver` são descartadas.
- Um link, URI ou ID de faixa do Spotify na mensagem é aceito diretamente.
- Se a música não for encontrada no Spotify, o pedido é registrado no histórico e não interrompe a música atual. O doador pode usar o nome exato ou colar um link do Spotify.
- A conta do streamer precisa ter **Spotify Premium**; o Web Playback SDK não reproduz em contas gratuitas.

A detecção é heurística. Ela foi feita para ser previsível e conservadora, não para adivinhar intenção em frases ambíguas. Veja [Limitações da detecção](#limitações-da-detecção).

---

## Stack

| Camada | Tecnologia |
|--------|------------|
| Frontend | React 18 + TypeScript + Vite + Tailwind CSS |
| Estado | Context API |
| Roteamento | React Router 6 |
| Backend | Hono (Node.js puro) |
| Banco | PostgreSQL via Prisma ORM |
| Autenticação | E-mail/senha (JWT + sessões no banco, `scrypt`) |
| Validação | Zod |
| Detecção musical | Spotify Web API (Search) |
| Reprodução | Web Playback SDK oficial do Spotify (Spotify Connect) |

---

## Identidade visual e acessibilidade

A interface segue a fundação visual do **PixTune Brandbook v1.0**:

- Fundo Deep Navy `#070F14` / Black `#03070B`, com verde PixTune `#1ED760` como acento principal.
- CTA primário com o gradiente-assinatura `#1ED760 → #00E0FF`, sempre com texto escuro.
- Tipografia Inter para a interface e Space Grotesk para títulos e marca.
- Componentes com raios, sombras e microinterações curtas (120–180 ms), sem excesso de neon.
- **Configurações → Aparência** oferece modo de alto contraste e redução de animações. As duas preferências ficam salvas no navegador e também respeitam `prefers-reduced-motion`.

O brandbook é uma referência visual. Recursos de ranking, trono, VIP e overlays não fazem parte do escopo atual do produto.

---

## Requisitos

- Node.js 20 ou superior
- npm 9 ou superior
- Internet para buscar faixas e reproduzir pelo Spotify
- Uma conta **Spotify Premium** para o streamer que vai reproduzir

O Spotify não oferece reprodução server-side: o áudio sai do próprio Spotify para o navegador onde o PixTune está aberto.

---

## Início rápido

```bash
# 1. Instalar dependências
npm install

# 2. Criar o arquivo de ambiente
copy .env.example .env        # Windows
# cp .env.example .env        # Linux/macOS

# 3. Criar/sincronizar o banco SQLite
npm run db:push

# 4. Subir frontend + backend juntos
npm run dev
```

- Frontend: http://localhost:3000
- Backend: http://localhost:3001
- Health check: http://localhost:3001/health

> Se preferir processos separados, use `npm run dev:server` e `npm run dev:client` em dois terminais.

O backend carrega o arquivo `.env` automaticamente, sem depender de `dotenv`. Variáveis já definidas no processo têm prioridade.

### Variáveis mínimas (`.env`)

```env
DATABASE_URL="file:./prisma/dev.db"
JWT_SECRET="troque-por-uma-chave-longa-e-aleatoria"
NODE_ENV=development
```

### Conectar a conta do Spotify (OAuth 2.0 + Web Playback SDK)

A seção **Configurações → Spotify** conecta a conta pelo OAuth 2.0 oficial. O servidor guarda o
refresh token e entrega ao navegador apenas um access token de curta duração, necessário para
registrar o dispositivo Spotify Connect criado pelo Web Playback SDK.

Como configurar:

1. Abra o [Spotify for Developers](https://developer.spotify.com/dashboard) e crie um app.
2. Em **Redirect URIs**, cadastre exatamente:
   - `http://localhost:3001/api/spotify/callback`
3. Copie o **Client ID** e o **Client Secret** para o `.env` e reinicie a API:

```env
SPOTIFY_CLIENT_ID="seu-client-id"
SPOTIFY_CLIENT_SECRET="seu-client-secret"
SPOTIFY_REDIRECT_URI="http://localhost:3001/api/spotify/callback"
```

4. Entre no PixTune, abra **Configurações → Spotify** e clique em **Conectar conta do Spotify**.
5. Confirme que a conta exibida é **Premium**.

> **Modo de desenvolvimento:** o Spotify autoriza no máximo 5 contas por app. Para atender mais
> streamers, cada instalação pode usar credenciais próprias ou o app precisa de aprovação do Spotify.
> O uso em transmissão pública/comercial é restrito pelos termos do Spotify; o PixTune usa apenas
> APIs oficiais, mas a conta/app podem ser limitados.

As credenciais do Live Pix são informadas em **Configurações → Live Pix** e ficam no banco local
(SQLite). Nenhuma credencial real vem preenchida no repositório.

### Hospedagem

O frontend é estático (`dist/client`) e pode ser servido por qualquer host de arquivos estáticos.
O backend (Hono + Prisma/SQLite + webhooks do Live Pix) precisa de um runtime Node e **não** roda
em host estático. Inclua o domínio do frontend em `CORS_ORIGINS` no `.env` da API.

---

## Scripts

| Script | Descrição |
|--------|-----------|
| `npm run dev` | Sobe API (`3001`) e frontend (`3000`) juntos |
| `npm run dev:client` | Apenas frontend (Vite) |
| `npm run dev:server` | Apenas backend (tsx) |
| `npm run build` | Build de produção (cliente + servidor) |
| `npm start` | Executa o build do servidor |
| `npm run typecheck` | Checagem de tipos do cliente e do servidor |
| `npm test` | Testes unitários (Vitest) |
| `npm run lint` | ESLint |
| `npm run format` | Prettier |
| `npm run db:push` | Sincroniza o schema Prisma com o SQLite |
| `npm run db:studio` | Abre o Prisma Studio |

---

## Estrutura

```
src/
├── client/                  # Frontend
│   ├── api/client.ts        # Cliente HTTP tipado (Bearer token)
│   ├── components/          # UI e proteção de rotas
│   ├── contexts/            # AuthContext
│   ├── layouts/             # PublicLayout, AppLayout
│   ├── player/              # SpotifyAudioPlayer (Web Playback SDK oficial)
│   └── pages/               # Landing, Login, Register, Dashboard, Fila, Histórico, Regras, Configurações
├── shared/                  # Tipos, utilitários e parsing de links do Spotify
└── server/                  # Backend Hono
    ├── env.ts               # Carregamento simples do .env
    ├── index.ts             # App, CORS e montagem das rotas
    ├── main.ts              # Adaptador Node HTTP
    ├── lib/prisma.ts
    ├── middleware/auth.ts   # JWT + sessão + isolamento por userId
    ├── routes/              # auth, donations, queue, music, settings, rules, spotify
    └── services/            # auth, googleOAuth, livepix, rules, spotify, spotifySongRequest
 prisma/schema.prisma         # User, Session, Settings, Integration, DonationEvent, DonationRule, QueueItem...
```

---

## Autenticação e isolamento

- Cadastro/login reais com e-mail e senha.
- Senha armazenada como hash `scrypt` (salt + chave), nunca em texto puro.
- JWT assinado com `JWT_SECRET`; a sessão correspondente é gravada na tabela `Session`.
- Toda rota autenticada valida o JWT **e** a sessão no banco.
- Todas as consultas usam o `userId` da sessão: um streamer não acessa dados de outro.
- O token fica em `localStorage` (chave `pixtune_token`). Em produção com alto requisito de segurança, prefira cookie `httpOnly` + CSRF (ver Limitações).

---

## Integração com o Live Pix

### Como funciona

1. O streamer cria a conta e abre **Configurações → Live Pix**.
2. O PixTune gera uma **URL de webhook exclusiva da conta**, no formato:

   ```
   https://SEU-DOMINIO/api/donations/webhook/<token>
   ```

   O token identifica o streamer; é ele que permite associar a doação ao usuário correto.
3. O streamer cria uma aplicação OAuth2 no painel do LivePix (livepix.gg), informa o
   **Client ID** e o **Client Secret** em **Configurações → Live Pix** e cola a URL de
   webhook no painel do LivePix.
4. Ao receber um webhook oficial (`event: "new"`, `resource.type: "message"` ou
   `"payment"`), o backend:
   - resolve o streamer pelo token;
   - consulta os detalhes da mensagem/pagamento na API oficial do LivePix;
   - grava o evento (`DonationEvent`) e evita duplicidade por `livepixEventId`;
   - detecta a música escrita na mensagem;
   - ignora mensagens que não são pedidos musicais;
   - coloca a faixa na fila por prioridade de valor; se for a maior, derruba a atual e toca na hora;
   - registra `processed`, `ignored` ou `failed`.

### Status, teste e desconexão

- **Salvar configuração** valida as credenciais na hora: o backend emite/usa o token
  OAuth2 e consulta `GET /v2/account`. Se o LivePix recusar, nada é salvo e o motivo
  aparece no formulário. Se o campo **Client Secret** for enviado em branco, o secret já
  salvo é mantido (o servidor nunca devolve o secret para o navegador).
- O status **Conectado** só aparece quando as credenciais já foram aceitas pelo LivePix.
  A tela mostra a conta autenticada (`@usuario`) e a data da última verificação.
- **Testar conexão** (`POST /api/donations/config/verify`) revalida na hora; enquanto o
  token em cache for válido, nenhum token novo é emitido (respeita o limite do LivePix).
- **Desconectar** (`POST /api/donations/config/disconnect`) apaga Client ID, Client
  Secret e tokens do banco, marca a integração como inativa (o webhook passa a responder
  `503`) e tenta remover no LivePix o webhook desta instalação. A URL de webhook é
  mantida: ao reconectar, a mesma URL volta a funcionar sem precisar cadastrá-la de novo.

### Prioridade por valor é a regra do sistema

A música **não** vem de uma URL fixa. Ela vem da mensagem do doador.

O PixTune não usa palavras-chave, regras de comando, cooldown ou limite por hora.
A única regra de reprodução é o valor da doação, calculado pelo `amountCents`:

1. a maior doação pendente toca primeiro;
2. se a nova doação for maior que a música atual, ela derruba a atual (`skipped`) e começa na hora;
3. valores iguais não derrubam: vale a ordem de chegada (FIFO);
4. músicas adicionadas manualmente pelo streamer valem 0 e ficam depois das doações.

O streamer pode definir apenas o **valor mínimo inicial** na página **Regras**.
O valor de cada doação é imutável e não há botão para reordenar a fila por valor.
A página **Regras** mostra a regra padrão e permite editar o valor mínimo inicial, sem
criação de regras personalizadas, campos de palavras-chave ou ações de comando.

“Voltar” fica bloqueado para músicas doadas, e a rota de embaralhar afeta apenas
músicas manuais, para não furar a prioridade.

### Provedor suportado

- **LivePix** (`livepix.gg`): OAuth2 (`clientId` / `clientSecret`), API oficial em
  `https://api.livepix.gg/v2/*` e token em `https://oauth.livepix.gg/oauth2/token`.

Não existe “LivePix CC” nem o domínio `livepix.cc`. A integração usa exclusivamente o
LivePix em **livepix.gg**. O cliente fica em `src/server/services/livepix.ts` e segue a
documentação oficial em `https://docs.livepix.gg/api`.

O webhook oficial do LivePix é “magro”: ele envia somente `event`, `resource.id`,
`resource.reference` e `resource.type`. Por isso o PixTune consulta
`GET /v2/messages/{id}` ou `GET /v2/payments/{id}` com as credenciais OAuth2 do
streamer antes de processar a doação. As credenciais precisam ter os escopos
`account:read`, `messages:read`, `payments:read` e `webhooks`.

### Teste local sem o Live Pix

Existe um endpoint de simulação (desabilitado em produção) que executa **o mesmo pipeline real** (grava no banco, evita duplicidade, detecta a música e aplica a prioridade por valor):

```bash
curl -X POST http://localhost:3001/api/donations/simulate \
  -H "Authorization: Bearer SEU_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"amount": 7.5, "donorName": "Maria", "message": "toca Evidências"}'
```

Resposta esperada (com a conta do Spotify conectada):

```json
{
  "success": true,
  "data": {
    "status": "processed",
    "songTitle": "Evidências",
    "songArtist": "Chitãozinho & Xororó",
    "spotifyTrackId": "4cOdK2wGLETKBW3PvgPWqT",
    "queueItemStatus": "playing",
    "detectionNote": null
  }
}
```

Se a conta do Spotify ainda não estiver conectada, o pedido é registrado como
`failed` com uma mensagem pedindo a conexão; nenhuma faixa é enfileirada.

Teste uma mensagem que não é música:

```bash
curl -X POST http://localhost:3001/api/donations/simulate \
  -H "Authorization: Bearer SEU_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"amount": 5, "donorName": "João", "message": "manda PIZZA!"}'
```

Resposta esperada: `status: "ignored"` e nenhum item na fila.

Também é possível chamar o webhook diretamente. O formato oficial do LivePix envia
apenas os identificadores:

```bash
curl -X POST http://localhost:3001/api/donations/webhook/SEU_WEBHOOK_TOKEN \
  -H "Content-Type: application/json" \
  -d '{"event":"new","resource":{"id":"ID_DA_MENSAGEM","reference":"ref","type":"message"}}'
```

Para esse caminho funcionar, o streamer precisa ter Client ID e Client Secret válidos
configurados, pois o PixTune consulta os detalhes na API oficial. O formato normalizado
abaixo também é aceito para testes locais e executa o mesmo pipeline:

```bash
curl -X POST http://localhost:3001/api/donations/webhook/SEU_WEBHOOK_TOKEN \
  -H "Content-Type: application/json" \
  -d '{"event":"message","data":{"id":"evt_123","username":"João","message":"toca Despacito","amount":10,"currency":"BRL","proof":"pix"}}'
```

Reenviar o mesmo `data.id` retorna `status: "duplicate"` e **não** gera item duplicado na fila.

> O texto da mensagem no LivePix tem limite de 32 caracteres. Pedidos muito longos devem
> ser evitados; o PixTune também descarta mensagens com mais de 120 caracteres ou
> palavras demais.

### Expor o webhook localmente

O Live Pix precisa alcançar seu servidor. Em desenvolvimento, use um túnel público (gratuito), por exemplo:

```bash
ngrok http 3001
```

Cadastre no Live Pix a URL `https://<subdominio>.ngrok-free.app/api/donations/webhook/<token>`.

### Limitações da integração

- **Webhook “magro”**: o LivePix não envia valor nem mensagem no corpo do webhook; o PixTune consulta os detalhes na API oficial. Sem credenciais OAuth2 válidas (com `messages:read` / `payments:read`), o webhook responde `503` e o LivePix tenta novamente.
- **Assinatura de webhook**: a autenticidade é garantida pelo token secreto na URL. O LivePix não documenta uma assinatura HMAC para o webhook; o campo `webhookSecret` existe, mas não é usado para validar headers.
- Webhooks só funcionam se o provedor/plano oferecer esse recurso. Caso contrário, é necessário um conector de polling usando a API oficial (`GET /v2/messages`).
- Sem URL pública (ngrok ou deploy), o LivePix não consegue entregar eventos.
- O projeto não movimenta dinheiro nem acessa dados bancários.

### Deploy

- `npm run build` gera o cliente em `dist/client` e o servidor em `dist/server`; `npm start` sobe apenas a API.
- Sirva `dist/client` em um host estático (ou configure o Hono para servir os arquivos) e ajuste o CORS em `src/server/index.ts` para o domínio público. Hoje o CORS aceita apenas `localhost:3000`.
- Em produção, use HTTPS, um `JWT_SECRET` forte e nunca versione o `.env`.

---

## Detecção e reprodução musical

### Detecção

1. A mensagem é normalizada (acentos, caixa, pontuação e emojis).
2. Verbos de pedido e saudações são removidos.
3. Mensagens vazias, longas demais, só com números ou presentes em uma lista de conversa comum são descartadas.
4. Se houver um link, URI ou ID de faixa do Spotify, ele é usado diretamente.
5. Caso contrário, o nome é buscado pela **Spotify Web API (Search)**.
6. O resultado precisa ter título e artista fortemente relacionados ao pedido. Karaokê, cover, tributo e instrumental recebem penalidade.
7. Links do YouTube não são aceitos como pedido de música; o doador precisa usar o nome ou um link do Spotify.

### Reprodução

- A reprodução usa o **Web Playback SDK oficial do Spotify**. O SDK registra um dispositivo Spotify Connect no navegador e entrega somente áudio.
- A conta do streamer precisa ser **Spotify Premium**. Contas gratuitas não reproduzem pelo Web Playback SDK.
- O áudio sai do próprio Spotify para o navegador; o servidor não baixa, extrai, armazena nem contorna a proteção do áudio.
- O backend controla o estado da fila (`play`, `pause`, `next-track`, `ended`) e o cliente sincroniza o player a cada poucos segundos.
- Ao terminar uma faixa, a **maior doação pendente** é promovida automaticamente, não a mais antiga.
- Se uma doação maior chegar enquanto outra música toca, a menor é marcada como `skipped` e a maior começa imediatamente. A música derrubada não volta para a fila.
- Se **Reprodução automática** estiver ativa e o player estiver parado, a doação de maior valor inicia a fila.
- É necessário ter internet e manter a aba do PixTune aberta e audível durante a live. O navegador pode bloquear o autoplay até o primeiro clique em **Play**.
- O player do PixTune não aparece como um player de vídeo; ele é um dispositivo Spotify Connect controlado pela página.

### Prioridade por valor

A prioridade é calculada exclusivamente por `DonationEvent.amountCents` e segue
estas regras, implementadas em `src/server/services/queuePriority.ts`:

| Situação | Resultado |
|----------|-----------|
| Nova doação maior que a música atual | A atual vira `skipped` e a nova toca imediatamente |
| Nova doação menor ou igual | Entra como `pending` na posição de valor correspondente |
| Valores iguais | Quem chegou primeiro toca primeiro (FIFO) |
| Música atual termina | A maior doação pendente do Spotify toca em seguida |
| Música manual ou importada de playlist | Vale 0 e fica depois das doações |

O valor mínimo inicial é a única configuração do streamer para a prioridade. O
valor da doação em si não pode ser editado, aumentado ou reordenado pela interface.
As rotas de reordenação recusam alterar itens de doação, e “voltar” fica bloqueado
para músicas doadas e enquanto houver doações pendentes.

> **Uso em live:** os termos do Spotify restringem transmissões públicas/comerciais
> e a sincronização de música com mídia visual. O PixTune usa apenas APIs oficiais,
> mas a conta ou o aplicativo podem ser limitados ou suspensos pelo Spotify. Avalie
> esse risco antes de usar em produção.

### Limitações da detecção

- É uma heurística, não um classificador semântico. Frases ambíguas podem ser ignoradas.
- A lista de mensagens comuns é conservadora e pode ser ajustada em `src/server/services/songRequest.ts`.
- Nomes de músicas que coincidem com comida/conversa (por exemplo, “Pizza”) só são aceitos quando há contexto suficiente, como o artista na mensagem.
- O Spotify pode não ter determinada música ou a faixa pode não estar disponível no mercado da conta; nesse caso o pedido é registrado como `failed` e não entra na fila.
- O app do Spotify em **modo de desenvolvimento** aceita no máximo 5 usuários autenticados. Para mais streamers, é necessário um app aprovado pelo Spotify ou credenciais por instalação.
- A reprodução depende de o navegador suportar o Web Playback SDK e DRM/Widevine, além de a aba permanecer aberta.

---

## Segurança

- Senhas com `scrypt` (salt aleatório por usuário).
- JWT + sessão persistida; logout remove a sessão.
- Validação de entrada com Zod.
- Segredos apenas no backend; o frontend nunca recebe `passwordHash`, `clientSecret` ou tokens de terceiros.
- O `SPOTIFY_CLIENT_SECRET` fica no `.env` do servidor e nunca é enviado ao navegador.
- Na conexão do Spotify (OAuth 2.0), o `client_secret` fica só no servidor; o navegador recebe apenas a URL de autorização. O `state` é assinado (JWT) e vinculado a um cookie `HttpOnly` anti-CSRF.
- O refresh token do Spotify fica no banco local. O navegador recebe apenas access tokens de curta duração para o Web Playback SDK.
- As credenciais do Live Pix ficam no banco local em texto simples (metadata da integração). Para produção, criptografe esses campos ou use um cofre de segredos.
- `.env` fora do Git; `.env.example` sem credenciais.
- Mensagens de erro de login não revelam se o e-mail existe.

---

## Testes e verificação

```bash
npm test            # testes unitários
npm run typecheck   # cliente + servidor
npm run build       # build de produção
```

Os testes unitários cobrem:

- prioridade por valor: maior primeiro, empate FIFO, pré-empção estrita, item sem faixa e fila parada;
- motor legado de regras mantido por compatibilidade (não usado no fluxo de doações);
- formatadores compartilhados;
- parsing de links, URIs e IDs de faixa/playlist do Spotify;
- parsing da mensagem e blocklist de conversa comum;
- detecção de pedidos por link ou nome no Spotify e rejeição de links do YouTube;
- OAuth, busca, normalização e paginação de playlists do Spotify;
- configuração e mapeamento do LivePix oficial;
- serviço legado de OAuth do Google, mantido apenas por compatibilidade.

Testes E2E automatizados (Playwright) ainda não estão implementados. O fluxo foi
verificado manualmente via API e navegador: cadastro, login, sessão, isolamento,
prioridade por valor, simulação de doação, fila, estados de conexão do Spotify e
renderização das páginas. A reprodução real do Spotify depende de credenciais
válidas e de uma conta Premium no ambiente do streamer.

---

## Avisos

- PixTune não é afiliado ao Spotify, Live Pix ou qualquer outro provedor citado.
- Não reproduza conteúdo protegido por métodos não permitidos.
- Respeite a documentação e os termos de cada provedor.
- O uso do Spotify em transmissões públicas ou comerciais é restrito pelos termos do Spotify; o PixTune não contorna essas regras.

## Licença

MIT
