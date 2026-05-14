import { SimilarityResult, SIMILARITY_TOP_N } from '@/lib/similarity';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface Props {
  results: SimilarityResult[];
}

export default function SimilarityResultsTable({ results }: Props) {
  const top10 = results.slice(0, SIMILARITY_TOP_N);

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <h3 className="text-sm font-semibold text-primary">Top {SIMILARITY_TOP_N} — Tickets les plus similaires</h3>
      <div className="overflow-auto rounded border">
        <Table>
          <TableHeader className="sticky top-0 bg-muted z-10">
            <TableRow>
              <TableHead className="w-10">Rang</TableHead>
              <TableHead className="w-[60px]">ID</TableHead>
              <TableHead>Sujet</TableHead>
              <TableHead>Projet</TableHead>
              <TableHead>Statut</TableHead>
              <TableHead className="text-center">Score</TableHead>
              <TableHead className="text-center">Point</TableHead>
              <TableHead>Différences clés</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {top10.map((r) => {
              const isTop = r.rank === 1;
              const pct = Math.round(r.combinedScore * 100);
              return (
                <TableRow key={`${r.idB}-${r.rank}`} className={cn(isTop && 'bg-primary/15 font-semibold')}>
                  <TableCell className="text-xs text-muted-foreground font-mono">#{r.rank}</TableCell>
                  <TableCell className="font-mono text-xs font-bold">{r.idB}</TableCell>
                  <TableCell className="text-xs max-w-[200px] truncate" title={r.subjectB}>{r.subjectB}</TableCell>
                  <TableCell className="text-xs">{r.differences.find(d => d.startsWith('Projet'))?.split('≠')[1]?.trim() || '—'}</TableCell>
                  <TableCell className="text-xs">{r.statusB}</TableCell>
                  <TableCell className="text-center">
                    <Badge variant={isTop ? 'default' : r.combinedScore >= 0.7 ? 'default' : r.combinedScore >= 0.4 ? 'secondary' : 'destructive'}>
                      {pct}%
                    </Badge>
                  </TableCell>
                  <TableCell className="text-center">
                    <span className={cn(
                      'text-xs font-bold',
                      pct >= 75 ? 'text-green-600' : pct >= 50 ? 'text-amber-600' : 'text-red-600'
                    )}>
                      {pct} pts
                    </span>
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
              <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">Aucun résultat</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
