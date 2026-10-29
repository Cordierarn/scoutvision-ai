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

// ============================================
// POSTE OCCUPÉ DANS LA FORMATION
// ============================================

const LINE_OF: Record<string, number> = { GK: 0, CB: 1, FB: 1, WB: 1, DM: 2, CM: 2, AM: 2, W: 3, ST: 3 };

/**
 * Poste de chaque case, lu dans la formation (« 4-2-3-1 ») : le gardien est la case la plus
 * basse, puis les lignes de la formation, de l'arrière vers l'avant, par profondeur moyenne,
 * et de gauche à droite dans chaque ligne. Mesuré sur 2025-26 : le poste de la fiche du
 * titulaire diffère de cette lecture de famille dans 8,8 % des cas (surtout des milieux
 * offensifs alignés relayeurs) et de ligne dans 2,7 %, contre 20 % et 7 % avec la seule
 * géométrie de la case (positionFromSlot). Null si la formation n'a pas ses 11 cases.
 */
export function formationPositions(view: Pick<FormationView, 'formation' | 'slots'>): Map<number, string> | null {
  const lines = (view.formation.match(/\d/g) ?? []).map(Number);
  if (lines.reduce((s, n) => s + n, 0) !== ELEVEN - 1 || view.slots.length !== ELEVEN) return null;
  const byDepth = [...view.slots].sort((a, b) => a.x - b.x);
  const out = new Map<number, string>([[byDepth[0].slot, 'GK']]);
  const mids = lines.length - 2;          // lignes entre la défense et l'attaque
  const backThree = lines[0] === 3;
  let i = 1;
  lines.forEach((n, li) => {
    const line = byDepth.slice(i, i + n).sort((a, b) => a.y - b.y);
    i += n;
    line.forEach((s, k) => {
      const edge = n >= 3 && (k === 0 || k === n - 1);
      let p: string;
      if (li === 0) p = edge && n === 5 ? 'WB' : edge && n === 4 ? 'FB' : 'CB';
      else if (li === lines.length - 1) p = edge && n === 3 ? 'W' : 'ST';
      else {
        const m = li - 1;                  // rang de la ligne de milieu
        if (n >= 4 && edge) p = backThree ? 'WB' : 'W';
        else if (mids > 1 && m === mids - 1 && n <= 3) p = n === 3 && edge ? 'W' : 'AM';
        else if (mids > 1 && m === 0 && n <= 2) p = 'DM';
        else p = 'CM';
      }
      out.set(s.slot, p);
    });
  });
  return out;
}

/**
 * Hors poste : le poste de la fiche est à deux lignes ou plus du poste occupé (ailier aligné
 * piston ou latéral, par exemple), ou un gardien d'un côté seulement. Plus près (ailier en
 * meneur, milieu offensif en relayeur), c'est une nuance de rôle, pas un signal : mesuré sur
 * 2025-26, 34 titulaires sur 6 625 sont à deux lignes ou plus.
 */
export function isOutOfPosition(playerPosition: string | undefined, slotPosition: string | undefined): boolean {
  if (!playerPosition || !slotPosition || !(playerPosition in LINE_OF) || !(slotPosition in LINE_OF)) return false;
  const a = LINE_OF[playerPosition];
  const b = LINE_OF[slotPosition];
  if (a === 0 || b === 0) return a !== b;
  return Math.abs(a - b) >= 2;
}

// ============================================
// FORMATION DES BESOINS DE RECRUTEMENT
// ============================================

/** Onze exploitable : au moins 11 cases placées (formation complète, ou irrégulière fusionnée) */
export const isExploitableFormation = (view: Pick<FormationView, 'slots'>) => view.slots.length >= ELEVEN;

/**
 * Formation retenue pour les besoins de recrutement : la plus utilisée parmi celles qui
 * donnent un onze exploitable. L'Analyse d'équipe montre la plus utilisée telle quelle, même
 * incomplète (« 3-2-4-1 · 7 matchs · Incomplète ») ; le Recrutement ne peut pas mesurer de
 * besoin sur des cases sans position et se replie sur la suivante, en le disant
 * (`fallbackFrom`). Sans aucune formation exploitable, la plus utilisée est gardée.
 * `formations` : ordre de orderFormations.
 */
export function recruitmentFormation(formations: FormationView[]): { index: number; fallbackFrom?: FormationView } | null {
  if (formations.length === 0) return null;
  const index = formations.findIndex(isExploitableFormation);
  if (index <= 0) return { index: 0 };
  return { index, fallbackFrom: formations[0] };
}
