export interface Ticket {
  id: string;
  project: string;
  tracker: string;
  status: string;
  priority: string;
  subject: string;
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
  year: number | null;
  month: number | null;
}

function parseDate(str: string): Date | null {
  if (!str || str.trim() === '') return null;
  // Format: DD/MM/YYYY or DD/MM/YYYY HH:mm
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

export function parseCSV(text: string): Ticket[] {
  const lines = text.split('\n');
  if (lines.length < 2) return [];

  // Parse header
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
  const colIndex = (name: string) => headers.findIndex(h => h === name);

  const iId = colIndex('#');
  const iProjet = colIndex('Projet');
  const iTracker = colIndex('Tracker');
  const iStatut = colIndex('Statut');
  const iPrio = headers.findIndex(h => h.includes('Priorit'));
  const iSujet = colIndex('Sujet');
  const iAuteur = colIndex('Auteur');
  const iAssigne = headers.findIndex(h => h.startsWith('Assign'));
  const iCree = headers.findIndex(h => h.includes('Cr') && h.includes('e') && !h.includes('Version'));
  const iFerme = headers.findIndex(h => h.startsWith('Ferm') || h.includes('Ferm'));
  const iEquipe = headers.findIndex(h => h.includes('quipe'));
  const iResolved = headers.findIndex(h => h.includes('Resolved'));
  const iTech = headers.findIndex(h => h.includes('CMS') || h.includes('Framework'));
  const iType = colIndex('Type');
  const iSatisf = headers.findIndex(h => h.includes('satisfaction'));
  const iSource = colIndex('Source');

  const tickets: Ticket[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = parseRow(line);
    if (cols.length < 5) continue;

    const createdDate = parseDate(cols[iCree] || '');
    const closedDate = parseDate(cols[iFerme] || '');
    const resolvedDate = parseDate(cols[iResolved] || '');

    tickets.push({
      id: cols[iId] || '',
      project: cols[iProjet] || '',
      tracker: cols[iTracker] || '',
      status: cols[iStatut] || '',
      priority: cols[iPrio] || '',
      subject: cols[iSujet] || '',
      author: cols[iAuteur] || '',
      assignee: cols[iAssigne] || '',
      createdDate,
      closedDate,
      resolvedDate,
      team: cols[iEquipe] || '',
      technology: cols[iTech] || '',
      type: cols[iType] || '',
      satisfaction: cols[iSatisf] || '',
      source: cols[iSource] || '',
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
