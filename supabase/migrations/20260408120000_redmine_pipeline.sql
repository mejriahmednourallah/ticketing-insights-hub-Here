create table if not exists public.redmine_projects (
  redmine_id bigint primary key,
  identifier text not null unique,
  name text not null,
  description text,
  parent_redmine_id bigint,
  parent_name text,
  status integer,
  is_public boolean,
  trackers_json jsonb not null default '[]'::jsonb,
  issue_categories_json jsonb not null default '[]'::jsonb,
  enabled_modules_json jsonb not null default '[]'::jsonb,
  created_on timestamptz,
  updated_on timestamptz,
  raw_json jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists redmine_projects_identifier_idx on public.redmine_projects (identifier);
create index if not exists redmine_projects_parent_idx on public.redmine_projects (parent_redmine_id);

create table if not exists public.redmine_issues (
  redmine_id bigint primary key,
  project_redmine_id bigint not null references public.redmine_projects (redmine_id) on delete cascade,
  project_identifier text not null,
  project_name text not null,
  tracker_name text not null default '',
  status_name text not null default '',
  priority_name text not null default '',
  subject text not null default '',
  description text,
  author_name text not null default '',
  assigned_to_name text not null default '',
  created_on timestamptz,
  updated_on timestamptz,
  closed_on timestamptz,
  resolved_on timestamptz,
  team text not null default '',
  technology text not null default '',
  type text not null default '',
  satisfaction text not null default '',
  source text not null default '',
  fichiers text not null default '',
  has_attachment boolean not null default false,
  canal text not null default '',
  segment_client text not null default '',
  region text not null default '',
  reopened text not null default '',
  sla_plan text not null default '',
  attachments_json jsonb not null default '[]'::jsonb,
  custom_fields_json jsonb not null default '[]'::jsonb,
  raw_json jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists redmine_issues_project_idx on public.redmine_issues (project_redmine_id);
create index if not exists redmine_issues_updated_idx on public.redmine_issues (updated_on);
create index if not exists redmine_issues_status_idx on public.redmine_issues (status_name);

create table if not exists public.sync_state (
  source text primary key,
  last_sync_at timestamptz,
  last_success_at timestamptz,
  last_offset bigint not null default 0,
  last_error text,
  updated_at timestamptz not null default now()
);

create table if not exists public.sync_runs (
  id bigserial primary key,
  source text not null default 'redmine',
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  status text not null default 'running',
  metrics_json jsonb not null default '{}'::jsonb,
  error_text text
);

create or replace view public.redmine_ticket_view as
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
  coalesce(i.type, '') as type,
  coalesce(i.satisfaction, '') as satisfaction,
  coalesce(i.source, '') as source,
  coalesce(i.fichiers, '') as fichiers,
  coalesce(i.has_attachment, false) as has_attachment,
  coalesce(i.canal, '') as canal,
  coalesce(i.segment_client, '') as segment_client,
  coalesce(i.region, '') as region,
  coalesce(i.reopened, '') as reopened,
  coalesce(i.sla_plan, '') as sla_plan,
  extract(year from i.created_on)::int as year,
  extract(month from i.created_on)::int as month
from public.redmine_issues i;
