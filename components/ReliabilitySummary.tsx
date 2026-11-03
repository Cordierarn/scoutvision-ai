/**
 * Fiabilité de l'échantillon d'un joueur (fiche joueur, panneau Percentiles) : pour chaque métrique par 90
 * du radar, part de signal de la valeur selon ses minutes (modèle du pipeline, models/reliability.json),
 * et matchs complets nécessaires pour une fiabilité de 70 %. Les taux (%, PAdj) ne sont pas modélisés.
 */

import React from 'react';
import { InfoTip } from './ui';
import { MetricReliability, ReliabilityLevel, ReliabilityModel, fullMatches, matchesLabel, playerMetricReliability, reliabilityClass } from '../utils/reliability';

const LEVELS: { level: ReliabilityLevel; title: string }[] = [
  { level: 'faible', title: 'Faible (moins de 40 %)' },
  { level: 'moyenne', title: 'Moyenne (40 à 70 %)' },
  { level: 'fiable', title: 'Fiable (70 % et plus)' },
];
const pct = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });

export interface ReliabilityMetricInput { key: string; label: string; value: number | undefined }

/** Fiabilités des métriques données, pour un joueur (minutes et rôle de sa saison) */
export function metricsReliability(model: ReliabilityModel | null | undefined, metrics: ReliabilityMetricInput[], minutes: number | undefined, role: string | undefined) {
  return metrics.flatMap(m => {
    const r = playerMetricReliability(model, m.key, minutes, role, m.value);
    return r ? [{ ...r, label: m.label }] : [];
  });
}

export const ReliabilitySummary: React.FC<{
  model: ReliabilityModel | null | undefined; metrics: ReliabilityMetricInput[]; minutes: number | undefined; role: string | undefined; className?: string;
}> = ({ model, metrics, minutes, role, className = '' }) => {
  if (!model || typeof minutes !== 'number') return null;
  const rows = metricsReliability(model, metrics, minutes, role) as (MetricReliability & { label: string })[];
  return (
    <div className={className}>
      <div className="sv-label flex items-center gap-1.5 mb-1">
        Fiabilité de l'échantillon
        <InfoTip text={`Part de signal de chaque valeur par 90, selon les minutes jouées : minutes / (minutes + k), k calibré par métrique sur les matchs pairs et impairs (corrélation des deux moitiés de saison, à poste égal). À 50 %, la moitié de l'écart à la moyenne du poste est du bruit.\nLes taux (%, PAdj) ne sont pas modélisés.`} />
      </div>
      <p className="text-2xs text-ink-3 mb-1.5 num">{minutes.toLocaleString('fr-FR')} minutes, soit environ {fullMatches(minutes)} matchs complets.</p>
      {rows.length === 0 ? (
        <p className="text-xs text-ink-4">Les métriques affichées sont des taux : fiabilité non modélisée.</p>
      ) : (
        <div className="space-y-1.5">
          {LEVELS.map(({ level, title }) => {
            const items = rows.filter(r => r.level === level).sort((a, b) => a.reliability - b.reliability);
            if (!items.length) return null;
            return (
              <div key={level}>
                <div className={`text-2xs ${reliabilityClass(level)}`}>{title}</div>
                {items.map(r => (
                  <div key={r.metric} className="flex items-center justify-between gap-2 h-6 text-xs min-w-0">
                    <span className="truncate text-ink-2" title={r.label}>{r.label}</span>
                    <span className="num shrink-0 text-right">
                      <span className={reliabilityClass(level)}>{pct.format(r.reliability * 100)} %</span>
                      {level !== 'fiable' && <span className="text-2xs text-ink-4"> · fiable vers {matchesLabel(r.matchesForReliable)}</span>}
                    </span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ReliabilitySummary;
