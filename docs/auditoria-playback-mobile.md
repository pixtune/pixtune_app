# Auditoria e correção do Playback Error no mobile

Data: 2026-11-09 (atualizado em 2026-11-10)  
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

### 8. Android Chrome: modo desktop, `autoplay_failed` e “Playback Error” genérico

O caso reportado em Android + Chrome mostrou a mensagem genérica “Não foi
possível reproduzir no Spotify. Verifique a conexão, o plano Premium...”, mesmo
com conta Premium de plano Família e desktop funcionando. **O plano Família é
aceito pelo Web Playback SDK**; a mensagem é apenas o fallback do app quando não
reconhece a causa real, não uma confirmação de que falta Premium. A investigação
adicional encontrou três lacunas:

1. **Detecção de mobile pelo user agent.** O modo “Site para desktop” do Chrome
   no Android troca o UA por um de Linux/Windows. O app passava a se considerar
   desktop, tentava autoplay sem gesto e o Chrome bloqueava o áudio. Agora a
   detecção também usa `pointer: coarse`, `maxTouchPoints`, largura da viewport
   e `navigator.userAgentData.mobile`.
2. **Evento `autoplay_failed` não era ouvido.** O SDK oficial emite esse evento
   quando o navegador recusa o áudio. Sem ele, o app só via um
   `playback_error` genérico e continuava tentando. Agora o evento zera a
   ativação, para os retries e pede “Toque em Play”.
3. **`audioUnlocked` não era resetado.** Depois de uma falha, um reconnect ou
   uma recriação do player, o app achava que o áudio já estava liberado e não
   chamava `activateElement()` de novo no próximo gesto. Agora toda falha de
   ativação/reconexão invalida esse estado.

Também foi adicionado:

- tratamento do texto literal `Playback Error` do SDK como autoplay no mobile;
- painel “Detalhes técnicos” no erro do dashboard, com a mensagem crua do
  SDK/Web API (sem tokens) para diagnóstico;
- aviso nas Configurações quando a conexão OAuth não tem `streaming`,
  `user-read-playback-state` ou `user-modify-playback-state` (conexões antigas
  precisam ser refeitas).

### 9. Android Chrome + Firefox: DRM/EME e erro genérico “playback error”

O erro continuou aparecendo depois do build novo, tanto no Chrome quanto no
Firefox do mesmo Android, com plano Família e desktop funcionando. Isso reduz a
hipótese de autoplay isolado e aumenta a suspeita de **DRM/EME/Widevine** no
aparelho: o SDK entrega o áudio protegido, e quando o CDM não cria as chaves o
erro chega como o texto literal `playback error`, sem detalhe.

Para separar as causas sem mascarar o erro, foram adicionados:

1. **Probe de DRM real** (`src/client/player/spotifyDiagnostics.ts`):
   `navigator.requestMediaKeySystemAccess('com.widevine.alpha', ...)` e
   `createMediaKeys()` para as configurações padrão, L3 (`SW_SECURE_CRYPTO`) e
   L1 (`HW_SECURE_CRYPTO`), com timeout de 4 s por etapa. O resultado só é
   considerado disponível quando ao menos uma configuração cria `MediaKeys`.
2. **Pré-checagem no Android:** ao conectar, o app roda o probe uma vez. Se
   nenhuma configuração criar `MediaKeys`, mostra a mensagem de DRM/Widevine e
   para os retries automáticos; o detalhe técnico contém a saída crua do probe.
   Em iOS/Safari e desktop o probe não bloqueia a reprodução, porque o key
   system pode não ser Widevine; nesses casos ele só aparece no diagnóstico
   manual.
3. **Diagnóstico no evento:** `initialization_error` e `playback_error` anexam
   a mensagem original do SDK e o resumo do probe ao painel “Detalhes técnicos”.
   Se o probe funciona, o erro de autoplay continua sendo tratado como gesto; se
   não funciona, a causa exibida é DRM.
4. **`activateElement()` observável:** o erro do `activateElement()` não é mais
   engolido; ele é guardado e aparece no diagnóstico como
   `activateElement: <mensagem>`.
