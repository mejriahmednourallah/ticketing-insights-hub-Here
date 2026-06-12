{{
  config(
    materialized = 'view'
  )
}}

with resolved_values as (
  select
    id,
    project_name,
    tracker,
    subject,
    {{ json_mapping_value('field_mapping_json', 'resolvedDate', 'value') }} as source_value
  from {{ ref('stg_issues') }}
)

select
  id,
  project_name,
  tracker,
  subject,
  'resolved_date' as field_name,
  source_value,
  'invalid_date_or_array' as issue_type
from resolved_values
where coalesce(source_value, '') <> ''
  and not ({{ timestamp_is_valid('source_value') }})
