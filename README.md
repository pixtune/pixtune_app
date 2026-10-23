# PixTune

Plataforma musical para streamers que transforma a **mensagem da doação do Live Pix** em música.

O doador escreve o nome da música na mensagem da doação. O PixTune detecta o pedido, busca o vídeo no YouTube e coloca a faixa na fila. Mensagens que não são pedidos de música são ignoradas.

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
iTunes Search valida o nome da música
        ↓
YouTube Data API encontra o vídeo (se a chave estiver configurada)
        ↓
A maior doação assume a frente (derruba a menor)
        ↓
Player oficial do YouTube reproduz somente o áudio
```

- **Prioridade imutável por valor:** a doação de maior valor sempre toca primeiro. Se ela chegar enquanto uma música de menor valor está tocando, a menor é interrompida na hora e a maior começa imediatamente. Em valores iguais, vale a ordem de chegada.
- O streamer define apenas o **valor mínimo inicial** na página **Regras**. O valor de cada doação vem do Live Pix e é fixo: não há como reordenar, aumentar ou trocar a prioridade manualmente.
- Verbos comuns são removidos: `toca`, `coloca`, `quero ouvir`, `play`, `dj`, `por favor`, entre outros.
- Mensagens como `pizza`, `boa noite`, `obrigado`, `oi`, `essa é top` e `manda ver` são descartadas.
- Um link ou ID do YouTube na mensagem é aceito diretamente.
- Se a música for detectada mas ainda não houver vídeo, o pedido entra na fila como **“aguardando link”**. Você pode anexar o link pela página **Fila**.

A detecção é heurística. Ela foi feita para ser previsível e conservadora, não para adivinhar intenção em frases ambíguas. Veja [Limitações da detecção](#limitações-da-detecção).

---

## Stack

| Camada | Tecnologia |
|--------|------------|
| Frontend | React 18 + TypeScript + Vite + Tailwind CSS |
| Estado | Context API |
| Roteamento | React Router 6 |
| Backend | Hono (Node.js puro) |
| Banco | SQLite via Prisma ORM |
| Autenticação | E-mail/senha (JWT + sessões no banco, `scrypt`) |
| Validação | Zod |
| Detecção musical | iTunes Search API + YouTube Data API v3 |
| Reprodução | IFrame Player API oficial do YouTube (áudio) |

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
- Internet para detectar músicas e reproduzir o YouTube

Não é necessário cartão de crédito nem serviços pagos para rodar localmente. A chave da YouTube Data API é gratuita, mas tem cota diária.

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

### Chave do YouTube (recomendada)

A reprodução usa o player oficial e **não precisa de chave**. A chave é usada apenas para transformar o nome da música em um vídeo do YouTube.

```env
YOUTUBE_API_KEY="sua-chave-da-youtube-data-api-v3"
```

Como obter gratuitamente:

1. Abra o [Google Cloud Console](https://console.cloud.google.com/).
2. Crie um projeto.
3. Ative a **YouTube Data API v3**.
4. Crie uma **API key** em “Credenciais”.
5. Cole a chave em `YOUTUBE_API_KEY` e reinicie a API.

A cota gratuita padrão é de 10.000 unidades por dia. Cada chamada de `search.list` custa 100 unidades. Para um volume alto de pedidos, considere cache ou uma estratégia de busca própria.

**Sem a chave**, o PixTune ainda detecta a música pelo iTunes e coloca o pedido na fila como “aguardando link”. A página **Fila** permite anexar o link manualmente. A tela **Configurações → Música** mostra um aviso quando a chave não está configurada.

As credenciais do Live Pix são informadas em **Configurações → Live Pix** e ficam no banco local (SQLite). Nenhuma credencial real vem preenchida no repositório.

### Conectar a conta do YouTube (OAuth 2.0)

A seção **Configurações → YouTube** conecta o canal via OAuth 2.0 oficial do Google e autoriza a
**leitura** dos dados do canal (nome, avatar, inscritos). Os tokens ficam no banco local. Este OAuth
é separado do login: serve apenas para ler o canal.

> Importante: não existe API oficial para “tocar como o usuário logado”. A reprodução continua pela
> IFrame Player API oficial e já funciona sem login. A conexão **não** dá acesso a YouTube Music,
> biblioteca do YT Music, remoção de anúncios ou restrições de idade/região. A conta usada na
> reprodução é a do **navegador** (sessão do `youtube.com`) — veja [Reprodução](#reprodução).

Como configurar (gratuito):

1. No [Google Cloud Console](https://console.cloud.google.com/), crie um projeto e ative a **YouTube Data API v3**.
2. Em **Tela de consentimento OAuth**, escolha “Externo”, preencha os dados e adicione sua conta como **usuário de teste**.
3. Adicione o escopo `https://www.googleapis.com/auth/youtube.readonly`.
4. Em **Credenciais**, crie um **ID do cliente OAuth** do tipo **Aplicativo da Web**.
5. Cadastre exatamente esta **URI de redirecionamento autorizado**:
   - `http://localhost:3001/api/youtube/callback`
