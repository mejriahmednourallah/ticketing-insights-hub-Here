-- Read-only Supabase mirrors of the DuckDB analytics models.
-- These views are for inspection/screenshots in Supabase and are not used by the app runtime.

create schema if not exists analytics;

create or replace view analytics.fct_tickets as
select
  i.redmine_id as id,
  i.project_redmine_id as project_id,
  coalesce(i.project_identifier, '') as project_identifier,
  coalesce(i.project_name, '') as project_name,
  coalesce(i.tracker_name, '') as tracker,
  coalesce(i.status_name, '') as status,
  coalesce(i.priority_name, '') as priority,
  coalesce(i.subject, '') as subject,
  coalesce(i.description, '') as description,
  coalesce(i.author_name, '') as author,
  coalesce(i.assigned_to_name, '') as assignee,
  coalesce(i.team, '') as team,
  coalesce(i.technology, '') as technology,
  coalesce(nullif(i.nature, ''), nullif(i.intervention_type, ''), i.type, '') as type,
  coalesce(i.nature, '') as nature,
  coalesce(i.intervention_type, '') as intervention_type,
  coalesce(i.satisfaction, '') as satisfaction,
  coalesce(i.source, '') as source,
  coalesce(i.canal, '') as canal,
  coalesce(i.segment_client, '') as segment_client,
  coalesce(i.region, '') as region,
  coalesce(i.reopened, '') as reopened,
  coalesce(i.sla_plan, '') as sla_plan,
  coalesce(i.fichiers, '') as fichiers,
  coalesce(i.has_attachment, false) as has_attachment,
  i.created_on::date as created_date,
  i.updated_on::date as updated_date,
  case
    when i.created_on is not null
      and i.closed_on is not null
      and i.closed_on >= i.created_on
      and i.closed_on >= timestamp with time zone '2000-01-01 00:00:00+00'
    then i.closed_on::date
    else null
  end as closed_date,
  case
    when i.created_on is not null
      and i.resolved_on is not null
      and i.resolved_on >= i.created_on
      and i.resolved_on >= timestamp with time zone '2000-01-01 00:00:00+00'
    then i.resolved_on::date
    else null
  end as resolved_date,
  round(
    case
      when i.created_on is null then null
      when i.closed_on is not null
        and i.closed_on >= i.created_on
        and i.closed_on >= timestamp with time zone '2000-01-01 00:00:00+00'
      then extract(epoch from (i.closed_on - i.created_on)) / 3600.0
      when now() >= i.created_on
      then extract(epoch from (now() - i.created_on)) / 3600.0
      else null
    end,
    2
  ) as age_hours,
  not (
    i.closed_on is not null
    and i.created_on is not null
    and i.closed_on >= i.created_on
    and i.closed_on >= timestamp with time zone '2000-01-01 00:00:00+00'
  ) as is_open,
  case
    when i.closed_on is not null
      and i.created_on is not null
      and i.closed_on >= i.created_on
      and i.closed_on >= timestamp with time zone '2000-01-01 00:00:00+00'
      and s.target_hours is not null
      and extract(epoch from (i.closed_on - i.created_on)) / 3600.0 > s.target_hours
    then true
    else false
  end as sla_breached,
  s.target_hours as sla_target_hours,
  coalesce(i.custom_fields_json, '{}'::jsonb) as custom_fields_json,
  coalesce(i.field_mapping_json, '{}'::jsonb) as field_mapping_json,
  coalesce(i.raw_json, '{}'::jsonb) as raw_json,
  extract(year from i.created_on)::integer as created_year,
  extract(month from i.created_on)::integer as created_month
from public.redmine_issues i
left join public.sla_plan_config s
  on s.plan_name = i.sla_plan;

