import { SimilarityResult, countSimilarAboveThreshold, SIMILARITY_TOP_N } from '@/lib/similarity';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface Props {
  results: SimilarityResult[];
  referenceId: string;
}

/** Threshold above which a ticket is considered "similar". */
const SIMILAR_THRESHOLD = 0.75;

export default function SimilarityKPI({ results, referenceId }: Props) {
  const top10 = results.slice(0, SIMILARITY_TOP_N);
  const top = top10[0];
  const avgScore = top10.length > 0
    ? top10.reduce((sum, r) => sum + r.combinedScore, 0) / top10.length
    : 0;
  const similarCount = countSimilarAboveThreshold(results, SIMILARITY_TOP_N, SIMILAR_THRESHOLD);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
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
            <p className="text-sm font-semibold text-accent-foreground mt-1">{Math.round(top.combinedScore * 100)}%</p>
          </>
        ) : (
          <p className="text-lg text-muted-foreground">—</p>
        )}
      </div>
      <div className="rounded-lg border bg-card p-4">
        <p className="text-xs text-muted-foreground mb-1">Score moyen (top {SIMILARITY_TOP_N})</p>
        <p className="text-2xl font-bold text-accent-foreground">
          {top10.length > 0 ? `${Math.round(avgScore * 100)}%` : '—'}
        </p>
      </div>
      <div className="rounded-lg border bg-card p-4">
        <div className="flex items-center gap-1.5 mb-1">
          <p className="text-xs text-muted-foreground">Tickets similaires</p>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-blue-500 text-white text-[10px] font-bold cursor-help">?</span>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-[200px] text-xs">
              Nombre de tickets parmi le top {SIMILARITY_TOP_N} avec un score {'>='} {Math.round(SIMILAR_THRESHOLD * 100)}%
            </TooltipContent>
          </Tooltip>
        </div>
        <p className="text-2xl font-bold text-primary">
          {similarCount} / {Math.min(results.length, SIMILARITY_TOP_N)}
        </p>
        <p className="text-xs text-muted-foreground mt-1">≥ {Math.round(SIMILAR_THRESHOLD * 100)}% similaires</p>
      </div>
    </div>
  );
}