6. Cole os valores no `.env` e reinicie a API:

```env
YOUTUBE_CLIENT_ID="seu-client-id.apps.googleusercontent.com"
YOUTUBE_CLIENT_SECRET="seu-client-secret"
```

Sem esses valores, a seção **Configurações → YouTube** aparece desativada com o passo a passo.
Escopos do YouTube são sensíveis/restritos: para uso público o Google exige verificação do app; em
modo de teste apenas os usuários de teste autorizam.

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
│   ├── player/              # Player global de áudio do YouTube
│   └── pages/               # Landing, Login, Register, Dashboard, Fila, Histórico, Regras, Configurações
├── shared/                  # Tipos, utilitários e parsing de links do YouTube
└── server/                  # Backend Hono
    ├── env.ts               # Carregamento simples do .env
    ├── index.ts             # App, CORS e montagem das rotas
    ├── main.ts              # Adaptador Node HTTP
    ├── lib/prisma.ts
    ├── middleware/auth.ts   # JWT + sessão + isolamento por userId
    ├── routes/              # auth, donations, queue, music, settings, rules, youtube
    └── services/            # auth, googleOAuth, livepix, rules, songRequest, youtube
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
   - registra `processed`, `validated` (aguardando link), `ignored` ou `failed`.

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

Resposta esperada (sem chave do YouTube):

```json
{
  "success": true,
  "data": {
    "status": "validated",
    "songTitle": "Evidências",
    "songArtist": "Chitãozinho & Xororó",
    "detectedVideoId": null,
    "queueItemStatus": "pending",
    "detectionNote": "Música detectada, mas a busca no YouTube não está configurada (YOUTUBE_API_KEY)."
  }
}
```

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
4. Se houver um link do YouTube, o próprio link é usado e os metadados vêm do oEmbed público.
5. Caso contrário, o nome é validado pela **iTunes Search API** (pública, sem chave).
6. Com `YOUTUBE_API_KEY`, a **YouTube Data API v3** busca um vídeo de música (`videoCategoryId=10`).
7. O resultado precisa ter título/artista fortemente relacionados ao pedido. Karaokê, cover, tributo e instrumental recebem penalidade.

### Reprodução

- O player oficial é criado em um contêiner fora da tela: o usuário ouve apenas o áudio e o vídeo não aparece.
- A conta usada na reprodução é a do **navegador** (sessão do `youtube.com`), não o login OAuth. Se você estiver logado no YouTube **neste mesmo navegador** e permitir cookies de terceiros do `youtube.com`, o próprio YouTube aplica os benefícios da conta ao player — por exemplo, **Premium sem anúncios** e vídeos com restrição de idade. O player é incorporado a partir de `www.youtube.com` (nunca `youtube-nocookie.com`). O PixTune não lê nem guarda essa sessão; sem os cookies, a música toca normalmente, só sem esses benefícios. Não existe API oficial para “tocar como a conta”.
- Nenhum arquivo é baixado, nenhum áudio é extraído e nenhuma proteção do YouTube é contornada.
- O backend controla o estado da fila (`play`, `pause`, `next-track`, `ended`) e o cliente sincroniza o player a cada poucos segundos.
- Ao terminar um vídeo, a **maior doação pendente** é promovida automaticamente, não a mais antiga.
- Se uma doação maior chegar enquanto outra música toca, a menor é marcada como `skipped` e a maior começa imediatamente. A música derrubada não volta para a fila.
- Se **Reprodução automática** estiver ativa e o player estiver parado, a doação de maior valor inicia a fila.
- É necessário ter internet e manter a aba do PixTune aberta e audível durante a live. O navegador pode bloquear o autoplay até o primeiro clique em **Play**.
- Se um pedido ficar como **“aguardando link”**, use **Fila → Anexar link** para informar a URL do YouTube. Assim que o link for anexado, se aquele pedido for a maior doação, ele derruba a música atual e toca; o histórico é atualizado.

### Prioridade por valor

A prioridade é calculada exclusivamente por `DonationEvent.amountCents` e segue
estas regras, implementadas em `src/server/services/queuePriority.ts`:

