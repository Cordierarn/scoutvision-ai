/**
 * ScoutVision AI - Images
 * Photos joueurs et logos clubs (CDN PitchAPI), drapeaux (flagcdn), badges de compétition.
 * Chaque image a un repli (initiales, icône) si l'URL manque ou ne charge pas.
 */

import React, { useLayoutEffect, useRef, useState } from 'react';
import { Shield, Trophy } from 'lucide-react';
import { PlayerData } from '../types';
import { getFlagUrl } from '../utils/flags';
import { dataLoader } from '../services/dataLoader';

/**
 * URL d'image servie en même origine via le proxy /cdn (voir vite.config.ts)
 */
export function imageUrl(url: string | undefined | null): string | undefined {
  if (!url) return undefined;
  return url.replace(/^https:\/\/cdn\.pitchapi\.dev\//, '/cdn/');
}

const SIZES = {
  xs: 'w-6 h-6 text-[9px]',
  sm: 'w-8 h-8 text-[10px]',
  md: 'w-10 h-10 text-xs',
  lg: 'w-14 h-14 text-sm',
  xl: 'w-full h-full text-4xl',
};

type Size = keyof typeof SIZES;

/**
 * Suivi du chargement d'une image : vrai dès le rendu si elle est déjà en cache
 * (vérifié avant affichage), pour ne jamais montrer le repli puis l'image à tort.
 */
function useImageLoad(src?: string) {
  const ref = useRef<HTMLImageElement>(null);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  useLayoutEffect(() => {
    setFailed(false);
    const img = ref.current;
    setLoaded(!!img && img.complete && img.naturalWidth > 0);
  }, [src]);
  return { ref, failed, loaded, onLoad: () => setLoaded(true), onError: () => setFailed(true) };
}

/**
 * Logo du club : le repli (bouclier) reste affiché pendant le chargement et en cas d'erreur,
 * puis il est remplacé d'un coup par le logo chargé
 */
export const TeamLogo: React.FC<{
  src?: string | null;
  name?: string;
  size?: Size;
  className?: string;
}> = ({ src, name = '', size = 'sm', className = '' }) => {
  const url = imageUrl(src);
  const { ref, failed, loaded, onLoad, onError } = useImageLoad(url);
  const showImage = !!url && !failed;
  return (
    <span className={`relative inline-flex items-center justify-center ${SIZES[size]} shrink-0 ${className}`} title={showImage ? undefined : name}>
      {!(showImage && loaded) && <Shield className="w-3/4 h-3/4 text-ink-4" aria-hidden={showImage} />}
      {showImage && (
        <img
          ref={ref}
          src={url}
          alt={name}
          loading="lazy"
          referrerPolicy="no-referrer"
          onLoad={onLoad}
          onError={onError}
          className={`absolute inset-0 w-full h-full object-contain ${loaded ? '' : 'opacity-0'}`}
        />
      )}
    </span>
  );
};

/**
 * Drapeau d'un pays (code FIFA) ; rien si le code est inconnu
 */
export const CountryFlag: React.FC<{
  code?: string;
  className?: string;
}> = ({ code, className = 'w-5 h-3.5' }) => {
  const [failed, setFailed] = useState(false);
  const url = getFlagUrl(code);
  if (!url) return null;
  // Drapeau indisponible : le code pays reste lisible (distingue Serie A italienne et brésilienne)
  if (failed) {
    return <span title={code} className="inline-flex items-center h-3 px-0.5 rounded-sm border border-line-strong text-[8px] leading-none font-semibold text-ink-3 shrink-0">{code}</span>;
  }
  return (
    <img
      src={url}
      alt={code}
      title={code}
      loading="lazy"
      onError={() => setFailed(true)}
      className={`${className} inline-block object-cover rounded-[2px] shrink-0`}
    />
  );
};

const CUP_COLORS: Record<string, string> = {
  UCL: 'text-ink-2',
  UEL: 'text-ink-2',
  UECL: 'text-ink-2',
};

/**
 * Badge de compétition : drapeau du pays (ou coupe pour une compétition européenne) + nom
 */
export const CompetitionBadge: React.FC<{
  competition?: string;
  showName?: boolean;
  className?: string;
}> = ({ competition, showName = true, className = '' }) => {
  if (!competition) return null;
  const info = dataLoader.getCompetition(competition);
  const name = info?.name ?? competition;
  const isCup = info?.country === 'INT';
  return (
    <span className={`inline-flex items-center gap-1.5 min-w-0 ${className}`} title={name}>
      {isCup
        ? <Trophy className={`w-3.5 h-3.5 shrink-0 ${CUP_COLORS[competition] ?? 'text-ink-2'}`} />
        : <CountryFlag code={info?.country} className="w-4 h-3 shrink-0" />}
      {showName && <span className="truncate">{name}</span>}
    </span>
  );
};

/**
 * Club + compétition sur une ligne (logo, nom du club, badge de compétition)
 */
export const TeamLine: React.FC<{
  player: PlayerData;
  className?: string;
}> = ({ player, className = '' }) => (
  <span className={`inline-flex items-center gap-1.5 min-w-0 ${className}`}>
    <TeamLogo src={player['Team logo'] as string | undefined} name={player.Team} size="xs" />
    <span className="truncate">{player.Team}</span>
    {player.Competition && (
      <CompetitionBadge competition={player.Competition} showName={false} className="opacity-80" />
    )}
  </span>
);

/**
 * Photo superposée à un conteneur d'initiales (relative overflow-hidden) :
 * les initiales restent visibles si la photo manque ou ne charge pas
 */
export const PhotoOverlay: React.FC<{
  src?: string | number;
  alt?: string;
}> = ({ src, alt = '' }) => {
  const url = typeof src === 'string' ? imageUrl(src) : undefined;
  const { ref, failed, loaded, onLoad, onError } = useImageLoad(url);
  if (!url || failed) return null;
  // Invisible tant qu'elle charge : les initiales restent affichées, puis la photo les recouvre d'un coup
  return (
    <img
      ref={ref}
      src={url}
      alt={alt}
      loading="lazy"
      referrerPolicy="no-referrer"
      onLoad={onLoad}
      onError={onError}
      className={`absolute inset-0 w-full h-full object-cover object-top bg-raised ${loaded ? '' : 'opacity-0'}`}
    />
  );
};

const AVATAR_SIZES = {
  xs: 'w-6 h-6 text-[9px]',
  sm: 'w-7 h-7 text-[10px]',
  md: 'w-9 h-9 text-xs',
  lg: 'w-12 h-12 text-sm',
  xl: 'w-[72px] h-[72px] text-xl',
};

/**
 * Photo du joueur sur fond neutre, initiales en repli ; badge de saison facultatif
 */
export const PlayerAvatar: React.FC<{
  player?: PlayerData;
  name?: string;
  size?: keyof typeof AVATAR_SIZES;
  season?: string;              // libellé court affiché en badge (« 24-25 »)
  className?: string;
}> = ({ player, name, size = 'md', season, className = '' }) => {
  const label = name ?? player?.Player ?? '?';
  // Initiales : premier et dernier mot (« Santiago Beltrán » -> SB)
  const words = label.trim().split(/\s+/).filter(Boolean);
  const initials = (words.length > 1 ? words[0][0] + words[words.length - 1][0] : label.slice(0, 2)).toUpperCase();
  return (
    <span className={`relative inline-block shrink-0 ${className}`}>
      <span className={`relative overflow-hidden ${AVATAR_SIZES[size]} rounded-md bg-raised border border-line flex items-center justify-center font-semibold text-ink-3`}>
        {initials}
        <PhotoOverlay src={player?.Image} alt={label} />
      </span>
      {season && (
        <span className="absolute -bottom-1 -right-2 px-0.5 rounded-sm text-[8px] leading-[11px] font-semibold whitespace-nowrap bg-overlay text-ink-2 border border-line-strong">
          {season}
        </span>
      )}
    </span>
  );
};

type MarkSize = 16 | 24 | 40;
type Rect = [number, number, number, number];   // x0, y0, x1, y1

/**
 * Géométrie du symbole Tessera (« Assemblage », version 1b) dessinée pour une taille :
 * quatre tesselles en moulinet autour d'une pièce centrale cyan égale à 1/4 du côté,
 * gouttières de 1, 2 ou 3 px (16, 24, 40 px) posées sur des pixels entiers.
 */
function tesseraGeometry(size: MarkSize): { tiles: Rect[]; center: Rect } {
  const gutter = size === 16 ? 1 : size === 24 ? 2 : 3;
  const a = (size - size / 4) / 2;                // petit côté d'une tesselle
  const b = (size + size / 4) / 2;                // grand côté
  const lo = Math.ceil(gutter / 2), hi = Math.floor(gutter / 2);
  // Les bords intérieurs reculent de la gouttière, les bords extérieurs restent au bord du carré
  const inset = ([x0, y0, x1, y1]: Rect): Rect => [
    x0 > 0 ? x0 + lo : 0, y0 > 0 ? y0 + lo : 0, x1 < size ? x1 - hi : size, y1 < size ? y1 - hi : size,
  ];
  return {
    tiles: ([[0, 0, b, a], [b, 0, size, b], [a, b, size, size], [0, a, a, size]] as Rect[]).map(inset),
    center: inset([a, a, b, b]),
  };
}

/**
 * Marque Tessera : symbole dessiné au pixel pour 16, 24 ou 40 px (encre et pièce centrale cyan)
 */
export const BrandMark: React.FC<{ size?: MarkSize; className?: string }> = ({ size = 24, className }) => {
  const { tiles, center } = tesseraGeometry(size);
  const rect = ([x0, y0, x1, y1]: Rect, fill: string) => (
    <rect key={`${x0}-${y0}`} x={x0} y={y0} width={x1 - x0} height={y1 - y0} fill={fill} />
  );
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} className={className} shapeRendering="crispEdges" aria-hidden>
      {tiles.map(t => rect(t, '#F8FAFC'))}
      {rect(center, '#00E5FF')}
    </svg>
  );
};
