/**
 * ScoutVision - contexte d'une ligne joueur-saison : compétition, coupe, minutes, saison en cours.
 * Lecture seule des données préparées ; partagé par Comparaison et Joueurs similaires.
 */

import { PlayerData, getPlayerSeason } from '../types';
import { dataLoader } from '../services/dataLoader';
import { isSeasonInProgress } from './sampleContext';
import { metricValue } from './metricFormat';

export const competitionInfo = (p: PlayerData) => dataLoader.getCompetition(p.Competition);

/** Coupe d'Europe (une ligne par compétition : le championnat reste la ligne principale) */
export const isCup = (p: PlayerData) => { const info = competitionInfo(p); return !!info && info.type !== 'league'; };

export const competitionName = (p: PlayerData) => competitionInfo(p)?.name ?? p.Competition ?? 'Compétition inconnue';

export const minutesOf = (p: PlayerData) => metricValue(p, 'Minutes played');

/** Saison pas terminée à la date des données (même règle que la fiche joueur) */
export function seasonInProgress(p: PlayerData): boolean {
  const index = dataLoader.getCachedIndex();
  const seasons = index?.seasons ?? [];
  const season = getPlayerSeason(p);
  return seasons[seasons.length - 1]?.id === season && isSeasonInProgress(season, p.Season, index?.generatedAt);
}

/** Vrai si la saison chargée (la plus récente de l'index) est en cours */
export function loadedSeasonInProgress(data: PlayerData[]): boolean {
  return data.some(seasonInProgress);
}
