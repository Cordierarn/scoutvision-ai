/**
 * ScoutVision - carte des tirs sur la moitié offensive (attaque vers la droite)
 * Couleur = issue du tir, taille du point = xG. Partagée par la fiche joueur et l'analyse d'équipe.
 */

import React, { useState } from 'react';
import { ShotEvent } from '../types';
import { shotResultLabel, shotTypeLabel, situationLabel } from '../utils/labels';
import { INK, SHOT } from '../theme/charts';
import { LegendItem } from './ui';

const W = 105;
const H = 68;
const LINE = 'rgba(137,150,167,0.35)';

export const shotColor = (s: ShotEvent) => (s.result === 'Goal' ? SHOT.goal : s.result === 'SavedShot' ? SHOT.saved : SHOT.missed);

const ShotPitch: React.FC<{ shots: ShotEvent[]; showPlayer?: boolean; className?: string; emptyText?: string }> = ({
  shots, showPlayer = false, className = 'max-w-[340px]', emptyText = 'Aucune donnée de tir.',
}) => {
  const [hover, setHover] = useState<number | null>(null);
  const shot = hover !== null ? shots[hover] : undefined;
  return (
    <div className={`relative w-full aspect-[52.5/68] mx-auto bg-raised/60 rounded-md border border-line overflow-hidden ${className}`}>
      <svg viewBox={`${W / 2} 0 ${W / 2} ${H}`} className="absolute inset-0 w-full h-full" fill="none" stroke={LINE} strokeWidth="0.3"
        role="img" aria-label={`${shots.length} tirs`}>
        <rect x="0.3" y="0.3" width={W - 0.6} height={H - 0.6} />
        <circle cx={W / 2} cy={H / 2} r="9.15" />
        <rect x={W - 16.5} y={(H - 40.32) / 2} width="16.2" height="40.32" />
        <rect x={W - 5.5} y={(H - 18.32) / 2} width="5.2" height="18.32" />
        <path d={`M ${W - 16.5} ${H / 2 - 7.3} A 9.15 9.15 0 0 0 ${W - 16.5} ${H / 2 + 7.3}`} />
        <circle cx={W - 11} cy={H / 2} r="0.4" fill={LINE} />
        {/* Les buts en dernier : au-dessus des autres tirs */}
        {shots.map((s, i) => ({ s, i })).sort((a, b) => Number(a.s.result === 'Goal') - Number(b.s.result === 'Goal')).map(({ s, i }) => (
          <circle key={i} cx={s.X * W} cy={s.Y * H} r={Math.max(0.7, Math.min(2.6, Math.sqrt(s.xG || 0.02) * 3.2))}
            fill={shotColor(s)} fillOpacity={s.result === 'Goal' ? 0.95 : 0.7}
            stroke={hover === i ? INK.primary : INK.surface} strokeWidth={hover === i ? 0.4 : 0.25} style={{ cursor: 'pointer' }}
            onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
        ))}
      </svg>
      {shot && (
        <div className="sv-tooltip absolute pointer-events-none z-10 whitespace-nowrap"
          style={{ left: `${Math.min(Math.max((shot.X - 0.5) * 200 - 10, 0), 55)}%`, top: `${Math.max(shot.Y * 100 - 16, 2)}%` }}>
          {showPlayer && <div className="text-ink font-medium">{shot.player}</div>}
          <div className={showPlayer ? '' : 'text-ink font-medium'}>{shotResultLabel(shot.result)}</div>
          <div>xG {(shot.xG || 0).toFixed(2)} · {shot.minute}e min</div>
          <div className="text-ink-4">{shotTypeLabel(shot.shotType)} · {situationLabel(shot.situation)}</div>
        </div>
      )}
      {shots.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-ink-4 text-center px-6">{emptyText}</div>
      )}
    </div>
  );
};

export const ShotLegend: React.FC = () => (
  <div className="flex flex-wrap gap-x-4 gap-y-1">
    <LegendItem color={SHOT.goal}>But</LegendItem>
    <LegendItem color={SHOT.saved}>Arrêté</LegendItem>
    <LegendItem color={SHOT.missed}>Manqué ou contré</LegendItem>
    <span className="text-2xs text-ink-4">Taille du point = xG · moitié offensive</span>
  </div>
);

export default ShotPitch;
