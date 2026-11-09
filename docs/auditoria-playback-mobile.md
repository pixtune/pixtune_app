# Auditoria e correção do Playback Error no mobile

Data: 2026-11-09  
Escopo: reprodução de música via Spotify Web Playback SDK no PixTune, com foco em
Android/iOS, sem regressão no desktop e sem alterar a integração Live Pix.

## Resumo executivo

O erro **“Playback Error”** não tinha uma causa única. A investigação encontrou
uma combinação de:

1. tentativa de iniciar áudio no celular sem um gesto do usuário;
2. envio de `play` antes de o dispositivo Connect estar registrado;
3. token renovado sem `force` real depois de um 401;
4. polling e avanço automático iniciando a mesma faixa em paralelo;
5. ausência de reconexão quando o Spotify removia o dispositivo (comum quando a
   aba fica em segundo plano no celular);
6. mensagens genéricas que não diferenciavam autoplay, Premium, dispositivo,
   DRM, sessão e faixa restrita.

A correção não contorna o Spotify nem simula reprodução. Ela usa o SDK/Connect
oficial, respeita a política de autoplay dos navegadores e só marca a faixa como
tocando depois que o Spotify aceita o comando; o estado real do SDK continua
corrigindo a interface.

Também foi corrigida a causa do erro de cookie de segurança no OAuth: o cookie
nonce é host-only, então o `redirect_uri` de login e de conexão precisa ficar no
mesmo host do `APP_URL` (proxy `/api` do Cloudflare Pages), com o caminho certo
para cada fluxo.

## Causa raiz detalhada

### 1. Autoplay no mobile

Navegadores móveis (especialmente iOS/Safari) bloqueiam áudio iniciado sem
interação. O player antigo chamava `play` no carregamento, no polling e no
avanço automático, sem `activateElement()` dentro de um gesto. O SDK emitia
`playback_error`, a interface mostrava “Playback Error” e o polling tentava de
novo a cada 4 segundos, criando um loop de erros.

Correção: `activateElement()` é chamado de forma **síncrona** no clique de
Play/Pular/Anterior e no primeiro toque/tecla da página. No mobile, o player não
tenta autoplay antes disso. Se o navegador bloquear, os retries automáticos
param e a interface pede “Toque em Play”.

### 2. Dispositivo Connect ainda não registrado

O `PUT /me/player/play` podia chegar antes de o Web Playback SDK terminar o
`connect()` e registrar o device. O Spotify respondia 404/“Device not found”.
Não havia retry nem transferência explícita de playback.

Correção: o player aguarda o device, tenta novamente com pequeno backoff e usa
`PUT /me/player` para transferir a reprodução quando necessário. O botão só
habilita quando o player está pronto.

### 3. Token 401 sem renovação real

O cliente chamava `POST /api/spotify/token` com `{ force: true }` no corpo, mas
o servidor antigo só lia `?force=1` na query. Depois de um 401, o SDK podia
receber o mesmo token recusado e continuar falhando.

Correção: o cliente envia `?force=1` **e** o corpo; o servidor lê os dois
formatos. A renovação continua usando o refresh token no servidor, com lock para
evitar refresh concorrente. Nenhum token é exposto em log.

### 4. Corridas entre polling, play e fim de faixa

O polling de 4 segundos, o play do usuário e o avanço automático podiam iniciar
a mesma URI em paralelo. Estados atrasados do SDK podiam encerrar a faixa
seguinte ou marcar a faixa errada como tocando.

Correção:

- deduplicação de `play` por URI (a mesma faixa reaproveita a promessa em
  andamento);
- comparação entre a URI carregada e a URI do estado do SDK antes de encerrar;
- guarda contra fim duplicado;
- distinção entre “faixa carregada” e “faixa realmente iniciada”
  (`startedUriRef`), para não usar `resume()` no primeiro play do celular;
- atualização otimista da UI somente após o Spotify aceitar o comando; eventos
  `player_state_changed` e `playback_error` corrigem o estado real.

### 5. Falta de reconexão

Quando o Spotify removia o device (troca de aba, suspensão do navegador, troca
de rede), o player ficava “conectando” para sempre. Não havia backoff,
reconexão ao voltar para a aba nem tratamento de `not_ready`.

Correção: reconexão com backoff (até 6 tentativas), reset ao voltar para a aba,
listeners `ready`, `not_ready`, `visibilitychange` e `online`, e botão “Tentar
novamente” que também aproveita o gesto para liberar o áudio no mobile.

### 6. Cookie nonce do OAuth e host do callback

O nonce do OAuth é um cookie host-only. Se o `redirect_uri` aponta para
`onrender.com` enquanto o app está em `pages.dev`, o navegador envia o callback
para outro host e o cookie não chega. O login também estava usando o caminho do
fluxo de conexão (`/api/spotify/callback`) em vez do caminho de login
(`/api/auth/spotify/callback`).

Correção:

