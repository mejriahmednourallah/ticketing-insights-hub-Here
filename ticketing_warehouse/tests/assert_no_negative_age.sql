/*
  Singular test: every issue must have a non-negative age.
  Returns rows that violate the rule (dbt fails the test if any rows are returned).
*/

select id, age_hours
from {{ ref('stg_issues') }}
where age_hours < 0
