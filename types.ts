/**
 * ScoutVision AI - Type Definitions
 * Types complets et robustes pour l'application de scouting
 */

// ============================================
// SEASON UTILITIES
// ============================================

/**
 * Extrait la saison d'une chaîne League (ex: "Serie A 2024-25" -> "24-25")
 */
export function extractSeason(league: string | undefined): string {
  if (!league || typeof league !== 'string') return 'Unknown';
  
  // Pattern pour "2024-25" ou "2025-26"
  const match = league.match(/20(\d{2})-(\d{2})/);
  if (match) {
    return `${match[1]}-${match[2]}`;
  }
  
  // Pattern alternatif "2024" seul
  const yearMatch = league.match(/\b(2024|2025|2026)\b/);
  if (yearMatch) {
    const year = parseInt(yearMatch[1]);
    return `${year.toString().slice(2)}-${(year + 1).toString().slice(2)}`;
  }
  
  return 'Unknown';
}

/**
 * Retourne le label de saison formaté
 */
export function getSeasonLabel(season: string): string {
  switch (season) {
    case '24-25': return '2024-25';
    case '25-26': return '2025-26';
    default: return season;
  }
}

/**
 * Retourne la couleur associée à une saison
 */
export function getSeasonColor(season: string): { bg: string; text: string; border: string } {
  switch (season) {
    case '24-25':
      return { bg: 'bg-blue-500/20', text: 'text-blue-400', border: 'border-blue-500/30' };
    case '25-26':
      return { bg: 'bg-purple-500/20', text: 'text-purple-400', border: 'border-purple-500/30' };
    default:
      return { bg: 'bg-slate-500/20', text: 'text-slate-400', border: 'border-slate-500/30' };
  }
}

/**
 * Génère un ID unique pour un joueur incluant la saison
 */
export function getPlayerSeasonId(player: PlayerData): string {
  const season = extractSeason(player.League);
  return `${player.Player}_${player.Team}_${season}`;
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
  
  // Identification
  Player: string;
  Team: string;
  Position: string;
  League: string;
  
  // Profil
  Age: number;
  Height: number;
  Weight: number;
  Foot: string;
  "Market value": number;
  "Passport country"?: string;
  "Birth country"?: string;
  "Contract expires"?: string;
  "On loan"?: string;
  
  // Temps de jeu
  "Matches played": number;
  "Minutes played": number;
  
  // Métriques offensives
  Goals?: number;
  xG?: number;
  "xG per 90"?: number;
  "Non-penalty goals"?: number;
  "Non-penalty goals per 90"?: number;
  Assists?: number;
  xA?: number;
  "xA per 90"?: number;
  "Shots per 90"?: number;
  "Shots on target, %"?: number;
  "Touches in box per 90"?: number;
  
  // Métriques de création
  "Key passes per 90"?: number;
  "Shot assists per 90"?: number;
  "Deep completions per 90"?: number;
  "Progressive passes per 90"?: number;
  "Passes to final third per 90"?: number;
  "Accurate crosses, %"?: number;
  
  // Métriques défensives
  "Successful defensive actions per 90"?: number;
  "Defensive duels won, %"?: number;
  "Aerial duels won, %"?: number;
  "PAdj Interceptions"?: number;
  "PAdj Sliding tackles"?: number;
  "Shots blocked per 90"?: number;
  
  // Métriques de dribble/possession
  "Dribbles per 90"?: number;
  "Successful dribbles, %"?: number;
  "Progressive runs per 90"?: number;
  "Offensive duels won, %"?: number;
  
  // Métriques de passe
  "Passes per 90"?: number;
  "Accurate passes, %"?: number;
  "Accurate long passes, %"?: number;
  "Accurate short / medium passes, %"?: number;
  
  // Métriques de duel
  "Duels won, %"?: number;
  "Duels per 90"?: number;
  
  // Métriques de gardien
  "Prevented goals per 90"?: number;
  "Save rate, %"?: number;
  "Exits per 90"?: number;
  "Clean sheets"?: number;
  
  // Métriques avancées
  "Successful attacking actions per 90"?: number;
}

/**
 * Interface pour un joueur avec score calculé
 */
export interface ScoredPlayer extends PlayerData {
  roleScore: number;
  percentile?: number;
}

/**
 * Interface pour les résultats de recherche de joueurs similaires
 */
export interface SimilarityResult {
  player: PlayerData;
  score: number;
  distance: number;
  matchedMetrics: number;
  breakdown?: Record<string, number>;
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
  team: string;
  squad_id?: string;
  league: string;
  season: string;
  
