# Fibra+ Hub

## Alteração atual
- Criado endpoint dedicado `GET /api/cliente/status`.
- Esse endpoint consulta o MikroTik via `/ppp/active/print` para o login do cliente.
- O Resumo do cadastro não usa mais a lógica da tela Servidores Online.
- Online só aparece se o login do cliente estiver ativo com IP + MAC + Uptime.
- Se não encontrar o login no PPP Active, mostra Offline.

Depois de publicar na Vercel, faça Ctrl+F5 ou teste em aba anônima.
