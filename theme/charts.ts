/**
 * ScoutVision - identité des graphiques (Recharts et visualisations maison)
 *
 * Chaque couleur a un seul rôle :
 * - SERIES : identité (joueur 1, 2, 3, 4), ordre fixe, jamais réattribué selon le rang.
 *   Validé daltonisme sur la surface #101721 en « toutes paires » (radar superposé, nuages de points) :
 *   écart CVD le plus faible 18,8 (OKLab ×100, cible ≥ 8), vision normale ≥ 24. Le cyan de la marque
 *   est volontairement plus lumineux que les autres séries : la série 1 est le joueur de référence.
 * - CONTEXT : tout ce qui sert de comparaison (moyenne, autres candidats, témoins).
 * - DIVERGING : de part et d'autre d'une référence (médiane, zéro) ; le milieu est gris.
 * - SEQUENTIAL : intensité (cartes de chaleur), une seule teinte, du sombre au clair sur fond sombre.
 * - STATUS : états réservés (verdicts, niveaux de besoin), toujours avec icône et libellé.
 */

import type React from 'react';

export const BRAND = '#00E5FF';

export const SERIES = ['#00E5FF', '#d95926', '#9085e9', '#e8d44d'] as const;

export const CONTEXT = '#6B7788';

export const DIVERGING = { above: '#00C8E0', below: '#E66767', mid: '#303E50' } as const;

// Rampe cyan : du fond vers la marque puis vers le clair (12 pas)
export const SEQUENTIAL = [
  '#08303b', '#0a3f4d', '#0b4f60', '#0b6074', '#0a7289', '#07859f',
  '#0399b5', '#00adcb', '#00c1e0', '#3dd3ee', '#85e5f6', '#c6f4fc',
] as const;

// Statuts fixes (repris des verdicts du laboratoire, inchangés)
export const STATUS = { good: '#0ca30c', warning: '#fab219', serious: '#ec835a', critical: '#d03b3b', neutral: '#94a3b8' } as const;

// Résultat d'un tir : but (accent), cadré arrêté, non cadré ou contré
export const SHOT = { goal: '#00E5FF', saved: '#e8d44d', missed: '#6B7788' } as const;

// Encre et structure des graphiques (alignées sur les tokens CSS)
export const INK = {
  primary: '#F8FAFC',
  secondary: '#C4CDD8',
  muted: '#8996A7',
  faint: '#5E6B7C',
  grid: '#1E2938',
  axis: '#303E50',
  surface: '#101721',
  canvas: '#0B111A',
} as const;

// Props communes des axes Recharts
export const axisProps = {
  stroke: INK.axis,
  tick: { fill: INK.muted, fontSize: 11 },
  tickLine: false,
} as const;

export const gridProps = { stroke: INK.grid, vertical: false } as const;

// Infobulle Recharts par défaut (contentStyle / labelStyle / itemStyle)
export const tooltipProps = {
  contentStyle: {
    backgroundColor: '#1E2938',
    border: '1px solid #303E50',
    borderRadius: 4,
    fontSize: 12,
    padding: '6px 10px',
    boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
  } as React.CSSProperties,
  labelStyle: { color: INK.muted, fontSize: 11, marginBottom: 2 } as React.CSSProperties,
  itemStyle: { color: INK.primary, padding: 0 } as React.CSSProperties,
  cursor: { stroke: INK.axis, strokeWidth: 1 },
} as const;

// Grille polaire des radars : polygones discrets, rayon 50 marqué (médiane)
export const polarGridProps = { gridType: 'polygon' as const, stroke: INK.grid, strokeWidth: 1 };
export const polarAngleTick = { fill: INK.secondary, fontSize: 11, fontWeight: 500 };
