/**
 * ScoutVision AI - Data Store
 * Store centralisé pour la gestion de l'état des données
 */

import { 
  PlayerData, 
  TeamStats, 
  ShotEvent, 
  DataStoreState,
  DatasetStats,
  PlayerFilters,
  SortOptions
} from '../types';
import { 
  filterPlayers, 
  sortPlayers, 
  extractLeagues,
  extractTeams,
  extractPositions,
  extractNationalities,
  extractNumericMetricKeys,
  calculateAllMetricBounds
} from './playerService';
import { MetricBounds } from '../types';

// ============================================
// STORE STATE
// ============================================

/**
 * État global du store
 */
let state: DataStoreState = {
  players: [],
  teams: [],
  shots: [],
  isLoading: false,
  errors: [],
  lastUpdated: null
};

/**
 * Cache des calculs coûteux
 */
let computedCache: {
  leagues: string[] | null;
  teams: string[] | null;
  positions: string[] | null;
  nationalities: string[] | null;
  metricKeys: string[] | null;
  metricBounds: Record<string, MetricBounds> | null;
  datasetStats: DatasetStats | null;
} = {
  leagues: null,
  teams: null,
  positions: null,
  nationalities: null,
  metricKeys: null,
  metricBounds: null,
  datasetStats: null
};

/**
 * Listeners pour les changements d'état
 */
type StateListener = (state: DataStoreState) => void;
const listeners: Set<StateListener> = new Set();

// ============================================
// STORE ACTIONS
// ============================================

/**
 * Charge les données des joueurs
 */
export function setPlayers(players: PlayerData[]): void {
  state = {
    ...state,
    players,
    lastUpdated: new Date().toISOString()
  };
  invalidateCache();
  notifyListeners();
}

/**
 * Charge les statistiques d'équipes
 */
export function setTeams(teams: TeamStats[]): void {
  state = {
    ...state,
    teams,
    lastUpdated: new Date().toISOString()
  };
  notifyListeners();
}

/**
 * Charge les événements de tir
 */
export function setShots(shots: ShotEvent[]): void {
  state = {
    ...state,
    shots,
    lastUpdated: new Date().toISOString()
  };
  notifyListeners();
}

/**
 * Définit l'état de chargement
 */
export function setLoading(isLoading: boolean): void {
  state = { ...state, isLoading };
  notifyListeners();
}

/**
 * Ajoute une erreur
 */
export function addError(error: string): void {
  state = {
    ...state,
    errors: [...state.errors, error]
  };
  notifyListeners();
}

/**
 * Efface les erreurs
 */
export function clearErrors(): void {
  state = { ...state, errors: [] };
  notifyListeners();
}

/**
 * Réinitialise le store
 */
export function resetStore(): void {
  state = {
    players: [],
    teams: [],
    shots: [],
    isLoading: false,
    errors: [],
    lastUpdated: null
  };
  invalidateCache();
  notifyListeners();
}

// ============================================
// STORE GETTERS
// ============================================

/**
 * Retourne l'état complet
 */
export function getState(): DataStoreState {
  return state;
}

/**
 * Retourne tous les joueurs
 */
export function getPlayers(): PlayerData[] {
  return state.players;
}

/**
 * Retourne les joueurs filtrés
 */
export function getFilteredPlayers(filters: PlayerFilters): PlayerData[] {
  return filterPlayers(state.players, filters);
}

/**
 * Retourne les joueurs filtrés et triés
 */
export function getFilteredAndSortedPlayers(
  filters: PlayerFilters,
  sort: SortOptions
): PlayerData[] {
  const filtered = filterPlayers(state.players, filters);
  return sortPlayers(filtered, sort);
}

/**
 * Retourne un joueur par son nom
 */
export function getPlayerByName(name: string): PlayerData | undefined {
  return state.players.find(p => p.Player === name);
}

/**
 * Retourne les joueurs d'une équipe
 */
export function getPlayersByTeam(team: string): PlayerData[] {
  return state.players.filter(p => p.Team === team);
}

