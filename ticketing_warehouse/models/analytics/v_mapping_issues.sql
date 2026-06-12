{{
  config(
    materialized = 'view'
  )
}}

with fields as (
  select id, project_name, tracker, subject, 'team' as field_name, team as mapped_value,
         {{ json_mapping_value('field_mapping_json', 'team', 'method') }} as mapping_method,
         {{ json_mapping_value('field_mapping_json', 'team', 'sourcePresent') }} as source_present,
         {{ json_mapping_value('field_mapping_json', 'team', 'nonEmptyCandidateCount') }} as non_empty_candidates,
         {{ json_mapping_value('field_mapping_json', 'team', 'conflict') }} as has_conflict
  from {{ ref('stg_issues') }}
  union all
  select id, project_name, tracker, subject, 'technology', technology,
         {{ json_mapping_value('field_mapping_json', 'technology', 'method') }},
         {{ json_mapping_value('field_mapping_json', 'technology', 'sourcePresent') }},
         {{ json_mapping_value('field_mapping_json', 'technology', 'nonEmptyCandidateCount') }},
         {{ json_mapping_value('field_mapping_json', 'technology', 'conflict') }}
  from {{ ref('stg_issues') }}
  union all
  select id, project_name, tracker, subject, 'nature', nature,
         {{ json_mapping_value('field_mapping_json', 'nature', 'method') }},
         {{ json_mapping_value('field_mapping_json', 'nature', 'sourcePresent') }},
         {{ json_mapping_value('field_mapping_json', 'nature', 'nonEmptyCandidateCount') }},
         {{ json_mapping_value('field_mapping_json', 'nature', 'conflict') }}
  from {{ ref('stg_issues') }}
  union all
  select id, project_name, tracker, subject, 'intervention_type', intervention_type,
         {{ json_mapping_value('field_mapping_json', 'interventionType', 'method') }},
         {{ json_mapping_value('field_mapping_json', 'interventionType', 'sourcePresent') }},
         {{ json_mapping_value('field_mapping_json', 'interventionType', 'nonEmptyCandidateCount') }},
         {{ json_mapping_value('field_mapping_json', 'interventionType', 'conflict') }}
  from {{ ref('stg_issues') }}
  union all
  select id, project_name, tracker, subject, 'source', source,
         {{ json_mapping_value('field_mapping_json', 'source', 'method') }},
         {{ json_mapping_value('field_mapping_json', 'source', 'sourcePresent') }},
         {{ json_mapping_value('field_mapping_json', 'source', 'nonEmptyCandidateCount') }},
         {{ json_mapping_value('field_mapping_json', 'source', 'conflict') }}
  from {{ ref('stg_issues') }}
)

select
  id,
  project_name,
  tracker,
  subject,
  field_name,
  mapped_value,
  coalesce(mapping_method, 'missing') as mapping_method,
  case
    when coalesce(has_conflict, 'false') = 'true' then 'conflict'
    when mapped_value = ''
      and source_present = 'true'
      and cast(coalesce(non_empty_candidates, '0') as integer) = 0
      then 'source_empty'
    when mapped_value = ''
      and coalesce(source_present, 'false') = 'false'
      then 'source_absent'
    when mapped_value = ''
      and cast(coalesce(non_empty_candidates, '0') as integer) > 0
      then 'mapping_failure'
    else 'mapped'
  end as quality_status
from fields
where mapped_value = '' or coalesce(has_conflict, 'false') = 'true'
