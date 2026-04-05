import { SimilarityResult } from '@/lib/similarity';

interface Props {
  results: SimilarityResult[];
  referenceId: string;
}

export default function SimilarityKPI({ results, referenceId }: Props) {
  const top = results[0];
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <div className="rounded-lg border bg-card p-4">
        <p className="text-xs text-muted-foreground mb-1">Ticket de référence</p>
        <p className="text-2xl font-bold text-primary">#{referenceId}</p>
      </div>
      <div className="rounded-lg border bg-card p-4">
        <p className="text-xs text-muted-foreground mb-1">Ticket le plus similaire</p>
        {top ? (
          <>
            <p className="text-2xl font-bold text-primary">#{top.idB}</p>
            <p className="text-xs text-muted-foreground truncate" title={top.subjectB}>{top.subjectB}</p>
          </>
        ) : (
          <p className="text-lg text-muted-foreground">—</p>
        )}
      </div>
      <div className="rounded-lg border bg-card p-4">
        <p className="text-xs text-muted-foreground mb-1">Score de similarité max</p>
        <p className="text-2xl font-bold text-accent-foreground">
          {top ? `${Math.round(top.combinedScore * 100)}%` : '—'}
        </p>
      </div>
    </div>
  );
}
