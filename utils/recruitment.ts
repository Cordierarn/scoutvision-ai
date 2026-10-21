/**
 * ScoutVision AI - Recrutement fondé sur les données
 *
 * Diagnostic d'une équipe et suggestions de joueurs, d'après la release « recherche »
 * du dépôt de données :
 * - la performance se transfère mal d'un contexte à l'autre (championnat, style,
 *   coéquipiers) : chaque candidat est projeté dans l'équipe qui recrute, la saison
 *   suivante (modèle de transfert de scripts/models.py, validé hors échantillon), au
 *   lieu d'être jugé sur ses percentiles actuels ;
 * - l'apport se mesure contre le titulaire, lui aussi projeté (âge, retour vers la moyenne) ;
 * - complémentarité : les points faibles du partenaire de ligne comptent en plus dans l'indice ;
 * - budget et multicritère : plafond de valeur et frontière qualité-prix (aucun autre
 *   candidat n'est à la fois meilleur et moins cher) ;
 * - la donnée dresse une liste courte, la décision reste humaine (étude de cas, 2026).
 */

import { PlayerData, TeamStats } from '../types';
import { AgeCurves, MarketEntry, MarketValues, TransferModel } from '../services/dataLoader';
import { RolePreset, midfieldBonus, presetWeights, presetsForPosition, weightedRoleScore } from './rolePresets';
import { ageEffect } from './development';
import { PlacedSlot } from './lineup';

export interface Models {
  curves: AgeCurves | null;
  transfer: TransferModel | null;
}

/**
 * Équipe qui recrute, dans son championnat
 */
export interface Target {
  teamId: string;
  competition: string;
  tier: number;
  context: Record<string, number | undefined>;   // colonnes de TransferModel.context
}

const clamp = (v: number) => Math.max(0, Math.min(100, v));

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

// ============================================
// PROJECTION DANS L'ÉQUIPE CIBLE
// ============================================

/**
 * Percentile d'une métrique, de maintenant à la saison suivante dans l'équipe cible
 */
export interface MetricForecast {
  now: number;           // percentile actuel
  regression: number;    // retour vers la moyenne : beta * (percentile - 50)
  age: number;           // effet de l'âge (courbes d'âge)
  development: number;   // percentile + retour vers la moyenne + âge, borné (projection sans transfert)
  league: number;        // écart de niveau entre les championnats (points de percentile)
  context: number;       // contexte de l'équipe (domination territoriale)
  adaptation: number;    // coût d'adaptation moyen d'un changement de championnat ou de club
  next: number;          // percentile attendu, borné à 0-100
}

/**
 * Niveau d'un championnat dans le modèle ; un championnat sans transfert observé prend
 * le niveau moyen de son niveau PitchAPI
 */
export function leagueLevel(transfer: TransferModel, competition: string | undefined, tier: number | undefined): number {
  const known = competition ? transfer.leagues[competition] : undefined;
  if (known) return known.level;
  return transfer.tierLevels[String(tier ?? 2)] ?? 0;
}

/**
 * Projection d'une métrique ; sans `target` (ou dans sa propre équipe), le joueur reste
 * dans son club : seules les courbes d'âge s'appliquent
 */
export function forecastMetric(player: PlayerData, metric: string, models: Models, target?: Target): MetricForecast | undefined {
  const pct = num(player[`${metric} pct`]);
  if (pct === undefined) return undefined;
  const curve = models.curves?.curves[player.Position]?.[metric];
  const regression = curve ? curve.beta * (pct - 50) : 0;
  const age = curve ? ageEffect(curve, Number(player.Age)) : 0;
  const development = clamp(pct + regression + age);       // = expectedPercentile (development.ts)

  let league = 0;
  let context = 0;
  let adaptation = 0;
  const transfer = models.transfer;
  const coef = transfer?.metrics[metric];
  if (transfer && coef && target && target.teamId !== player['Team ID']) {
    league = coef.league * (leagueLevel(transfer, player.Competition, player['League tier'])
      - leagueLevel(transfer, target.competition, target.tier));
    transfer.context.forEach((col, i) => {
      const from = num(player[col]);
      const to = target.context[col];
      if (from !== undefined && to !== undefined) context += (coef.context[i] ?? 0) * (to - from);
    });
    adaptation = player.Competition !== target.competition ? coef.leagueChange : coef.clubChange;
  }
  return {
    now: pct, regression, age, development, league, context, adaptation,
    next: clamp(development + league + context + adaptation),
  };
}

