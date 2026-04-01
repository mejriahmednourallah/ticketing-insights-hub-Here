import { useState, useEffect, useMemo } from 'react';
import { parseCSV, Ticket, uniqueValues } from '@/lib/parseTickets';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';

const ALL = '__all__';

export default function IssuesTable() {
  const [allTickets, setAllTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [projet, setProjet] = useState(ALL);
  const [tracker, setTracker] = useState(ALL);
  const [statut, setStatut] = useState(ALL);
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetch('/data/issues.csv')
      .then(r => r.arrayBuffer())
      .then(buf => {
        const text = new TextDecoder('iso-8859-1').decode(buf);
        setAllTickets(parseCSV(text));
        setLoading(false);
      });
  }, []);

  const projets = useMemo(() => uniqueValues(allTickets, t => t.project), [allTickets]);
  const trackers = useMemo(() => uniqueValues(allTickets, t => t.tracker), [allTickets]);
  const statuts = useMemo(() => uniqueValues(allTickets, t => t.status), [allTickets]);

  const filtered = useMemo(() => {
    let list = allTickets;
    if (projet !== ALL) list = list.filter(t => t.project === projet);
    if (tracker !== ALL) list = list.filter(t => t.tracker === tracker);
    if (statut !== ALL) list = list.filter(t => t.status === statut);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(t =>
        t.id.toLowerCase().includes(q) ||
        t.subject.toLowerCase().includes(q) ||
        t.author.toLowerCase().includes(q) ||
        t.assignee.toLowerCase().includes(q)
      );
    }
    return list;
  }, [allTickets, projet, tracker, statut, search]);

  const resetFilters = () => {
    setProjet(ALL);
    setTracker(ALL);
    setStatut(ALL);
    setSearch('');
  };

  if (loading) return <div className="flex items-center justify-center min-h-screen bg-background"><p className="text-lg text-muted-foreground">Chargement…</p></div>;

  return (
    <div className="min-h-screen bg-background p-4 md:p-6 space-y-4">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold text-primary">Table des tickets</h1>
        <p className="text-sm text-muted-foreground">{filtered.length} tickets affichés / {allTickets.length} total</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Projet</label>
          <Select value={projet} onValueChange={setProjet}>
            <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Tout</SelectItem>
              {projets.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Tracker</label>
          <Select value={tracker} onValueChange={setTracker}>
            <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Tout</SelectItem>
              {trackers.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Statut</label>
          <Select value={statut} onValueChange={setStatut}>
            <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Tout</SelectItem>
              {statuts.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Recherche</label>
          <Input placeholder="ID, sujet, auteur…" value={search} onChange={e => setSearch(e.target.value)} className="w-[200px]" />
        </div>
        <Button variant="outline" size="sm" onClick={resetFilters}>Réinitialiser</Button>
      </div>

      {/* Table */}
      <ScrollArea className="rounded-lg border bg-card h-[calc(100vh-260px)]">
        <Table>
          <TableHeader className="sticky top-0 bg-muted z-10">
            <TableRow>
              <TableHead className="w-[60px]">ID</TableHead>
              <TableHead>Projet</TableHead>
              <TableHead>Sujet</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Tracker</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Équipe</TableHead>
              <TableHead>Auteur</TableHead>
              <TableHead>Assigné à</TableHead>
              <TableHead>Statut</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((t, i) => (
              <TableRow key={t.id || i}>
                <TableCell className="font-mono text-xs">{t.id}</TableCell>
                <TableCell className="text-xs">{t.project}</TableCell>
                <TableCell className="text-xs max-w-[250px] truncate" title={t.subject}>{t.subject}</TableCell>
                <TableCell className="text-xs">{t.type}</TableCell>
                <TableCell className="text-xs">{t.tracker}</TableCell>
                <TableCell className="text-xs">{t.source}</TableCell>
                <TableCell className="text-xs">{t.team}</TableCell>
                <TableCell className="text-xs">{t.author}</TableCell>
                <TableCell className="text-xs">{t.assignee}</TableCell>
                <TableCell className="text-xs">{t.status}</TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && (
              <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-8">Aucun ticket trouvé</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </ScrollArea>
    </div>
  );
}
