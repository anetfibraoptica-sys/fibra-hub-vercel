# Fibra+ Hub

## Alteração atual
- Configuração da Efí agora fica salva no banco/backend, não apenas no navegador.
- Criada migração `public/supabase_migracao_efi_configuracoes.sql`.
- Backend cria/usa tabela `efi_configuracoes` quando houver `DATABASE_URL`.
- Criado endpoint `GET /api/efi/config?conta=1` para carregar a configuração salva.
- `POST /api/efi/salvar-config`, `/api/efi/testar-conexao`, `/api/efi/status` e teste de boletos agora usam a configuração persistida.
- Financeiro Efí carrega automaticamente as contas salvas ao abrir a tela.
- Boletos/importação passam a depender da configuração persistida no backend.

Execute a migração SQL no Supabase se a tabela ainda não existir.
