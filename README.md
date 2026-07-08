# Fibra+ Hub

## Correção atual
- Removido do Resumo o campo Conexão que ainda recebia 'Online' de dados cadastrados.
- Status agora depende somente da bolinha Online/Offline validada por `/api/cliente/status`.
- Online só aparece com `online=true`, IP, MAC e uptime.
- Se não houver sessão PPPoE real, fica Offline.

Após publicar na Vercel, faça Ctrl+F5 ou teste em aba anônima.
