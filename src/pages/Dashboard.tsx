import { useEffect, useMemo, useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Cell, LabelList, Legend, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { Button } from '@/components/ui/button';
import AIChatPanel from '@/components/AIChatPanel';
import ChartCard from '@/components/dashboard/ChartCard';
import DashboardFilters from '@/components/dashboard/DashboardFilters';
import IssuesTable from '@/components/dashboard/IssuesTable';
import KPICards from '@/components/dashboard/KPICards';
import {
  DashboardResponse, FilterOptions, QualityResponse, TicketSearchResponse,
  loadAiContext, loadDashboard, loadFilterOptions, loadQuality, searchTickets,
} from '@/lib/analyticsApi';
import { defaultFilters, Filters } from '@/lib/dashboardFilters';
import { MONTH_NAMES } from '@/lib/parseTickets';

const COLORS = ['#3b82f6', '#ef4444', '#f59e0b', '#22c55e', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316'];
const EMPTY_TICKETS: TicketSearchResponse = { items: [], page: 1, pageSize: 50, total: 0, totalPages: 0 };

function groupedByYear(points: Array<{ name: string; year: number; value: number }>, years: number[]) {
  const output = new Map<string, Record<string, string | number>>();
  points.forEach(point => {
    const item = output.get(point.name) ?? { name: point.name };
    item[String(point.year)] = point.value;
    output.set(point.name, item);
  });
  return [...output.values()].map(item => {
    years.forEach(year => { item[String(year)] ??= 0; });
    return item;
  });
}

function SimpleBar({ data, horizontal = false }: { data: Array<{ name: string; value: number | null }>; horizontal?: boolean }) {
  return (
    <ResponsiveContainer width="100%" height={250}>
      <BarChart data={data} layout={horizontal ? 'vertical' : 'horizontal'}>
        <CartesianGrid strokeDasharray="3 3" />
        {horizontal
          ? <><XAxis type="number" /><YAxis dataKey="name" type="category" width={120} tick={{ fontSize: 10 }} /></>
          : <><XAxis dataKey="name" tick={{ fontSize: 9 }} angle={-25} textAnchor="end" height={65} /><YAxis /></>}
        <Tooltip />
        <Bar dataKey="value" fill="#3b82f6"><LabelList dataKey="value" position="top" fontSize={10} /></Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function QualityPanel({ quality }: { quality: QualityResponse | null }) {
  if (!quality) return null;
  return (
    <details className="mb-4 rounded-lg border bg-card p-4">
      <summary className="cursor-pointer font-semibold text-primary">Qualité du mapping Redmine</summary>
      <p className="mt-2 text-xs text-muted-foreground">
        Entrepôt publié: {new Date(quality.warehouseUpdatedAt).toLocaleString()}
        {' · '}Formats de date invalides: {quality.formatIssueCount}
      </p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
        {quality.summary.map(item => (
          <div key={item.field_name} className="rounded border p-3 text-sm">
            <p className="font-medium">{item.field_name}</p>
            <p>Couverture: {item.coveragePct}%</p>
            <p>Source non renseignée: {item.sourceEmptyCount}</p>
            <p>Champ absent de la réponse: {item.sourceAbsentCount}</p>
            <p className={item.mappingFailureCount ? 'text-destructive font-bold' : ''}>Échecs de mapping: {item.mappingFailureCount}</p>
            <p className={item.conflictCount ? 'text-amber-600 font-bold' : ''}>Conflits de candidats: {item.conflictCount}</p>
          </div>
        ))}
      </div>
    </details>
  );
}

export default function Dashboard() {
  const [filters, setFilters] = useState<Filters>({ ...defaultFilters });
  const [options, setOptions] = useState<FilterOptions>({});
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [tickets, setTickets] = useState<TicketSearchResponse>(EMPTY_TICKETS);
  const [quality, setQuality] = useState<QualityResponse | null>(null);
  const [aiContext, setAiContext] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([loadFilterOptions(), loadQuality()])
      .then(([filterOptions, qualityData]) => {
        setOptions(filterOptions);
        setQuality(qualityData);
      })
      .catch(err => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      Promise.all([loadDashboard(filters), searchTickets(filters, page), loadAiContext(filters)])
        .then(([dashboardData, ticketData, context]) => {
          setDashboard(dashboardData);
          setTickets(ticketData);
          setAiContext(context);
        })
        .catch(err => setError(err instanceof Error ? err.message : String(err)))
        .finally(() => setLoading(false));
    }, 200);
    return () => window.clearTimeout(timer);
  }, [filters, page]);

  const updateFilters = (next: Filters) => {
    setPage(1);
    setFilters(next);
  };

  const technologyByYear = useMemo(
    () => groupedByYear(dashboard?.charts.technologyByYear ?? [], dashboard?.years ?? []),
    [dashboard],
  );
  const trackerByYear = useMemo(
    () => groupedByYear(dashboard?.charts.trackerByYear ?? [], dashboard?.years ?? []),
    [dashboard],
  );
  const monthly = useMemo(() => MONTH_NAMES.map((name, index) => ({
    name,
    value: dashboard?.charts.monthly.find(item => item.month === index + 1)?.value ?? 0,
  })), [dashboard]);

  if (loading && !dashboard) return <div className="flex min-h-screen items-center justify-center">Construction des analytics DuckDB...</div>;
  if (error && !dashboard) return <div className="p-8 text-destructive">Analytics indisponibles: {error}</div>;
  if (!dashboard) return null;

  const charts = dashboard.charts;
  const yearChart = (data: Array<Record<string, string | number>>) => (
    <ResponsiveContainer width="100%" height={250}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" tick={{ fontSize: 9 }} /><YAxis /><Tooltip /><Legend />
        {dashboard.years.map((year, index) => <Bar key={year} dataKey={String(year)} fill={COLORS[index % COLORS.length]} />)}
      </BarChart>
    </ResponsiveContainer>
  );

  return (
    <div className="min-h-screen bg-background p-4 md:p-6">
      <div className="flex items-center gap-4 mb-2 flex-wrap">
        <h1 className="text-2xl md:text-3xl font-bold text-primary">Système de Ticketing</h1>
        <a href="/similarity" className="text-sm text-muted-foreground hover:text-primary">Analyse de Similarité →</a>
        <Button variant="outline" size="sm" onClick={() => updateFilters({ ...defaultFilters })}>Réinitialiser</Button>
      </div>
      <p className="text-sm text-muted-foreground mb-4">
        Analytics servis par DuckDB — {dashboard.kpis.totalTickets} tickets filtrés / {dashboard.kpis.globalTickets} total
        {loading ? ' — mise à jour...' : ''}
      </p>
      {error && <p className="text-sm text-destructive mb-3">{error}</p>}

      <QualityPanel quality={quality} />
      <KPICards kpis={dashboard.kpis} />

      <div className="flex gap-4">
        <div className="w-64 min-w-[240px] shrink-0 hidden lg:block overflow-y-auto max-h-[calc(100vh-120px)] sticky top-4">
          <DashboardFilters options={options} filters={filters} onChange={updateFilters} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ChartCard title="Tickets par priorité"><SimpleBar data={charts.priority} /></ChartCard>
            <ChartCard title="Tickets par CMS / Framework et année">{yearChart(technologyByYear)}</ChartCard>
            <ChartCard title="Tickets par projet"><SimpleBar data={charts.project} /></ChartCard>
            <ChartCard title="Sujets les plus fréquents"><SimpleBar data={charts.subject} /></ChartCard>
            <ChartCard title="Tickets par équipe"><SimpleBar data={charts.team} horizontal /></ChartCard>
            <ChartCard title="Tickets par tracker et année">{yearChart(trackerByYear)}</ChartCard>
            <ChartCard title="Tickets par mois"><SimpleBar data={monthly} /></ChartCard>
            <ChartCard title="Délai moyen fermé par année"><SimpleBar data={charts.avgClosedByYear.map(item => ({ name: String(item.year), value: item.value }))} /></ChartCard>
            <ChartCard title="Délai moyen résolu par année"><SimpleBar data={charts.avgResolvedByYear.map(item => ({ name: String(item.year), value: item.value }))} /></ChartCard>
            <ChartCard title="Tickets par source"><SimpleBar data={charts.source} horizontal /></ChartCard>
            <ChartCard title="Tickets par statut"><SimpleBar data={charts.status} horizontal /></ChartCard>
            <ChartCard title="Tickets par type">
              <ResponsiveContainer width="100%" height={250}><PieChart><Pie data={charts.type} dataKey="value" nameKey="name" outerRadius={90} label>{charts.type.map((_, index) => <Cell key={index} fill={COLORS[index % COLORS.length]} />)}</Pie><Tooltip /></PieChart></ResponsiveContainer>
            </ChartCard>
            <ChartCard title="Tickets par satisfaction"><SimpleBar data={charts.satisfaction} /></ChartCard>
            <ChartCard title="Tickets par auteur"><SimpleBar data={charts.author} /></ChartCard>
            <ChartCard title="Tickets par assigné"><SimpleBar data={charts.assignee} /></ChartCard>
            <ChartCard title="Tickets avec fichiers"><SimpleBar data={charts.attachments} /></ChartCard>
          </div>
          <IssuesTable result={tickets} onPageChange={setPage} />
        </div>
      </div>
      <AIChatPanel ticketSummary={aiContext} />
    </div>
  );
}
