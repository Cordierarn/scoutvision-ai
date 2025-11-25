/**
 * ScoutVision AI - Player Service
 * Service centralisé pour la gestion des données joueurs
 */

import { 
  PlayerData, 
  PlayerFilters, 
  SortOptions, 
  PaginationOptions, 
  PaginatedResult,
  MetricBounds,
  DatasetStats
} from '../types';

// ============================================
// CONSTANTS
// ============================================

/**
 * Clés à exclure des calculs statistiques
 */
export const EXCLUDED_METRIC_KEYS = [
  'Player', 'Team', 'Team within selected timeframe', 'Position', 
  'Birth country', 'Passport country', 'Foot', 'On loan', 'League', 
  'Contract expires', 'Main Position', 'Index'
];

/**
 * Clés de profil (pas des métriques de performance)
 */
export const PROFILE_KEYS = [
  'Age', 'Market value', 'Height', 'Weight', 
  'Matches played', 'Minutes played'
];

/**
 * Minutes minimum pour être considéré comme joueur régulier
 */
export const MIN_MINUTES_THRESHOLD = 450; // ~5 matchs

// ============================================
// DATA EXTRACTION
// ============================================

/**
 * Extrait toutes les clés numériques du dataset (métriques de performance)
 */
export function extractNumericMetricKeys(data: PlayerData[]): string[] {
  if (data.length === 0) return [];
  
  const sample = data[0];
  return Object.keys(sample).filter(key => 
    typeof sample[key] === 'number' && 
    !EXCLUDED_METRIC_KEYS.includes(key) &&
    !PROFILE_KEYS.includes(key)
  ).sort();
}

/**
 * Extrait les ligues uniques
 */
export function extractLeagues(data: PlayerData[]): string[] {
  const leagues = new Set(data.map(p => p.League).filter(Boolean));
  return Array.from(leagues).sort();
}

/**
 * Extrait les équipes uniques
 */
export function extractTeams(data: PlayerData[]): string[] {
  const teams = new Set(data.map(p => p.Team).filter(Boolean));
  return Array.from(teams).sort();
}

/**
 * Extrait les positions uniques
 */
export function extractPositions(data: PlayerData[]): string[] {
  const positions = new Set<string>();
  data.forEach(p => {
    if (p.Position) {
      p.Position.split(',').forEach(pos => {
        positions.add(pos.trim());
      });
    }
  });
  return Array.from(positions).sort();
}

/**
 * Extrait les nationalités uniques
 */
export function extractNationalities(data: PlayerData[]): string[] {
  const nations = new Set<string>();
  data.forEach(p => {
    const country = p['Passport country'] || p['Birth country'];
    if (country && typeof country === 'string') {
      nations.add(country);
    }
  });
  return Array.from(nations).sort();
}

/**
 * Génère les statistiques du dataset
 */
export function getDatasetStats(data: PlayerData[]): DatasetStats {
  return {
    playerCount: data.length,
    teamCount: extractTeams(data).length,
    shotCount: 0, // À remplir depuis shotEvents
    leagues: extractLeagues(data),
    seasons: extractSeasons(data),
    positions: extractPositions(data),
    countries: extractNationalities(data),
    metricCount: extractNumericMetricKeys(data).length
  };
}

/**
 * Extrait les saisons du dataset
 */
export function extractSeasons(data: PlayerData[]): string[] {
  const seasons = new Set<string>();
  data.forEach(p => {
    const league = p.League || '';
    // Patterns: "2024-25", "2024", "24-25"
    const match = league.match(/(\d{4}-\d{2}|\d{4}|\d{2}-\d{2})/);
    if (match) {
      seasons.add(match[1]);
    }
  });
  return Array.from(seasons).sort().reverse();
}

// ============================================
// FILTERING & SEARCH
// ============================================

/**
 * Filtre les joueurs selon les critères donnés
 */
