/**
 * ScoutVision - montants au format français, identiques dans la Base, le Chasseur et la fiche
 * (« 11 M€ », « 1,8 M€ », « 850 k€ »), comme dans les rapports rédigés.
 */

// Espace insécable entre le nombre et l'unité : « 1,8 M€ » ne se coupe pas en fin de ligne
const NBSP = ' ';
const ONE_DECIMAL = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const INTEGER = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });

export function formatEuro(value: number): string {
  if (!Number.isFinite(value)) return '–';
  const thousands = Math.round(value / 1e3);
  if (Math.abs(thousands) >= 1000) return `${ONE_DECIMAL.format(value / 1e6)}${NBSP}M€`;
  if (Math.abs(value) >= 1e3) return `${INTEGER.format(thousands)}${NBSP}k€`;
  return `${INTEGER.format(value)}${NBSP}€`;
}
