import { Ticket, getResolutionHoursClosed, getResolutionHoursResolved } from '@/lib/parseTickets';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface KPICardsProps {
  tickets: Ticket[];
  allTickets: Ticket[];
  globalProjectCount?: number | null;
}

/** Blue info pill for KPI labels. */
function KpiTooltip({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-blue-500 text-white text-[10px] font-bold cursor-help ml-1.5">?</span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[240px] text-xs">
        {text}
      </TooltipContent>
    </Tooltip>
  );
}

export default function KPICards({ tickets, allTickets, globalProjectCount }: KPICardsProps) {
  const projectsWithTickets = new Set(tickets.map(t => t.project).filter(Boolean)).size;
  const projectsGlobalFallback = new Set(allTickets.map(t => t.project).filter(Boolean)).size;
  const projectsGlobal = globalProjectCount ?? projectsGlobalFallback;
  const totalTickets = tickets.length;
  const globalTickets = allTickets.length;

  const resolvedHours = tickets.map(getResolutionHoursResolved).filter((h): h is number => h !== null && h >= 0);
  const closedHours = tickets.map(getResolutionHoursClosed).filter((h): h is number => h !== null && h >= 0);

  const globalResolvedHours = allTickets.map(getResolutionHoursResolved).filter((h): h is number => h !== null && h >= 0);
  const globalClosedHours = allTickets.map(getResolutionHoursClosed).filter((h): h is number => h !== null && h >= 0);

  const avg = (arr: number[]) => arr.length ? (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1) : '—';
  const avgDays = (arr: number[]) => arr.length ? ((arr.reduce((a, b) => a + b, 0) / arr.length) / 24).toFixed(1) : '—';

  // ── Stable KPIs (never change with filters) ──
  const stableCards = [
    { label: 'Nombre de Projets', value: projectsGlobal, tooltip: 'Total des projets dans Redmine (fixe, insensible aux filtres).' },
    { label: 'Nombre de tickets (global)', value: globalTickets, tooltip: 'Total des tickets chargés depuis Redmine (fixe, insensible aux filtres).' },
  ];

  // ── Dynamic KPIs (change with active filters) ──
  const dynamicCards = [
    { label: 'Nombre de Projets (avec tickets)', value: projectsWithTickets, tooltip: 'Projets ayant au moins un ticket dans le périmètre filtré.' },
    { label: 'Nombre de tickets', value: totalTickets, tooltip: 'Tickets correspondant aux filtres actifs.' },
    { label: 'Délai moyen resolved (j)', value: avgDays(resolvedHours), tooltip: 'Moyenne des jours entre création et résolution pour les tickets filtrés.' },
    { label: 'Délai moyen fermé (j)', value: avgDays(closedHours), tooltip: 'Moyenne des jours entre création et fermeture pour les tickets filtrés.' },
    { label: 'Délai moyen resolved global (j)', value: avgDays(globalResolvedHours), tooltip: 'Moyenne des jours de résolution sur l\'ensemble des tickets (hors filtres).' },
    { label: 'Délai moyen fermé global (j)', value: avgDays(globalClosedHours), tooltip: 'Moyenne des jours de fermeture sur l\'ensemble des tickets (hors filtres).' },
  ];

  return (
    <div className="space-y-6 mb-6">
      {/* Stable row */}
      <div className="grid grid-cols-2 gap-3">
        {stableCards.map(c => (
          <div key={c.label} className="rounded-lg bg-card border-2 border-accent p-4 text-center shadow-sm">
            <div className="text-2xl font-bold text-primary">{c.value}</div>
            <div className="flex items-center justify-center mt-1">
              <span className="text-xs text-muted-foreground">{c.label}</span>
              <KpiTooltip text={c.tooltip} />
            </div>
          </div>
        ))}
      </div>

      {/* Separator */}
      <div className="border-t border-border/50" />

      {/* Dynamic row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {dynamicCards.map(c => (
          <div key={c.label} className="rounded-lg bg-card border-2 border-accent p-4 text-center shadow-sm">
            <div className="text-2xl font-bold text-primary">{c.value}</div>
            <div className="flex items-center justify-center mt-1">
              <span className="text-xs text-muted-foreground">{c.label}</span>
              <KpiTooltip text={c.tooltip} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
