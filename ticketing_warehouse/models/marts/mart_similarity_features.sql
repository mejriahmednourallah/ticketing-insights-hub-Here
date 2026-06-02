{{
  config(
    materialized = warehouse_materialization(),
    indexes      = warehouse_indexes([
      {'columns': ['id'], 'unique': true},
      {'columns': ['project_name']}
    ])
  )
}}

/*
  mart_similarity_features - pre-flattened text corpus for local analytics.
*/

select
  s.id,
  s.project_name,
  s.team,
  s.tracker,
  s.status,
  trim(
    coalesce(s.subject, '') || ' ' || coalesce(i.description, '')
  )                                                     as corpus,
  s.created_date,
  s.is_open
from {{ ref('stg_issues') }} s
left join {{ source('public', 'redmine_issues') }} i
  on i.redmine_id = s.id
