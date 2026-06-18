alter table public.redmine_issues
  add column if not exists nature text not null default '',
  add column if not exists intervention_type text not null default '',
  add column if not exists field_mapping_json jsonb not null default '{}'::jsonb;

create index if not exists redmine_issues_nature_idx
  on public.redmine_issues (nature);

create index if not exists redmine_issues_intervention_type_idx
  on public.redmine_issues (intervention_type);

drop view if exists public.redmine_ticket_view;
create view public.redmine_ticket_view as
select
  i.redmine_id::text as id,
  coalesce(i.project_name, '') as project,
  coalesce(i.tracker_name, '') as tracker,
  coalesce(i.status_name, '') as status,
  coalesce(i.priority_name, '') as priority,
  coalesce(i.subject, '') as subject,
  coalesce(i.author_name, '') as author,
  coalesce(i.assigned_to_name, '') as assignee,
  i.created_on as created_date,
  i.closed_on as closed_date,
  i.resolved_on as resolved_date,
  coalesce(i.team, '') as team,
  coalesce(i.technology, '') as technology,
  coalesce(nullif(i.nature, ''), nullif(i.intervention_type, ''), i.type, '') as type,
  coalesce(i.nature, '') as nature,
  coalesce(i.intervention_type, '') as intervention_type,
  coalesce(i.satisfaction, '') as satisfaction,
  coalesce(i.source, '') as source,
  coalesce(i.fichiers, '') as fichiers,
  coalesce(i.has_attachment, false) as has_attachment,
  coalesce(i.canal, '') as canal,
  coalesce(i.segment_client, '') as segment_client,
  coalesce(i.region, '') as region,
  coalesce(i.reopened, '') as reopened,
  coalesce(i.sla_plan, '') as sla_plan,
  coalesce(i.field_mapping_json, '{}'::jsonb) as field_mapping_json,
  extract(year from i.created_on)::int as year,
  extract(month from i.created_on)::int as month
from public.redmine_issues i;
