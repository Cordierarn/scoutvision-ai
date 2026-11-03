/**
 * Fiabilité des métriques par 90 (modèle du pipeline : public/data/models/reliability.json) et joueurs
 * à faible temps de jeu (public/data/small_samples/{saison}.json).
 *
 * Le pipeline calibre, pour chaque métrique, une constante k : la part de signal d'une valeur observée sur
 * m minutes vaut m / (m + k) (test pair / impair sur les matchs). Le navigateur n'applique que cette formule
 * et l'intervalle qui en découle ; il ne recalcule aucun percentile.
 */

export interface ReliabilityBin { minutes: number; n: number; observed: number; predicted: number }
export interface MetricReliabilityParams {
  k: number;                          // minutes de « prior » : fiabilité = m / (m + k)
  kPitchapi: number | null;           // constante de lissage de PitchAPI pour la même métrique
  calibrated: boolean;
  minutesForReliable: number;         // minutes pour une fiabilité de 0,7
  trueSd: Record<string, number>;     // écart-type vrai entre joueurs, par rôle
  validation: ReliabilityBin[];
}
export interface ReliabilityModel {
  method: string;
  reliableAt: number;
  summary: { metrics: number; meanAbsCalibrationError: number | null; percentileGapVsPitchapi: number | null };
  metrics: Record<string, MetricReliabilityParams>;
}

export const RELIABLE = 0.7;
export const MODERATE = 0.4;
const Z90 = 1.645;

export type ReliabilityLevel = 'fiable' | 'moyenne' | 'faible';

/** Fiabilité (0-1) d'une valeur par 90 observée sur `minutes`, ou null sans minutes ni paramètres */
export function metricReliability(minutes: number | null | undefined, params: Pick<MetricReliabilityParams, 'k'> | undefined): number | null {
  if (!params || typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes <= 0 || !(params.k > 0)) return null;
  return minutes / (minutes + params.k);
}

export function reliabilityLevel(r: number): ReliabilityLevel {
  return r >= RELIABLE ? 'fiable' : r >= MODERATE ? 'moyenne' : 'faible';
}

/** Orange pour une fiabilité faible (avertissement), encre neutre sinon */
export function reliabilityClass(level: ReliabilityLevel): string {
  return level === 'faible' ? 'text-warn' : level === 'moyenne' ? 'text-ink-2' : 'text-ink-3';
}

/** Matchs complets (90 minutes) équivalents à un nombre de minutes, arrondis */
export const fullMatches = (minutes: number) => Math.max(1, Math.round(minutes / 90));

/** Au-delà de trois saisons pleines, le nombre exact de matchs n'a plus de sens pour un lecteur */
const MATCHES_CAP = 100;
export const matchesLabel = (matches: number) => (matches > MATCHES_CAP ? `plus de ${MATCHES_CAP} matchs` : `${matches} matchs`);

/**
 * Intervalle à 90 % autour d'une valeur : ± 1,645 × écart-type vrai du rôle × √(1 − fiabilité).
 * Borne basse ramenée à 0 (volumes par 90 positifs, sauf métriques signées comme les buts évités).
 */
export function valueInterval(value: number, reliability: number, trueSd: number | undefined, signed = false): [number, number] | null {
  if (!Number.isFinite(value) || trueSd === undefined || !(trueSd > 0)) return null;
  const half = Z90 * trueSd * Math.sqrt(Math.max(0, 1 - reliability));
  return [signed ? value - half : Math.max(0, value - half), value + half];
}

const SIGNED = new Set(['Prevented goals per 90', 'VAEP per 90', 'VAEP offensive per 90', 'VAEP defensive per 90', 'xT per 90']);
export const isSignedMetric = (metric: string) => SIGNED.has(metric);

const num = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
const pct = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });

export interface MetricReliability {
  metric: string;
  reliability: number;
  level: ReliabilityLevel;
  matchesForReliable: number;     // matchs complets pour atteindre 0,7
  interval: [number, number] | null;
}

/** Fiabilité d'une métrique d'un joueur (minutes et rôle de sa saison) ; null si la métrique n'est pas modélisée */
export function playerMetricReliability(model: ReliabilityModel | null | undefined, metric: string, minutes: number | undefined,
  role: string | undefined, value: number | undefined): MetricReliability | null {
  const params = model?.metrics?.[metric];
  const r = metricReliability(minutes, params);
  if (!params || r === null) return null;
  return {
    metric, reliability: r, level: reliabilityLevel(r), matchesForReliable: fullMatches(params.minutesForReliable),
    interval: typeof value === 'number' && role ? valueInterval(value, r, params.trueSd[role], isSignedMetric(metric)) : null,
  };
}

/** Texte d'infobulle : fiabilité, intervalle et minutes nécessaires */
export function reliabilityText(m: MetricReliability): string {
  const interval = m.interval ? `, intervalle à 90 % : ${num.format(m.interval[0])} – ${num.format(m.interval[1])}` : '';
  return `Fiabilité ${pct.format(m.reliability * 100)} % (${m.level})${interval}. Fiable (70 %) à partir d'environ ${matchesLabel(m.matchesForReliable)} complets.`;
}

// ----- Joueurs à faible temps de jeu -----

export interface SmallSampleMetric { value: number; raw: number | null; reliability: number | null; pct: number | null; pctLow: number | null; pctHigh: number | null }
export interface SmallSamplePlayer {
  'Player ID': string; Player: string; 'Team ID'?: string; Team?: string; Competition: string; 'League tier'?: number; Position: string;
  Age?: number | null; 'Matches played': number; Starts?: number; 'Minutes played': number; 'Minutes share'?: number | null;
  metrics: Record<string, SmallSampleMetric>;
}
export interface SmallSamplesFile {
  season: string; labels: string[]; fields: string[]; minMatches: number; minMinutes: number;
  players: (Omit<SmallSamplePlayer, 'metrics'> & { metrics: (number | null)[][] })[];
}

/** Fichier compact → joueurs avec leurs métriques par libellé */
export function expandSmallSamples(file: SmallSamplesFile): SmallSamplePlayer[] {
  return file.players.map(p => ({
    ...p,
    metrics: Object.fromEntries(p.metrics.flatMap(([i, value, raw, reliability, pctV, lo, hi]) => (typeof i === 'number' && typeof value === 'number' && file.labels[i]
      ? [[file.labels[i], { value, raw: raw ?? null, reliability: reliability ?? null, pct: pctV ?? null, pctLow: lo ?? null, pctHigh: hi ?? null }]]
      : []))),
  }));
}

export type SmallSampleSort = 'pct' | 'low' | 'reliability';
export interface SmallSampleFilters { role: string; competition: string; maxAge: number | null; minMatches: number; metric: string; sort: SmallSampleSort }

/** Joueurs du rôle ayant la métrique, filtrés, triés : percentile estimé, borne basse (prudent) ou fiabilité */
export function filterSmallSamples(players: SmallSamplePlayer[], f: SmallSampleFilters): SmallSamplePlayer[] {
  const key = (p: SmallSamplePlayer) => {
    const m = p.metrics[f.metric];
    return f.sort === 'low' ? m.pctLow ?? -1 : f.sort === 'reliability' ? m.reliability ?? -1 : m.pct ?? -1;
  };
  return players
    .filter(p => p.Position === f.role && p.metrics[f.metric] && (!f.competition || p.Competition === f.competition)
      && p['Matches played'] >= f.minMatches && (f.maxAge === null || (typeof p.Age === 'number' && p.Age <= f.maxAge)))
    .sort((a, b) => key(b) - key(a) || b['Minutes played'] - a['Minutes played']);
}
