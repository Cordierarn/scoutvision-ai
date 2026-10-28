/**
 * ScoutVision AI - Images
 * Photos joueurs et logos clubs (CDN PitchAPI), drapeaux (flagcdn), badges de compétition.
 * Chaque image a un repli (initiales, icône) si l'URL manque ou ne charge pas.
 */

import React, { useState } from 'react';
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
 * Image avec repli : le repli s'affiche si src est vide ou en erreur
 */
const ImageWithFallback: React.FC<{
  src?: string | null;
  alt: string;
  className: string;
  fallback: React.ReactNode;
}> = ({ src, alt, className, fallback }) => {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <>{fallback}</>;
  return (
    <img
      src={imageUrl(src)}
      alt={alt}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={className}
    />
  );
};

/**
 * Logo du club (repli : bouclier)
 */
export const TeamLogo: React.FC<{
  src?: string | null;
  name?: string;
  size?: Size;
  className?: string;
}> = ({ src, name = '', size = 'sm', className = '' }) => {
  const base = `${SIZES[size]} shrink-0 ${className}`;
  return (
    <ImageWithFallback
      src={src}
      alt={name}
      className={`${base} object-contain`}
      fallback={
        <div className={`${base} flex items-center justify-center text-ink-4`} title={name}>
          <Shield className="w-3/4 h-3/4" />
        </div>
      }
    />
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
  const [failed, setFailed] = useState(false);
  if (typeof src !== 'string' || !src || failed) return null;
  return (
    <img
      src={imageUrl(src)}
      alt={alt}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className="absolute inset-0 w-full h-full object-cover object-top bg-raised"
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

/**
 * Marque ScoutVision (logo vectoriel, deux chevrons)
 */
export const BrandMark: React.FC<{ className?: string }> = ({ className = 'w-5 h-6' }) => (
  <svg viewBox="0 0 80 96" className={className} aria-hidden>
    <polygon points="0,0 40,0 80,48 54,48 26,16 0,16" fill="#F8FAFC" />
    <polygon points="80,96 40,96 0,48 26,48 54,80 80,80" fill="#00E5FF" />
  </svg>
);
