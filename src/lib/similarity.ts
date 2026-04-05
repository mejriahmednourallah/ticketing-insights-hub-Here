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
  textSimilarity: number;   // 0-1 cosine
  numDistance: number;       // raw euclidean
  combinedScore: number;    // 0-1 blended
  differences: string[];
}

export function computeSimilarities(tickets: Ticket[]): SimilarityResult[] {
  if (tickets.length < 2) return [];

  // Build text corpus
  const textField = (t: Ticket) => `${t.subject} ${t.type} ${t.tracker} ${t.project}`;
  const tokenized = tickets.map(t => tokenize(textField(t)));
  const model = buildIdf(tokenized);
  const vectors = tokenized.map(tok => tfidfVector(tok, model));

  // Numerical vectors
  const numVecs = tickets.map(ticketNumerals);

  const results: SimilarityResult[] = [];
  const rawDists: number[] = [];

  // Pre-compute pairs
  const pairs: { i: number; j: number; textSim: number; dist: number }[] = [];
  for (let i = 0; i < tickets.length; i++) {
    for (let j = i + 1; j < tickets.length; j++) {
      const textSim = cosineSim(vectors[i], vectors[j]);
      const dist = euclideanDist(numVecs[i], numVecs[j]);
      rawDists.push(dist);
      pairs.push({ i, j, textSim, dist });
    }
  }

  const normDists = normalize01(rawDists);

  for (let idx = 0; idx < pairs.length; idx++) {
    const { i, j, textSim } = pairs[idx];
    const normDist = normDists[idx];
    const numSim = 1 - normDist;
    const combined = 0.7 * textSim + 0.3 * numSim;

    const diffs: string[] = [];
    const a = tickets[i], b = tickets[j];
    if (a.project !== b.project) diffs.push(`Projet: ${a.project} ≠ ${b.project}`);
    if (a.priority !== b.priority) diffs.push(`Priorité: ${a.priority} ≠ ${b.priority}`);
    if (a.status !== b.status) diffs.push(`Statut: ${a.status} ≠ ${b.status}`);
    if (a.team !== b.team) diffs.push(`Équipe: ${a.team} ≠ ${b.team}`);
    if (a.type !== b.type) diffs.push(`Type: ${a.type} ≠ ${b.type}`);

    results.push({
      idA: a.id, idB: b.id,
      subjectA: a.subject, subjectB: b.subject,
      textSimilarity: textSim,
      numDistance: pairs[idx].dist,
      combinedScore: combined,
      differences: diffs,
    });
  }

  results.sort((a, b) => b.combinedScore - a.combinedScore);
  return results;
}
