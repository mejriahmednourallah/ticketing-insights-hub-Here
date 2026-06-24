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
    monthlyTrend: Array<{ period: string; value: number }>;
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

export type LoginResponse = {
  ok: boolean;
  source: 'redmine' | 'demo';
  user: {
    login: string;
    name: string;
  };
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

export type PredictionScopeType = 'global' | 'project' | 'team';
export type ForecastModelName =
  | 'seasonal_naive'
  | 'damped_holt'
  | 'holt_winters'
  | 'recent_median'
  | 'seasonal_median'
  | 'seasonal_naive_drift'
  | 'theta'
  | 'robust_ensemble_top3';

export type PredictionOption = {
  value: string;
  historyMonths: number;
  resolvedTickets?: number;
  tickets?: number;
  recentMonths?: number;
  recentResolvedTickets?: number;
  recentTickets?: number;
  type: 'project' | 'team';
};

export type PredictionOptionsResponse = {
  projects: PredictionOption[];
  teams: PredictionOption[];
  minimumHistoryMonths: number;
  minimumResolvedTickets?: number;
  minimumTickets?: number;
  minimumRecentMonths?: number;
  minimumRecentTickets?: number;
  horizonMonths: number;
};

export type ForecastExplanation = {
  headline: string;
  paragraphs: string[];
  evidence: Array<{ label: string; value: string; meaning: string }>;
  contributors: Array<{
    dimension: 'project' | 'team' | 'type';
    name: string;
    metric: string;
    recentValue: number;
    previousValue: number;
    changePct: number | null;
    interpretation: string;
  }>;
  confidenceNote: string;
};

export type ResolutionDelayPredictionResponse = {
  scope: { type: PredictionScopeType; value: string | null };
  historical: Array<{ period: string; medianDays: number; resolvedTickets: number }>;
  currentMonth: { period: string; medianDays: number; resolvedTickets: number } | null;
  forecast: Array<{
    period: string;
    predictedMedianDays: number;
    lowerBoundDays: number;
    upperBoundDays: number;
  }>;
  summary: {
    nextMonthMedianDays: number;
    sixMonthAverageDays: number;
    recentThreeMonthMedianDays: number;
    changePct: number;
    trend: 'improving' | 'stable' | 'deteriorating';
    businessInsight: string;
    reliability: 'Élevée' | 'Modérée' | 'Prudente';
  };
  model: {
    name: ForecastModelName;
    backtestMaeDays: number;
    weightedMase?: number;
    weightedMae?: number;
    baselineWeightedMase?: number | null;
    promoted?: boolean;
    selectionReason?: string;
    trainingStart: string;
    trainingEnd: string;
    historyMonths: number;
    resolvedTickets: number;
  };
  explanation?: ForecastExplanation;
};

export type TicketVolumePredictionResponse = {
  scope: { type: PredictionScopeType; value: string | null };
  historical: Array<{ period: string; ticketCount: number }>;
  currentMonth: { period: string; ticketCount: number } | null;
  forecast: Array<{
    period: string;
    predictedTickets: number;
    lowerBoundTickets: number;
    upperBoundTickets: number;
  }>;
  summary: {
    nextMonthTickets: number;
    sixMonthAverageTickets: number;
    recentThreeMonthAverageTickets: number;
    changePct: number;
    trend: 'decreasing' | 'stable' | 'increasing';
    businessInsight: string;
    reliability: 'Élevée' | 'Modérée' | 'Prudente';
  };
  model: {
    name: ForecastModelName;
    backtestMaeTickets: number;
    weightedMase?: number;
    weightedMae?: number;
    baselineWeightedMase?: number | null;
    promoted?: boolean;
    selectionReason?: string;
    trainingStart: string;
    trainingEnd: string;
    historyMonths: number;
    tickets: number;
  };
  explanation?: ForecastExplanation;
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

export function loginWithRedmine(username: string, password: string): Promise<LoginResponse> {
  return request('/v1/auth/redmine', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
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

export function loadPredictionOptions(): Promise<PredictionOptionsResponse> {
  return request('/v1/predictions/resolution-delay/options');
}

export function loadTicketVolumePredictionOptions(): Promise<PredictionOptionsResponse> {
  return request('/v1/predictions/ticket-volume/options');
}

export function loadResolutionDelayPrediction(
  scope: { type: PredictionScopeType; value?: string },
): Promise<ResolutionDelayPredictionResponse> {
  return request('/v1/predictions/resolution-delay', {
    method: 'POST',
    body: JSON.stringify({
      scope: { type: scope.type, value: scope.value || null },
      horizonMonths: 6,
    }),
  });
}

export function loadTicketVolumePrediction(
  scope: { type: PredictionScopeType; value?: string },
): Promise<TicketVolumePredictionResponse> {
  return request('/v1/predictions/ticket-volume', {
    method: 'POST',
    body: JSON.stringify({
      scope: { type: scope.type, value: scope.value || null },
      horizonMonths: 6,
    }),
  });
}
