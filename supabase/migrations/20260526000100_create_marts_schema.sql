-- =============================================================================
-- Migration: create marts schema
-- Business-level aggregations sourced from staging.stg_issues.
-- Runs after: 20260526000000_create_staging_schema.sql
-- =============================================================================

create schema if not exists marts;

-- ---------------------------------------------------------------------------
-- mart_daily_volume
-- Tickets opened and closed per calendar day per project.
-- ---------------------------------------------------------------------------
create materialized view if not exists marts.mart_daily_volume as
select
  created_date                                        as day,
  project_name,
  count(*)                                            as opened,
  count(*) filter (where closed_date = created_date)  as same_day_closed,
  count(*) filter (where closed_date is not null)     as closed_ever
from staging.stg_issues
group by 1, 2;

create unique index if not exists mart_daily_volume_pk
  on marts.mart_daily_volume (day, project_name);

-- ---------------------------------------------------------------------------
-- mart_team_velocity
-- Tickets resolved per team per calendar week.
-- ---------------------------------------------------------------------------
create materialized view if not exists marts.mart_team_velocity as
select
  date_trunc('week', created_date)                    as week_start,
  team,
  project_name,
  count(*)                                            as opened,
  count(*) filter (where closed_date is not null)     as resolved,
  round(
    avg(age_hours) filter (where closed_date is not null)
  , 1)                                                as avg_resolution_hours
from staging.stg_issues
group by 1, 2, 3;

create unique index if not exists mart_team_velocity_pk
  on marts.mart_team_velocity (week_start, team, project_name);

-- ---------------------------------------------------------------------------
-- mart_sla_compliance
-- SLA breach % by project + team + week.
-- ---------------------------------------------------------------------------
create materialized view if not exists marts.mart_sla_compliance as
select
  date_trunc('week', created_date)                    as week_start,
  project_name,
  team,
  sla_plan,
  count(*)                                            as total,
  count(*) filter (where sla_breached)                as breached,
  count(*) filter (where not sla_breached)            as compliant,
  round(
    100.0 * count(*) filter (where not sla_breached)
    / nullif(count(*), 0)
  , 2)                                                as compliance_pct
from staging.stg_issues
where sla_plan <> ''
  and sla_target_hours is not null
group by 1, 2, 3, 4;

create unique index if not exists mart_sla_compliance_pk
  on marts.mart_sla_compliance (week_start, project_name, team, sla_plan);

-- ---------------------------------------------------------------------------
-- mart_age_bands
-- Open tickets bucketed by age (useful for backlog health charts).
-- ---------------------------------------------------------------------------
create materialized view if not exists marts.mart_age_bands as
select
  project_name,
  team,
  case
    when age_hours <  24              then '< 1 day'
    when age_hours <  72              then '1–3 days'
    when age_hours < 168              then '3–7 days'
    when age_hours < 720              then '7–30 days'
    else                                   '> 30 days'
  end                                                 as age_band,
  -- Canonical sort key so the frontend can order bands correctly
  case
    when age_hours <  24              then 1
    when age_hours <  72              then 2
    when age_hours < 168              then 3
    when age_hours < 720              then 4
    else                                   5
  end                                                 as band_order,
  count(*)                                            as ticket_count,
  round(avg(age_hours), 1)                            as avg_age_hours
from staging.stg_issues
where is_open = true
group by 1, 2, 3, 4;

create unique index if not exists mart_age_bands_pk
  on marts.mart_age_bands (project_name, team, age_band);

-- ---------------------------------------------------------------------------
-- mart_similarity_features
-- Pre-flattened text corpus for TF-IDF computation in Edge Functions.
-- Storing subject + description here avoids rescanning redmine_issues on
-- every similarity request.
-- ---------------------------------------------------------------------------
create materialized view if not exists marts.mart_similarity_features as
select
  id,
  project_name,
  team,
  tracker,
  status,
  -- Combine subject + description into a single corpus string
  trim(
    coalesce(subject, '') || ' ' || coalesce(
      (select description from public.redmine_issues ri where ri.redmine_id = s.id),
      ''
    )
  )                                                   as corpus,
  created_date,
  is_open
from staging.stg_issues s;

create unique index if not exists mart_similarity_features_pk
  on marts.mart_similarity_features (id);
create index if not exists mart_similarity_features_project_idx
  on marts.mart_similarity_features (project_name);
