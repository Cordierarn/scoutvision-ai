/**
 * ScoutVision - logique de la comparaison de joueurs (sans rendu)
 *
 * Tout repose sur les percentiles du pipeline (« X pct », relatifs au poste, au niveau et à la
 * saison de chaque joueur) : aucun percentile n'est recalculé, aucune donnée absente ne vaut 0,
 * aucun score agrégé n'est créé.
 */

import { PlayerData, getPlayerSeason, getPlayerSeasonId, getPlayerSeasonTag } from '../types';
import { getPositionCategory, getRadarMetricsForPosition } from './positionMetrics';
import { MetricDirection } from './metricDirection';
import { isSeasonTotal, metricValue, percentileOf } from './metricFormat';

export const MAX_COMPARED = 4;

// ============================================
// SÉLECTION
// ============================================

/** Entrée de sélection : identifiant joueur-club-compétition-saison et identifiant joueur (recherche rapide) */
export interface ComparisonEntry { id: string; pid: string }

const playerKey = (p: PlayerData) => String(p['Player ID'] || p.Player || '');

export function comparisonEntry(player: PlayerData): ComparisonEntry {
  return { id: getPlayerSeasonId(player), pid: playerKey(player) };
}

export type AddStatus = 'added' | 'duplicate' | 'full';

/** Ajout d'une entrée : refusée si elle est déjà présente (même joueur, club, compétition et saison) ou si la limite est atteinte */
export function addEntry(entries: ComparisonEntry[], entry: ComparisonEntry, max = MAX_COMPARED): { entries: ComparisonEntry[]; status: AddStatus } {
  if (entries.some(e => e.id === entry.id)) return { entries, status: 'duplicate' };
  if (entries.length >= max) return { entries, status: 'full' };
  return { entries: [...entries, entry], status: 'added' };
}

/**
 * Retrouve les lignes sélectionnées dans les données chargées (ordre conservé). Une entrée absente
 * des données (autre saison chargée) est rendue dans `missing` : la sélection n'est jamais conservée
 * sur une ligne qui n'existe plus.
 */
export function resolveSelection(entries: ComparisonEntry[], data: PlayerData[]): { players: PlayerData[]; missing: ComparisonEntry[] } {
  if (entries.length === 0) return { players: [], missing: [] };
  const pids = new Set(entries.map(e => e.pid));
  const found = new Map<string, PlayerData>();
  for (const p of data) {
    if (!pids.has(playerKey(p))) continue;
    const id = getPlayerSeasonId(p);
    if (!found.has(id)) found.set(id, p);
  }
  const players: PlayerData[] = [];
  const missing: ComparisonEntry[] = [];
  entries.forEach(e => { const p = found.get(e.id); if (p) players.push(p); else missing.push(e); });
  return { players, missing };
}

/** Ligne sans aucun percentile du pipeline (souvent une coupe jouée quelques minutes) */
export function hasDetailedStats(player: PlayerData): boolean {
  return Object.keys(player).some(k => k.endsWith(' pct') && percentileOf(player, k.slice(0, -4)) !== null);
}

/**
 * Libellé court et distinctif de chaque joueur : nom de famille ; nom complet si homonymes ;
 * pour le même joueur plusieurs fois, ajoute seulement ce qui diffère (club, compétition, saison).
 */
export function distinctNames(players: PlayerData[], competitionLabel: (p: PlayerData) => string = p => String(p.Competition ?? '')): string[] {
  const full = players.map(p => String(p.Player || 'Inconnu'));
  const last = full.map(n => n.split(' ').pop() as string);
  return players.map((p, i) => {
    if (last.filter(l => l === last[i]).length === 1) return last[i];
    const same = players.filter((_, j) => full[j] === full[i]);
    if (same.length === 1) return full[i];
    const differs = (f: (q: PlayerData) => string) => new Set(same.map(f)).size > 1;
    const parts = [full[i]];
    if (differs(q => String(q.Team))) parts.push(String(p.Team));
    if (differs(competitionLabel)) parts.push(competitionLabel(p));
    if (differs(q => getPlayerSeasonTag(q))) parts.push(getPlayerSeasonTag(p));
    return parts.join(' · ');
  });
}

// ============================================
// MÉTRIQUES
// ============================================

