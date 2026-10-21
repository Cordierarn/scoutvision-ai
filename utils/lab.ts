/**
 * ScoutVision AI - Calculs du Laboratoire côté app (données de scripts/prepare_lab.py)
 */

import { CoachSpell, Imprint } from '../services/labData';

/**
 * Moyenne mobile centrée sur `window` valeurs (fenêtre raccourcie aux extrémités)
 */
export function rollingMean(values: number[], window = 3): number[] {
  const half = Math.floor(window / 2);
  return values.map((_, i) => {
    const part = values.slice(Math.max(0, i - half), Math.min(values.length, i + half + 1));
    return part.reduce((s, v) => s + v, 0) / part.length;
  });
}

/**
 * Signature de style d'un entraîneur : moyenne de ses périodes, pondérée par leurs matchs
 * (écarts-types par rapport à son championnat-saison)
 */
export function coachSignature(spells: CoachSpell[], coach: string, dims: string[]): Record<string, number> | null {
  const own = spells.filter(s => s.coach === coach);
  const total = own.reduce((s, x) => s + x.n, 0);
  if (total === 0) return null;
  return Object.fromEntries(dims.map(d => [d, own.reduce((s, x) => s + Number(x[d]) * x.n, 0) / total]));
}

/**
 * Période la plus récente d'une équipe (son style actuel)
 */
export function latestSpell(spells: CoachSpell[], teamId: string): CoachSpell | undefined {
  return spells.filter(s => s.team_id === teamId).sort((a, b) => b.end.localeCompare(a.end))[0];
}

/**
 * Style attendu d'une équipe si un entraîneur arrive, dimension par dimension :
 * constante + poids du club x style actuel du club + poids de l'entraîneur x sa signature
 */
export function simulateArrival(
  current: Record<string, number>,
  signature: Record<string, number>,
  imprint: Record<string, Imprint>,
): Record<string, number> {
  return Object.fromEntries(Object.entries(imprint).map(([d, w]) =>
    [d, w.intercept + w.club * (current[d] ?? 0) + w.coach * (signature[d] ?? 0)]));
}

/**
 * Nombre décimal à la française (virgule), avec signe si demandé ; « − » typographique
 */
export function frNumber(v: number, digits = 2, signed = false): string {
  const text = Math.abs(v).toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  if (!signed) return v < 0 ? `−${text}` : text;
  return `${v > 0 ? '+' : v < 0 ? '−' : '±'}${text}`;
}

/**
 * Pourcentage à la française
 */
export function frPercent(v: number, digits = 0): string {
  return `${(100 * v).toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits })} %`;
}
