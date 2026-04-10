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
const PAGE_SIZE = envPositiveInt('REDMINE_PAGE_SIZE', 500);
const PROJECT_BATCH_SIZE = envPositiveInt('REDMINE_PROJECT_BATCH_SIZE', 20);
const REDMINE_DEBUG = /^(1|true|yes|on)$/i.test(Deno.env.get('REDMINE_DEBUG') || '');
const REDMINE_MAX_RETRIES = envPositiveInt('REDMINE_MAX_RETRIES', 5);
const REDMINE_REQUEST_TIMEOUT_MS = envPositiveInt('REDMINE_REQUEST_TIMEOUT_MS', 20000);

const fieldMappings = {
  team: parseAliases('REDMINE_FIELD_TEAM', ['Equipe Affectée', 'Equipe Affectee', 'team']),
  technology: parseAliases('REDMINE_FIELD_TECHNOLOGY', ['CMS / Framework', 'technology', 'technology_used']),
  type: parseAliases('REDMINE_FIELD_TYPE', ['Nature', "Type d'intervention", 'Type', 'type']),
  satisfaction: parseAliases('REDMINE_FIELD_SATISFACTION', ['Degré de satisfaction', 'Degrè de satisfaction', 'csat_score', 'satisfaction']),
  source: parseAliases('REDMINE_FIELD_SOURCE', ['Source', 'source']),
  canal: parseAliases('REDMINE_FIELD_CANAL', ['Canal', 'channel', 'canal']),
  segmentClient: parseAliases('REDMINE_FIELD_SEGMENT_CLIENT', ['Segment client', 'customer_segment', 'segment_client']),
  region: parseAliases('REDMINE_FIELD_REGION', ['Région', 'region']),
  reopened: parseAliases('REDMINE_FIELD_REOPENED', ['Réouvert', 'reouvert', 'reopened']),
  slaPlan: parseAliases('REDMINE_FIELD_SLA_PLAN', ['SLA plan', 'sla_plan']),
};

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function debugLog(message: string, details?: Record<string, unknown>): void {
  if (!REDMINE_DEBUG) return;
  if (details) {
    console.log(`[redmine-ingest] ${message}`, details);
    return;
  }
  console.log(`[redmine-ingest] ${message}`);
}

function redactUrl(raw: string): string {
  try {
    const url = new URL(raw);
    for (const key of ['key', 'api_key', 'token', 'access_token']) {
      if (url.searchParams.has(key)) {
        url.searchParams.set(key, '***');
      }
    }
    return url.toString();
  } catch {
    return raw;
  }
}

function pickResponseHeaders(response: Response): Record<string, string> {
  const names = [
    'content-type',
    'server',
    'retry-after',
    'x-request-id',
    'x-runtime',
    'x-powered-by',
    'cf-ray',
    'via',
  ];

  const picked: Record<string, string> = {};
  for (const name of names) {
    const value = response.headers.get(name);
    if (value) picked[name] = value;
  }
  return picked;
}

function compactSnippet(value: string, maxLength = 500): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function isForbiddenRedmineError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /Redmine request failed \(403\)/.test(error.message);
}

function required(name: string): string {
  const value = Deno.env.get(name);
  if (!value || value.trim() === '') {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value.trim();
}

function envPositiveInt(name: string, fallback: number): number {
  const raw = Deno.env.get(name);
  if (!raw || raw.trim() === '') return fallback;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
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
  const sanitizedUrl = redactUrl(url);
  const startedAt = Date.now();
  debugLog('redmine fetch start', { attempt: attempt + 1, url: sanitizedUrl });

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), REDMINE_REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timeoutHandle);
    const durationMs = Date.now() - startedAt;
    const isTimeout = !!(error && typeof error === 'object' && 'name' in error && (error as { name?: string }).name === 'AbortError');
    const retryable = true;

    console.error('[redmine-ingest] redmine fetch transport failed', {
      attempt: attempt + 1,
      durationMs,
      isTimeout,
      timeoutMs: REDMINE_REQUEST_TIMEOUT_MS,
      url: sanitizedUrl,
      error: error instanceof Error ? error.message : String(error),
      retryable,
    });

    if (attempt >= REDMINE_MAX_RETRIES) {
      throw new Error(`Redmine transport error after retries (${isTimeout ? 'timeout' : 'network'}): ${error instanceof Error ? error.message : String(error)}`);
    }

    const waitMs = 1000 * 2 ** attempt;
    debugLog('redmine fetch retry scheduled', {
      attempt: attempt + 1,
      nextAttempt: attempt + 2,
      waitMs,
      reason: isTimeout ? 'timeout' : 'network',
      url: sanitizedUrl,
    });

    await new Promise(resolve => setTimeout(resolve, waitMs));
    return fetchWithRetry(url, init, attempt + 1);
  } finally {
    clearTimeout(timeoutHandle);
  }

  const durationMs = Date.now() - startedAt;
  if (response.ok) {
    debugLog('redmine fetch ok', {
      attempt: attempt + 1,
      status: response.status,
      durationMs,
      url: sanitizedUrl,
    });
    return response;
  }

  const text = await response.text().catch(() => '');
  const retryable = response.status === 408 || response.status === 425 || response.status === 429 || response.status >= 500;
  const bodySnippet = compactSnippet(text);

  console.error('[redmine-ingest] redmine fetch failed', {
    attempt: attempt + 1,
    status: response.status,
    statusText: response.statusText,
    durationMs,
    url: sanitizedUrl,
    retryable,
    headers: pickResponseHeaders(response),
    bodySnippet,
  });

  if (!retryable || attempt >= REDMINE_MAX_RETRIES) {
    throw new Error(`Redmine request failed (${response.status}): ${bodySnippet || response.statusText}`);
  }

  const retryAfter = Number(response.headers.get('Retry-After') || '0');
  const waitMs = retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt;
  debugLog('redmine fetch retry scheduled', {
    attempt: attempt + 1,
    nextAttempt: attempt + 2,
    waitMs,
    status: response.status,
    url: sanitizedUrl,
  });
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

    const payloadLimit = Number(payload.limit);
    const effectiveLimit = Number.isFinite(payloadLimit) && payloadLimit > 0
      ? payloadLimit
      : PAGE_SIZE;
    const totalCount = Number(payload.total_count);
    const hasCount = Number.isFinite(totalCount) && totalCount >= 0;
    const reachedByCount = hasCount && all.length >= totalCount;
    const reachedBySize = batch.length < effectiveLimit;

    if (batch.length === 0 || reachedByCount || reachedBySize) break;
    offset += effectiveLimit;
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

