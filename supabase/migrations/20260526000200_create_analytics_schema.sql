-- =============================================================================
-- Migration: create analytics schema
-- Lightweight views the frontend queries directly.
-- Runs after: 20260526000100_create_marts_schema.sql
-- =============================================================================

create schema if not exists analytics;

-- ---------------------------------------------------------------------------
-- analytics.v_dashboard
-- Single view for the main KPI panel. Joins marts for the last 30 days.
-- The frontend can read this instead of scanning redmine_ticket_view for
-- every dashboard load.
-- ---------------------------------------------------------------------------
create or replace view analytics.v_dashboard as
with

-- ── Total open / closed counts per project ────────────────────────────────
project_totals as (
  select
    project_name,
    count(*)                                          as total_issues,
    count(*) filter (where is_open)                   as open_issues,
    count(*) filter (where not is_open)               as closed_issues,
    round(avg(age_hours), 1)                          as avg_age_hours,
    round(avg(age_hours) filter (where not is_open), 1) as avg_resolution_hours
  from staging.stg_issues
  group by project_name
),

-- ── SLA compliance summary (all time, per project) ────────────────────────
sla_summary as (
  select
    project_name,
    sum(total)                                        as sla_total,
    sum(breached)                                     as sla_breached,
    round(
      100.0 * sum(compliant) / nullif(sum(total), 0)
    , 2)                                              as sla_compliance_pct
  from marts.mart_sla_compliance
  group by project_name
),

-- ── 30-day daily trend (for sparklines) ───────────────────────────────────
recent_volume as (
  select
    project_name,
    sum(opened)                                       as opened_last_30d,
    sum(closed_ever)                                  as closed_last_30d
  from marts.mart_daily_volume
  where day >= current_date - interval '30 days'
  group by project_name
)

select
  pt.project_name,
  pt.total_issues,
  pt.open_issues,
  pt.closed_issues,
  pt.avg_age_hours,
  pt.avg_resolution_hours,
  coalesce(sl.sla_compliance_pct, null)               as sla_compliance_pct,
  coalesce(sl.sla_breached, 0)                        as sla_breached_total,
  coalesce(rv.opened_last_30d, 0)                     as opened_last_30d,
  coalesce(rv.closed_last_30d, 0)                     as closed_last_30d
from project_totals pt
left join sla_summary   sl on sl.project_name = pt.project_name
left join recent_volume rv on rv.project_name = pt.project_name;

-- ---------------------------------------------------------------------------
-- analytics.v_team_kpis
-- Per-team performance summary — feeds the "Team" tab on the dashboard.
-- ---------------------------------------------------------------------------
create or replace view analytics.v_team_kpis as
select
  team,
  project_name,
  sum(opened)                                         as total_opened,
  sum(resolved)                                       as total_resolved,
  round(avg(avg_resolution_hours), 1)                 as avg_resolution_hours,
  -- Latest week so the frontend can show "this week" figures
  max(week_start)                                     as latest_week,
  sum(opened)  filter (
    where week_start = date_trunc('week', current_date)
  )                                                   as opened_this_week,
  sum(resolved) filter (
    where week_start = date_trunc('week', current_date)
  )                                                   as resolved_this_week
from marts.mart_team_velocity
group by team, project_name;

-- ---------------------------------------------------------------------------
-- analytics.v_backlog_health
-- Age-band breakdown across all open tickets — feeds the backlog chart.
-- ---------------------------------------------------------------------------
create or replace view analytics.v_backlog_health as
select
  project_name,
  team,
  age_band,
  band_order,
  ticket_count,
  avg_age_hours
from marts.mart_age_bands
order by project_name, team, band_order;
