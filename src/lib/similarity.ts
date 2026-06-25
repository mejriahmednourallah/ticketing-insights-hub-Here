import { Ticket, getResolutionHoursClosed } from './parseTickets';

// ── TF-IDF helpers ──

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9àâéèêëïîôùûüç]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(w => w.length > 1);
}

interface TfIdfModel {
  idf: Map<string, number>;
  docCount: number;
}

function buildIdf(docs: string[][]): TfIdfModel {
  const df = new Map<string, number>();
  for (const tokens of docs) {
    const seen = new Set(tokens);
    for (const t of seen) df.set(t, (df.get(t) || 0) + 1);
  }
  const idf = new Map<string, number>();
  const n = docs.length;
  for (const [term, count] of df) {
    idf.set(term, Math.log((n + 1) / (count + 1)) + 1);
  }
  return { idf, docCount: n };
}

function tfidfVector(tokens: string[], model: TfIdfModel): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
  const vec = new Map<string, number>();
  for (const [term, count] of tf) {
    const idfVal = model.idf.get(term) || 0;
    vec.set(term, count * idfVal);
  }
  return vec;
}

function cosineSim(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0, magA = 0, magB = 0;
  for (const [k, v] of a) {
    magA += v * v;
    const bv = b.get(k);
    if (bv !== undefined) dot += v * bv;
  }
  for (const [, v] of b) magB += v * v;
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

// ── Numerical distance ──

function ticketNumerals(t: Ticket): number[] {
  const hours = getResolutionHoursClosed(t);
  return [
    t.year ?? 0,
    t.month ?? 0,
    hours ?? 0,
  ];
}

function euclideanDist(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = (a[i] || 0) - (b[i] || 0);
    sum += d * d;
  }
  return Math.sqrt(sum);
}

function normalize01(values: number[]): number[] {
  const max = Math.max(...values, 1);
  return values.map(v => v / max);
}

// ── Public API ──

export interface SimilarityResult {
  idA: string;
  idB: string;
  subjectA: string;
  subjectB: string;
  statusB: string;
  textSimilarity: number;
  numDistance: number;
  combinedScore: number;
  similarities?: string[];
  differences: string[];
  rank: number;
}

/** Default number of top similar tickets shown across the similarity page. */
export const SIMILARITY_TOP_N = 10;

/** Inspect the first N results and count how many meet or exceed the threshold. */
export function countSimilarAboveThreshold(results: SimilarityResult[], topN: number, threshold: number): number {
  return results.slice(0, topN).filter(r => r.combinedScore >= threshold).length;
}

// ── Pre-computed similarity index (avoids O(N²) per click) ──

export interface SimilarityCache {
  tickets: Ticket[];
  tokenized: string[][];
  model: TfIdfModel;
  vectors: Map<string, number>[];
  numerals: number[][];
  clientCms: Map<string, string>;
}

function samePopulated(left: string | undefined, right: string | undefined) {
  return Boolean(left && right && left === right);
}

function dominantClientCms(tickets: Ticket[]): Map<string, string> {
  const counts = new Map<string, Map<string, number>>();
  for (const ticket of tickets) {
    if (!ticket.project || !ticket.technology) continue;
    const projectCounts = counts.get(ticket.project) ?? new Map<string, number>();
    projectCounts.set(ticket.technology, (projectCounts.get(ticket.technology) ?? 0) + 1);
    counts.set(ticket.project, projectCounts);
  }
  const output = new Map<string, string>();
  for (const [project, projectCounts] of counts) {
    const [cms] = [...projectCounts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0] ?? [];
    if (cms) output.set(project, cms);
  }
  return output;
}

function resolvedCms(ticket: Ticket, clientCms: Map<string, string>) {
  return clientCms.get(ticket.project) || ticket.technology || '';
}

const textField = (t: Ticket, clientCms: Map<string, string>) =>
  `${t.subject} ${t.description ?? ''} ${t.project} ${resolvedCms(t, clientCms)}`;

/** Pre-compute tokenized texts, IDF model, TF-IDF vectors and numerical vectors once. */
export function buildSimilarityCache(tickets: Ticket[]): SimilarityCache {
  const clientCms = dominantClientCms(tickets);
  const tokenized = tickets.map(t => tokenize(textField(t, clientCms)));
  const model = buildIdf(tokenized);
  const vectors = tokenized.map(tok => tfidfVector(tok, model));
  const numerals = tickets.map(ticketNumerals);
  return { tickets, tokenized, model, vectors, numerals, clientCms };
}

