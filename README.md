# Fibra+ Hub

## Correção atual
- Corrigido endpoint `/api/cliente/status` para retornar `online:false` por padrão.
- Online agora só é verdadeiro se o login existir no `/ppp/active/print` com IP, MAC e uptime.
- Corrigido frontend do Resumo para ficar vermelho por padrão.
- Verde só aparece com `online=true` + IP + MAC + uptime.
- Campo Conexão removido do Resumo para evitar falso Online vindo de cadastro.

Após publicar na Vercel, faça Ctrl+F5 ou teste em aba anônima.