/**
 * Indice d'un rôle, de maintenant à la saison suivante dans l'équipe cible, et sa
 * décomposition, étape par étape (les parts s'additionnent : next - now, hors plafond de 100)
 */
export interface RoleForecast {
  now: number;
  next: number;
  parts: { regression: number; age: number; league: number; context: number; adaptation: number };
  metrics: Record<string, MetricForecast>;
}

export function forecastRole(
  player: PlayerData,
  preset: RolePreset,
  models: Models,
  target?: Target,
  extraWeights: Record<string, number> = {},
): RoleForecast | undefined {
  const metrics: Record<string, MetricForecast> = {};
  Object.keys({ ...presetWeights(preset), ...extraWeights }).forEach(key => {
    const f = forecastMetric(player, key, models, target);
    if (f) metrics[key] = f;
  });
  const score = (pick: (f: MetricForecast) => number) =>
    weightedRoleScore(preset, key => (metrics[key] ? pick(metrics[key]) : undefined), extraWeights);

  const now = score(f => f.now);
  if (now === undefined) return undefined;
  const regression = score(f => clamp(f.now + f.regression))!;
  const development = score(f => f.development)!;
  const league = score(f => clamp(f.development + f.league))!;
  const context = score(f => clamp(f.development + f.league + f.context))!;
  const next = score(f => f.next)!;
  const bonus = midfieldBonus(player, preset);
  return {
    now: Math.min(100, now + bonus),
    next: Math.min(100, next + bonus),
    parts: {
      regression: regression - now,
      age: development - regression,
      league: league - development,
      context: context - league,
      adaptation: next - context,
    },
    metrics,
  };
}

// ============================================
// OUTILS
// ============================================

/**
 * Une ligne par joueur : sa ligne de championnat la plus jouée (coupes écartées)
 */
export function leagueRows(players: PlayerData[], isLeague: (competition: string) => boolean): PlayerData[] {
  const best = new Map<string, PlayerData>();
  players.forEach(p => {
    if (!p.Competition || !isLeague(p.Competition) || !p['Player ID']) return;
    const prev = best.get(p['Player ID']);
    if (!prev || (num(p['Minutes played']) ?? 0) > (num(prev['Minutes played']) ?? 0)) best.set(p['Player ID'], p);
  });
  return [...best.values()];
}

/**
 * Rang (0-100) d'une valeur dans une distribution triée : part des valeurs
 * inférieures, les égalités comptent pour moitié
 */
export function percentileRank(sorted: number[], value: number): number {
  if (sorted.length === 0) return 50;
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < value) lo = mid + 1; else hi = mid;
  }
  const below = lo;
  hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] <= value) lo = mid + 1; else hi = mid;
  }
  return (100 * (below + (lo - below) / 2)) / sorted.length;
}

/**
 * Mois jusqu'à une date ("2027-06-30"), négatif si elle est passée
 */
export function monthsUntil(date: string | undefined, asOf: Date): number | undefined {
  if (!date) return undefined;
  const t = Date.parse(date);
  if (Number.isNaN(t)) return undefined;
  return (t - asOf.getTime()) / (1000 * 60 * 60 * 24 * 30.4375);
}

/**
 * Indices projetés (sans transfert) des joueurs d'un championnat éligibles au rôle, triés :
 * la référence pour situer un titulaire ou un candidat dans le championnat cible
 */
export function peerIndices(
  leaguePlayers: PlayerData[],
  preset: RolePreset,
  models: Models,
  extraWeights: Record<string, number> = {},
): number[] {
  return leaguePlayers
    .filter(p => preset.positions.includes(p.Position))
    .map(p => forecastRole(p, preset, models, undefined, extraWeights)?.next)
    .filter((v): v is number => v !== undefined)
    .sort((a, b) => a - b);
}

