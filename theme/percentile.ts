/**
 * ScoutVision - paliers de percentile
 * Échelle divergente autour de la médiane : élite et au-dessus en cyan, moyenne en gris,
 * en dessous et faible en rouge. La couleur ne porte jamais seule l'information :
 * la valeur (P92) et le libellé du palier l'accompagnent.
 */

export type PercentileTier = 'elite' | 'above' | 'average' | 'below' | 'weak';

export const PERCENTILE_TIERS: Record<PercentileTier, { label: string; min: number; color: string; text: string }> = {
  elite: { label: 'Élite', min: 90, color: '#00E5FF', text: 'text-accent' },
  above: { label: 'Au-dessus', min: 70, color: '#0096AD', text: 'text-ink' },
  average: { label: 'Moyenne', min: 31, color: '#4A586B', text: 'text-ink-2' },
  below: { label: 'En dessous', min: 11, color: '#A8504D', text: 'text-ink-2' },
  weak: { label: 'Faible', min: 0, color: '#E66767', text: 'text-neg' },
};

export const TIER_ORDER: PercentileTier[] = ['elite', 'above', 'average', 'below', 'weak'];

export function percentileTier(p: number): PercentileTier {
  if (p >= 90) return 'elite';
  if (p >= 70) return 'above';
  if (p > 30) return 'average';
  if (p > 10) return 'below';
  return 'weak';
}

export const percentileColor = (p: number) => PERCENTILE_TIERS[percentileTier(p)].color;
