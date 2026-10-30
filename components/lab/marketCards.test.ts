import { describe, expect, it } from 'vitest';
import { MarketLab, SignalGain } from '../../services/labData';
import { marketCards } from './marketCards';

// Données fictives au format de public/data/lab/market_lab.json (aucune donnée réelle)
const ci = (a: number, b: number): [number, number] => [a, b];
const gain = (g: number, verdict: SignalGain['verdict'] = 'debunked'): SignalGain =>
  ({ train: 6000, test: 8000, llBase: 1.01, llRecal: 1.009, llSignal: 1.009 - g, gain: g, ci: ci(g - 0.0005, g + 0.0005), coef: [-0.03, 0.03], signalSd: 1.8, verdict });
const fixture: MarketLab = {
  generatedAt: '2026-10-30T12:00:00+00:00', matches: 44000, covered: 30000, baseStart: '2023-07-01', current: '2026-27',
  testSeason: '2025-26', previousSeason: '2024-25', baseLogLoss: 1.006,
  experiments: {
    calibration: { '2025-26': { season: '2025-26', matches: 10000, temperature: 0.91, llRaw: 1.014, llTempered: 1.0138, gain: 0.0003, ci: ci(-0.0003, 0.001), ece: 0.014,
      reliability: [{ lo: 0.3, hi: 0.4, n: 1200, predicted: 0.35, observed: 0.34 }], draws: { AAA: { matches: 300, predicted: 0.25, observed: 0.26 } }, drawBias: -0.003, verdict: 'debunked' } },
    cups: { seasons: { '2025-26': { matches: 520, rpsModel: 0.209, rpsFrequencies: 0.235, gain: 0.0255, ci: ci(0.015, 0.037) } },
      tiers: { '1-2+': { matches: 630, rpsModel: 0.187, rpsFrequencies: 0.237, gain: 0.05, ci: ci(0.038, 0.063) } }, verdict: 'validated', matches: 1500 },
    absences: { '2025-26': { season: '2025-26', count: gain(0.0008, 'validated'), share: gain(0.001, 'validated'), known: gain(0.0002, 'partial'),
      xi: { '2025-26': { predicted: 0.759, lastEleven: 0.766, missing: 2.36, missingShare: 0.31 } }, teamMatches: 70000, verdict: 'validated' } },
    setPieces: { '2025-26': { ...gain(0.0001), season: '2025-26', meanExpected: 0.59 } },
    redCards: { '2025-26': { season: '2025-26', teamMatches: 21000, redRate: 0.095, auc: 0.59, aucRefereeOnly: 0.57, coef: { ref_red: 0.09 }, outcome: gain(-0.0003),
      overUnder: { matches: 10000, llPoisson: 0.6817, llWithRed: 0.6814, gain: 0.0003, ci: ci(0, 0.0006), coef: -0.7 }, verdict: 'debunked' } },
    goalReaction: { teamSeasons: 2450, meanReaction: 0.8, r: 0.002, ci: ci(-0.04, 0.05), verdict: 'debunked' },
    stakes: { '2025-26': { season: '2025-26', difference: gain(0.0041, 'validated'),
      homeResidual: { homeOnly: { matches: 700, residual: 0.21, ci: ci(0.12, 0.3) }, awayOnly: { matches: 680, residual: -0.13, ci: ci(-0.22, -0.04) }, both: undefined, none: undefined },
      matches: 3100, verdict: 'validated' } },
    market: { available: false },
  },
};

describe('marketCards', () => {
  it('builds one card per odds-free experiment, in French, without the market block', () => {
    const cards = marketCards(fixture);
    expect(cards.map(c => c.id)).toEqual(['calibration', 'cups', 'absences', 'xi', 'stakes', 'set-pieces', 'red-cards', 'goal-reaction']);
    expect(cards.find(c => c.id === 'stakes')?.text).toContain('+0,21 pt');
    expect(cards.find(c => c.id === 'cups')?.figure).toBe('RPS 0,209 contre 0,235');
    expect(cards.find(c => c.id === 'xi')?.figure).toBe('77 %');
    for (const c of cards) expect(c.figure).not.toMatch(/NaN|undefined/);
  });

  it('adds the market cards when odds were available', () => {
    const bets = { bets: 120, clv: -0.02, clvSe: 0.005 };
    const m: MarketLab = { ...fixture, experiments: { ...fixture.experiments, market: {
      available: true, matches: 9000, teamsMapped: 400, period: ['2023-08-01', '2026-10-20'],
      closingTarget: { train: 5000, test: 4000, movementR: 0.2, movementExplained: 0.04, llOpening: 1.0, llClosing: 0.99, llBase: 1.01, llPredicted: 0.999, betsBase: bets, betsPredicted: bets, verdict: 'debunked' },
      dispersion: { train: 5000, test: 4000, groups: { low: { matches: 1300, dispersion: 0.01, weight: 0, llOpening: 1, llClosing: 0.99, llPool: 1, bets },
        mid: { matches: 1300, dispersion: 0.02, weight: 0, llOpening: 1, llClosing: 0.99, llPool: 1, bets }, high: { matches: 1300, dispersion: 0.04, weight: 0.1, llOpening: 1, llClosing: 0.99, llPool: 1, bets } }, verdict: 'partial' },
      coherence: { matches: 3000, movementR: 0.05, weightImplied: 0.2, llOpening: 1, llImplied: 1.002, llClosing: 0.99, bets, verdict: 'debunked' },
      luck: { ...gain(0.0002), bets }, coach: { changes: 300, vsOpening: gain(0), vsBase: gain(0), marketResidual: { matches: 200, mean: -0.01, ci: ci(-0.05, 0.03) }, fadeBets: { bets: 200, clv: 0.01, clvSe: 0.01 }, verdict: 'debunked' },
      efficiency: { competitions: { AAA: { matches: 300, weight: 0.1, llOpening: 1, llClosing: 0.99, llBase: 1.01, llPool: 0.999, poolGain: 0.001, poolCi: ci(0.0002, 0.002), dispersion: 0.02, movement: 0.1, bets, verdict: 'validated' } }, validated: 1, verdict: 'partial' },
      stack: { train: 5000, test: 4000, signals: ['missing', 'stakes'], llOpening: 1, llWithBase: 1, llStack: 0.999, llClosing: 0.99, gain: 0.001, ci: ci(0.0002, 0.002), bets, verdict: 'partial' },
    } } };
    const cards = marketCards(m);
    expect(cards.length).toBe(15);
    expect(cards.find(c => c.id === 'efficiency')?.figure).toBe('1 compétition');
    expect(cards.find(c => c.id === 'closing-target')?.text).toContain('120 paris');
  });
});
