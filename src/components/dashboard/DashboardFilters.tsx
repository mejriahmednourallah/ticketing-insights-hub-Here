import { Ticket, uniqueValues } from '@/lib/parseTickets';

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
  dateFrom: string;
  dateTo: string;
}

export const emptyFilters: Filters = {
  project: '', technology: '', priority: '', team: '', tracker: '',
  source: '', status: '', type: '', author: '', assignee: '',
  dateFrom: '', dateTo: '',
};

interface Props {
  allTickets: Ticket[];
  filters: Filters;
  onChange: (f: Filters) => void;
}

function FilterSelect({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="rounded-md border border-border bg-card px-2 py-1.5 text-sm text-foreground focus:ring-1 focus:ring-ring"
      >
        <option value="">Tous</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

export default function DashboardFilters({ allTickets, filters, onChange }: Props) {
  const set = (key: keyof Filters, val: string) => onChange({ ...filters, [key]: val });

  return (
    <div className="rounded-lg bg-card border-2 border-accent p-4 mb-6">
      <h3 className="text-sm font-bold text-primary mb-3">Filtres</h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <FilterSelect label="Projet" value={filters.project} options={uniqueValues(allTickets, t => t.project)} onChange={v => set('project', v)} />
        <FilterSelect label="CMS / Framework" value={filters.technology} options={uniqueValues(allTickets, t => t.technology)} onChange={v => set('technology', v)} />
        <FilterSelect label="Priorité" value={filters.priority} options={uniqueValues(allTickets, t => t.priority)} onChange={v => set('priority', v)} />
        <FilterSelect label="Équipe" value={filters.team} options={uniqueValues(allTickets, t => t.team)} onChange={v => set('team', v)} />
        <FilterSelect label="Tracker" value={filters.tracker} options={uniqueValues(allTickets, t => t.tracker)} onChange={v => set('tracker', v)} />
        <FilterSelect label="Source" value={filters.source} options={uniqueValues(allTickets, t => t.source)} onChange={v => set('source', v)} />
        <FilterSelect label="Statut" value={filters.status} options={uniqueValues(allTickets, t => t.status)} onChange={v => set('status', v)} />
        <FilterSelect label="Type" value={filters.type} options={uniqueValues(allTickets, t => t.type)} onChange={v => set('type', v)} />
        <FilterSelect label="Auteur" value={filters.author} options={uniqueValues(allTickets, t => t.author)} onChange={v => set('author', v)} />
        <FilterSelect label="Assigné à" value={filters.assignee} options={uniqueValues(allTickets, t => t.assignee)} onChange={v => set('assignee', v)} />
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">Date début</label>
          <input type="date" value={filters.dateFrom} onChange={e => set('dateFrom', e.target.value)}
            className="rounded-md border border-border bg-card px-2 py-1.5 text-sm text-foreground" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">Date fin</label>
          <input type="date" value={filters.dateTo} onChange={e => set('dateTo', e.target.value)}
            className="rounded-md border border-border bg-card px-2 py-1.5 text-sm text-foreground" />
        </div>
      </div>
    </div>
  );
}