| Situação | Resultado |
|----------|-----------|
| Nova doação maior que a música atual | A atual vira `skipped` e a nova toca imediatamente |
| Nova doação menor ou igual | Entra como `pending` na posição de valor correspondente |
| Valores iguais | Quem chegou primeiro toca primeiro (FIFO) |
| Música atual termina | A maior doação pendente com vídeo toca em seguida |
| Doação sem vídeo | Fica “aguardando link”; não derruba a atual até o link ser anexado |
| Música manual | Vale 0 e fica depois das doações |

O valor mínimo inicial é a única configuração do streamer para a prioridade. O
valor da doação em si não pode ser editado, aumentado ou reordenado pela interface.
As rotas de reordenação recusam alterar itens de doação, e “voltar” fica bloqueado
para músicas doadas e enquanto houver doações pendentes.

> A IFrame API não oferece um modo “audio-only” oficial. O PixTune usa o player oficial com o vídeo fora da tela, sem baixar ou separar o stream. Verifique os Termos de Uso do YouTube para o seu caso de uso comercial; para produção, avalie manter o player visível ou usar um serviço/licença adequado.

### Limitações da detecção

- É uma heurística, não um classificador semântico. Frases ambíguas podem ser ignoradas.
- A lista de mensagens comuns é conservadora e pode ser ajustada em `src/server/services/songRequest.ts`.
- Nomes de músicas que coincidem com comida/conversa (por exemplo, “Pizza”) só são aceitos quando há contexto suficiente, como o artista na mensagem.
- O iTunes pode não ter determinada música; nesse caso, a busca direta no YouTube (se configurada) tenta resolver.
- A YouTube Data API tem cota diária. Erros de cota fazem o pedido ficar “aguardando link” em vez de falhar.
- YouTube Music compartilha os mesmos IDs de vídeo; não existe API pública de reprodução específica do YouTube Music neste projeto.

---

## Segurança

- Senhas com `scrypt` (salt aleatório por usuário).
- JWT + sessão persistida; logout remove a sessão.
- Validação de entrada com Zod.
- Segredos apenas no backend; o frontend nunca recebe `passwordHash`, `clientSecret` ou tokens de terceiros.
- A chave do YouTube fica no `.env` do servidor e nunca é enviada ao navegador.
- Na conexão do canal do YouTube (OAuth do Google), o `client_secret` fica só no servidor; o navegador recebe apenas a URL de autorização. O `state` é assinado (JWT) e vinculado a um cookie `HttpOnly` anti-CSRF.
- As credenciais do Live Pix ficam no banco local em texto simples (metadata da integração). O mesmo vale para os tokens de atualização do YouTube. Para produção, criptografe esses campos ou use um cofre de segredos.
- `.env` fora do Git; `.env.example` sem credenciais.
- Mensagens de erro de login não revelam se o e-mail existe.

---

## Testes e verificação

```bash
npm test            # 57 testes unitários
npm run typecheck   # cliente + servidor
npm run build       # build de produção
```

Os testes unitários cobrem:

- prioridade por valor: maior primeiro, empate FIFO, pré-empção estrita, item sem vídeo e fila parada;
- motor legado de regras mantido por compatibilidade (não usado no fluxo de doações);
- formatadores compartilhados;
- extração de IDs de links do YouTube;
- parsing da mensagem, blocklist de conversa comum, pontuação do iTunes e do YouTube;
- detecção com iTunes, busca no YouTube, link direto e fallback sem chave;
- configuração e mapeamento do LivePix oficial;
- OAuth do Google: configuração por variáveis, URIs de callback, assinatura/verificação do `state` e leitura do canal do YouTube.

Testes E2E automatizados (Playwright) ainda não estão implementados. O fluxo completo foi verificado manualmente e via API: cadastro, login, sessão, isolamento, prioridade por valor, simulação de doação com música, simulação de mensagem ignorada, fila, anexação de link e reprodução de áudio no navegador. Também foram validados: 5 → 10 (10 derruba 5), 10 → 7 (7 espera), 20 → 20 (empate espera), derrubada ao anexar link e bloqueio de reprodução manual fora da prioridade.

---

## Avisos

- PixTune não é afiliado ao Spotify, YouTube, iTunes/Apple ou Live Pix.
- Não reproduza conteúdo protegido por métodos não permitidos.
- Respeite a documentação e os termos de cada provedor.
- A decisão de exibir ou ocultar o vídeo do YouTube é sua; verifique os Termos de Uso aplicáveis.

## Licença

MIT
