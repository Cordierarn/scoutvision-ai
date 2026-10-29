/**
 * ScoutVision - état de l'Analyse d'équipe conservé au retour d'une fiche joueur
 * (module : survit au démontage de la page). Le Recrutement a son propre état.
 */

import { DEFAULT_SHOT_FILTERS, ShotFilters, ShotSide } from '../../utils/teamShots';

export type TeamTab = 'STYLE' | 'LINEUP' | 'SQUAD' | 'SHOTS';
export const TEAM_TABS: { key: TeamTab; label: string }[] = [
  { key: 'STYLE', label: 'Style & forces' },
  { key: 'LINEUP', label: 'Onze & formations' },
  { key: 'SQUAD', label: 'Effectif & profondeur' },
  { key: 'SHOTS', label: 'Tirs' },
];

export type SquadSortKey = 'Player' | 'Age' | 'Position' | 'Minutes played' | 'Goals' | 'xG' | 'xA' | 'Rating pct' | 'Market value' | 'Contract expires';

export interface TeamMemory {
  team: string;                                  // clé « équipe · compétition saison »
  tab: TeamTab;
  formation: Record<string, string>;             // formation choisie par équipe
  slot: Record<string, number>;                  // case choisie par équipe (numéro de case)
  shotSide: ShotSide;
  shotFilters: ShotFilters;
  squadSort: { key: SquadSortKey; dir: 'asc' | 'desc' };
  scroll: Partial<Record<TeamTab, number>>;      // défilement par onglet (équipe courante)
}

export const teamMemory: TeamMemory = {
  team: '',
  tab: 'STYLE',
  formation: {},
  slot: {},
  shotSide: 'for',
  shotFilters: DEFAULT_SHOT_FILTERS,
  squadSort: { key: 'Minutes played', dir: 'desc' },
  scroll: {},
};

/** Ouvre l'Analyse d'équipe sur une équipe (onglet conservé) */
export function openTeamAnalysis(teamKey: string): void {
  if (teamKey !== teamMemory.team) teamMemory.scroll = {};
  teamMemory.team = teamKey;
}
