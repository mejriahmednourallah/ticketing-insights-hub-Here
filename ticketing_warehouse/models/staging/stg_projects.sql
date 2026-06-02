{{
  config(
    materialized = warehouse_materialization(),
    indexes      = warehouse_indexes([{'columns': ['id'], 'unique': true}])
  )
}}

/*
  stg_projects — cleaned copy of public.redmine_projects.
*/

select
  p.redmine_id          as id,
  p.identifier,
  coalesce(p.name, '')  as name,
  p.description,
  p.parent_redmine_id   as parent_id,
  coalesce(p.parent_name, '') as parent_name,
  p.status,
  p.is_public,
  p.created_on,
  p.updated_on
from {{ source('public', 'redmine_projects') }} p
