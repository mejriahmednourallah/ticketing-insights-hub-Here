import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

type RedmineProject = {
  id: number;
  name: string;
  identifier: string;
  description?: string;
  status?: number;
  is_public?: boolean;
  parent?: { id?: number; name?: string };
  trackers?: Array<{ id?: number; name?: string }>;
  issue_categories?: Array<{ id?: number; name?: string }>;
  enabled_modules?: Array<{ id?: number; name?: string }>;
  created_on?: string;
  updated_on?: string;
};

type RedmineIssue = {
  id: number;
  tracker?: { name?: string };
  status?: { name?: string };
  priority?: { name?: string };
  subject?: string;
  description?: string;
  author?: { name?: string };
  assigned_to?: { name?: string };
  created_on?: string;
  updated_on?: string;
  closed_on?: string | null;
  attachments?: Array<{ filename?: string }>;
  custom_fields?: Array<{ id?: number; name?: string; value?: unknown }>;
};

type ListResponse<T> = {
  total_count?: number;
  offset?: number;
  limit?: number;
  [key: string]: unknown;
};

const REDMINE_URL = required('REDMINE_URL');
const REDMINE_API_KEY = required('REDMINE_API_KEY');
const SUPABASE_URL = required('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = required('SUPABASE_SERVICE_ROLE_KEY');
const PAGE_SIZE = Number(Deno.env.get('REDMINE_PAGE_SIZE') || '100');

const fieldMappings = {
  team: parseAliases('REDMINE_FIELD_TEAM', ['Equipe Affectée', 'Equipe Affectee', 'team']),
  technology: parseAliases('REDMINE_FIELD_TECHNOLOGY', ['CMS / Framework', 'technology', 'technology_used']),
  type: parseAliases('REDMINE_FIELD_TYPE', ['Type', 'type']),
  satisfaction: parseAliases('REDMINE_FIELD_SATISFACTION', ['Degré de satisfaction', 'Degrè de satisfaction', 'csat_score', 'satisfaction']),
  source: parseAliases('REDMINE_FIELD_SOURCE', ['Source', 'source']),
  canal: parseAliases('REDMINE_FIELD_CANAL', ['Canal', 'channel', 'canal']),
  segmentClient: parseAliases('REDMINE_FIELD_SEGMENT_CLIENT', ['Segment client', 'customer_segment', 'segment_client']),
  region: parseAliases('REDMINE_FIELD_REGION', ['Région', 'region']),
  reopened: parseAliases('REDMINE_FIELD_REOPENED', ['Réouvert', 'reouvert', 'reopened']),
  slaPlan: parseAliases('REDMINE_FIELD_SLA_PLAN', ['SLA plan', 'sla_plan']),
};

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function required(name: string): string {
  const value = Deno.env.get(name);
  if (!value || value.trim() === '') {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value.trim();
}

function parseAliases(envName: string, defaults: string[]): string[] {
  const raw = Deno.env.get(envName);
  if (!raw || raw.trim() === '') return defaults;
  return raw.split(',').map(x => x.trim()).filter(Boolean);
}

function baseUrl(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}

function normalizeToken(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function valueToString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map(valueToString).filter(Boolean).join(', ');
  return String(value).trim();
}

function getCustomField(
  customFields: Array<{ id?: number; name?: string; value?: unknown }> | undefined,
  aliases: string[],
): string {
  if (!customFields || customFields.length === 0) return '';

  const normalizedAliases = aliases.map(normalizeToken);
  const field = customFields.find(cf => {
    const nameToken = normalizeToken(cf.name || '');
    const idToken = cf.id !== undefined ? normalizeToken(String(cf.id)) : '';
    return normalizedAliases.includes(nameToken) || normalizedAliases.includes(idToken);
  });

  return valueToString(field?.value);
}

function attachmentNames(attachments: Array<{ filename?: string }> | undefined): string {
  if (!attachments || attachments.length === 0) return '';
  return attachments.map(a => a.filename || '').filter(Boolean).join('\n');
}

async function fetchWithRetry(url: string, init: RequestInit, attempt = 0): Promise<Response> {
  const response = await fetch(url, init);
  if (response.ok) return response;

  const text = await response.text().catch(() => '');
  const retryable = response.status === 429 || response.status >= 500;
  if (!retryable || attempt >= 5) {
    throw new Error(`Redmine request failed (${response.status}): ${text || response.statusText}`);
  }

  const retryAfter = Number(response.headers.get('Retry-After') || '0');
  const waitMs = retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt;
  await new Promise(resolve => setTimeout(resolve, waitMs));
  return fetchWithRetry(url, init, attempt + 1);
}

async function fetchJson<T>(path: string, query: Record<string, string | number | undefined>): Promise<T> {
  const url = new URL(path.replace(/^\/+/, ''), baseUrl(REDMINE_URL));
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetchWithRetry(url.toString(), {
    headers: {
      'X-Redmine-API-Key': REDMINE_API_KEY,
      Accept: 'application/json',
    },
  });

  return (await response.json()) as T;
}

async function fetchAll<T>(path: string, key: string, query: Record<string, string | number | undefined>): Promise<T[]> {
  const all: T[] = [];
  let offset = 0;

  while (true) {
    const payload = await fetchJson<ListResponse<T> & Record<string, unknown>>(path, {
      ...query,
      limit: PAGE_SIZE,
      offset,
    });

    const batch = Array.isArray(payload[key]) ? (payload[key] as T[]) : [];
    all.push(...batch);

    const totalCount = Number(payload.total_count);
    const hasCount = Number.isFinite(totalCount) && totalCount >= 0;
    const reachedByCount = hasCount && all.length >= totalCount;
    const reachedBySize = batch.length < PAGE_SIZE;

    if (batch.length === 0 || reachedByCount || reachedBySize) break;
    offset += PAGE_SIZE;
  }

  return all;
}

async function upsert(table: string, rows: Record<string, Json>[]): Promise<void> {
  const chunkSize = 100;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error } = await supabase.from(table).upsert(chunk, { onConflict: 'redmine_id' });
    if (error) throw new Error(`Failed to upsert ${table}: ${error.message}`);
  }
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const startedAt = new Date().toISOString();

  try {
    const projects = await fetchAll<RedmineProject>('projects.json', 'projects', {
      include: 'trackers,issue_categories,enabled_modules',
    });

    const projectRows = projects.map(project => ({
      redmine_id: project.id,
      identifier: project.identifier,
      name: project.name,
      description: project.description ?? null,
      parent_redmine_id: project.parent?.id ?? null,
      parent_name: project.parent?.name ?? null,
      status: project.status ?? null,
      is_public: project.is_public ?? null,
      trackers_json: (project.trackers ?? []) as Json,
      issue_categories_json: (project.issue_categories ?? []) as Json,
      enabled_modules_json: (project.enabled_modules ?? []) as Json,
      created_on: project.created_on ?? null,
      updated_on: project.updated_on ?? null,
      raw_json: project as unknown as Json,
      synced_at: new Date().toISOString(),
    }));

    if (projectRows.length > 0) {
      await upsert('redmine_projects', projectRows as unknown as Record<string, Json>[]);
    }

    let issuesFetched = 0;
    let issuesUpserted = 0;

    for (const project of projects) {
      const issues = await fetchAll<RedmineIssue>('issues.json', 'issues', {
        project_id: project.identifier || project.id,
        status_id: '*',
        include: 'attachments,relations,journals',
      });

      issuesFetched += issues.length;
      if (issues.length === 0) continue;

      const rows = issues.map(issue => {
        const attachments = issue.attachments ?? [];
        const customFields = issue.custom_fields ?? [];

        return {
          redmine_id: issue.id,
          project_redmine_id: project.id,
          project_identifier: project.identifier,
          project_name: project.name,
          tracker_name: issue.tracker?.name ?? '',
          status_name: issue.status?.name ?? '',
          priority_name: issue.priority?.name ?? '',
          subject: issue.subject ?? '',
          description: issue.description ?? null,
          author_name: issue.author?.name ?? '',
          assigned_to_name: issue.assigned_to?.name ?? '',
          created_on: issue.created_on ?? null,
          updated_on: issue.updated_on ?? null,
          closed_on: issue.closed_on ?? null,
          resolved_on: issue.closed_on ?? null,
          team: getCustomField(customFields, fieldMappings.team),
          technology: getCustomField(customFields, fieldMappings.technology),
          type: getCustomField(customFields, fieldMappings.type),
          satisfaction: getCustomField(customFields, fieldMappings.satisfaction),
          source: getCustomField(customFields, fieldMappings.source),
          fichiers: attachmentNames(attachments),
          has_attachment: attachments.length > 0,
          canal: getCustomField(customFields, fieldMappings.canal),
          segment_client: getCustomField(customFields, fieldMappings.segmentClient),
          region: getCustomField(customFields, fieldMappings.region),
          reopened: getCustomField(customFields, fieldMappings.reopened),
          sla_plan: getCustomField(customFields, fieldMappings.slaPlan),
          attachments_json: attachments as unknown as Json,
          custom_fields_json: customFields as unknown as Json,
          raw_json: issue as unknown as Json,
          synced_at: new Date().toISOString(),
        };
      });

      await upsert('redmine_issues', rows as unknown as Record<string, Json>[]);
      issuesUpserted += rows.length;
    }

    const endedAt = new Date().toISOString();

    await supabase.from('sync_state').upsert(
      {
        source: 'redmine',
        last_sync_at: endedAt,
        last_success_at: endedAt,
        last_offset: 0,
        last_error: null,
      },
      { onConflict: 'source' },
    );

    await supabase.from('sync_runs').insert({
      source: 'redmine',
      started_at: startedAt,
      ended_at: endedAt,
      status: 'success',
      metrics_json: {
        projectsFetched: projects.length,
        projectsUpserted: projectRows.length,
        issuesFetched,
        issuesUpserted,
      },
      error_text: null,
    });

    return new Response(JSON.stringify({
      ok: true,
      projectsFetched: projects.length,
      issuesFetched,
      issuesUpserted,
      startedAt,
      endedAt,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const endedAt = new Date().toISOString();
    const message = error instanceof Error ? error.message : 'Unknown error';

    await supabase.from('sync_state').upsert(
      { source: 'redmine', last_error: message },
      { onConflict: 'source' },
    );

    await supabase.from('sync_runs').insert({
      source: 'redmine',
      started_at: startedAt,
      ended_at: endedAt,
      status: 'failed',
      metrics_json: {},
      error_text: message,
    });

    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
