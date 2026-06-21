create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public.trigger_redmine_ingest()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform net.http_post(
    url := 'https://wxfssqmuubdnaxtqbiba.supabase.co/functions/v1/redmine-ingest',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := '{"mode":"batch"}'::jsonb,
    timeout_milliseconds := 120000
  );
end;
$$;

-- Ensure idempotent scheduling when migrations re-run.
select cron.unschedule(jobid)
from cron.job
where jobname = 'redmine_ingest_every_5m';

select cron.schedule(
  'redmine_ingest_every_5m',
  '*/5 * * * *',
  $$select public.trigger_redmine_ingest();$$
);