create or replace view analytics.v_mapping_quality as
with mapped_fields as (
  select id, project_name, tracker, 'team' as field_name, team as mapped_value,
    field_mapping_json #>> '{team,method}' as mapping_method,
    field_mapping_json #>> '{team,sourcePresent}' as source_present,
    field_mapping_json #>> '{team,nonEmptyCandidateCount}' as non_empty_candidates,
    field_mapping_json #>> '{team,conflict}' as has_conflict
  from analytics.fct_tickets
  union all
  select id, project_name, tracker, 'technology' as field_name, technology as mapped_value,
    field_mapping_json #>> '{technology,method}' as mapping_method,
    field_mapping_json #>> '{technology,sourcePresent}' as source_present,
    field_mapping_json #>> '{technology,nonEmptyCandidateCount}' as non_empty_candidates,
    field_mapping_json #>> '{technology,conflict}' as has_conflict
  from analytics.fct_tickets
  union all
  select id, project_name, tracker, 'nature' as field_name, nature as mapped_value,
    field_mapping_json #>> '{nature,method}' as mapping_method,
    field_mapping_json #>> '{nature,sourcePresent}' as source_present,
    field_mapping_json #>> '{nature,nonEmptyCandidateCount}' as non_empty_candidates,
    field_mapping_json #>> '{nature,conflict}' as has_conflict
  from analytics.fct_tickets
  union all
  select id, project_name, tracker, 'intervention_type' as field_name, intervention_type as mapped_value,
    field_mapping_json #>> '{interventionType,method}' as mapping_method,
    field_mapping_json #>> '{interventionType,sourcePresent}' as source_present,
    field_mapping_json #>> '{interventionType,nonEmptyCandidateCount}' as non_empty_candidates,
    field_mapping_json #>> '{interventionType,conflict}' as has_conflict
  from analytics.fct_tickets
  union all
  select id, project_name, tracker, 'source' as field_name, source as mapped_value,
    field_mapping_json #>> '{source,method}' as mapping_method,
    field_mapping_json #>> '{source,sourcePresent}' as source_present,
    field_mapping_json #>> '{source,nonEmptyCandidateCount}' as non_empty_candidates,
    field_mapping_json #>> '{source,conflict}' as has_conflict
  from analytics.fct_tickets
  union all
  select id, project_name, tracker, 'satisfaction' as field_name, satisfaction as mapped_value,
    field_mapping_json #>> '{satisfaction,method}' as mapping_method,
    field_mapping_json #>> '{satisfaction,sourcePresent}' as source_present,
    field_mapping_json #>> '{satisfaction,nonEmptyCandidateCount}' as non_empty_candidates,
    field_mapping_json #>> '{satisfaction,conflict}' as has_conflict
  from analytics.fct_tickets
)
select
  field_name,
  project_name,
  tracker,
  count(*)::integer as ticket_count,
  count(*) filter (where nullif(mapped_value, '') is not null)::integer as mapped_count,
  count(*) filter (where nullif(mapped_value, '') is null)::integer as missing_count,
  count(*) filter (where coalesce(source_present, 'false') = 'true')::integer as source_present_count,
  count(*) filter (where coalesce(mapping_method, '') = 'direct')::integer as direct_mapping_count,
  count(*) filter (where coalesce(mapping_method, '') = 'fallback')::integer as fallback_mapping_count,
  count(*) filter (where coalesce(has_conflict, 'false') = 'true')::integer as conflict_count,
  round(
    100.0 * count(*) filter (where nullif(mapped_value, '') is not null) / nullif(count(*), 0),
    2
  ) as coverage_pct
from mapped_fields
group by field_name, project_name, tracker;

