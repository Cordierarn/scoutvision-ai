import { describe, expect, it } from 'vitest';
import { PlayerData } from '../types';
import {
  addEntry, bestValueIndices, comparisonEntry, defaultComparisonMetrics, distinctNames, hasDetailedStats,
  mainDifferences, MIN_RADAR_AXES, radarAxes, referenceGroups, resolveSelection,
} from './comparison';
import { formatMetricValue, metricValue, percentileOf, radarAxisLabel } from './metricFormat';
import { LOWER_IS_BETTER, metricDirection } from './metricDirection';
import { getRadarMetricsForPosition } from './positionMetrics';

// Lignes minimales au format des données préparées (colonnes « X » et « X pct »)
const row = (over: Partial<PlayerData> & Record<string, unknown>): PlayerData => ({
  'Player ID': 'p1', Player: 'Alex Martin', 'Team ID': 't1', Team: 'Club A', Competition: 'FRA',
  League: 'Ligue 1 2026-27', Season: '2026-27', Position: 'ST', 'League tier': 1, ...over,
} as PlayerData);

describe('percentiles du pipeline', () => {
  it('lit « X pct » tel quel, sans recalcul', () => {
    const p = row({ 'Passes per 90': 25.1, 'Passes per 90 pct': 86 });
    expect(percentileOf(p, 'Passes per 90')).toBe(86);
    expect(metricValue(p, 'Passes per 90')).toBe(25.1);
  });

  it('donnée absente : null, jamais 0 ni P0', () => {
    const p = row({ 'Passes per 90': null, 'Passes per 90 pct': null, Goals: 0 });
    expect(metricValue(p, 'Passes per 90')).toBeNull();
    expect(percentileOf(p, 'Passes per 90')).toBeNull();
    expect(percentileOf(p, 'Absente')).toBeNull();
    expect(formatMetricValue('Passes per 90', null)).toBe('–');
    // zéro réellement fourni : conservé
    expect(metricValue(p, 'Goals')).toBe(0);
  });

  it('ligne sans aucun percentile signalée', () => {
    expect(hasDetailedStats(row({ 'xG per 90 pct': null }))).toBe(false);
    expect(hasDetailedStats(row({ 'xG per 90 pct': 40 }))).toBe(true);
  });
});

describe('format français', () => {
  it('virgule décimale et unité', () => {
    const nb = (s: string) => s.replace(/[  ]/g, ' ');
    expect(nb(formatMetricValue('xG per 90', 0.4212))).toBe('0,42 /90');
    expect(nb(formatMetricValue('Accurate passes, %', 77.78))).toBe('77,8 %');
    expect(nb(formatMetricValue('xG', 1.81))).toBe('1,81 xG');
    expect(nb(formatMetricValue('Goals', 6))).toBe('6 buts');
    expect(nb(formatMetricValue('Goals', 1))).toBe('1 but');
    expect(radarAxisLabel('Passes clés par 90')).toBe('Passes clés /90');
  });
});

describe('sens des métriques (poids des rôles officiels)', () => {
  it('moins = mieux pour les métriques à poids négatif', () => {
    expect(metricDirection('Fouls per 90')).toBe('lower');
    expect(metricDirection('Dispossessed per 90')).toBe('lower');
    expect(LOWER_IS_BETTER.has('Fouls per 90')).toBe(true);
    expect(metricDirection('Progressive passes per 90')).toBe('higher');
  });

  it('sens inconnu : aucune meilleure valeur', () => {
    expect(metricDirection('Touches per 90')).toBeUndefined();
    expect(metricDirection('Miscontrols per 90')).toBeUndefined();   // absente des rôles : sens non déduit du nom
    expect(bestValueIndices([3, 1], undefined)).toEqual([]);
  });

  it('meilleure valeur selon le sens, ex aequo tous mis en avant, absents ignorés', () => {
    expect(bestValueIndices([1.7, 1.5], 'lower')).toEqual([1]);
    expect(bestValueIndices([1.7, 1.5], 'higher')).toEqual([0]);
    expect(bestValueIndices([2, 2, 1], 'higher')).toEqual([0, 1]);
    expect(bestValueIndices([2, 2], 'higher')).toEqual([]);          // tous ex aequo : aucune distinction
    expect(bestValueIndices([null, 4], 'higher')).toEqual([]);       // une seule valeur connue
    expect(bestValueIndices([null, 4, 3], 'higher')).toEqual([1]);
  });
});

