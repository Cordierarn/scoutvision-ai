/**
 * ScoutVision - tirs d'une équipe, pour et contre (sans rendu)
 *
 * Un fichier de tirs couvre une compétition-saison ; chaque ligne porte l'équipe du tireur.
 * Un but contre son camp y est rattaché au joueur qui le marque, donc à l'équipe qui le
 * CONCÈDE : le but est crédité à l'adversaire. Il n'entre ni dans les xG, ni dans les tirs
 * cadrés, ni dans la conversion, ni sur la carte des tirs : il est compté à part.
 */

import { ShotEvent } from '../types';

export type ShotSide = 'for' | 'against';

/** Équipes de chaque match, d'après les tirs du fichier (match_id → équipes) */
export function matchTeams(shots: ShotEvent[]): Map<string, Set<string>> {
  const teams = new Map<string, Set<string>>();
  shots.forEach(s => {
    if (!s.match_id || !s.team) return;
    if (!teams.has(s.match_id)) teams.set(s.match_id, new Set());
    teams.get(s.match_id)!.add(s.team);
  });
  return teams;
}

export interface ShotTeams {
  shooter: string;                 // équipe du joueur qui frappe (colonne team)
  attacking: string | null;        // équipe à qui le tir profite (à qui un but est crédité)
  conceding: string | null;        // équipe qui le subit
}

/**
 * Équipe qui bénéficie du tir et équipe qui le subit. Pour un but contre son camp, les rôles
 * s'inversent ; l'adversaire est l'autre équipe du match (null si le fichier ne la contient pas).
 */
export function shotTeams(shot: ShotEvent, teamsOfMatch: Set<string> | undefined): ShotTeams {
  const opponent = teamsOfMatch ? [...teamsOfMatch].find(t => t !== shot.team) ?? null : null;
  return shot.isOwnGoal
    ? { shooter: shot.team, attacking: opponent, conceding: shot.team }
    : { shooter: shot.team, attacking: shot.team, conceding: opponent };
}

/**
 * Côté du tir pour une équipe donnée, à partir de l'équipe du tireur seulement : un tir de
 * l'équipe est « pour », sauf un but contre son camp (« contre ») ; inversement pour l'adversaire.
 * Le tir doit appartenir à un match de l'équipe (voir splitTeamShots).
 */
export function shotSide(shot: ShotEvent, team: string): ShotSide {
  const own = shot.team === team;
  return own !== Boolean(shot.isOwnGoal) ? 'for' : 'against';
}

export interface TeamShots {
  for: ShotEvent[];                // tirs de l'équipe vers le but adverse (hors buts contre son camp)
  against: ShotEvent[];            // tirs adverses vers le but de l'équipe (hors buts contre son camp)
  ownGoalsFor: ShotEvent[];        // buts contre son camp des adversaires, crédités à l'équipe
  ownGoalsAgainst: ShotEvent[];    // buts contre son camp de joueurs de l'équipe
  matches: number;                 // matchs de l'équipe présents dans le fichier de tirs
}

/**
 * Tirs pour et contre d'une équipe. Ses matchs sont ceux où elle apparaît dans le fichier
 * (au moins un tir, but contre son camp compris). Limite connue : un match sans aucun tir de
 * l'équipe n'y figure pas, et les tirs adverses de ce match manquent aux tirs contre. Les
 * données publiées n'ont pas la liste des matchs joués (forecast.json : matchs à venir ;
 * compositions agrégées par formation ; team_season : un nombre de matchs). Mesuré : 5 matchs
 * sur 10 826 en 2025-26, 1 sur 3 587 en 2026-27, 5 sur 5 919 en 2021-22.
 */
