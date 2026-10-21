/**
 * ScoutVision AI - Onze type d'une formation
 * Cases de la table lineup de PitchAPI (voir scripts/prepare_data.py, build_lineups).
 */

import { LineupSlot } from '../services/dataLoader';

export interface SlotPlayer {
  id: string;
  name: string;
  starts: number;
}

export interface PlacedSlot {
  slot: LineupSlot;
  starter: SlotPlayer | null;
  backups: SlotPlayer[];
}

// Prime par case pourvue : bien plus que tout écart de titularisations, pour pourvoir
// d'abord le plus de cases possible
const FILLED_SLOT = 1000;

/**
 * Affectation de coût minimal (algorithme hongrois, potentiels) : une colonne distincte
 * par ligne ; n lignes <= m colonnes. Renvoie la colonne de chaque ligne.
 */
function hungarian(cost: number[][]): number[] {
  const n = cost.length;
  const m = cost[0]?.length ?? 0;
  const u = new Array(n + 1).fill(0);
  const v = new Array(m + 1).fill(0);
  const p = new Array(m + 1).fill(0);       // colonne -> ligne (1-indexé, 0 = libre)
  const way = new Array(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array(m + 1).fill(Infinity);
    const used = new Array(m + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= m; j++) {
        if (used[j]) continue;
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
        if (minv[j] < delta) { delta = minv[j]; j1 = j; }
      }
      for (let j = 0; j <= m; j++) {
        if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
  }
  const assign = new Array(n).fill(-1);
  for (let j = 1; j <= m; j++) if (p[j]) assign[p[j] - 1] = j - 1;
  return assign;
}

/**
 * Onze distinct : chaque joueur occupe au plus une case. Affectation de poids maximal
 * (algorithme hongrois) : d'abord le plus de cases pourvues possible, puis le plus de
 * titularisations au total. Un joueur titulaire dans deux cases garde donc celle où il
 * a le plus joué si l'autre a une solution de rechange, et cède sa case seulement quand
 * c'est le seul moyen de pourvoir une case vide.
 */
export function placeEleven(slots: LineupSlot[]): PlacedSlot[] {
  if (slots.length === 0) return [];
  const candidates = slots.map(s => slotPlayers(s));
  const ids = [...new Set(candidates.flatMap(c => c.map(p => p.id)))];
  const column = new Map(ids.map((id, j) => [id, j]));
  // Colonnes : les joueurs, puis une colonne « case vide » par case
  const cost = candidates.map(c => {
    const row = new Array(ids.length + slots.length).fill(0);
    c.forEach(p => { row[column.get(p.id)!] = -(FILLED_SLOT + p.starts); });
    return row;
  });
  const assign = hungarian(cost);

  return slots.map((slot, i) => {
    const starterId = assign[i] < ids.length && cost[i][assign[i]] < 0 ? ids[assign[i]] : undefined;
    return {
      slot,
      starter: candidates[i].find(c => c.id === starterId) ?? null,
      backups: candidates[i].filter(c => c.id !== starterId),
    };
  });
}

/**
 * Joueurs d'une case, un par identifiant (titularisations additionnées si le joueur
 * apparaît sous deux graphies), du plus titularisé au moins titularisé
 */
function slotPlayers(slot: LineupSlot): SlotPlayer[] {
  const byId = new Map<string, SlotPlayer>();
  slot.players.forEach(([id, name, starts]) => {
    const prev = byId.get(id);
    if (prev) prev.starts += starts;
    else byId.set(id, { id, name, starts });
  });
  return [...byId.values()].sort((a, b) => b.starts - a.starts);
}
