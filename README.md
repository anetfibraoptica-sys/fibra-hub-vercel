# Fibra+ Hub

## Alteração atual
- O Resumo do cadastro agora fica conectado ao MikroTik.
- Consulta dedicada: `/api/cliente/status`.
- O backend usa `/ppp/active/print` para verificar o login PPPoE.
- Se o login estiver no PPP Active com IP + MAC + uptime, mostra verde Online.
- Se não estiver no PPP Active, mostra vermelho Offline.

Depois de publicar na Vercel, faça Ctrl+F5 ou teste em aba anônima.