describe('sélection', () => {
  it('même joueur, même club, championnat et coupe : deux entrées distinctes', () => {
    const league = row({});
    const cup = row({ Competition: 'UCL' });
    const a = comparisonEntry(league), b = comparisonEntry(cup);
    expect(a.id).not.toBe(b.id);
    const step1 = addEntry([], a);
    const step2 = addEntry(step1.entries, b);
    expect(step2.status).toBe('added');
    expect(resolveSelection(step2.entries, [cup, league]).players).toEqual([league, cup]);
  });

  it('doublon exact refusé, limite de 4 respectée', () => {
    const e = comparisonEntry(row({}));
    expect(addEntry([e], e).status).toBe('duplicate');
    const four = [1, 2, 3, 4].map(i => comparisonEntry(row({ 'Player ID': `p${i}` })));
    expect(addEntry(four, comparisonEntry(row({ 'Player ID': 'p9' }))).status).toBe('full');
  });

  it('restauration : retrouve les lignes, signale celles absentes de la saison chargée', () => {
    const current = row({});
    const previous = row({ League: 'Ligue 1 2025-26', Season: '2025-26' });
    const entries = [comparisonEntry(current), comparisonEntry(previous)];
    const onlyCurrent = resolveSelection(entries, [current]);
    expect(onlyCurrent.players).toEqual([current]);
    expect(onlyCurrent.missing.map(m => m.id)).toEqual([entries[1].id]);
  });

  it('toutes saisons : chaque ligne garde son propre percentile (aucun regroupement)', () => {
    const s25 = row({ League: 'Ligue 1 2024-25', Season: '2024-25', 'xG per 90 pct': 98 });
    const s27 = row({ 'xG per 90 pct': 62 });
    const { players } = resolveSelection([comparisonEntry(s25), comparisonEntry(s27)], [s27, s25]);
    expect(players.map(p => percentileOf(p, 'xG per 90'))).toEqual([98, 62]);
  });

  it('noms distinctifs : nom de famille, puis nom complet, puis club', () => {
    const a = row({ Player: 'Enzo Giménez', Team: 'Rosario' });
    const b = row({ Player: 'Enzo Giménez', Team: 'Querétaro' });
    const c = row({ Player: 'Lucas Giménez' });
    expect(distinctNames([a, c])).toEqual(['Enzo Giménez', 'Lucas Giménez']);
    expect(distinctNames([a, b])).toEqual(['Enzo Giménez · Rosario', 'Enzo Giménez · Querétaro']);
    expect(distinctNames([a, row({ Player: 'Ludovic Ajorque' })])).toEqual(['Giménez', 'Ajorque']);
    // même joueur, même club, championnat et coupe la même saison, puis une autre saison
    const league = row({ Player: 'Ludovic Ajorque', League: 'Ligue 1 2024-25', Season: '2024-25' });
    const cup = row({ Player: 'Ludovic Ajorque', Competition: 'UCL', League: 'UCL 2024-25', Season: '2024-25' });
    const later = row({ Player: 'Ludovic Ajorque' });
    expect(distinctNames([league, cup, later], p => (p.Competition === 'UCL' ? 'Champions League' : 'Ligue 1')))
      .toEqual(['Ludovic Ajorque · Ligue 1 · 24-25', 'Ludovic Ajorque · Champions League · 24-25', 'Ludovic Ajorque · Ligue 1 · 26-27']);
  });
});

describe('métriques par défaut et radar', () => {
  it('même poste : métriques radar du poste ; postes différents : union entrelacée sans doublon', () => {
    const st = row({}), w = row({ Position: 'W' });
    expect(defaultComparisonMetrics([st, st])).toEqual(getRadarMetricsForPosition('ST'));
    const union = defaultComparisonMetrics([st, w]);
    expect(new Set(union).size).toBe(union.length);
    expect(union.slice(0, 2)).toEqual([getRadarMetricsForPosition('ST')[0], getRadarMetricsForPosition('W')[0]]);
    expect(defaultComparisonMetrics([row({ Position: undefined })])).toEqual([]);
  });

  it('radar : seulement les métriques avec un percentile pour chaque joueur, minimum 3 axes', () => {
    const keys = ['a per 90', 'b per 90', 'c per 90', 'Goals'];
    const full = row({ 'a per 90 pct': 10, 'b per 90 pct': 20, 'c per 90 pct': 30 });
    const partial = row({ 'a per 90 pct': 50, 'b per 90 pct': null, 'c per 90 pct': 70 });
    expect(radarAxes([full], keys, 10)).toEqual({ keys: ['a per 90', 'b per 90', 'c per 90'], available: 3 });
    const both = radarAxes([full, partial], keys, 10);
    expect(both.keys).toEqual(['a per 90', 'c per 90']);
    expect(both.keys.length).toBeLessThan(MIN_RADAR_AXES);
    expect(radarAxes([full], keys, 2).keys).toHaveLength(2);
  });
});

describe('principales différences', () => {
  const a = row({ Player: 'A', 'x per 90 pct': 86, 'y per 90 pct': 40, 'z per 90 pct': 10, 'w per 90 pct': 5 });
  const b = row({ Player: 'B', 'x per 90 pct': 22, 'y per 90 pct': 46, 'z per 90 pct': null, 'w per 90 pct': 5 });
  const c = row({ Player: 'C', 'x per 90 pct': 50, 'y per 90 pct': 90, 'z per 90 pct': 30, 'w per 90 pct': 5 });
  const keys = ['x per 90', 'y per 90', 'z per 90', 'w per 90', 'Goals'];

  it('deux joueurs : écart absolu, classé, non comparables à part, totaux exclus', () => {
    const r = mainDifferences([a, b], keys);
    expect(r.rows.map(x => [x.key, x.spread])).toEqual([['x per 90', 64], ['y per 90', 6], ['w per 90', 0]]);
    expect(r.notComparable).toEqual(['z per 90']);
    expect(r.excludedTotals).toEqual(['Goals']);
  });

  it('trois joueurs : écart max − min', () => {
    const r = mainDifferences([a, b, c], keys);
    expect(r.rows[0]).toMatchObject({ key: 'x per 90', spread: 64, percentiles: [86, 22, 50] });
    expect(r.rows[1]).toMatchObject({ key: 'y per 90', spread: 50 });
  });

  it('un seul joueur : rien à comparer ; limite respectée', () => {
    expect(mainDifferences([a], keys).rows).toEqual([]);
    expect(mainDifferences([a, b], keys, 1).rows).toHaveLength(1);
  });
});

describe('groupes de référence', () => {
  it('signale poste, niveau et saison différents', () => {
    const g = referenceGroups([row({}), row({ Position: 'W', 'League tier': 3, League: 'K League 2026', Season: '2026' })]);
    expect(g).toMatchObject({ samePosition: false, sameTier: false, sameSeason: true });
    expect(referenceGroups([row({}), row({ Position: undefined })]).unknownPosition).toEqual([1]);
  });
});
