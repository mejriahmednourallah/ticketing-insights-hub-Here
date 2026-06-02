{{
  config(
    materialized = 'view'
  )
}}

select
  team,
  project_name,
  sum(opened)                                           as total_opened,
  sum(resolved)                                         as total_resolved,
  round(avg(avg_resolution_hours), 1)                   as avg_resolution_hours,
  max(week_start)                                       as latest_week,
  sum(opened) filter (
    where week_start = {{ date_trunc_compat('week', 'current_date') }}
  )                                                     as opened_this_week,
  sum(resolved) filter (
    where week_start = {{ date_trunc_compat('week', 'current_date') }}
  )                                                     as resolved_this_week
from {{ ref('mart_team_velocity') }}
group by team, project_name
