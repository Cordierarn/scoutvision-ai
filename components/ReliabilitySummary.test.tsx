/** Rendu statique du bloc « Fiabilité de l'échantillon » (fiche joueur), sur un modèle fictif */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import ReliabilitySummary from './ReliabilitySummary';
import { PercentileRange } from './prospects/SmallSamples';
import type { ReliabilityModel } from '../utils/reliability';

const params = (k: number) => ({ k, kPitchapi: k, calibrated: true, minutesForReliable: Math.round(k * 7 / 3), trueSd: { ST: 0.1 }, validation: [] });
const model: ReliabilityModel = { method: 'test', reliableAt: 0.7, summary: { metrics: 3, meanAbsCalibrationError: 0.02, percentileGapVsPitchapi: 2 },
  metrics: { 'Shots per 90': params(300), 'xG per 90': params(900), 'Goals per 90': params(2200) } };
const metrics = [
  { key: 'Shots per 90', label: 'Tirs par 90', value: 2.5 }, { key: 'xG per 90', label: 'xG par 90', value: 0.4 },
  { key: 'Goals per 90', label: 'Buts par 90', value: 0.3 }, { key: 'Accurate passes, %', label: 'Passes réussies, %', value: 80 },
];

describe('ReliabilitySummary', () => {
  it('classe les métriques par 90 du radar par niveau de fiabilité, les taux sont ignorés', () => {
    const html = renderToStaticMarkup(<ReliabilitySummary model={model} metrics={metrics} minutes={900} role="ST" />);
    expect(html).toContain('900 minutes, soit environ 10 matchs complets.');
    expect(html).toContain('Faible (moins de 40 %)');
    expect(html).toContain('Buts par 90');
    expect(html).toContain('29 %');                      // 900 / (900 + 2200)
    expect(html).toContain('fiable vers 57 matchs');     // 2200 × 7 / 3 minutes
    expect(html).toContain('Fiable (70 % et plus)');     // tirs : 900 / 1200 = 75 %
    expect(html).not.toContain('Passes réussies');
  });

  it('sans modèle ou sans minutes : rien ; seulement des taux : le dit', () => {
    expect(renderToStaticMarkup(<ReliabilitySummary model={null} metrics={metrics} minutes={900} role="ST" />)).toBe('');
    expect(renderToStaticMarkup(<ReliabilitySummary model={model} metrics={metrics.slice(3)} minutes={900} role="ST" />)).toContain('fiabilité non modélisée');
  });

  it('PercentileRange : percentile, bornes de l\'intervalle, tiret si absent', () => {
    const html = renderToStaticMarkup(<PercentileRange pct={70} low={40} high={92} />);
    expect(html).toContain('40–92');
    expect(html).toContain('Percentile estimé 70, intervalle à 90 % : 40 – 92');
    expect(renderToStaticMarkup(<PercentileRange pct={null} low={null} high={null} />)).toContain('–');
  });
});
