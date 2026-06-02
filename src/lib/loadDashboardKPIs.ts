/**
 * loadDashboardKPIs.ts
 *
 * Reads pre-computed aggregates from the `analytics` schema instead of
 * scanning the full `redmine_ticket_view` on every dashboard load.
 *
 * View refresh cadence: every 6 minutes via pg_cron (see migration
 * 20260526000300_schedule_mart_refresh.sql).
 *
 * The raw ticket list (for the drill-down table, similarity, AI chat) still
 * comes from loadTickets.ts → redmine_ticket_view. These two sources are
 * intentionally separate so KPI cards can be fast even when ticket volume is
 * large.
 */

import { supabase } from '@/integrations/supabase/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One row from analytics.v_dashboard — one row per project. */
export type ProjectKPI = {
  project_name: string;
  total_issues: number;
  open_issues: number;
  closed_issues: number;
  avg_age_hours: number | null;
  avg_resolution_hours: number | null;
  sla_compliance_pct: number | null;
  sla_breached_total: number;
  opened_last_30d: number;
  closed_last_30d: number;
};

/** One row from analytics.v_team_kpis. */
export type TeamKPI = {
  team: string;
  project_name: string;
  total_opened: number;
  total_resolved: number;
  avg_resolution_hours: number | null;
  latest_week: string | null;
  opened_this_week: number | null;
  resolved_this_week: number | null;
};

/** One row from analytics.v_backlog_health. */
export type BacklogBand = {
  project_name: string;
  team: string;
  age_band: string;
  band_order: number;
  ticket_count: number;
  avg_age_hours: number | null;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type AnySupabase = {
  from: (table: string) => {
    select: (columns: string) => Promise<{
      data: unknown[] | null;
      error: { message: string } | null;
    }>;
  };
};

async function queryView<T>(viewPath: string): Promise<T[]> {
  const client = supabase as unknown as AnySupabase;
  const result = await client.from(viewPath).select('*');
  if (result.error) {
    throw new Error(`[loadDashboardKPIs] ${viewPath}: ${result.error.message}`);
  }
  return (result.data ?? []) as T[];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch per-project KPI summary from analytics.v_dashboard.
 * Returns an empty array (not throws) when the view doesn't exist yet,
 * so callers can fall back gracefully during first-run / local dev.
 */
export async function loadProjectKPIs(): Promise<ProjectKPI[]> {
  try {
    return await queryView<ProjectKPI>('analytics.v_dashboard');
  } catch {
    return [];
  }
}

/**
 * Fetch per-team performance summary from analytics.v_team_kpis.
 */
export async function loadTeamKPIs(): Promise<TeamKPI[]> {
  try {
    return await queryView<TeamKPI>('analytics.v_team_kpis');
  } catch {
    return [];
  }
}

/**
 * Fetch open-ticket age-band distribution from analytics.v_backlog_health.
 */
export async function loadBacklogHealth(): Promise<BacklogBand[]> {
  try {
    return await queryView<BacklogBand>('analytics.v_backlog_health');
  } catch {
    return [];
  }
}

/**
 * Convenience: fetch all three KPI datasets in parallel.
 */
export async function loadAllKPIs(): Promise<{
  projects: ProjectKPI[];
  teams: TeamKPI[];
  backlog: BacklogBand[];
}> {
  const [projects, teams, backlog] = await Promise.all([
    loadProjectKPIs(),
    loadTeamKPIs(),
    loadBacklogHealth(),
  ]);
  return { projects, teams, backlog };
}
