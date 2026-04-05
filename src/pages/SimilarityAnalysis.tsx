import { useState, useEffect, useMemo, useCallback } from 'react';
import { ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { parseCSV, Ticket, uniqueValues } from '@/lib/parseTickets';
import { applyDashboardFilters, defaultFilters, Filters, emptyFilters } from '@/lib/dashboardFilters';
import { computeSimilarities, SimilarityResult } from '@/lib/similarity';
import DashboardFilters from '@/components/dashboard/DashboardFilters';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Link } from 'react-router-dom';

const MAX_COMPARE = 30; // cap to keep computation fast

export default function SimilarityAnalysis() {
  const [allTickets, setAllTickets] = useState<Ticket[]>([]);
  const [filters, setFilters] = useState<Filters>(() => ({ ...defaultFilters }));
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 30;

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

  const toggleId = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < MAX_COMPARE) next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    const ids = tickets.slice(0, MAX_COMPARE).map(t => t.id);
    setSelectedIds(new Set(ids));
  }, [tickets]);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  // Compute similarities only for selected tickets
  const selectedTickets = useMemo(() => tickets.filter(t => selectedIds.has(t.id)), [tickets, selectedIds]);
  const similarities = useMemo(() => computeSimilarities(selectedTickets), [selectedTickets]);

  // Pagination for results
  const totalResultPages = Math.ceil(similarities.length / PAGE_SIZE);
  const visibleResults = useMemo(() => similarities.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [similarities, page]);

  // Reset page when results change
  useMemo(() => { if (page > 0 && page >= totalResultPages) setPage(0); }, [similarities.length]);

  // Scatter data: each pair as a point
  const scatterData = useMemo(() => {
    return similarities.slice(0, 200).map((s, i) => ({
      x: Math.round(s.textSimilarity * 100),
      y: Math.round(s.numDistance * 10) / 10,
      z: Math.round(s.combinedScore * 100),
      label: `${s.idA} ↔ ${s.idB}`,
      index: i,
    }));
  }, [similarities]);

  const getColor = (score: number) => {
    if (score >= 70) return 'hsl(145, 60%, 42%)';
    if (score >= 40) return 'hsl(45, 95%, 55%)';
    return 'hsl(0, 75%, 55%)';
  };

  if (loading) return <div className="flex items-center justify-center min-h-screen bg-background"><p className="text-lg text-muted-foreground">Chargement...</p></div>;

  return (
    <div className="min-h-screen bg-background p-4 md:p-6">
      <div className="flex items-center gap-3 mb-2">
        <h1 className="text-2xl md:text-3xl font-bold text-primary">Analyse de Similarité</h1>
        <Link to="/" className="text-sm text-muted-foreground hover:text-primary transition-colors">← Dashboard</Link>
      </div>
      <p className="text-muted-foreground mb-4 text-sm">
        Sélectionnez des tickets pour comparer leur similarité (max {MAX_COMPARE}).
        {' '}{tickets.length} tickets filtrés / {allTickets.length} total
      </p>

      <div className="flex gap-4">
        {/* Sidebar filters - reuses the same 19-filter component */}
        <div className="w-64 min-w-[240px] shrink-0 hidden lg:block overflow-y-auto max-h-[calc(100vh-200px)] sticky top-4">
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
          {/* Ticket selection table */}
          <div className="rounded-lg border bg-card p-4 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h2 className="text-lg font-semibold text-primary">1. Sélectionner les tickets</h2>
              <div className="flex gap-2">
                <Badge variant="secondary">{selectedIds.size} sélectionnés</Badge>
                <Button variant="outline" size="sm" onClick={selectAll}>Top {MAX_COMPARE}</Button>
                <Button variant="outline" size="sm" onClick={clearSelection}>Désélectionner</Button>
              </div>
            </div>
            <div className="overflow-auto max-h-[350px] rounded border">
              <Table>
                <TableHeader className="sticky top-0 bg-muted z-10">
                  <TableRow>
                    <TableHead className="w-10"></TableHead>
                    <TableHead className="w-[60px]">ID</TableHead>
                    <TableHead>Sujet</TableHead>
                    <TableHead>Projet</TableHead>
                    <TableHead>Statut</TableHead>
                    <TableHead>Priorité</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tickets.slice(0, 200).map(t => (
                    <TableRow key={t.id} className={cn(selectedIds.has(t.id) && 'bg-primary/10')}>
                      <TableCell>
                        <Checkbox
                          checked={selectedIds.has(t.id)}
                          onCheckedChange={() => toggleId(t.id)}
                          disabled={!selectedIds.has(t.id) && selectedIds.size >= MAX_COMPARE}
                        />
                      </TableCell>
                      <TableCell className="font-mono text-xs">{t.id}</TableCell>
                      <TableCell className="text-xs max-w-[250px] truncate" title={t.subject}>{t.subject}</TableCell>
                      <TableCell className="text-xs">{t.project}</TableCell>
                      <TableCell className="text-xs">{t.status}</TableCell>
                      <TableCell className="text-xs">{t.priority}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>

          {/* Results */}
          {selectedIds.size >= 2 && (
            <>
              {/* Scatter visualization */}
              <div className="rounded-lg border bg-card p-4 space-y-3">
                <h2 className="text-lg font-semibold text-primary">2. Clusters de similarité</h2>
                <p className="text-xs text-muted-foreground">Axe X = Similarité textuelle (%), Axe Y = Distance numérique. Couleur = score combiné (vert = très similaire).</p>
                <ResponsiveContainer width="100%" height={320}>
                  <ScatterChart margin={{ top: 10, right: 20, bottom: 10, left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="x" name="Similarité texte %" type="number" domain={[0, 100]} />
                    <YAxis dataKey="y" name="Distance num." type="number" />
                    <ZAxis dataKey="z" range={[40, 200]} name="Score combiné" />
                    <Tooltip
                      content={({ payload }) => {
                        if (!payload?.[0]) return null;
                        const d = payload[0].payload;
                        return (
                          <div className="rounded bg-popover border p-2 text-xs shadow-md">
                            <p className="font-medium">{d.label}</p>
                            <p>Texte: {d.x}%</p>
                            <p>Distance: {d.y}</p>
                            <p>Score: {d.z}%</p>
                          </div>
                        );
                      }}
                    />
                    <Scatter data={scatterData}>
                      {scatterData.map((d, i) => (
                        <Cell key={i} fill={getColor(d.z)} />
                      ))}
                    </Scatter>
                  </ScatterChart>
                </ResponsiveContainer>
              </div>

              {/* Results table */}
              <div className="rounded-lg border bg-card p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-primary">3. Résultats de comparaison</h2>
                  <p className="text-xs text-muted-foreground">{similarities.length} paires — page {page + 1}/{totalResultPages || 1}</p>
                </div>
                <div className="overflow-auto max-h-[500px] rounded border">
                  <Table>
                    <TableHeader className="sticky top-0 bg-muted z-10">
                      <TableRow>
                        <TableHead>Ticket A</TableHead>
                        <TableHead>Ticket B</TableHead>
                        <TableHead className="text-center">Similarité texte</TableHead>
                        <TableHead className="text-center">Distance num.</TableHead>
                        <TableHead className="text-center">Score combiné</TableHead>
                        <TableHead>Différences clés</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visibleResults.map((r, i) => (
                        <TableRow key={`${r.idA}-${r.idB}-${i}`}>
                          <TableCell className="text-xs">
                            <span className="font-mono font-bold">{r.idA}</span>
                            <br /><span className="text-muted-foreground truncate max-w-[150px] inline-block" title={r.subjectA}>{r.subjectA}</span>
                          </TableCell>
                          <TableCell className="text-xs">
                            <span className="font-mono font-bold">{r.idB}</span>
                            <br /><span className="text-muted-foreground truncate max-w-[150px] inline-block" title={r.subjectB}>{r.subjectB}</span>
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge variant={r.textSimilarity >= 0.7 ? 'default' : r.textSimilarity >= 0.4 ? 'secondary' : 'outline'}>
                              {Math.round(r.textSimilarity * 100)}%
                            </Badge>
                          </TableCell>
                          <TableCell className="text-center text-xs">{r.numDistance.toFixed(1)}</TableCell>
                          <TableCell className="text-center">
                            <Badge variant={r.combinedScore >= 0.7 ? 'default' : r.combinedScore >= 0.4 ? 'secondary' : 'destructive'}>
                              {Math.round(r.combinedScore * 100)}%
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs max-w-[250px]">
                            {r.differences.length === 0
                              ? <span className="text-muted-foreground italic">Identiques</span>
                              : r.differences.slice(0, 3).map((d, j) => <div key={j}>{d}</div>)
                            }
                          </TableCell>
                        </TableRow>
                      ))}
                      {visibleResults.length === 0 && (
                        <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Sélectionnez au moins 2 tickets</TableCell></TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
                {totalResultPages > 1 && (
                  <div className="flex items-center justify-center gap-2 pt-1">
                    <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>← Précédent</Button>
                    <Button variant="outline" size="sm" disabled={page >= totalResultPages - 1} onClick={() => setPage(p => p + 1)}>Suivant →</Button>
                  </div>
                )}
              </div>
            </>
          )}

          {selectedIds.size < 2 && selectedIds.size > 0 && (
            <div className="rounded-lg border bg-card p-6 text-center text-muted-foreground">
              Sélectionnez au moins <strong>2 tickets</strong> pour lancer l'analyse de similarité.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
