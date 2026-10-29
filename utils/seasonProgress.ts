/**
 * ScoutVision - avancée de la saison chargée et seuil de minutes qui s'y adapte (fonctions pures)
 *
 * Un seuil fixe de minutes (500 au Chasseur, 900 chez Joueurs similaires) exclut presque tout le
 * monde en début de saison. Le seuil adapté est le seuil de pleine saison multiplié par la part de
 * saison jouée, estimée :
 * - d'abord sur les matchs : matchs joués par l'équipe la plus avancée de la compétition, rapportés
 *   au calendrier d'un championnat classique (2 × (équipes − 1)), quand ce calendrier est plausible ;
 * - sinon sur le temps écoulé entre le début de la saison et la date des données.
 * Saison terminée : part = 1, le seuil de pleine saison s'applique.
 */

import { TeamStats } from '../types';
import { isSeasonInProgress } from './sampleContext';

export interface SeasonProgress {
  progress: number;                 // part de saison jouée, 0,05 à 1
  basis: 'complete' | 'matches' | 'time';
  played?: number;                  // matchs joués par l'équipe la plus avancée (base matchs)
  expected?: number;                // matchs attendus sur la saison (base matchs)
}

export interface SeasonProgressInput {
  season: string;                   // identifiant de saison de l'application (« 2026-27 », « 2026 »)
  seasonLabel?: string;             // libellé des lignes (« 2026 » pour une saison civile)
  generatedAt?: string;             // date des données (index.json)
  teams?: TeamStats[];              // équipes de la saison chargée
  competition?: string;             // compétition considérée ; absente : toutes les équipes
  now?: Date;                       // date de référence (par défaut : date des données)
}

const clamp = (v: number) => Math.min(1, Math.max(0.05, v));

/** Fenêtre de la saison : août → fin juin, ou année civile pour un libellé « AAAA » */
export function seasonWindow(season: string, seasonLabel?: string): { start: Date; end: Date } | null {
  const start = Number(season.slice(0, 4));
  if (!start) return null;
  return seasonLabel && /^\d{4}$/.test(seasonLabel)
    ? { start: new Date(Date.UTC(Number(seasonLabel), 0, 1)), end: new Date(Date.UTC(Number(seasonLabel), 11, 31, 23, 59)) }
    : { start: new Date(Date.UTC(start, 7, 1)), end: new Date(Date.UTC(start + 1, 5, 30, 23, 59)) };
}

export function seasonProgress(input: SeasonProgressInput): SeasonProgress {
  if (!isSeasonInProgress(input.season, input.seasonLabel, input.generatedAt)) return { progress: 1, basis: 'complete' };

  const teams = (input.teams ?? []).filter(t => !input.competition || t.competition === input.competition);
  const played = teams.map(t => t.Matches).filter((m): m is number => typeof m === 'number' && Number.isFinite(m) && m > 0);
  const n = teams.length;
  if (played.length > 0 && n >= 8 && n <= 24) {
    const expected = 2 * (n - 1);
    const max = Math.max(...played);
    if (max <= expected) return { progress: clamp(max / expected), basis: 'matches', played: max, expected };
  }

  const window = seasonWindow(input.season, input.seasonLabel);
  const at = input.now ?? (input.generatedAt ? new Date(input.generatedAt) : undefined);
  if (!window || !at || Number.isNaN(at.getTime())) return { progress: 1, basis: 'complete' };
  return { progress: clamp((at.getTime() - window.start.getTime()) / (window.end.getTime() - window.start.getTime())), basis: 'time' };
}

/** Seuil adapté : seuil de pleine saison × part jouée, arrondi à 10 minutes, jamais sous 90 ni au-dessus du seuil de base */
export function adaptiveMinutes(base: number, progress: number): number {
  const raw = Math.round((base * Math.min(1, Math.max(0, progress))) / 10) * 10;
  return Math.min(base, Math.max(90, raw));
}

/** Libellé court de la base du seuil, pour l'interface */
export function progressLabel(p: SeasonProgress): string | null {
  if (p.basis === 'complete') return null;
  const pct = `${Math.round(p.progress * 100)} % de la saison`;
  return p.basis === 'matches' ? `${pct} (${p.played} journées sur ${p.expected})` : `${pct} (au calendrier)`;
}
