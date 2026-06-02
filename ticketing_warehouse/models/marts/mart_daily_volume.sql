{{
  config(
    materialized = warehouse_materialization(),
    indexes      = warehouse_indexes([{'columns': ['day', 'project_name'], 'unique': true}])
  )
}}

/*
  mart_daily_volume — tickets opened and closed per calendar day per project.
  Feeds the trend sparklines and volume bar charts on the dashboard.
*/

select
  created_date                                        as day,
  project_name,
  count(*)                                            as opened,
  count(*) filter (where closed_date = created_date)  as same_day_closed,
  count(*) filter (where closed_date is not null)     as closed_ever
from {{ ref('stg_issues') }}
group by 1, 2
