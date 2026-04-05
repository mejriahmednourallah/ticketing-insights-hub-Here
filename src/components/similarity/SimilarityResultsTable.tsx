import { useState } from 'react';
import { SimilarityResult } from '@/lib/similarity';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface Props {
  results: SimilarityResult[];
}

const PAGE_SIZE = 30;

export default function SimilarityResultsTable({ results }: Props) {
  const [page, setPage] = useState(0);
  const totalPages = Math.ceil(results.length / PAGE_SIZE);
  const visible = results.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  // Reset page if out of bounds
  if (page > 0 && page >= totalPages && totalPages > 0) {
    setPage(0);
  }

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-primary">Résultats classés</h3>
        <p className="text-xs text-muted-foreground">{results.length} résultats — page {page + 1}/{totalPages || 1}</p>
      </div>
      <div className="overflow-auto max-h-[450px] rounded border">
        <Table>
          <TableHeader className="sticky top-0 bg-muted z-10">
            <TableRow>
              <TableHead className="w-10">#</TableHead>
              <TableHead className="w-[60px]">ID</TableHead>
              <TableHead>Sujet</TableHead>
              <TableHead>Statut</TableHead>
              <TableHead className="text-center">Score</TableHead>
              <TableHead>Différences clés</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((r, i) => {
              const rank = page * PAGE_SIZE + i;
              const isTop5 = rank < 5;
              return (
                <TableRow key={`${r.idB}-${i}`} className={cn(isTop5 && 'bg-primary/10 font-medium')}>
                  <TableCell className="text-xs text-muted-foreground">{rank + 1}</TableCell>
                  <TableCell className="font-mono text-xs font-bold">{r.idB}</TableCell>
                  <TableCell className="text-xs max-w-[220px] truncate" title={r.subjectB}>{r.subjectB}</TableCell>
                  <TableCell className="text-xs">{r.statusB}</TableCell>
                  <TableCell className="text-center">
                    <Badge variant={r.combinedScore >= 0.7 ? 'default' : r.combinedScore >= 0.4 ? 'secondary' : 'destructive'}>
                      {Math.round(r.combinedScore * 100)}%
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs max-w-[220px]">
                    {r.differences.length === 0
                      ? <span className="text-muted-foreground italic">Identiques</span>
                      : r.differences.slice(0, 3).map((d, j) => <div key={j}>{d}</div>)
                    }
                  </TableCell>
                </TableRow>
              );
            })}
            {visible.length === 0 && (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Aucun résultat</TableCell></TableRow>
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