5. **Tratamento explícito dos eventos:** `initialization_error`,
   `authentication_error`, `account_error`, `playback_error`,
   `autoplay_failed`, `ready` e `not_ready` registram a mensagem original
   (quando existe) e atualizam o estado do device/reconexão.
6. **Limite de chamadas:** o `PUT /me/player/play` faz no máximo 3 tentativas,
   transfere o device no máximo uma vez e **não repete** 400 (URI/faixa
   inválida), 401, 429, 403 de Premium/restrição/DRM/autoplay. Erros fatais
   bloqueiam o polling de 4 s até um gesto explícito do usuário.
7. **Validação da URI:** a faixa é validada com `extractSpotifyTrackId` antes de
   chamar a API; IDs de episódio/URI inválida mostram “faixa não é uma música
   válida” em vez de um `playback error` genérico.
8. **Painel “Diagnóstico”:** botão no card de erro coleta, em uma execução
   manual, status, refresh de token, devices, playback atual, estado local do
   SDK, elementos `<audio>`, DRM e o erro/ativação. O relatório não inclui
   tokens, Client Secret nem headers de autorização e pode ser copiado.

O desktop mantém o caminho do SDK e não é bloqueado pelo probe. Nenhuma
configuração externa, token ou integração Live Pix foi alterada.

## Arquivos alterados

| Arquivo | Mudança |
| --- | --- |
| `src/client/player/playbackPolicy.ts` | Políticas puras de mobile/autoplay (inclui modo desktop do Android), backoff e tradução de erros, incluindo marcadores reais de Widevine/MediaDrm. |
| `src/client/player/playbackPolicy.test.ts` | 19 testes das políticas e classificadores, incluindo DRM e o falso positivo “Element”/EME. |
| `src/client/player/spotifyDiagnostics.ts` | Probe de EME/Widevine (padrão, L3, L1), resumo e veredito `drmWorks`. |
| `src/client/player/spotifyDiagnostics.test.ts` | 7 testes do probe/resumo de DRM (sucesso, falha de `createMediaKeys` e rejeição do key system). |
| `src/client/player/SpotifyAudioPlayer.tsx` | Player reescrito: init única, ativação por gesto, `autoplay_failed`, reset de ativação, device/transfer, retry limitado, token force, reconexão, guards de URI, eventos com mensagem original, probe de DRM e `diagnose()`. |
| `src/client/api/client.ts` | `apiSpotify.token(force)` envia `force=1` na query e no corpo. |
| `src/server/routes/spotify.ts` | `/token` lê `force` da query e do corpo. |
| `src/server/services/spotify.ts` | `resolveCallbackUri` valida host e path; fallback seguro e logs. |
| `src/server/services/spotify.test.ts` | Testes de `APP_URL`, host divergente e path divergente. |
| `src/client/pages/dashboard/DashboardPage.tsx` | Card “Agora tocando” responsivo, loading, aviso de autoplay, erro com retry, “Detalhes técnicos” e painel “Diagnóstico” copiável. |
| `src/client/layouts/AppLayout.tsx` | Indicador do player considera erro de conta e necessidade de ativação. |
| `src/client/pages/dashboard/QueuePage.tsx` | Avisos de conta/ativação e retomada correta da faixa atual. |
| `src/client/pages/dashboard/SpotifySettings.tsx` | Orientação sobre Premium mobile, toque em Play e aviso de escopos OAuth ausentes. |

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
npm test            -> 14 arquivos, 115 testes, todos passando
npm run build       -> OK (Vite client + tsc server)
```

No Windows desta máquina o `npm test` com paralelismo padrão do Vitest pode
encerrar com `0xC0000005` (access violation) durante a coleta dos workers. A
execução sequencial abaixo passa todos os 115 testes e foi usada como
verificação final:

```text
node node_modules/vitest/vitest.mjs run --no-file-parallelism
```

O `npm run lint` não foi usado porque o projeto não possui arquivo de
configuração do ESLint (comportamento preexistente, não introduzido aqui).

### Testes automatizados relevantes

- detecção de Android/iPhone/iPad e iPadOS disfarçado de MacIntel;
- detecção de Android em “Site para desktop” por ponteiro coarse e Client Hint;
- bloqueio de autoplay mobile até `audioUnlocked`;
- liberação após ativação e bloqueio após falha de ativação;
- `Playback Error` genérico do SDK tratado como autoplay no mobile;
- backoff exponencial limitado;
- classificação de autoplay, Premium, device, DRM, auth, restrição e rate limit;
- erros reais de Widevine/MediaDrm (`No supported keysystem`, L1, `MediaDrmBridge`, `createSession`) classificados como DRM;
- `Element was not activated` não é confundido com a sigla EME;
- prioridade de DRM sobre “session”/“blocked” e de restrição sobre o prefixo genérico “Player command failed”;
- probe de DRM: veredito com pelo menos uma configuração e resumo de falhas;
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
https://pixtune-app.pages.dev/api/spotify/status
```