async function readSavedOffset(): Promise<number> {
  const { data, error } = await supabase
    .from('sync_state')
    .select('last_offset')
    .eq('source', 'redmine')
    .limit(1);

  if (error) {
    throw new Error(`Failed to read sync_state: ${error.message}`);
  }

  const row = Array.isArray(data) && data.length > 0
    ? (data[0] as { last_offset?: number })
    : null;

  const offset = Number(row?.last_offset ?? 0);
  if (!Number.isFinite(offset) || offset < 0) return 0;
  return Math.floor(offset);
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

  let payload: Record<string, unknown> = {};
  try {
    payload = (await req.json()) as Record<string, unknown>;
  } catch {
    payload = {};
  }

  const mode = typeof payload.mode === 'string' ? payload.mode : 'batch';
  const resetCursor = payload.resetCursor === true || mode === 'reset';

  const startedAt = new Date().toISOString();
  debugLog('ingest run started', {
    startedAt,
    redmineBase: redactUrl(baseUrl(REDMINE_URL)),
    pageSize: PAGE_SIZE,
    projectBatchSize: PROJECT_BATCH_SIZE,
    mode,
    resetCursor,
    debug: REDMINE_DEBUG,
  });

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

    const savedOffset = resetCursor ? 0 : await readSavedOffset();
    const startIndex = projects.length === 0
      ? 0
      : savedOffset >= projects.length
        ? 0
        : savedOffset;
    const endExclusive = Math.min(startIndex + PROJECT_BATCH_SIZE, projects.length);
    const projectsBatch = projects.slice(startIndex, endExclusive);
    const cycleCompleted = projects.length === 0 || endExclusive >= projects.length;
    const nextOffset = cycleCompleted ? 0 : endExclusive;

    let issuesFetched = 0;
    let issuesUpserted = 0;
    let forbiddenProjects = 0;

    for (const project of projectsBatch) {
      debugLog('fetching issues for project', {
        projectId: project.id,
        projectIdentifier: project.identifier,
        projectName: project.name,
      });

      let issues: RedmineIssue[] = [];
      try {
        issues = await fetchAll<RedmineIssue>('issues.json', 'issues', {
          project_id: project.identifier || project.id,
          status_id: '*',
          include: 'attachments',
        });
      } catch (error) {
        if (isForbiddenRedmineError(error)) {
          forbiddenProjects += 1;
          console.warn('[redmine-ingest] skipping forbidden project issues fetch', {
            projectId: project.id,
            projectIdentifier: project.identifier,
            projectName: project.name,
            reason: error instanceof Error ? error.message : 'forbidden',
          });
          continue;
        }
        throw error;
      }

      debugLog('issues fetched for project', {
        projectId: project.id,
        projectIdentifier: project.identifier,
        issuesCount: issues.length,
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

    const syncStatePayload = {
      source: 'redmine',
      last_sync_at: endedAt,
      last_offset: nextOffset,
      last_error: null,
      ...(cycleCompleted ? { last_success_at: endedAt } : {}),
    };

    await supabase
      .from('sync_state')
      .upsert(syncStatePayload, { onConflict: 'source' });

    await supabase.from('sync_runs').insert({
      source: 'redmine',
      started_at: startedAt,
      ended_at: endedAt,
      status: cycleCompleted ? 'success' : 'partial',
      metrics_json: {
        projectsTotal: projects.length,
        batchStart: startIndex,
        batchEndExclusive: endExclusive,
        projectsProcessed: projectsBatch.length,
        nextOffset,
        cycleCompleted,
        cursorReset: resetCursor,
        projectsUpserted: projectRows.length,
        issuesFetched,
        issuesUpserted,
        forbiddenProjects,
      },
      error_text: null,
    });

    debugLog('ingest run completed', {
      startedAt,
      endedAt,
      projectsTotal: projects.length,
      batchStart: startIndex,
      batchEndExclusive: endExclusive,
      projectsProcessed: projectsBatch.length,
      nextOffset,
      cycleCompleted,
      issuesFetched,
      issuesUpserted,
      forbiddenProjects,
    });

    return new Response(JSON.stringify({
      ok: true,
      projectsTotal: projects.length,
      batchStart: startIndex,
      batchEndExclusive: endExclusive,
      projectsProcessed: projectsBatch.length,
      nextOffset,
      cycleCompleted,
      issuesFetched,
      issuesUpserted,
      forbiddenProjects,
      startedAt,
      endedAt,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const endedAt = new Date().toISOString();
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[redmine-ingest] ingest run failed', {
      startedAt,
      endedAt,
      message,
      stack: error instanceof Error ? error.stack : undefined,
    });

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
