/**
 * ScoutVision AI - Pronostics : logique pure de présentation (arrondis, valeurs absentes, seuils de
 * communication, textes du résultat marché). Aucune probabilité n'est recalculée.
 */

/** Pourcentages entiers dont la somme vaut exactement 100 (plus fort reste) ; NaN si une probabilité manque */
export function roundToHundred(probs: (number | null | undefined)[]): number[] | null {
  if (probs.some(p => p === null || p === undefined || !Number.isFinite(p) || p < 0)) return null;
  const values = probs as number[];
  const total = values.reduce((s, v) => s + v, 0);
  if (total <= 0) return null;
  const scaled = values.map(v => (100 * v) / total);
  const floors = scaled.map(Math.floor);
  let rest = 100 - floors.reduce((s, v) => s + v, 0);
  const order = scaled.map((v, i) => ({ i, frac: v - floors[i] })).sort((a, b) => b.frac - a.frac);
  for (const { i } of order) {
    if (rest <= 0) break;
    floors[i] += 1; rest -= 1;
  }
  return floors;
}

/** Buts attendus du modèle : « N/D » quand la valeur manque, jamais 0 artificiel */
export function formatGoals(v: number | null | undefined): string {
  return v === null || v === undefined || !Number.isFinite(v) ? 'N/D' : v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Communication du départage simplifié selon la part réelle des simulations concernées :
 * none (0), method (< 1 % : seulement dans Méthode & fiabilité), compact (1–5 % : mention près du statut),
 * banner (> 5 % : bandeau visible)
 */
export type TiebreakSignal = 'none' | 'method' | 'compact' | 'banner';

export function tiebreakSignal(share: number): TiebreakSignal {
  if (!Number.isFinite(share) || share <= 0) return 'none';
  if (share < 0.01) return 'method';
  if (share <= 0.05) return 'compact';
  return 'banner';
}

export const pctFr = (v: number, digits = 0): string => `${(100 * v).toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits })} %`;

/** Libellé du poids du modèle dans le mélange avec le marché (lecture de l'étape 2B, descriptif, jamais une rentabilité) */
export function poolLabel(weight: number | undefined | null): string {
  if (weight === undefined || weight === null || !Number.isFinite(weight)) return 'Non mesuré';
  if (weight === 0) return 'Le marché contient déjà l\'information du modèle';
  if (weight <= 0.2) return 'Information marginale';
  return 'Information complémentaire mesurable';
}

/** Textes du résultat établi (étape 2B), sans vocabulaire de pari */
export const MARKET_RESULT = {
  headline: 'Le marché de clôture reste plus précis que les modèles sportifs testés.',
  divergence: 'Les grands écarts entre ScoutVision et le marché sont principalement du bruit du modèle dans les données historiques.',
};

const FORBIDDEN = ['favori', 'avantage', 'value', 'pari', 'bookmaker', 'confiance', 'gagnant probable', 'misez', 'rendement'];

/** Contrôle de vocabulaire : mots à éviter sur la page Pronostics (test et garde-fou) */
export function forbiddenWords(text: string): string[] {
  const low = text.toLowerCase();
  return FORBIDDEN.filter(w => low.includes(w));
}

/** Dates de fraîcheur, jamais confondues : prévisions (index), replays, benchmark marché (période) */
export function freshness(indexGeneratedAt?: string | null, replaysGeneratedAt?: string | null, marketPeriod?: [string, string] | null): { forecasts: string | null; replays: string | null; market: string | null } {
  const day = (iso?: string | null) => {
    if (!iso) return null;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  };
  return {
    forecasts: day(indexGeneratedAt),
    replays: day(replaysGeneratedAt),
    market: marketPeriod ? `${day(marketPeriod[0]) ?? marketPeriod[0]} → ${day(marketPeriod[1]) ?? marketPeriod[1]}` : null,
  };
}
