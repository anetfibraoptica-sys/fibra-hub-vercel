create extension if not exists "pgcrypto";

create table if not exists public.usuarios_painel (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  usuario text unique not null,
  senha_hash text not null,
  funcao text default 'Atendimento',
  status text default 'ativo',
  permissoes jsonb default '{}'::jsonb,
  ultimo_acesso timestamptz,
  criado_em timestamptz default now(),
  atualizado_em timestamptz default now()
);

create table if not exists public.auditoria_painel (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid,
  usuario_nome text,
  usuario_login text,
  acao text,
  entidade text,
  entidade_id text,
  cliente_login text,
  cliente_nome text,
  valor numeric,
  dados jsonb default '{}'::jsonb,
  criado_em timestamptz default now()
);

create index if not exists idx_usuarios_painel_usuario on public.usuarios_painel(usuario);
create index if not exists idx_usuarios_painel_status on public.usuarios_painel(status);
create index if not exists idx_auditoria_usuario_login on public.auditoria_painel(usuario_login);
create index if not exists idx_auditoria_acao on public.auditoria_painel(acao);
create index if not exists idx_auditoria_criado_em on public.auditoria_painel(criado_em);

alter table public.usuarios_painel enable row level security;
alter table public.auditoria_painel enable row level security;

drop policy if exists "fibrahub_usuarios_painel_anon_all" on public.usuarios_painel;
create policy "fibrahub_usuarios_painel_anon_all" on public.usuarios_painel
for all to anon using (true) with check (true);

drop policy if exists "fibrahub_auditoria_painel_anon_all" on public.auditoria_painel;
create policy "fibrahub_auditoria_painel_anon_all" on public.auditoria_painel
for all to anon using (true) with check (true);


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
