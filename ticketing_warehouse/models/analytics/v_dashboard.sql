{{
  config(
    materialized = 'view'
  )
}}

with project_totals as (
  select
    project_name,
    count(*)                                            as total_issues,
    count(*) filter (where is_open)                     as open_issues,
    count(*) filter (where not is_open)                 as closed_issues,
    round(avg(age_hours), 1)                            as avg_age_hours,
    round(avg(age_hours) filter (where not is_open), 1) as avg_resolution_hours
  from {{ ref('stg_issues') }}
  group by project_name
),

sla_summary as (
  select
    project_name,
    sum(total)                                          as sla_total,
    sum(breached)                                       as sla_breached,
    round(
      100.0 * sum(compliant) / nullif(sum(total), 0)
    , 2)                                                as sla_compliance_pct
  from {{ ref('mart_sla_compliance') }}
  group by project_name
),

recent_volume as (
  select
    project_name,
    sum(opened)                                         as opened_last_30d,
    sum(closed_ever)                                    as closed_last_30d
  from {{ ref('mart_daily_volume') }}
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
  sl.sla_compliance_pct,
  coalesce(sl.sla_breached, 0)                          as sla_breached_total,
  coalesce(rv.opened_last_30d, 0)                       as opened_last_30d,
  coalesce(rv.closed_last_30d, 0)                       as closed_last_30d
from project_totals pt
left join sla_summary sl on sl.project_name = pt.project_name
left join recent_volume rv on rv.project_name = pt.project_name
