import { useState, useMemo } from 'react';
import { Ticket } from '@/lib/parseTickets';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const PAGE_SIZE = 50;

interface Props {
  tickets: Ticket[];
}

export default function IssuesTable({ tickets }: Props) {
  const [page, setPage] = useState(0);

  const totalPages = Math.ceil(tickets.length / PAGE_SIZE);
  const visible = useMemo(() => tickets.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [tickets, page]);

  // Reset page when tickets change
  useMemo(() => { if (page > 0 && page >= totalPages) setPage(0); }, [tickets.length]);

  return (
    <div className="mt-6 space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-primary">Liste des tickets</h2>
        <p className="text-xs text-muted-foreground">{tickets.length} tickets — page {page + 1}/{totalPages || 1}</p>
      </div>
      <div className="rounded-lg border bg-card overflow-auto max-h-[500px]">
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
            {visible.map((t, i) => (
              <TableRow
                key={`${t.id}-${i}`}
                className={cn(t.status === 'Ouvert' && 'bg-destructive/10 hover:bg-destructive/20')}
              >
                <TableCell className="font-mono text-xs">{t.id}</TableCell>
                <TableCell className="text-xs">{t.project}</TableCell>
                <TableCell className="text-xs max-w-[250px] truncate" title={t.subject}>{t.subject}</TableCell>
                <TableCell className="text-xs">{t.type}</TableCell>
                <TableCell className="text-xs">{t.tracker}</TableCell>
                <TableCell className="text-xs">{t.source}</TableCell>
                <TableCell className="text-xs">{t.team}</TableCell>
                <TableCell className="text-xs">{t.author}</TableCell>
                <TableCell className="text-xs">{t.assignee}</TableCell>
                <TableCell className="text-xs font-medium">{t.status}</TableCell>
              </TableRow>
            ))}
            {visible.length === 0 && (
              <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-8">Aucun ticket trouvé</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-1">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>← Précédent</Button>
          <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>Suivant →</Button>
        </div>
      )}
    </div>
  );
}