// ============================================
// DIAGNOSTIC DE L'ÉQUIPE
// ============================================

/**
 * Dimensions du profil de l'effectif : percentiles par rôle des joueurs (sens « plus
 * c'est haut, mieux c'est » ; poids négatif = inversé), moyenne pondérée par les minutes
 */
export const SQUAD_DIMENSIONS: { key: string; label: string; metrics: Record<string, number>; goalkeepers?: boolean }[] = [
  { key: 'finishing', label: 'Finition', metrics: { 'npxG per 90': 1, 'Touches in box per 90': 1, 'Shots on target per 90': 1 } },
  { key: 'creation', label: 'Création', metrics: { 'xA per 90': 1, 'Key passes per 90': 1, 'Shot-creating actions per 90': 1 } },
  { key: 'progression', label: 'Progression', metrics: { 'Progressive passes per 90': 1, 'Progressive runs per 90': 1, 'Passes to final third per 90': 1 } },
  { key: 'dribbling', label: 'Dribble', metrics: { 'Dribbles per 90': 1, 'Successful dribbles, %': 1 } },
  { key: 'security', label: 'Sûreté technique', metrics: { 'Accurate passes, %': 1, 'Dispossessed per 90': -1, 'Miscontrols per 90': -1 } },
  { key: 'duels', label: 'Duels au sol', metrics: { 'Ground duels won, %': 1, 'PAdj Tackles': 1, 'Dribbled past per 90': -1 } },
  { key: 'aerial', label: 'Jeu aérien', metrics: { 'Aerial duels won, %': 1, 'Aerial duels won per 90': 1 } },
  { key: 'recovery', label: 'Récupération', metrics: { 'PAdj Interceptions': 1, 'PAdj Recoveries': 1 } },
  { key: 'goalkeeping', label: 'Gardien', metrics: { 'Prevented goals per 90': 1, 'Save rate, %': 1 }, goalkeepers: true },
];

export interface DimensionScore {
  key: string;
  label: string;
  value: number;      // moyenne de l'effectif (percentiles par rôle, 0-100)
  rank: number;       // rang de l'équipe dans son championnat (0-100)
  teams: number;      // équipes comparées
}

/**
 * Profil de l'effectif d'une équipe, situé parmi les équipes de son championnat.
 * `leaguePlayers` : les lignes du championnat (une saison) ; les gardiens ne comptent
 * que pour la dimension Gardien.
 */
export function squadProfile(teamId: string, leaguePlayers: PlayerData[]): DimensionScore[] {
  const byTeam = new Map<string, PlayerData[]>();
  leaguePlayers.forEach(p => {
    if (!p['Team ID']) return;
    if (!byTeam.has(p['Team ID'])) byTeam.set(p['Team ID'], []);
    byTeam.get(p['Team ID'])!.push(p);
  });
  if (!byTeam.has(teamId)) return [];

  return SQUAD_DIMENSIONS.flatMap(dim => {
    const values = new Map<string, number>();
    byTeam.forEach((players, id) => {
      let sum = 0;
      let total = 0;
      players.forEach(p => {
        if ((p.Position === 'GK') !== Boolean(dim.goalkeepers)) return;
        const score = weightedRoleScore({ positions: [], metrics: {}, weights: dim.metrics },
          key => num(p[`${key} pct`]));
        const minutes = num(p['Minutes played']) ?? 0;
        if (score === undefined || minutes <= 0) return;
        sum += score * minutes;
        total += minutes;
      });
      if (total > 0) values.set(id, sum / total);
    });
    const own = values.get(teamId);
    if (own === undefined) return [];
    const sorted = [...values.values()].sort((a, b) => a - b);
    return [{ key: dim.key, label: dim.label, value: own, rank: percentileRank(sorted, own), teams: sorted.length }];
  });
}

/**
 * Rang (0-100) d'une équipe sur une métrique de team_season parmi les équipes de son championnat
 */
