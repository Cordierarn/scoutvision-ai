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

/** Résultat de référence de l'étape 2B (benchmark marché historique) publié pour la page produit */
export interface MarketBenchmark {
  schemaVersion: string; generatedAt: string; headline: string; divergence: string; reference: string;
  periods: Record<string, string>; dateRanges?: Record<string, [string, string] | null>; coverage: { matches: number; matchedRate: number | null; closing1x2Rate: number | null };
  seasons: Record<string, { population: number; logLoss: Record<string, number>; vsMarket: Record<string, { delta: number; ci90: [number, number]; pModelBetter: number }> } | null>;
  pool: Record<string, { selectedWeight: number; interpretation: string }>;
  divergenceBuckets: Record<string, { bucket: string; outcomes: number; matches: number; meanModelProbability: number | null; meanMarketProbability: number | null; observedFrequency: number | null;
    modelHigher: { outcomes: number; meanModel: number | null; meanMarket: number | null; observedFrequency: number | null }; logLossDifferential: number | null }[] | null>;
  matchValidation: Record<string, Record<string, number>>;
  limits: string[];
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

async function fetchOptionalJSON<T>(path: string): Promise<T | null> {
  const response = await fetch(path);
  const isJson = (response.headers.get('content-type') || '').includes('json');
  if (response.status === 404 || (response.ok && !isJson)) return null;
  if (!response.ok) throw new Error(`Chargement impossible (${response.status})`);
  return response.json();
}

function loadOptional<T>(path: string): Promise<T | null> {
  let pending = cache.get(path) as Promise<T | null> | undefined;
  if (!pending) {
    pending = fetchOptionalJSON<T>(path);
    pending.catch(() => cache.delete(path));
    cache.set(path, pending);
  }
  return pending;
}


// ----- Suggestions de paris (Labo paris, onglet Matchs à venir) : artefact privé calculé par le pipeline -----
export type SuggestionProfile = 'sur' | 'equilibre' | 'grosse_cote';
export type StakeMode = 'shrink_kelly' | 'kelly' | 'fixed';
export interface Suggestion {
  rank: number; marketId: number; outcomeId: number; family: string; label: string;
  odds: number; oddsAt: string; p: number; ev: number;
  stakeFraction: number; stakeMode: StakeMode; reasons: string[];
  /** Étape 1 du moteur quantitatif : probabilité sharp (Shin), probabilité de référence (pool), espérance face à elle */
  pSharp?: number | null; pRef?: number; evRef?: number | null; poolW?: number | null; sharpBookmaker?: string | null; sharpAt?: string | null;
  warnings?: string[]; verdict?: 'bet' | 'no_bet' | 'non_evalue';
}
export interface SuggestionCombo {
  labels: string[]; marketIds: number[]; outcomeIds: number[]; jointP: number; odds: number; ev: number;
  stakeFraction: number; stakeMode: StakeMode;
}
/** Meilleure sélection du modèle refusée par le coupe-circuit, et pourquoi (libellés calculés par le pipeline). */
export interface NoBet { label: string; family: string; odds: number; p: number; pSharp: number | null; evRef: number | null; reasons: string[]; codes: string[] }
export interface TeamFlags {
  opd: { matches: number; goalsMinusXg: number; pointsMinusXp: number; overperforming: boolean } | null;
  dependency: { player: string; share: number; rapmNet: number | null; strong: boolean } | null;
  overperforming: boolean; hub: string | null;
}
export interface SuggestionMatch {
  matchId: string; competition: string; date: string; home: string; away: string;
  status: 'ok' | 'no_odds'; kickoff?: string; oddsAt?: string; oddsStale?: boolean; xg?: [number, number];
  evaluated?: number; excluded?: Record<string, number>;
  profiles?: Record<SuggestionProfile, { suggestions: Suggestion[]; combo: SuggestionCombo | null }>;
  noBet?: NoBet | null; sharpCoverage?: number | null; teams?: { home: TeamFlags; away: TeamFlags };
}
/** CLV : part des paris où la clôture sharp est connue, CLV moyen et part des paris qui la battent. */
export interface ClvBlock { clvBets?: number; meanClv?: number | null; clvBeatRate?: number | null }
export interface BilanBlock extends ClvBlock { bets: number; hitRate: number | null; returnFlat: number | null }
export interface BilanProfile {
  overall: BilanBlock & { finalBankroll: number; maxDrawdown: number; curve: { date: string; bankroll: number }[] };
  combos: BilanBlock; byFamily: Record<string, BilanBlock>; byCompetition: Record<string, BilanBlock>;
}
export interface SuggestionsIndex {
  schemaVersion: string; generatedAt: string; season: string; bookmaker: string;
  profiles: { id: SuggestionProfile; label: string }[]; defaultProfile: SuggestionProfile; defaultBankroll: number;
  rules: {
    minOdds: number; bigOdds: number; maxAgeHours: number; capPerBet: number; capPerMatch: number;
    kappa?: number; capHighOdds?: number; highOdds?: number; evMin?: number; evMinLowMargin?: number; evMax?: number; edgeMax?: number; favoriteOdds?: number; lineupHours?: number; combos?: boolean;
    kellyFraction?: number; fixedStake?: number;   // artefacts antérieurs à l'étape 1
  };
  reference?: { bookmakers: string[]; method: string; poolWeights: Record<string, number>; blockLabels: Record<string, string>; warningLabels: Record<string, string> };
  matches: SuggestionMatch[];
  bilan: { start: number; profiles: Record<SuggestionProfile, BilanProfile> } | null;
  journal: { published: number; settled: number; byProfile: Record<string, BilanBlock> };
  evenings?: EveningSummary[];
  history?: HistoryDay[];
}
/** Statut d'un pari réglé sur le score réel (demi-gains et remboursements des handicaps asiatiques). */
export type BetStatus = 'won' | 'lost' | 'void' | 'half_won' | 'half_lost' | 'pending';
/** Pari d'une soirée suivie (profil Équilibré, mises sur 300 €) ; `legs` > 0 pour un combiné. */
export interface EveningBet { match: string; label: string; legs: number; odds: number; stake: number; status: BetStatus; profit: number | null }
export interface EveningSummary {
  date: string; bets: number; won: number; stake: number; profit: number | null; cumulative: number; settled: boolean; details?: EveningBet[];
}
/** Suggestion publiée avant le coup d'envoi (dernière publication), avec son règlement ; `realised` pour 1 € misé. */
export interface HistoryBet {
  label: string; family: string; odds: number; p: number; ev: number; stakeFraction: number; stakeMode: StakeMode;
  status: BetStatus; realised: number | null;
  pSharp?: number | null; evRef?: number | null; clv?: number | null;
}
export interface HistoryMatch {
  matchId: string; competition: string; kickoff: string; home: string | null; away: string | null; score: [number, number] | null;
  profiles: Partial<Record<SuggestionProfile, HistoryBet[]>>;
}
export interface HistoryDay { date: string; matches: HistoryMatch[] }

export const replayData = {
  marketBenchmark: () => loadOptional<MarketBenchmark>('/data/forecast/market_benchmark.json'),
  suggestions: () => loadOptional<SuggestionsIndex>('/data/forecast/suggestions/index.json'),
  index: () => load<ReplayIndex>('/data/forecast/replays/index.json'),
  summary: () => load<ReplaySummary>('/data/forecast/replays/summary.json'),
  season: (competition: string, season: string) => load<ReplaySeasonFile>(`/data/forecast/replays/${encodeURIComponent(competition)}/${encodeURIComponent(season)}.json`),
  /** Pour les tests : vide le cache */
  reset: () => cache.clear(),
};
