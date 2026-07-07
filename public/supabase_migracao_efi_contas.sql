create table if not exists public.efi_contas (
  id uuid primary key default gen_random_uuid(),
  nome text unique not null,
  titular text,
  cpf_titular text,
  client_id text,
  client_secret text,
  chave_pix text,
  ambiente text default 'producao',
  status text default 'ativo',
  conta_padrao boolean default false,
  observacao text,
  dados jsonb default '{}'::jsonb,
  criado_em timestamptz default now(),
  atualizado_em timestamptz default now()
);

alter table public.clientes add column if not exists efi_conta_id uuid;
alter table public.clientes add column if not exists efi_conta_nome text;

alter table public.boletos add column if not exists efi_conta_id uuid;
alter table public.boletos add column if not exists efi_conta_nome text;

create index if not exists idx_efi_contas_status on public.efi_contas(status);
create index if not exists idx_clientes_efi_conta_id on public.clientes(efi_conta_id);
create index if not exists idx_boletos_efi_conta_id on public.boletos(efi_conta_id);

alter table public.efi_contas enable row level security;

drop policy if exists "fibrahub_efi_contas_anon_all" on public.efi_contas;
create policy "fibrahub_efi_contas_anon_all" on public.efi_contas
for all to anon using (true) with check (true);
