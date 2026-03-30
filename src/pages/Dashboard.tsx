import { useState, useEffect, useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell, LabelList } from 'recharts';
import { parseCSV, Ticket, countBy, getResolutionHoursClosed, getResolutionHoursResolved, MONTH_NAMES } from '@/lib/parseTickets';
import KPICards from '@/components/dashboard/KPICards';
import DashboardFilters, { Filters, emptyFilters } from '@/components/dashboard/DashboardFilters';
import ChartCard from '@/components/dashboard/ChartCard';

const PRIORITY_COLORS: Record<string, string> = {
  'Normal': '#3b82f6', 'Urgent': '#ef4444', 'Haute': '#f59e0b', 'Immédiate': '#dc2626',
  'Basse': '#22c55e', 'Critique': '#7c3aed',
};
const YEAR_COLORS: Record<number, string> = { 2023: '#3b82f6', 2024: '#ef4444', 2025: '#f59e0b' };
const YEAR_COLORS_ALT: Record<number, string> = { 2023: '#3b82f6', 2024: '#60a5fa', 2025: '#f97316' };
const PIE_COLORS = ['#3b82f6', '#ef4444', '#f59e0b', '#22c55e', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316'];

function toChartData(counts: Record<string, number>) {
  return Object.entries(counts).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
}

export default function Dashboard() {
  const [allTickets, setAllTickets] = useState<Ticket[]>([]);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/data/issues.csv')
      .then(r => r.arrayBuffer())
      .then(buf => {
        const decoder = new TextDecoder('iso-8859-1');
        const text = decoder.decode(buf);
        setAllTickets(parseCSV(text));
        setLoading(false);
      });
  }, []);

  const tickets = useMemo(() => {
    let t = allTickets;
    if (filters.project) t = t.filter(x => x.project === filters.project);
    if (filters.technology) t = t.filter(x => x.technology === filters.technology);
    if (filters.priority) t = t.filter(x => x.priority === filters.priority);
    if (filters.team) t = t.filter(x => x.team === filters.team);
    if (filters.tracker) t = t.filter(x => x.tracker === filters.tracker);
    if (filters.source) t = t.filter(x => x.source === filters.source);
    if (filters.status) t = t.filter(x => x.status === filters.status);
    if (filters.type) t = t.filter(x => x.type === filters.type);
    if (filters.author) t = t.filter(x => x.author === filters.author);
    if (filters.assignee) t = t.filter(x => x.assignee === filters.assignee);
    if (filters.dateFrom) {
      const d = new Date(filters.dateFrom);
      t = t.filter(x => x.createdDate && x.createdDate >= d);
    }
    if (filters.dateTo) {
      const d = new Date(filters.dateTo);
      t = t.filter(x => x.createdDate && x.createdDate <= d);
    }
    return t;
  }, [allTickets, filters]);

  // Chart 1: Priority
  const priorityData = useMemo(() => toChartData(countBy(tickets, t => t.priority)), [tickets]);

  // Chart 2: CMS grouped by year
  const techYearData = useMemo(() => {
    const years = [2023, 2024, 2025];
    const techs = new Set<string>();
    tickets.forEach(t => { if (t.technology) techs.add(t.technology); });
    return Array.from(techs).map(tech => {
      const row: Record<string, string | number> = { name: tech };
      years.forEach(y => { row[String(y)] = tickets.filter(t => t.technology === tech && t.year === y).length; });
      return row;
    }).sort((a, b) => (Number(b['2025']) + Number(b['2024']) + Number(b['2023'])) - (Number(a['2025']) + Number(a['2024']) + Number(a['2023'])));
  }, [tickets]);

  // Chart 3: Project
  const projectData = useMemo(() => toChartData(countBy(tickets, t => t.project)).slice(0, 20), [tickets]);

  // Chart 4: Subject/issue type
  const subjectData = useMemo(() => toChartData(countBy(tickets, t => t.subject)).slice(0, 15), [tickets]);

  // Chart 5: Team
  const teamData = useMemo(() => toChartData(countBy(tickets, t => t.team)), [tickets]);

  // Chart 6: Tracker grouped by year
  const trackerYearData = useMemo(() => {
    const years = [2023, 2024, 2025];
    const trackers = new Set<string>();
    tickets.forEach(t => { if (t.tracker) trackers.add(t.tracker); });
    return Array.from(trackers).map(tr => {
      const row: Record<string, string | number> = { name: tr };
      years.forEach(y => { row[String(y)] = tickets.filter(t => t.tracker === tr && t.year === y).length; });
      return row;
    });
  }, [tickets]);

  // Chart 7: Monthly
  const monthlyData = useMemo(() => {
    return MONTH_NAMES.map((name, i) => ({
      name,
      value: tickets.filter(t => t.month === i + 1).length,
    }));
  }, [tickets]);

  // Chart 8: Avg closed by year
  const avgClosedByYear = useMemo(() => {
    const years = [2023, 2024, 2025];
    return years.map(y => {
      const yt = tickets.filter(t => t.year === y);
      const hours = yt.map(getResolutionHoursClosed).filter((h): h is number => h !== null && h >= 0);
      return { name: String(y), value: hours.length ? Math.round(hours.reduce((a, b) => a + b, 0) / hours.length) : 0 };
    });
  }, [tickets]);

  // Chart 9: Avg resolved by year
  const avgResolvedByYear = useMemo(() => {
    const years = [2023, 2024, 2025];
    return years.map(y => {
      const yt = tickets.filter(t => t.year === y);
      const hours = yt.map(getResolutionHoursResolved).filter((h): h is number => h !== null && h >= 0);
      return { name: String(y), value: hours.length ? Math.round(hours.reduce((a, b) => a + b, 0) / hours.length) : 0 };
    });
  }, [tickets]);

  // Chart 10: Source
  const sourceData = useMemo(() => toChartData(countBy(tickets, t => t.source)), [tickets]);

  // Chart 11: Status
  const statusData = useMemo(() => toChartData(countBy(tickets, t => t.status)), [tickets]);

  // Chart 12: Type (pie)
  const typeData = useMemo(() => toChartData(countBy(tickets, t => t.type)), [tickets]);

  // Chart 13: Satisfaction
  const satisfactionData = useMemo(() => toChartData(countBy(tickets, t => t.satisfaction)), [tickets]);

  if (loading) return <div className="flex items-center justify-center min-h-screen bg-background"><p className="text-lg text-muted-foreground">Chargement des données...</p></div>;

  return (
    <div className="min-h-screen bg-background p-4 md:p-6">
      <h1 className="text-2xl md:text-3xl font-bold text-primary mb-2">Système de Ticketing</h1>
      <p className="text-muted-foreground mb-4 text-sm">Tableau de bord analytique — {tickets.length} tickets</p>

      <KPICards tickets={tickets} />
      <DashboardFilters allTickets={allTickets} filters={filters} onChange={setFilters} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* 1. Priority */}
        <ChartCard title="Nombre des tickets total par Priorité">
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={priorityData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis />
              <Tooltip />
              <Bar dataKey="value" name="Tickets">
                <LabelList dataKey="value" position="top" fontSize={11} />
                {priorityData.map((d, i) => (
                  <Cell key={i} fill={PRIORITY_COLORS[d.name] || PIE_COLORS[i % PIE_COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* 2. CMS / Framework grouped by year */}
        <ChartCard title="Nombre des tickets total par CMS / Framework" subtitle="Année 2023, 2024, 2025">
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={techYearData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-20} textAnchor="end" height={50} />
              <YAxis />
              <Tooltip />
              <Legend />
              <Bar dataKey="2023" fill={YEAR_COLORS[2023]} />
              <Bar dataKey="2024" fill={YEAR_COLORS[2024]} />
              <Bar dataKey="2025" fill={YEAR_COLORS[2025]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* 3. Project */}
        <ChartCard title="Nombre des tickets total par Projet">
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={projectData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" tick={{ fontSize: 9 }} angle={-25} textAnchor="end" height={60} />
              <YAxis />
              <Tooltip />
              <Bar dataKey="value" fill="hsl(213, 80%, 50%)" name="Tickets">
                <LabelList dataKey="value" position="top" fontSize={10} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* 4. Subject */}
        <ChartCard title="Sujet assigné au projet">
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={subjectData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" tick={{ fontSize: 8 }} angle={-30} textAnchor="end" height={80} />
              <YAxis />
              <Tooltip />
              <Bar dataKey="value" fill="hsl(25, 90%, 55%)" name="Tickets">
                <LabelList dataKey="value" position="top" fontSize={10} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* 5. Team (horizontal) */}
        <ChartCard title="Nombre des tickets par équipe">
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={teamData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" />
              <YAxis dataKey="name" type="category" width={120} tick={{ fontSize: 10 }} />
              <Tooltip />
              <Bar dataKey="value" fill="hsl(145, 60%, 42%)" name="Tickets" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* 6. Tracker grouped by year */}
        <ChartCard title="Nombre des tickets total par tracker">
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={trackerYearData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis />
              <Tooltip />
              <Legend />
              <Bar dataKey="2023" fill={YEAR_COLORS_ALT[2023]} />
              <Bar dataKey="2024" fill={YEAR_COLORS_ALT[2024]} />
              <Bar dataKey="2025" fill={YEAR_COLORS_ALT[2025]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* 7. Monthly */}
        <ChartCard title="Nombre total des tickets par mois">
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={monthlyData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis />
              <Tooltip />
              <Bar dataKey="value" fill="hsl(270, 60%, 55%)" name="Tickets" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* 8. Avg closed by year */}
        <ChartCard title="Évolution du Délai Moyen closed N vs N-1">
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={avgClosedByYear}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="value" fill="hsl(0, 75%, 55%)" name="Heures">
                <LabelList dataKey="value" position="top" fontSize={12} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* 9. Avg resolved by year */}
        <ChartCard title="Évolution du Délai Moyen resolved N vs N-1">
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={avgResolvedByYear}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="value" fill="hsl(213, 80%, 50%)" name="Heures">
                <LabelList dataKey="value" position="top" fontSize={12} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* 10. Source (horizontal) */}
        <ChartCard title="Nombre des tickets total par source">
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={sourceData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" />
              <YAxis dataKey="name" type="category" width={100} tick={{ fontSize: 10 }} />
              <Tooltip />
              <Bar dataKey="value" fill="hsl(200, 75%, 65%)" name="Tickets" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* 11. Status (horizontal) */}
        <ChartCard title="Nombre des tickets total par statut">
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={statusData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" />
              <YAxis dataKey="name" type="category" width={120} tick={{ fontSize: 10 }} />
              <Tooltip />
              <Bar dataKey="value" fill="hsl(45, 95%, 55%)" name="Tickets" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* 12. Type (pie) */}
        <ChartCard title="Nombre des tickets total par type">
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie data={typeData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label={({ name, value }) => `${name}: ${value}`}>
                {typeData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* 13. Satisfaction */}
        <ChartCard title="Nombre des tickets total par Degré de satisfaction">
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={satisfactionData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis />
              <Tooltip />
              <Bar dataKey="value" fill="hsl(330, 70%, 60%)" name="Tickets">
                <LabelList dataKey="value" position="top" fontSize={11} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
    </div>
  );
}
