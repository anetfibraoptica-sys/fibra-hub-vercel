-- Fibra+ Hub v59 - Central do Assinante
-- O servidor executa esta migração automaticamente ao iniciar.
-- Este arquivo existe para auditoria ou execução manual no SQL Editor do Supabase.

create table if not exists public.central_assinantes (
  id bigserial primary key,
  documento text not null unique,
  senha_hash text,
  ativo boolean not null default true,
  cliente_principal_id text,
  tentativas_falhas integer not null default 0,
  bloqueado_ate timestamptz,
  ultimo_acesso timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index if not exists idx_central_assinantes_documento
  on public.central_assinantes(documento);

-- A versão CPF-only não utiliza senha. Mantém a coluna apenas por compatibilidade.
alter table public.central_assinantes alter column senha_hash drop not null;

alter table public.clientes add column if not exists email text;
alter table public.clientes add column if not exists telefone1 text;
alter table public.clientes add column if not exists telefone2 text;
alter table public.clientes add column if not exists endereco text;
alter table public.clientes add column if not exists bairro text;
alter table public.clientes add column if not exists cidade text;
alter table public.clientes add column if not exists uf text;
alter table public.clientes add column if not exists cep text;
alter table public.clientes add column if not exists valor_mensal numeric default 0;
alter table public.clientes add column if not exists dia_vencimento integer;
alter table public.clientes add column if not exists status text default 'ativo';

-- Segurança: a Central não consulta estas tabelas diretamente pelo navegador.
-- Todo acesso passa pelos endpoints do servidor e por cookie HttpOnly.
-- Portanto, não crie políticas anônimas adicionais para central_assinantes.
alter table public.central_assinantes enable row level security;
