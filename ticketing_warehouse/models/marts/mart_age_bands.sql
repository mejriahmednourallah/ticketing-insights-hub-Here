{{
  config(
    materialized = warehouse_materialization(),
    indexes      = warehouse_indexes([{'columns': ['project_name', 'team', 'age_band'], 'unique': true}])
  )
}}

/*
  mart_age_bands — open-ticket backlog split into five age buckets.
  Feeds the "Backlog Health" stacked bar chart.
*/

select
  project_name,
  team,
  case
    when age_hours <  24  then '< 1 day'
    when age_hours <  72  then '1–3 days'
    when age_hours < 168  then '3–7 days'
    when age_hours < 720  then '7–30 days'
    else                       '> 30 days'
  end                                                 as age_band,
  case
    when age_hours <  24  then 1
    when age_hours <  72  then 2
    when age_hours < 168  then 3
    when age_hours < 720  then 4
    else                       5
  end                                                 as band_order,
  count(*)                                            as ticket_count,
  round(avg(age_hours), 1)                            as avg_age_hours
from {{ ref('stg_issues') }}
where is_open = true
group by 1, 2, 3, 4