- cookie por tentativa (`pixtune_oauth_<attemptId>`), com `attemptId` e `nonce`
  no state JWT;
- `SameSite=Lax` e `Secure` em produção;
- `APP_URL` obrigatório em produção;
- validação de **hostname e pathname** do `redirect_uri`; se divergir, o código
  usa o fallback no domínio do `APP_URL` e registra um evento de diagnóstico;
- a validação de `state` continua ativa; cookie ausente continua rejeitado.

### 7. Diagnóstico incorreto de “SDK não suporta mobile”

O Web Playback SDK é oficialmente suportado em navegadores mobile dentro das
limitações de autoplay do sistema. O problema era de gesto/estado, não de
ausência de suporte. Não foi necessário trocar o Spotify por outro serviço,
alterar a arquitetura ou mexer na integração Live Pix.

## Arquivos alterados

| Arquivo | Mudança |
| --- | --- |
| `src/client/player/playbackPolicy.ts` | Políticas puras de mobile/autoplay, backoff e tradução de erros. |
| `src/client/player/playbackPolicy.test.ts` | 13 testes das políticas e classificadores. |
| `src/client/player/SpotifyAudioPlayer.tsx` | Player reescrito: init única, ativação por gesto, device/transfer, retry, token force, reconexão, guards de URI e mensagens. |
| `src/client/api/client.ts` | `apiSpotify.token(force)` envia `force=1` na query e no corpo. |
| `src/server/routes/spotify.ts` | `/token` lê `force` da query e do corpo. |
| `src/server/services/spotify.ts` | `resolveCallbackUri` valida host e path; fallback seguro e logs. |
| `src/server/services/spotify.test.ts` | Testes de `APP_URL`, host divergente e path divergente. |
| `src/client/pages/dashboard/DashboardPage.tsx` | Card “Agora tocando” responsivo, loading, aviso de autoplay, erro com retry. |
| `src/client/layouts/AppLayout.tsx` | Indicador do player considera erro de conta e necessidade de ativação. |
| `src/client/pages/dashboard/QueuePage.tsx` | Avisos de conta/ativação e retomada correta da faixa atual. |
| `src/client/pages/dashboard/SpotifySettings.tsx` | Orientação sobre Premium mobile e toque em Play. |

Nenhuma alteração em `README.md`, na integração Live Pix, no schema do banco ou
nas dependências.

## Comportamento por plataforma

| Situação | Desktop | Android | iOS/Safari |
| --- | --- | --- | --- |
| Autoplay ao abrir | Tenta; se o navegador bloquear, pede Play | Não tenta antes de um gesto | Não tenta antes de um gesto |
| Primeiro Play | Usa o SDK normalmente | `activateElement()` no toque e inicia | `activateElement()` no toque e inicia |
| Pausar/retomar | `pause()`/`resume()` | `pause()`/`resume()` | `pause()`/`resume()` |
| Trocar faixa | Play da nova URI | Play da nova URI | Play da nova URI |
| Voltar para a aba | Reconecta se necessário | Reconecta/reset de tentativas | Reconecta/reset de tentativas |
| Conta sem Premium | Mensagem específica | Mensagem específica | Mensagem específica |

## Testes executados

```text
npm run typecheck   -> OK (client + server)
npm test            -> 13 arquivos, 102 testes, todos passando
npm run build       -> OK (Vite client + tsc server)
```

O `npm run lint` não foi usado porque o projeto não possui arquivo de
configuração do ESLint (comportamento preexistente, não introduzido aqui).

### Testes automatizados relevantes

- detecção de Android/iPhone/iPad e iPadOS disfarçado de MacIntel;
- bloqueio de autoplay mobile até `audioUnlocked`;
- liberação após ativação e bloqueio após falha de ativação;
- backoff exponencial limitado;
- classificação de autoplay, Premium, device, DRM, auth, restrição e rate limit;
- prioridade de restrição sobre o prefixo genérico “Player command failed”;
- configuração de callbacks com `APP_URL`, host divergente e path divergente.

### O que não foi possível testar aqui

- reprodução real em aparelho físico Android/iOS;
- conta Spotify Premium real;
- comportamento de tela bloqueada/áudio em segundo plano;
- Spotify Dashboard e variáveis do Render/Pages em produção.

Esses itens estão no checklist manual abaixo. Nenhum deploy foi feito e nenhuma
configuração externa foi alterada automaticamente.

## Instruções de deploy

Ordem recomendada: Spotify Dashboard → Render → Cloudflare Pages. Não é
necessário rodar migration para esta correção.

### 1. Spotify Developer Dashboard

No app usado pelo PixTune, cadastre **exatamente** as duas Redirect URIs:

```text
https://pixtune-app.pages.dev/api/auth/spotify/callback
https://pixtune-app.pages.dev/api/spotify/callback
```