export function teamRank(team: TeamStats, cohort: TeamStats[], key: keyof TeamStats, higherIsBetter: boolean): number | undefined {
  const own = num(team[key]);
  if (own === undefined) return undefined;
  const values = cohort.map(t => num(t[key])).filter((v): v is number => v !== undefined)
    .map(v => (higherIsBetter ? v : -v)).sort((a, b) => a - b);
  return percentileRank(values, higherIsBetter ? own : -own);
}

// unknown : aucun joueur du poste n'a 40 % des minutes, le besoin n'est pas mesurable
export type NeedLevel = 'high' | 'unknown' | 'medium' | 'low';
export type NeedFlag = 'contract' | 'decline' | 'depth' | 'rotation' | 'noStarter';

export interface SlotNeed {
  placed: PlacedSlot;
  // Joueur de référence de la case (ligne de championnat) : le titulaire ; s'il a moins de
  // 40 % des minutes (absent des données), le plus utilisé des autres joueurs du poste
  starter?: PlayerData;
  position?: string;            // poste joué (celui du titulaire, sinon d'un remplaçant)
  presetName?: string;          // meilleur rôle du titulaire
  preset?: RolePreset;
  forecast?: RoleForecast;      // indice du titulaire dans ce rôle, maintenant et projeté
  rank?: number;                // rang projeté dans le championnat (0-100)
  need: number;                 // 100 - rang ; 100 sans joueur régulier dans les données
  level: NeedLevel;
  flags: NeedFlag[];
  contractMonths?: number;
}

const LEVEL_ORDER: Record<NeedLevel, number> = { high: 0, unknown: 1, medium: 2, low: 3 };

/**
 * Ordre d'affichage des besoins : prioritaires, à évaluer, à renforcer, solides ; puis du
 * plus fort au plus faible
 */
export function needOrder(needs: SlotNeed[]): number[] {
  return needs.map((_, i) => i).sort((a, b) =>
    LEVEL_ORDER[needs[a].level] - LEVEL_ORDER[needs[b].level] || needs[b].need - needs[a].need || a - b);
}

// Seuils du besoin : titulaire projeté dans les 40 % les plus faibles du championnat,
// puis entre 40 et 65 %
export const NEED_HIGH = 60;
export const NEED_MEDIUM = 35;
// Fin de contrat qui fait d'un poste solide un poste « à renforcer » (succession)
export const CONTRACT_MONTHS = 12;
// Baisse de l'indice due à l'âge (hors retour vers la moyenne) qui fait de même
export const DECLINE_POINTS = -2;
// Part des matchs de la formation qu'une doublure doit avoir débutés à ce poste
export const DEPTH_SHARE = 0.15;

// Familles de poste : un latéral et un piston, un milieu défensif et un milieu central se remplacent
const FAMILY: Record<string, string> = { GK: 'GK', CB: 'CB', FB: 'FB', WB: 'FB', DM: 'MID', CM: 'MID', AM: 'AM', W: 'W', ST: 'ST' };

/**
 * Poste approché d'une case quand aucun joueur de la case n'a de données :
 * x = profondeur (0 = propre but), y = largeur (0 = gauche)
 */
export function positionFromSlot(x: number, y: number): string {
  const wide = Math.abs(y - 0.5) > 0.25;
  if (x < 0.2) return 'GK';
  if (x < 0.4) return wide ? 'FB' : 'CB';
  if (x < 0.55) return wide ? 'WB' : 'DM';
  if (x < 0.72) return wide ? 'W' : 'CM';
  return wide ? 'W' : 'ST';
}

/**
 * Besoins par case du onze type : chaque titulaire est projeté à la saison suivante dans
 * son meilleur rôle et situé parmi les joueurs du championnat éligibles à ce rôle
 */
