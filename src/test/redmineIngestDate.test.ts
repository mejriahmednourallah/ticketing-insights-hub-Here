import { describe, expect, it } from 'vitest';
import { selectResolvedTimestamp } from '../../supabase/functions/redmine-ingest/customFieldMapping';

describe('redmine resolved date selection', () => {
  it('rejects ancient custom resolved dates and falls back to closed_on', () => {
    expect(
      selectResolvedTimestamp(
        '0023-09-01',
        '2023-08-31T15:48:08Z',
        '2023-09-01T08:37:00Z',
      ),
    ).toBe('2023-09-01T08:37:00.000Z');
  });

  it('rejects custom resolved dates before creation', () => {
    expect(
      selectResolvedTimestamp(
        '2023-01-17',
        '2023-04-10T09:00:00Z',
        '2024-01-22T10:00:00Z',
      ),
    ).toBe('2024-01-22T10:00:00.000Z');
  });

  it('uses valid custom resolved dates before fallback dates', () => {
    expect(
      selectResolvedTimestamp(
        '2024-02-12',
        '2024-02-01T09:00:00Z',
        '2024-02-20T10:00:00Z',
      ),
    ).toBe('2024-02-12T00:00:00.000Z');
  });

  it('returns null when custom and fallback dates are invalid', () => {
    expect(
      selectResolvedTimestamp(
        '0025-10-08',
        '2026-02-06T13:25:34Z',
        null,
      ),
    ).toBeNull();
  });
});
