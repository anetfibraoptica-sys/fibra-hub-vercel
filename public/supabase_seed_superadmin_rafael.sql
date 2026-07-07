alter table public.usuarios_painel add column if not exists super_admin boolean default false;

insert into public.usuarios_painel (
  nome,
  usuario,
  senha_hash,
  funcao,
  status,
  super_admin,
  permissoes,
  atualizado_em
)
values (
  'Rafael Amaral',
  'rafael',
  '6f8c8745d70a7203006a1df048c2473889c977c67ebb3675bde597bd586e621f',
  'SuperAdmin',
  'ativo',
  true,
  '{"dashboard":true,"clientes":true,"cadastro":true,"financeiro":true,"boletos":true,"baixa":true,"configuracoes":true,"usuarios":true,"mikrotik":true,"relatorios":true,"excluir":true,"super_admin":true}'::jsonb,
  now()
)
on conflict (usuario) do update set
  nome = excluded.nome,
  senha_hash = excluded.senha_hash,
  funcao = excluded.funcao,
  status = excluded.status,
  super_admin = true,
  permissoes = excluded.permissoes,
  atualizado_em = now();
