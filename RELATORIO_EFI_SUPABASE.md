# Relatório Efí Supabase

- Removida configuração local da Efí.
- Criada tabela `efi_configuracoes` automaticamente pelo backend.
- Endpoints Efí usam Supabase/Postgres.
- require('path'): 1
- require('fs'): 0
- rotas totais: 35

Para funcionar persistente, `DATABASE_URL` precisa estar configurada no Vercel/Render.
