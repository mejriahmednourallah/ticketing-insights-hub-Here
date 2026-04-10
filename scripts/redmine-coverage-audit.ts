type RedmineProject = {
  id: number;
  identifier?: string;
  name?: string;
};

type ProjectsPayload = {
  projects?: RedmineProject[];
  total_count?: number;
  limit?: number;
};

type CoverageRow = {
  id: number;
  identifier: string;
  name: string;
  status: number | 'NETWORK_ERROR';
  total_count: number | null;
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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function getEnv(name: string, fallback: Record<string, string>): string {
  const value = process.env[name] || fallback[name] || '';
  if (!value.trim()) throw new Error(`Missing environment variable: ${name}`);
  return value.trim();
}

async function fetchJson(url: string, apiKey: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: {
      'X-Redmine-API-Key': apiKey,
      Accept: 'application/json',
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP_${res.status} ${body}`);
  }

  return await res.json();
}

async function main(): Promise<void> {
  const dotEnv = parseDotEnv(await Bun.file('.env').text());
  const redmineBase = getEnv('REDMINE_URL', dotEnv).replace(/\/+$/, '');
  const redmineApiKey = getEnv('REDMINE_API_KEY', dotEnv);

  const pageSize = Number(process.env.REDMINE_AUDIT_PAGE_SIZE || dotEnv.REDMINE_PAGE_SIZE || '500');
  const safePageSize = Number.isFinite(pageSize) && pageSize > 0 ? Math.floor(pageSize) : 500;

  const projects: RedmineProject[] = [];
  let offset = 0;

  while (true) {
    const url = new URL(`${redmineBase}/projects.json`);
    url.searchParams.set('limit', String(safePageSize));
    url.searchParams.set('offset', String(offset));

    const payload = (await fetchJson(url.toString(), redmineApiKey)) as ProjectsPayload;
    const batch = Array.isArray(payload.projects) ? payload.projects : [];
    projects.push(...batch);

    const payloadLimit = Number(payload.limit);
    const effectiveLimit = Number.isFinite(payloadLimit) && payloadLimit > 0 ? payloadLimit : safePageSize;
    const totalCount = Number(payload.total_count);
    const reachedByCount = Number.isFinite(totalCount) && projects.length >= totalCount;
    const reachedByBatch = batch.length < effectiveLimit;

    if (batch.length === 0 || reachedByCount || reachedByBatch) break;
    offset += effectiveLimit;
  }

  const rows: CoverageRow[] = [];

  for (const p of projects) {
    const identifier = p.identifier || String(p.id);
    const name = p.name || '';
    const url = new URL(`${redmineBase}/issues.json`);
    url.searchParams.set('project_id', identifier);
    url.searchParams.set('status_id', '*');
    url.searchParams.set('limit', '1');
    url.searchParams.set('offset', '0');

    try {
      const res = await fetch(url.toString(), {
        headers: {
          'X-Redmine-API-Key': redmineApiKey,
          Accept: 'application/json',
        },
      });

      if (!res.ok) {
        rows.push({
          id: p.id,
          identifier,
          name,
          status: res.status,
          total_count: null,
        });
        continue;
      }

      const payload = (await res.json()) as { total_count?: number };
      const totalCount = Number(payload.total_count);
      rows.push({
        id: p.id,
        identifier,
        name,
        status: 200,
        total_count: Number.isFinite(totalCount) ? totalCount : 0,
      });
    } catch {
      rows.push({
        id: p.id,
        identifier,
        name,
        status: 'NETWORK_ERROR',
        total_count: null,
      });
    }
  }

  const okRows = rows.filter(r => r.status === 200);
  const withIssues = okRows.filter(r => (r.total_count || 0) > 0);
  const withoutIssues = okRows.filter(r => (r.total_count || 0) === 0);
  const forbidden = rows.filter(r => r.status === 403);
  const otherErrors = rows.filter(r => r.status !== 200 && r.status !== 403);

  const summaryLines = [
    `TOTAL_PROJECTS=${rows.length}`,
    `OK_200=${okRows.length}`,
    `WITH_ISSUES=${withIssues.length}`,
    `WITHOUT_ISSUES=${withoutIssues.length}`,
    `FORBIDDEN_403=${forbidden.length}`,
    `OTHER_ERRORS=${otherErrors.length}`,
    '---FORBIDDEN_PROJECTS---',
    ...forbidden
      .sort((a, b) => a.id - b.id)
      .map(r => `ID=${r.id} IDENTIFIER=${r.identifier} NAME=${r.name} STATUS=${r.status}`),
    '---SAMPLE_NO_ISSUES_PROJECTS---',
    ...withoutIssues
      .sort((a, b) => a.id - b.id)
      .slice(0, 30)
      .map(r => `ID=${r.id} IDENTIFIER=${r.identifier} NAME=${r.name}`),
  ];

  await Bun.write('tmp/redmine_coverage_audit.json', JSON.stringify(rows, null, 2));
  await Bun.write('tmp/redmine_coverage_summary.txt', summaryLines.join('\n'));

  console.log(summaryLines.join('\n'));
  console.log('WROTE=tmp/redmine_coverage_audit.json');
  console.log('WROTE=tmp/redmine_coverage_summary.txt');
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
