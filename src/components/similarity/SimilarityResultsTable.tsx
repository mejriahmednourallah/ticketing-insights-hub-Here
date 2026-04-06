import { SimilarityResult } from '@/lib/similarity';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface Props {
  results: SimilarityResult[];
}

export default function SimilarityResultsTable({ results }: Props) {
  const top10 = results.slice(0, 10);

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <h3 className="text-sm font-semibold text-primary">Top 10 — Tickets les plus similaires</h3>
      <div className="overflow-auto rounded border">
        <Table>
          <TableHeader className="sticky top-0 bg-muted z-10">
            <TableRow>
              <TableHead className="w-10">#</TableHead>
              <TableHead className="w-[60px]">ID</TableHead>
              <TableHead>Sujet</TableHead>
              <TableHead>Projet</TableHead>
              <TableHead>Statut</TableHead>
              <TableHead className="text-center">Score</TableHead>
              <TableHead>Différences clés</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {top10.map((r, i) => {
              const isTop = i === 0;
              return (
                <TableRow key={`${r.idB}-${i}`} className={cn(isTop && 'bg-primary/15 font-semibold')}>
                  <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
                  <TableCell className="font-mono text-xs font-bold">{r.idB}</TableCell>
                  <TableCell className="text-xs max-w-[200px] truncate" title={r.subjectB}>{r.subjectB}</TableCell>
                  <TableCell className="text-xs">{r.differences.find(d => d.startsWith('Projet'))?.split('≠')[1]?.trim() || '—'}</TableCell>
                  <TableCell className="text-xs">{r.statusB}</TableCell>
                  <TableCell className="text-center">
                    <Badge variant={isTop ? 'default' : r.combinedScore >= 0.7 ? 'default' : r.combinedScore >= 0.4 ? 'secondary' : 'destructive'}>
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
            {top10.length === 0 && (
              <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">Aucun résultat</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
