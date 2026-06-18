import { DashboardResponse } from '@/lib/analyticsApi';
import { BriefcaseBusiness, Clock3, FolderKanban, Tickets } from 'lucide-react';

export default function KPICards({ kpis }: { kpis: DashboardResponse['kpis'] }) {
  const cards = [
    {
      label: 'Tickets dans le périmètre',
      value: kpis.totalTickets.toLocaleString('fr-FR'),
      detail: `${kpis.globalTickets.toLocaleString('fr-FR')} tickets au total`,
      icon: Tickets,
      tone: 'bg-blue-50 text-blue-700',
    },
    {
      label: 'Projets concernés',
      value: kpis.projectsWithTickets.toLocaleString('fr-FR'),
      detail: `${kpis.globalProjects.toLocaleString('fr-FR')} projets suivis`,
      icon: FolderKanban,
      tone: 'bg-violet-50 text-violet-700',
    },
    {
      label: 'Délai moyen de résolution',
      value: kpis.avgResolvedDays == null ? '—' : `${kpis.avgResolvedDays} j`,
      detail: 'Entre création et résolution',
      icon: Clock3,
      tone: 'bg-teal-50 text-teal-700',
    },
    {
      label: 'Délai moyen de clôture',
      value: kpis.avgClosedDays == null ? '—' : `${kpis.avgClosedDays} j`,
      detail: 'Entre création et clôture',
      icon: BriefcaseBusiness,
      tone: 'bg-amber-50 text-amber-700',
    },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map(card => {
        const Icon = card.icon;
        return (
          <div key={card.label} className="executive-card p-5">
            <div className={`mb-4 flex h-10 w-10 items-center justify-center rounded-xl ${card.tone}`}>
              <Icon className="h-5 w-5" />
            </div>
            <p className="text-sm font-medium text-slate-500">{card.label}</p>
            <p className="mt-1 text-3xl font-bold tracking-tight text-slate-950">{card.value}</p>
            <p className="mt-2 text-xs text-slate-500">{card.detail}</p>
          </div>
        );
      })}
    </div>
  );
}
