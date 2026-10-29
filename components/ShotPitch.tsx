/**
 * ScoutVision - carte des tirs sur la moitié offensive (attaque vers la droite)
 * Couleur = issue du tir, taille du point = xG. Partagée par la fiche joueur et l'analyse d'équipe.
 * Terrain commun (Pitch) ; tirs parcourables à la souris et au clavier (flèches, Début, Fin, Échap),
 * le tir actif est décrit dans une infobulle et annoncé aux lecteurs d'écran.
 */

import React, { useMemo, useState } from 'react';
import { ShotEvent } from '../types';
import { shotResultLabel, shotTypeLabel, situationLabel } from '../utils/labels';
import { INK, SHOT } from '../theme/charts';
import { LegendItem, LoadError } from './ui';
import { PITCH_LENGTH as L, PITCH_WIDTH as W, Pitch } from './Pitch';

export const shotColor = (s: ShotEvent) => (s.result === 'Goal' ? SHOT.goal : s.result === 'SavedShot' ? SHOT.saved : SHOT.missed);

const XG = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const describe = (s: ShotEvent, showPlayer: boolean) =>
  `${showPlayer ? `${s.player}, ` : ''}${shotResultLabel(s.result)}, xG ${XG.format(s.xG || 0)}, ${s.minute}e minute, ${shotTypeLabel(s.shotType)}, ${situationLabel(s.situation)}`;

const ShotPitch: React.FC<{
  shots: ShotEvent[];
  showPlayer?: boolean;
  className?: string;
  emptyText?: string;
  loading?: boolean;                // tirs en cours de chargement : terrain en attente, jamais « aucune donnée »
  error?: string | null;            // échec du chargement
  onRetry?: () => void;
  label?: string;                   // nom accessible de la carte
}> = ({
  shots, showPlayer = false, className = 'max-w-[340px]', emptyText = 'Aucune donnée de tir.', loading = false, error = null, onRetry, label,
}) => {
  // Ordre de parcours au clavier : chronologique
  const ordered = useMemo(() => [...shots].sort((a, b) => (a.minute ?? 0) - (b.minute ?? 0)), [shots]);
  const [active, setActive] = useState<number | null>(null);
  const shot = active !== null ? ordered[active] : undefined;
  if (loading) {
    return <div role="status" aria-label="Chargement des tirs" className={`w-full aspect-[52.5/68] mx-auto rounded-md bg-raised/70 animate-pulse ${className}`} />;
  }
  if (error) {
    return <LoadError message="Les tirs n'ont pas pu être chargés." onRetry={onRetry} />;
  }
  if (shots.length === 0) {
    return <div className="rounded-md border border-dashed border-line px-4 py-6 text-center text-xs text-ink-4">{emptyText}</div>;
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    const last = ordered.length - 1;
    const next = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? (active === null ? 0 : Math.min(active + 1, last))
      : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? (active === null ? last : Math.max(active - 1, 0))
        : e.key === 'Home' ? 0 : e.key === 'End' ? last : undefined;
    if (next !== undefined) { e.preventDefault(); setActive(next); }
    else if (e.key === 'Escape' && active !== null) { e.preventDefault(); setActive(null); }
  };

  return (
    <div className={`mx-auto w-full ${className}`}>
      <div tabIndex={0} onKeyDown={onKeyDown} onBlur={() => setActive(null)}
        aria-label={`${label ?? 'Carte des tirs'} : ${shots.length} tirs. Flèches pour parcourir les tirs, Échap pour fermer.`}
        className="rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
        <Pitch orientation="horizontal" half className="!bg-raised/60 overflow-hidden">
          <svg viewBox={`${L / 2} 0 ${L / 2} ${W}`} className="absolute inset-0 w-full h-full" aria-hidden>
            {/* Les buts en dernier : au-dessus des autres tirs */}
            {ordered.map((s, i) => ({ s, i })).sort((a, b) => Number(a.s.result === 'Goal') - Number(b.s.result === 'Goal') || Number(a.i === active) - Number(b.i === active)).map(({ s, i }) => (
              <circle key={s.id ?? i} cx={s.X * L} cy={s.Y * W} r={Math.max(0.7, Math.min(2.6, Math.sqrt(s.xG || 0.02) * 3.2))}
                fill={shotColor(s)} fillOpacity={s.result === 'Goal' ? 0.95 : 0.7}
                stroke={active === i ? INK.primary : INK.surface} strokeWidth={active === i ? 0.5 : 0.25} style={{ cursor: 'pointer' }}
                onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(null)} />
            ))}
          </svg>
          {shot && (
            <div className="sv-tooltip absolute pointer-events-none z-10 whitespace-nowrap"
              style={{ left: `${Math.min(Math.max((shot.X - 0.5) * 200 - 10, 0), 55)}%`, top: `${Math.max(shot.Y * 100 - 16, 2)}%` }}>
              {showPlayer && <div className="text-ink font-medium">{shot.player}</div>}
              <div className={showPlayer ? '' : 'text-ink font-medium'}>{shotResultLabel(shot.result)}</div>
              <div>xG {XG.format(shot.xG || 0)} · {shot.minute}e min</div>
              <div className="text-ink-4">{shotTypeLabel(shot.shotType)} · {situationLabel(shot.situation)}</div>
            </div>
          )}
        </Pitch>
      </div>
      <p className="sr-only" aria-live="polite">{shot ? `Tir ${active! + 1} sur ${ordered.length} : ${describe(shot, showPlayer)}` : ''}</p>
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
