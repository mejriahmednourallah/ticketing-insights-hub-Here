{{
  config(
    materialized = 'view'
  )
}}

select
  project_name,
  team,
  age_band,
  band_order,
  ticket_count,
  avg_age_hours
from {{ ref('mart_age_bands') }}
