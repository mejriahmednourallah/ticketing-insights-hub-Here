import { DashboardResponse } from '@/lib/analyticsApi';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

function KpiTooltip({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-blue-500 text-white text-[10px] font-bold cursor-help ml-1.5">?</span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[240px] text-xs">{text}</TooltipContent>
    </Tooltip>
  );
}

export default function KPICards({ kpis }: { kpis: DashboardResponse['kpis'] }) {
  const display = (value: number | null) => value ?? '—';
  const stable = [
    ['Nombre de Projets', kpis.globalProjects, 'Total de projets calculé par DuckDB.'],
    ['Nombre de tickets (global)', kpis.globalTickets, 'Total de tickets calculé par DuckDB.'],
  ];
  const dynamic = [
    ['Nombre de Projets (avec tickets)', kpis.projectsWithTickets, 'Projets dans le périmètre filtré.'],
    ['Nombre de tickets', kpis.totalTickets, 'Tickets correspondant aux filtres actifs.'],
    ['Délai moyen resolved (j)', display(kpis.avgResolvedDays), 'Calcul DuckDB filtré.'],
    ['Délai moyen fermé (j)', display(kpis.avgClosedDays), 'Calcul DuckDB filtré.'],
    ['Délai resolved global (j)', display(kpis.globalAvgResolvedDays), 'Calcul DuckDB global.'],
    ['Délai fermé global (j)', display(kpis.globalAvgClosedDays), 'Calcul DuckDB global.'],
  ];
  const render = (items: Array<(string | number)[]>, classes: string) => (
    <div className={classes}>
      {items.map(([label, value, tooltip]) => (
        <div key={label} className="rounded-lg bg-card border-2 border-accent p-4 text-center shadow-sm">
          <div className="text-2xl font-bold text-primary">{value}</div>
          <div className="flex items-center justify-center mt-1">
            <span className="text-xs text-muted-foreground">{label}</span>
            <KpiTooltip text={String(tooltip)} />
          </div>
        </div>
      ))}
    </div>
  );
  return <div className="space-y-6 mb-6">{render(stable, 'grid grid-cols-2 gap-3')}<div className="border-t" />{render(dynamic, 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3')}</div>;
}