/**
 * Retourne les statistiques d'équipes
 */
export function getTeamStats(): TeamStats[] {
  return state.teams;
}

/**
 * Retourne les stats d'une équipe spécifique
 */
export function getTeamStatsByName(teamName: string): TeamStats | undefined {
  return state.teams.find(t => t.team === teamName);
}

/**
 * Retourne les événements de tir
 */
export function getShots(): ShotEvent[] {
  return state.shots;
}

/**
 * Retourne les tirs d'un joueur
 */
export function getShotsByPlayer(playerName: string): ShotEvent[] {
  return state.shots.filter(s => s.player === playerName);
}

/**
 * Retourne les tirs d'une équipe
 */
export function getShotsByTeam(teamName: string): ShotEvent[] {
  return state.shots.filter(s => s.team === teamName);
}

// ============================================
// COMPUTED GETTERS (avec cache)
// ============================================

/**
 * Retourne les ligues disponibles (cached)
 */
export function getLeagues(): string[] {
  if (!computedCache.leagues) {
    computedCache.leagues = extractLeagues(state.players);
  }
  return computedCache.leagues;
}

/**
 * Retourne les équipes disponibles (cached)
 */
export function getTeams(): string[] {
  if (!computedCache.teams) {
    // Combiner joueurs et stats d'équipes
    const playerTeams = extractTeams(state.players);
    const statsTeams = state.teams.map(t => t.team);
    const allTeams = new Set([...playerTeams, ...statsTeams]);
    computedCache.teams = Array.from(allTeams).sort();
  }
  return computedCache.teams;
}

/**
 * Retourne les positions disponibles (cached)
 */
export function getPositions(): string[] {
  if (!computedCache.positions) {
    computedCache.positions = extractPositions(state.players);
  }
  return computedCache.positions;
}

/**
 * Retourne les nationalités disponibles (cached)
 */
export function getNationalities(): string[] {
  if (!computedCache.nationalities) {
    computedCache.nationalities = extractNationalities(state.players);
  }
  return computedCache.nationalities;
}

/**
 * Retourne les clés de métriques numériques (cached)
 */
export function getMetricKeys(): string[] {
  if (!computedCache.metricKeys) {
    computedCache.metricKeys = extractNumericMetricKeys(state.players);
  }
  return computedCache.metricKeys;
}

/**
 * Retourne les bornes de toutes les métriques (cached)
 */
export function getMetricBounds(): Record<string, MetricBounds> {
  if (!computedCache.metricBounds) {
    computedCache.metricBounds = calculateAllMetricBounds(state.players);
  }
  return computedCache.metricBounds;
}

/**
 * Retourne les statistiques du dataset (cached)
 */
export function getDatasetStats(): DatasetStats {
  if (!computedCache.datasetStats) {
    computedCache.datasetStats = {
      playerCount: state.players.length,
      teamCount: getTeams().length,
      shotCount: state.shots.length,
      leagues: getLeagues(),
      seasons: extractSeasons(),
      positions: getPositions(),
      countries: getNationalities(),
      metricCount: getMetricKeys().length
    };
  }
  return computedCache.datasetStats;
}

/**
 * Extrait les saisons uniques
 */
function extractSeasons(): string[] {
  const seasons = new Set<string>();
  
  // Depuis les joueurs
  state.players.forEach(p => {
    const league = p.League || '';
    const match = league.match(/(\d{4}-\d{2}|\d{2}-\d{2})/);
    if (match) seasons.add(match[1]);
  });
  
  // Depuis les stats d'équipes
  state.teams.forEach(t => {
    if (t.season) seasons.add(t.season);
  });
  
  return Array.from(seasons).sort().reverse();
}

// ============================================
// SEASON FILTERING
// ============================================

/**
 * Filtre les données par saison
 */
