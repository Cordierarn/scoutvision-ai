/**
 * ScoutVision AI - Type Definitions
 * Types complets et robustes pour l'application de scouting
 */

// ============================================
// SEASON UTILITIES
// ============================================

/**
 * Extrait la saison d'application d'une chaîne League
 * ("Serie A 2024-25" -> "2024-25" ; année civile "Brasileirão 2024" -> "2024-25")
 */
export function extractSeason(league: string | undefined): string {
  if (!league || typeof league !== 'string') return 'Unknown';

  const match = league.match(/\b(20\d{2})-(\d{2})\b/);
  if (match) {
    return `${match[1]}-${match[2]}`;
  }

  // Saison en année civile : rangée dans la saison qui commence la même année
  const yearMatch = league.match(/\b(20\d{2})\b/);
  if (yearMatch) {
    const year = parseInt(yearMatch[1]);
    return `${year}-${String(year + 1).slice(2)}`;
  }

  return 'Unknown';
}

/**
 * Saison d'application d'un joueur (champ Season, sinon déduite de League)
 */
export function getPlayerSeason(player: PlayerData): string {
  return extractSeason(String(player.League || player.Season || ''));
}

/**
 * Retourne le label de saison formaté ("2024-25" -> "2024/25")
 */
export function getSeasonLabel(season: string): string {
  return season.replace('-', '/');
}

/**
 * Libellé court pour les badges ("2024-25" -> "24-25")
 */
export function getSeasonShortLabel(season: string): string {
  const match = season.match(/^20(\d{2})-(\d{2})$/);
  return match ? `${match[1]}-${match[2]}` : season;
}

// Badges de saison neutres : le libellé (24-25) suffit, la couleur reste réservée aux données
const SEASON_STYLE = { bg: 'bg-raised', text: 'text-ink-2', border: 'border-line-strong' };

/**
 * Style du badge d'une saison (neutre, identique pour toutes les saisons)
 */
export function getSeasonColor(_season: string): { bg: string; text: string; border: string } {
  return SEASON_STYLE;
}

/**
 * Génère un ID unique pour un joueur incluant la saison
 */
export function getPlayerSeasonId(player: PlayerData): string {
  const season = getPlayerSeason(player);
  // Un joueur a une ligne par compétition (championnat, coupe d'Europe...)
  return `${player['Player ID'] || player.Player}_${player['Team ID'] || player.Team}_${player.Competition || ''}_${season}`;
}

// ============================================
// PLAYER DATA TYPES
// ============================================

/**
 * Interface de base pour les données d'un joueur
 * Permet l'indexation dynamique tout en définissant les champs clés
 */
export interface PlayerData {
  [key: string]: string | number | undefined;
  
  // Identification (PitchAPI)
  "Player ID"?: string;
  Player: string;
  "Team ID"?: string;
  Team: string;
  Competition?: string;        // clé de compétition : ENG, FRA, UCL...
  "League tier"?: number;      // 1 = Big 5 + UCL, 2, 3
  League: string;              // "Premier League 2024-25"
  Season?: string;             // saison réelle : "2024-25" ou "2024"
  Position: string;            // rôle réel : GK, CB, FB, WB, DM, CM, AM, W, ST
  "Position group"?: string;   // GK, DEF, MID, FWD
  "Midfield profile"?: string;
  Image?: string;              // photo du joueur (CDN PitchAPI)
  "Team logo"?: string;

  // Profil
  Age?: number;
  "Birth date"?: string;
  "Passport country"?: string;
  "Market value"?: number;     // Transfermarkt, si market-values a été branché
  "Contract expires"?: string;
  "Estimated value"?: number;  // valeur attendue d'après la performance (modèle ridge, saison en cours)
  Height?: number;             // cm (Transfermarkt)
  Foot?: string;               // Right, Left, Both (Transfermarkt)

  // Temps de jeu
  "Matches played": number;
  Starts?: number;
  "Minutes played": number;
  "Minutes share"?: number;

  // Totaux
  Goals?: number;
  Assists?: number;
  xG?: number;
  xA?: number;

  // Impact et contexte (analyses du pipeline et modèles de prepare_data.py)
  "RAPM off"?: number;         // plus-minus régularisé, xG/90, fenêtre de deux saisons
  "RAPM def"?: number;
  "RAPM net"?: number;
  "RAPM minutes"?: number;
  "Finishing skill"?: number;  // buts au-dessus de l'xG pour 100 tirs (carrière, shrinké)
  "Career shots"?: number;
  "Pass share, %"?: number;    // part des passes de l'équipe qui passent par le joueur
  "Network betweenness"?: number;
  "Team style"?: string;

  // Les métriques per-90 et taux sont des clés libres (ex. "xG per 90"),
  // leur percentile par rôle est la clé "<métrique> pct" (0-100).
}

/**
 * Interface pour un joueur avec score calculé
 */
export interface ScoredPlayer extends PlayerData {
  roleScore: number;
  percentile?: number;
}

/**
 * Profil statistique normalisé d'un joueur (percentiles)
 */
