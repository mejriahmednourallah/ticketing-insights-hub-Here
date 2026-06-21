import { useMemo } from 'react';
import { SimilarityResult, SIMILARITY_TOP_N } from '@/lib/similarity';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { X, ChevronRight, ExternalLink } from 'lucide-react';

interface Props {
  results: SimilarityResult[];
  referenceId: string;
  referenceSubject: string;
  isOpen: boolean;
  onClose: () => void;
}

const REDMINE_BASE_URL = (
  import.meta.env.VITE_REDMINE_BASE_URL
  || 'https://maintenance.medianet.tn'
).replace(/\/$/, '');

function redmineIssueUrl(ticketId: string | number) {
  return `${REDMINE_BASE_URL}/issues/${encodeURIComponent(String(ticketId))}`;
}

function scoreBadge(pct: number) {
  if (pct >= 75) return { variant: 'default' as const, label: 'Fort' };
  if (pct >= 50) return { variant: 'secondary' as const, label: 'Moyen' };
  if (pct >= 25) return { variant: 'outline' as const, label: 'Faible' };
  return { variant: 'destructive' as const, label: 'Très faible' };
}

export default function SimilarityResultsSheet({
  results,
  referenceId,
  referenceSubject,
  isOpen,
  onClose,
}: Props) {
  const visible = results.slice(0, SIMILARITY_TOP_N);
  const top = visible[0];
  const avgScore = visible.length > 0
    ? visible.reduce((sum, r) => sum + r.combinedScore, 0) / visible.length
    : 0;

  return (
    <>
      {/* Overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 transition-opacity"
          onClick={onClose}
        />
      )}

      {/* Sheet panel */}
      <div
        className={cn(
          'fixed top-0 right-0 z-50 h-full w-full max-w-[520px] bg-background border-l shadow-2xl transform transition-transform duration-300 ease-in-out flex flex-col',
          isOpen ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b bg-muted/30 shrink-0">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Ticket de référence</p>
            <a
              href={redmineIssueUrl(referenceId)}
              target="_blank"
              rel="noreferrer"
              className="block truncate text-sm font-bold text-primary underline-offset-4 hover:underline"
            >
              #{referenceId} — {referenceSubject}
            </a>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="shrink-0">
            <X className="h-5 w-5" />
          </Button>
        </div>

        {/* KPI cards */}
        <div className="grid grid-cols-2 gap-3 px-4 py-3 border-b shrink-0">
          <div className="rounded-lg border bg-card p-3">
            <p className="text-[10px] text-muted-foreground">Plus similaire</p>
            {top ? (
              <>
                <a
                  href={redmineIssueUrl(top.idB)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-lg font-bold text-primary underline-offset-4 hover:underline"
                >
                  #{top.idB}
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
                <p className="text-xs text-muted-foreground truncate">{top.subjectB}</p>
                <p className="text-xs font-semibold mt-1">{Math.round(top.combinedScore * 100)}%</p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">—</p>
            )}
          </div>
          <div className="rounded-lg border bg-card p-3">
            <p className="text-[10px] text-muted-foreground">Score moyen</p>
            <p className="text-lg font-bold">{Math.round(avgScore * 100)}%</p>
          </div>
        </div>

        {/* Accordion list */}
        <div className="flex-1 overflow-y-auto">
          {visible.length === 0 ? (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
              Aucun résultat de similarité.
            </div>
          ) : (
            <Accordion type="multiple" className="divide-y">
              {visible.map((r) => {
                const pct = Math.round(r.combinedScore * 100);
                const badge = scoreBadge(pct);

                return (
                  <AccordionItem key={`${r.idB}-${r.rank}`} value={r.idB} className="border-0">
                    <AccordionTrigger className="px-5 py-3 hover:bg-muted/30 hover:no-underline [&[data-state=open]]:bg-muted/20">
                      <div className="flex items-center gap-3 w-full text-left min-w-0">
                        {/* Rank */}
                        <span className="text-xs font-mono text-muted-foreground w-8 shrink-0">
                          #{r.rank}
                        </span>

                        {/* ID */}
                        <span className="text-sm font-mono font-bold text-primary w-[70px] shrink-0">
                          #{r.idB}
                        </span>

                        {/* Subject */}
                        <span className="text-sm truncate flex-1 min-w-0">
                          {r.subjectB}
                        </span>

                        {/* Score badge */}
                        <Badge variant={badge.variant} className="shrink-0 text-xs">
                          {pct}%
                        </Badge>

                        {/* Status */}
                        <span className="text-xs text-muted-foreground shrink-0 w-20 truncate text-right">
                          {r.statusB || '—'}
                        </span>
                      </div>
                    </AccordionTrigger>

                    <AccordionContent className="px-5 pb-4 pt-0">
                      <div className="grid grid-cols-2 gap-3 mt-2 text-xs">
                        <div>
                          <p className="font-medium text-muted-foreground mb-0.5">Sujet complet</p>
                          <p>{r.subjectB}</p>
                        </div>
                        <div>
                          <p className="font-medium text-muted-foreground mb-0.5">Statut</p>
                          <p>{r.statusB || '—'}</p>
                        </div>
                        <div>
                          <p className="font-medium text-muted-foreground mb-0.5">Score de similarité</p>
                          <p className="font-bold">{pct}%</p>
                        </div>
                        <div>
                          <p className="font-medium text-muted-foreground mb-0.5">Rang</p>
                          <p>#{r.rank}</p>
                        </div>
                      </div>
                      <a
                        href={redmineIssueUrl(r.idB)}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-primary/20 px-3 py-2 text-xs font-semibold text-primary transition hover:bg-primary/5"
                      >
                        Ouvrir le ticket dans Redmine
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>

                      {/* Differences */}
                      {r.differences.length > 0 && (
                        <div className="mt-3 pt-3 border-t">
                          <p className="text-xs font-medium text-muted-foreground mb-1.5">Différences</p>
                          <ul className="space-y-1">
                            {r.differences.map((d, i) => (
                              <li key={i} className="text-xs flex items-start gap-1.5">
                                <ChevronRight className="h-3 w-3 mt-0.5 text-muted-foreground shrink-0" />
                                <span>{d}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {r.differences.length === 0 && (
                        <div className="mt-3 pt-3 border-t">
                          <p className="text-xs italic text-muted-foreground">Aucune différence notable.</p>
                        </div>
                      )}
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
            </Accordion>
          )}
        </div>
      </div>
    </>
  );
}
