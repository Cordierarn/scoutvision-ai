/**
 * ScoutVision AI - Données du Laboratoire (scripts/prepare_lab.py)
 *
 *   /data/lab/experiments.json   verdicts et chiffres de toutes les expériences
 *   /data/lab/coaches.json       périodes d'entraîneur, style, empreinte des entraîneurs
 *   /data/lab/elevator.json      probabilité d'être recruté par un championnat plus fort
 *   /data/lab/goals.json         valeur des buts en points, par joueur et par saison
 *   /data/lab/duos.json          affinités de passe des duos
 *   /data/lab/referees.json      sévérité des arbitres
 *   /data/lab/teams.json         vieillissement des effectifs, coups de pied arrêtés
 */

// validated : effet net ; partial : signal réel mais faible ; debunked : idée reçue démentie ;
// measured : mesure descriptive
export type Verdict = 'validated' | 'partial' | 'debunked' | 'measured';

type Interval = [number, number];

export interface LabExperiments {
  generatedAt: string;
  matches: number;
  leagueMatches: number;
  teamMatches: number;
  events: number;
  current: string;
  experiments: {
    coachChange: {
      changes: number; prePerf: number; otherPerf: number; naive: number; naiveCi: Interval; naivePoints: number;
      expectedRebound: number; effect: number; effectCi: Interval; effectPoints: number;
      curve: { x: number[]; changers: number[]; controls: number[] }; verdict: Verdict;
    };
    coachDna: { arrivals: number; coaches: number; imprint: Record<string, Imprint>; verdict: Verdict };
    coachResults: { pairs: number; r: number; ci: Interval; verdict: Verdict };
    referees: {
      reliability: Record<'cards' | 'pens' | 'bias', { r: number; referees: number }>;
      verdicts: Record<'cards' | 'pens' | 'bias', Verdict>;
    };
    goalValue: {
      goals: number; matches: number; meanValue: number; byState: Record<string, number>; scale: number;
      calibration: Record<string, { logLoss: number; bins: { predicted: number; observed: number; n: number }[] }>;
      curves: { minutes: number[]; byScore: Record<string, number[]> };
      perGoalReliability: { r: number; pairs: number }; verdict: Verdict;
    };
    momentum: {
      observations: number; season: string;
      logLoss: Record<'home' | 'away', { base: number; shots: number; momentum: number }>;
      quiet: { home: number[]; away: number[] }; verdict: Verdict;
    };
    elevator: { validation: ElevatorValidation; verify: ElevatorVerify | null; verdict: Verdict; stepUp: number };
    twins: {
      base: string; players: number; youngPlayers: number;
      all: TwinErrors; young: TwinErrors; verdict: Verdict;
    };
    duos: { pairs: number; reliability: number; sd: number; strong: number; verdict: Verdict };
    clock: { pairs: number; coef: number; ci: Interval; persistence: number; verdict: Verdict };
    setPieces: { mean: number; r: number; pairs: number; verdict: Verdict };
    luck: { teams: number; luckR: number; pointsR: number; xgdR: number; verdict: Verdict };
    availability: { median: number; r: number; pairs: number; verdict: Verdict };
    redCards: { matches: number; reduced: [number, number]; opponent: [number, number]; verdict: Verdict };
    gameState: {
      protect: StatePersistence; chase: StatePersistence; late: StatePersistence; verdict: Verdict;
    };
    fatigue: { matches: number; effect: number; ci: Interval; perDay: number; byRest: Record<string, number>; verdict: Verdict };
    styleMatchups: { rows: number; gain: number; ci: Interval; baseMse: number; verdict: Verdict };
  };
}

export interface Imprint {
  intercept: number;
  club: number;      // poids du style d'avant du club
  coach: number;     // poids du style de l'entraîneur dans son club précédent
  ci: Interval;      // intervalle du poids de l'entraîneur
}

export interface ElevatorValidation {
  base: string; pairs: number; rate: number; auc: number; brier: number; brierBase: number;
  quintiles: { predicted: number; observed: number }[];
  top: { n: number; hits: number };
  top100?: { n: number; hits: number };
}

export interface ElevatorVerify { base: string; season: string; top: number; seen: number; hits: number; rateSeen: number | null }

interface TwinErrors { unchanged: number; development: number; twins: number }
interface StatePersistence { mean: number; r: number; pairs: number }

