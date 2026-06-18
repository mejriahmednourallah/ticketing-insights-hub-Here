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
        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none ring-primary/20 focus:ring-4">
        <option value="">Tout</option>
        {options.map(option => <option key={option} value={option}>{option}</option>)}
      </select>
    </div>
  );
}

export default function DashboardFilters({ options, filters, onChange }: Props) {
  const set = (key: keyof Filters, value: string) => onChange({ ...filters, [key]: value });
  const values = (key: keyof Filters) => options[key] ?? [];

  const primaryFields: Array<[keyof Filters, string]> = [
    ['project', 'Projet'], ['team', 'Équipe'], ['status', 'Statut'], ['priority', 'Priorité'],
  ];
  const advancedFields: Array<[keyof Filters, string]> = [
    ['tracker', 'Tracker'], ['source', 'Source'],
    ['author', 'Auteur'], ['assignee', 'Assigné à'], ['technology', 'CMS / Framework'],
    ['subject', 'Sujet'], ['fichiers', 'Fichiers'], ['satisfaction', 'Degré de satisfaction'],
    ['type', 'Type'], ['canal', 'Canal'], ['segmentClient', 'Segment client'],
    ['region', 'Région'], ['reopened', 'Réouvert'], ['slaPlan', 'SLA plan'],
  ];

  return (
    <div className="executive-card p-4 md:p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-slate-950">Filtres</h3>
          <p className="mt-1 text-xs text-slate-500">Affinez la vue selon votre besoin.</p>
        </div>
        <button
          type="button"
          onClick={() => onChange({ ...emptyFilters })}
          className="rounded-lg px-3 py-2 text-xs font-semibold text-primary hover:bg-teal-50"
        >
          Réinitialiser
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
        {primaryFields.map(([key, label]) => (
          <FilterSelect key={key} label={label} value={filters[key]} options={values(key)}
            onChange={value => set(key, value)} />
        ))}
      </div>
      <details className="mt-4 border-t border-slate-100 pt-4">
        <summary className="cursor-pointer text-sm font-semibold text-slate-600 hover:text-primary">Filtres avancés</summary>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">Date début</label>
            <input type="date" value={filters.dateFrom} onChange={event => set('dateFrom', event.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">Date fin</label>
            <input type="date" value={filters.dateTo} onChange={event => set('dateTo', event.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800" />
          </div>
          {advancedFields.map(([key, label]) => (
            <FilterSelect key={key} label={label} value={filters[key]} options={values(key)}
              onChange={value => set(key, value)} />
          ))}
        </div>
      </details>
    </div>
  );
}
