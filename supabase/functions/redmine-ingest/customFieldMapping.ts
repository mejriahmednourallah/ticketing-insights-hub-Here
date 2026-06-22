export type RedmineCustomField = {
  id?: number;
  name?: string;
  value?: unknown;
};

export type FieldSelector = {
  ids: number[];
  aliases: string[];
};

export type FieldMatch = {
  value: string;
  sourceId: number | null;
  sourceName: string;
  method: 'id' | 'alias' | 'missing';
  sourcePresent: boolean;
  nonEmptyCandidateCount: number;
  conflict: boolean;
};

const MIN_RESOLUTION_YEAR = 2000;

export function normalizeFieldToken(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

export function customFieldValueToString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) {
    return value.map(customFieldValueToString).filter(Boolean).join(', ');
  }
  return String(value).trim();
}

export function selectCustomField(
  customFields: RedmineCustomField[] | undefined,
  selector: FieldSelector,
): FieldMatch {
  const fields = customFields ?? [];
  const aliasTokens = new Set(selector.aliases.map(normalizeFieldToken));
  const candidates = fields.filter(field =>
    (field.id !== undefined && selector.ids.includes(field.id))
    || aliasTokens.has(normalizeFieldToken(field.name ?? ''))
  );
  const nonEmptyCandidates = candidates.filter(field => customFieldValueToString(field.value) !== '');
  const distinctValues = new Set(nonEmptyCandidates.map(field => customFieldValueToString(field.value)));

  for (const id of selector.ids) {
    for (const field of fields) {
      if (field.id !== id) continue;
      const value = customFieldValueToString(field.value);
      if (value) {
        return {
          value,
          sourceId: field.id ?? null,
          sourceName: field.name ?? '',
          method: 'id',
          sourcePresent: candidates.length > 0,
          nonEmptyCandidateCount: nonEmptyCandidates.length,
          conflict: distinctValues.size > 1,
        };
      }
    }
  }

  const aliases = selector.aliases.map(normalizeFieldToken);
  for (const alias of aliases) {
    for (const field of fields) {
      if (normalizeFieldToken(field.name ?? '') !== alias) continue;
      const value = customFieldValueToString(field.value);
      if (value) {
        return {
          value,
          sourceId: field.id ?? null,
          sourceName: field.name ?? '',
          method: 'alias',
          sourcePresent: candidates.length > 0,
          nonEmptyCandidateCount: nonEmptyCandidates.length,
          conflict: distinctValues.size > 1,
        };
      }
    }
  }

  return {
    value: '',
    sourceId: null,
    sourceName: '',
    method: 'missing',
    sourcePresent: candidates.length > 0,
    nonEmptyCandidateCount: nonEmptyCandidates.length,
    conflict: distinctValues.size > 1,
  };
}

export function toResolvedTimestamp(value: string): string | null {
  if (!value) return null;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const parsed = new Date(dateOnly ? `${value}T00:00:00Z` : value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function parseTimestamp(value: string | null | undefined): Date | null {
  if (!value) return null;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const parsed = new Date(dateOnly ? `${value}T00:00:00Z` : value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isValidResolvedDate(candidate: Date, created: Date | null): boolean {
  if (candidate.getUTCFullYear() < MIN_RESOLUTION_YEAR) return false;
  if (created && candidate.getTime() < created.getTime()) return false;
  return true;
}

export function selectResolvedTimestamp(
  customResolvedValue: string,
  createdOn: string | null | undefined,
  closedOn: string | null | undefined,
): string | null {
  const created = parseTimestamp(createdOn);
  const customResolved = parseTimestamp(customResolvedValue);
  if (customResolved && isValidResolvedDate(customResolved, created)) {
    return customResolved.toISOString();
  }

  const closed = parseTimestamp(closedOn);
  if (closed && isValidResolvedDate(closed, created)) {
    return closed.toISOString();
  }

  return null;
}