export function slotNeeds(
  eleven: PlacedSlot[],
  teamPlayers: PlayerData[],
  leaguePlayers: PlayerData[],
  models: Models,
  market: MarketValues | null,
  asOf: Date,
): SlotNeed[] {
  const byId = new Map(teamPlayers.filter(p => p['Player ID']).map(p => [p['Player ID']!, p]));
  const peerCache = new Map<string, number[]>();
  // Titulaires présents dans les données : ils ne servent pas de référence à une autre case
  const used = new Set(eleven.map(p => p.starter?.id).filter((id): id is string => !!id && byId.has(id)));

  // Case en rotation : le remplaçant de la case le plus titularisé qui a des données, sinon
  // le joueur de l'effectif de la même famille de poste le plus utilisé, libre
  const reference = (placed: PlacedSlot, position: string): PlayerData | undefined => {
    const backup = placed.backups.map(b => byId.get(b.id)).find(p => p && !used.has(p['Player ID']!));
    if (backup) return backup;
    return teamPlayers
      .filter(p => p['Player ID'] && !used.has(p['Player ID']) && FAMILY[p.Position] === FAMILY[position])
      .sort((a, b) => (num(b['Minutes played']) ?? 0) - (num(a['Minutes played']) ?? 0))[0];
  };

  return eleven.map(placed => {
    const regular = placed.starter ? byId.get(placed.starter.id) : undefined;
    const position = regular?.Position
      ?? placed.backups.map(b => byId.get(b.id)).find(Boolean)?.Position
      ?? positionFromSlot(placed.slot.x, placed.slot.y);
    // Doublure : un autre joueur a débuté au moins 15 % des matchs de la formation à ce poste
    const slotMatches = placed.backups.reduce((sum, b) => sum + b.starts, placed.starter?.starts ?? 0);
    const cover = Math.max(1, Math.round(DEPTH_SHARE * slotMatches));
    const flags: NeedFlag[] = placed.backups.some(b => b.starts >= cover) ? [] : ['depth'];
    let starter = regular;
    if (!starter) {
      starter = reference(placed, position);
      if (starter) {
        used.add(starter['Player ID']!);
        flags.push('rotation');
      }
    }
    if (!starter) {
      return { placed, position, need: 100, level: 'unknown' as NeedLevel, flags: ['noStarter' as NeedFlag, ...flags] };
    }

    // Meilleur rôle : indice actuel le plus haut parmi les rôles du poste
    let best: { name: string; preset: RolePreset; forecast: RoleForecast } | undefined;
    presetsForPosition(starter.Position).forEach(([name, preset]) => {
      const forecast = forecastRole(starter, preset, models);
      if (forecast && (!best || forecast.now > best.forecast.now)) best = { name, preset, forecast };
    });
    if (!best) {
      return { placed, starter, position, need: 100, level: 'unknown' as NeedLevel, flags: ['noStarter' as NeedFlag, ...flags] };
    }

    if (!peerCache.has(best.name)) peerCache.set(best.name, peerIndices(leaguePlayers, best.preset, models));
    const rank = percentileRank(peerCache.get(best.name)!, best.forecast.next);
    const need = 100 - rank;
    const contractMonths = monthsUntil(market?.players.get(starter['Player ID'] ?? '')?.contract, asOf);
    if (contractMonths !== undefined && contractMonths <= CONTRACT_MONTHS) flags.push('contract');
    if (best.forecast.parts.age <= DECLINE_POINTS) flags.push('decline');

    let level: NeedLevel = need >= NEED_HIGH ? 'high' : need >= NEED_MEDIUM ? 'medium' : 'low';
    if (level === 'low' && flags.some(f => f === 'contract' || f === 'decline' || f === 'rotation')) level = 'medium';
    return {
      placed, starter, position, presetName: best.name, preset: best.preset, forecast: best.forecast,
      rank, need, level, flags, contractMonths,
    };
  });
}

// ============================================
// COMPLÉMENTARITÉ
// ============================================

const PARTNER_FAMILIES: Record<string, string[]> = {
  CB: ['CB'], FB: ['W', 'AM'], W: ['FB'], MID: ['MID'], AM: ['ST'], ST: ['ST', 'AM'],
};

const side = (y: number) => (y < 0.4 ? 'left' : y > 0.6 ? 'right' : 'centre');

/**
 * Partenaire de ligne d'une case : l'autre central, l'autre milieu, l'ailier ou le latéral
 * du même côté, l'attaquant devant le meneur... le plus proche sur le terrain
 */
