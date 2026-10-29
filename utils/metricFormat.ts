/**
 * ScoutVision - lecture et affichage d'une métrique joueur : valeur, percentile du pipeline, unité.
 * Une donnée absente vaut null et s'affiche « – » : jamais 0 ni P0.
 */

import { PlayerData } from '../types';

// Totaux de saison : dépendent des minutes jouées, sans percentile dans le pipeline
export const SEASON_TOTALS: ReadonlySet<string> = new Set(['Goals', 'Assists', 'xG', 'xA', 'Errors leading to goal']);

export const isSeasonTotal = (key: string) => SEASON_TOTALS.has(key);

// Unité des totaux : [singulier, pluriel]
const TOTAL_UNITS: Record<string, [string, string]> = {
  Goals: ['but', 'buts'],
  Assists: ['passe déc.', 'passes déc.'],
  xG: ['xG', 'xG'],
  xA: ['xA', 'xA'],
  'Errors leading to goal': ['erreur', 'erreurs'],
};

/** Valeur numérique d'une métrique, null si absente ou non finie */
export function metricValue(player: PlayerData, key: string): number | null {
  const v = player[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Percentile du pipeline (« X pct » : rôle × niveau × saison), null s'il n'existe pas ; jamais recalculé */
export function percentileOf(player: PlayerData, key: string): number | null {
  const v = player[`${key} pct`];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

const FORMATS = new Map<number, Intl.NumberFormat>();
function fr(value: number, digits: number): string {
  let f = FORMATS.get(digits);
  if (!f) {
    f = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
    FORMATS.set(digits, f);
  }
  return f.format(value);
}

/** Valeur au format français avec son unité : « 0,42 /90 », « 77,8 % », « 6 buts » ; « – » si absente */
export function formatMetricValue(key: string, value: number | null): string {
  if (value === null) return '–';
  if (key.endsWith(', %')) return `${fr(value, 1)} %`;
  if (key.endsWith(' per 90')) return `${fr(value, 2)} /90`;
  const digits = Number.isInteger(value) ? 0 : 2;
  const unit = TOTAL_UNITS[key];
  if (unit) return `${fr(value, digits)} ${Math.abs(value) >= 2 ? unit[1] : unit[0]}`;
  return fr(value, digits);
}

/** Libellé d'axe de radar : « par 90 » abrégé en « /90 », comme dans les tableaux */
export const radarAxisLabel = (label: string) => label.replace(/ par 90$/, ' /90');
