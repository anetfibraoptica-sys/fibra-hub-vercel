
create extension if not exists "pgcrypto";

create table if not exists public.clientes (
  id uuid primary key default gen_random_uuid(),
  login text unique,
  login_pppoe text,
  nome text,
  cpf_cnpj text,
  cpf text,
  cnpj text,
  email text,
  telefone1 text,
  telefone2 text,
  telefone3 text,
  endereco text,
  bairro text,
  cidade text,
  uf text,
  cep text,
  complemento text,
  referencia text,
  plano text,
  valor_mensal numeric default 0,
  dia_vencimento integer,
  servidor text,
  profile text,
  interface text,
  elemento_rede text,
  pop_servidor text,
  status text default 'ativo',
  dados jsonb default '{}'::jsonb,
  boletos jsonb default '[]'::jsonb,
  origem text default 'Fibra+ Hub',
  atualizado_em timestamptz default now(),
  criado_em timestamptz default now()
);

create table if not exists public.boletos (
  id uuid primary key default gen_random_uuid(),
  numero text unique,
  cliente_login text,
  cliente_nome text,
  cpf_cnpj text,
  categoria text default 'Mensalidade',
  descricao text,
  emissao date,
  vencimento date,
  pagamento date,
  desconto numeric default 0,
  valor numeric default 0,
  total numeric default 0,
  valor_pago numeric default 0,
  status text default 'pendente',
  banco text,
  agencia_conta text,
  identificacao_carne text,
  linha_digitavel text,
  pix text,
  efi_status text,
  dados jsonb default '{}'::jsonb,
  origem text default 'Fibra+ Hub',
  importado_em timestamptz default now(),
  atualizado_em timestamptz default now(),
  criado_em timestamptz default now()
);

create table if not exists public.planos (
  id uuid primary key default gen_random_uuid(),
  nome text unique not null,
  velocidade text,
  valor numeric default 0,
  ativo boolean default true,
  dados jsonb default '{}'::jsonb,
  criado_em timestamptz default now()
);

create table if not exists public.pagamentos (
  id uuid primary key default gen_random_uuid(),
  boleto_numero text,
  cliente_login text,
  valor_boleto numeric default 0,
  valor_pago numeric default 0,
  data_pagamento date,
  forma_pagamento text,
  observacao text,
  origem text default 'Manual',
  dados jsonb default '{}'::jsonb,
  criado_em timestamptz default now()
);

create table if not exists public.configuracoes (
  chave text primary key,
  valor jsonb default '{}'::jsonb,
  atualizado_em timestamptz default now()
);

create table if not exists public.servidores (
  id uuid primary key default gen_random_uuid(),
  nome text unique not null,
  tipo text default 'mikrotik',
  host text,
  porta integer,
  usuario text,
  ativo boolean default true,
  dados jsonb default '{}'::jsonb,
  criado_em timestamptz default now()
);

create table if not exists public.logs (
  id uuid primary key default gen_random_uuid(),
  tipo text,
  mensagem text,
  dados jsonb default '{}'::jsonb,
  criado_em timestamptz default now()
);

create index if not exists idx_clientes_login on public.clientes(login);
create index if not exists idx_boletos_cliente_login on public.boletos(cliente_login);
create index if not exists idx_boletos_status on public.boletos(status);
create index if not exists idx_boletos_vencimento on public.boletos(vencimento);

alter table public.clientes enable row level security;
alter table public.boletos enable row level security;
alter table public.planos enable row level security;
alter table public.pagamentos enable row level security;
alter table public.configuracoes enable row level security;
alter table public.servidores enable row level security;
alter table public.logs enable row level security;

drop policy if exists "fibrahub_clientes_anon_all" on public.clientes;
create policy "fibrahub_clientes_anon_all" on public.clientes for all to anon using (true) with check (true);
drop policy if exists "fibrahub_boletos_anon_all" on public.boletos;
create policy "fibrahub_boletos_anon_all" on public.boletos for all to anon using (true) with check (true);
drop policy if exists "fibrahub_planos_anon_all" on public.planos;
create policy "fibrahub_planos_anon_all" on public.planos for all to anon using (true) with check (true);
drop policy if exists "fibrahub_pagamentos_anon_all" on public.pagamentos;
create policy "fibrahub_pagamentos_anon_all" on public.pagamentos for all to anon using (true) with check (true);
drop policy if exists "fibrahub_configuracoes_anon_all" on public.configuracoes;
create policy "fibrahub_configuracoes_anon_all" on public.configuracoes for all to anon using (true) with check (true);
drop policy if exists "fibrahub_servidores_anon_all" on public.servidores;
create policy "fibrahub_servidores_anon_all" on public.servidores for all to anon using (true) with check (true);
drop policy if exists "fibrahub_logs_anon_all" on public.logs;
create policy "fibrahub_logs_anon_all" on public.logs for all to anon using (true) with check (true);
