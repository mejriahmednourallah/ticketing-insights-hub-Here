-- =============================================================================
-- Migration: create staging schema
-- Cleaned, typed copies of the raw Redmine tables.
-- Runs after: 20260408120000_redmine_pipeline.sql
-- =============================================================================

create schema if not exists staging;

-- ---------------------------------------------------------------------------
-- SLA plan config — maps plan labels (from sla_plan column) to target hours.
-- Populate / update this table to match your Redmine SLA agreements.
-- ---------------------------------------------------------------------------
create table if not exists public.sla_plan_config (
  plan_name       text primary key,
  target_hours    numeric not null default 72,
  description     text
);

-- Seed a few common defaults (idempotent via ON CONFLICT DO NOTHING).
insert into public.sla_plan_config (plan_name, target_hours, description) values
  ('Standard',  72,  '3-business-day SLA'),
  ('Premium',   24,  '1-business-day SLA'),
  ('Critical',   4,  '4-hour SLA'),
  ('Best Effort', 168, '7-day best-effort')
on conflict (plan_name) do nothing;

-- ---------------------------------------------------------------------------
-- staging.stg_issues
-- One row per Redmine issue. CONCURRENTLY-refreshable → needs a unique index.
-- ---------------------------------------------------------------------------
create materialized view if not exists staging.stg_issues as
select
  i.redmine_id                                        as id,
  i.project_redmine_id                                as project_id,
  i.project_identifier,
  i.project_name,
  i.tracker_name                                      as tracker,
  i.status_name                                       as status,
  i.priority_name                                     as priority,
  i.subject,
  i.author_name                                       as author,
  i.assigned_to_name                                  as assignee,
  i.team,
  i.technology,
  i.type,
  i.satisfaction,
  i.source,
  i.canal,
  i.segment_client,
  i.region,
  i.reopened,
  i.sla_plan,

  -- Dates (date-truncated for aggregation efficiency)
  i.created_on::date                                  as created_date,
  i.updated_on::date                                  as updated_date,
  i.closed_on::date                                   as closed_date,
  i.resolved_on::date                                 as resolved_date,

  -- Age in hours from creation to close (or now if still open)
  round(
    extract(epoch from (coalesce(i.closed_on, now()) - i.created_on)) / 3600.0
  , 2)                                                as age_hours,

  -- Whether the ticket is currently open
  (i.closed_on is null)                               as is_open,

  -- SLA breach flag (false when no plan config found → no penalty)
  case
    when i.closed_on is not null
     and s.target_hours is not null
     and extract(epoch from (i.closed_on - i.created_on)) / 3600.0
         > s.target_hours
    then true
    else false
  end                                                 as sla_breached,

  coalesce(s.target_hours, null)                      as sla_target_hours

from public.redmine_issues i
left join public.sla_plan_config s on s.plan_name = i.sla_plan;

-- Unique index required for CONCURRENT refresh
create unique index if not exists stg_issues_id_idx on staging.stg_issues (id);

-- Supporting indexes for common filter patterns
create index if not exists stg_issues_project_idx      on staging.stg_issues (project_id);
create index if not exists stg_issues_created_date_idx on staging.stg_issues (created_date);
create index if not exists stg_issues_team_idx         on staging.stg_issues (team);
create index if not exists stg_issues_status_idx       on staging.stg_issues (status);
create index if not exists stg_issues_is_open_idx      on staging.stg_issues (is_open);

-- ---------------------------------------------------------------------------
-- staging.stg_projects
-- ---------------------------------------------------------------------------
create materialized view if not exists staging.stg_projects as
select
  p.redmine_id          as id,
  p.identifier,
  p.name,
  p.description,
  p.parent_redmine_id   as parent_id,
  p.parent_name,
  p.status,
  p.is_public,
  p.created_on,
  p.updated_on
from public.redmine_projects p;

create unique index if not exists stg_projects_id_idx on staging.stg_projects (id);
