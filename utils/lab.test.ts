import { describe, expect, it } from 'vitest';
import { CoachSpell } from '../services/labData';
import { coachSignature, frNumber, frPercent, latestSpell, rollingMean, simulateArrival } from './lab';

const spell = (coach: string, team: string, end: string, n: number, possession: number): CoachSpell =>
  ({ coach, team_id: team, team: team.toUpperCase(), comp: 'AAA', start: '2021-01-01', end, n, perf: 0, possession });

describe('rollingMean', () => {
  it('lisse sur 3 valeurs et raccourcit la fenêtre aux bords', () => {
    expect(rollingMean([1, 2, 3, 10])).toEqual([1.5, 2, 5, 6.5]);
    expect(rollingMean([])).toEqual([]);
  });
});

describe('entraîneurs', () => {
  const spells = [spell('A', 'x', '2022-05-01', 30, 1), spell('A', 'y', '2024-05-01', 10, -1), spell('B', 'x', '2025-05-01', 20, 0.5)];

  it('signature pondérée par les matchs', () => {
    expect(coachSignature(spells, 'A', ['possession'])!.possession).toBeCloseTo((30 - 10) / 40, 10);
    expect(coachSignature(spells, 'Z', ['possession'])).toBeNull();
  });

  it('période la plus récente d\'une équipe', () => {
    expect(latestSpell(spells, 'x')?.coach).toBe('B');
    expect(latestSpell(spells, 'absente')).toBeUndefined();
  });

  it('simulation d\'arrivée : constante + club x style actuel + entraîneur x signature', () => {
    const out = simulateArrival({ possession: 1 }, { possession: -2 }, { possession: { intercept: 0.1, club: 0.5, coach: 0.3, ci: [0.2, 0.4] } });
    expect(out.possession).toBeCloseTo(0.1 + 0.5 - 0.6, 10);
  });
});

describe('formats', () => {
  it('écrit les nombres à la française', () => {
    expect(frNumber(-0.008, 3, true)).toBe('−0,008');
    expect(frNumber(0.15, 2, true)).toBe('+0,15');
    expect(frNumber(1234.5, 1)).toBe('1 234,5');
    expect(frPercent(0.0824, 1)).toBe('8,2 %');
  });
});
