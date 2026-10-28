import { describe, expect, it } from 'vitest';
import { isSeasonInProgress } from './sampleContext';

describe('isSeasonInProgress', () => {
  it('saison européenne : en cours avant le 30 juin suivant', () => {
    expect(isSeasonInProgress('2026-27', '2026-27', '2026-10-26T17:01:36+00:00')).toBe(true);
    expect(isSeasonInProgress('2025-26', '2025-26', '2026-10-26T17:01:36+00:00')).toBe(false);
  });

  it('compétition sur l\'année civile : terminée après le 31 décembre', () => {
    expect(isSeasonInProgress('2026-27', '2026', '2026-10-26T00:00:00Z')).toBe(true);
    expect(isSeasonInProgress('2025-26', '2025', '2026-02-01T00:00:00Z')).toBe(false);
  });

  it('sans date de génération exploitable : pas d\'indicateur', () => {
    expect(isSeasonInProgress('2026-27', '2026-27', undefined)).toBe(false);
    expect(isSeasonInProgress('2026-27', '2026-27', 'pas une date')).toBe(false);
  });
});
