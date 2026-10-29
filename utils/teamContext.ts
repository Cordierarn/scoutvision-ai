/**
 * ScoutVision - contexte d'une équipe sélectionnée (championnat de référence, saison)
 * Partagé par l'Analyse d'équipe et le Recrutement : même équipe, mêmes lignes, mêmes valeurs.
 */

import { PlayerData, getPlayerSeason } from '../types';
import { dataLoader } from '../services/dataLoader';
import { queryService } from '../services/queryService';

/** La saison est-elle la saison en cours (la plus récente des données) ? */
export function isSeasonInProgress(season: string | undefined): boolean {
  const seasons = dataLoader.getCachedIndex()?.seasons ?? [];
  return season !== undefined && seasons[seasons.length - 1]?.id === season;
}

export const isLeagueCompetition = (c: string) => (dataLoader.getCompetition(c)?.type ?? 'league') === 'league';

export type TeamLeague =
  | { missingLeague: true; name: string; cup?: string }
  | {
    missingLeague: false;
    teamId: string; name: string; logo?: string;
    season: string; competition: string; leagueName: string; tier: number;
    fromCup: boolean; cup?: string;
    seasonRows: PlayerData[];                  // toutes les lignes de la saison de l'équipe
    isLeague: (c: string) => boolean;
    inProgress: boolean;
  };

/**
 * Championnat de référence d'une équipe : le sien ; pour une coupe d'Europe, le championnat
 * où l'équipe a joué le plus de minutes cette saison. null si l'équipe est introuvable.
 */
export function resolveTeamLeague(teamKey: string, playerData: PlayerData[]): TeamLeague | null {
  const first = queryService.getTeamPlayers(teamKey)[0];
  if (!first?.['Team ID']) return null;
  const season = getPlayerSeason(first);
  const isLeague = isLeagueCompetition;
  const seasonRows = playerData.filter(p => getPlayerSeason(p) === season);
  let competition = first.Competition;
  const fromCup = !competition || !isLeague(competition);
  if (fromCup) {
    const minutes = new Map<string, number>();
    seasonRows.forEach(p => {
      if (p['Team ID'] === first['Team ID'] && p.Competition && isLeague(p.Competition)) {
        minutes.set(p.Competition, (minutes.get(p.Competition) ?? 0) + (Number(p['Minutes played']) || 0));
      }
    });
    competition = [...minutes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  }
  if (!competition) return { missingLeague: true, name: first.Team, cup: first.Competition };
  const info = dataLoader.getCompetition(competition);
  return {
    missingLeague: false,
    teamId: first['Team ID'], name: first.Team, logo: first['Team logo'] as string | undefined,
    season, competition, leagueName: info?.name ?? competition,
    tier: info?.tier ?? (typeof first['League tier'] === 'number' ? first['League tier'] : 2),
    fromCup, cup: first.Competition, seasonRows, isLeague,
    inProgress: isSeasonInProgress(season),
  };
}