export function filterPlayers(
  data: PlayerData[], 
  filters: PlayerFilters
): PlayerData[] {
  return data.filter(player => {
    // Recherche textuelle
    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      const matchesSearch = 
        player.Player?.toLowerCase().includes(searchLower) ||
        player.Team?.toLowerCase().includes(searchLower) ||
        player.Position?.toLowerCase().includes(searchLower);
      if (!matchesSearch) return false;
    }

    // Filtre par équipe
    if (filters.team && player.Team !== filters.team) {
      return false;
    }

    // Filtre par ligue
    if (filters.league && !player.League?.includes(filters.league)) {
      return false;
    }

    // Filtre par position
    if (filters.position) {
      const playerPositions = player.Position?.split(',').map(p => p.trim()) || [];
      if (!playerPositions.includes(filters.position)) {
        return false;
      }
    }

    // Filtre par nationalité
    if (filters.nationality) {
      const country = player['Passport country'] || player['Birth country'];
      if (country !== filters.nationality) {
        return false;
      }
    }

    // Filtre par âge
    const age = Number(player.Age) || 0;
    if (filters.ageMin !== undefined && age < filters.ageMin) return false;
    if (filters.ageMax !== undefined && age > filters.ageMax) return false;

    // Filtre par valeur marchande
    const marketValue = Number(player['Market value']) || 0;
    if (filters.marketValueMin !== undefined && marketValue < filters.marketValueMin) return false;
    if (filters.marketValueMax !== undefined && marketValue > filters.marketValueMax) return false;

    // Filtre par minutes jouées
    const minutes = Number(player['Minutes played']) || 0;
    if (filters.minutesMin !== undefined && minutes < filters.minutesMin) return false;

    // Filtre par saison
    if (filters.season && filters.season !== 'All') {
      const league = player.League || '';
      if (!league.includes(filters.season)) return false;
    }

    return true;
  });
}

/**
 * Trie les joueurs selon les options données
 */
export function sortPlayers(
  data: PlayerData[], 
  options: SortOptions
): PlayerData[] {
  const sorted = [...data];
  
  sorted.sort((a, b) => {
    const valA = a[options.field];
    const valB = b[options.field];

    // Gestion des valeurs nulles/undefined
    if (valA === undefined || valA === null) return 1;
    if (valB === undefined || valB === null) return -1;

    // Comparaison numérique ou string
    let comparison: number;
    if (typeof valA === 'number' && typeof valB === 'number') {
      comparison = valA - valB;
    } else {
      comparison = String(valA).localeCompare(String(valB));
    }

    return options.direction === 'desc' ? -comparison : comparison;
  });

  return sorted;
}

/**
 * Applique la pagination aux données
 */
export function paginatePlayers(
  data: PlayerData[], 
  options: PaginationOptions
): PaginatedResult<PlayerData> {
  const { page, pageSize } = options;
  const total = data.length;
  const totalPages = Math.ceil(total / pageSize);
  const startIndex = (page - 1) * pageSize;
  const endIndex = startIndex + pageSize;

  return {
    data: data.slice(startIndex, endIndex),
    total,
    page,
    pageSize,
    totalPages
  };
}

/**
 * Pipeline complet: filtre -> trie -> pagine
 */
export function queryPlayers(
  data: PlayerData[],
  filters?: PlayerFilters,
  sort?: SortOptions,
  pagination?: PaginationOptions
): PaginatedResult<PlayerData> {
  let result = data;

  // Filtrer
  if (filters) {
    result = filterPlayers(result, filters);
  }

  // Trier
  if (sort) {
    result = sortPlayers(result, sort);
  }

  // Paginer
  if (pagination) {
    return paginatePlayers(result, pagination);
  }

  return {
    data: result,
    total: result.length,
    page: 1,
    pageSize: result.length,
    totalPages: 1
  };
}

// ============================================
// STATISTICAL UTILITIES
// ============================================

/**
 * Calcule les bornes (min, max, mean, stdDev) pour une métrique
 */
