alter table public.clientes add column if not exists motivo_bloqueio text;
alter table public.clientes add column if not exists boleto_bloqueio_numero text;
alter table public.clientes add column if not exists boleto_bloqueio_vencimento date;
alter table public.clientes add column if not exists dias_atraso_bloqueio integer;

insert into public.configuracoes (chave, valor)
values ('bloqueio_automatico', '{"dias_para_bloqueio":4}'::jsonb)
on conflict (chave) do update set valor = excluded.valor, atualizado_em = now();
