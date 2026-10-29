import { describe, expect, it } from 'vitest';
import { PlayerData } from '../types';
import {
  MIN_COVERAGE, componentsForPosition, defaultFilters, dimensionPairs, explainSimilarity, findSimilar, isCandidate,
  rolePairs, scoreFromComponents, similarity, similarityComponents,
} from './similarity';
import { SIMILARITY_METRICS } from './positionMetrics';
import { comparisonEntry, resolveSelection } from './comparison';

const ST = SIMILARITY_METRICS.FWD;
const row = (over: Record<string, unknown> = {}): PlayerData => ({
  'Player ID': 'p1', Player: 'Alex Martin', 'Team ID': 't1', Team: 'Club A', Competition: 'FRA', League: 'Ligue 1 2026-27',
  Season: '2026-27', Position: 'ST', 'League tier': 1, Age: 25, 'Minutes played': 1500, ...over,
} as PlayerData);
const withPct = (values: Record<string, number | null>, over: Record<string, unknown> = {}) =>
  row({ ...Object.fromEntries(Object.entries(values).map(([k, v]) => [`${k} pct`, v])), ...over });
const full = (p: number) => Object.fromEntries(ST.map(k => [k, p]));

describe('score de similarité', () => {
  it('composantes = métriques fixes du poste (SIMILARITY_METRICS)', () => {
    expect(componentsForPosition('ST').map(c => c.key)).toEqual(ST);
    expect(componentsForPosition('WB').map(c => c.key)).toEqual(SIMILARITY_METRICS.FB);
    expect(componentsForPosition(undefined)).toEqual([]);
  });

  it('deux profils identiques → 100', () => {
    const r = similarity(withPct(full(63)), withPct(full(63), { 'Player ID': 'p2' }));
    expect(r.score).toBe(100);
    expect(r.covered).toBe(12);
  });

  it('écarts connus → score exact (100 − écart moyen)', () => {
    const ref = withPct({ ...full(50), 'Goals per 90': 82, 'xG per 90': 91, 'npxG per 90': 63 });
    const cand = withPct({ ...full(50), 'Goals per 90': 78, 'xG per 90': 88, 'npxG per 90': 70 }, { 'Player ID': 'p2' });
    const r = similarity(ref, cand);
    // 9 écarts à 0 et 4, 3, 7 : moyenne 14/12
    expect(r.score).toBeCloseTo(100 - 14 / 12, 10);
    const three = r.components.filter(c => c.delta);
    expect(three.map(c => c.delta)).toEqual([4, 3, 7]);
    expect(scoreFromComponents(three, 3).score).toBeCloseTo(100 - 14 / 3, 10);   // l'exemple du cahier des charges : 95,33
  });

  it('métrique absente : ignorée et renormalisée, jamais P0', () => {
    const ref = withPct({ ...full(60), 'xA per 90': null });
    const cand = withPct({ ...full(60), 'Dribbles per 90': 20 }, { 'Player ID': 'p2' });
    const r = similarity(ref, cand);
    expect(r.covered).toBe(11);
    expect(r.components.find(c => c.key === 'xA per 90')).toMatchObject({ pRef: null, delta: null });
    expect(r.score).toBeCloseTo(100 - 40 / 11, 10);
  });

  it('frontière exacte : 8 métriques → score, 7 → données insuffisantes', () => {
    const cand = withPct(full(60), { 'Player ID': 'p2' });
    const eight = withPct(Object.fromEntries(ST.slice(0, 8).map(k => [k, 50])));
    const seven = withPct(Object.fromEntries(ST.slice(0, 7).map(k => [k, 50])));
    expect(MIN_COVERAGE).toBe(8);
    expect(similarity(eight, cand)).toMatchObject({ covered: 8, score: 90 });
    expect(similarity(seven, cand)).toMatchObject({ covered: 7, score: null });
  });

  it('couverture insuffisante → pas de score', () => {
    const few = Object.fromEntries(ST.slice(0, MIN_COVERAGE - 1).map(k => [k, 50]));
    expect(similarity(withPct(few), withPct(full(50), { 'Player ID': 'p2' })).score).toBeNull();
    expect(similarity(withPct(full(50)), withPct({}, { 'Player ID': 'p2' })).score).toBeNull();
  });

  it('toujours fini et dans [0, 100]', () => {
    for (const [a, b] of [[0, 100], [100, 0], [0, 0], [37, 91]]) {
      const s = similarity(withPct(full(a)), withPct(full(b), { 'Player ID': 'p2' })).score as number;
      expect(Number.isFinite(s)).toBe(true);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(100);
    }
    expect(similarity(withPct(full(0)), withPct(full(100), { 'Player ID': 'p2' })).score).toBe(0);
  });

  it('décomposition = score global', () => {
    const ref = withPct(Object.fromEntries(ST.map((k, i) => [k, 10 + i * 7])));
    const cand = withPct(Object.fromEntries(ST.map((k, i) => [k, 90 - i * 5])), { 'Player ID': 'p2' });
    const r = similarity(ref, cand);
    const mean = r.components.reduce((s, c) => s + (c.delta as number), 0) / r.components.length;
    expect(r.score).toBeCloseTo(100 - mean, 10);
    const { closest, furthest } = explainSimilarity(r.components, 3);
    expect(closest.map(c => c.delta)).toEqual([...closest.map(c => c.delta)].sort((x, y) => (x as number) - (y as number)));
    expect(furthest[0].delta).toBe(Math.max(...r.components.map(c => c.delta as number)));
  });

  it('« moins = mieux » ne change pas la proximité : P90 et P90 restent identiques', () => {
    const r = similarity(withPct({ ...full(50), 'Big chances missed per 90': 90 }), withPct({ ...full(50), 'Big chances missed per 90': 90 }, { 'Player ID': 'p2' }));
    expect(r.score).toBe(100);
    expect(r.components.find(c => c.key === 'Big chances missed per 90')?.delta).toBe(0);
  });
});