export function calculateMetricBounds(
  data: PlayerData[], 
  metricKey: string
): MetricBounds {
  const values = data
    .map(p => Number(p[metricKey]))
    .filter(v => !isNaN(v) && isFinite(v));

  if (values.length === 0) {
    return { min: 0, max: 1, mean: 0, stdDev: 1 };
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  
  const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
  const variance = squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
  const stdDev = Math.sqrt(variance) || 1;

  return { 
    min, 
    max: max === min ? min + 1 : max, 
    mean, 
    stdDev 
  };
}

/**
 * Calcule les bornes pour toutes les métriques numériques
 */
export function calculateAllMetricBounds(
  data: PlayerData[]
): Record<string, MetricBounds> {
  const metricKeys = extractNumericMetricKeys(data);
  const bounds: Record<string, MetricBounds> = {};

  metricKeys.forEach(key => {
    bounds[key] = calculateMetricBounds(data, key);
  });

  return bounds;
}

/**
 * Normalise une valeur entre 0 et 1
 */
export function normalizeValue(
  value: number, 
  bounds: MetricBounds
): number {
  const range = bounds.max - bounds.min;
  if (range === 0) return 0.5;
  return Math.max(0, Math.min(1, (value - bounds.min) / range));
}

/**
 * Calcule le z-score d'une valeur
 */
export function calculateZScore(
  value: number, 
  bounds: MetricBounds
): number {
  if (bounds.stdDev === 0) return 0;
  return (value - bounds.mean) / bounds.stdDev;
}

/**
 * Calcule le percentile d'une valeur dans une distribution
 */
export function calculatePercentile(
  value: number, 
  allValues: number[]
): number {
  if (allValues.length === 0) return 50;
  
  const sorted = [...allValues].sort((a, b) => a - b);
  const countBelow = sorted.filter(v => v < value).length;
  const countEqual = sorted.filter(v => v === value).length;
  
  // Formule du percentile: (below + 0.5 * equal) / total * 100
  const percentile = ((countBelow + 0.5 * countEqual) / sorted.length) * 100;
  return Math.round(Math.max(0, Math.min(100, percentile)));
}

/**
 * Calcule le rang d'une valeur (1 = meilleur)
 */
export function calculateRank(
  value: number, 
  allValues: number[], 
  higherIsBetter: boolean = true
): number {
  const sorted = [...allValues].sort((a, b) => 
    higherIsBetter ? b - a : a - b
  );
  return sorted.indexOf(value) + 1 || sorted.length;
}

// ============================================
// COHORT ANALYSIS
// ============================================

/**
 * Crée une cohorte de joueurs pour comparaison
 */
export function createCohort(
  data: PlayerData[],
  referencePlayer: PlayerData,
  mode: 'all' | 'position' | 'team' | 'league'
): PlayerData[] {
  switch (mode) {
    case 'position':
      const positions = referencePlayer.Position?.split(',').map(p => p.trim()) || [];
      return data.filter(p => {
        const pPositions = p.Position?.split(',').map(pos => pos.trim()) || [];
        return positions.some(pos => pPositions.includes(pos));
      });
    
    case 'team':
      return data.filter(p => p.Team === referencePlayer.Team);
    
    case 'league':
      return data.filter(p => p.League === referencePlayer.League);
    
    default:
      return data;
  }
}

/**
 * Calcule les percentiles d'un joueur par rapport à une cohorte
 */
export function calculatePlayerPercentiles(
  player: PlayerData,
  cohort: PlayerData[],
  metricKeys?: string[]
): Record<string, number> {
  const keys = metricKeys || extractNumericMetricKeys(cohort);
  const percentiles: Record<string, number> = {};

  keys.forEach(key => {
    const playerValue = Number(player[key]) || 0;
    const cohortValues = cohort.map(p => Number(p[key]) || 0);
    percentiles[key] = calculatePercentile(playerValue, cohortValues);
  });

  return percentiles;
}

// ============================================
// AGGREGATION
// ============================================

/**
 * Agrège les statistiques par équipe
 */
export function aggregateByTeam(
  data: PlayerData[]
): Record<string, { players: PlayerData[]; avgAge: number; totalGoals: number }> {
  const teams: Record<string, PlayerData[]> = {};

  data.forEach(player => {
    const team = player.Team;
    if (!teams[team]) {
      teams[team] = [];
    }
    teams[team].push(player);
  });

  const result: Record<string, { players: PlayerData[]; avgAge: number; totalGoals: number }> = {};

  Object.entries(teams).forEach(([team, players]) => {
    const ages = players.map(p => Number(p.Age) || 0).filter(a => a > 0);
    const goals = players.reduce((sum, p) => sum + (Number(p.Goals) || 0), 0);
    
    result[team] = {
      players,
      avgAge: ages.length > 0 ? ages.reduce((a, b) => a + b, 0) / ages.length : 0,
      totalGoals: goals
    };
  });

  return result;
}

/**
 * Agrège les statistiques par position
 */
export function aggregateByPosition(
  data: PlayerData[]
): Record<string, PlayerData[]> {
  const positions: Record<string, PlayerData[]> = {};

  data.forEach(player => {
    const positionList = player.Position?.split(',').map(p => p.trim()) || ['Unknown'];
    positionList.forEach(pos => {
      if (!positions[pos]) {
        positions[pos] = [];
      }
      positions[pos].push(player);
    });
  });

  return positions;
}

/**
 * Calcule les moyennes de toutes les métriques pour un groupe
 */
export function calculateGroupAverages(
  players: PlayerData[]
): Record<string, number> {
  if (players.length === 0) return {};

  const metricKeys = extractNumericMetricKeys(players);
  const averages: Record<string, number> = {};

  metricKeys.forEach(key => {
    const values = players
      .map(p => Number(p[key]))
      .filter(v => !isNaN(v) && isFinite(v));
    
    if (values.length > 0) {
      averages[key] = values.reduce((a, b) => a + b, 0) / values.length;
    }
  });

  return averages;
}

// ============================================
// VALIDATION
// ============================================

/**
 * Valide les données d'un joueur
 */
export function validatePlayerData(player: any): { 
  isValid: boolean; 
  errors: string[] 
} {
  const errors: string[] = [];

  if (!player.Player || typeof player.Player !== 'string') {
    errors.push('Missing or invalid Player name');
  }

  if (!player.Team || typeof player.Team !== 'string') {
    errors.push('Missing or invalid Team');
  }

  if (!player.Position || typeof player.Position !== 'string') {
    errors.push('Missing or invalid Position');
  }

  const age = Number(player.Age);
  if (isNaN(age) || age < 15 || age > 50) {
    errors.push('Invalid Age (should be between 15-50)');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Filtre les joueurs avec suffisamment de minutes
 */
export function filterByMinutes(
  data: PlayerData[], 
  minMinutes: number = MIN_MINUTES_THRESHOLD
): PlayerData[] {
  return data.filter(p => (Number(p['Minutes played']) || 0) >= minMinutes);
}

// ============================================
// EXPORT
// ============================================

/**
 * Exporte les données en format CSV
 */
export function exportToCSV(data: PlayerData[]): string {
  if (data.length === 0) return '';

  const headers = Object.keys(data[0]);
  const rows = data.map(player => 
    headers.map(header => {
      const value = player[header];
      // Escape quotes and wrap in quotes if contains comma
      if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
        return `"${value.replace(/"/g, '""')}"`;
      }
      return value ?? '';
    }).join(',')
  );

  return [headers.join(','), ...rows].join('\n');
}

/**
 * Exporte les données en format JSON
 */
export function exportToJSON(data: PlayerData[]): string {
  return JSON.stringify(data, null, 2);
}
