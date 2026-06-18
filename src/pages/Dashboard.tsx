import { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import AIChatPanel from '@/components/AIChatPanel';
import ChartCard from '@/components/dashboard/ChartCard';
import DashboardFilters from '@/components/dashboard/DashboardFilters';
import IssuesTable from '@/components/dashboard/IssuesTable';
import KPICards from '@/components/dashboard/KPICards';
import {
  DashboardResponse,
  FilterOptions,
  TicketSearchResponse,
  loadAiContext,
  loadDashboard,
  loadFilterOptions,
  searchTickets,
} from '@/lib/analyticsApi';
import { defaultFilters, Filters } from '@/lib/dashboardFilters';

const EMPTY_TICKETS: TicketSearchResponse = { items: [], page: 1, pageSize: 50, total: 0, totalPages: 0 };
const CHART_COLORS = [
  '#0f766e',
  '#2563eb',
  '#7c3aed',
  '#db2777',
  '#f97316',
  '#16a34a',
  '#0891b2',
  '#ca8a04',
  '#dc2626',
  '#475569',
];
const MONTH_LABELS = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc'];
const LEGACY_EMPTY_LABEL = ['Not', 'provided'].join(' ');

const displayName = (value: string | null | undefined) => (
  !value || value === LEGACY_EMPTY_LABEL ? 'Non renseigné' : value
);

function chartData(data: Array<{ name: string; value: number | null }>, limit?: number) {
  return data
    .slice(0, limit)
    .map(point => ({ ...point, name: displayName(point.name), value: point.value ?? 0 }));
}

function groupedByYear(points: Array<{ name: string; year: number; value: number }>, years: number[]) {
  const output = new Map<string, Record<string, string | number>>();
  points.forEach(point => {
    const name = displayName(point.name);
    const item = output.get(name) ?? { name };
    item[String(point.year)] = point.value;
    output.set(name, item);
  });
  return [...output.values()].map(item => {
    years.forEach(year => { item[String(year)] ??= 0; });
    return item;
  });
}

function NoData() {
  return (
    <div className="flex h-[260px] items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-500">
      Aucune donnée disponible
    </div>
  );
}

function BusinessBar({ data, horizontal = false, colorOffset = 0 }: {
  data: Array<{ name: string; value: number | null }>;
  horizontal?: boolean;
  colorOffset?: number;
}) {
  const normalized = chartData(data);
  if (!normalized.length) return <NoData />;

  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={normalized} layout={horizontal ? 'vertical' : 'horizontal'} margin={{ left: horizontal ? 12 : 0 }}>
        <CartesianGrid stroke="#e2e8f0" strokeDasharray="4 4" vertical={false} />
        {horizontal
          ? <><XAxis type="number" tick={{ fontSize: 11, fill: '#64748b' }} /><YAxis dataKey="name" type="category" width={120} tick={{ fontSize: 10, fill: '#475569' }} /></>
          : <><XAxis dataKey="name" tick={{ fontSize: 10, fill: '#64748b' }} angle={-20} textAnchor="end" height={60} /><YAxis tick={{ fontSize: 11, fill: '#64748b' }} /></>}
        <Tooltip contentStyle={{ borderRadius: 12, borderColor: '#e2e8f0' }} />
        <Bar dataKey="value" name="Tickets" radius={horizontal ? [0, 8, 8, 0] : [8, 8, 0, 0]}>
          {normalized.map((_, index) => (
            <Cell key={`bar-${index}`} fill={CHART_COLORS[(index + colorOffset) % CHART_COLORS.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function BusinessDonut({ data }: { data: Array<{ name: string; value: number | null }> }) {
  const normalized = chartData(data);
  if (!normalized.length) return <NoData />;

  return (
    <ResponsiveContainer width="100%" height={280}>
      <PieChart>
        <Tooltip contentStyle={{ borderRadius: 12, borderColor: '#e2e8f0' }} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Pie data={normalized} dataKey="value" nameKey="name" innerRadius={58} outerRadius={96} paddingAngle={2}>
          {normalized.map((_, index) => (
            <Cell key={`slice-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
          ))}
        </Pie>
      </PieChart>
    </ResponsiveContainer>
  );
}

function StackedYearBars({ data, years }: {
  data: Array<Record<string, string | number>>;
  years: number[];
}) {
  if (!data.length || !years.length) return <NoData />;

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data}>
        <CartesianGrid stroke="#e2e8f0" strokeDasharray="4 4" vertical={false} />
        <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#64748b' }} angle={-20} textAnchor="end" height={70} />
        <YAxis tick={{ fontSize: 11, fill: '#64748b' }} />
        <Tooltip contentStyle={{ borderRadius: 12, borderColor: '#e2e8f0' }} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {years.map((year, index) => (
          <Bar key={year} dataKey={String(year)} stackId="year" fill={CHART_COLORS[index % CHART_COLORS.length]} name={String(year)} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

export const monthLabel = (period: string | null | undefined) => {
  if (!period) return 'Mois inconnu';

  const match = String(period).match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/);
  const date = match
    ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3] ?? '1')))
    : new Date(period);

  if (!Number.isFinite(date.getTime())) return 'Mois inconnu';

  return new Intl.DateTimeFormat('fr-FR', {
    month: 'short',
    year: '2-digit',
    timeZone: 'UTC',
  }).format(date);
};

export default function Dashboard() {
  const [filters, setFilters] = useState<Filters>({ ...defaultFilters });
  const [options, setOptions] = useState<FilterOptions>({});
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [tickets, setTickets] = useState<TicketSearchResponse>(EMPTY_TICKETS);
  const [aiContext, setAiContext] = useState('');
  const [page, setPage] = useState(1);
  const [ticketSearchInput, setTicketSearchInput] = useState('');
  const [ticketSearch, setTicketSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadFilterOptions()
      .then(setOptions)
      .catch(() => setError('Les filtres ne sont pas disponibles pour le moment.'));
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPage(1);
      setTicketSearch(ticketSearchInput.trim());
    }, 250);
    return () => window.clearTimeout(timer);
  }, [ticketSearchInput]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      Promise.all([loadDashboard(filters), searchTickets(filters, page, 50, ticketSearch), loadAiContext(filters)])
        .then(([dashboardData, ticketData, context]) => {
          setDashboard(dashboardData);
          setTickets(ticketData);
          setAiContext(context);
        })
        .catch(() => setError('Impossible d’actualiser les indicateurs. Réessayez dans quelques instants.'))
        .finally(() => setLoading(false));
    }, 200);
    return () => window.clearTimeout(timer);
  }, [filters, page, ticketSearch]);

  const updateFilters = (next: Filters) => {
    setPage(1);
    setFilters(next);
  };

  const monthlyTrend = useMemo(
    () => (dashboard?.charts.monthlyTrend ?? []).slice(-18).map(point => ({
      name: monthLabel(point.period),
      value: point.value,
    })),
    [dashboard],
  );

  const monthlySeasonality = useMemo(
    () => (dashboard?.charts.monthly ?? []).map(point => ({
      name: MONTH_LABELS[point.month - 1] ?? String(point.month),
      value: point.value,
    })),
    [dashboard],
  );

  const technologyByYear = useMemo(
    () => dashboard ? groupedByYear(dashboard.charts.technologyByYear.slice(0, 60), dashboard.years) : [],
    [dashboard],
  );

  const trackerByYear = useMemo(
    () => dashboard ? groupedByYear(dashboard.charts.trackerByYear.slice(0, 60), dashboard.years) : [],
    [dashboard],
  );

  const delayTrend = useMemo(() => {
    if (!dashboard) return [];
    const years = new Map<number, { year: string; resolved?: number | null; closed?: number | null }>();
    dashboard.charts.avgResolvedByYear.forEach(point => {
      years.set(point.year, { ...(years.get(point.year) ?? { year: String(point.year) }), resolved: point.value });
    });
    dashboard.charts.avgClosedByYear.forEach(point => {
      years.set(point.year, { ...(years.get(point.year) ?? { year: String(point.year) }), closed: point.value });
    });
    return [...years.values()];
  }, [dashboard]);

  if (loading && !dashboard) {
    return <div className="flex min-h-[60vh] items-center justify-center font-semibold text-slate-600">Chargement de vos indicateurs…</div>;
  }
  if (error && !dashboard) {
    return <div className="executive-card border-red-200 bg-red-50 p-6 text-red-800">{error}</div>;
  }
  if (!dashboard) return null;

  const charts = dashboard.charts;

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="section-kicker">Pilotage opérationnel</p>
          <h1 className="page-title">Vue d’ensemble</h1>
          <p className="page-subtitle">
            Vue actualisée de l’activité — {dashboard.kpis.totalTickets.toLocaleString('fr-FR')} tickets dans le périmètre sélectionné.
          </p>
        </div>
        {loading && <span className="text-xs font-medium text-teal-700">Actualisation en cours…</span>}
      </section>

      {error && <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}

      <DashboardFilters options={options} filters={filters} onChange={updateFilters} />
      <KPICards kpis={dashboard.kpis} />

      <section>
        <div className="mb-4">
          <p className="section-kicker">Points clés</p>
          <h2 className="text-xl font-bold text-slate-950">Comprendre l’activité en un coup d’œil</h2>
        </div>
        <div className="grid gap-5 lg:grid-cols-2">
          <ChartCard title="Répartition par statut"><BusinessBar data={charts.status.slice(0, 10)} horizontal /></ChartCard>
          <ChartCard title="Répartition par priorité"><BusinessDonut data={charts.priority} /></ChartCard>
          <ChartCard title="Évolution mensuelle des tickets">
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={monthlyTrend}>
                <CartesianGrid stroke="#e2e8f0" strokeDasharray="4 4" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#64748b' }} minTickGap={24} />
                <YAxis tick={{ fontSize: 11, fill: '#64748b' }} />
                <Tooltip contentStyle={{ borderRadius: 12, borderColor: '#e2e8f0' }} />
                <Line dataKey="value" name="Tickets" type="monotone" stroke="#0f766e" strokeWidth={3} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>
          <ChartCard title="Activité par équipe"><BusinessBar data={charts.team.slice(0, 10)} horizontal colorOffset={2} /></ChartCard>
          <ChartCard title="Projets les plus sollicités"><BusinessBar data={charts.project.slice(0, 10)} horizontal colorOffset={4} /></ChartCard>
          <ChartCard title="Évolution des délais moyens" subtitle="En jours, selon l’année de création">
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={delayTrend}>
                <CartesianGrid stroke="#e2e8f0" strokeDasharray="4 4" vertical={false} />
                <XAxis dataKey="year" tick={{ fontSize: 11, fill: '#64748b' }} />
                <YAxis tick={{ fontSize: 11, fill: '#64748b' }} unit=" j" />
                <Tooltip contentStyle={{ borderRadius: 12, borderColor: '#e2e8f0' }} />
                <Legend />
                <Line dataKey="resolved" name="Résolution" type="monotone" stroke="#0d9488" strokeWidth={3} />
                <Line dataKey="closed" name="Clôture" type="monotone" stroke="#2563eb" strokeWidth={3} />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>
      </section>

      <section>
        <div className="mb-4">
          <p className="section-kicker">Canaux et typologies</p>
          <h2 className="text-xl font-bold text-slate-950">Où se concentre la demande</h2>
        </div>
        <div className="grid gap-5 lg:grid-cols-2 xl:grid-cols-3">
          <ChartCard title="Origine des demandes"><BusinessBar data={charts.source.slice(0, 10)} colorOffset={1} /></ChartCard>
          <ChartCard title="Types de tickets"><BusinessBar data={charts.type.slice(0, 10)} colorOffset={3} /></ChartCard>
          <ChartCard title="Satisfaction déclarée"><BusinessDonut data={charts.satisfaction.slice(0, 8)} /></ChartCard>
          <ChartCard title="Avec ou sans fichiers"><BusinessDonut data={charts.attachments} /></ChartCard>
          <ChartCard title="Saisonnalité mensuelle"><BusinessBar data={monthlySeasonality} colorOffset={5} /></ChartCard>
          <ChartCard title="Sujets les plus fréquents"><BusinessBar data={charts.subject.slice(0, 10)} horizontal colorOffset={6} /></ChartCard>
        </div>
      </section>

      <section>
        <div className="mb-4">
          <p className="section-kicker">Acteurs et historique</p>
          <h2 className="text-xl font-bold text-slate-950">Qui intervient et comment l’activité évolue</h2>
        </div>
        <div className="grid gap-5 lg:grid-cols-2">
          <ChartCard title="Auteurs les plus actifs"><BusinessBar data={charts.author.slice(0, 10)} horizontal colorOffset={7} /></ChartCard>
          <ChartCard title="Tickets par assigné"><BusinessBar data={charts.assignee.slice(0, 10)} horizontal colorOffset={8} /></ChartCard>
          <ChartCard title="Technologies par année" subtitle="Volume de tickets par technologie et année">
            <StackedYearBars data={technologyByYear} years={dashboard.years} />
          </ChartCard>
          <ChartCard title="Trackers par année" subtitle="Répartition annuelle par catégorie de suivi">
            <StackedYearBars data={trackerByYear} years={dashboard.years} />
          </ChartCard>
        </div>
      </section>

      <details className="executive-card overflow-hidden">
        <summary className="cursor-pointer px-5 py-4 font-bold text-slate-950 hover:bg-slate-50">
          Consulter les tickets
          <span className="ml-2 text-xs font-normal text-slate-500">{tickets.total.toLocaleString('fr-FR')} résultats</span>
        </summary>
        <div className="border-t border-slate-100 px-5 pb-5">
          <IssuesTable
            result={tickets}
            searchValue={ticketSearchInput}
            onSearchChange={setTicketSearchInput}
            onPageChange={setPage}
          />
        </div>
      </details>

      <AIChatPanel ticketSummary={aiContext} />
    </div>
  );
}
