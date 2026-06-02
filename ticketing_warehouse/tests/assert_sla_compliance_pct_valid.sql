/*
  Singular test: SLA compliance_pct must be between 0 and 100 (inclusive).
  Returns violating rows.
*/

select week_start, project_name, team, sla_plan, compliance_pct
from {{ ref('mart_sla_compliance') }}
where compliance_pct < 0
   or compliance_pct > 100
