-- =============================================================================
-- Migration: schedule pg_cron mart refresh
-- Refreshes staging + marts materialized views every 6 minutes, offset 1 min
-- after the Redmine ingest (which runs every 5 min) to allow upserts to settle.
-- Runs after: 20260526000200_create_analytics_schema.sql
-- =============================================================================

-- Idempotent: remove old job before re-scheduling.
select cron.unschedule(jobid)
from cron.job
where jobname = 'refresh-warehouse-views';

select cron.schedule(
  'refresh-warehouse-views',
  '1-59/6 * * * *',          -- :01, :07, :13 … — offset 1 min past each ingest
  $$
    -- Layer 1: staging (must refresh before marts)
    refresh materialized view concurrently staging.stg_projects;
    refresh materialized view concurrently staging.stg_issues;

    -- Layer 2: marts (depend on staging)
    refresh materialized view concurrently marts.mart_daily_volume;
    refresh materialized view concurrently marts.mart_team_velocity;
    refresh materialized view concurrently marts.mart_sla_compliance;
    refresh materialized view concurrently marts.mart_age_bands;
    refresh materialized view concurrently marts.mart_similarity_features;
  $$
);

-- Log each refresh run into sync_runs so ops can track warehouse health.
-- The actual logging happens via a thin wrapper function below.
create or replace function public.refresh_warehouse()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run_id bigint;
  v_start  timestamptz := clock_timestamp();
begin
  insert into public.sync_runs (source, started_at, status)
  values ('warehouse_refresh', v_start, 'running')
  returning id into v_run_id;

  -- Layer 1
  refresh materialized view concurrently staging.stg_projects;
  refresh materialized view concurrently staging.stg_issues;

  -- Layer 2
  refresh materialized view concurrently marts.mart_daily_volume;
  refresh materialized view concurrently marts.mart_team_velocity;
  refresh materialized view concurrently marts.mart_sla_compliance;
  refresh materialized view concurrently marts.mart_age_bands;
  refresh materialized view concurrently marts.mart_similarity_features;

  update public.sync_runs
  set
    ended_at   = clock_timestamp(),
    status     = 'success',
    metrics_json = jsonb_build_object(
      'duration_ms',
      extract(milliseconds from clock_timestamp() - v_start)
    )
  where id = v_run_id;

exception when others then
  update public.sync_runs
  set
    ended_at   = clock_timestamp(),
    status     = 'error',
    error_text = sqlerrm
  where id = v_run_id;
  raise;
end;
$$;

-- Replace the raw cron job body with the logging wrapper.
select cron.unschedule(jobid)
from cron.job
where jobname = 'refresh-warehouse-views';

select cron.schedule(
  'refresh-warehouse-views',
  '1-59/6 * * * *',
  $$select public.refresh_warehouse();$$
);
