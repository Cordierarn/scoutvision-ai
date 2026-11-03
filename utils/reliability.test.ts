import { describe, expect, it } from 'vitest';
import {
  ReliabilityModel, SmallSamplesFile, expandSmallSamples, filterSmallSamples, fullMatches, metricReliability, playerMetricReliability,
  reliabilityLevel, reliabilityText, valueInterval,
} from './reliability';

const model: ReliabilityModel = {
  method: 'test', reliableAt: 0.7, summary: { metrics: 1, meanAbsCalibrationError: 0.02, percentileGapVsPitchapi: 2.5 },
  metrics: { 'xG per 90': { k: 900, kPitchapi: 1400, calibrated: true, minutesForReliable: 2100, trueSd: { ST: 0.1 }, validation: [] } },
};

describe('fiabilité des métriques par 90', () => {
  it('fiabilité = minutes / (minutes + k), niveaux et matchs équivalents', () => {
    expect(metricReliability(900, { k: 900 })).toBe(0.5);
    expect(metricReliability(0, { k: 900 })).toBeNull();
    expect(metricReliability(900, undefined)).toBeNull();
    expect([reliabilityLevel(0.75), reliabilityLevel(0.5), reliabilityLevel(0.2)]).toEqual(['fiable', 'moyenne', 'faible']);
    expect(fullMatches(2100)).toBe(23);
  });

  it('intervalle à 90 % : plus étroit quand la fiabilité monte, borné à 0 pour un volume', () => {
    const [lo, hi] = valueInterval(0.3, 0.5, 0.1)!;
    expect(hi - lo).toBeCloseTo(2 * 1.645 * 0.1 * Math.sqrt(0.5), 6);
    expect(valueInterval(0.05, 0, 0.2)![0]).toBe(0);
    expect(valueInterval(-0.05, 0, 0.2, true)![0]).toBeLessThan(0);
    expect(valueInterval(0.3, 0.5, undefined)).toBeNull();
  });

  it('fiabilité d\'un joueur et texte d\'infobulle', () => {
    const m = playerMetricReliability(model, 'xG per 90', 900, 'ST', 0.3)!;
    expect(m.level).toBe('moyenne');
    expect(m.matchesForReliable).toBe(23);
    expect(reliabilityText(m)).toMatch(/^Fiabilité 50 % \(moyenne\), intervalle à 90 % : 0,18 – 0,42\. Fiable \(70 %\) à partir d'environ 23 matchs complets\.$/);
    expect(playerMetricReliability(model, 'Passes, %', 900, 'ST', 80)).toBeNull();
  });
});

describe('joueurs à faible temps de jeu', () => {
  const file: SmallSamplesFile = {
    season: '2026-27', labels: ['Shots per 90', 'xG per 90'], fields: ['value', 'raw', 'reliability', 'pct', 'pctLow', 'pctHigh'], minMatches: 4, minMinutes: 180,
    players: [
      { 'Player ID': 'a', Player: 'Joueur A', Competition: 'AAA', Position: 'ST', Age: 19, 'Matches played': 8, 'Minutes played': 400, metrics: [[1, 0.4, 0.6, 31, 88, 40, 99], [0, 2.1, 2.5, 50, 70, 30, 95]] },
      { 'Player ID': 'b', Player: 'Joueur B', Competition: 'AAA', Position: 'ST', Age: 24, 'Matches played': 12, 'Minutes played': 900, metrics: [[1, 0.35, 0.4, 50, 80, 65, 92]] },
      { 'Player ID': 'c', Player: 'Joueur C', Competition: 'BBB', Position: 'W', Age: 20, 'Matches played': 5, 'Minutes played': 300, metrics: [[1, 0.5, 0.9, 25, 95, 50, 100]] },
    ],
  };
  const players = expandSmallSamples(file);

  it('déplie le format compact par libellé', () => {
    expect(players[0].metrics['xG per 90']).toEqual({ value: 0.4, raw: 0.6, reliability: 31, pct: 88, pctLow: 40, pctHigh: 99 });
    expect(players[1].metrics['Shots per 90']).toBeUndefined();
  });

  it('filtre par rôle, compétition, âge et matchs ; trie par percentile, borne basse ou fiabilité', () => {
    const base = { role: 'ST', competition: '', maxAge: null, minMatches: 4, metric: 'xG per 90', sort: 'pct' as const };
    expect(filterSmallSamples(players, base).map(p => p.Player)).toEqual(['Joueur A', 'Joueur B']);
    expect(filterSmallSamples(players, { ...base, sort: 'low' }).map(p => p.Player)).toEqual(['Joueur B', 'Joueur A']);
    expect(filterSmallSamples(players, { ...base, sort: 'reliability' }).map(p => p.Player)).toEqual(['Joueur B', 'Joueur A']);
    expect(filterSmallSamples(players, { ...base, maxAge: 21 }).map(p => p.Player)).toEqual(['Joueur A']);
    expect(filterSmallSamples(players, { ...base, minMatches: 10 }).map(p => p.Player)).toEqual(['Joueur B']);
    expect(filterSmallSamples(players, { ...base, competition: 'BBB' })).toEqual([]);
  });
});