export function slotPartner(needs: SlotNeed[], index: number): SlotNeed | undefined {
  const me = needs[index];
  const family = FAMILY[me.position ?? ''];
  const wanted = PARTNER_FAMILIES[family];
  if (!wanted) return undefined;
  let best: SlotNeed | undefined;
  let bestDistance = Infinity;
  needs.forEach((other, j) => {
    if (j === index || !other.starter || !wanted.includes(FAMILY[other.position ?? ''])) return;
    if ((family === 'FB' || family === 'W') && side(other.placed.slot.y) !== side(me.placed.slot.y)) return;
    const d = Math.hypot(other.placed.slot.x - me.placed.slot.x, other.placed.slot.y - me.placed.slot.y);
    if (d < bestDistance) {
      bestDistance = d;
      best = other;
    }
  });
  return best;
}

export interface Complement {
  metric: string;
  value: number;       // percentile du partenaire, dans le sens « plus c'est haut, mieux c'est »
  weight: number;      // poids ajouté à l'indice du candidat (signé : négatif = inversé)
}

export const COMPLEMENT_WEIGHT = 1;
export const COMPLEMENT_THRESHOLD = 35;

/**
 * Points faibles du partenaire parmi les métriques des rôles du poste à pourvoir :
 * le candidat qui y est fort gagne en indice
 */
export function complementFor(partner: PlayerData, position: string, max = 3): Complement[] {
  const polarity = new Map<string, number>();
  presetsForPosition(position).forEach(([, preset]) => {
    Object.entries(presetWeights(preset)).forEach(([metric, w]) => {
      const sign = Math.sign(w);
      const prev = polarity.get(metric);
      polarity.set(metric, prev === undefined || prev === sign ? sign : 0);   // sens contradictoires : ignorée
    });
  });
  const out: Complement[] = [];
  polarity.forEach((sign, metric) => {
    const v = num(partner[`${metric} pct`]);
    if (sign === 0 || v === undefined) return;
    const value = sign > 0 ? v : 100 - v;
    if (value < COMPLEMENT_THRESHOLD) out.push({ metric, value, weight: sign * COMPLEMENT_WEIGHT });
  });
  return out.sort((a, b) => a.value - b.value).slice(0, max);
}

// ============================================
// CANDIDATS
// ============================================

export type LeagueScope = 'all' | 'other' | 'same' | 'lower';

export interface SearchFilters {
  minAge: number;
  maxAge: number;
  minMinutes: number;
  maxValue?: number;               // euros ; absent = pas de plafond
  includeUnknownValue: boolean;    // avec un plafond : garder les joueurs sans valeur connue
  contractWithinMonths?: number;   // fin de contrat dans ce délai
  leagues: LeagueScope;
}

export const AGE_RANGE: [number, number] = [16, 40];

export const DEFAULT_FILTERS: SearchFilters = {
  minAge: AGE_RANGE[0],
  maxAge: AGE_RANGE[1],
  minMinutes: 900,
  includeUnknownValue: false,
  leagues: 'all',
};

export type CandidateFlag = 'fewMinutes' | 'rareLeague' | 'bigStep' | 'contract' | 'undervalued';

export const FEW_MINUTES = 1200;
export const RARE_LEAGUE_MOVES = 15;
export const BIG_STEP_POINTS = -5;
export const UNDERVALUED_RATIO = 1.5;

export interface Candidate {
  player: PlayerData;
  forecast: RoleForecast;          // dans l'équipe cible, saison suivante
  gain?: number;                   // forecast.next - indice projeté du titulaire
  rank: number;                    // rang projeté parmi les joueurs du championnat cible (0-100)
  market?: MarketEntry;
  contractMonths?: number;
  thresholds: { met: number; total: number };   // critères éliminatoires, percentiles projetés
  flags: CandidateFlag[];
  efficient: boolean;              // frontière qualité-prix
}

/**
 * Candidats d'un rôle pour l'équipe cible, du meilleur indice projeté au moins bon
 */
