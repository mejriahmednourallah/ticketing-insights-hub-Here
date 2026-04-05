import { useState, useEffect, useMemo } from 'react';
import { parseCSV, Ticket, uniqueValues } from '@/lib/parseTickets';
import { applyDashboardFilters, defaultFilters, Filters, emptyFilters } from '@/lib/dashboardFilters';
import { computeSimilaritiesForTicket } from '@/lib/similarity';
import DashboardFilters from '@/components/dashboard/DashboardFilters';
import SimilarityKPI from '@/components/similarity/SimilarityKPI';
import SimilarityBarChart from '@/components/similarity/SimilarityBarChart';
import SimilarityScatter from '@/components/similarity/SimilarityScatter';
import SimilarityHeatmap from '@/components/similarity/SimilarityHeatmap';
import SimilarityResultsTable from '@/components/similarity/SimilarityResultsTable';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';

export default function SimilarityAnalysis() {
  const [allTickets, setAllTickets] = useState<Ticket[]>([]);
  const [filters, setFilters] = useState<Filters>(() => ({ ...defaultFilters }));
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    fetch('/data/issues.csv')
      .then(r => r.arrayBuffer())
      .then(buf => {
        const text = new TextDecoder('iso-8859-1').decode(buf);
        setAllTickets(parseCSV(text));
        setLoading(false);
      });
  }, []);

  const tickets = useMemo(() => applyDashboardFilters(allTickets, filters), [allTickets, filters]);

  const referenceTicket = useMemo(() => tickets.find(t => t.id === selectedId) ?? null, [tickets, selectedId]);

  const similarities = useMemo(() => {
    if (!referenceTicket) return [];
    const others = tickets.filter(t => t.id !== referenceTicket.id);
    return computeSimilaritiesForTicket(referenceTicket, others);
  }, [referenceTicket, tickets]);

  // Filter ticket picker dropdown
  const filteredPickerTickets = useMemo(() => {
    if (!searchTerm) return tickets.slice(0, 100);
    const q = searchTerm.toLowerCase();
    return tickets.filter(t => t.id.includes(q) || t.subject.toLowerCase().includes(q)).slice(0, 100);
  }, [tickets, searchTerm]);

  const handleReset = () => {
    setFilters({ ...emptyFilters });
    setSelectedId('');
    setSearchTerm('');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <p className="text-lg text-muted-foreground">Chargement...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4 md:p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-primary">Analyse de Similarité</h1>
          <p className="text-xs text-muted-foreground mt-1">
            {tickets.length} tickets filtrés / {allTickets.length} total
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/" className="text-sm text-muted-foreground hover:text-primary transition-colors">← Dashboard</Link>
          <Button variant="outline" size="sm" onClick={handleReset}>Réinitialiser</Button>
        </div>
      </div>

      <div className="flex gap-4">
        {/* Sidebar filters */}
        <div className="w-64 min-w-[240px] shrink-0 hidden lg:block overflow-y-auto max-h-[calc(100vh-120px)] sticky top-4">
          <DashboardFilters allTickets={allTickets} filters={filters} onChange={setFilters} />
        </div>
        <div className="lg:hidden mb-4 w-full">
          <details className="rounded-lg bg-card border-2 border-accent p-3">
            <summary className="text-sm font-bold text-primary cursor-pointer">Filtres</summary>
            <div className="mt-3">
              <DashboardFilters allTickets={allTickets} filters={filters} onChange={setFilters} />
            </div>
          </details>
        </div>

        <div className="flex-1 min-w-0 space-y-6">
          {/* Ticket selector */}
          <div className="rounded-lg border bg-card p-4 space-y-3">
            <h2 className="text-lg font-semibold text-primary">1. Sélectionner un ticket de référence</h2>
            <div className="flex flex-col sm:flex-row gap-3">
              <input
                type="text"
                placeholder="Rechercher par ID ou sujet..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="flex-1 rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground focus:ring-1 focus:ring-ring"
              />
            </div>
            <div className="overflow-auto max-h-[250px] rounded border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted z-10">
                  <tr>
                    <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">ID</th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Sujet</th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Projet</th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPickerTickets.map(t => (
                    <tr
                      key={t.id}
                      onClick={() => setSelectedId(t.id)}
                      className={`cursor-pointer hover:bg-muted/50 transition-colors ${selectedId === t.id ? 'bg-primary/15 font-medium' : ''}`}
                    >
                      <td className="px-3 py-1.5 font-mono text-xs">{t.id}</td>
                      <td className="px-3 py-1.5 text-xs max-w-[250px] truncate" title={t.subject}>{t.subject}</td>
                      <td className="px-3 py-1.5 text-xs">{t.project}</td>
                      <td className="px-3 py-1.5 text-xs">{t.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Results section */}
          {referenceTicket && similarities.length > 0 && (
            <>
              {/* KPI */}
              <SimilarityKPI results={similarities} referenceId={referenceTicket.id} />

              {/* Charts row */}
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <SimilarityBarChart results={similarities} />
                <SimilarityScatter results={similarities} />
              </div>

              {/* Heatmap */}
              <SimilarityHeatmap tickets={[referenceTicket, ...tickets.filter(t => t.id !== referenceTicket.id).slice(0, 29)]} />

              {/* Ranked table */}
              <SimilarityResultsTable results={similarities} />
            </>
          )}

          {selectedId && !referenceTicket && (
            <div className="rounded-lg border bg-card p-6 text-center text-muted-foreground">
              Le ticket <strong>#{selectedId}</strong> n'est pas dans les résultats filtrés.
            </div>
          )}

          {!selectedId && (
            <div className="rounded-lg border bg-card p-6 text-center text-muted-foreground">
              Cliquez sur un ticket ci-dessus pour lancer l'analyse de similarité.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
