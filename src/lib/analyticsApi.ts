import { Filters } from '@/lib/dashboardFilters';
import { SimilarityResult } from '@/lib/similarity';

const configuredBase = import.meta.env.VITE_ANALYTICS_API_URL as string | undefined;
const API_BASE = configuredBase?.replace(/\/$/, '') || '/api/analytics';
const TOKEN = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export type ChartPoint = { name: string; value: number };
export type YearChartPoint = { name: string; year: number; value: number };
export type FilterOptions = Partial<Record<keyof Filters, string[]>>;

export type DashboardResponse = {
  kpis: {
    globalTickets: number;
    globalProjects: number;
    globalAvgResolvedDays: number | null;
    globalAvgClosedDays: number | null;
    totalTickets: number;
    projectsWithTickets: number;
    avgResolvedDays: number | null;
    avgClosedDays: number | null;
  };
  years: number[];
  charts: {
    priority: ChartPoint[];
    project: ChartPoint[];
    subject: ChartPoint[];
    team: ChartPoint[];
    source: ChartPoint[];
    status: ChartPoint[];
    type: ChartPoint[];
    satisfaction: ChartPoint[];
    author: ChartPoint[];
    assignee: ChartPoint[];
    attachments: ChartPoint[];
    monthly: Array<{ month: number; value: number }>;
    technologyByYear: YearChartPoint[];
    trackerByYear: YearChartPoint[];
    avgClosedByYear: Array<{ year: number; value: number | null }>;
    avgResolvedByYear: Array<{ year: number; value: number | null }>;
  };
};

export type TicketSummaryRow = {
  id: number;
  project: string;
  subject: string;
  type: string;
  tracker: string;
  source: string;
  team: string;
  author: string;
  assignee: string;
  status: string;
  priority: string;
  createdDate: string | null;
};

export type TicketSearchResponse = {
  items: TicketSummaryRow[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export type QualityResponse = {
  warehouseUpdatedAt: string;
  formatIssueCount: number;
  summary: Array<{
    field_name: string;
    ticketCount: number;
    mappedCount: number;
    sourceEmptyCount: number;
    sourceAbsentCount: number;
    mappingFailureCount: number;
    conflictCount: number;
    coveragePct: number;
  }>;
  examples: Array<{
    id: number;
    project: string;
    tracker: string;
    subject: string;
    fieldName: string;
    qualityStatus: string;
  }>;
  formatExamples: Array<{
    id: number;
    project: string;
    tracker: string;
    subject: string;
    fieldName: string;
    sourceValue: string;
    issueType: string;
  }>;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ detail: response.statusText }));
    throw new Error(payload.detail || `Analytics API error ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export function loadDashboard(filters: Filters): Promise<DashboardResponse> {
  return request('/v1/dashboard/query', { method: 'POST', body: JSON.stringify({ filters }) });
}

export function loadFilterOptions(): Promise<FilterOptions> {
  return request('/v1/filters');
}

export function searchTickets(filters: Filters, page: number, pageSize = 50, search = ''): Promise<TicketSearchResponse> {
  return request('/v1/tickets/search', {
    method: 'POST',
    body: JSON.stringify({ filters, page, pageSize, search }),
  });
}

export function loadSimilarity(ticketId: string, filters: Filters) {
  return request<{ reference: { id: string; subject: string }; results: SimilarityResult[] }>(
    `/v1/similarity/${encodeURIComponent(ticketId)}`,
    { method: 'POST', body: JSON.stringify({ filters, topN: 10 }) },
  );
}

export async function loadAiContext(filters: Filters): Promise<string> {
  const result = await request<{ summary: string }>('/v1/ai/context', {
    method: 'POST',
    body: JSON.stringify({ filters }),
  });
  return result.summary;
}

export function loadQuality(): Promise<QualityResponse> {
  return request('/v1/quality');
}
