/**
 * ScoutVision AI - Replays de saison (Simulateur de saison, étape 3 de la recherche prévision)
 *
 *   /data/forecast/replays/index.json                  compétitions, saisons, points de replay, modèles, limites
 *   /data/forecast/replays/summary.json                évolution de l'erreur, comparaison des modèles, calibration des objectifs
 *   /data/forecast/replays/{competition}/{season}.json règles, équipes, replays précalculés
 *
 * Le navigateur ne simule rien : il sélectionne un replay déjà calculé (20 000 saisons, graine 7).
 */

export type ReplayPoint = 'start' | 'q25' | 'q50' | 'q75';
export type ReplayModel = 'scoutvision_reproduced' | 'elo' | 'dixon_coles_decay' | 'xg_rolling' | 'market_closing';

export interface ReplayIndex {
  schemaVersion: string;
  generatedAt: string;
  simulationVersion: string;
  nSims: number;
  seed: number;
  defaultModel: ReplayModel;
  competitions: { key: string; name: string; teams: number; exact: boolean; seasons: { season: string; points: Record<string, string>; simulated: Record<string, ReplayPoint[]> }[] }[];
  models: { id: ReplayModel; label: string; technical: string; usesOdds: boolean }[];
  replayPoints: { id: ReplayPoint; label: string }[];
  limitations: string[];
  unsupported: Record<string, string>;
}

export interface Objective { label: string; positions: [number, number] }

export interface ReplayRules {
  name: string; teams: number; rounds: number; pointsWin: number; pointsDraw: number; tiebreaks: string[]; exact: boolean;
  approximations: string[]; objectives: Record<string, Objective>;
}

export interface ReplayTeam {
  id: string;
  name: string;
  current: { points: number; rank: number } | null;
  rank: { mean: number; median: number; p5: number; p25: number; p75: number; p95: number };
  points: { mean: number; median: number; p10: number; p90: number };
  dist: number[];
  objectives: Record<string, number>;
  actual: { rank: number | null; points: number | null };
}

export interface ReplayErrors {
  maePoints: number; maeRank: number; spearman: number; pointsInterval80Coverage: number; rankLogScore: number;
  top1Hit?: boolean; championProbability?: number; continentalBrier?: number; promotionBrier?: number; relegationBrier?: number;
}

export type Replay =
  | { point: ReplayPoint; date: string; model: ReplayModel; status: 'unavailable'; reason: string; coverage: { covered: number | null; remaining: number | null } | null }
  | { point: ReplayPoint; date: string; model: ReplayModel; status: 'simulated'; played: number; remaining: number; goalPolicy: string;
      approximateTiebreakShare: number; modelVersion: string | null; fittedAt: [string | null, string | null]; resultHash: string;
      teams: ReplayTeam[]; errors: ReplayErrors; actualApproximateTiebreak: boolean };

export interface ReplaySeasonFile {
  schemaVersion: string; competition: string; season: string; generatedAt: string; simulationVersion: string; nSims: number; seed: number;
  rules: ReplayRules; teams: Record<string, string>; replays: Replay[];
}

export interface EvolutionPoint { maeRank: number; maePoints: number; spearman: number; coverage80: number; top1: number; replays: number }

export interface ReplaySummary {
  schemaVersion: string; generatedAt: string;
  evolution: Record<string, Partial<Record<ReplayPoint, EvolutionPoint>>>;
  comparison: { model: string; replays: number; maeRank: number; maePoints: number; spearman: number; top1: number; coverage80: number }[];
  objectiveCalibration: { model: string; bins: { objective: string; label: string; bins: { lo: number; hi: number; n: number; predicted: number; observed: number }[] }[] };
  goalPolicyImpact: { meanAbsDeltaTitle: number | null; meanAbsDeltaRelegation: number | null };
}

const cache = new Map<string, Promise<unknown>>();

async function fetchJSON<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Chargement impossible (${response.status})`);
  return response.json();
}

function load<T>(path: string): Promise<T> {
  let pending = cache.get(path) as Promise<T> | undefined;
  if (!pending) {
    pending = fetchJSON<T>(path);
    pending.catch(() => cache.delete(path));          // un échec ne reste pas en cache : Réessayer recharge
    cache.set(path, pending);
  }
  return pending;
}

export const replayData = {
  index: () => load<ReplayIndex>('/data/forecast/replays/index.json'),
  summary: () => load<ReplaySummary>('/data/forecast/replays/summary.json'),
  season: (competition: string, season: string) => load<ReplaySeasonFile>(`/data/forecast/replays/${encodeURIComponent(competition)}/${encodeURIComponent(season)}.json`),
  /** Pour les tests : vide le cache */
  reset: () => cache.clear(),
};
