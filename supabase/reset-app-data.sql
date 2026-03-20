-- Reset completo dos dados do app.
-- Rode como admin no Supabase SQL Editor.
-- Isso limpa:
-- - checklist / conquistas
-- - catálogo de serras e picos
-- - diretório de usuários do app
--
-- Não remove usuários de auth.users.
-- Para apagar logins de verdade, remova os usuários na área Authentication do Supabase.

select public.reset_app_data(true);
