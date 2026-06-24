export interface Ticket {
  id: string;
  project: string;
  tracker: string;
  status: string;
  priority: string;
  subject: string;
  description?: string;
  author: string;
  assignee: string;
  createdDate: Date | null;
  closedDate: Date | null;
  resolvedDate: Date | null;
  team: string;
  technology: string;
  type: string;
  satisfaction: string;
  source: string;
  fichiers: string;
  hasAttachment: boolean;
  canal: string;
  segmentClient: string;
  region: string;
  reopened: string;
  slaPlan: string;
  year: number | null;
  month: number | null;
}

function parseDate(str: string): Date | null {
  if (!str || str.trim() === '') return null;
  const parts = str.trim().split(' ')[0].split('/');
  if (parts.length !== 3) return null;
  const [day, month, year] = parts.map(Number);
  if (isNaN(day) || isNaN(month) || isNaN(year)) return null;
  return new Date(year, month - 1, day);
}

function diffHours(start: Date | null, end: Date | null): number | null {
  if (!start || !end) return null;
  return (end.getTime() - start.getTime()) / (1000 * 60 * 60);
}

function normalizeHeader(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function parseBooleanLike(value: string): boolean | null {
  const normalized = normalizeHeader(value).replace(/_/g, '');
  if (!normalized) return null;
  if (['oui', 'yes', 'true', '1', 'vrai'].includes(normalized)) return true;
  if (['non', 'no', 'false', '0', 'faux'].includes(normalized)) return false;
  return null;
}

export function parseCSV(text: string): Ticket[] {
  const lines = text.split('\n');
  if (lines.length < 2) return [];

  const parseRow = (line: string): string[] => {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (ch === ';' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    result.push(current.trim());
    return result;
  };

  const headers = parseRow(lines[0]);
  const headerMap = new Map(headers.map((header, index) => [normalizeHeader(header), index]));
  const colIndex = (...aliases: string[]) => {
    for (const alias of aliases) {
      const index = headerMap.get(normalizeHeader(alias));
      if (index !== undefined) return index;
    }
    return -1;
  };
  const valueAt = (cols: string[], index: number) => (index >= 0 ? cols[index] || '' : '');

  const iId = colIndex('#', 'id');
  const iProjet = colIndex('project_name', 'Projet', 'project');
  const iTracker = colIndex('tracker');
  const iStatut = colIndex('status', 'Statut');
  const iPrio = colIndex('priority', 'Priorité', 'Priorite');
  const iSujet = colIndex('sujet', 'subject');
  const iDescription = colIndex('description', 'desc');
  const iAuteur = colIndex('auteur', 'author');
  const iAssigne = colIndex('assigne_a', 'Assigné à', 'Assigne a', 'assignee');
  const iCree = colIndex('created_date', 'Créé', 'Cree', 'created_at');
  const iFerme = colIndex('closed_date', 'Fermé', 'Ferme', 'closed_at');
  const iEquipe = colIndex('equipe_affectee', 'Equipe Affectée', 'Equipe Affectee', 'team');
  const iResolved = colIndex('resolved_date', 'Date Resolved');
  const iTech = colIndex('technology_used', 'CMS / Framework', 'technology');
  const iType = colIndex('type');
  const iSatisf = colIndex('csat_score', 'Degrè de satisfaction', 'Degré de satisfaction', 'satisfaction');
  const iSource = colIndex('source');
  const iFichiers = colIndex('has_attachment', 'Fichiers');
  const iCanal = colIndex('channel', 'canal');
  const iSegmentClient = colIndex('customer_segment', 'segment_client', 'segment client');
  const iRegion = colIndex('region', 'région');
  const iReopened = colIndex('reopened', 'réouvert', 'reouvert');
  const iSlaPlan = colIndex('sla_plan', 'sla plan');

  const tickets: Ticket[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = parseRow(line);
    if (cols.length < 5) continue;

    const createdDate = parseDate(valueAt(cols, iCree));
    const closedDate = parseDate(valueAt(cols, iFerme));
    const resolvedDate = parseDate(valueAt(cols, iResolved));
    const attachmentValue = valueAt(cols, iFichiers);
    const hasAttachment = parseBooleanLike(attachmentValue) ?? attachmentValue.trim() !== '';

    tickets.push({
      id: valueAt(cols, iId),
      project: valueAt(cols, iProjet),
      tracker: valueAt(cols, iTracker),
      status: valueAt(cols, iStatut),
      priority: valueAt(cols, iPrio),
      subject: valueAt(cols, iSujet),
      description: valueAt(cols, iDescription),
      author: valueAt(cols, iAuteur),
      assignee: valueAt(cols, iAssigne),
      createdDate,
      closedDate,
      resolvedDate,
      team: valueAt(cols, iEquipe),
      technology: valueAt(cols, iTech),
      type: valueAt(cols, iType),
      satisfaction: valueAt(cols, iSatisf),
      source: valueAt(cols, iSource),
      fichiers: attachmentValue,
      hasAttachment,
      canal: valueAt(cols, iCanal),
      segmentClient: valueAt(cols, iSegmentClient),
      region: valueAt(cols, iRegion),
      reopened: valueAt(cols, iReopened),
      slaPlan: valueAt(cols, iSlaPlan),
      year: createdDate ? createdDate.getFullYear() : null,
      month: createdDate ? createdDate.getMonth() + 1 : null,
    });
  }

  return tickets;
}

export function getResolutionHoursClosed(t: Ticket): number | null {
  return diffHours(t.createdDate, t.closedDate);
}

export function getResolutionHoursResolved(t: Ticket): number | null {
  return diffHours(t.createdDate, t.resolvedDate);
}

export function countBy<T>(items: T[], keyFn: (item: T) => string): Record<string, number> {
  const result: Record<string, number> = {};
  for (const item of items) {
    const key = keyFn(item) || '(vide)';
    result[key] = (result[key] || 0) + 1;
  }
  return result;
}

export function uniqueValues(tickets: Ticket[], keyFn: (t: Ticket) => string): string[] {
  const set = new Set<string>();
  for (const t of tickets) {
    const v = keyFn(t);
    if (v) set.add(v);
  }
  return Array.from(set).sort();
}

export const MONTH_NAMES = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];
