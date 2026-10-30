import { describe, expect, it } from 'vitest';
import { UNMEASURED_DIMENSIONS, firstOverallRatingAt, gridGaps, gridTemplate, isBlindHidden, ratingForPercentile } from './observationGrid';
import { buildSnapshot } from './scoutReportSnapshot';
import { STRIKER } from './scoutReportFixtures';

describe('gridTemplate', () => {
  it('reprend les critères du preset (libellés de l\'application, inversés signalés) puis les dimensions non mesurées', () => {
    const g = gridTemplate('Renard des surfaces');
    const metrics = g.criteria.filter(c => c.kind === 'role_metric');
    expect(metrics.map(c => c.key)).toContain('npxG per 90');
    expect(metrics.find(c => c.key === 'Big chances missed per 90')?.label).toBe('Grosses occasions manquées par 90 (inv.)');
    expect(metrics.every(c => c.rating === undefined)).toBe(true);     // jamais préremplie
    expect(g.criteria.filter(c => c.kind === 'unmeasured').map(c => c.key)).toEqual(UNMEASURED_DIMENSIONS.map(d => d.key));
    expect(g.criteria.filter(c => c.kind === 'unmeasured').map(c => c.label)).toEqual(['Comportement à la perte', 'Communication', 'Orientation avant réception', 'Repli']);
  });
  it('rôle inconnu : seulement les dimensions non mesurées', () => {
    expect(gridTemplate('Rôle inconnu').criteria.every(c => c.kind === 'unmeasured')).toBe(true);
  });
});

describe('écart data / observation', () => {
  const facts = buildSnapshot(STRIKER).facts;   // npxG par 90 à P91, duels aériens gagnés % à P18
  it('juxtapose la note du scout et la bande de percentile, sans fusionner', () => {
    expect([ratingForPercentile(0), ratingForPercentile(19), ratingForPercentile(20), ratingForPercentile(59), ratingForPercentile(60), ratingForPercentile(80), ratingForPercentile(100)]).toEqual([1, 1, 2, 3, 4, 5, 5]);
    const gaps = gridGaps({ role: 'Renard des surfaces', criteria: [
      { key: 'npxG per 90', label: 'npxG par 90', kind: 'role_metric', rating: 3 },
      { key: 'Aerial duels won, %', label: 'Duels aériens gagnés, %', kind: 'role_metric', rating: 4 },
      { key: 'Touches in box per 90', label: 'Touches dans la surface par 90', kind: 'role_metric' },
      { key: 'Metric absente', label: 'Absente', kind: 'role_metric', rating: 2 },
      { key: 'communication', label: 'Communication', kind: 'unmeasured', rating: 5 },
    ] }, facts);
    expect(gaps.items.map(i => i.key)).toEqual(['npxG per 90', 'Aerial duels won, %', 'Metric absente']);
    expect(gaps.items[0]).toMatchObject({ percentile: 91, dataRating: 5, gap: -2 });   // observé en dessous de la donnée
    expect(gaps.items[1]).toMatchObject({ percentile: 18, dataRating: 1, gap: 3 });    // observé au-dessus
    expect(gaps.items[2].gap).toBeUndefined();
    expect(gaps).toMatchObject({ above: 1, below: 1, aligned: 0, unmatched: 1 });
  });
  it('métrique inversée : la bande suit le percentile orienté', () => {
    const inv = buildSnapshot({ ...STRIKER, 'Big chances missed per 90 pct': 90 }).facts;
    const gaps = gridGaps({ role: 'r', criteria: [{ key: 'Big chances missed per 90', label: 'x', kind: 'role_metric', rating: 1 }] }, inv);
    expect(gaps.items[0]).toMatchObject({ percentile: 10, dataRating: 1, gap: 0 });
  });
});

describe('mode aveugle', () => {
  it('masqué tant qu\'aucune révélation ; première note globale datée', () => {
    expect(isBlindHidden(undefined)).toBe(false);
    expect(isBlindHidden({ blind: true })).toBe(true);
    expect(isBlindHidden({ blind: true, revealedAt: 'x' })).toBe(false);
    expect(isBlindHidden({ blind: false })).toBe(false);
    expect(firstOverallRatingAt({ observations: [
      { id: 'a', date: '2026-10-30', type: 'live', text: 't', createdAt: '2026-10-30T10:00:00.000Z', grid: { role: 'r', overall: 3, criteria: [] } },
      { id: 'b', date: '2026-10-29', type: 'live', text: 't', createdAt: '2026-10-29T10:00:00.000Z', grid: { role: 'r', criteria: [] } },
      { id: 'c', date: '2026-10-28', type: 'live', text: 't', createdAt: '2026-10-28T10:00:00.000Z', grid: { role: 'r', overall: 2, criteria: [] } },
    ] })).toBe('2026-10-28T10:00:00.000Z');
  });
});
