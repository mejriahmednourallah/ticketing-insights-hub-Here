import { Ticket, getResolutionHoursClosed, getResolutionHoursResolved } from '@/lib/parseTickets';

interface KPICardsProps {
  tickets: Ticket[];
  allTickets: Ticket[];
}

export default function KPICards({ tickets, allTickets }: KPICardsProps) {
  const projects = new Set(tickets.map(t => t.project).filter(Boolean)).size;
  const totalTickets = tickets.length;
  const globalTickets = allTickets.length;

  const resolvedHours = tickets.map(getResolutionHoursResolved).filter((h): h is number => h !== null && h >= 0);
  const closedHours = tickets.map(getResolutionHoursClosed).filter((h): h is number => h !== null && h >= 0);

  const globalResolvedHours = allTickets.map(getResolutionHoursResolved).filter((h): h is number => h !== null && h >= 0);
  const globalClosedHours = allTickets.map(getResolutionHoursClosed).filter((h): h is number => h !== null && h >= 0);

  const avg = (arr: number[]) => arr.length ? (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1) : '—';

  const cards = [
    { label: 'Nombre de Projets', value: projects },
    { label: 'Nombre de tickets', value: totalTickets },
    { label: 'Nombre de tickets (global)', value: globalTickets },
    { label: 'Délai moyen resolved (h)', value: avg(resolvedHours) },
    { label: 'Délai moyen fermé (h)', value: avg(closedHours) },
    { label: 'Délai moyen resolved global (h)', value: avg(globalResolvedHours) },
    { label: 'Délai moyen fermé global (h)', value: avg(globalClosedHours) },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3 mb-6">
      {cards.map(c => (
        <div key={c.label} className="rounded-lg bg-card border-2 border-accent p-4 text-center shadow-sm">
          <div className="text-2xl font-bold text-primary">{c.value}</div>
          <div className="text-xs text-muted-foreground mt-1">{c.label}</div>
        </div>
      ))}
    </div>
  );
}
