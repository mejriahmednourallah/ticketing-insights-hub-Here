import { describe, expect, it } from 'vitest';
import {
  customFieldValueToString,
  selectCustomField,
  toResolvedTimestamp,
} from '../../supabase/functions/redmine-ingest/customFieldMapping';

describe('Redmine custom-field mapping', () => {
  it('continues after an empty Nature field and finds intervention type', () => {
    const result = selectCustomField([
      { id: 17, name: 'Nature', value: '' },
      { id: 18, name: "Type d'intervention", value: ['Webmastering'] },
    ], {
      ids: [17, 18],
      aliases: ['Nature', "Type d'intervention"],
    });

    expect(result).toMatchObject({
      value: 'Webmastering',
      sourceId: 18,
      method: 'id',
    });
  });

  it('selects a populated canonical Nature value', () => {
    const result = selectCustomField([
      { id: 17, name: 'Nature', value: 'Contenu' },
      { id: 18, name: "Type d'intervention", value: '' },
    ], {
      ids: [17],
      aliases: ['Nature'],
    });

    expect(result.value).toBe('Contenu');
  });

  it('supports array values', () => {
    expect(customFieldValueToString(['DEV', '', 'INTEG'])).toBe('DEV, INTEG');
  });

  it('matches aliases without accents', () => {
    const result = selectCustomField([
      { id: 99, name: 'Equipe Affectée', value: 'Webmaster' },
    ], {
      ids: [8],
      aliases: ['Equipe Affectee'],
    });

    expect(result).toMatchObject({ value: 'Webmaster', method: 'alias' });
  });

  it('uses an ID even when the field was renamed', () => {
    const result = selectCustomField([
      { id: 5, name: 'Technologie du projet', value: 'Drupal' },
    ], {
      ids: [5],
      aliases: ['CMS / Framework'],
    });

    expect(result).toMatchObject({ value: 'Drupal', sourceId: 5, method: 'id' });
  });

  it('returns missing only when every candidate is empty', () => {
    expect(selectCustomField([
      { id: 17, name: 'Nature', value: '' },
      { id: 18, name: "Type d'intervention", value: [] },
    ], {
      ids: [17, 18],
      aliases: ['Nature', "Type d'intervention"],
    })).toEqual({
      value: '',
      sourceId: null,
      sourceName: '',
      method: 'missing',
      sourcePresent: true,
      nonEmptyCandidateCount: 0,
      conflict: false,
    });
  });

  it('converts Redmine date-only resolved values to timestamps', () => {
    expect(toResolvedTimestamp('2026-05-12')).toBe('2026-05-12T00:00:00.000Z');
    expect(toResolvedTimestamp('invalid')).toBeNull();
  });
});
