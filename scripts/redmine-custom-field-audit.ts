type Project = { id: number; identifier: string; name: string };
type Issue = {
  id: number;
  custom_fields?: Array<{ id?: number; name?: string; value?: unknown }>;
};

type ListPayload<T> = {
  total_count?: number;
  projects?: T[];
  issues?: T[];
};

type FieldStats = {
  id: number | null;
  name: string;
  normalizedName: string;
  presenceCount: number;
  nonEmptyCount: number;
  valueTypes: Set<string>;
  exampleTicketIds: number[];
};

const REDMINE_URL = required('REDMINE_URL').replace(/\/?$/, '/');
const REDMINE_API_KEY = required('REDMINE_API_KEY');
const PAGE_SIZE = positiveInt('REDMINE_AUDIT_PAGE_SIZE', 100);
const EXAMPLE_LIMIT = positiveInt('REDMINE_AUDIT_EXAMPLE_LIMIT', 5);

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

function positiveInt(name: string, fallback: number): number {
  const parsed = Number(process.env[name] || fallback);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function normalizeName(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function valueType(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  return Array.isArray(value) ? 'array' : typeof value;
}

function isNonEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.some(isNonEmpty);
  return String(value).trim() !== '';
}

async function fetchJson<T>(path: string, query: Record<string, string | number>): Promise<T> {
  const url = new URL(path, REDMINE_URL);
  Object.entries(query).forEach(([key, value]) => url.searchParams.set(key, String(value)));
  const response = await fetch(url, {
    headers: { 'X-Redmine-API-Key': REDMINE_API_KEY, Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json() as Promise<T>;
}

async function allProjects(): Promise<Project[]> {
  const projects: Project[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const payload = await fetchJson<ListPayload<Project>>('projects.json', { limit: PAGE_SIZE, offset });
    projects.push(...(payload.projects || []));
    if (projects.length >= (payload.total_count || projects.length)) return projects;
  }
}

async function projectIssues(project: Project): Promise<Issue[]> {
  const issues: Issue[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const payload = await fetchJson<ListPayload<Issue>>('issues.json', {
      project_id: project.identifier,
      status_id: '*',
      limit: PAGE_SIZE,
      offset,
    });
    issues.push(...(payload.issues || []));
    if (issues.length >= (payload.total_count || issues.length)) return issues;
  }
}

async function main(): Promise<void> {
  const projects = await allProjects();
  const fields = new Map<string, FieldStats>();
  const projectCoverage: Array<Record<string, unknown>> = [];

  for (const project of projects) {
    try {
      const issues = await projectIssues(project);
      for (const issue of issues) {
        for (const field of issue.custom_fields || []) {
          const key = `${field.id ?? 'none'}:${field.name ?? ''}`;
          const stats = fields.get(key) || {
            id: field.id ?? null,
            name: field.name ?? '',
            normalizedName: normalizeName(field.name ?? ''),
            presenceCount: 0,
            nonEmptyCount: 0,
            valueTypes: new Set<string>(),
            exampleTicketIds: [],
          };
          stats.presenceCount += 1;
          stats.valueTypes.add(valueType(field.value));
          if (isNonEmpty(field.value)) {
            stats.nonEmptyCount += 1;
            if (stats.exampleTicketIds.length < EXAMPLE_LIMIT) stats.exampleTicketIds.push(issue.id);
          }
          fields.set(key, stats);
        }
      }
      projectCoverage.push({
        projectId: project.id,
        identifier: project.identifier,
        name: project.name,
        accessible: true,
        issueCount: issues.length,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      projectCoverage.push({
        projectId: project.id,
        identifier: project.identifier,
        name: project.name,
        accessible: false,
        forbidden: message.startsWith('403 '),
        error: message,
      });
    }
  }

  const fieldAudit = [...fields.values()]
    .sort((a, b) => (a.id ?? Number.MAX_SAFE_INTEGER) - (b.id ?? Number.MAX_SAFE_INTEGER))
    .map(field => ({ ...field, valueTypes: [...field.valueTypes].sort() }));

  console.log(JSON.stringify({
    auditedAt: new Date().toISOString(),
    source: REDMINE_URL,
    projectSummary: {
      discovered: projects.length,
      accessible: projectCoverage.filter(item => item.accessible).length,
      forbidden: projectCoverage.filter(item => item.forbidden).length,
      otherFailures: projectCoverage.filter(item => !item.accessible && !item.forbidden).length,
    },
    fields: fieldAudit,
    projects: projectCoverage,
  }, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
