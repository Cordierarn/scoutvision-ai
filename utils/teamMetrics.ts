/**
 * ScoutVision - métriques d'équipe (sans rendu)
 *
 * Registre déclaratif des métriques de team_season (teams/<saison>.json) et rang d'une équipe
 * dans son championnat. Une seule source de rang : teamRank (utils/recruitment.ts), utilisé
 * à l'identique par l'Analyse d'équipe et le Recrutement.
 *
 * Convention du rang (percentileRank) : part des équipes de la cohorte en dessous, les égalités
 * comptant pour moitié, l'équipe elle-même incluse. Le premier de n équipes vaut 100 − 50/n
 * (97,2 sur 18), le dernier 50/n (2,8) : échelle symétrique, sans plafond propre à la formule.
 * Une valeur absente (null, undefined, "", NaN) n'a pas de rang et ne compte pas dans la cohorte.
 */

import { TeamStats } from '../types';
import { teamRank } from './recruitment';

export type TeamMetricCategory = 'outcome' | 'style' | 'context';

export interface TeamMetricDef {
  key: keyof TeamStats & string;   // colonne de teams/<saison>.json
  label: string;
  unit: '' | '%';
  /** Sens du rang : 'higher' = une valeur haute classe haut (plus de possession, plus d'xG) ;
   *  'lower' = une valeur basse classe haut (moins d'xG concédés, PPDA bas = pressing intense) */
  direction: 'higher' | 'lower';
  /** Lecture du sens affichée à l'utilisateur */
  sense: string;
  category: TeamMetricCategory;
  source: 'team_season';
  decimals: number;
  /** Indicateur du modèle de style (STYLE_FEATURES de scripts/models.py) */
  styleFeature?: 'possession' | 'territory' | 'pressing' | 'line_height' | 'directness' | 'build_up';
}

/**
 * Registre : une métrique d'équipe future (VAEP, xT, phases…) s'ajoute ici avec sa source,
 * sans toucher au calcul du rang ni aux composants qui le lisent.
 */
export const TEAM_METRICS: TeamMetricDef[] = [
  { key: 'xG per 90', label: 'xG créés par 90', unit: '', direction: 'higher', sense: 'Plus = plus d\'occasions créées', category: 'outcome', source: 'team_season', decimals: 2 },
  { key: 'xGA per 90', label: 'xG concédés par 90', unit: '', direction: 'lower', sense: 'Moins = moins d\'occasions concédées', category: 'outcome', source: 'team_season', decimals: 2 },
  { key: 'npxG per 90', label: 'npxG créés par 90', unit: '', direction: 'higher', sense: 'Hors penalties', category: 'outcome', source: 'team_season', decimals: 2 },
  { key: 'npxGA per 90', label: 'npxG concédés par 90', unit: '', direction: 'lower', sense: 'Hors penalties ; moins = mieux', category: 'outcome', source: 'team_season', decimals: 2 },
  { key: 'Shots per 90', label: 'Tirs par 90', unit: '', direction: 'higher', sense: 'Plus = plus de tirs', category: 'outcome', source: 'team_season', decimals: 1 },
  { key: 'Shots against per 90', label: 'Tirs concédés par 90', unit: '', direction: 'lower', sense: 'Moins = moins de tirs subis', category: 'outcome', source: 'team_season', decimals: 1 },
  { key: 'Goals per 90', label: 'Buts par 90', unit: '', direction: 'higher', sense: 'Plus = plus de buts', category: 'outcome', source: 'team_season', decimals: 2 },
  { key: 'Goals against per 90', label: 'Buts encaissés par 90', unit: '', direction: 'lower', sense: 'Moins = moins de buts encaissés', category: 'outcome', source: 'team_season', decimals: 2 },
  { key: 'Possession, %', label: 'Possession', unit: '%', direction: 'higher', sense: 'Part du ballon', category: 'style', source: 'team_season', decimals: 1, styleFeature: 'possession' },
  { key: 'Field tilt', label: 'Field tilt', unit: '%', direction: 'higher', sense: 'Part des actions dans le dernier tiers : domination territoriale', category: 'style', source: 'team_season', decimals: 1, styleFeature: 'territory' },
  { key: 'PPDA', label: 'PPDA', unit: '', direction: 'lower', sense: 'Passes adverses par action défensive : bas = pressing intense', category: 'style', source: 'team_season', decimals: 1, styleFeature: 'pressing' },
  { key: 'Defensive line height', label: 'Hauteur des actions défensives', unit: '', direction: 'higher', sense: 'Haut = bloc et ligne défensive avancés', category: 'style', source: 'team_season', decimals: 1, styleFeature: 'line_height' },
  { key: 'Direct speed', label: 'Vitesse directe', unit: '', direction: 'higher', sense: 'Progression vers le but adverse : haut = jeu direct', category: 'style', source: 'team_season', decimals: 2, styleFeature: 'directness' },
  { key: 'Passes per sequence', label: 'Passes par séquence', unit: '', direction: 'higher', sense: 'Haut = construction patiente', category: 'style', source: 'team_season', decimals: 1, styleFeature: 'build_up' },
  { key: 'Pass accuracy, %', label: 'Passes réussies', unit: '%', direction: 'higher', sense: 'Précision des passes', category: 'context', source: 'team_season', decimals: 1 },
  { key: 'Average action height', label: 'Hauteur moyenne des actions', unit: '', direction: 'higher', sense: 'Haut = jeu plus près du but adverse', category: 'context', source: 'team_season', decimals: 1 },
  { key: 'Ball recovery time', label: 'Temps de récupération', unit: '', direction: 'lower', sense: 'Bas = ballon récupéré plus vite', category: 'context', source: 'team_season', decimals: 1 },
];