Sem sessão, a resposta correta é `401 UNAUTHORIZED` em JSON vindo do Render. Isso
prova que o caminho `/api/*` está chegando à API sem sair do domínio `pages.dev`.

O health check da API é `https://pixtune-app.onrender.com/health` (rota `/health`,
não `/api/health`). O proxy do Pages só intercepta `/api/*`; por isso
`https://pixtune-app.pages.dev/api/health` retorna `404` e não deve ser usado como
teste.

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

- [ ] Confirmar que o menu do Chrome está **sem** “Site para desktop” marcado.
- [ ] Desativar temporariamente “Modo Lite”, economia de dados, VPN, DNS privado
      com bloqueio e extensões/bloqueadores que afetem `spotify.com`.
- [ ] Fechar/forçar parada do app Spotify no celular durante o teste; o app pode
      disputar o dispositivo Connect.
- [ ] Em `chrome://settings/content/sound`, permitir som para
      `pixtune-app.pages.dev`; em Autoplay, usar “Perguntar” ou “Permitir”.
- [ ] Abrir o dashboard e confirmar que o áudio **não** começa sozinho.
- [ ] Tocar em Play: o áudio começa após o gesto.
- [ ] Pausar/retomar mantém a posição.
- [ ] Trocar de faixa inicia a nova faixa.
- [ ] Bloquear/desbloquear a tela e voltar ao navegador: player reconecta.
- [ ] Alternar Wi-Fi/4G: player reconecta ou mostra “Tentar novamente”.
- [ ] Conta sem Premium mostra a mensagem específica, sem loop.
- [ ] Em `chrome://components`, confirmar que `Widevine Content Decryption Module`
      está instalado/atualizado (não “0.0.0.0”).
- [ ] Em `chrome://settings/content/protectedContent`, confirmar que conteúdo
      protegido está permitido.
- [ ] Abrir `https://open.spotify.com` no **mesmo** Chrome e tentar tocar uma
      música. Se o Spotify oficial também falhar, o problema é DRM/navegador do
      aparelho; se tocar, o problema está na integração PixTune.
- [ ] Se aparecer a mensagem de DRM/Widevine, tocar em **Diagnóstico** e copiar o
      relatório (sem tokens) para confirmar `requestMediaKeySystemAccess`/
      `createMediaKeys`.
- [ ] Se o erro persistir, abrir **Detalhes técnicos** no card de erro e enviar o
      texto cru (sem tokens) para identificar a causa exata.

### Android (Firefox)

- [ ] Repetir o fluxo do Chrome no Firefox Android, incluindo o teste em
      `https://open.spotify.com`.
- [ ] Em `about:config`, confirmar que `media.eme.enabled` está `true` e que
      `media.gmp-widevinecdm.enabled` não foi desativado.
- [ ] Se o Spotify oficial tocar no Firefox mas o PixTune não, enviar o painel
      **Diagnóstico** para comparar o `deviceId`/URI/erro do SDK.
- [ ] Se ambos falharem, testar outro aparelho Android; o CDM/DRM do aparelho é
      a causa mais provável.

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
- [ ] `https://pixtune-app.onrender.com/health` responde `200` com `{"status":"ok"}`.
- [ ] `https://pixtune-app.pages.dev/api/spotify/status` responde `401` JSON (proxy funcionando).

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
