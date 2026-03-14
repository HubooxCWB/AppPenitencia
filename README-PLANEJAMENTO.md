# Planejamento de Deploy e Operacao

## Objetivo

Publicar o app com autenticacao real, persistencia em nuvem e onboarding rapido para amigos.

## Decisao de stack

- Deploy: Vercel (free)
- Banco/Auth: Supabase
- Frontend: Vite + React

## O que ja foi implementado

- [x] Schema normalizado em [`supabase/schema.sql`](./supabase/schema.sql)
- [x] Snapshot RPC (`get_snapshot` / `replace_snapshot`)
- [x] Auth com Supabase (`signup`, `signin`, `logout`, restauracao de sessao)
- [x] Vinculo `public.app_users.auth_user_id -> auth.users(id)`
- [x] Admin por email (`huboox.rec@gmail.com`)
- [x] Senha temporaria com troca obrigatoria no primeiro login
- [x] Fallback local + backup

## Fase atual (go-live)

1. Publicar no Vercel
2. Configurar variaveis de ambiente no Vercel
3. Rodar `schema.sql` no Supabase de producao
4. Criar usuarios dos amigos no painel Auth
5. Compartilhar link e credenciais temporarias

## Checklists

### Deploy Vercel

1. Importar repo
2. Build command: `npm run build`
3. Output directory: `dist`
4. Variaveis:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_ADMIN_EMAIL`
- `VITE_ADMIN_USERNAME`
- `VITE_TEMP_PASSWORD`

### Auth e onboarding dos amigos

1. Supabase `Auth > Entrar/Fornecedores`
- Email habilitado
- Confirmacao de email desligada (MVP)
- Salvar alteracoes
2. Supabase `Auth > Usuarios`
- Criar cada usuario com senha temporaria
3. Primeiro login no app
- Usuario entra
- App exige troca de senha
- Acesso liberado

## Proximas melhorias (pos-MVP)

- Adicionar fluxo "esqueci minha senha"
- Criacao em lote de usuarios (script admin)
- RLS completa por papel em todas as tabelas
- Ambiente staging separado
