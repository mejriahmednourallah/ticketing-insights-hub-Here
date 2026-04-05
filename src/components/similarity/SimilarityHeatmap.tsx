import { useMemo } from 'react';
import { Ticket } from '@/lib/parseTickets';
import { computeHeatmapMatrix } from '@/lib/similarity';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface Props {
  tickets: Ticket[];
}

function scoreColor(score: number): string {
  if (score >= 0.8) return 'hsl(145, 60%, 35%)';
  if (score >= 0.6) return 'hsl(145, 50%, 50%)';
  if (score >= 0.4) return 'hsl(45, 80%, 55%)';
  if (score >= 0.2) return 'hsl(20, 70%, 55%)';
  return 'hsl(0, 60%, 60%)';
}

export default function SimilarityHeatmap({ tickets }: Props) {
  const { ids, matrix } = useMemo(() => computeHeatmapMatrix(tickets), [tickets]);
  const n = ids.length;

  if (n < 2) {
    return (
      <div className="rounded-lg border bg-card p-4 text-center text-muted-foreground text-sm">
        Pas assez de tickets pour la heatmap.
      </div>
    );
  }

  const cellSize = Math.max(16, Math.min(32, 600 / n));

  return (
    <div className="rounded-lg border bg-card p-4 space-y-2">
      <h3 className="text-sm font-semibold text-primary">Heatmap de similarité (top {n})</h3>
      <p className="text-xs text-muted-foreground">Survolez une cellule pour voir le score.</p>
      <div className="overflow-auto max-w-full">
        <div className="inline-block">
          {/* Header row */}
          <div className="flex" style={{ marginLeft: cellSize + 4 }}>
            {ids.map(id => (
              <div key={id} className="text-[9px] text-muted-foreground font-mono text-center overflow-hidden" style={{ width: cellSize, minWidth: cellSize }}>
                {id}
              </div>
            ))}
          </div>
          {/* Grid */}
          {matrix.map((row, i) => (
            <div key={ids[i]} className="flex items-center">
              <div className="text-[9px] text-muted-foreground font-mono text-right pr-1 overflow-hidden" style={{ width: cellSize + 4, minWidth: cellSize + 4 }}>
                {ids[i]}
              </div>
              {row.map((score, j) => (
                <Tooltip key={j}>
                  <TooltipTrigger asChild>
                    <div
                      className="border border-background/30 cursor-default"
                      style={{
                        width: cellSize,
                        height: cellSize,
                        minWidth: cellSize,
                        backgroundColor: i === j ? 'hsl(var(--muted))' : scoreColor(score),
                      }}
                    />
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs">
                    #{ids[i]} ↔ #{ids[j]}: {Math.round(score * 100)}%
                  </TooltipContent>
                </Tooltip>
              ))}
            </div>
          ))}
          {/* Legend */}
          <div className="flex items-center gap-2 mt-2 text-[10px] text-muted-foreground">
            <span>0%</span>
            <div className="flex">
              {[0, 0.2, 0.4, 0.6, 0.8].map(v => (
                <div key={v} style={{ width: 24, height: 12, backgroundColor: scoreColor(v) }} />
              ))}
            </div>
            <span>100%</span>
          </div>
        </div>
      </div>
    </div>
  );
}
