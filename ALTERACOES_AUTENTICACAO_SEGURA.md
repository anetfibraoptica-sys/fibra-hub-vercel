# Autenticação segura do painel

- Login validado exclusivamente no servidor contra `public.usuarios_painel`.
- Senha não é consultada nem comparada pelo navegador.
- Sessão assinada em cookie `HttpOnly`, `Secure` e `SameSite=Lax`, com validade de 12 horas.
- Páginas HTML internas redirecionam para o login quando não há sessão válida.
- APIs internas exigem sessão; webhook Efí, cron autenticado e atualização por token continuam preservados.
- Permissões são aplicadas a baixa manual, MikroTik, configurações Efí, cadastro e exclusões.
- Criação/listagem de usuários agora passa pelo servidor.
- Removidos os logins falsificáveis por `localStorage` no `index.html` e na importação.

## Variável obrigatória na Vercel

Crie `SESSION_SECRET` em Production, Preview e Development com uma chave longa e aleatória e faça novo deploy. Não use a mesma senha de usuário.