export interface CoachSpell {
  coach: string; team_id: string; team: string; comp: string; start: string; end: string; n: number; perf: number;
  [dimension: string]: string | number;
}

export interface CoachesFile {
  dimensions: string[];
  imprint: Record<string, Imprint>;
  arrivals: number;
  coaches: number;
  spells: CoachSpell[];
}

export interface ElevatorRow {
  'Player ID': string; Player: string; Team: string; 'Team ID': string; Competition: string; Position: string;
  Age: number; best_role: string; best_index: number; 'Minutes share'?: number; p: number;
  observed?: number | null;                   // vérification : 1 monté, 0 non, null pas encore vu
  next_comp?: string | null;
}

export interface ElevatorFile {
  stepUp: number;
  levels: Record<string, number>;
  validation: ElevatorValidation;
  verify: ElevatorVerify | null;
  check: { season: string; rows: ElevatorRow[] } | null;
  provisional: { season: string; rows: ElevatorRow[] } | null;
}

export interface GoalRow {
  player_id: string; name: string; team_id: string; team: string; comp: string; app_season: string;
  goals: number; points: number; decisive: number; late: number; padding: number;
}

export interface DuoRow {
  comp: string; app_season: string; team_id: string; team: string; from_player_id: string; from_name: string;
  to_player_id: string; to_name: string; passes: number; expected: number; affinity: number;
}

export interface RefereeRow {
  referee: string; comp: string; matches: number; first: string; last: string; cards: number; cards_rel: number;
  cards_shrunk: number; pens: number; pens_shrunk: number;
}

export interface TeamRow {
  Competition: string; _app_season: string; 'Team ID': string; team: string; clock: number | null; age: number | null;
  set_pieces: number | null;
}

interface Columnar { columns: string[]; rows: unknown[][] }

/**
 * Format colonnes/lignes -> objets (les valeurs nulles restent null)
 */
export function fromColumnar<T>(data: Columnar): T[] {
  return data.rows.map(row => Object.fromEntries(data.columns.map((c, i) => [c, row[i]])) as T);
}

const cache = new Map<string, Promise<unknown>>();

async function fetchOptional<T>(path: string): Promise<T | null> {
  const response = await fetch(path);
  const isJson = (response.headers.get('content-type') || '').includes('json');
  if (response.status === 404 || (response.ok && !isJson)) return null;
  if (!response.ok) throw new Error(`Failed to load ${path}: ${response.status}`);
  return response.json();
}

function load<T>(file: string, transform: (raw: any) => T): Promise<T | null> {
  let pending = cache.get(file) as Promise<T | null> | undefined;
  if (!pending) {
    pending = fetchOptional<any>(`/data/lab/${file}`).then(raw => (raw ? transform(raw) : null));
    pending.catch(() => cache.delete(file));
    cache.set(file, pending);
  }
  return pending;
}

export const labData = {
  experiments: () => load<LabExperiments>('experiments.json', raw => raw),
  coaches: () => load<CoachesFile>('coaches.json', raw => ({ ...raw, spells: fromColumnar<CoachSpell>(raw.spells) })),
  elevator: () => load<ElevatorFile>('elevator.json', raw => ({
    ...raw,
    check: raw.check ? { season: raw.check.season, rows: fromColumnar<ElevatorRow>(raw.check) } : null,
    provisional: raw.provisional ? { season: raw.provisional.season, rows: fromColumnar<ElevatorRow>(raw.provisional) } : null,
  })),
  goals: () => load<GoalRow[]>('goals.json', raw => fromColumnar<GoalRow>(raw)),
  duos: () => load<{ reliability: number; rows: DuoRow[] }>('duos.json', raw => ({ reliability: raw.reliability, rows: fromColumnar<DuoRow>(raw) })),
  referees: () => load<{ reliability: Record<string, { r: number; referees: number }>; rows: RefereeRow[] }>(
    'referees.json', raw => ({ reliability: raw.reliability, rows: fromColumnar<RefereeRow>(raw.table) })),
  teams: () => load<{ coef: number; ci: Interval; rows: TeamRow[] }>('teams.json', raw => ({ coef: raw.coef, ci: raw.ci, rows: fromColumnar<TeamRow>(raw) })),
};
