type RedmineProject = {
  id: number;
  identifier: string;
  name: string;
};

type RedmineIssue = {
  id: number;
  project?: { id?: number; name?: string };
  custom_fields?: Array<{ id?: number; name?: string; value?: unknown }>;
  tracker?: { name?: string };
  status?: { name?: string };
  priority?: { name?: string };
  subject?: string;
  created_on?: string;
  updated_on?: string;
};

type RedmineList<T> = {
  total_count?: number;
  offset?: number;
  limit?: number;
  [key: string]: unknown;
};

const REDMINE_URL = required('REDMINE_URL');
const REDMINE_API_KEY = required('REDMINE_API_KEY');
const PROJECT_LIMIT = Number(process.env.REDMINE_PROBE_PROJECT_LIMIT || '10');
const ISSUE_LIMIT_PER_PROJECT = Number(process.env.REDMINE_PROBE_ISSUE_LIMIT || '30');

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value.trim();
}

function baseUrl(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}

async function fetchRedmine<T>(path: string, query: Record<string, string | number>): Promise<T> {
  const url = new URL(path.replace(/^\/+/, ''), baseUrl(REDMINE_URL));
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, String(value));
  }

  const res = await fetch(url, {
    headers: {
      'X-Redmine-API-Key': REDMINE_API_KEY,
      Accept: 'application/json',
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Redmine request failed ${res.status}: ${text || res.statusText}`);
  }

  return (await res.json()) as T;
}

function normalizeName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

async function main(): Promise<void> {
  const projectsPayload = await fetchRedmine<RedmineList<RedmineProject> & { projects: RedmineProject[] }>('projects.json', {
    limit: PROJECT_LIMIT,
    include: 'trackers,issue_categories,enabled_modules',
  });

  const projects = projectsPayload.projects || [];

  const report: Array<{
    projectId: number;
    identifier: string;
    name: string;
    issuesSampled: number;
    customFieldNames: string[];
    customFieldNormalized: string[];
    statusNames: string[];
    trackerNames: string[];
    priorityNames: string[];
  }> = [];

  const globalCustomFields = new Map<string, number>();

  for (const project of projects) {
    const issuesPayload = await fetchRedmine<RedmineList<RedmineIssue> & { issues: RedmineIssue[] }>('issues.json', {
      project_id: project.identifier,
      status_id: '*',
      include: 'attachments,relations,journals',
      limit: ISSUE_LIMIT_PER_PROJECT,
      offset: 0,
    });

    const issues = issuesPayload.issues || [];
    const customFieldSet = new Set<string>();
    const statusSet = new Set<string>();
    const trackerSet = new Set<string>();
    const prioritySet = new Set<string>();

    for (const issue of issues) {
      if (issue.status?.name) statusSet.add(issue.status.name);
      if (issue.tracker?.name) trackerSet.add(issue.tracker.name);
      if (issue.priority?.name) prioritySet.add(issue.priority.name);

      for (const cf of issue.custom_fields || []) {
        if (!cf.name) continue;
        customFieldSet.add(cf.name);
        globalCustomFields.set(cf.name, (globalCustomFields.get(cf.name) || 0) + 1);
      }
    }

    const customFieldNames = Array.from(customFieldSet).sort((a, b) => a.localeCompare(b));
    report.push({
      projectId: project.id,
      identifier: project.identifier,
      name: project.name,
      issuesSampled: issues.length,
      customFieldNames,
      customFieldNormalized: customFieldNames.map(normalizeName),
      statusNames: Array.from(statusSet).sort((a, b) => a.localeCompare(b)),
      trackerNames: Array.from(trackerSet).sort((a, b) => a.localeCompare(b)),
      priorityNames: Array.from(prioritySet).sort((a, b) => a.localeCompare(b)),
    });
  }

  const globalFields = Array.from(globalCustomFields.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, normalized: normalizeName(name), count }));

  const output = {
    source: REDMINE_URL,
    sampledProjects: projects.length,
    projectLimit: PROJECT_LIMIT,
    issueLimitPerProject: ISSUE_LIMIT_PER_PROJECT,
    report,
    globalFields,
  };

  console.log(JSON.stringify(output, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
