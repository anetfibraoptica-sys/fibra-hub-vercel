# Fibra+ Hub v60 — Central ligada aos clientes do Supabase

A Central do Assinante usa **a mesma conexão PostgreSQL do projeto Supabase do painel Fibra+**. Não existe outro banco e não é necessário duplicar clientes.

## Fluxo de acesso

1. O assinante abre `/central/`.
2. Informa um CPF válido.
3. O servidor procura esse CPF diretamente na tabela `clientes` do Supabase.
4. Encontrando um ou mais cadastros, cria a sessão e exibe todos os pontos vinculados ao CPF.
5. Faturas são consultadas na tabela `boletos`.

Não é necessário liberar cada cliente manualmente. O acesso é automático para CPFs existentes. Na ficha do cliente, o administrador pode **bloquear** ou **reativar** um CPF específico.

## Variáveis do mesmo deploy do painel

```env
DATABASE_URL=postgresql://postgres.PROJETO:SENHA@HOST:6543/postgres
SESSION_SECRET=troque-por-uma-chave-longa-e-aleatoria
```

Também são aceitos `SUPABASE_DATABASE_URL` ou `SUPABASE_DB_URL` como aliases de `DATABASE_URL`. Use somente uma dessas variáveis.

No Supabase, copie a string em **Project Settings → Database → Connection string**. Em ambientes serverless, prefira a string do pooler indicada pelo próprio Supabase.

## Dados consultados

- `clientes`: CPF, nome, plano, valor, vencimento, status, contatos e endereço;
- `boletos`: situação, vencimento, valor, PIX, linha digitável e segunda via;
- `central_assinantes`: somente controle de último acesso e bloqueio administrativo.

A tela de login mostra o estado **Conectado aos clientes do Supabase** quando a conexão e a tabela `clientes` estão disponíveis.

## Segurança

A Central não envia a conexão do banco, chave administrativa, senha PPPoE ou credenciais do MikroTik ao navegador. As consultas são executadas no servidor e a sessão usa cookie HttpOnly assinado por `SESSION_SECRET`.

CPF não é segredo. Como o acesso foi solicitado somente por CPF, qualquer pessoa que conheça o documento poderá tentar acessar o cadastro. Para publicação ampla, recomenda-se adicionar confirmação por WhatsApp, SMS ou e-mail.
