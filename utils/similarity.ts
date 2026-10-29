/**
 * ScoutVision - moteur de similarité entre joueurs (sans rendu)
 *
 * Score explicable sur les percentiles du pipeline (« X pct », rôle × niveau × saison) :
 * pour chaque composante k disponible chez les deux joueurs, delta_k = |P_ref − P_cand| ;
 * similarité = 100 − moyenne des delta_k. Le score, « Pourquoi similaire ? » et le radar
 * lisent la même liste de composantes : aucune explication ne peut diverger de la formule.
 * Une métrique absente ne participe pas (jamais lue comme P0) ; sous le seuil de couverture,
 * il n'y a pas de score.
 */

import { PlayerData, getPlayerSeason, getPlayerSeasonId } from '../types';
import { getPositionCategory, PositionCategory, SIMILARITY_METRICS } from './positionMetrics';
import { metricLabel } from './labels';
import { metricValue, percentileOf } from './metricFormat';
import { SQUAD_DIMENSIONS } from './recruitment';
import { DEFAULT_ROLE_PRESETS, presetsForPosition, roleIndex, weightedRoleScore } from './rolePresets';

// ============================================
// COMPOSANTES (déclaratives : une nouvelle métrique s'ajoute ici, sans toucher au calcul)
// ============================================

export interface SimilarityComponentDef {
  key: string;        // colonne « X » (percentile dans « X pct »)
  weight: number;     // poids dans la moyenne (1 pour toutes les métriques actuelles)
}

/** Composantes par catégorie de poste : les métriques fixes et documentées de SIMILARITY_METRICS */
export const SIMILARITY_COMPONENTS: Record<PositionCategory, SimilarityComponentDef[]> = Object.fromEntries(
  Object.entries(SIMILARITY_METRICS).map(([cat, keys]) => [cat, keys.map(key => ({ key, weight: 1 }))]),
) as Record<PositionCategory, SimilarityComponentDef[]>;

export function componentsForPosition(position: string | undefined): SimilarityComponentDef[] {
  if (!position) return [];
  return SIMILARITY_COMPONENTS[getPositionCategory(position)];
}

/**
 * Seuil de couverture : composantes disponibles chez les deux joueurs pour qu'un score existe.
 * Mesuré sur 2025-26 et 2026-27 : la couverture vaut 12, 11 ou 9 pour plus de 99 % des joueurs
 * de champ ; les exceptions sont des avant-centres à 7/12 (sans npxG, xGOT, tirs cadrés ni xA)
 * et des gardiens à 5-6/12 (sans les métriques de gardien). Le seuil 8 tombe dans ce creux.
 */
export const MIN_COVERAGE = 8;

// ============================================
// SCORE
// ============================================

export interface SimilarityComponent {
  key: string;
  label: string;
  weight: number;
  pRef: number | null;
  pCandidate: number | null;
  delta: number | null;        // |pRef − pCandidate| quand les deux existent
}

export interface SimilarityResult {
  player: PlayerData;
  id: string;
  components: SimilarityComponent[];   // toutes les composantes du poste, disponibles ou non
  covered: number;                     // composantes avec un percentile chez les deux joueurs
  total: number;
  score: number | null;                // 100 − moyenne pondérée des delta ; null sous le seuil
}

/** Composantes de la paire référence / candidat, dans l'ordre du poste de la référence */
export function similarityComponents(reference: PlayerData, candidate: PlayerData, defs = componentsForPosition(reference.Position)): SimilarityComponent[] {
  return defs.map(({ key, weight }) => {
    const pRef = percentileOf(reference, key);
    const pCandidate = percentileOf(candidate, key);
    return { key, label: metricLabel(key), weight, pRef, pCandidate, delta: pRef !== null && pCandidate !== null ? Math.abs(pRef - pCandidate) : null };
  });
}

/** Score à partir des composantes : 100 − moyenne pondérée des écarts disponibles, borné à [0, 100] ; null sous le seuil */
export function scoreFromComponents(components: SimilarityComponent[], minCoverage = MIN_COVERAGE): { score: number | null; covered: number } {
  let sum = 0;
  let weights = 0;
  let covered = 0;
  components.forEach(c => {
    if (c.delta === null || c.weight <= 0) return;
    sum += c.weight * c.delta;
    weights += c.weight;
    covered++;
  });
  if (covered < minCoverage || weights === 0) return { score: null, covered };
  return { score: Math.max(0, Math.min(100, 100 - sum / weights)), covered };
}

export function similarity(reference: PlayerData, candidate: PlayerData): SimilarityResult {
  const components = similarityComponents(reference, candidate);
  const { score, covered } = scoreFromComponents(components);
  return { player: candidate, id: getPlayerSeasonId(candidate), components, covered, total: components.length, score };
}

/** Composantes classées : les plus proches (petits écarts) et les plus différentes (grands écarts) */
export function explainSimilarity(components: SimilarityComponent[], count = 4): { closest: SimilarityComponent[]; furthest: SimilarityComponent[]; missing: SimilarityComponent[] } {
  const known = components.filter(c => c.delta !== null).sort((a, b) => (a.delta as number) - (b.delta as number));
  return { closest: known.slice(0, count), furthest: [...known].reverse().slice(0, count), missing: components.filter(c => c.delta === null) };
}

