import { supabase } from '@/integrations/supabase/client';
import { parseCSV, Ticket } from '@/lib/parseTickets';

export type LoadTicketsOptions = {
  supabaseOnly?: boolean;
  cacheBuster?: string | number;
};

type TicketRow = {
  id: string | number;
  project: string;
  tracker: string;
  status: string;
  priority: string;
  subject: string;
  author: string;
  assignee: string;
  created_date?: string | null;
  closed_date?: string | null;
  resolved_date?: string | null;
  team?: string | null;
  technology?: string | null;
  type?: string | null;
  satisfaction?: string | null;
  source?: string | null;
  fichiers?: string | null;
  has_attachment?: boolean | null;
  canal?: string | null;
  segment_client?: string | null;
  region?: string | null;
  reopened?: string | null;
  sla_plan?: string | null;
  year?: number | null;
  month?: number | null;
};

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function mapRow(row: TicketRow): Ticket {
  const createdDate = toDate(row.created_date);
  const closedDate = toDate(row.closed_date);
  const resolvedDate = toDate(row.resolved_date);

  return {
    id: String(row.id),
    project: row.project || '',
    tracker: row.tracker || '',
    status: row.status || '',
    priority: row.priority || '',
    subject: row.subject || '',
    author: row.author || '',
    assignee: row.assignee || '',
    createdDate,
    closedDate,
    resolvedDate,
    team: row.team || '',
    technology: row.technology || '',
    type: row.type || '',
    satisfaction: row.satisfaction || '',
    source: row.source || '',
    fichiers: row.fichiers || '',
    hasAttachment: row.has_attachment ?? Boolean(row.fichiers),
    canal: row.canal || '',
    segmentClient: row.segment_client || '',
    region: row.region || '',
    reopened: row.reopened || '',
    slaPlan: row.sla_plan || '',
    year: row.year ?? (createdDate ? createdDate.getFullYear() : null),
    month: row.month ?? (createdDate ? createdDate.getMonth() + 1 : null),
  };
}

async function loadFromSupabase(): Promise<Ticket[]> {
  const client = supabase as unknown as {
    from: (table: string) => {
      select: (columns: string) => {
        range: (from: number, to: number) => Promise<{ data: TicketRow[] | null; error: { message: string } | null }>;
      };
    };
  };

  const pageSize = 1000;
  const allRows: TicketRow[] = [];

  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const result = await client.from('redmine_ticket_view').select('*').range(from, to);
    if (result.error) {
      throw new Error(result.error.message);
    }

    const batch = result.data ?? [];
    allRows.push(...batch);

    if (batch.length < pageSize) {
      break;
    }
  }

  return allRows.map(mapRow);
}

export async function loadProjectsCountFromSupabase(): Promise<number> {
  const client = supabase as unknown as {
    from: (table: string) => {
      select: (
        columns: string,
        options?: { count?: 'exact'; head?: boolean }
      ) => Promise<{ count: number | null; error: { message: string } | null }>;
    };
  };

  const result = await client
    .from('redmine_projects')
    .select('redmine_id', { count: 'exact', head: true });

  if (result.error) {
    throw new Error(result.error.message);
  }

  return result.count ?? 0;
}

async function loadFromCsv(cacheBuster?: string | number): Promise<Ticket[]> {
  const suffix = cacheBuster ? `?v=${encodeURIComponent(String(cacheBuster))}` : '';
  const response = await fetch(`/data/issues.csv${suffix}`, { cache: 'no-store' });
  const buffer = await response.arrayBuffer();
  const text = new TextDecoder('iso-8859-1').decode(buffer);
  return parseCSV(text);
}

export async function loadTickets(options: LoadTicketsOptions = {}): Promise<Ticket[]> {
  try {
    const fromSupabase = await loadFromSupabase();
    if (fromSupabase.length > 0 || options.supabaseOnly) {
      return fromSupabase;
    }
  } catch (error) {
    if (options.supabaseOnly) {
      throw error;
    }

    // Fall back to the bundled CSV when Supabase is not ready yet.
  }

  if (options.supabaseOnly) {
    return [];
  }

  return loadFromCsv(options.cacheBuster);
}
