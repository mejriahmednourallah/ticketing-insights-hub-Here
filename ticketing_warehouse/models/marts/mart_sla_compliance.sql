{{
  config(
    materialized = warehouse_materialization(),
    indexes      = warehouse_indexes([{'columns': ['week_start', 'project_name', 'team', 'sla_plan'], 'unique': true}])
  )
}}

/*
  mart_sla_compliance — SLA breach % by project, team, SLA plan, and week.
  Only rows where sla_plan is set and sla_target_hours is known are included
  so the compliance_pct is meaningful.
*/

select
  {{ date_trunc_compat('week', 'created_date') }}      as week_start,
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
from {{ ref('stg_issues') }}
where sla_plan <> ''
  and sla_target_hours is not null
group by 1, 2, 3, 4
