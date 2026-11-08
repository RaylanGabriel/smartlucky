-- =====================================================================
-- SmartLucky: limite de requisições + cron de processamento
-- Rode ANTES de publicar o código que usa rate_limit_hit / ip_hash.
-- (É só aditivo: não afeta a versão que está no ar.)
-- =====================================================================

-- 1) Limite de requisições (janela fixa), usado pelas rotas da API.
create table if not exists public.rate_limits (
  key text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (key, window_start)
);
alter table public.rate_limits enable row level security;
revoke all on public.rate_limits from anon, authenticated;

create or replace function public.rate_limit_hit(
  p_key text,
  p_window_seconds integer,
  p_max integer
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_start timestamptz :=
    to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_count integer;
begin
  insert into public.rate_limits (key, window_start, count)
  values (p_key, v_start, 1)
  on conflict (key, window_start)
  do update set count = public.rate_limits.count + 1
  returning count into v_count;

  return v_count <= p_max;
end;
$$;

revoke all on function public.rate_limit_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, integer, integer) to service_role;

-- 2) Identificador do comprador (hash do IP, nunca o IP em texto puro)
--    para limitar quantos números uma mesma origem segura sem pagar.
alter table public.rifas add column if not exists ip_hash text;
create index if not exists rifas_ip_hash_pendente_idx
  on public.rifas (ip_hash, created_at) where status = 'pendente';

-- 3) Cron: chama o process-pending a cada 5 minutos (libera reservas
--    vencidas e reprocessa webhooks que falharam) e limpa rate_limits.
--    O CRON_SECRET fica criptografado no Vault, nunca neste arquivo.
--    Pré-requisito (rode uma vez no SQL Editor, com o seu valor):
--      select vault.create_secret('<VALOR_DO_CRON_SECRET>', 'cron_secret');
create extension if not exists pg_net;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'processar-pendentes') then
    perform cron.unschedule('processar-pendentes');
  end if;
end $$;

select cron.schedule(
  'processar-pendentes',
  '*/5 * * * *',
  $job$
    select net.http_get(
      url := 'https://smartlucky.vercel.app/api/webhooks/process-pending',
      headers := jsonb_build_object(
        'Authorization',
        'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
      ),
      timeout_milliseconds := 30000
    )
    where exists (select 1 from vault.decrypted_secrets where name = 'cron_secret');

    delete from public.rate_limits where window_start < now() - interval '1 day';
  $job$
);
