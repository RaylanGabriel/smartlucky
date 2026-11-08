-- =====================================================================
-- SmartLucky: endurecimento de segurança do banco
-- Rode DEPOIS de publicar a nova versão do app (o código novo usa a
-- service role no servidor e não depende mais do acesso público).
-- =====================================================================

-- 0) Conferência: não pode haver números duplicados antes do passo 1.
-- select numero_escolhido, count(*) from public.rifas
--   group by numero_escolhido having count(*) > 1;

-- 1) Um número só pode existir uma vez (impede venda dupla).
create unique index if not exists rifas_numero_escolhido_unico
  on public.rifas (numero_escolhido);

-- 2) Integridade dos dados.
--    O default antigo era a string literal "'pendente'" (com aspas).
alter table public.rifas alter column status set default 'pendente';
alter table public.rifas alter column created_at set default now();
alter table public.rifas alter column numero_escolhido set not null;
alter table public.rifas drop constraint if exists rifas_status_valido;
alter table public.rifas
  add constraint rifas_status_valido check (status in ('pendente', 'pago'));

-- 3) Índices para as consultas do app.
create index if not exists rifas_payment_id_idx on public.rifas (payment_id);
create index if not exists rifas_status_created_idx on public.rifas (status, created_at);

-- 4) Desliga a limpeza antiga (apagava pendentes após 15 min sem consultar o
--    Mercado Pago). O PIX agora vale 30 min e o app libera as reservas
--    vencidas só depois de confirmar/cancelar o pagamento no MP.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'limpeza-automatica-rifas') then
    perform cron.unschedule('limpeza-automatica-rifas');
  end if;
end $$;
drop function if exists public.delete_expired_reservations();

-- 5) RLS: bloqueia todo acesso com a chave anon/authenticated.
--    A service role (usada só no servidor) ignora RLS.
alter table public.rifas enable row level security;
alter table public.webhook_queue enable row level security;

-- Remove TODAS as policies dessas tabelas (as antigas liberavam
-- INSERT/SELECT/UPDATE para qualquer visitante).
do $$
declare p record;
begin
  for p in
    select policyname, tablename from pg_policies
    where schemaname = 'public' and tablename in ('rifas', 'webhook_queue')
  loop
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
  end loop;
end $$;

-- Reforço: revoga também os privilégios diretos (some também do GraphQL).
revoke all on public.rifas from anon, authenticated;
revoke all on public.webhook_queue from anon, authenticated;
revoke all on sequence public.rifas_id_seq from anon, authenticated;

-- 6) O front não usa mais Realtime nessa tabela.
do $$
begin
  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'rifas'
  ) then
    alter publication supabase_realtime drop table public.rifas;
  end if;
end $$;
