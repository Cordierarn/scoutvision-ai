import { describe, expect, it } from 'vitest';
import {
  ReliabilityModel, SmallSamplesFile, expandSmallSamples, filterSmallSamples, fullMatches, matchesLabel, metricReliability, playerMetricReliability,
  reliabilityLevel, reliabilityText, valueInterval,
} from './reliability';
import { EMPTY_PROFILE, ProfileFilters } from './profileFilters';

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

  it('filtre par rôle, compétitions, âge et matchs ; trie par percentile, borne basse ou fiabilité', () => {
    const base = { role: 'ST', profile: EMPTY_PROFILE, maxAge: null, minMatches: 4, metric: 'xG per 90', sort: 'pct' as const };
    expect(filterSmallSamples(players, base).rows.map(p => p.Player)).toEqual(['Joueur A', 'Joueur B']);
    expect(filterSmallSamples(players, { ...base, sort: 'low' }).rows.map(p => p.Player)).toEqual(['Joueur B', 'Joueur A']);
    expect(filterSmallSamples(players, { ...base, sort: 'reliability' }).rows.map(p => p.Player)).toEqual(['Joueur B', 'Joueur A']);
    expect(filterSmallSamples(players, { ...base, maxAge: 21 }).rows.map(p => p.Player)).toEqual(['Joueur A']);
    expect(filterSmallSamples(players, { ...base, minMatches: 10 }).rows.map(p => p.Player)).toEqual(['Joueur B']);
    expect(filterSmallSamples(players, { ...base, profile: { ...EMPTY_PROFILE, competitions: ['BBB'] } }).rows).toEqual([]);
  });
});

describe('matchesLabel', () => {
  it('plafonne les très longs échantillons à « plus de 100 matchs »', () => {
    expect(matchesLabel(34)).toBe('34 matchs');
    expect(matchesLabel(100)).toBe('100 matchs');
    expect(matchesLabel(323)).toBe('plus de 100 matchs');
  });
});

describe('joueurs à faible temps de jeu : filtres qualitatifs (joueurs et clubs fictifs)', () => {
  const m = [[0, 0.4, 0.5, 40, 70, 30, 90]];
  const file: SmallSamplesFile = {
    season: '2026-27', labels: ['xG per 90'], fields: ['value', 'raw', 'reliability', 'pct', 'pctLow', 'pctHigh'], minMatches: 4, minMinutes: 180,
    players: [
      { 'Player ID': 'a', Player: 'Gaucher', Competition: 'AAA', 'League tier': 1, 'Team ID': 't1', Position: 'ST', Age: 19, 'Matches played': 8, 'Minutes played': 400, metrics: m, Foot: 'Left', Height: 185, 'Passport country': 'FRA' },
      { 'Player ID': 'b', Player: 'Pied inconnu', Competition: 'AAA', 'League tier': 1, 'Team ID': 't1', Position: 'ST', Age: 20, 'Matches played': 8, 'Minutes played': 300, metrics: m },
      { 'Player ID': 'c', Player: 'Droitier', Competition: 'BBB', 'League tier': 2, 'Team ID': 't2', Position: 'ST', Age: 21, 'Matches played': 8, 'Minutes played': 200, metrics: m, Foot: 'Right' },
      { 'Player ID': 'd', Player: 'Pied inconnu, autre poste', Competition: 'AAA', 'League tier': 1, Position: 'W', Age: 20, 'Matches played': 8, 'Minutes played': 300, metrics: m },
      { 'Player ID': 'e', Player: 'Pied inconnu, trop âgé', Competition: 'AAA', 'League tier': 1, Position: 'ST', Age: 30, 'Matches played': 8, 'Minutes played': 300, metrics: m },
      { 'Player ID': 'f', Player: 'Pied inconnu, autre compétition', Competition: 'CCC', 'League tier': 1, Position: 'ST', Age: 20, 'Matches played': 8, 'Minutes played': 300, metrics: m },
    ],
  };
  const players = expandSmallSamples(file);
  const base = { role: 'ST', profile: EMPTY_PROFILE, maxAge: 23, minMatches: 4, metric: 'xG per 90', sort: 'pct' as const };
  const withProfile = (o: Omit<Partial<ProfileFilters>, 'includeMissing'> & { includeMissing?: Partial<ProfileFilters['includeMissing']> }) =>
    ({ ...base, profile: { ...EMPTY_PROFILE, ...o, includeMissing: { ...EMPTY_PROFILE.includeMissing, ...(o.includeMissing ?? {}) } } });
  const names = (r: { rows: { Player: string }[] }) => r.rows.map(p => p.Player);

  it('sélection multiple : compétitions, niveaux et clubs', () => {
    expect(names(filterSmallSamples(players, withProfile({ competitions: ['AAA', 'BBB'] })))).toEqual(['Gaucher', 'Pied inconnu', 'Droitier']);
    expect(names(filterSmallSamples(players, withProfile({ tiers: [2] })))).toEqual(['Droitier']);
    expect(names(filterSmallSamples(players, withProfile({ teams: ['t1'] })))).toEqual(['Gaucher', 'Pied inconnu']);
  });

  it('valeur absente jamais retenue ; compteur parmi le poste, l\'âge, les matchs et les autres critères du profil', () => {
    const r = filterSmallSamples(players, withProfile({ competitions: ['AAA', 'BBB'], feet: ['Left'] }));
    expect(names(r)).toEqual(['Gaucher']);
    // « Pied inconnu » seulement : ni l'autre poste, ni le joueur trop âgé, ni l'autre compétition
    expect(r.missing).toEqual({ nation: 0, foot: 1, height: 0 });
    const inc = filterSmallSamples(players, withProfile({ competitions: ['AAA', 'BBB'], feet: ['Left'], includeMissing: { foot: true } }));
    expect(names(inc)).toEqual(['Gaucher', 'Pied inconnu']);
    expect(inc.missing.foot).toBe(1);
  });

  it('nationalité et taille : même règle, chaque compteur ne retient que les joueurs écartés pour cette seule raison', () => {
    const r = filterSmallSamples(players, withProfile({ nations: ['FRA'], heightMin: 180 }));
    expect(names(r)).toEqual(['Gaucher']);
    expect(r.missing).toEqual({ nation: 0, foot: 0, height: 0 });           // sans nationalité ni taille : aucun des deux
    const incHeight = filterSmallSamples(players, withProfile({ nations: ['FRA'], heightMin: 180, includeMissing: { height: true } }));
    expect(incHeight.missing).toEqual({ nation: 3, foot: 0, height: 0 });
    expect(names(incHeight)).toEqual(['Gaucher']);
  });
});