/**
 * Métriques par défaut : métriques radar des postes sélectionnés, entrelacées (une de chaque poste
 * à tour de rôle) et sans doublon. Un poste inconnu n'apporte aucune métrique.
 */
export function defaultComparisonMetrics(players: PlayerData[]): string[] {
  const categories: string[] = [];
  const lists: string[][] = [];
  players.forEach(p => {
    if (!p.Position) return;
    const category = getPositionCategory(p.Position);
    if (categories.includes(category)) return;
    categories.push(category);
    lists.push(getRadarMetricsForPosition(p.Position));
  });
  const out: string[] = [];
  const longest = Math.max(0, ...lists.map(l => l.length));
  for (let i = 0; i < longest; i++) lists.forEach(l => { if (l[i] && !out.includes(l[i])) out.push(l[i]); });
  return out;
}

/** Axes du radar : métriques avec un percentile pour chaque joueur (hors totaux), dans l'ordre, limitées à `max` */
export function radarAxes(players: PlayerData[], metrics: string[], max: number): { keys: string[]; available: number } {
  const usable = metrics.filter(k => !isSeasonTotal(k) && players.length > 0 && players.every(p => percentileOf(p, k) !== null));
  return { keys: usable.slice(0, max), available: usable.length };
}

/** Le radar n'a de sens qu'à partir de trois axes */
export const MIN_RADAR_AXES = 3;

export interface DifferenceRow { key: string; percentiles: number[]; spread: number }

/**
 * Principales différences : écart de percentile (2 joueurs) ou écart max − min (3 ou 4 joueurs),
 * classé par écart décroissant. Totaux exclus (pas de percentile) ; une métrique dont le percentile
 * manque pour au moins un joueur est rendue à part (« non comparable »). Lecture descriptive : aucun seuil.
 */
export function mainDifferences(players: PlayerData[], metrics: string[], limit = 5): {
  rows: DifferenceRow[]; notComparable: string[]; excludedTotals: string[];
} {
  const excludedTotals = metrics.filter(isSeasonTotal);
  if (players.length < 2) return { rows: [], notComparable: [], excludedTotals };
  const rows: DifferenceRow[] = [];
  const notComparable: string[] = [];
  metrics.filter(k => !isSeasonTotal(k)).forEach(key => {
    const values = players.map(p => percentileOf(p, key));
    const known = values.filter((v): v is number => v !== null);
    if (known.length === 0) return;                        // jamais de percentile pour cette métrique
    if (known.length < values.length) { notComparable.push(key); return; }
    rows.push({ key, percentiles: known, spread: Math.max(...known) - Math.min(...known) });
  });
  rows.sort((a, b) => b.spread - a.spread || metrics.indexOf(a.key) - metrics.indexOf(b.key));
  return { rows: rows.slice(0, limit), notComparable, excludedTotals };
}

/**
 * Meilleure valeur d'une ligne (indices des joueurs) selon le sens connu de la métrique.
 * Sens inconnu, moins de deux valeurs, ou tous les joueurs ex aequo : aucune mise en avant.
 * Ex aequo sur la meilleure valeur : tous mis en avant.
 */
export function bestValueIndices(values: (number | null)[], direction: MetricDirection | undefined): number[] {
  if (!direction) return [];
  const known = values.filter((v): v is number => v !== null);
  if (known.length < 2) return [];
  const best = direction === 'higher' ? Math.max(...known) : Math.min(...known);
  const winners = values.map((v, i) => (v === best ? i : -1)).filter(i => i >= 0);
  return winners.length === known.length ? [] : winners;
}

// ============================================
// GROUPES DE RÉFÉRENCE
// ============================================

export interface ReferenceGroups {
  samePosition: boolean;
  sameTier: boolean;
  sameSeason: boolean;
  unknownPosition: number[];               // indices des joueurs sans poste
}

/** Groupe de référence des percentiles de chaque joueur : poste × niveau × saison */
export function referenceGroups(players: PlayerData[]): ReferenceGroups {
  const distinct = (f: (p: PlayerData) => unknown) => new Set(players.map(f)).size <= 1;
  return {
    samePosition: distinct(p => p.Position ?? null),
    sameTier: distinct(p => p['League tier'] ?? null),
    sameSeason: distinct(p => getPlayerSeason(p)),
    unknownPosition: players.map((p, i) => (p.Position ? -1 : i)).filter(i => i >= 0),
  };
}

export { metricValue, percentileOf };
