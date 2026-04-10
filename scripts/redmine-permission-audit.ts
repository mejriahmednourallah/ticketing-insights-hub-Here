type RedmineProject = {
  id: number;
  identifier?: string;
  name?: string;
};

type RedmineProjectsResponse = {
  projects?: RedmineProject[];
  total_count?: number;
  offset?: number;
  limit?: number;
};

function parseDotEnv(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function getEnv(name: string, fallback?: Record<string, string>): string {
  const value = process.env[name] || fallback?.[name] || '';
  if (!value.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

function getPageSize(): number {
  const raw = process.env.REDMINE_AUDIT_PAGE_SIZE || '500';
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return 100;
  return Math.floor(parsed);
}

async function fetchJson<T>(url: string, apiKey: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      'X-Redmine-API-Key': apiKey,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`GET ${url} failed (${response.status}): ${body || response.statusText}`);
  }

  return (await response.json()) as T;
}

async function fetchAllProjects(baseUrl: string, apiKey: string, pageSize: number): Promise<RedmineProject[]> {
  const all: RedmineProject[] = [];
  let offset = 0;
  let totalCount: number | null = null;

  while (true) {
    const url = new URL('projects.json', baseUrl);
    url.searchParams.set('limit', String(pageSize));
    url.searchParams.set('offset', String(offset));
    const payload = await fetchJson<RedmineProjectsResponse>(url.toString(), apiKey);
    const batch = Array.isArray(payload.projects) ? payload.projects : [];
    all.push(...batch);

    const payloadLimit = Number(payload.limit);
    const effectiveLimit = Number.isFinite(payloadLimit) && payloadLimit > 0
      ? payloadLimit
      : pageSize;

    if (Number.isFinite(payload.total_count)) {
      totalCount = Number(payload.total_count);
    }

    const reachedByCount = totalCount !== null && all.length >= totalCount;
    const reachedByBatch = batch.length < effectiveLimit;

    if (batch.length === 0 || reachedByCount || reachedByBatch) {
      break;
    }

    offset += effectiveLimit;
  }

  return all;
}

async function checkProjectIssueAccess(baseUrl: string, apiKey: string, project: RedmineProject): Promise<number> {
  const projectSelector = project.identifier || String(project.id);
  const url = new URL('issues.json', baseUrl);
  url.searchParams.set('project_id', projectSelector);
  url.searchParams.set('status_id', '*');
  url.searchParams.set('limit', '1');

  const response = await fetch(url.toString(), {
    headers: {
      'X-Redmine-API-Key': apiKey,
      Accept: 'application/json',
    },
  });

  return response.status;
}

async function main(): Promise<void> {
  const dotEnv = await Bun.file('.env').text().then(parseDotEnv).catch(() => ({} as Record<string, string>));
  const redmineUrlRaw = getEnv('REDMINE_URL', dotEnv);
  const redmineApiKey = getEnv('REDMINE_API_KEY', dotEnv);
  const pageSize = getPageSize();

  const redmineUrl = redmineUrlRaw.endsWith('/') ? redmineUrlRaw : `${redmineUrlRaw}/`;
  const projects = await fetchAllProjects(redmineUrl, redmineApiKey, pageSize);

  const statusCounts = new Map<number, number>();
  const forbidden: Array<{ id: number; identifier: string; name: string; status: number }> = [];
  const non200: Array<{ id: number; identifier: string; name: string; status: number }> = [];

  for (const project of projects) {
    const status = await checkProjectIssueAccess(redmineUrl, redmineApiKey, project);
    statusCounts.set(status, (statusCounts.get(status) || 0) + 1);

    const row = {
      id: project.id,
      identifier: project.identifier || '',
      name: project.name || '',
      status,
    };

    if (status === 403) forbidden.push(row);
    if (status !== 200) non200.push(row);
  }

  const sortedStatuses = [...statusCounts.entries()].sort((a, b) => a[0] - b[0]);

  console.log(`PAGE_SIZE=${pageSize}`);
  console.log(`TOTAL_PROJECTS_FETCHED=${projects.length}`);
  console.log('STATUS_COUNTS_START');
  for (const [status, count] of sortedStatuses) {
    console.log(`HTTP_${status}=${count}`);
  }
  console.log('STATUS_COUNTS_END');

  console.log('FORBIDDEN_403_START');
  for (const item of forbidden.sort((a, b) => a.id - b.id)) {
    console.log(`ID=${item.id} IDENTIFIER=${item.identifier} NAME=${item.name} STATUS=${item.status}`);
  }
  console.log('FORBIDDEN_403_END');

  console.log('NON_200_START');
  for (const item of non200.sort((a, b) => a.id - b.id)) {
    console.log(`ID=${item.id} IDENTIFIER=${item.identifier} NAME=${item.name} STATUS=${item.status}`);
  }
  console.log('NON_200_END');
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
