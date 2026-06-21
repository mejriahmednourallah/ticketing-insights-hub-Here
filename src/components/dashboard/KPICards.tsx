import { DashboardResponse } from '@/lib/analyticsApi';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { BriefcaseBusiness, Clock3, FolderKanban, HelpCircle, Tickets } from 'lucide-react';

type KpiCard = {
  label: string;
  value: string;
  helper: string;
  icon: typeof FolderKanban;
};

type KpiVariant = 'global' | 'scoped';

const days = (value: number | null) => (value == null ? '—' : `${value.toLocaleString('fr-FR')} j`);

function MetricCard({ card }: { card: KpiCard }) {
  const Icon = card.icon;

  return (
    <div className="group relative flex min-h-[92px] flex-col items-center justify-center overflow-visible rounded-xl border border-amber-200/80 bg-white px-4 py-4 text-center shadow-sm transition hover:-translate-y-0.5 hover:border-amber-300 hover:shadow-md">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-blue-600 via-teal-500 to-amber-400 opacity-0 transition group-hover:opacity-100" />
      <div className="absolute right-3 top-3 hidden rounded-full bg-blue-50 p-1.5 text-blue-700/80 sm:block">
        <Icon className="h-3.5 w-3.5" />
      </div>
      <p className="text-2xl font-extrabold leading-none tracking-[0.06em] text-blue-700 md:text-[1.7rem]">
        {card.value}
      </p>
      <div className="mt-2 flex max-w-[12rem] items-start justify-center gap-1.5 text-[11px] font-medium leading-snug text-slate-500">
        <span>{card.label}</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="-mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-blue-500/80 outline-none transition hover:bg-blue-50 hover:text-blue-700 focus-visible:ring-2 focus-visible:ring-blue-300"
              aria-label={`Aide — ${card.label}`}
            >
              <HelpCircle className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" align="center" className="max-w-[220px] text-center text-xs leading-snug">
            {card.helper}
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}

export default function KPICards({ kpis, variant }: {
  kpis: DashboardResponse['kpis'];
  variant: KpiVariant;
}) {
  const globalCards: KpiCard[] = [
    {
      label: 'Nombre de projets',
      value: kpis.globalProjects.toLocaleString('fr-FR'),
      helper: 'Tous les projets suivis dans la base.',
      icon: FolderKanban,
    },
    {
      label: 'Nombre de tickets global',
      value: kpis.globalTickets.toLocaleString('fr-FR'),
      helper: 'Volume total de tickets disponibles.',
      icon: Tickets,
    },
    {
      label: 'Délai moyen résolu global',
      value: days(kpis.globalAvgResolvedDays),
      helper: 'Durée moyenne de résolution sur tous les tickets.',
      icon: Clock3,
    },
    {
      label: 'Délai moyen fermé global',
      value: days(kpis.globalAvgClosedDays),
      helper: 'Durée moyenne de clôture sur tous les tickets.',
      icon: BriefcaseBusiness,
    },
  ];

  const scopedCards: KpiCard[] = [
    {
      label: 'Projets avec tickets',
      value: kpis.projectsWithTickets.toLocaleString('fr-FR'),
      helper: 'Projets actifs dans le périmètre filtré.',
      icon: FolderKanban,
    },
    {
      label: 'Tickets filtrés',
      value: kpis.totalTickets.toLocaleString('fr-FR'),
      helper: 'Tickets correspondant aux filtres sélectionnés.',
      icon: Tickets,
    },
    {
      label: 'Délai moyen de résolution',
      value: days(kpis.avgResolvedDays),
      helper: 'Durée moyenne entre création et résolution.',
      icon: Clock3,
    },
    {
      label: 'Délai moyen de clôture',
      value: days(kpis.avgClosedDays),
      helper: 'Durée moyenne entre création et clôture.',
      icon: BriefcaseBusiness,
    },
  ];
  const cards = variant === 'global' ? globalCards : scopedCards;
  const title = variant === 'global' ? 'Vue générale' : 'Périmètre sélectionné';
  const subtitle = variant === 'global'
    ? 'Indicateurs stables sur toute l’activité.'
    : 'Ces indicateurs évoluent avec les filtres.';

  return (
    <section className="space-y-3">
      <div>
        <p className="section-kicker">{title}</p>
        <p className="text-xs text-slate-500">{subtitle}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(card => <MetricCard key={card.label} card={card} />)}
      </div>
    </section>
  );
}
