import { describe, expect, it } from 'vitest';
import { LabExperiments } from '../../services/labData';
import { cards } from './Notebook';

// Données fictives au format de public/data/lab/experiments.json (aucune donnée réelle)
const ci = (a: number, b: number): [number, number] => [a, b];
const errors = { unchanged: 12.3, development: 11.6, twins: 11.8 };
const fixture: LabExperiments = {
  generatedAt: '2026-10-21T12:00:00+00:00', matches: 40000, leagueMatches: 38000, teamMatches: 80000, events: 700000, current: '2026-27',
  experiments: {
    coachChange: { changes: 400, prePerf: -0.12, otherPerf: 0.1, naive: 0.06, naiveCi: ci(0.01, 0.11), naivePoints: 0.16, expectedRebound: 0.07,
      effect: -0.005, effectCi: ci(-0.05, 0.04), effectPoints: -0.02, curve: { x: [-1, 0], changers: [-0.2, -0.1], controls: [-0.2, -0.05] }, verdict: 'debunked' },
    coachDna: { arrivals: 340, coaches: 220, verdict: 'validated',
      imprint: Object.fromEntries(['possession', 'territoire', 'pressing', 'construction', 'verticalité', 'hauteur']
        .map((d, i) => [d, { intercept: 0, club: 0.5, coach: 0.2 + i * 0.02, ci: ci(0.1, 0.4) }])) },
    coachResults: { pairs: 270, r: 0.1, ci: ci(-0.03, 0.22), verdict: 'debunked' },
    referees: { reliability: { cards: { r: 0.58, referees: 440 }, pens: { r: -0.05, referees: 440 }, bias: { r: 0.06, referees: 440 } },
      verdicts: { cards: 'validated', pens: 'debunked', bias: 'debunked' } },
    goalValue: { goals: 110000, matches: 38000, meanValue: 0.66, byState: { '-2': 0.19, '-1': 0.83, '0': 0.93, '1': 0.37, '2': 0.05 }, scale: 1,
      calibration: {}, curves: { minutes: [0, 90], byScore: { '-1': [0.7, 1.2], '0': [0.7, 1.6], '1': [0.5, 0.3] } },
      perGoalReliability: { r: 0.31, pairs: 1700 }, verdict: 'partial' },
    momentum: { observations: 120000, season: '2025-26', logLoss: { home: { base: 0.418, shots: 0.417, momentum: 0.416 }, away: { base: 0.365, shots: 0.364, momentum: 0.363 } },
      quiet: { home: [0.12, 0.13, 0.14, 0.15, 0.15], away: [0.13, 0.11, 0.11, 0.09, 0.1] }, verdict: 'validated' },
    elevator: { validation: { base: '2024-25', pairs: 2400, rate: 0.086, auc: 0.77, brier: 0.073, brierBase: 0.079, quintiles: [], top: { n: 25, hits: 10 } },
      verify: null, verdict: 'validated', stepUp: 1 },
    twins: { base: '2024-25', players: 2400, youngPlayers: 730, all: errors, young: { ...errors, twins: 11.5 }, verdict: 'partial' },
    duos: { pairs: 65000, reliability: 0.53, sd: 0.22, strong: 0.063, verdict: 'validated' },
    clock: { pairs: 1800, coef: 0.041, ci: ci(0.012, 0.072), persistence: 0.77, verdict: 'validated' },
    setPieces: { mean: 0.24, r: 0.42, pairs: 1400, verdict: 'validated' },
    luck: { teams: 2100, luckR: 0.16, pointsR: 0.6, xgdR: 0.65, verdict: 'measured' },
    availability: { median: 0.92, r: 0.19, pairs: 15000, verdict: 'partial' },
    redCards: { matches: 3900, reduced: [1.08, 0.86], opponent: [1.29, 2.59], verdict: 'measured' },
    gameState: { protect: { mean: -0.02, r: 0.05, pairs: 1380 }, chase: { mean: 0.01, r: 0.05, pairs: 1380 }, late: { mean: 0, r: 0.16, pairs: 1380 }, verdict: 'debunked' },
    fatigue: { matches: 2200, effect: -0.035, ci: ci(-0.076, 0.008), perDay: 0.006, byRest: {}, verdict: 'debunked' },
    styleMatchups: { rows: 46000, gain: -0.0003, ci: ci(-0.0005, -0.0001), baseMse: 0.29, verdict: 'debunked' },
  },
};

describe('carnet d\'expériences', () => {
  const list = cards(fixture);

  it('a une carte par expérience, sans texte cassé', () => {
    expect(list.length).toBe(17);
    expect(new Set(list.map(c => c.id)).size).toBe(17);
    list.forEach(c => {
      const text = `${c.question} ${c.figure} ${c.caption} ${c.text}`;
      expect(text).not.toMatch(/NaN|undefined|Infinity|null/);
      expect(text).not.toMatch(/\d\.\d/);                                // nombres à la française
    });
  });

  it('reprend les verdicts et les chiffres', () => {
    const byId = Object.fromEntries(list.map(c => [c.id, c]));
    expect(byId['coach-change'].verdict).toBe('debunked');
    expect(byId['coach-change'].figure).toBe('−0,01 xG/match');
    expect(byId['style-matchups'].figure).toBe('+0,10 %');            // l'erreur augmente
    expect(byId['red-cards'].figure).toBe('×2,0');
    expect(byId.momentum.figure).toBe('12 % → 15 %');
  });
});
