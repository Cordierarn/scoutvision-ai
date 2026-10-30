/**
 * ScoutVision - grille d'observation structurée et écart data / observation (fonctions pures)
 *
 * La grille d'un rôle reprend les critères du preset (métriques éliminatoires et de classement,
 * libellés de l'application) et quatre dimensions que les données ne mesurent pas. L'écart
 * juxtapose la note du scout (1 à 5) et la bande de percentile du snapshot : une lecture, jamais
 * un score fusionné ni une correction de la donnée.
 */

import { ReportFacts } from '../types/scoutReport';
import { CriterionRating, ObservationCriterion, ObservationGrid, ReportEvaluation, ScoutReportRecord } from '../types/scoutReport';
import { DEFAULT_ROLE_PRESETS, RolePreset, presetWeights } from './rolePresets';
import { metricLabel } from './labels';
import { orientedPercentile } from './scoutReportSnapshot';

/** Dimensions du jeu non couvertes par les métriques du pipeline, observées uniquement par le scout */
export const UNMEASURED_DIMENSIONS: { key: string; label: string; hint: string }[] = [
  { key: 'loss_behaviour', label: 'Comportement à la perte', hint: 'Réaction immédiate après la perte du ballon : contre-pressing, repli, abandon.' },
  { key: 'communication', label: 'Communication', hint: 'Prise de parole, placement des partenaires, gestion des situations.' },
  { key: 'pre_reception_scan', label: 'Orientation avant réception', hint: 'Prise d\'information et orientation du corps avant de recevoir.' },
  { key: 'defensive_recovery', label: 'Repli', hint: 'Vitesse et discipline du replacement défensif.' },
];

export const RATING_LABELS: Record<CriterionRating, string> = {
  1: 'Très en dessous', 2: 'En dessous', 3: 'Au niveau attendu', 4: 'Au-dessus', 5: 'Très au-dessus',
};

/** Bande de percentile associée à chaque note : 1 = P0-19, 2 = P20-39, 3 = P40-59, 4 = P60-79, 5 = P80-100 */
export const RATING_BANDS: Record<CriterionRating, [number, number]> = { 1: [0, 19], 2: [20, 39], 3: [40, 59], 4: [60, 79], 5: [80, 100] };

export const ratingForPercentile = (pct: number): CriterionRating => {
  const p = Math.max(0, Math.min(100, pct));
  return (p >= 80 ? 5 : p >= 60 ? 4 : p >= 40 ? 3 : p >= 20 ? 2 : 1) as CriterionRating;
};

/** Grille vide d'un rôle : critères du preset (poids décroissants, 8 au plus) puis dimensions non mesurées */
export function gridTemplate(role: string, presets: Record<string, RolePreset> = DEFAULT_ROLE_PRESETS, maxMetrics = 8): ObservationGrid {
  const preset = presets[role];
  const metrics: ObservationCriterion[] = preset
    ? Object.entries(presetWeights(preset))
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
      .slice(0, maxMetrics)
      .map(([key, w]) => ({ key, label: metricLabel(key) + (w < 0 ? ' (inv.)' : ''), kind: 'role_metric' as const }))
    : [];
  return { role, criteria: [...metrics, ...UNMEASURED_DIMENSIONS.map(d => ({ key: d.key, label: d.label, kind: 'unmeasured' as const }))] };
}

export interface CriterionGap {
  key: string;
  label: string;
  rating: CriterionRating;
  percentile?: number;          // percentile orienté du snapshot (sens « plus c'est haut, mieux c'est »)
  dataRating?: CriterionRating; // bande correspondante
  gap?: number;                 // note du scout − bande de la donnée (−4 à +4) ; positif = observé au-dessus de la donnée
}

export interface GridGaps {
  items: CriterionGap[];        // critères du rôle notés par le scout
  above: number;                // observé au-dessus de la donnée (gap ≥ 1)
  below: number;                // observé en dessous (gap ≤ −1)
  aligned: number;              // même bande
  unmatched: number;            // critères notés sans percentile dans le snapshot
}

/** Écart entre les notes du scout sur les métriques du rôle et les percentiles du snapshot */
export function gridGaps(grid: ObservationGrid, facts: ReportFacts): GridGaps {
  const byLabel = new Map(facts.metrics.map(m => [m.metric, m]));
  const items: CriterionGap[] = grid.criteria
    .filter((c): c is ObservationCriterion & { rating: CriterionRating } => c.kind === 'role_metric' && c.rating !== undefined)
    .map(c => {
      const m = byLabel.get(metricLabel(c.key));
      if (!m) return { key: c.key, label: c.label, rating: c.rating };
      const percentile = orientedPercentile(m);
      const dataRating = ratingForPercentile(percentile);
      return { key: c.key, label: c.label, rating: c.rating, percentile, dataRating, gap: c.rating - dataRating };
    });
  return {
    items,
    above: items.filter(i => i.gap !== undefined && i.gap >= 1).length,
    below: items.filter(i => i.gap !== undefined && i.gap <= -1).length,
    aligned: items.filter(i => i.gap === 0).length,
    unmatched: items.filter(i => i.gap === undefined).length,
  };
}

/** Le dossier est-il en aveugle non révélé (données chiffrées masquées) ? */
export const isBlindHidden = (evaluation: ReportEvaluation | undefined): boolean => !!evaluation?.blind && !evaluation.revealedAt;

/** Première note globale du scout : date de révélation d'un dossier en aveugle */
export function firstOverallRatingAt(record: Pick<ScoutReportRecord, 'observations'>): string | undefined {
  const rated = record.observations.filter(o => o.grid?.overall !== undefined).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return rated[0]?.createdAt;
}
