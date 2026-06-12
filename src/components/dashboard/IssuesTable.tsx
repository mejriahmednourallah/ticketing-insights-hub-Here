import { TicketSearchResponse } from '@/lib/analyticsApi';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { Button } from '@/components/ui/button';

export default function IssuesTable({ result, onPageChange }: {
  result: TicketSearchResponse;
  onPageChange: (page: number) => void;
}) {
  return (
    <div className="mt-6 space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-primary">Liste des tickets</h2>
        <p className="text-xs text-muted-foreground">{result.total} tickets — page {result.page}/{result.totalPages || 1}</p>
      </div>
      <div className="rounded-lg border bg-card overflow-auto max-h-[500px]">
        <Table>
          <TableHeader className="sticky top-0 bg-muted z-10">
            <TableRow>
              {['ID', 'Projet', 'Sujet', 'Type', 'Tracker', 'Source', 'Équipe', 'Auteur', 'Assigné à', 'Statut'].map(label => <TableHead key={label}>{label}</TableHead>)}
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.items.map(ticket => (
              <TableRow key={ticket.id}>
                <TableCell className="font-mono text-xs">{ticket.id}</TableCell>
                <TableCell className="text-xs">{ticket.project}</TableCell>
                <TableCell className="text-xs max-w-[250px] truncate" title={ticket.subject}>{ticket.subject}</TableCell>
                <TableCell className="text-xs">{ticket.type || 'Not provided'}</TableCell>
                <TableCell className="text-xs">{ticket.tracker}</TableCell>
                <TableCell className="text-xs">{ticket.source || 'Not provided'}</TableCell>
                <TableCell className="text-xs">{ticket.team || 'Not provided'}</TableCell>
                <TableCell className="text-xs">{ticket.author}</TableCell>
                <TableCell className="text-xs">{ticket.assignee}</TableCell>
                <TableCell className="text-xs font-medium">{ticket.status}</TableCell>
              </TableRow>
            ))}
            {!result.items.length && <TableRow><TableCell colSpan={10} className="text-center py-8">Aucun ticket trouvé</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
      {result.totalPages > 1 && (
        <div className="flex justify-center gap-2">
          <Button variant="outline" size="sm" disabled={result.page <= 1} onClick={() => onPageChange(result.page - 1)}>← Précédent</Button>
          <Button variant="outline" size="sm" disabled={result.page >= result.totalPages} onClick={() => onPageChange(result.page + 1)}>Suivant →</Button>
        </div>
      )}
    </div>
  );
}
