import { FilterOptions } from '@/lib/analyticsApi';
import { emptyFilters, Filters } from '@/lib/dashboardFilters';

interface Props {
  options: FilterOptions;
  filters: Filters;
  onChange: (filters: Filters) => void;
}

function FilterSelect({ label, value, options, onChange }: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <select value={value} onChange={event => onChange(event.target.value)}
        className="rounded-md border border-border bg-card px-2 py-1.5 text-sm text-foreground w-full">
        <option value="">Tout</option>
        {options.map(option => <option key={option} value={option}>{option}</option>)}
      </select>
    </div>
  );
}

export default function DashboardFilters({ options, filters, onChange }: Props) {
  const set = (key: keyof Filters, value: string) => onChange({ ...filters, [key]: value });
  const values = (key: keyof Filters) => options[key] ?? [];

  const fields: Array<[keyof Filters, string]> = [
    ['project', 'Projet'], ['tracker', 'Tracker'], ['source', 'Source'],
    ['team', 'Équipe Affectée'], ['status', 'Statut'], ['priority', 'Priorité'],
    ['author', 'Auteur'], ['assignee', 'Assigné à'], ['technology', 'CMS / Framework'],
    ['subject', 'Sujet'], ['fichiers', 'Fichiers'], ['satisfaction', 'Degré de satisfaction'],
    ['type', 'Type'], ['canal', 'Canal'], ['segmentClient', 'Segment client'],
    ['region', 'Région'], ['reopened', 'Réouvert'], ['slaPlan', 'SLA plan'],
  ];

  return (
    <div className="rounded-lg bg-card border-2 border-accent p-4 h-fit">
      <h3 className="text-sm font-bold text-primary mb-3">Filtres DuckDB</h3>
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">Date début</label>
          <input type="date" value={filters.dateFrom} onChange={event => set('dateFrom', event.target.value)}
            className="rounded-md border border-border bg-card px-2 py-1.5 text-sm text-foreground w-full" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">Date fin</label>
          <input type="date" value={filters.dateTo} onChange={event => set('dateTo', event.target.value)}
            className="rounded-md border border-border bg-card px-2 py-1.5 text-sm text-foreground w-full" />
        </div>
        {fields.map(([key, label]) => (
          <FilterSelect key={key} label={label} value={filters[key]} options={values(key)}
            onChange={value => set(key, value)} />
        ))}
        <button onClick={() => onChange({ ...emptyFilters })}
          className="mt-2 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground">
          Réinitialiser
        </button>
      </div>
    </div>
  );
}