export function splitTeamShots(shots: ShotEvent[], team: string): TeamShots {
  const matches = new Set(shots.filter(s => s.team === team && s.match_id).map(s => s.match_id!));
  const out: TeamShots = { for: [], against: [], ownGoalsFor: [], ownGoalsAgainst: [], matches: matches.size };
  shots.forEach(s => {
    if (s.team !== team && !(s.match_id && matches.has(s.match_id))) return;
    const side = shotSide(s, team);
    if (s.isOwnGoal) (side === 'for' ? out.ownGoalsFor : out.ownGoalsAgainst).push(s);
    else (side === 'for' ? out.for : out.against).push(s);
  });
  return out;
}

export const isPenalty = (s: ShotEvent) => s.situation === 'Penalty';
export const isOnTarget = (s: ShotEvent) => s.result === 'Goal' || s.result === 'SavedShot';

export interface ShotSummary {
  shots: number;
  goals: number;                   // buts sur tirs (hors buts contre son camp)
  ownGoals: number;                // buts contre son camp crédités à ce côté
  totalGoals: number;              // goals + ownGoals : le score
  xG: number;
  npxG: number;                    // hors penalties
  penalties: number;
  onTarget: number;
  conversion: number | null;       // buts / tirs, en % ; null sans tir
}

/** Totaux d'un côté : les buts contre son camp ne comptent que dans le score */
export function summarizeShots(shots: ShotEvent[], ownGoals: ShotEvent[] = []): ShotSummary {
  let goals = 0, xG = 0, npxG = 0, penalties = 0, onTarget = 0;
  shots.forEach(s => {
    const x = Number.isFinite(s.xG) ? s.xG : 0;
    xG += x;
    if (isPenalty(s)) penalties++; else npxG += x;
    if (s.result === 'Goal') goals++;
    if (isOnTarget(s)) onTarget++;
  });
  return {
    shots: shots.length, goals, ownGoals: ownGoals.length, totalGoals: goals + ownGoals.length,
    xG, npxG, penalties, onTarget, conversion: shots.length ? (100 * goals) / shots.length : null,
  };
}

export interface Scorer { id: string; name: string; goals: number; xG: number; shots: number }

/** Tireurs d'une liste de tirs (identifiant joueur, sinon nom), par buts puis xG */
export function topScorers(shots: ShotEvent[], limit = 5): Scorer[] {
  const by = new Map<string, Scorer>();
  shots.forEach(s => {
    if (s.isOwnGoal) return;
    const id = s.player_id || s.player || 'inconnu';
    const cur = by.get(id) ?? { id, name: s.player || 'Inconnu', goals: 0, xG: 0, shots: 0 };
    cur.shots++;
    cur.xG += Number.isFinite(s.xG) ? s.xG : 0;
    if (s.result === 'Goal') cur.goals++;
    by.set(id, cur);
  });
  return [...by.values()].sort((a, b) => b.goals - a.goals || b.xG - a.xG || a.name.localeCompare(b.name)).slice(0, limit);
}

// ============================================
// FILTRES (données existantes seulement)
// ============================================

export type SituationFilter = 'all' | 'OpenPlay' | 'FromCorner' | 'SetPiece' | 'DirectFreekick' | 'Penalty';
export type ResultFilter = 'all' | 'goal' | 'onTarget' | 'offTarget';

export interface ShotFilters {
  situation: SituationFilter;
  nonPenalty: boolean;             // hors penalties
  result: ResultFilter;
}

export const DEFAULT_SHOT_FILTERS: ShotFilters = { situation: 'all', nonPenalty: false, result: 'all' };

export function filterShots(shots: ShotEvent[], f: ShotFilters): ShotEvent[] {
  return shots.filter(s => {
    if (f.situation !== 'all' && s.situation !== f.situation) return false;
    if (f.nonPenalty && isPenalty(s)) return false;
    if (f.result === 'goal' && s.result !== 'Goal') return false;
    if (f.result === 'onTarget' && !isOnTarget(s)) return false;
    if (f.result === 'offTarget' && isOnTarget(s)) return false;
    return true;
  });
}