  // Gardien
  keeper_clean_sheet_pct?: number;
  keeper_clean_sheets?: number;
  keeper_goals_against?: number;
  keeper_goals_against_p90?: number;
  keeper_save_pct?: number;
  keeper_saves?: number;
  
  // Standard
  standard_goals?: number;
  standard_goals_p90?: number;
  standard_assists?: number;
  standard_assists_p90?: number;
  standard_xg?: number;
  standard_xg_p90?: number;
  standard_npxg?: number;
  standard_npxg_p90?: number;
  standard_xag?: number;
  standard_xag_p90?: number;
  
  // Possession
  possession_Poss?: number;
  possession_touches?: number;
  possession_carries?: number;
  possession_prog_carries?: number;
  
  // Passes
  passing_pass_completion_pct?: number;
  passing_passes_attempted?: number;
  passing_prog_pass_distance?: number;
  
  // Défense
  defense_tackles?: number;
  defense_tackles_won?: number;
  defense_Clr?: number;
  defense_Int?: number;
  
  // Tir
  shooting_goals?: number;
  shooting_shots?: number;
  shooting_shots_on_target?: number;
  shooting_xg?: number;
  
  [key: string]: string | number | undefined;
}

/**
 * Profil tactique d'une équipe
 */
export interface TeamTacticalProfile {
  team: string;
  league: string;
  style: 'possession' | 'direct' | 'counter' | 'pressing' | 'balanced';
  metrics: {
    label: string;
    value: number;
    percentile: number;
    leagueAvg: number;
  }[];
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
  X: number;
  Y: number;
  xG: number;
  player: string;
  team: string;
  h_a: 'h' | 'a';
  situation: ShotSituation;
  lastAction: string;
  shotType: ShotType;
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

/**
 * Groupe de métriques pour l'affichage
 */
export interface MetricGroup {
  name: string;
  category?: string;
  keys: string[];
  icon?: string;
}

/**
 * Résultat d'analyse de percentile
 */
export interface PercentileAnalysis {
  metric: string;
  value: number;
  percentile: number;
  zScore: number;
  cohortMean: number;
  cohortStdDev: number;
  cohortSize: number;
  rank: number;
}

// ============================================
// FILTER & SEARCH TYPES
// ============================================

/**
 * Filtres de recherche de joueurs
 */
export interface PlayerFilters {
  search?: string;
  team?: string;
  league?: string;
  position?: string;
  nationality?: string;
  ageMin?: number;
  ageMax?: number;
  marketValueMin?: number;
  marketValueMax?: number;
  minutesMin?: number;
  season?: string;
}

/**
 * Options de tri
 */
export interface SortOptions {
  field: string;
  direction: 'asc' | 'desc';
}

/**
 * Options de pagination
 */
export interface PaginationOptions {
  page: number;
  pageSize: number;
}

/**
 * Résultat paginé
 */
export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

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
  PROSPECTS = 'PROSPECTS'
}

/**
 * Mode de comparaison pour les graphiques
 */
export type ComparisonMode = 'all' | 'position' | 'team' | 'league';

// ============================================
// REPORT & EXPORT TYPES
// ============================================

/**
 * Configuration du rapport de scout
 */
export interface ScoutReportConfig {
  includeRadar: boolean;
  includeShotMap: boolean;
  includeComparison: boolean;
  includeAIAnalysis: boolean;
  comparisonMode: ComparisonMode;
  metrics: string[];
}

/**
 * Rapport de scout généré
 */
export interface ScoutReport {
  player: PlayerData;
  generatedAt: string;
  aiAnalysis?: string;
  percentileProfile: PlayerPercentileProfile;
  bestRoles: RoleScoreResult[];
  similarPlayers: SimilarityResult[];
  config: ScoutReportConfig;
}

// ============================================
// DATA STORE TYPES
// ============================================

/**
 * État global des données
 */
export interface DataStoreState {
  players: PlayerData[];
  teams: TeamStats[];
  shots: ShotEvent[];
  isLoading: boolean;
  errors: string[];
  lastUpdated: string | null;
}

/**
 * Statistiques de dataset
 */
export interface DatasetStats {
  playerCount: number;
  teamCount: number;
  shotCount: number;
  leagues: string[];
  seasons: string[];
  positions: string[];
  countries: string[];
  metricCount: number;
}

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
 * Configuration de clustering
 */
export interface ClusterConfig {
  k: number;
  maxIterations: number;
  metrics: string[];
}

/**
 * Résultat de clustering
 */
export interface ClusterResult {
  clusterId: number;
  centroid: number[];
  players: PlayerData[];
  size: number;
  label?: string;
}

/**
 * Cache pour les calculs coûteux
 */
export interface ComputationCache<T> {
  key: string;
  value: T;
  timestamp: number;
  expiresAt: number;
}
