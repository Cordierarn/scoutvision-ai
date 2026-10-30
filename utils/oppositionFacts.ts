/**
 * ScoutVision - faits d'équipe transmis au briefing d'opposition (fonction pure)
 *
 * Reprend ce que la page Analyse d'équipe affiche déjà : statistiques de saison avec leur rang
 * dans la compétition, formation principale et titulaires par case, profil de l'effectif, joueurs
 * les plus utilisés avec leur rôle principal. Rien n'est recalculé ; aucune ligne brute n'est envoyée.
 */

import { PlayerData, TeamStats } from '../types';
import { FormationView } from './teamLineups';
import { TeamMetricRank } from './teamMetrics';
import { DimensionScore } from './recruitment';
import { rankPresets } from './rolePresets';
import { positionName } from './labels';

export interface OppositionInput {
  name: string;
  competition: string;          // libellé de la compétition
  season: string;
  stats: TeamStats | null;
  ranks: TeamMetricRank[];      // métriques de style et de résultat avec leur rang
  mainFormation?: FormationView;
  profile?: DimensionScore[] | null;
  players: PlayerData[];        // joueurs de l'équipe dans la saison
  seasonInProgress?: boolean;
  isCup?: boolean;
}

export interface OppositionFacts {
  team: Record<string, unknown>;
  ranks: { metric: string; value: number; rank: number; of: number; sense: string }[];
  formation?: { formation: string; matches: number; starters: { position: string; player: string; starts: number }[] };
  squadProfile?: { dimension: string; value: number; rank: number; of: number }[];
  keyPlayers: { name: string; position: string; age?: number; minutes: number; matches?: number; role?: string; roleIndex?: number }[];
}

const round = (v: number, d = 1) => Math.round(v * 10 ** d) / 10 ** d;

export function buildOppositionFacts(input: OppositionInput, maxPlayers = 12): OppositionFacts {
  const s = input.stats;
  const team: Record<string, unknown> = { name: input.name, competition: input.competition, season: input.season };
  if (s) {
    if (typeof s.Matches === 'number') team.matches = s.Matches;
    if (typeof s['Goals per 90'] === 'number') team.goalsForPer90 = round(s['Goals per 90'], 2);
    if (typeof s['Goals against per 90'] === 'number') team.goalsAgainstPer90 = round(s['Goals against per 90'], 2);
    if (typeof s.Style === 'string') team.style = s.Style;
  }
  if (input.seasonInProgress) team.seasonInProgress = true;
  if (input.isCup) team.competitionType = 'cup';

  const ranks = input.ranks
    .filter(r => r.value !== null && r.rank !== undefined)
    .map(r => ({ metric: r.def.label, value: round(r.value as number, r.def.decimals ?? 2), rank: Math.round(r.rank as number), of: r.teams, sense: r.def.sense }));

  const f = input.mainFormation;
  const formation = f ? {
    formation: f.formation, matches: f.matches,
    starters: f.slots.map(sl => ({ position: slotPosition(sl.x, sl.y), player: sl.players[0]?.[1] ?? '—', starts: sl.players[0]?.[2] ?? 0 })),
  } : undefined;

  const squadProfile = input.profile?.length ? input.profile.map(d => ({ dimension: d.label, value: Math.round(d.value), rank: Math.round(d.rank), of: d.teams })) : undefined;

  const keyPlayers = [...input.players]
    .filter(p => typeof p['Minutes played'] === 'number')
    .sort((a, b) => Number(b['Minutes played']) - Number(a['Minutes played']))
    .slice(0, maxPlayers)
    .map(p => {
      const best = rankPresets(p)[0];
      return {
        name: String(p.Player), position: positionName(String(p.Position ?? '')), minutes: Math.round(Number(p['Minutes played'])),
        ...(typeof p.Age === 'number' ? { age: Math.floor(p.Age) } : {}),
        ...(typeof p['Matches played'] === 'number' ? { matches: p['Matches played'] } : {}),
        ...(best ? { role: best.name, roleIndex: best.index } : {}),
      };
    });

  return { team, ranks, ...(formation ? { formation } : {}), ...(squadProfile ? { squadProfile } : {}), keyPlayers };
}

/** Lecture grossière d'une case de composition : profondeur (0 = propre but) et largeur (0 = gauche) */
function slotPosition(x: number, y: number): string {
  const depth = x < 0.12 ? 'gardien' : x < 0.38 ? 'défenseur' : x < 0.68 ? 'milieu' : 'attaquant';
  const side = depth === 'gardien' ? '' : y < 0.33 ? ' gauche' : y > 0.67 ? ' droit' : ' axial';
  return depth + side;
}
