{{
  config(
    materialized = warehouse_materialization(),
    indexes      = warehouse_indexes([{'columns': ['id'], 'unique': true}])
  )
}}

/*
  stg_issues — cleaned, typed copy of public.redmine_issues.

  Key transforms applied here:
  - All nullable text fields are coalesced to '' so downstream models
    can GROUP BY without NULL-grouping surprises.
  - Timestamps are truncated to ::date for aggregation efficiency.
  - age_hours is computed from creation to close (or now if still open).
  - sla_breached joins the sla_plan_config lookup table; defaults to false
    when no matching plan is configured.
*/

with raw_issues as (
  select * from {{ source('public', 'redmine_issues') }}
),

sla_config as (
  select * from {{ source('public', 'sla_plan_config') }}
)

select
  i.redmine_id                                                  as id,
  i.project_redmine_id                                          as project_id,
  i.project_identifier,
  coalesce(i.project_name, '')                                  as project_name,
  coalesce(i.tracker_name, '')                                  as tracker,
  coalesce(i.status_name, '')                                   as status,
  coalesce(i.priority_name, '')                                 as priority,
  coalesce(i.subject, '')                                       as subject,
  coalesce(i.author_name, '')                                   as author,
  coalesce(i.assigned_to_name, '')                              as assignee,
  coalesce(i.team, '')                                          as team,
  coalesce(i.technology, '')                                    as technology,
  coalesce(i.type, '')                                          as type,
  coalesce(i.satisfaction, '')                                  as satisfaction,
  coalesce(i.source, '')                                        as source,
  coalesce(i.canal, '')                                         as canal,
  coalesce(i.segment_client, '')                                as segment_client,
  coalesce(i.region, '')                                        as region,
  coalesce(i.reopened, '')                                      as reopened,
  coalesce(i.sla_plan, '')                                      as sla_plan,

  -- Date fields
  {{ date_cast('i.created_on') }}                                as created_date,
  {{ date_cast('i.updated_on') }}                                as updated_date,
  {{ date_cast('i.closed_on') }}                                 as closed_date,
  {{ date_cast('i.resolved_on') }}                               as resolved_date,

  -- Derived
  round(
    {{ datediff_hours('i.created_on', 'coalesce(i.closed_on, ' ~ current_timestamp_compat() ~ ')') }}
  , 2)                                                          as age_hours,

  (i.closed_on is null)                                         as is_open,

  case
    when i.closed_on is not null
     and s.target_hours is not null
     and {{ datediff_hours('i.created_on', 'i.closed_on') }}
         > s.target_hours
    then true
    else false
  end                                                           as sla_breached,

  s.target_hours                                                as sla_target_hours

from raw_issues i
left join sla_config s on s.plan_name = i.sla_plan
