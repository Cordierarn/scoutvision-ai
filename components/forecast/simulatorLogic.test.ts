import { describe, expect, it } from 'vitest';
import { Replay, ReplayIndex, ReplaySeasonFile, ReplayTeam } from '../../services/replayData';
import {
  APPROXIMATE_TIEBREAK, ROLLING_KNOWLEDGE, comparison, competitions, defaultSelection, distributionSum, findReplay, headline, modelOptions,
  needsApproximateBanner, objectiveColumns, pointOptions, seasonsOf, simulated,
} from './simulatorLogic';

// Données fictives au format de /data/forecast/replays (aucune donnée réelle)
const team = (id: string, name: string, meanRank: number, pTitle: number, actualRank: number, dist: number[]): ReplayTeam => ({
  id, name, current: { points: 30, rank: actualRank }, rank: { mean: meanRank, median: Math.round(meanRank), p5: 1, p25: 1, p75: 3, p95: 4 },
  points: { mean: 60 - 5 * meanRank, median: 60, p10: 50, p90: 70 }, dist, objectives: { title: pTitle, continental: 0.5, relegation: 0.0 },
  actual: { rank: actualRank, points: 62 - 5 * actualRank },
});
const teams = [team('fx_a', 'Fixture A', 1.2, 0.8, 2, [0.8, 0.2, 0, 0]), team('fx_b', 'Fixture B', 1.9, 0.2, 1, [0.2, 0.7, 0.1, 0]),
  team('fx_c', 'Fixture C', 3.0, 0, 3, [0, 0.1, 0.8, 0.1]), team('fx_d', 'Fixture D', 3.9, 0, 4, [0, 0, 0.1, 0.9])];
const sim = (point: Replay['point'], model: Replay['model']): Replay => ({
  point, date: '2025-01-01T00:00:00', model, status: 'simulated', played: 6, remaining: 6, goalPolicy: 'model', approximateTiebreakShare: 0.002,
  modelVersion: '1.0.0', fittedAt: ['2024-12-26T00:00:00', '2025-05-22T00:00:00'], resultHash: 'abc', teams, actualApproximateTiebreak: false,
  errors: { maePoints: 3, maeRank: 1, spearman: 0.9, pointsInterval80Coverage: 0.8, rankLogScore: 1.2, top1Hit: false },
});
const unavailable = (point: Replay['point'], model: Replay['model']): Replay => ({
  point, date: '2024-08-01T00:00:00', model, status: 'unavailable', reason: '2 rencontres restantes sans prévision du modèle', coverage: { covered: 10, remaining: 12 },
});
const file: ReplaySeasonFile = {
  schemaVersion: '1.0.0', competition: 'FIX', season: '2024-25', generatedAt: '2026-11-02T10:00:00+00:00', simulationVersion: '1.0.0', nSims: 20000, seed: 7,
  rules: { name: 'Fixture League', teams: 4, rounds: 6, pointsWin: 3, pointsDraw: 1, tiebreaks: ['points', 'goal_difference', 'goals_for'], exact: true, approximations: [],
    objectives: { title: { label: 'Titre', positions: [1, 1] }, continental: { label: 'Coupe (2)', positions: [1, 2] }, relegation: { label: 'Relégation directe', positions: [4, 4] } } },
  teams: Object.fromEntries(teams.map(t => [t.id, t.name])),
  replays: [unavailable('start', 'scoutvision_reproduced'), sim('q50', 'scoutvision_reproduced'), sim('q50', 'elo'), unavailable('q50', 'xg_rolling'), sim('q75', 'scoutvision_reproduced')],
};
const index: ReplayIndex = {
  schemaVersion: '1.0.0', generatedAt: '2026-11-02T10:00:00+00:00', simulationVersion: '1.0.0', nSims: 20000, seed: 7, defaultModel: 'scoutvision_reproduced',
  competitions: [{ key: 'FIX', name: 'Fixture League', teams: 4, exact: true, seasons: [{ season: '2024-25', points: { q50: '2025-01-01T00:00:00' }, simulated: { scoutvision_reproduced: ['q50', 'q75'] } }] },
    { key: 'ZZZ', name: 'Autre ligue fictive', teams: 20, exact: false, seasons: [{ season: '2025-26', points: {}, simulated: {} }] }],
  models: [{ id: 'scoutvision_reproduced', label: 'ScoutVision', technical: 'scoutvision_reproduced', usesOdds: false }, { id: 'elo', label: 'Elo', technical: 'elo', usesOdds: false },
    { id: 'xg_rolling', label: 'Modèle xG', technical: 'xg_rolling · fenêtre 20', usesOdds: false }],
  replayPoints: [{ id: 'start', label: 'Début' }, { id: 'q25', label: '25 %' }, { id: 'q50', label: '50 %' }, { id: 'q75', label: '75 %' }],
  limitations: ['limite fictive'], unsupported: { USA: 'conférences et play-offs' },
};

