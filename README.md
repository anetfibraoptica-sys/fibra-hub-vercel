# Fibra+ Hub

## Alteração atual
- Removida a dependência da Efí com Supabase.
- Apagada a migração `supabase_migracao_efi_configuracoes.sql`.
- Removidos scripts auxiliares que apenas mascaravam status visual.
- Configuração Efí agora salva no backend local em `data/efi-config.json`.
- Financeiro Efí carrega/salva direto pelo backend local.
- Mantidos endpoints `/api/efi/config`, `/api/efi/salvar-config`, `/api/efi/testar-conexao`, `/api/efi/status` e `/api/efi/boletos/teste`.

Observação: em hospedagens serverless como Vercel, gravação em arquivo pode não persistir após redeploy/reinício. Para produção estável, use variáveis de ambiente ou banco. Nesta versão não envia nada ao Supabase.
