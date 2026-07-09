-- ============================================================
-- Fibra+ Hub - Configurações Efí persistentes
-- ============================================================

CREATE TABLE IF NOT EXISTS public.efi_configuracoes (
  conta INTEGER PRIMARY KEY,
  nome_conta TEXT,
  documento TEXT,
  ambiente TEXT DEFAULT 'producao',
  client_id TEXT,
  client_secret TEXT,
  webhook TEXT,
  ativo BOOLEAN DEFAULT TRUE,
  atualizado_em TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.efi_configuracoes
  ADD COLUMN IF NOT EXISTS nome_conta TEXT,
  ADD COLUMN IF NOT EXISTS documento TEXT,
  ADD COLUMN IF NOT EXISTS ambiente TEXT DEFAULT 'producao',
  ADD COLUMN IF NOT EXISTS client_id TEXT,
  ADD COLUMN IF NOT EXISTS client_secret TEXT,
  ADD COLUMN IF NOT EXISTS webhook TEXT,
  ADD COLUMN IF NOT EXISTS ativo BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS atualizado_em TIMESTAMPTZ DEFAULT NOW();

-- Caso use RLS no Supabase, ajuste conforme sua política de segurança.
-- Para painel privado, recomenda-se salvar via backend.