export interface PlayerPercentileProfile {
  player: PlayerData;
  percentiles: Record<string, number>;
  zScores: Record<string, number>;
  averages: Record<string, number>;
}

// ============================================
// TEAM DATA TYPES
// ============================================

/**
 * Statistiques d'équipe agrégées
 */
export interface TeamStats {
  team_id: string;
  team: string;
  competition: string;         // ENG, FRA, UCL...
  league: string;              // "Premier League 2024-25"
  season: string;              // saison réelle : "2024-25" ou "2024"
  image?: string;

  // Métriques de la saison (team_season PitchAPI)
  Matches?: number;
  "xG per 90"?: number;
  "xGA per 90"?: number;
  "npxG per 90"?: number;
  "npxGA per 90"?: number;
  "Shots per 90"?: number;
  "Shots against per 90"?: number;
  "Goals per 90"?: number;
  "Goals against per 90"?: number;
  "Possession, %"?: number;
  "Field tilt"?: number;
  "Average action height"?: number;
  "Defensive line height"?: number;
  PPDA?: number;
  "Ball recovery time"?: number;
  "Passes per sequence"?: number;
  "Direct speed"?: number;
  "Pass accuracy, %"?: number;

  [key: string]: string | number | undefined;
}

// ============================================
// SHOT EVENT TYPES
// ============================================

/**
 * Événement de tir individuel
 */
export interface ShotEvent {
  id: string;
  minute: number;
  result: ShotResult;
  X: number;              // 0 = propre but, 1 = but adverse
  Y: number;              // 0-1 sur la largeur
  xG: number;
  xGOT?: number;
  player: string;
  player_id?: string;
  team: string;
  h_a: 'h' | 'a';
  situation: ShotSituation;
  shotType: ShotType;
  isOwnGoal?: boolean;
  match_id?: string;
  season?: string;
}

export type ShotResult = 'Goal' | 'SavedShot' | 'MissedShots' | 'BlockedShot' | 'ShotOnPost';
export type ShotSituation = 'OpenPlay' | 'SetPiece' | 'FromCorner' | 'DirectFreekick' | 'Penalty';
export type ShotType = 'RightFoot' | 'LeftFoot' | 'Head' | 'OtherBodyPart';

/**
 * Statistiques agrégées de tirs
 */
export interface ShotStats {
  total: number;
  goals: number;
  xG: number;
  xGDiff: number;
  onTarget: number;
  blocked: number;
  conversion: number;
  avgXG: number;
}

// ============================================
// ANALYSIS & SCORING TYPES
// ============================================

/**
 * Définition d'un rôle avec ses métriques pondérées
 */
export interface RoleDefinition {
  name: string;
  category: RoleCategory;
  positions: string[];
  metrics: Record<string, number>;
  minThresholds?: Record<string, number>;
  description?: string;
}

export type RoleCategory = 'goalkeeper' | 'defender' | 'midfielder' | 'attacker';

/**
 * Preset de rôle personnalisé
 */
export interface RolePreset {
  name: string;
  positions: string[];
  metrics: Record<string, number>;
  custom?: boolean;
  createdAt?: string;
}

/**
 * Résultat de scoring pour un joueur
 */
export interface RoleScoreResult {
  role: string;
  rawScore: number;
  normalizedScore: number;
  percentile: number;
  breakdown: {
    metric: string;
    value: number;
    weight: number;
    contribution: number;
  }[];
}

// ============================================
// FILTER & SEARCH TYPES
// ============================================

// ============================================
// VIEW STATE TYPES
// ============================================

/**
 * États de vue de l'application
 */
export enum ViewState {
  UPLOAD = 'UPLOAD',
  DASHBOARD = 'DASHBOARD',
  PLAYER_DETAIL = 'PLAYER_DETAIL',
  SIMILARITY = 'SIMILARITY',
  COMPARISON = 'COMPARISON',
  SCOUT_REPORT = 'SCOUT_REPORT',
  TEAM_ANALYSIS = 'TEAM_ANALYSIS',
  PROSPECTS = 'PROSPECTS',
  WATCHLIST = 'WATCHLIST',
  FORECAST = 'FORECAST',
  LAB = 'LAB',
  MARKET_LAB = 'MARKET_LAB',
  RECRUITMENT = 'RECRUITMENT'
}

/**
 * Mode de comparaison pour les graphiques
 */
export type ComparisonMode = 'all' | 'position' | 'team' | 'league';

// ============================================
// REPORT & EXPORT TYPES
// ============================================

// ============================================
// DATA STORE TYPES
// ============================================

// ============================================
// UTILITY TYPES
// ============================================

/**
 * Bornes min/max pour normalisation
 */
export interface MetricBounds {
  min: number;
  max: number;
  mean: number;
  stdDev: number;
}


/**
 * Saison affichée pour une ligne joueur : la saison réelle quand la compétition se joue
 * en année civile (« 2026 »), sinon le libellé court (« 25-26 »)
 */
export function getPlayerSeasonTag(player: PlayerData): string {
  const raw = String(player.Season ?? '');
  return /^\d{4}$/.test(raw) ? raw : getSeasonShortLabel(getPlayerSeason(player));
}
