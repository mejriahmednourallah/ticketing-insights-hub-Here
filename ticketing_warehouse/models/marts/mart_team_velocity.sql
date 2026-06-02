{{
  config(
    materialized = warehouse_materialization(),
    indexes      = warehouse_indexes([{'columns': ['week_start', 'team', 'project_name'], 'unique': true}])
  )
}}

/*
  mart_team_velocity — tickets opened and resolved per team per calendar week.
  Feeds the "Team" tab KPI cards and the velocity trend chart.
*/

select
  {{ date_trunc_compat('week', 'created_date') }}      as week_start,
  team,
  project_name,
  count(*)                                            as opened,
  count(*) filter (where closed_date is not null)     as resolved,
  round(
    avg(age_hours) filter (where closed_date is not null)
  , 1)                                                as avg_resolution_hours
from {{ ref('stg_issues') }}
group by 1, 2, 3
