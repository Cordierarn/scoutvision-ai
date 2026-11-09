/**
 * ScoutVision - filtres de la Base joueurs
 *
 * Une valeur absente (champ manquant, null, vide, non numérique) ne correspond jamais à une condition
 * bornée : elle n'est pas comptée comme 0. Une condition sans borne est sans effet.
 */

/** Bornes : nombre, ou texte du champ de saisie (« » = sans borne) */
export interface NumericCondition { key: string; min: number | string; max: number | string }

/** Valeur numérique connue, ou null (jamais 0 par défaut) */
export function knownNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Le joueur remplit-il toutes les conditions numériques ? */
export function matchesConditions(p: Record<string, unknown>, conditions: NumericCondition[]): boolean {
  return conditions.every(c => {
    const min = knownNumber(c.min), max = knownNumber(c.max);
    if (min === null && max === null) return true;
    const val = knownNumber(p[c.key]);
    if (val === null) return false;
    return (min === null || val >= min) && (max === null || val <= max);
  });
}
