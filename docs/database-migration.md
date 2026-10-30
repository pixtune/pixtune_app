# Migração do banco de produção

Este documento descreve a estratégia de migração do PostgreSQL usado pela API no Render.
**Nenhum comando destrutivo deve ser executado sem backup e aprovação.**

## Variáveis exigidas pela API

| Variável | Obrigatória | Observação |
| --- | --- | --- |
| `DATABASE_URL` | Sim | Connection string PostgreSQL fornecida pelo Render. Use a **Internal Database URL** quando a API estiver na mesma região/workspace; para acesso externo, use a External URL com SSL. |
| `JWT_SECRET` | Sim | Chave longa e aleatória. Gere com `openssl rand -hex 32` e nunca versione. |
| `SPOTIFY_CLIENT_ID` | Sim | Client ID do app no Spotify Developer Dashboard. |
| `SPOTIFY_CLIENT_SECRET` | Sim | Client Secret do app. Nunca vai para o frontend. |
| `API_URL` | Sim | Origem da API **sem** `/api`, por exemplo `https://pixtune-app.onrender.com`. |
| `APP_URL` | Sim | Origem do frontend, por exemplo `https://pixtune-app.pages.dev`. |
| `CORS_ORIGINS` | Sim | Origens do frontend separadas por vírgula. |
| `SPOTIFY_REDIRECT_URI` | Recomendada | `https://pixtune-app.pages.dev/api/auth/spotify/callback` |
| `SPOTIFY_CONNECT_REDIRECT_URI` | Recomendada | `https://pixtune-app.pages.dev/api/spotify/callback` |

Sem `SPOTIFY_REDIRECT_URI` e `SPOTIFY_CONNECT_REDIRECT_URI`, o código deriva as URLs de
`API_URL`. Em produção, defina explicitamente as URLs do **Cloudflare Pages** (proxy
same-origin de `/api/*`); não use o domínio direto do Render, ou o cookie de sessão
volta a ser bloqueado como cookie de terceiro em Brave/Safari/Firefox.

> O schema usa `provider = "postgresql"`. Um banco antigo com `DATABASE_URL="file:..."` (SQLite)
> não é compatível: exporte os dados e importe em um PostgreSQL antes de aplicar as migrações.

## Estado do repositório

- O schema atual usa `User.spotifyId` como identificador único.
- `User.email` é opcional e não é único.
- `User.passwordHash` não existe mais.
- A migração inicial versionada está em `prisma/migrations/20261027120000_init/`.

## Cenário A — banco novo ou vazio

1. Faça backup/snapshot do banco no Render.
2. Confirme que o banco está vazio (sem tabelas do PixTune).
3. Execute, com a `DATABASE_URL` de produção carregada:

   ```bash
   npx prisma migrate deploy
   npx prisma migrate status
   ```

Isso cria todas as tabelas e índices do schema atual.

O `render.yaml` também executa `npx prisma migrate deploy` no build. Assim, um novo deploy
não sobe a API sem schema: se a migração falhar, o build é interrompido. O comando é
idempotente e não apaga dados.

## Cenário B — banco existente com o schema antigo (email + senha)

O schema antigo tinha `User.email` único e `User.passwordHash` obrigatório. Não execute
`prisma migrate deploy` antes de preparar esse banco, pois a migração inicial tentaria criar
tabelas já existentes.

1. Faça backup/snapshot no Render e confirme que há dados a preservar.
2. Marque a migração inicial como já aplicada (baseline), **sem executá-la**:

   ```bash
   npx prisma migrate resolve --applied 20261027120000_init
   ```

3. Execute o SQL abaixo em uma transação, usando o console SQL do Render ou `psql`:

   ```sql
   BEGIN;

   -- Preserva os hashes antigos, mas permite que novos usuários não os informem.
   ALTER TABLE "User" ALTER COLUMN "passwordHash" DROP NOT NULL;

   -- Email passa a ser opcional e deixa de ser único.
   ALTER TABLE "User" ALTER COLUMN "email" DROP NOT NULL;
   DROP INDEX IF EXISTS "User_email_key";

   -- spotifyId é obrigatório e único. Usuários antigos não têm Spotify vinculado,
   -- então recebem um valor temporário determinístico para preservar seus dados.
   ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "spotifyId" TEXT;
   UPDATE "User" SET "spotifyId" = 'legacy-' || "id" WHERE "spotifyId" IS NULL;
   ALTER TABLE "User" ALTER COLUMN "spotifyId" SET NOT NULL;
   CREATE UNIQUE INDEX IF NOT EXISTS "User_spotifyId_key" ON "User"("spotifyId");

   COMMIT;
   ```

4. Valide:

   ```bash
   npx prisma migrate status
   npx prisma validate
   ```

### Sobre os usuários antigos

Os valores `legacy-<id>` **não são IDs reais do Spotify**. Esses usuários não conseguem
entrar até que um administrador vincule manualmente o `spotifyId` correto. O login com
Spotify cria um novo usuário quando o `spotifyId` ainda não existe.

Se esses usuários antigos não forem necessários, a alternativa mais limpa é recriar o banco
vazio e seguir o Cenário A — mas isso apaga dados e exige aprovação explícita.

Depois de confirmar que os hashes antigos não são mais necessários, eles podem ser removidos
com `ALTER TABLE "User" DROP COLUMN "passwordHash";` (operação destrutiva, faça backup antes).

> Enquanto a coluna legada `passwordHash` existir, ferramentas de desenvolvimento podem acusar
> drift entre o banco e o schema. Não rode `prisma migrate dev` contra produção; use
> `prisma migrate deploy` e `prisma migrate status`.

## Cenário C — banco já no schema atual, mas sem histórico de migrações

1. Faça backup.
2. Marque a migração inicial como aplicada:

   ```bash
   npx prisma migrate resolve --applied 20261027120000_init
   npx prisma migrate status
   ```

Não use `prisma db push` em produção: ele pode alterar ou remover colunas sem gerar histórico.