/** Query similarity using a pre-built cache. Much faster than computeSimilaritiesForTicket. */
export function querySimilarity(
  cache: SimilarityCache,
  reference: Ticket,
): SimilarityResult[] {
  const { tickets, vectors, numerals, clientCms } = cache;
  if (tickets.length === 0) return [];

  const refTokens = tokenize(textField(reference, clientCms));
  const refVec = tfidfVector(refTokens, cache.model);
  const refNum = ticketNumerals(reference);
  const referenceCms = resolvedCms(reference, clientCms);

  const rawDists: number[] = [];
  const pairs: { idx: number; textSim: number; dist: number; ticket: Ticket }[] = [];

  for (let i = 0; i < tickets.length; i++) {
    if (tickets[i].id === reference.id) continue;
    const textSim = cosineSim(refVec, vectors[i]);
    const dist = euclideanDist(refNum, numerals[i]);
    rawDists.push(dist);
    pairs.push({ idx: i, textSim, dist, ticket: tickets[i] });
  }

  const normDists = normalize01(rawDists);

  const results: SimilarityResult[] = pairs.map((p, i) => {
    const b = p.ticket;
    const numSim = 1 - normDists[i];
    const structuredBoost =
      (samePopulated(reference.project, b.project) ? 0.08 : 0)
      + (samePopulated(referenceCms, resolvedCms(b, clientCms)) ? 0.07 : 0);
    const combined = Math.min(1, 0.72 * p.textSim + 0.13 * numSim + structuredBoost);

    const similarities: string[] = [];
    if (samePopulated(reference.project, b.project)) similarities.push(`Client: même client - ${reference.project}`);
    similarities.push(`Sujet: similarité texte sujet/description ${Math.round(p.textSim * 100)}%`);
    if (samePopulated(reference.project, b.project)) {
      const cms = clientCms.get(reference.project);
      if (cms) similarities.push(`CMS: CMS client - ${cms}`);
    } else if (samePopulated(referenceCms, resolvedCms(b, clientCms))) {
      similarities.push(`CMS: même CMS - ${referenceCms}`);
    }

    return {
      idA: reference.id,
      idB: b.id,
      subjectA: reference.subject,
      subjectB: b.subject,
      statusB: b.status,
      textSimilarity: p.textSim,
      numDistance: p.dist,
      combinedScore: combined,
      similarities,
      differences: [],
      rank: 0, // assigned after sort
    };
  });

  results.sort((a, b) => b.combinedScore - a.combinedScore);
  for (let i = 0; i < results.length; i++) {
    results[i].rank = i + 1;
  }
  return results;
}

/** Compare one reference ticket against all others. Returns sorted by combinedScore desc. */
export function computeSimilaritiesForTicket(
  reference: Ticket,
  others: Ticket[],
): SimilarityResult[] {
  if (others.length === 0) return [];

  const cache = buildSimilarityCache([reference, ...others]);
  return querySimilarity(cache, reference);
}

/** Compute full NxN similarity matrix for a set of tickets (capped for perf). */
export function computeHeatmapMatrix(tickets: Ticket[]): { ids: string[]; matrix: number[][] } {
  const CAP = 30;
  const subset = tickets.slice(0, CAP);
  const n = subset.length;
  if (n < 2) return { ids: subset.map(t => t.id), matrix: subset.map(() => [1]) };

  const clientCms = dominantClientCms(subset);
  const tokenized = subset.map(t => tokenize(textField(t, clientCms)));
  const model = buildIdf(tokenized);
  const vectors = tokenized.map(tok => tfidfVector(tok, model));
  const numVecs = subset.map(ticketNumerals);

  // Pre-compute all pairwise distances for normalization
  const allDists: number[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      allDists.push(euclideanDist(numVecs[i], numVecs[j]));
    }
  }
  const normAllDists = normalize01(allDists);

  const matrix: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
  let distIdx = 0;
  for (let i = 0; i < n; i++) {
    matrix[i][i] = 1;
    for (let j = i + 1; j < n; j++) {
      const textSim = cosineSim(vectors[i], vectors[j]);
      const numSim = 1 - normAllDists[distIdx++];
      const combined = 0.7 * textSim + 0.3 * numSim;
      matrix[i][j] = combined;
      matrix[j][i] = combined;
    }
  }

  return { ids: subset.map(t => t.id), matrix };
}
