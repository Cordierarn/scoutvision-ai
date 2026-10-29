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
 * - complémentarité : lecture séparée (points faibles du partenaire de ligne, réponse du
 *   candidat), jamais ajoutée à l'indice projeté ;
 * - budget et multicritère : plafond de valeur et frontière valeur / performance (aucun autre
 *   candidat n'est au moins aussi bon pour au plus le même prix, et strictement mieux sur l'un) ;
 * - valeurs Transfermarkt : un instantané de la saison en cours, jamais appliqué à une
 *   saison passée (seasonMarket) ;
 * - la donnée dresse une liste courte, la décision reste humaine (étude de cas, 2026).
 */

import { PlayerData, TeamStats } from '../types';
import { AgeCurves, MarketEntry, MarketValues, TransferModel } from '../services/dataLoader';
import { RolePreset, midfieldBonus, presetWeights, presetsForPosition, weightedRoleScore } from './rolePresets';
import { ageEffect } from './development';
import { PlacedSlot, SlotPlayer } from './lineup';
import { isOutOfPosition } from './teamLineups';
import { ESTIMATE_RATIO_MIN, SeasonCapabilities } from './prospects';

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
  context: Record<string, number | null | undefined>;   // colonnes de TransferModel.context (null : inconnu)
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
    // Contexte inconnu d'un côté (absent ou null dans les données) : terme nul, jamais lu comme 0
    transfer.context.forEach((col, i) => {
      const from = num(player[col]);
      const to = num(target.context[col]);
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

/**
 * Projection sportive d'un rôle : les poids du rôle seulement. La complémentarité avec un
 * partenaire n'y entre jamais (lecture séparée, complementReading).
 */
export function forecastRole(
  player: PlayerData,
  preset: RolePreset,
  models: Models,
  target?: Target,
): RoleForecast | undefined {
  const metrics: Record<string, MetricForecast> = {};
  Object.keys(presetWeights(preset)).forEach(key => {
    const f = forecastMetric(player, key, models, target);
    if (f) metrics[key] = f;
  });
  const score = (pick: (f: MetricForecast) => number) =>
    weightedRoleScore(preset, key => (metrics[key] ? pick(metrics[key]) : undefined));

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
export function peerIndices(leaguePlayers: PlayerData[], preset: RolePreset, models: Models): number[] {
  return leaguePlayers
    .filter(p => preset.positions.includes(p.Position))
    .map(p => forecastRole(p, preset, models)?.next)
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

// ============================================
// MARCHÉ DE LA SAISON ANALYSÉE
// ============================================

/**
 * Valeurs Transfermarkt utilisables pour la saison analysée. market.json est un instantané
 * de la saison en cours (valeur, contrat, estimation statistique à la date du relevé) : il
 * ne décrit pas une saison passée. Comme le Chasseur de pépites, la saison dit ce qu'elle
 * porte (seasonCapabilities, calculé sur ses lignes) ; les champs absents sont retirés, et
 * sans aucun champ il n'y a pas de marché (null) : ni valeur, ni contrat, ni estimation,
 * ni signal qui en dépend.
 */
export function seasonMarket(market: MarketValues | null | undefined, caps: SeasonCapabilities): MarketValues | null {
  if (!market || !(caps.marketValue || caps.contract || caps.estimate)) return null;
  if (caps.marketValue && caps.contract && caps.estimate) return market;
  const players = new Map<string, MarketEntry>();
  market.players.forEach((e, id) => {
    const entry: MarketEntry = {};
    if (caps.marketValue && e.value !== undefined) entry.value = e.value;
    if (caps.contract && e.contract !== undefined) entry.contract = e.contract;
    if (caps.estimate && e.estimated !== undefined) entry.estimated = e.estimated;
    players.set(id, entry);
  });
  return { scrapedAt: market.scrapedAt, players };
}

// ============================================
// BESOINS PAR POSTE
// ============================================

// unknown : besoin non mesurable (aucun joueur du poste n'a 40 % des minutes, ou titulaire
// aligné hors poste : ses percentiles sont calculés parmi les joueurs de son poste d'origine)
export type NeedLevel = 'high' | 'unknown' | 'medium' | 'low';
export type NeedFlag = 'contract' | 'decline' | 'depth' | 'rotation' | 'noStarter' | 'outOfPosition';
// Signaux de profondeur (slotDepth) : le hors-poste est propre au besoin de recrutement
export type DepthSignal = Exclude<NeedFlag, 'outOfPosition'>;

export interface SlotNeed {
  placed: PlacedSlot;
  // Joueur de référence de la case (ligne de championnat) : le titulaire ; s'il a moins de
  // 40 % des minutes (absent des données), le plus utilisé des autres joueurs du poste
  starter?: PlayerData;
  // Poste recherché : celui du titulaire, sauf titulaire manifestement hors poste (la case
  // de la formation) ; sans joueur de la case dans les données, celui de la case
  position?: string;
  presetName?: string;          // meilleur rôle du titulaire
  preset?: RolePreset;
  forecast?: RoleForecast;      // indice du titulaire dans ce rôle, maintenant et projeté
  rank?: number;                // rang projeté dans le championnat (0-100)
  need: number;                 // 100 - rang ; 100 si le besoin n'est pas mesurable
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
 * Titulaire manifestement hors poste : à deux lignes ou plus de la case (isOutOfPosition),
 * piston exclu. Le piston est un poste hybride (latéral ou ailier selon le système) : mesuré
 * sur 2025-26, les écarts ailier → piston, piston → ailier et latéral → piston sont des
 * profils cohérents, pas des erreurs de poste.
 */
export function isManifestlyOutOfPosition(playerPosition: string | undefined, slotPosition: string | undefined): boolean {
  if (playerPosition === 'WB' || slotPosition === 'WB') return false;
  return isOutOfPosition(playerPosition, slotPosition);
}

// ============================================
// PROFONDEUR D'EFFECTIF (sans besoin de recrutement)
// ============================================

export interface DepthOption {
  lineup: SlotPlayer;            // joueur de la case dans les compositions (titularisations)
  player?: PlayerData;           // sa ligne de la compétition, s'il est au-dessus du seuil de minutes
}

export interface SlotDepth {
  placed: PlacedSlot;
  position: string;              // poste joué (celui du titulaire, sinon d'un remplaçant, sinon la case)
  positionSource: 'starter' | 'backup' | 'slot';
  regular?: PlayerData;          // titulaire le plus fréquent de la case, présent dans les données
  // Joueur de référence : le titulaire ; absent des données (sous le seuil), le remplaçant de la
  // case le plus titularisé, sinon le joueur de la même famille de poste le plus utilisé (rotation)
  starter?: PlayerData;
  rotation: boolean;
  options: DepthOption[];        // titulaire puis remplaçants de la case, par titularisations
  backup: DepthOption | null;
  thirdOption: DepthOption | null;
  slotMatches: number;           // titularisations à ce poste dans la formation
  coverage: number;              // part des titularisations prises par d'autres que le titulaire (0-1)
  signals: DepthSignal[];        // noStarter, depth, rotation, contract, decline
  contractMonths?: number;
}

/**
 * Profondeur de chaque case du onze : titulaire, doublure, troisième option et signaux déjà
 * utilisés par le Recrutement (pas de doublure, rotation, fin de contrat, déclin lié à l'âge,
 * aucun joueur régulier). Ne calcule aucun besoin : le niveau (prioritaire, à renforcer,
 * solide) reste propre à slotNeeds.
 *
 * `contractOf` doit venir de la saison analysée (seasonMarket) : un contrat de l'instantané
 * Transfermarkt n'a pas de sens pour une saison passée.
 * `slotPositions` (formationPositions) remplace la géométrie de la case quand aucun joueur
 * de la case n'a de données, ou quand le seul remplaçant connu est manifestement hors poste.
 */
export function slotDepth(
  eleven: PlacedSlot[],
  teamPlayers: PlayerData[],
  opts: {
    contractOf?: (p: PlayerData) => string | undefined;
    asOf?: Date;
    declining?: (p: PlayerData) => boolean;
    slotPositions?: Map<number, string> | null;
  } = {},
): SlotDepth[] {
  const byId = new Map(teamPlayers.filter(p => p['Player ID']).map(p => [p['Player ID']!, p]));
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
    const slotPosition = opts.slotPositions?.get(placed.slot.slot);
    // Un remplaçant manifestement hors poste (ailier dépanneur en latéral) ne dit pas le poste de la case
    const backupPosition = placed.backups.map(b => byId.get(b.id)).find(Boolean)?.Position;
    const usableBackup = backupPosition && !isManifestlyOutOfPosition(backupPosition, slotPosition) ? backupPosition : undefined;
    const positionSource: SlotDepth['positionSource'] = regular ? 'starter' : usableBackup ? 'backup' : 'slot';
    const position = regular?.Position ?? usableBackup ?? slotPosition ?? positionFromSlot(placed.slot.x, placed.slot.y);
    // Doublure : un autre joueur a débuté au moins 15 % des matchs de la formation à ce poste
    const slotMatches = placed.backups.reduce((sum, b) => sum + b.starts, placed.starter?.starts ?? 0);
    const cover = Math.max(1, Math.round(DEPTH_SHARE * slotMatches));
    const depth = !placed.backups.some(b => b.starts >= cover);
    let starter = regular;
    let rotation = false;
    if (!starter) {
      starter = reference(placed, position);
      if (starter) {
        used.add(starter['Player ID']!);
        rotation = true;
      }
    }
    const options: DepthOption[] = [...(placed.starter ? [placed.starter] : []), ...placed.backups]
      .map(lineup => ({ lineup, player: byId.get(lineup.id) }));
    const contractMonths = starter && opts.contractOf ? monthsUntil(opts.contractOf(starter), opts.asOf ?? new Date()) : undefined;
    const signals: DepthSignal[] = [];
    if (!starter) signals.push('noStarter');
    if (depth) signals.push('depth');
    if (rotation) signals.push('rotation');
    if (contractMonths !== undefined && contractMonths <= CONTRACT_MONTHS) signals.push('contract');
    if (starter && opts.declining?.(starter)) signals.push('decline');
    return {
      placed, position, positionSource, regular, starter, rotation, options,
      backup: options[1] ?? null, thirdOption: options[2] ?? null,
      slotMatches, coverage: slotMatches > 0 ? 1 - (placed.starter?.starts ?? 0) / slotMatches : 0,
      signals, contractMonths,
    };
  });
}

/** Meilleur rôle d'un joueur : indice actuel le plus haut parmi les rôles de son poste, et sa projection */
export function bestRoleForecast(player: PlayerData, models: Models): { name: string; preset: RolePreset; forecast: RoleForecast } | undefined {
  let best: { name: string; preset: RolePreset; forecast: RoleForecast } | undefined;
  presetsForPosition(player.Position).forEach(([name, preset]) => {
    const forecast = forecastRole(player, preset, models);
    if (forecast && (!best || forecast.now > best.forecast.now)) best = { name, preset, forecast };
  });
  return best;
}

/** Déclin lié à l'âge : l'âge seul fait baisser l'indice projeté du meilleur rôle d'au moins 2 points */
export const isDeclining = (player: PlayerData, models: Models) => {
  const best = bestRoleForecast(player, models);
  return !!best && best.forecast.parts.age <= DECLINE_POINTS;
};

/**
 * Besoins par case du onze type : chaque titulaire est projeté à la saison suivante dans
 * son meilleur rôle et situé parmi les joueurs du championnat éligibles à ce rôle.
 * La profondeur (titulaire de référence, rotation, doublure, contrat) vient de slotDepth.
 *
 * - `market` : marché de la saison analysée (seasonMarket), null pour une saison passée ;
 * - `slotPositions` : poste de chaque case lu dans la formation (formationPositions). Un
 *   titulaire manifestement hors poste (ailier aligné latéral, par exemple) ne fixe pas le
 *   poste recherché : c'est la case. Son indice n'est alors pas mesuré (ses percentiles
 *   sont calculés parmi les joueurs de son poste d'origine) : besoin « à évaluer ».
 */
export function slotNeeds(
  eleven: PlacedSlot[],
  teamPlayers: PlayerData[],
  leaguePlayers: PlayerData[],
  models: Models,
  market: MarketValues | null,
  asOf: Date,
  slotPositions?: Map<number, string> | null,
): SlotNeed[] {
  const peerCache = new Map<string, number[]>();
  const depths = slotDepth(eleven, teamPlayers, {
    contractOf: market ? p => market.players.get(p['Player ID'] ?? '')?.contract : undefined,
    asOf,
    slotPositions,
  });

  return depths.map(d => {
    const { placed, starter } = d;
    const slotPosition = slotPositions?.get(placed.slot.slot);
    // Joueur de référence (titulaire ou rotation) manifestement hors poste : la case fixe le poste
    const outOfPosition = !!starter && isManifestlyOutOfPosition(starter.Position, slotPosition);
    const position = outOfPosition ? slotPosition : d.position;
    const flags: NeedFlag[] = d.signals.includes('depth') ? ['depth'] : [];
    if (d.rotation) flags.push('rotation');
    const contractMonths = starter ? d.contractMonths : undefined;
    if (contractMonths !== undefined && contractMonths <= CONTRACT_MONTHS) flags.push('contract');
    if (!starter) {
      return { placed, position, need: 100, level: 'unknown' as NeedLevel, flags: ['noStarter' as NeedFlag, ...flags] };
    }
    if (outOfPosition) {
      return { placed, starter, position, need: 100, level: 'unknown' as NeedLevel, flags: ['outOfPosition' as NeedFlag, ...flags], contractMonths };
    }

    const best = bestRoleForecast(starter, models);
    if (!best) {
      return { placed, starter, position, need: 100, level: 'unknown' as NeedLevel, flags: ['noStarter' as NeedFlag, ...flags.filter(f => f !== 'contract')] };
    }

    if (!peerCache.has(best.name)) peerCache.set(best.name, peerIndices(leaguePlayers, best.preset, models));
    const rank = percentileRank(peerCache.get(best.name)!, best.forecast.next);
    const need = 100 - rank;
    if (best.forecast.parts.age <= DECLINE_POINTS) flags.push('decline');

    let level: NeedLevel = need >= NEED_HIGH ? 'high' : need >= NEED_MEDIUM ? 'medium' : 'low';
    if (level === 'low' && flags.some(f => f === 'contract' || f === 'decline' || f === 'rotation')) level = 'medium';
    return {
      placed, starter, position, presetName: best.name, preset: best.preset, forecast: best.forecast,
      rank, need, level, flags, contractMonths,
    };
  });
}

/**
 * Titulaire de référence d'un rôle : la même projection partout (ligne du besoin, dossier du
 * candidat, écart). Dans le meilleur rôle du titulaire, c'est exactement need.forecast ; dans
 * un autre rôle choisi, le même calcul (forecastRole, sans changement de club, sans
 * complémentarité). Indéfini si le besoin n'est pas mesurable.
 */
export function incumbentForecast(need: SlotNeed | undefined, presetName: string | undefined, preset: RolePreset | undefined, models: Models): RoleForecast | undefined {
  if (!need?.starter || !need.forecast || !preset) return undefined;
  if (presetName === need.presetName) return need.forecast;
  return forecastRole(need.starter, preset, models);
}

// ============================================
// COMPLÉMENTARITÉ (lecture séparée)
// ============================================

const PARTNER_FAMILIES: Record<string, string[]> = {
  CB: ['CB'], FB: ['W', 'AM'], W: ['FB'], MID: ['MID'], AM: ['ST'], ST: ['ST', 'AM'],
};

const side = (y: number) => (y < 0.4 ? 'left' : y > 0.6 ? 'right' : 'centre');

/**
 * Partenaire de ligne d'une case : l'autre central, l'autre milieu, l'ailier ou le latéral
 * du même côté, l'attaquant devant le meneur... le plus proche sur le terrain. Un titulaire
 * hors poste n'est pas un partenaire : ses percentiles sont ceux de son poste d'origine.
 */
export function slotPartner(needs: SlotNeed[], index: number): SlotNeed | undefined {
  const me = needs[index];
  const family = FAMILY[me.position ?? ''];
  const wanted = PARTNER_FAMILIES[family];
  if (!wanted) return undefined;
  let best: SlotNeed | undefined;
  let bestDistance = Infinity;
  needs.forEach((other, j) => {
    if (j === index || !other.starter || other.flags.includes('outOfPosition') || !wanted.includes(FAMILY[other.position ?? ''])) return;
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
  value: number;       // percentile actuel du partenaire, dans le sens « plus c'est haut, mieux c'est »
  weight: number;      // sens de la métrique : +1, ou -1 si moins c'est mieux
}

export const COMPLEMENT_WEIGHT = 1;
export const COMPLEMENT_THRESHOLD = 35;

/**
 * Points faibles du partenaire parmi les métriques des rôles du poste à pourvoir (sous le
 * 35e percentile, dans le bon sens), du plus faible au moins faible
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

export interface ComplementReading {
  metrics: { metric: string; partner: number; candidate: number | undefined; inverted: boolean }[];
  mean: number | undefined;      // moyenne des percentiles projetés du candidat sur ces métriques
}

/**
 * Réponse d'un candidat aux points faibles du partenaire : son percentile projeté chez nous
 * (même projection que l'indice), métrique par métrique, dans le sens « plus c'est haut,
 * mieux c'est ». Une lecture : rien n'est ajouté à l'indice projeté.
 */
export function complementReading(player: PlayerData, complements: Complement[], models: Models, target?: Target): ComplementReading | undefined {
  if (complements.length === 0) return undefined;
  const metrics = complements.map(c => {
    const next = forecastMetric(player, c.metric, models, target)?.next;
    return {
      metric: c.metric, partner: c.value, inverted: c.weight < 0,
      candidate: next === undefined ? undefined : c.weight < 0 ? 100 - next : next,
    };
  });
  const known = metrics.map(m => m.candidate).filter((v): v is number => v !== undefined);
  return { metrics, mean: known.length ? known.reduce((s, v) => s + v, 0) / known.length : undefined };
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

export type CandidateFlag = 'fewMinutes' | 'rareLeague' | 'bigStep' | 'noContext' | 'contextEffect' | 'contract' | 'belowEstimate';

export const FEW_MINUTES = 1200;
export const RARE_LEAGUE_MOVES = 15;
export const BIG_STEP_POINTS = -5;
// Effet de contexte (domination territoriale) jugé important : |terme de contexte| de
// l'indice d'au moins 12 points. Seuil descriptif, environ le 95e centile des candidats
// évalués sur toutes les saisons (docs/methodology.md) ; le terme n'est pas plafonné.
export const CONTEXT_EFFECT_NOTABLE = 12;

export interface Candidate {
  player: PlayerData;
  forecast: RoleForecast;          // projection sportive dans l'équipe cible, saison suivante (sans complémentarité)
  gain?: number;                   // forecast.next - indice projeté du titulaire, dans le même rôle
  market?: MarketEntry;            // saison analysée seulement (seasonMarket)
  contractMonths?: number;
  complement?: ComplementReading;  // lecture séparée, jamais ajoutée à l'indice
  flags: CandidateFlag[];
  efficient: boolean;              // frontière valeur / performance
}

/**
 * Entonnoir de la recherche, étape par étape (contraintes dures, dans l'ordre), avec les
 * exclusions dues à une donnée manquante comptées à part
 */
export interface CandidateFunnel {
  pool: number;                    // joueurs de championnat de la saison, hors effectif
  position: number;                // au poste du rôle
  minutes: number;                 // minutes minimum
  age: number;                     // tranche d'âge
  ageUnknown: number;              // écartés faute d'âge connu (tranche d'âge restreinte)
  leagues: number;                 // championnats retenus
  modelUnavailable: number;        // écartés : le filtre de niveau demande le modèle de transfert
  budget: number;                  // plafond de valeur
  valueUnknown: number;            // écartés faute de valeur connue (plafond fixé)
  contract: number;                // échéance de contrat
  contractUnknown: number;         // écartés faute de contrat connu (échéance fixée)
  projectable: number;             // indice du rôle projetable
  insufficientData: number;        // aucune métrique du rôle renseignée
}

export interface CandidateSearch {
  candidates: Candidate[];         // les `limit` meilleures projections
  funnel: CandidateFunnel;
}

/**
 * Candidats d'un rôle pour l'équipe cible, de la meilleure projection sportive à la moins
 * bonne. `complements` n'agit pas sur le classement : il ajoute une lecture par candidat.
 */
export function searchCandidates(opts: {
  pool: PlayerData[];                    // lignes de championnat de la saison (leagueRows)
  preset: RolePreset;
  target: Target;
  models: Models;
  baseline?: number;                     // indice projeté du titulaire, même rôle
  complements?: Complement[];
  filters: SearchFilters;
  market: MarketValues | null;           // seasonMarket : null pour une saison passée
  asOf: Date;
  limit?: number;
  fewMinutes?: number;                   // seuil du signal « peu de minutes »
}): CandidateSearch {
  const {
    pool, preset, target, models, baseline, complements = [], filters, market, asOf, limit = 50,
    fewMinutes = FEW_MINUTES,
  } = opts;
  const transfer = models.transfer;
  const targetLevel = transfer ? leagueLevel(transfer, target.competition, target.tier) : 0;
  const fullAgeRange = filters.minAge <= AGE_RANGE[0] && filters.maxAge >= AGE_RANGE[1];
  // Sans marché pour la saison, ni plafond de valeur ni échéance de contrat
  const maxValue = market ? filters.maxValue : undefined;
  const contractWithin = market ? filters.contractWithinMonths : undefined;
  const contextMissing = (player: PlayerData) => !!transfer && transfer.context.length > 0
    && transfer.context.some(col => num(player[col]) === undefined || num(target.context[col]) === undefined);

  const funnel: CandidateFunnel = {
    pool: 0, position: 0, minutes: 0, age: 0, ageUnknown: 0, leagues: 0, modelUnavailable: 0,
    budget: 0, valueUnknown: 0, contract: 0, contractUnknown: 0, projectable: 0, insufficientData: 0,
  };
  const out: Candidate[] = [];
  pool.forEach(player => {
    if (player['Team ID'] === target.teamId) return;
    funnel.pool++;
    if (!preset.positions.includes(player.Position)) return;
    funnel.position++;
    const minutes = num(player['Minutes played']) ?? 0;
    if (minutes < filters.minMinutes) return;
    funnel.minutes++;
    const age = num(player.Age);
    if (age === undefined && !fullAgeRange) { funnel.ageUnknown++; return; }
    if (age !== undefined && (age < filters.minAge || age > filters.maxAge)) return;
    funnel.age++;

    if (filters.leagues === 'same' && player.Competition !== target.competition) return;
    if (filters.leagues === 'other' && player.Competition === target.competition) return;
    if (filters.leagues === 'lower') {
      if (!transfer) { funnel.modelUnavailable++; return; }
      if (leagueLevel(transfer, player.Competition, player['League tier']) >= targetLevel) return;
    }
    funnel.leagues++;

    const entry = market?.players.get(player['Player ID'] ?? '');
    if (maxValue !== undefined) {
      if (entry?.value === undefined) {
        if (!filters.includeUnknownValue) { funnel.valueUnknown++; return; }
      } else if (entry.value > maxValue) return;
    }
    funnel.budget++;
    const contractMonths = monthsUntil(entry?.contract, asOf);
    if (contractWithin !== undefined) {
      if (contractMonths === undefined) { funnel.contractUnknown++; return; }
      if (contractMonths > contractWithin) return;
    }
    funnel.contract++;

    const forecast = forecastRole(player, preset, models, target);
    if (!forecast) { funnel.insufficientData++; return; }
    funnel.projectable++;

    const moving = !!transfer && player['Team ID'] !== target.teamId;
    const flags: CandidateFlag[] = [];
    if (minutes < fewMinutes) flags.push('fewMinutes');
    if (transfer && player.Competition !== target.competition
      && (transfer.leagues[player.Competition ?? '']?.moves ?? 0) < RARE_LEAGUE_MOVES) flags.push('rareLeague');
    if (forecast.parts.league <= BIG_STEP_POINTS) flags.push('bigStep');
    if (moving && contextMissing(player)) flags.push('noContext');
    if (Math.abs(forecast.parts.context) >= CONTEXT_EFFECT_NOTABLE) flags.push('contextEffect');
    if (contractMonths !== undefined && contractMonths <= CONTRACT_MONTHS) flags.push('contract');
    if (entry?.value && entry.estimated && entry.estimated >= ESTIMATE_RATIO_MIN * entry.value) flags.push('belowEstimate');

    out.push({
      player,
      forecast,
      gain: baseline === undefined ? undefined : forecast.next - baseline,
      market: entry,
      contractMonths,
      complement: complementReading(player, complements, models, target),
      flags,
      efficient: false,
    });
  });

  out.sort((a, b) => b.forecast.next - a.forecast.next);
  markEfficient(out);
  return { candidates: out.slice(0, limit), funnel };
}

/**
 * Frontière valeur / performance (Pareto). A domine B si A a une projection au moins égale
 * pour une valeur Transfermarkt au plus égale, et est strictement meilleur sur l'une des deux.
 * Un candidat de valeur connue est efficient si aucun autre ne le domine : deux candidats
 * identiques (même valeur, même projection) le sont tous les deux. Performance = projection
 * sportive (sans complémentarité) ; coût = valeur Transfermarkt.
 */
export function markEfficient(candidates: Candidate[]): void {
  candidates.forEach(c => { c.efficient = false; });
  const priced = candidates.filter(c => c.market?.value !== undefined)
    .sort((a, b) => a.market!.value! - b.market!.value!);
  let bestCheaper = -Infinity;          // meilleure projection parmi les candidats strictement moins chers
  for (let i = 0; i < priced.length;) {
    const value = priced[i].market!.value!;
    let j = i;
    let groupBest = -Infinity;
    while (j < priced.length && priced[j].market!.value! === value) groupBest = Math.max(groupBest, priced[j++].forecast.next);
    for (let k = i; k < j; k++) priced[k].efficient = priced[k].forecast.next === groupBest && groupBest > bestCheaper;
    bestCheaper = Math.max(bestCheaper, groupBest);
    i = j;
  }
}

// ============================================
// AFFICHAGE DE LA PROJECTION
// ============================================

/** Indice affiché : arrondi de la valeur au dixième, pour que la cascade et l'indice concordent */
export const tenths = (v: number) => Math.round(v * 10) / 10;
export const displayIndex = (v: number) => Math.round(tenths(v));

export type CascadeKey = 'regression' | 'age' | 'league' | 'context' | 'adaptation' | 'cap';

export interface ProjectionCascade {
  now: number;                                   // indice actuel, au dixième
  steps: { key: CascadeKey; value: number; shown: number }[];   // valeur exacte, valeur affichée au dixième
  next: number;                                  // indice projeté, au dixième
  rounded: number;                               // indice projeté affiché (entier)
}

/**
 * Cascade de l'indice actuel à l'indice projeté, au dixième, qui tombe juste à l'affichage :
 * chaque étape affichée est l'écart entre deux cumuls arrondis (arrondi cumulé), donc
 * actuel + étapes = projeté exactement, à moins d'un dixième de chaque valeur exacte. Les
 * calculs ne changent pas. Une étape « plafond » apparaît si l'indice a été borné à 100.
 */
export function projectionCascade(f: RoleForecast): ProjectionCascade {
  const keys: CascadeKey[] = ['regression', 'age', 'league', 'context', 'adaptation'];
  const steps: ProjectionCascade['steps'] = [];
  let running = f.now;
  let shownRunning = Math.round(f.now * 10);      // en dixièmes entiers : pas d'erreur de virgule
  const push = (key: CascadeKey, value: number) => {
    running += value;
    const cum = Math.round(running * 10);
    steps.push({ key, value, shown: (cum - shownRunning) / 10 });
    shownRunning = cum;
  };
  keys.forEach(k => push(k, f.parts[k]));
  if (Math.abs(f.next - running) > 1e-9) push('cap', f.next - running);
  return { now: Math.round(f.now * 10) / 10, steps, next: shownRunning / 10, rounded: Math.round(shownRunning / 10) };
}

/**
 * Erreur historique de la projection d'indice (validation hors échantillon du modèle de
 * transfert) pour ce type de mouvement : changement de championnat, ou changement de club
 * dans le même championnat. Aucune propagation n'est calculée.
 */
export function projectionError(transfer: TransferModel | null | undefined, leagueChange: boolean): { mae: number; moves: number; season: string; leagueChange: boolean } | undefined {
  const v = transfer?.validation;
  if (!v?.index) return undefined;
  return leagueChange
    ? { mae: v.index.movers.model, moves: v.movers, season: v.season, leagueChange }
    : { mae: v.index.clubChanges.model, moves: v.clubChanges, season: v.season, leagueChange };
}

// ============================================
// LECTURE D'UN CANDIDAT (dossier)
// ============================================

/**
 * Un candidat en blocs indépendants, sans score global : la projection sportive, la
 * complémentarité, la valeur, l'incertitude et les signaux ne se mélangent pas.
 * Blocs prévus plus tard, NON implémentés (ni donnée ni modèle validé à ce jour) : risque
 * (blessures), finance (coût total, amortissement), règles (UEFA, effectif). Ils s'ajouteront
 * comme blocs séparés, jamais comme termes de la projection.
 */
export interface CandidateView {
  sport: {
    now: number;                       // indice actuel du rôle
    next: number;                      // projection centrale chez nous, saison prochaine
    cascade: ProjectionCascade;
    incumbentNext?: number;            // projection du titulaire dans le même rôle
    gain?: number;                     // différence entre les deux projections
    leagueChange: boolean;             // changement de championnat (sinon de club)
  };
  complementarity?: ComplementReading;
  value: {                             // null : saison sans données de marché
    market?: number;
    estimate?: number;
    contract?: string;
    contractMonths?: number;
    efficient: boolean;
    belowEstimate: boolean;
  } | null;
  uncertainty?: ReturnType<typeof projectionError>;
  signals: CandidateFlag[];            // signaux sportifs et de contexte (hors valeur)
}

const VALUE_FLAGS: CandidateFlag[] = ['contract', 'belowEstimate'];

export function candidateView(c: Candidate, opts: {
  incumbent?: RoleForecast;
  targetCompetition: string;
  transfer: TransferModel | null | undefined;
  hasMarket: boolean;
}): CandidateView {
  const leagueChange = c.player.Competition !== opts.targetCompetition;
  return {
    sport: {
      now: c.forecast.now, next: c.forecast.next, cascade: projectionCascade(c.forecast),
      incumbentNext: opts.incumbent?.next,
      gain: opts.incumbent ? c.forecast.next - opts.incumbent.next : undefined,
      leagueChange,
    },
    complementarity: c.complement,
    value: opts.hasMarket ? {
      market: c.market?.value, estimate: c.market?.estimated, contract: c.market?.contract, contractMonths: c.contractMonths,
      efficient: c.efficient, belowEstimate: c.flags.includes('belowEstimate'),
    } : null,
    uncertainty: projectionError(opts.transfer, leagueChange),
    signals: c.flags.filter(f => !VALUE_FLAGS.includes(f)),
  };
}
