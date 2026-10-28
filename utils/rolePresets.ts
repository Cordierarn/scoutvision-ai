/**
 * ScoutVision AI - Rôles du Chasseur de pépites
 *
 * Chaque rôle a deux étages, à la manière des profils par poste de la recherche
 * (indicateurs propres au poste, regroupés en dimensions offensives et défensives) :
 * - `metrics` : critères éliminatoires, percentile minimum parmi les joueurs du même
 *   rôle et du même niveau de compétition ; l'exigence les fait monter ou descendre ;
 * - `weights` : critères de classement, pondérés dans l'indice du rôle (0-100) ; un
 *   poids négatif compte « moins c'est mieux » (100 - percentile).
 * `midfieldProfiles` : profils de milieu appris par le pipeline (k-means sur les actions),
 * un joueur du bon profil gagne MIDFIELD_PROFILE_BONUS points d'indice.
 * Toutes les métriques sont des clés de public/data/players/<saison>.json.
 *
 * Les rôles sont dans rolePresets.json : scripts/models.py les lit aussi pour valider
 * l'indice des rôles dans le modèle de transfert (même définition des deux côtés).
 */

import { PlayerData } from '../types';
import presetConfig from './rolePresets.json';

export interface RolePreset {
  positions: string[];
  metrics: Record<string, number>;          // critères éliminatoires : percentile minimum
  weights?: Record<string, number>;         // critères de classement : poids (négatif = inversé)
  midfieldProfiles?: string[];
  description?: string;
  category?: string;
  custom?: boolean;
}

export interface RoleCategory {
  key: string;
  label: string;
  icon: 'Hand' | 'Shield' | 'MoveHorizontal' | 'Anchor' | 'Repeat' | 'Wand2' | 'Zap' | 'Crosshair' | 'Flag';
}

export const ROLE_CATEGORIES: RoleCategory[] = [
  { key: 'gk', label: 'Gardien', icon: 'Hand' },
  { key: 'cb', label: 'Défenseur central', icon: 'Shield' },
  { key: 'fb', label: 'Latéral et piston', icon: 'MoveHorizontal' },
  { key: 'dm', label: 'Milieu défensif', icon: 'Anchor' },
  { key: 'cm', label: 'Milieu central', icon: 'Repeat' },
  { key: 'am', label: 'Milieu offensif', icon: 'Wand2' },
  { key: 'w', label: 'Ailier', icon: 'Zap' },
  { key: 'st', label: 'Avant-centre', icon: 'Crosshair' },
  { key: 'sp', label: 'Spécialiste', icon: 'Flag' },
];

const config = presetConfig as {
  coreWeight: number;
  midfieldProfileBonus: number;
  presets: Record<string, RolePreset>;
};

// Les critères éliminatoires comptent ce poids dans l'indice
const CORE_WEIGHT = config.coreWeight;
export const ROLE_CORE_WEIGHT = CORE_WEIGHT;
export const MIDFIELD_PROFILE_BONUS = config.midfieldProfileBonus;

export const DEFAULT_ROLE_PRESETS: Record<string, RolePreset> = config.presets;

/**
 * Percentile d'un joueur sur une métrique (undefined si non noté)
 */
const pct = (p: PlayerData, key: string): number | undefined => {
  const v = p[`${key} pct`];
  return typeof v === 'number' ? v : undefined;
};

/**
 * Métriques d'un rôle et leur poids dans l'indice : critères éliminatoires à CORE_WEIGHT
 * (sauf s'ils ont un poids de classement), critères de classement à leur poids
 */
export function presetWeights(preset: RolePreset): Record<string, number> {
  const weights: Record<string, number> = {};
  Object.keys(preset.metrics).forEach(key => { weights[key] = CORE_WEIGHT; });
  Object.entries(preset.weights ?? {}).forEach(([key, w]) => { weights[key] = w; });
  return weights;
}

/**
 * Indice d'un rôle (0-100, non arrondi, sans bonus) à partir d'une source de percentiles :
 * moyenne pondérée (poids absolu, 100 - percentile si le poids est négatif) ; les
 * métriques sans percentile sont ignorées et les poids renormalisés ; undefined si aucune
 * métrique n'a de percentile.
 */
export function weightedRoleScore(
  preset: RolePreset,
  value: (metric: string) => number | undefined,
  extraWeights: Record<string, number> = {},
): number | undefined {
  let sum = 0;
  let total = 0;
  const weights = presetWeights(preset);
  Object.entries(extraWeights).forEach(([key, w]) => { weights[key] = (weights[key] ?? 0) + w; });
  Object.entries(weights).forEach(([key, weight]) => {
    const v = value(key);
    if (v === undefined || weight === 0) return;
    sum += Math.abs(weight) * (weight < 0 ? 100 - v : v);
    total += Math.abs(weight);
  });
  return total === 0 ? undefined : sum / total;
}

/**
 * Bonus de l'indice quand le profil de milieu du joueur correspond au rôle
 */
export function midfieldBonus(player: PlayerData, preset: RolePreset): number {
  return preset.midfieldProfiles?.includes(String(player['Midfield profile'])) ? MIDFIELD_PROFILE_BONUS : 0;
}