export const teamMetric = (key: string) => TEAM_METRICS.find(m => m.key === key);

/** Les 6 indicateurs du modèle de style, dans l'ordre de scripts/models.py */
export const STYLE_METRICS: TeamMetricDef[] = (['possession', 'territory', 'pressing', 'line_height', 'directness', 'build_up'] as const)
  .map(f => TEAM_METRICS.find(m => m.styleFeature === f)!);

/** Valeur d'une métrique d'équipe : nombre fini, sinon null (jamais 0 par défaut) */
export function teamValue(team: TeamStats | null | undefined, key: string): number | null {
  const v = team?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Cohorte de comparaison : les équipes de la même compétition et de la même saison */
export function teamCohort(team: TeamStats, teams: TeamStats[]): TeamStats[] {
  return teams.filter(t => t.competition === team.competition && t.league === team.league);
}

export interface TeamMetricRank {
  def: TeamMetricDef;
  value: number | null;            // null = N/D
  rank: number | undefined;        // percentile dans la cohorte (teamRank), undefined si absente
  teams: number;                   // équipes de la cohorte qui ont une valeur
}

export function teamMetricRank(team: TeamStats, cohort: TeamStats[], def: TeamMetricDef): TeamMetricRank {
  const value = teamValue(team, def.key);
  const teams = cohort.filter(t => teamValue(t, def.key) !== null).length;
  return { def, value, rank: value === null ? undefined : teamRank(team, cohort, def.key, def.direction === 'higher'), teams };
}

export function teamMetricRanks(team: TeamStats, teams: TeamStats[], defs: TeamMetricDef[]): TeamMetricRank[] {
  const cohort = teamCohort(team, teams);
  return defs.map(d => teamMetricRank(team, cohort, d));
}

/**
 * Totaux de la saison tirés des moyennes par 90 de l'équipe (team_season) : buts marqués et
 * encaissés de toute l'équipe, pas la somme des joueurs suivis (filtrés par temps de jeu)
 */
export function teamTotals(team: TeamStats | null | undefined): { matches: number | null; goalsFor: number | null; goalsAgainst: number | null } {
  const matches = teamValue(team, 'Matches');
  const total = (key: string) => {
    const v = teamValue(team, key);
    return v === null || matches === null ? null : Math.round(v * matches);
  };
  return { matches, goalsFor: total('Goals per 90'), goalsAgainst: total('Goals against per 90') };
}

// ============================================
// FIABILITÉ DU STYLE
// ============================================

/**
 * Matchs avant d'afficher un style, mesurés sur 1 286 équipes-saisons de championnat complètes
 * (au moins 20 matchs, données match par match du cache PitchAPI) : style des N premiers matchs
 * (moyenne des 6 indicateurs, centroïde existant le plus proche) comparé au style final.
 * Retrouvé : 30 % après 1 match, 48 % après 3, 55 % après 5, 64 % après 8, 66 % après 10,
 * 74 % après 15, 80 % après 20 (style le plus fréquent : 23,5 %).
 * Sous 5 matchs le style n'est pas nommé ; de 5 à 9 c'est une tendance ; à partir de 10, un
 * style observé, qui reste descriptif.
 */
export const STYLE_TREND_MATCHES = 5;
export const STYLE_MIN_MATCHES = 10;

export type StyleReliability = 'unknown' | 'insufficient' | 'trend' | 'observed';

export function styleReliability(matches: number | null | undefined, style: string | null | undefined): StyleReliability {
  if (!style) return 'unknown';
  if (typeof matches !== 'number' || !Number.isFinite(matches) || matches < STYLE_TREND_MATCHES) return 'insufficient';
  return matches < STYLE_MIN_MATCHES ? 'trend' : 'observed';
}

// ============================================
// CARTE DES STYLES (ACP de scripts/models.py)
// ============================================

/**
 * Variance expliquée par les deux axes de la carte : ACP sur les 6 indicateurs centrés-réduits
 * de toutes les équipes-saisons (2 328 au moment de la mesure). Le pipeline ne l'exporte pas :
 * valeurs mesurées sur les données, contrôlées par teamMetrics.test.ts quand elles sont présentes.
 */
export const STYLE_PCA_VARIANCE = { pc1: 0.632, pc2: 0.24 } as const;

export interface StylePoint {
  team: TeamStats;
  kind: 'selected' | 'club' | 'same' | 'other';   // équipe-saison choisie, autres saisons du club, même style, autres
}

/**
 * Population de la carte des styles : une équipe-saison = une observation. Saison seule : la
 * compétition de cette saison. « Toutes les saisons » : toutes les saisons de la compétition,
 * chaque saison d'un club étant un point distinct. Équipes sans coordonnées écartées.
 */
export function styleMapPopulation(team: TeamStats, teams: TeamStats[], allSeasons: boolean): StylePoint[] {
  const style = team.Style;
  return teams
    .filter(t => t.competition === team.competition && (allSeasons || t.season === team.season))
    .filter(t => teamValue(t, 'Style x') !== null && teamValue(t, 'Style y') !== null)
    .map(t => ({
      team: t,
      kind: t.team_id === team.team_id && t.season === team.season ? 'selected'
        : t.team_id === team.team_id ? 'club' : t.Style === style ? 'same' : 'other',
    }));
}