describe('candidats et filtres', () => {
  const ref = withPct(full(50));
  it('exclut la référence, ses lignes de la même saison ; garde ses autres saisons', () => {
    expect(isCandidate(ref, withPct(full(50), { Competition: 'UCL', League: 'UCL 2026-27' }))).toBe(false);
    expect(isCandidate(ref, withPct(full(50), { League: 'Ligue 1 2025-26', Season: '2025-26' }))).toBe(true);
    expect(isCandidate(ref, withPct(full(50), { 'Player ID': 'p2' }))).toBe(true);
    // même saison, autre club (joueur multi-clubs) : exclu ; autre saison, même club et compétition : candidat
    expect(isCandidate(ref, withPct(full(50), { 'Team ID': 't2', Team: 'Club B' }))).toBe(false);
    expect(isCandidate(ref, withPct(full(50), { League: 'Ligue 1 2024-25', Season: '2024-25' }))).toBe(true);
    // une ligne ne se compare jamais à elle-même, quelle que soit la saison chargée
    expect(isCandidate(ref, { ...ref })).toBe(false);
  });

  it('filtres : poste, âge, minutes, compétition, niveau ; comptage des exclus pour couverture', () => {
    const data = [
      ref,
      withPct(full(52), { 'Player ID': 'a' }),
      withPct(full(52), { 'Player ID': 'b', Position: 'W' }),
      withPct(full(52), { 'Player ID': 'c', Age: 31 }),
      withPct(full(52), { 'Player ID': 'd', 'Minutes played': 300 }),
      withPct(full(52), { 'Player ID': 'e', Competition: 'ENG', 'League tier': 1 }),
      withPct(full(52), { 'Player ID': 'f', 'League tier': 3 }),
      withPct({ 'Goals per 90': 50 }, { 'Player ID': 'g' }),
    ];
    const f = { ...defaultFilters(true), ageMax: 30, competition: 'FRA', tier: 1 };
    const s = findSimilar(ref, data, f);
    expect(s.results.map(r => r.player['Player ID'])).toEqual(['a']);
    expect(s.candidates).toBe(2);        // a et g
    expect(s.insufficient).toBe(1);      // g
    expect(s.referenceCovered).toBe(12);
    expect(defaultFilters(true).minMinutes).toBe(450);
    expect(defaultFilters(false).minMinutes).toBe(900);
  });

  it('classement par score décroissant, limite respectée', () => {
    const data = [60, 70, 55, 90].map((p, i) => withPct(full(p), { 'Player ID': `x${i}` }));
    const s = findSimilar(ref, data, defaultFilters(true), 2);
    expect(s.results.map(r => r.score)).toEqual([95, 90]);
  });
});

