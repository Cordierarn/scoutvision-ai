/**
 * ScoutVision - formations d'une équipe, prêtes à placer sur un terrain (sans rendu)
 *
 * Les cases viennent de la table lineup de PitchAPI (scripts/prepare_data.py, build_lineups) :
 * position_id de la grille et coordonnées moyennes. Deux défauts des données sont traités ici,
 * sans rien inventer :
 * - une case sans coordonnées valides (x = y = 0 dans les fichiers) n'est pas placée : elle est
 *   comptée et rend la formation incomplète ;
 * - une même position peut apparaître sous deux position_id (deux grilles) avec exactement les
 *   mêmes coordonnées : 13 ou 18 cases pour un onze. Quand une formation a plus de 11 cases,
 *   ces doublons sont fusionnés (titularisations additionnées par joueur).
 */

import { LineupSlot, TeamLineups } from '../services/dataLoader';

export const ELEVEN = 11;

/** Coordonnées utilisables : nombres finis dans [0, 1], hors du (0, 0) qui marque une case sans position */
export function isValidSlotPosition(slot: Pick<LineupSlot, 'x' | 'y'>): boolean {
  const { x, y } = slot;
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return false;
  if (x < 0 || x > 1 || y < 0 || y > 1) return false;
  return !(x === 0 && y === 0);
}

export type FormationStatus = 'complete' | 'incomplete' | 'irregular';

export interface FormationView {
  formation: string;
  matches: number;
  slots: LineupSlot[];             // cases placées (coordonnées valides, doublons fusionnés)
  invalidSlots: number;            // cases écartées faute de coordonnées
  mergedSlots: number;             // cases fusionnées avec une case de mêmes coordonnées
  status: FormationStatus;         // complete : 11 cases ; incomplete : moins ; irregular : plus
}

function mergeSlots(a: LineupSlot, b: LineupSlot): LineupSlot {
  const starts = new Map<string, [string, string, number]>();
  [...a.players, ...b.players].forEach(([id, name, n]) => {
    const prev = starts.get(id);
    starts.set(id, prev ? [id, prev[1], prev[2] + n] : [id, name, n]);
  });
  return { ...a, players: [...starts.values()].sort((p, q) => q[2] - p[2]) };
}

export function normalizeFormation(f: { formation: string; matches: number; slots: LineupSlot[] }): FormationView {
  const valid = f.slots.filter(isValidSlotPosition);
  const invalidSlots = f.slots.length - valid.length;
  let slots = valid;
  let mergedSlots = 0;
  if (valid.length > ELEVEN) {
    const byPosition = new Map<string, LineupSlot>();
    valid.forEach(s => {
      const key = `${s.x}|${s.y}`;
      const prev = byPosition.get(key);
      if (prev) { byPosition.set(key, mergeSlots(prev, s)); mergedSlots++; } else byPosition.set(key, s);
    });
    slots = [...byPosition.values()];
  }
  const status: FormationStatus = slots.length === ELEVEN && invalidSlots === 0 ? 'complete' : slots.length > ELEVEN ? 'irregular' : 'incomplete';
  return { formation: f.formation, matches: f.matches, slots, invalidSlots, mergedSlots, status };
}

/**
 * Formations de l'équipe, de la plus utilisée à la moins utilisée ; à égalité, les complètes
 * d'abord, puis l'ordre du fichier. Une formation sans aucune case placée est conservée
 * (elle compte des matchs) mais signalée incomplète.
 */
export function orderFormations(lineups: TeamLineups | null | undefined): FormationView[] {
  if (!lineups) return [];
  return lineups.formations
    .map((f, i) => ({ view: normalizeFormation(f), i }))
    .sort((a, b) => b.view.matches - a.view.matches
      || Number(a.view.status !== 'complete') - Number(b.view.status !== 'complete') || a.i - b.i)
    .map(x => x.view);
}

export interface LineupCoverage {
  matchesWithLineups: number;      // matchs avec une composition dans les données
  teamMatches: number | null;      // matchs de l'équipe (team_season)
  shownMatches: number;            // matchs couverts par les formations listées (4 au plus par équipe)
  complete: boolean;               // toutes les compositions de l'équipe sont présentes
}

export function lineupCoverage(lineups: TeamLineups | null | undefined, teamMatches: number | null): LineupCoverage {
  const matchesWithLineups = lineups?.matches ?? 0;
  const shownMatches = (lineups?.formations ?? []).reduce((s, f) => s + f.matches, 0);
  return { matchesWithLineups, teamMatches, shownMatches, complete: teamMatches === null || matchesWithLineups >= teamMatches };
}
