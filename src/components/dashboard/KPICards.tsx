import { Ticket, getResolutionHoursClosed, getResolutionHoursResolved } from '@/lib/parseTickets';

interface KPICardsProps {
  tickets: Ticket[];
}

export default function KPICards({ tickets }: KPICardsProps) {
  const projects = new Set(tickets.map(t => t.project).filter(Boolean)).size;
  const totalTickets = tickets.length;

  const resolvedHours = tickets.map(getResolutionHoursResolved).filter((h): h is number => h !== null && h >= 0);
  const closedHours = tickets.map(getResolutionHoursClosed).filter((h): h is number => h !== null && h >= 0);

  const avgResolved = resolvedHours.length ? (resolvedHours.reduce((a, b) => a + b, 0) / resolvedHours.length).toFixed(1) : '—';
  const avgClosed = closedHours.length ? (closedHours.reduce((a, b) => a + b, 0) / closedHours.length).toFixed(1) : '—';

  const cards = [
    { label: 'Nombre de Projet', value: projects },
    { label: 'Nombre de tickets', value: totalTickets },
    { label: 'Délai moyen resolved (h)', value: avgResolved },
    { label: 'Délai moyen fermé (h)', value: avgClosed },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      {cards.map(c => (
        <div key={c.label} className="rounded-lg bg-card border-2 border-accent p-5 text-center shadow-sm">
          <div className="text-3xl font-bold text-primary">{c.value}</div>
          <div className="text-sm text-muted-foreground mt-1">{c.label}</div>
        </div>
      ))}
    </div>
  );
}
