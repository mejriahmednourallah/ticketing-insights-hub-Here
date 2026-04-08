import { supabase } from '@/integrations/supabase/client';
import { parseCSV, Ticket } from '@/lib/parseTickets';

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

async function loadFromSupabase(): Promise<Ticket[] | null> {
  const client = supabase as unknown as {
    from: (table: string) => {
      select: (columns: string) => Promise<{ data: TicketRow[] | null; error: { message: string } | null }>;
    };
  };

  const result = await client.from('redmine_ticket_view').select('*');
  if (result.error) {
    return null;
  }

  const rows = result.data ?? [];
  return rows.map(mapRow);
}

async function loadFromCsv(): Promise<Ticket[]> {
  const response = await fetch('/data/issues.csv');
  const buffer = await response.arrayBuffer();
  const text = new TextDecoder('iso-8859-1').decode(buffer);
  return parseCSV(text);
}

export async function loadTickets(): Promise<Ticket[]> {
  try {
    const fromSupabase = await loadFromSupabase();
    if (fromSupabase && fromSupabase.length > 0) {
      return fromSupabase;
    }
  } catch {
    // Fall back to the bundled CSV when Supabase is not ready yet.
  }

  return loadFromCsv();
}
