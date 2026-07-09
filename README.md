# Fibra+ Hub

## Alteração atual
- Efí salva e carrega pelo Supabase/Postgres (`efi_configuracoes`).
- Status Efí Online/Offline com OAuth real.
- Preparada tabela `efi_boletos_vinculos` para gravar vínculos dos boletos com a Efí.
- Boleto importado tenta consultar a Efí e salvar linha digitável, Pix Copia e Cola, segunda via e status.
- Sem Chave PIX e sem certificado `.p12`.
- Não foram alterados MikroTik, servidores, clientes, menu ou layout global.