describe('lectures complémentaires', () => {
  it('dimensions : masquées pour les gardiens hors couverture, pas de nouveau score', () => {
    const a = withPct({ 'xA per 90': 80, 'Key passes per 90': 60, 'Shot-creating actions per 90': 70, 'npxG per 90': 50, 'Touches in box per 90': 50, 'Shots on target per 90': 50 });
    const b = withPct({ 'xA per 90': 20, 'Key passes per 90': 40, 'Shot-creating actions per 90': 30, 'npxG per 90': 50 }, { 'Player ID': 'p2' });
    const pairs = dimensionPairs(a, b);
    expect(pairs.find(d => d.key === 'creation')).toEqual({ key: 'creation', label: 'Création', ref: 70, candidate: 30 });
    expect(pairs.find(d => d.key === 'finishing')).toMatchObject({ ref: 50, candidate: 50 });  // renormalisé sur les métriques présentes
    expect(pairs.some(d => d.key === 'goalkeeping')).toBe(false);
    const gk = withPct({ 'Prevented goals per 90': 70, 'Save rate, %': 60, 'xA per 90': 10 }, { Position: 'GK' });
    const gk2 = withPct({ 'Prevented goals per 90': 50, 'Save rate, %': 50, 'xA per 90': 15 }, { Position: 'GK', 'Player ID': 'p2' });
    const keys = dimensionPairs(gk, gk2).map(d => d.key);
    expect(keys).toContain('goalkeeping');
    expect(keys).not.toContain('finishing');
  });

  it('rôles : indices roleIndex des rôles compatibles, seulement à poste égal', () => {
    const a = withPct(full(80)), b = withPct(full(40), { 'Player ID': 'p2' });
    const pairs = rolePairs(a, b);
    expect(pairs.length).toBeGreaterThan(0);
    pairs.forEach(p => { expect(p.ref).toBeGreaterThanOrEqual(p.candidate); });
    expect(rolePairs(a, withPct(full(40), { Position: 'W' }))).toEqual([]);
  });
});

describe('composantes de la paire', () => {
  it('garde l\'ordre du poste et le libellé', () => {
    const c = similarityComponents(withPct(full(50)), withPct(full(50), { 'Player ID': 'p2' }));
    expect(c.map(x => x.key)).toEqual(ST);
    expect(c[0].label).toBe('Buts par 90');
  });
});

describe('transmission à la Comparaison', () => {
  it('l\'entrée désigne la ligne joueur-saison-club-compétition exacte, pas seulement le joueur', () => {
    const ref = withPct(full(50));
    const sameSeasonOtherClub = withPct(full(50), { 'Team ID': 't2', Team: 'Club B' });
    const otherSeason = withPct(full(50), { League: 'Ligue 1 2024-25', Season: '2024-25' });
    const cup = withPct(full(50), { Competition: 'UCL', League: 'UCL 2026-27' });
    const data = [cup, otherSeason, sameSeasonOtherClub, ref];
    expect(resolveSelection([comparisonEntry(ref), comparisonEntry(otherSeason)], data).players).toEqual([ref, otherSeason]);
    expect(resolveSelection([comparisonEntry(sameSeasonOtherClub)], data).players).toEqual([sameSeasonOtherClub]);
    expect(resolveSelection([comparisonEntry(cup)], data).players).toEqual([cup]);
  });
});
