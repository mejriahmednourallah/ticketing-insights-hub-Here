import { Ticket } from '@/lib/parseTickets';

export interface Filters {
  project: string;
  technology: string;
  priority: string;
  team: string;
  tracker: string;
  source: string;
  status: string;
  type: string;
  author: string;
  assignee: string;
  subject: string;
  fichiers: string;
  satisfaction: string;
  dateFrom: string;
  dateTo: string;
  canal: string;
  segmentClient: string;
  region: string;
  reopened: string;
  slaPlan: string;
}

export const emptyFilters: Filters = {
  project: '', technology: '', priority: '', team: '', tracker: '',
  source: '', status: '', type: '', author: '', assignee: '',
  subject: '', fichiers: '', satisfaction: '',
  dateFrom: '', dateTo: '',
  canal: '', segmentClient: '', region: '', reopened: '', slaPlan: '',
};

export const defaultFilters: Filters = { ...emptyFilters };

export function hasAttachment(ticket: Ticket): boolean {
  return ticket.hasAttachment ?? Boolean(ticket.fichiers?.trim());
}

export function getAttachmentFilterOptions(tickets: Ticket[]): string[] {
  const options: string[] = [];
  if (tickets.some(hasAttachment)) options.push('Oui');
  if (tickets.some(ticket => !hasAttachment(ticket))) options.push('Non');
  return options;
}

export function applyDashboardFilters(tickets: Ticket[], filters: Filters): Ticket[] {
  return tickets.filter(ticket => {
    if (filters.project && ticket.project !== filters.project) return false;
    if (filters.technology && ticket.technology !== filters.technology) return false;
    if (filters.priority && ticket.priority !== filters.priority) return false;
    if (filters.team && ticket.team !== filters.team) return false;
    if (filters.tracker && ticket.tracker !== filters.tracker) return false;
    if (filters.source && ticket.source !== filters.source) return false;
    if (filters.status && ticket.status !== filters.status) return false;
    if (filters.type && ticket.type !== filters.type) return false;
    if (filters.author && ticket.author !== filters.author) return false;
    if (filters.assignee && ticket.assignee !== filters.assignee) return false;
    if (filters.subject && ticket.subject !== filters.subject) return false;
    if (filters.satisfaction && ticket.satisfaction !== filters.satisfaction) return false;
    if (filters.fichiers === 'Oui' && !hasAttachment(ticket)) return false;
    if (filters.fichiers === 'Non' && hasAttachment(ticket)) return false;
    if (filters.dateFrom) {
      const from = new Date(filters.dateFrom);
      from.setHours(0, 0, 0, 0);
      if (!ticket.createdDate || ticket.createdDate < from) return false;
    }
    if (filters.dateTo) {
      const to = new Date(filters.dateTo);
      to.setHours(23, 59, 59, 999);
      if (!ticket.createdDate || ticket.createdDate > to) return false;
    }
    if (filters.canal && ticket.canal !== filters.canal) return false;
    if (filters.segmentClient && ticket.segmentClient !== filters.segmentClient) return false;
    if (filters.region && ticket.region !== filters.region) return false;
    if (filters.reopened && ticket.reopened !== filters.reopened) return false;
    if (filters.slaPlan && ticket.slaPlan !== filters.slaPlan) return false;
    return true;
  });
}