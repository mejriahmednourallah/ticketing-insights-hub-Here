import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
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

  useEffect(() => { loadFilterOptions().then(setOptions); }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      Promise.all([searchTickets(filters, 1, 100, search), loadAiContext(filters)])
        .then(([ticketData, context]) => {
          setTickets(ticketData);
          setAiContext(context);
        });
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
    <div className="min-h-screen bg-background p-4 md:p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-primary">Analyse de Similarité DuckDB</h1>
          <p className="text-xs text-muted-foreground">{tickets.total} tickets candidats, chargés par page</p>
        </div>
        <div className="flex gap-2"><Link to="/">← Dashboard</Link><Button variant="outline" size="sm" onClick={reset}>Réinitialiser</Button></div>
      </div>
      <div className="flex gap-4">
        <div className="w-64 min-w-[240px] hidden lg:block"><DashboardFilters options={options} filters={filters} onChange={setFilters} /></div>
        <div className="flex-1">
          <input value={search} onChange={event => setSearch(event.target.value)}
            placeholder="Rechercher par ID ou sujet..." className="w-full rounded border px-3 py-2 mb-3 bg-card" />
          <div className="rounded border bg-card max-h-[600px] overflow-auto">
            {tickets.items.map(ticket => (
              <button key={ticket.id} onClick={() => selectTicket(ticket.id, ticket.subject)}
                className="w-full grid grid-cols-[80px_1fr_180px_120px] gap-2 text-left text-xs px-3 py-2 border-b hover:bg-muted">
                <span className="font-mono">#{ticket.id}</span><span>{ticket.subject}</span><span>{ticket.project}</span><span>{ticket.status}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
      <AIChatPanel ticketSummary={aiContext} />
      <SimilarityResultsSheet results={results} referenceId={selectedId} referenceSubject={referenceSubject}
        isOpen={sheetOpen} onClose={() => setSheetOpen(false)} />
    </div>
  );
}