/**
 * Indice du rôle (0-100) : moyenne pondérée des percentiles des critères éliminatoires
 * (poids CORE_WEIGHT) et des critères de classement (poids absolu, inversé si négatif),
 * plus MIDFIELD_PROFILE_BONUS si le profil de milieu correspond. Les métriques sans
 * percentile (analytics absente) sont ignorées et les poids renormalisés.
 */
export function roleIndex(player: PlayerData, preset: RolePreset): number {
  const score = weightedRoleScore(preset, key => pct(player, key));
  if (score === undefined) return 0;
  return Math.min(100, Math.round(score + midfieldBonus(player, preset)));
}

/**
 * Terme de l'indice d'un rôle : une métrique, son percentile et sa part dans l'indice
 */
export interface RoleIndexTerm {
  metric: string;
  eliminatory: boolean;          // critère éliminatoire (seuil de percentile)
  ranking: boolean;              // critère de classement (poids propre)
  percentile: number | undefined;
  weight: number;                // poids signé (négatif : « moins c'est mieux »)
  inverted: boolean;             // poids négatif : 100 - percentile
  scored: number | undefined;    // percentile compté (inversé si besoin) ; undefined si absent
  share: number;                 // part du poids dans l'indice (0-1), 0 si percentile absent
  contribution: number;          // points d'indice apportés (share × scored)
}

export interface RoleIndexBreakdown {
  terms: RoleIndexTerm[];
  weightedScore: number | undefined;  // moyenne pondérée non arrondie (weightedRoleScore)
  bonus: number;                      // bonus de profil de milieu
  total: number;                      // indice du rôle, identique à roleIndex
}

/**
 * Décomposition de l'indice d'un rôle, sans autre formule que roleIndex :
 * même moyenne pondérée (weightedRoleScore), même bonus, même arrondi et même plafond.
 */
export function roleIndexBreakdown(player: PlayerData, preset: RolePreset): RoleIndexBreakdown {
  const weights = presetWeights(preset);
  const counted = Object.entries(weights).filter(([key, w]) => w !== 0 && pct(player, key) !== undefined);
  const totalWeight = counted.reduce((sum, [, w]) => sum + Math.abs(w), 0);
  const terms: RoleIndexTerm[] = Object.entries(weights).map(([metric, weight]) => {
    const percentile = pct(player, metric);
    const inverted = weight < 0;
    const scored = percentile === undefined ? undefined : inverted ? 100 - percentile : percentile;
    const share = scored === undefined || weight === 0 || totalWeight === 0 ? 0 : Math.abs(weight) / totalWeight;
    return {
      metric,
      eliminatory: metric in preset.metrics,
      ranking: metric in (preset.weights ?? {}),
      percentile,
      weight,
      inverted,
      scored,
      share,
      contribution: scored === undefined ? 0 : share * scored,
    };
  });
  const weightedScore = weightedRoleScore(preset, key => pct(player, key));
  const bonus = weightedScore === undefined ? 0 : midfieldBonus(player, preset);
  const total = weightedScore === undefined ? 0 : Math.min(100, Math.round(weightedScore + bonus));
  return { terms, weightedScore, bonus, total };
}

/**
 * Rôles d'un poste classés par indice décroissant (même ordre que bestPreset en cas d'égalité) ;
 * les rôles sans aucun percentile disponible sont écartés
 */
export function rankPresets(
  player: PlayerData,
  presets: Record<string, RolePreset> = DEFAULT_ROLE_PRESETS,
  limit = 3,
): { name: string; preset: RolePreset; index: number }[] {
  return presetsForPosition(player.Position, presets)
    .filter(([, preset]) => weightedRoleScore(preset, key => pct(player, key)) !== undefined)
    .map(([name, preset]) => ({ name, preset, index: roleIndex(player, preset) }))
    .sort((a, b) => b.index - a.index)
    .slice(0, limit);
}

/**
 * Rôles d'un poste (GK, CB, FB...), sans les spécialistes (coups de pied arrêtés) ;
 * d'abord ceux dont c'est le poste principal (premier de `positions`)
 */
export function presetsForPosition(
  position: string | undefined,
  presets: Record<string, RolePreset> = DEFAULT_ROLE_PRESETS,
): [string, RolePreset][] {
  if (!position) return [];
  const roles = Object.entries(presets).filter(([, p]) => p.category !== 'sp' && p.positions.includes(position));
  return [...roles.filter(([, p]) => p.positions[0] === position), ...roles.filter(([, p]) => p.positions[0] !== position)];
}

/**
 * Meilleur rôle d'un joueur parmi ceux de son poste, avec son indice (0-100)
 */
export function bestPreset(
  player: PlayerData,
  presets: Record<string, RolePreset> = DEFAULT_ROLE_PRESETS,
): { name: string; preset: RolePreset; index: number } | null {
  let best: { name: string; preset: RolePreset; index: number } | null = null;
  presetsForPosition(player.Position, presets).forEach(([name, preset]) => {
    const index = roleIndex(player, preset);
    if (!best || index > best.index) best = { name, preset, index };
  });
  return best;
}
