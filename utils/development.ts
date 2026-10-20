/**
 * ScoutVision AI - Projection à un an
 * Courbes d'âge de scripts/models.py : retour vers la moyenne + effet de l'âge, par rôle.
 */

import { PlayerData } from '../types';
import { AgeCurve, AgeCurves } from '../services/dataLoader';

export interface MetricProjection {
  metric: string;
  current: number;       // percentile actuel
  projected: number;     // percentile attendu la saison suivante
  ageEffect: number;     // part due à l'âge (points de percentile)
}

/**
 * Effet de l'âge d'une courbe (0 si l'âge n'est pas couvert)
 */
function ageEffect(curve: AgeCurve, age: number): number {
  return curve.ages[String(Math.round(age))]?.[0] ?? 0;
}

/**
 * Percentile attendu la saison suivante : pct + beta * (pct - 50) + effet de l'âge
 */
export function projectPercentile(pct: number, curve: AgeCurve, age: number): number {
  const next = pct + curve.beta * (pct - 50) + ageEffect(curve, age);
  return Math.max(0, Math.min(100, Math.round(next)));
}

/**
 * Projection des métriques d'un joueur qui ont un percentile et une courbe pour son rôle
 */
export function projectPlayer(player: PlayerData, curves: AgeCurves, metrics: string[]): MetricProjection[] {
  const age = Number(player.Age);
  const roleCurves = curves.curves[player.Position];
  if (!roleCurves || !age) return [];
  return metrics.flatMap(metric => {
    const pct = player[`${metric} pct`];
    const curve = roleCurves[metric];
    if (typeof pct !== 'number' || !curve) return [];
    return [{
      metric,
      current: pct,
      projected: projectPercentile(pct, curve, age),
      ageEffect: Math.round(ageEffect(curve, age) * 10) / 10,
    }];
  });
}

/**
 * Courbe de développement d'un rôle : effet moyen de l'âge sur ses métriques clés,
 * pour chaque âge (points de percentile gagnés ou perdus en une saison, à niveau égal)
 */
export function roleAgeProfile(curves: AgeCurves, role: string, metrics: string[]): { age: number; effect: number; n: number }[] {
  const roleCurves = curves.curves[role];
  if (!roleCurves) return [];
  const used = metrics.map(m => roleCurves[m]).filter(Boolean) as AgeCurve[];
  if (used.length === 0) return [];
  const out: { age: number; effect: number; n: number }[] = [];
  for (let age = 17; age <= 36; age++) {
    const points = used.map(c => c.ages[String(age)]).filter(Boolean);
    if (points.length === 0) continue;
    out.push({
      age,
      effect: Math.round((points.reduce((s, p) => s + p[0], 0) / points.length) * 10) / 10,
      n: Math.round(points.reduce((s, p) => s + p[1], 0) / points.length),
    });
  }
  return out;
}
