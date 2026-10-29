/**
 * ScoutVision - sens des métriques (une valeur plus élevée est-elle préférable ?)
 *
 * Source explicite : les poids des rôles officiels (utils/rolePresets.json). Un poids négatif
 * signifie que le rôle compte 100 − percentile : une valeur plus faible y est préférable.
 * - « lower » : poids négatif dans au moins un rôle et jamais positif ;
 * - « higher » : poids positif dans au moins un rôle et jamais négatif ;
 * - inconnu sinon (métrique absente des rôles, ou poids de signes opposés).
 * Quand le sens est inconnu, aucune valeur n'est présentée comme « meilleure ».
 */

import { DEFAULT_ROLE_PRESETS, presetWeights } from './rolePresets';

export type MetricDirection = 'higher' | 'lower';

const SIGNS = new Map<string, Set<number>>();
Object.values(DEFAULT_ROLE_PRESETS).forEach(preset => {
  Object.entries(presetWeights(preset)).forEach(([key, weight]) => {
    if (weight === 0) return;
    if (!SIGNS.has(key)) SIGNS.set(key, new Set());
    SIGNS.get(key)!.add(Math.sign(weight));
  });
});

const DIRECTIONS = new Map<string, MetricDirection>();
SIGNS.forEach((signs, key) => {
  if (signs.size === 1) DIRECTIONS.set(key, signs.has(-1) ? 'lower' : 'higher');
});

/** Métriques pour lesquelles une valeur plus faible est préférable */
export const LOWER_IS_BETTER: ReadonlySet<string> = new Set(
  [...DIRECTIONS].filter(([, d]) => d === 'lower').map(([k]) => k),
);

export function metricDirection(key: string): MetricDirection | undefined {
  return DIRECTIONS.get(key);
}
