import { describe, expect, it } from 'vitest';
import { adaptiveMinutes, progressLabel, seasonProgress } from './seasonProgress';
import { TeamStats } from '../types';

const team = (competition: string, Matches: number, i: number): TeamStats => ({ team_id: `t${competition}${i}`, team: `Équipe ${i}`, competition, league: competition, season: '2026-27', Matches });
const league = (competition: string, n: number, played: number) => Array.from({ length: n }, (_, i) => team(competition, played - (i % 2), i));

describe('seasonProgress', () => {
  it('saison terminée : part 1, seuil de base', () => {
    expect(seasonProgress({ season: '2025-26', generatedAt: '2026-10-28T14:17:05Z', teams: league('FRA', 18, 34) })).toEqual({ progress: 1, basis: 'complete' });
    expect(adaptiveMinutes(500, 1)).toBe(500);
    expect(progressLabel({ progress: 1, basis: 'complete' })).toBeNull();
  });
  it('saison en cours, championnat classique : part sur les journées jouées', () => {
    const p = seasonProgress({ season: '2026-27', generatedAt: '2026-10-28T14:17:05Z', teams: [...league('ENG', 20, 6), ...league('FRA', 18, 9)], competition: 'ENG' });
    expect(p).toEqual({ progress: 6 / 38, basis: 'matches', played: 6, expected: 38 });
    expect(adaptiveMinutes(500, p.progress)).toBe(90);                 // plancher 90
    expect(adaptiveMinutes(900, 9 / 34)).toBe(240);
    expect(progressLabel(p)).toBe('16 % de la saison (6 journées sur 38)');
    // Sans compétition : médiane des championnats mesurables (ENG 6/38 = 16 %, FRA 9/34 = 26 %, ARG non mesurable)
    const all = seasonProgress({ season: '2026-27', generatedAt: '2026-10-28T14:17:05Z', teams: [...league('ENG', 20, 6), ...league('FRA', 18, 9), ...league('ARG', 30, 33)] });
    expect(all).toEqual({ progress: (6 / 38 + 9 / 34) / 2, basis: 'matches', leagues: 2 });
    expect(progressLabel(all)).toBe('21 % de la saison (médiane de 2 championnats)');
    expect(seasonProgress({ season: '2026-27', generatedAt: '2026-10-28T14:17:05Z', teams: league('ARG', 30, 33) }).basis).toBe('time');
  });
  it('calendrier non classique ou matchs au-delà du calendrier : part au temps écoulé', () => {
    const arg = seasonProgress({ season: '2026', seasonLabel: '2026', generatedAt: '2026-10-28T14:17:05Z', teams: league('ARG', 30, 33), competition: 'ARG' });
    expect(arg.basis).toBe('time');
    expect(arg.progress).toBeCloseTo((Date.UTC(2026, 9, 28, 14, 17) - Date.UTC(2026, 0, 1)) / (Date.UTC(2026, 11, 31, 23, 59) - Date.UTC(2026, 0, 1)), 3);
    const eu = seasonProgress({ season: '2026-27', generatedAt: '2026-10-28T14:17:05Z', teams: league('XXX', 12, 30), competition: 'XXX' });   // 30 > 22 attendus
    expect(eu.basis).toBe('time');
    expect(eu.progress).toBeCloseTo((Date.UTC(2026, 9, 28, 14, 17) - Date.UTC(2026, 7, 1)) / (Date.UTC(2027, 5, 30, 23, 59) - Date.UTC(2026, 7, 1)), 3);
    expect(progressLabel(eu)).toMatch(/% de la saison \(au calendrier\)/);
  });
  it('bornes : jamais sous 5 % ni au-dessus de 1 ; seuil arrondi à 10, entre 90 et la base', () => {
    expect(seasonProgress({ season: '2026-27', generatedAt: '2026-08-02T00:00:00Z', now: new Date('2026-08-02T00:00:00Z') }).progress).toBe(0.05);
    expect(adaptiveMinutes(500, 0.42)).toBe(210);
    expect(adaptiveMinutes(500, 2)).toBe(500);
    expect(adaptiveMinutes(500, 0)).toBe(90);
  });
});
