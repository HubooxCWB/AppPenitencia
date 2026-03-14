# Penitencia CWB

Aplicativo de acompanhamento de conquistas em trilhas, picos, morros e cachoeiras do PR.

## Status atual

- Auth real com Supabase (`email + senha`)
- Perfil de usuario sincronizado em `public.app_users` com `auth_user_id`
- Fluxo de senha temporaria com troca obrigatoria no primeiro acesso
- Snapshot de dados no Supabase via RPC (`get_snapshot` / `replace_snapshot`)
- Fallback local com `localStorage` + backup

## Stack

- Frontend: React + Vite + TypeScript
- Banco/Auth: Supabase (Postgres + Auth + RPC)
- Deploy recomendado (free): Vercel

## Executar local

1. Instalar dependencias:
```bash
npm install
```
2. Rodar em desenvolvimento:
```bash
npm run dev
```
3. Typecheck:
```bash
npm run lint
```
4. Build:
```bash
npm run build
```

## Variaveis de ambiente

Configure em `.env.local`:

```env
VITE_SUPABASE_URL="https://SEU_PROJETO.supabase.co"
VITE_SUPABASE_PUBLISHABLE_KEY="sb_publishable_..."
VITE_ADMIN_EMAIL="huboox.rec@gmail.com"
VITE_ADMIN_USERNAME="penitencia"
VITE_TEMP_PASSWORD="trekking"
```

## Setup Supabase

1. No SQL Editor, execute:
- [`supabase/schema.sql`](./supabase/schema.sql)
2. Se quiser subir dados iniciais do backup:
- [`supabase/seed-from-backup.sql`](./supabase/seed-from-backup.sql)
3. Em `Auth > Entrar/Fornecedores`:
- `Email` habilitado
- `Confirmar e-mail` desligado para fluxo MVP (sem codigo por email)
- clicar em `Salvar alteracoes`

## Admin e logins de amigos

### Admin

- E-mail admin fixo: `huboox.rec@gmail.com`
- Senha inicial: `trekking`
- O papel `ADMIN` e atribuido no backend pelo e-mail.

### Criar logins para amigos

No painel Supabase:

1. `Auth > Usuarios > Adicionar usuario`
2. Preencher email do amigo
3. Definir senha temporaria (recomendado `trekking`)
4. Marcar confirmacao do email do usuario como ativa no cadastro manual

Ao entrar no app com senha temporaria (`VITE_TEMP_PASSWORD`), o usuario e obrigado a trocar senha antes de continuar.

## Deploy no Vercel (free)

1. Subir projeto no GitHub/GitLab
2. Importar repo no Vercel
3. Em `Project Settings > Environment Variables`, configurar:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_ADMIN_EMAIL`
- `VITE_ADMIN_USERNAME`
- `VITE_TEMP_PASSWORD`
4. Deploy

## Persistencia e backup

Chaves locais usadas:

- `penitencia-auth-user`
- `penitencia-supabase-auth-session`
- `penitencia-force-password-change`
- `penitencia-mountain-ranges`
- `penitencia-mountain-ranges-backup`

O app continua funcional mesmo com falha temporaria de rede, mantendo fallback local.
