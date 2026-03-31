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

export const defaultFilters: Filters = {
  ...emptyFilters,
  status: 'Ouvert',
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
        className="rounded-md border border-border bg-card px-2 py-1.5 text-sm text-foreground focus:ring-1 focus:ring-ring w-full"
      >
        <option value="">Tous</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

export default function DashboardFilters({ allTickets, filters, onChange }: Props) {
  const set = (key: keyof Filters, val: string) => onChange({ ...filters, [key]: val });

  const fichierOptions = () => {
    const vals = new Set<string>();
    allTickets.forEach(t => {
      if (t.fichiers && t.fichiers.trim()) vals.add('Oui');
      else vals.add('Non');
    });
    return Array.from(vals).sort();
  };

  return (
    <div className="rounded-lg bg-card border-2 border-accent p-4 h-fit">
      <h3 className="text-sm font-bold text-primary mb-3">Filtres</h3>
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">Date début</label>
          <input type="date" value={filters.dateFrom} onChange={e => set('dateFrom', e.target.value)}
            className="rounded-md border border-border bg-card px-2 py-1.5 text-sm text-foreground w-full" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">Date fin</label>
          <input type="date" value={filters.dateTo} onChange={e => set('dateTo', e.target.value)}
            className="rounded-md border border-border bg-card px-2 py-1.5 text-sm text-foreground w-full" />
        </div>
        <FilterSelect label="Projet" value={filters.project} options={uniqueValues(allTickets, t => t.project)} onChange={v => set('project', v)} />
        <FilterSelect label="Tracker" value={filters.tracker} options={uniqueValues(allTickets, t => t.tracker)} onChange={v => set('tracker', v)} />
        <FilterSelect label="Source" value={filters.source} options={uniqueValues(allTickets, t => t.source)} onChange={v => set('source', v)} />
        <FilterSelect label="Équipe Affectée" value={filters.team} options={uniqueValues(allTickets, t => t.team)} onChange={v => set('team', v)} />
        <FilterSelect label="Statut" value={filters.status} options={uniqueValues(allTickets, t => t.status)} onChange={v => set('status', v)} />
        <FilterSelect label="Priorité" value={filters.priority} options={uniqueValues(allTickets, t => t.priority)} onChange={v => set('priority', v)} />
        <FilterSelect label="Auteur" value={filters.author} options={uniqueValues(allTickets, t => t.author)} onChange={v => set('author', v)} />
        <FilterSelect label="Assigné à" value={filters.assignee} options={uniqueValues(allTickets, t => t.assignee)} onChange={v => set('assignee', v)} />
        <FilterSelect label="CMS / Framework" value={filters.technology} options={uniqueValues(allTickets, t => t.technology)} onChange={v => set('technology', v)} />
        <FilterSelect label="Sujet" value={filters.subject} options={uniqueValues(allTickets, t => t.subject)} onChange={v => set('subject', v)} />
        <FilterSelect label="Fichiers" value={filters.fichiers} options={fichierOptions()} onChange={v => set('fichiers', v)} />
        <FilterSelect label="Degré de satisfaction" value={filters.satisfaction} options={uniqueValues(allTickets, t => t.satisfaction)} onChange={v => set('satisfaction', v)} />
        <FilterSelect label="Type" value={filters.type} options={uniqueValues(allTickets, t => t.type)} onChange={v => set('type', v)} />
        <FilterSelect label="Canal" value={filters.canal} options={uniqueValues(allTickets, t => t.canal)} onChange={v => set('canal', v)} />
        <FilterSelect label="Segment client" value={filters.segmentClient} options={uniqueValues(allTickets, t => t.segmentClient)} onChange={v => set('segmentClient', v)} />
        <FilterSelect label="Région" value={filters.region} options={uniqueValues(allTickets, t => t.region)} onChange={v => set('region', v)} />
        <FilterSelect label="Réouvert" value={filters.reopened} options={uniqueValues(allTickets, t => t.reopened)} onChange={v => set('reopened', v)} />
        <FilterSelect label="SLA plan" value={filters.slaPlan} options={uniqueValues(allTickets, t => t.slaPlan)} onChange={v => set('slaPlan', v)} />
        <button
          onClick={() => onChange(emptyFilters)}
          className="mt-2 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
        >
          Réinitialiser
        </button>
      </div>
    </div>
  );
}
