{{
  config(
    materialized = warehouse_materialization('table'),
    indexes      = warehouse_indexes([
      {'columns': ['id'], 'unique': true},
      {'columns': ['project_name']},
      {'columns': ['created_date']},
      {'columns': ['team']}
    ])
  )
}}

select
  id,
  project_id,
  project_identifier,
  project_name,
  tracker,
  status,
  priority,
  subject,
  description,
  author,
  assignee,
  team,
  technology,
  type,
  nature,
  intervention_type,
  satisfaction,
  source,
  canal,
  segment_client,
  region,
  reopened,
  sla_plan,
  fichiers,
  has_attachment,
  created_date,
  updated_date,
  closed_date,
  resolved_date,
  age_hours,
  is_open,
  sla_breached,
  sla_target_hours,
  custom_fields_json,
  field_mapping_json,
  raw_json,
  extract(year from created_date)::integer as created_year,
  extract(month from created_date)::integer as created_month
from {{ ref('stg_issues') }}