describe('simulatorLogic', () => {
  it('parses the index: competitions sorted, seasons descending, unsupported leagues absent from the selector', () => {
    expect(competitions(index).map(c => c.key)).toEqual(['ZZZ', 'FIX']);
    expect(seasonsOf(index, 'FIX')).toEqual(['2024-25']);
    expect(competitions(index).some(c => c.key === 'USA')).toBe(false);
  });

  it('selects a precomputed replay and hides incomplete ones', () => {
    expect(simulated(file).map(r => `${r.point}:${r.model}`)).toEqual(['q50:scoutvision_reproduced', 'q50:elo', 'q75:scoutvision_reproduced']);
    expect(findReplay(file, 'q50', 'scoutvision_reproduced')?.status).toBe('simulated');
    expect(findReplay(file, 'start', 'scoutvision_reproduced')?.status).toBe('unavailable');
    const points = pointOptions(file, 'scoutvision_reproduced', { start: 'Début', q50: '50 %', q75: '75 %' });
    expect(points.find(p => p.id === 'start')).toMatchObject({ available: false, reason: 'Indisponible : 2 rencontres restantes sans prévision du modèle.' });
    expect(points.find(p => p.id === 'q50')?.available).toBe(true);
  });

  it('marks unavailable models and falls back without the market', () => {
    const models = modelOptions(file, 'q50', index);
    expect(models.map(m => m.id)).toEqual(['scoutvision_reproduced', 'elo', 'xg_rolling']);           // pas de marché dans ce fichier : pas d'option marché
    expect(models.find(m => m.id === 'xg_rolling')).toMatchObject({ available: false });
    expect(defaultSelection(file, 'xg_rolling', 'q50')).toEqual({ point: 'q50', model: 'scoutvision_reproduced' });
    expect(defaultSelection(file, 'scoutvision_reproduced', 'start')).toEqual({ point: 'q50', model: 'scoutvision_reproduced' });
    expect(defaultSelection({ ...file, replays: [unavailable('q50', 'elo')] }, 'elo')).toBeNull();
  });

  it('checks ranking distributions and objective columns from the rules', () => {
    for (const t of teams) expect(distributionSum(t.dist)).toBeCloseTo(1, 9);
    expect(objectiveColumns(file.rules.objectives).map(c => c.label)).toEqual(['Titre', 'Top 2', 'Relégation']);
    expect(objectiveColumns({ promotion: { label: 'Montée directe', positions: [1, 2] }, title: { label: 'Titre', positions: [1, 1] } }).map(c => c.key)).toEqual(['title', 'promotion']);
  });

  it('compares simulation and reality and builds the headline', () => {
    expect(comparison(teams[0])).toEqual({ rankGap: 1.2 - 2, pointsGap: 54 - 52 });
    const h = headline(teams);
    expect(h.favourite?.id).toBe('fx_a'); expect(h.pTitle).toBe(0.8); expect(h.champion?.id).toBe('fx_b');
    expect(headline([])).toEqual({ favourite: null, pTitle: null, champion: null });
  });

  it('knows when the methodological banners apply', () => {
    expect(ROLLING_KNOWLEDGE).toContain('connaissance glissante');
    expect(ROLLING_KNOWLEDGE).not.toContain('savait exactement');
    expect(APPROXIMATE_TIEBREAK).toContain('départage simplifié');
    expect(needsApproximateBanner(true, 0.002)).toBe(false);
    expect(needsApproximateBanner(true, 0.34)).toBe(true);
    expect(needsApproximateBanner(false, 0)).toBe(true);
  });
});