export function getDataForSeason(season: string): {
  players: PlayerData[];
  teams: TeamStats[];
  shots: ShotEvent[];
} {
  if (season === 'All') {
    return {
      players: state.players,
      teams: state.teams,
      shots: state.shots
    };
  }

  const players = state.players.filter(p => {
    const league = p.League || '';
    
    // Pattern: "24-25" matches "2024-25" or "24-25"
    if (season === '24-25') {
      return league.includes('2024-25') || 
             (league.endsWith(' 2024') && !league.includes('2024-25'));
    }
    if (season === '25-26') {
      return league.includes('2025-26') || 
             (league.endsWith(' 2025') && !league.includes('2025-26'));
    }
    
    return league.includes(season);
  });

  const teams = state.teams.filter(t => {
    if (!t.season) return true;
    return t.season === season || t.season.includes(season);
  });

  const shots = state.shots.filter(s => {
    if (!s.season) return true;
    return s.season === season || s.season.includes(season);
  });

  return { players, teams, shots };
}

// ============================================
// SUBSCRIPTIONS
// ============================================

/**
 * S'abonner aux changements d'état
 */
export function subscribe(listener: StateListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Notifie tous les listeners
 */
function notifyListeners(): void {
  listeners.forEach(listener => listener(state));
}

/**
 * Invalide le cache calculé
 */
function invalidateCache(): void {
  computedCache = {
    leagues: null,
    teams: null,
    positions: null,
    nationalities: null,
    metricKeys: null,
    metricBounds: null,
    datasetStats: null
  };
}

// ============================================
// PERSISTENCE (LocalStorage)
// ============================================

const STORAGE_KEY = 'scoutvision_data';

/**
 * Sauvegarde l'état dans localStorage
 */
export function persistState(): void {
  try {
    const dataToSave = {
      players: state.players,
      teams: state.teams,
      shots: state.shots,
      lastUpdated: state.lastUpdated
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(dataToSave));
  } catch (error) {
    console.warn('Failed to persist state:', error);
  }
}

/**
 * Charge l'état depuis localStorage
 */
export function loadPersistedState(): boolean {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      state = {
        players: parsed.players || [],
        teams: parsed.teams || [],
        shots: parsed.shots || [],
        isLoading: false,
        errors: [],
        lastUpdated: parsed.lastUpdated || null
      };
      invalidateCache();
      notifyListeners();
      return true;
    }
  } catch (error) {
    console.warn('Failed to load persisted state:', error);
  }
  return false;
}

/**
 * Efface les données persistées
 */
export function clearPersistedState(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.warn('Failed to clear persisted state:', error);
  }
}

// ============================================
// STATISTICS HELPERS
// ============================================

/**
 * Retourne un résumé rapide des données
 */
export function getQuickStats(): {
  totalPlayers: number;
  totalTeams: number;
  totalShots: number;
  topLeague: string;
  avgAge: number;
} {
  const players = state.players;
  
  // Ligue avec le plus de joueurs
  const leagueCounts: Record<string, number> = {};
  players.forEach(p => {
    const league = p.League || 'Unknown';
    leagueCounts[league] = (leagueCounts[league] || 0) + 1;
  });
  const topLeague = Object.entries(leagueCounts)
    .sort((a, b) => b[1] - a[1])[0]?.[0] || 'N/A';
  
  // Âge moyen
  const ages = players.map(p => Number(p.Age)).filter(a => a > 0);
  const avgAge = ages.length > 0 
    ? ages.reduce((a, b) => a + b, 0) / ages.length 
    : 0;

  return {
    totalPlayers: players.length,
    totalTeams: getTeams().length,
    totalShots: state.shots.length,
    topLeague,
    avgAge: Number(avgAge.toFixed(1))
  };
}

/**
 * Vérifie si des données sont chargées
 */
export function hasData(): boolean {
  return state.players.length > 0 || 
         state.teams.length > 0 || 
         state.shots.length > 0;
}

/**
 * Retourne la date de dernière mise à jour
 */
export function getLastUpdated(): string | null {
  return state.lastUpdated;
}