// ============================================
// CANDIDATS ET FILTRES
// ============================================

export interface SimilarityFilters {
  samePosition: boolean;
  ageMax: number | null;
  minMinutes: number;
  competition: string;        // clé, '' = toutes
  tier: number | null;        // niveau de compétition, null = tous
}

/** Minutes minimales par défaut : 450 en saison en cours (seuil déjà utilisé par le Recrutement), 900 sur une saison complète */
export const defaultMinMinutes = (inProgress: boolean) => (inProgress ? 450 : 900);
export const MINUTES_OPTIONS = [0, 450, 900, 1350, 1800, 2400];

export const defaultFilters = (inProgress: boolean): SimilarityFilters => ({ samePosition: true, ageMax: null, minMinutes: defaultMinMinutes(inProgress), competition: '', tier: null });

const playerKey = (p: PlayerData) => String(p['Player ID'] || p.Player || '');

/**
 * Un candidat est une ligne joueur-saison distincte de la référence. Le même joueur est exclu
 * pour la saison de la référence (ses lignes de coupe comprises) ; en « Toutes les saisons »,
 * ses autres saisons sont des profils distincts et restent candidates.
 */
export function isCandidate(reference: PlayerData, p: PlayerData): boolean {
  if (getPlayerSeasonId(p) === getPlayerSeasonId(reference)) return false;
  return !(playerKey(p) === playerKey(reference) && getPlayerSeason(p) === getPlayerSeason(reference));
}

export function passesFilters(reference: PlayerData, p: PlayerData, f: SimilarityFilters): boolean {
  if (f.samePosition && p.Position !== reference.Position) return false;
  if (f.ageMax !== null) { const age = metricValue(p, 'Age'); if (age === null || age > f.ageMax) return false; }
  if ((metricValue(p, 'Minutes played') ?? 0) < f.minMinutes) return false;
  if (f.competition && p.Competition !== f.competition) return false;
  if (f.tier !== null && p['League tier'] !== f.tier) return false;
  return true;
}

export interface SimilaritySearch {
  results: SimilarityResult[];        // scorés, par similarité décroissante
  candidates: number;                 // après filtres
  insufficient: number;               // exclus pour couverture insuffisante
  referenceCovered: number;           // composantes avec percentile chez la référence
}

export function findSimilar(reference: PlayerData, data: PlayerData[], filters: SimilarityFilters, limit = 20): SimilaritySearch {
  const defs = componentsForPosition(reference.Position);
  const referenceCovered = defs.filter(d => percentileOf(reference, d.key) !== null).length;
  const scored: SimilarityResult[] = [];
  let candidates = 0;
  let insufficient = 0;
  for (const p of data) {
    if (!isCandidate(reference, p) || !passesFilters(reference, p, filters)) continue;
    candidates++;
    const r = similarity(reference, p);
    if (r.score === null) { insufficient++; continue; }
    scored.push(r);
  }
  scored.sort((a, b) => (b.score as number) - (a.score as number) || b.covered - a.covered);
  return { results: scored.slice(0, limit), candidates, insufficient, referenceCovered };
}

// ============================================
// LECTURES COMPLÉMENTAIRES (explication, jamais mêlées au score)
// ============================================

export interface DimensionPair { key: string; label: string; ref: number; candidate: number }

// Dimensions de SQUAD_DIMENSIONS pertinentes pour un gardien (couverture mesurée ≥ 70 % ; les autres sont vides pour lui)
const GK_FIELD_DIMENSIONS = new Set(['creation', 'progression', 'aerial', 'recovery']);

/** Score de dimension (même calcul que le profil d'effectif) pour les deux joueurs ; dimension masquée si l'un des deux n'en a aucune métrique */
export function dimensionPairs(reference: PlayerData, candidate: PlayerData): DimensionPair[] {
  const bothGk = reference.Position === 'GK' && candidate.Position === 'GK';
  const anyGk = reference.Position === 'GK' || candidate.Position === 'GK';
  return SQUAD_DIMENSIONS.flatMap(dim => {
    if (dim.goalkeepers && !bothGk) return [];
    if (!dim.goalkeepers && anyGk && !GK_FIELD_DIMENSIONS.has(dim.key)) return [];
    const preset = { positions: [], metrics: {}, weights: dim.metrics };
    const a = weightedRoleScore(preset, k => percentileOf(reference, k) ?? undefined);
    const b = weightedRoleScore(preset, k => percentileOf(candidate, k) ?? undefined);
    return a === undefined || b === undefined ? [] : [{ key: dim.key, label: dim.label, ref: Math.round(a), candidate: Math.round(b) }];
  });
}

export interface RolePair { name: string; ref: number; candidate: number }

/** Rôles compatibles du poste de la référence, indices (roleIndex) des deux joueurs ; vide si les postes diffèrent */
export function rolePairs(reference: PlayerData, candidate: PlayerData, limit = 5): RolePair[] {
  if (!reference.Position || candidate.Position !== reference.Position) return [];
  return presetsForPosition(reference.Position, DEFAULT_ROLE_PRESETS)
    .map(([name, preset]) => ({ name, ref: roleIndex(reference, preset), candidate: roleIndex(candidate, preset) }))
    .sort((a, b) => b.ref - a.ref)
    .slice(0, limit);
}