- A primeira é o login OAuth.
- A segunda é a conexão da conta do Spotify nas configurações.
- Se houver domínio customizado, cadastre também as URLs equivalentes.
- Salve antes de testar o login; uma URI não cadastrada faz o Spotify recusar o
  `authorize` antes mesmo do callback.

### 2. Render (API)

Variáveis esperadas (Production):

```text
NODE_ENV=production
APP_URL=https://pixtune-app.pages.dev
API_URL=https://pixtune-app.onrender.com
CORS_ORIGINS=https://pixtune-app.pages.dev
SPOTIFY_REDIRECT_URI=https://pixtune-app.pages.dev/api/auth/spotify/callback
SPOTIFY_CONNECT_REDIRECT_URI=https://pixtune-app.pages.dev/api/spotify/callback
```

- Mantenha `DATABASE_URL`, `JWT_SECRET`, `SPOTIFY_CLIENT_ID` e
  `SPOTIFY_CLIENT_SECRET` como secrets no painel; não versionar.
- `API_URL` e `APP_URL` não devem ter `/api` nem barra final.
- Faça o deploy da API. O build já roda `prisma migrate deploy`.
- Se o log mostrar `spotify.redirect_uri_host_mismatch` ou
  `spotify.redirect_uri_path_mismatch`, a env está divergente; o código usa o
  fallback, mas corrija a variável para não depender dele.

### 3. Cloudflare Pages (frontend)

Em **Settings → Variables and secrets → Production**:

```text
API_ORIGIN=https://pixtune-app.onrender.com
```

- Sem `/api` e sem barra final. O proxy preserva o caminho recebido.
- **Não** definir `VITE_API_URL` com a URL do Render. Deixe vazio/ausente para o
  cliente usar `/api` na mesma origem e manter os cookies first-party.
- Clique em **Save** e faça um novo deploy (ou “Retry deployment”).
- Confirme que o domínio de produção do Pages está em `CORS_ORIGINS` no Render.

Teste do proxy:

```text
https://pixtune-app.pages.dev/api/health
```

A resposta deve vir da API do Render sem sair do domínio `pages.dev`.

## Checklist manual pós-deploy

### Login/OAuth

- [ ] Abrir `https://pixtune-app.pages.dev` e fazer login no PixTune.
- [ ] Configurações → Spotify → conectar a conta.
- [ ] Confirmar que o callback permanece em `pages.dev` (não salta para
      `onrender.com`).
- [ ] Confirmar que não aparece “cookie de segurança não chegou ao servidor”.
- [ ] Recarregar a página e confirmar que a conexão persiste.

### Desktop (sem regressão)

- [ ] Player conecta e aparece como “Conectado”.
- [ ] Play/pause funciona.
- [ ] Próxima/anterior funciona.
- [ ] Trocar faixa pela fila funciona.
- [ ] Volume funciona e persiste.
- [ ] Transferir playback para outro device Spotify e voltar funciona.
- [ ] Sem erros repetidos no console.

### Android (Chrome)

- [ ] Abrir o dashboard e confirmar que o áudio **não** começa sozinho.
- [ ] Tocar em Play: o áudio começa após o gesto.
- [ ] Pausar/retomar mantém a posição.
- [ ] Trocar de faixa inicia a nova faixa.
- [ ] Bloquear/desbloquear a tela e voltar ao navegador: player reconecta.
- [ ] Alternar Wi-Fi/4G: player reconecta ou mostra “Tentar novamente”.
- [ ] Conta sem Premium mostra a mensagem específica, sem loop.

### iOS (Safari)

- [ ] Mesmo fluxo do Android, tocando em Play após a página abrir.
- [ ] Confirmar que o primeiro Play não mostra “Playback Error”.
- [ ] Testar pausa/retomada e troca de faixa.
- [ ] Voltar de segundo plano e confirmar reconexão.
- [ ] Se o áudio não iniciar, tocar em Play novamente (limitação de gesto do
      iOS; o app não simula reprodução).

### Diagnóstico

- [ ] Console sem tokens, Client Secret ou Authorization header.
- [ ] Logs do Render sem `redirect_uri_host_mismatch`/`path_mismatch` em uso
      normal.
- [ ] `/api/health` responde pelo proxy do Pages.

## Rollback

Se for necessário reverter:

1. Reverter o commit desta correção e fazer deploy da API no Render.
2. Fazer novo deploy do frontend no Pages.
3. Manter as Redirect URIs e as envs `APP_URL`, `API_URL` e `CORS_ORIGINS`; o
   código anterior continua compatível com elas.

Não é necessário reverter dados, migrations ou a integração Live Pix.

## Observações de segurança

- `state` do OAuth continua validado; cookie ausente continua rejeitado.
- O cookie nonce é host-only, `SameSite=Lax` e `Secure` em produção.
- Tokens do Spotify continuam somente no servidor; o SDK recebe o access token
  via callback e ele não é gravado no relatório nem em logs.
- Nenhuma credencial real foi incluída neste documento.
