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
  - Invalid analytical dates are nulled so durations cannot go negative.
  - age_hours is computed from creation to a valid close (or now if still open).
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
  coalesce(i.description, '')                                   as description,
  coalesce(i.author_name, '')                                   as author,
  coalesce(i.assigned_to_name, '')                              as assignee,
  coalesce(i.team, '')                                          as team,
  coalesce(i.technology, '')                                    as technology,
  coalesce(nullif(i.nature, ''), nullif(i.intervention_type, ''), i.type, '') as type,
  coalesce(i.nature, '')                                        as nature,
  coalesce(i.intervention_type, '')                             as intervention_type,
  coalesce(i.satisfaction, '')                                  as satisfaction,
  coalesce(i.source, '')                                        as source,
  coalesce(i.canal, '')                                         as canal,
  coalesce(i.segment_client, '')                                as segment_client,
  coalesce(i.region, '')                                        as region,
  coalesce(i.reopened, '')                                      as reopened,
  coalesce(i.sla_plan, '')                                      as sla_plan,
  coalesce(i.fichiers, '')                                      as fichiers,
  coalesce(i.has_attachment, false)                             as has_attachment,
  i.custom_fields_json,
  i.field_mapping_json,
  i.raw_json,

  -- Date fields
  {{ date_cast('i.created_on') }}                                as created_date,
  {{ date_cast('i.updated_on') }}                                as updated_date,
  case
    when i.created_on is not null
     and i.closed_on is not null
     and i.closed_on >= i.created_on
     and i.closed_on >= timestamp '2000-01-01'
    then {{ date_cast('i.closed_on') }}
    else null
  end                                                           as closed_date,
  case
    when i.created_on is not null
     and i.resolved_on is not null
     and i.resolved_on >= i.created_on
     and i.resolved_on >= timestamp '2000-01-01'
    then {{ date_cast('i.resolved_on') }}
    else null
  end                                                           as resolved_date,

  -- Derived
  round(
    case
      when i.created_on is null then null
      when i.closed_on is not null
       and i.closed_on >= i.created_on
       and i.closed_on >= timestamp '2000-01-01'
      then {{ datediff_hours('i.created_on', 'i.closed_on') }}
      when {{ current_timestamp_compat() }} >= i.created_on
      then {{ datediff_hours('i.created_on', current_timestamp_compat()) }}
      else null
    end
  , 2)                                                          as age_hours,

  not (
    i.closed_on is not null
    and i.created_on is not null
    and i.closed_on >= i.created_on
    and i.closed_on >= timestamp '2000-01-01'
  )                                                            as is_open,

  case
    when i.closed_on is not null
     and i.created_on is not null
     and i.closed_on >= i.created_on
     and i.closed_on >= timestamp '2000-01-01'
     and s.target_hours is not null
     and {{ datediff_hours('i.created_on', 'i.closed_on') }}
         > s.target_hours
    then true
    else false
  end                                                           as sla_breached,

  s.target_hours                                                as sla_target_hours

from raw_issues i
left join sla_config s on s.plan_name = i.sla_plan