create or replace view analytics.v_mapping_issues as
with mapped_fields as (
  select id, project_name, tracker, subject, 'team' as field_name, team as mapped_value,
    field_mapping_json #>> '{team,method}' as mapping_method,
    field_mapping_json #>> '{team,sourcePresent}' as source_present,
    field_mapping_json #>> '{team,nonEmptyCandidateCount}' as non_empty_candidates,
    field_mapping_json #>> '{team,conflict}' as has_conflict
  from analytics.fct_tickets
  union all
  select id, project_name, tracker, subject, 'technology' as field_name, technology as mapped_value,
    field_mapping_json #>> '{technology,method}' as mapping_method,
    field_mapping_json #>> '{technology,sourcePresent}' as source_present,
    field_mapping_json #>> '{technology,nonEmptyCandidateCount}' as non_empty_candidates,
    field_mapping_json #>> '{technology,conflict}' as has_conflict
  from analytics.fct_tickets
  union all
  select id, project_name, tracker, subject, 'nature' as field_name, nature as mapped_value,
    field_mapping_json #>> '{nature,method}' as mapping_method,
    field_mapping_json #>> '{nature,sourcePresent}' as source_present,
    field_mapping_json #>> '{nature,nonEmptyCandidateCount}' as non_empty_candidates,
    field_mapping_json #>> '{nature,conflict}' as has_conflict
  from analytics.fct_tickets
  union all
  select id, project_name, tracker, subject, 'intervention_type' as field_name, intervention_type as mapped_value,
    field_mapping_json #>> '{interventionType,method}' as mapping_method,
    field_mapping_json #>> '{interventionType,sourcePresent}' as source_present,
    field_mapping_json #>> '{interventionType,nonEmptyCandidateCount}' as non_empty_candidates,
    field_mapping_json #>> '{interventionType,conflict}' as has_conflict
  from analytics.fct_tickets
  union all
  select id, project_name, tracker, subject, 'source' as field_name, source as mapped_value,
    field_mapping_json #>> '{source,method}' as mapping_method,
    field_mapping_json #>> '{source,sourcePresent}' as source_present,
    field_mapping_json #>> '{source,nonEmptyCandidateCount}' as non_empty_candidates,
    field_mapping_json #>> '{source,conflict}' as has_conflict
  from analytics.fct_tickets
  union all
  select id, project_name, tracker, subject, 'satisfaction' as field_name, satisfaction as mapped_value,
    field_mapping_json #>> '{satisfaction,method}' as mapping_method,
    field_mapping_json #>> '{satisfaction,sourcePresent}' as source_present,
    field_mapping_json #>> '{satisfaction,nonEmptyCandidateCount}' as non_empty_candidates,
    field_mapping_json #>> '{satisfaction,conflict}' as has_conflict
  from analytics.fct_tickets
)
select
  id,
  project_name,
  tracker,
  subject,
  field_name,
  mapped_value,
  mapping_method,
  source_present,
  non_empty_candidates,
  has_conflict,
  case
    when nullif(mapped_value, '') is null and coalesce(source_present, 'false') = 'true' then 'source_present_but_unmapped'
    when nullif(mapped_value, '') is null then 'missing'
    when coalesce(has_conflict, 'false') = 'true' then 'conflict'
    when coalesce(mapping_method, '') = 'fallback' then 'fallback_used'
    else 'ok'
  end as quality_status
from mapped_fields
where nullif(mapped_value, '') is null
  or coalesce(has_conflict, 'false') = 'true'
  or coalesce(mapping_method, '') = 'fallback';

create or replace view analytics.v_mapping_format_issues as
with resolved_values as (
  select
    id,
    project_name,
    tracker,
    subject,
    nullif(field_mapping_json #>> '{resolvedDate,value}', '') as source_value
  from analytics.fct_tickets
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
where source_value is not null
  and (
    source_value like '[%'
    or not (source_value ~ '^\d{4}-\d{2}-\d{2}($|[T\s])')
    or (
      source_value ~ '^\d{4}-'
      and substring(source_value from 1 for 4)::integer < 2000
    )
  );

comment on view analytics.fct_tickets is
  'Read-only Supabase mirror of DuckDB analytics.fct_tickets for inspection/screenshots.';
comment on view analytics.v_mapping_quality is
  'Read-only mapping coverage summary for Supabase inspection/screenshots.';
comment on view analytics.v_mapping_issues is
  'Read-only mapping issue detail for Supabase inspection/screenshots.';
comment on view analytics.v_mapping_format_issues is
  'Read-only source-format issue detail for Supabase inspection/screenshots.';

grant usage on schema staging, marts, analytics to anon, authenticated;
grant select on all tables in schema staging to anon, authenticated;
grant select on all tables in schema marts to anon, authenticated;
grant select on all tables in schema analytics to anon, authenticated;
