import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import AIChatPanel from '@/components/AIChatPanel';
import DashboardFilters from '@/components/dashboard/DashboardFilters';
import SimilarityResultsSheet from '@/components/similarity/SimilarityResultsSheet';
import { Button } from '@/components/ui/button';
import {
  FilterOptions, TicketSearchResponse, loadAiContext, loadFilterOptions,
  loadSimilarity, searchTickets,
} from '@/lib/analyticsApi';
import { defaultFilters, emptyFilters, Filters } from '@/lib/dashboardFilters';
import { SimilarityResult } from '@/lib/similarity';

const EMPTY: TicketSearchResponse = { items: [], page: 1, pageSize: 50, total: 0, totalPages: 0 };

export default function SimilarityAnalysis() {
  const [filters, setFilters] = useState<Filters>({ ...defaultFilters });
  const [options, setOptions] = useState<FilterOptions>({});
  const [tickets, setTickets] = useState(EMPTY);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [referenceSubject, setReferenceSubject] = useState('');
  const [results, setResults] = useState<SimilarityResult[]>([]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [aiContext, setAiContext] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadFilterOptions()
      .then(setOptions)
      .catch(() => setError('Les filtres ne sont pas disponibles pour le moment.'));
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      Promise.all([searchTickets(filters, 1, 100, search), loadAiContext(filters)])
        .then(([ticketData, context]) => {
          setTickets(ticketData);
          setAiContext(context);
        })
        .catch(() => setError('Impossible de charger les tickets. Réessayez dans quelques instants.'))
        .finally(() => setLoading(false));
    }, 200);
    return () => window.clearTimeout(timer);
  }, [filters, search]);

  const selectTicket = async (id: number, subject: string) => {
    setSelectedId(String(id));
    setReferenceSubject(subject);
    setSheetOpen(true);
    const response = await loadSimilarity(String(id), filters);
    setResults(response.results);
  };

  const reset = () => {
    setFilters({ ...emptyFilters });
    setSearch('');
    setSelectedId('');
    setResults([]);
    setSheetOpen(false);
  };

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="section-kicker">Aide au diagnostic</p>
          <h1 className="page-title">Cas similaires</h1>
          <p className="page-subtitle">Retrouvez rapidement les tickets proches d’un cas de référence.</p>
        </div>
        <Button variant="outline" size="sm" onClick={reset}>Réinitialiser</Button>
      </section>

      <DashboardFilters options={options} filters={filters} onChange={setFilters} />

      {error && <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}

      <section className="executive-card overflow-hidden">
        <div className="border-b border-slate-100 p-5">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input value={search} onChange={event => setSearch(event.target.value)}
              placeholder="Rechercher par identifiant ou sujet…" className="w-full rounded-xl border border-slate-200 bg-white py-3 pl-10 pr-4 text-sm outline-none ring-primary/20 focus:ring-4" />
          </div>
          <p className="mt-3 text-xs text-slate-500">
            {loading ? 'Recherche en cours…' : `${tickets.total.toLocaleString('fr-FR')} tickets disponibles`}
          </p>
        </div>
        <div className="max-h-[620px] overflow-auto">
          <div className="hidden grid-cols-[90px_1fr_220px_150px] gap-3 bg-slate-50 px-4 py-3 text-xs font-bold uppercase tracking-wide text-slate-500 md:grid">
            <span>Ticket</span><span>Sujet</span><span>Projet</span><span>Statut</span>
          </div>
          {!loading && tickets.items.length === 0 && (
            <p className="p-10 text-center text-sm text-slate-500">Aucun ticket ne correspond à votre recherche.</p>
          )}
          <div>
            {tickets.items.map(ticket => (
              <button key={ticket.id} onClick={() => selectTicket(ticket.id, ticket.subject)}
                className="grid w-full gap-2 border-t border-slate-100 px-4 py-4 text-left text-sm transition hover:bg-teal-50/50 md:grid-cols-[90px_1fr_220px_150px] md:gap-3">
                <span className="font-mono text-xs font-semibold text-primary">#{ticket.id}</span>
                <span className="font-medium text-slate-900">{ticket.subject}</span>
                <span className="text-slate-500">{ticket.project}</span>
                <span className="text-slate-600">{ticket.status}</span>
              </button>
            ))}
          </div>
        </div>
      </section>
      <AIChatPanel ticketSummary={aiContext} />
      <SimilarityResultsSheet results={results} referenceId={selectedId} referenceSubject={referenceSubject}
        isOpen={sheetOpen} onClose={() => setSheetOpen(false)} />
    </div>
  );
}