export function rankCandidates(opts: {
  pool: PlayerData[];                    // lignes de championnat de la saison (leagueRows)
  preset: RolePreset;
  target: Target;
  models: Models;
  peers: number[];                       // peerIndices du championnat cible, mêmes poids
  baseline?: number;                     // indice projeté du titulaire
  extraWeights?: Record<string, number>;
  filters: SearchFilters;
  market: MarketValues | null;
  asOf: Date;
  limit?: number;
  fewMinutes?: number;                   // seuil du signal « peu de minutes »
}): Candidate[] {
  const {
    pool, preset, target, models, peers, baseline, extraWeights = {}, filters, market, asOf, limit = 50,
    fewMinutes = FEW_MINUTES,
  } = opts;
  const transfer = models.transfer;
  const targetLevel = transfer ? leagueLevel(transfer, target.competition, target.tier) : 0;
  const fullAgeRange = filters.minAge <= AGE_RANGE[0] && filters.maxAge >= AGE_RANGE[1];

  const out: Candidate[] = [];
  pool.forEach(player => {
    if (!preset.positions.includes(player.Position) || player['Team ID'] === target.teamId) return;
    const age = num(player.Age);
    if (age === undefined ? !fullAgeRange : age < filters.minAge || age > filters.maxAge) return;
    const minutes = num(player['Minutes played']) ?? 0;
    if (minutes < filters.minMinutes) return;

    if (filters.leagues === 'same' && player.Competition !== target.competition) return;
    if (filters.leagues === 'other' && player.Competition === target.competition) return;
    if (filters.leagues === 'lower' && (!transfer
      || leagueLevel(transfer, player.Competition, player['League tier']) >= targetLevel)) return;

    const entry = market?.players.get(player['Player ID'] ?? '');
    if (filters.maxValue !== undefined) {
      if (entry?.value === undefined ? !filters.includeUnknownValue : entry.value > filters.maxValue) return;
    }
    const contractMonths = monthsUntil(entry?.contract, asOf);
    if (filters.contractWithinMonths !== undefined
      && (contractMonths === undefined || contractMonths > filters.contractWithinMonths)) return;

    const forecast = forecastRole(player, preset, models, target, extraWeights);
    if (!forecast) return;

    const core = Object.entries(preset.metrics);
    const met = core.filter(([key, min]) => (forecast.metrics[key]?.next ?? -1) >= min).length;
    const flags: CandidateFlag[] = [];
    if (minutes < fewMinutes) flags.push('fewMinutes');
    if (transfer && player.Competition !== target.competition
      && (transfer.leagues[player.Competition ?? '']?.moves ?? 0) < RARE_LEAGUE_MOVES) flags.push('rareLeague');
    if (forecast.parts.league <= BIG_STEP_POINTS) flags.push('bigStep');
    if (contractMonths !== undefined && contractMonths <= CONTRACT_MONTHS) flags.push('contract');
    if (entry?.value && entry.estimated && entry.estimated >= UNDERVALUED_RATIO * entry.value) flags.push('undervalued');

    out.push({
      player,
      forecast,
      gain: baseline === undefined ? undefined : forecast.next - baseline,
      rank: percentileRank(peers, forecast.next),
      market: entry,
      contractMonths,
      thresholds: { met, total: core.length },
      flags,
      efficient: false,
    });
  });

  out.sort((a, b) => b.forecast.next - a.forecast.next);
  markEfficient(out);
  return out.slice(0, limit);
}

/**
 * Frontière qualité-prix : un candidat de valeur connue est efficient si aucun autre
 * n'a un indice projeté au moins égal pour une valeur au plus égale (et mieux sur l'un des deux)
 */
export function markEfficient(candidates: Candidate[]): void {
  const priced = candidates.filter(c => c.market?.value !== undefined)
    .sort((a, b) => a.market!.value! - b.market!.value! || b.forecast.next - a.forecast.next);
  let bestSoFar = -Infinity;
  priced.forEach(c => {
    c.efficient = c.forecast.next > bestSoFar;
    if (c.efficient) bestSoFar = c.forecast.next;
  });
}
