import { TicketSearchResponse } from '@/lib/analyticsApi';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export default function IssuesTable({ result, searchValue, onSearchChange, onPageChange }: {
  result: TicketSearchResponse;
  searchValue: string;
  onSearchChange: (value: string) => void;
  onPageChange: (page: number) => void;
}) {
  return (
    <div className="mt-6 space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">Liste des tickets</h2>
          <p className="text-xs text-slate-500">{result.total.toLocaleString('fr-FR')} tickets — page {result.page}/{result.totalPages || 1}</p>
        </div>
        <label className="w-full max-w-md">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Recherche</span>
          <Input
            value={searchValue}
            onChange={event => onSearchChange(event.target.value)}
            placeholder="Rechercher par ID, sujet, projet, équipe…"
            className="h-11 rounded-xl border-slate-200 bg-white"
          />
        </label>
      </div>
      <div className="max-h-[500px] overflow-auto rounded-2xl border border-slate-200 bg-white">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-slate-50">
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
                <TableCell className="text-xs">{ticket.type || 'Non renseigné'}</TableCell>
                <TableCell className="text-xs">{ticket.tracker}</TableCell>
                <TableCell className="text-xs">{ticket.source || 'Non renseigné'}</TableCell>
                <TableCell className="text-xs">{ticket.team || 'Non renseigné'}</TableCell>
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
