# Alterações v60

- Login consulta o CPF diretamente na tabela `clientes` do Supabase.
- Removida a obrigatoriedade de liberação manual antes do primeiro acesso.
- `central_assinantes` agora serve somente para auditoria e bloqueio administrativo.
- Login mostra o status da conexão com o Supabase.
- Mensagens identificam claramente quando o CPF não existe no cadastro.
- Suporte a `DATABASE_URL`, `SUPABASE_DATABASE_URL` e `SUPABASE_DB_URL`.
- A ficha do cliente permite bloquear ou reativar o acesso.
