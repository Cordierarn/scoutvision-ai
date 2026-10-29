/**
 * ScoutVision - terrain générique aux vraies proportions (68 × 105 m)
 *
 * Coordonnées normalisées des données : x = profondeur (0 = propre but, 1 = but adverse),
 * y = largeur (0 = gauche de l'équipe qui attaque). Le terrain se dessine en SVG à l'échelle
 * métrique ; son conteneur garde le ratio par aspect-ratio, sans hauteur tirée de la fenêtre.
 * Sert aux compositions et aux tirs ; prévu pour les cartes de chaleur et d'autres couches.
 */

import React, { useEffect, useState } from 'react';

export const PITCH_LENGTH = 105;
export const PITCH_WIDTH = 68;

export type PitchOrientation = 'vertical' | 'horizontal';   // vertical : attaque vers le haut ; horizontal : vers la droite

/** Position en % du conteneur pour un point (x profondeur, y largeur) des données */
export function pitchPoint(x: number, y: number, orientation: PitchOrientation, half = false): { left: number; top: number } {
  const depth = half ? (x - 0.5) * 2 : x;                    // demi-terrain offensif : x de 0,5 à 1
  return orientation === 'vertical'
    ? { left: y * 100, top: (1 - depth) * 100 }
    : { left: depth * 100, top: y * 100 };
}

const LINE = 'rgba(137,150,167,0.35)';

/** Tracé du terrain (ou de sa moitié offensive), attaque vers le haut (vertical) ou la droite (horizontal) */
export const PitchLines: React.FC<{ orientation: PitchOrientation; half?: boolean }> = ({ orientation, half = false }) => {
  const L = PITCH_LENGTH;
  const W = PITCH_WIDTH;
  // Dessin dans le repère horizontal (longueur en x), tourné pour le vertical
  const lines = (
    <g fill="none" stroke={LINE} strokeWidth={0.3}>
      <rect x={0.15} y={0.15} width={L - 0.3} height={W - 0.3} />
      <line x1={L / 2} y1={0} x2={L / 2} y2={W} />
      <circle cx={L / 2} cy={W / 2} r={9.15} />
      {[0, 1].map(side => {
        const goal = side === 0 ? 0 : L;
        const dir = side === 0 ? 1 : -1;
        return (
          <g key={side}>
            <rect x={side === 0 ? 0 : L - 16.5} y={(W - 40.32) / 2} width={16.5} height={40.32} />
            <rect x={side === 0 ? 0 : L - 5.5} y={(W - 18.32) / 2} width={5.5} height={18.32} />
            <circle cx={goal + dir * 11} cy={W / 2} r={0.35} fill={LINE} />
            <path d={`M ${goal + dir * 16.5} ${W / 2 - 7.3} A 9.15 9.15 0 0 ${side === 0 ? 1 : 0} ${goal + dir * 16.5} ${W / 2 + 7.3}`} />
          </g>
        );
      })}
    </g>
  );
  const vbLength = half ? L / 2 : L;
  const offset = half ? L / 2 : 0;
  if (orientation === 'horizontal') {
    return (
      <svg viewBox={`${offset} 0 ${vbLength} ${W}`} className="absolute inset-0 w-full h-full" aria-hidden preserveAspectRatio="none">{lines}</svg>
    );
  }
  // Vertical : rotation de -90° (le but adverse en haut)
  return (
    <svg viewBox={`0 0 ${W} ${vbLength}`} className="absolute inset-0 w-full h-full" aria-hidden preserveAspectRatio="none">
      <g transform={`translate(0 ${vbLength + offset}) rotate(-90)`}>{lines}</g>
    </svg>
  );
};

/**
 * Conteneur du terrain : ratio exact, tracé en fond, couches (cartes, points) en enfants
 * positionnés en % via pitchPoint
 */
export const Pitch: React.FC<{
  orientation: PitchOrientation;
  half?: boolean;
  className?: string;
  children?: React.ReactNode;
  label?: string;
}> = ({ orientation, half = false, className = '', children, label }) => {
  const length = half ? PITCH_LENGTH / 2 : PITCH_LENGTH;
  const ratio = orientation === 'vertical' ? `${PITCH_WIDTH} / ${length}` : `${length} / ${PITCH_WIDTH}`;
  return (
    <div className={`relative w-full bg-raised/40 rounded-md border border-line ${className}`} style={{ aspectRatio: ratio }}
      role={label ? 'group' : undefined} aria-label={label}>
      <PitchLines orientation={orientation} half={half} />
      {children}
    </div>
  );
};

/**
 * Largeur d'un élément (ResizeObserver), pour choisir l'orientation selon la place réelle.
 * Ref de rappel : l'élément peut n'apparaître qu'après un chargement (terrain après les compositions).
 */
export function useElementWidth<T extends HTMLElement>(): [(el: T | null) => void, number] {
  const [el, setEl] = useState<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(entries => setWidth(entries[0].contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, width];
}

export default Pitch;
