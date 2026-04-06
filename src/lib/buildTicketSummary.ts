import { Ticket, countBy, getResolutionHoursClosed } from './parseTickets';
import { Filters } from './dashboardFilters';
import { SimilarityResult } from './similarity';

/** Build a concise text summary of current dashboard state for the AI context */
export function buildTicketSummary(
  tickets: Ticket[],
  allTickets: Ticket[],
  filters: Filters,
  similarityData?: { referenceId: string; results: SimilarityResult[] }
): string {
  const lines: string[] = [];
  
  lines.push(`## Résumé du dataset`);
  lines.push(`- Total tickets: ${allTickets.length}`);
  lines.push(`- Tickets filtrés: ${tickets.length}`);
  
  // Active filters
  const activeFilters = Object.entries(filters).filter(([, v]) => v !== '');
  if (activeFilters.length > 0) {
    lines.push(`- Filtres actifs: ${activeFilters.map(([k, v]) => `${k}=${v}`).join(', ')}`);
  }

  // KPIs
  const open = tickets.filter(t => t.status === 'Ouvert').length;
  const closed = tickets.filter(t => t.status === 'Fermé').length;
  const resolved = tickets.filter(t => t.status === 'Résolu').length;
  const urgent = tickets.filter(t => t.priority === 'Urgent' || t.priority === 'Immédiate').length;
  
  lines.push(`\n## KPIs`);
  lines.push(`- Ouverts: ${open}`);
  lines.push(`- Fermés: ${closed}`);
  lines.push(`- Résolus: ${resolved}`);
  lines.push(`- Urgents/Immédiats: ${urgent}`);

  // Resolution time
  const closedHours = tickets.map(getResolutionHoursClosed).filter((h): h is number => h !== null && h >= 0);
  if (closedHours.length > 0) {
    const avg = Math.round(closedHours.reduce((a, b) => a + b, 0) / closedHours.length);
    lines.push(`- Temps moyen de clôture: ${avg}h`);
  }

  // Top breakdowns (keep concise)
  const byProject = countBy(tickets, t => t.project);
  const topProjects = Object.entries(byProject).sort((a, b) => b[1] - a[1]).slice(0, 10);
  lines.push(`\n## Top projets`);
  topProjects.forEach(([name, count]) => lines.push(`- ${name}: ${count}`));

  const byStatus = countBy(tickets, t => t.status);
  lines.push(`\n## Par statut`);
  Object.entries(byStatus).forEach(([name, count]) => lines.push(`- ${name}: ${count}`));

  const byPriority = countBy(tickets, t => t.priority);
  lines.push(`\n## Par priorité`);
  Object.entries(byPriority).forEach(([name, count]) => lines.push(`- ${name}: ${count}`));

  const byTeam = countBy(tickets, t => t.team);
  lines.push(`\n## Par équipe`);
  Object.entries(byTeam).sort((a, b) => b[1] - a[1]).slice(0, 10).forEach(([name, count]) => lines.push(`- ${name}: ${count}`));

  const byType = countBy(tickets, t => t.type);
  lines.push(`\n## Par type`);
  Object.entries(byType).forEach(([name, count]) => lines.push(`- ${name}: ${count}`));

  const byTracker = countBy(tickets, t => t.tracker);
  lines.push(`\n## Par tracker`);
  Object.entries(byTracker).forEach(([name, count]) => lines.push(`- ${name}: ${count}`));

  const bySource = countBy(tickets, t => t.source);
  lines.push(`\n## Par source`);
  Object.entries(bySource).forEach(([name, count]) => lines.push(`- ${name}: ${count}`));

  // Reopened
  const reopened = tickets.filter(t => t.reopened?.toLowerCase() === 'oui' || t.reopened?.toLowerCase() === 'yes').length;
  lines.push(`\n- Tickets réouverts: ${reopened}`);

  // Similarity data
  if (similarityData && similarityData.results.length > 0) {
    lines.push(`\n## Analyse de similarité`);
    lines.push(`- Ticket de référence: #${similarityData.referenceId}`);
    const top10 = similarityData.results.slice(0, 10);
    lines.push(`- Top 10 tickets similaires:`);
    top10.forEach((r, i) => {
      lines.push(`  ${i + 1}. #${r.idB} — Score: ${Math.round(r.combinedScore * 100)}% — "${r.subjectB}" — Statut: ${r.statusB}`);
      if (r.differences.length > 0) {
        lines.push(`     Différences: ${r.differences.join(', ')}`);
      }
    });
    const avgScore = top10.reduce((sum, r) => sum + r.combinedScore, 0) / top10.length;
    lines.push(`- Score moyen top 10: ${Math.round(avgScore * 100)}%`);
  }

  // Sample ticket IDs for context
  lines.push(`\n## Échantillon d'IDs de tickets: ${tickets.slice(0, 20).map(t => '#' + t.id).join(', ')}`);

  return lines.join('\n');
}
