/**
 * ScoutVision AI - Optimized Query Service
 * Service optimisé avec cache et index pour des requêtes rapides
 */

import { PlayerData, TeamStats, ShotEvent } from '../types';

// ============================================
// TYPES
// ============================================

interface TeamIndex {
  players: PlayerData[];
  shots: ShotEvent[];
  stats: TeamStats | null;
}

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

// ============================================
// OPTIMIZED QUERY SERVICE
// ============================================

class OptimizedQueryService {
  // Index pré-calculés
  private teamIndex: Map<string, TeamIndex> = new Map();
  private leagueIndex: Map<string, Set<string>> = new Map();
  private positionIndex: Map<string, PlayerData[]> = new Map();
  
  // Cache avec TTL
  private cache: Map<string, CacheEntry<any>> = new Map();
  private readonly CACHE_TTL = 60000; // 1 minute
  
  // Données sources
  private allPlayers: PlayerData[] = [];
  private allTeams: TeamStats[] = [];
  private allShots: ShotEvent[] = [];
  
  // Liste des équipes triées (calculée une fois)
  private sortedTeamNames: string[] = [];
  
  private isInitialized = false;

  /**
   * Initialise les index avec les données
   */
  initialize(players: PlayerData[], teams: TeamStats[], shots: ShotEvent[]): void {
    console.log('⚡ Building optimized indexes...');
    const start = performance.now();
    
    this.allPlayers = players;
    this.allTeams = teams;
    this.allShots = shots;
    
    // Construire l'index par équipe
    this.buildTeamIndex();
    
    // Construire l'index par ligue
    this.buildLeagueIndex();
    
    // Construire l'index par position
    this.buildPositionIndex();
    
    // Liste des équipes triées
    this.sortedTeamNames = Array.from(this.teamIndex.keys()).sort();
    
    this.isInitialized = true;
    
    console.log(`⚡ Indexes built in ${Math.round(performance.now() - start)}ms`);
    console.log(`   - ${this.teamIndex.size} teams indexed`);
    console.log(`   - ${this.leagueIndex.size} leagues indexed`);
    console.log(`   - ${this.positionIndex.size} positions indexed`);
  }

  private buildTeamIndex(): void {
    this.teamIndex.clear();
    
    // Index des joueurs par équipe
    this.allPlayers.forEach(player => {
      const teamName = player.Team;
      if (!teamName || typeof teamName !== 'string' || teamName.trim() === '') return;
      
      if (!this.teamIndex.has(teamName)) {
        this.teamIndex.set(teamName, { players: [], shots: [], stats: null });
      }
      this.teamIndex.get(teamName)!.players.push(player);
    });
    
    // Index des tirs par équipe
    this.allShots.forEach(shot => {
      const teamName = shot.team;
      if (!teamName || typeof teamName !== 'string') return;
      
      if (!this.teamIndex.has(teamName)) {
        this.teamIndex.set(teamName, { players: [], shots: [], stats: null });
      }
      this.teamIndex.get(teamName)!.shots.push(shot);
    });
    
    // Stats d'équipe
    this.allTeams.forEach(ts => {
      const teamName = ts.team;
      if (!teamName || typeof teamName !== 'string') return;
      
      if (!this.teamIndex.has(teamName)) {
        this.teamIndex.set(teamName, { players: [], shots: [], stats: null });
      }
      this.teamIndex.get(teamName)!.stats = ts;
    });
  }

  private buildLeagueIndex(): void {
    this.leagueIndex.clear();
    
    this.allPlayers.forEach(player => {
      const league = player.League;
      if (!league || typeof league !== 'string' || league.trim() === '') return;
      
      if (!this.leagueIndex.has(league)) {
        this.leagueIndex.set(league, new Set());
      }
      if (player.Team) {
        this.leagueIndex.get(league)!.add(player.Team);
      }
    });
  }

  private buildPositionIndex(): void {
    this.positionIndex.clear();
    
    this.allPlayers.forEach(player => {
      const position = player.Position;
      if (!position || typeof position !== 'string' || position.trim() === '') return;
      
      if (!this.positionIndex.has(position)) {
        this.positionIndex.set(position, []);
      }
      this.positionIndex.get(position)!.push(player);
    });
  }

  // ============================================
  // FAST QUERIES
  // ============================================

  /**
   * Récupère les équipes disponibles (très rapide)
   */
  getAvailableTeams(): string[] {
    return this.sortedTeamNames;
  }

  /**
   * Récupère les ligues disponibles
   */
  getAvailableLeagues(): string[] {
    return Array.from(this.leagueIndex.keys()).sort();
  }

  /**
   * Récupère les positions disponibles
   */
  getAvailablePositions(): string[] {
    return Array.from(this.positionIndex.keys()).sort();
  }

  /**
   * Filtre les équipes par recherche (optimisé)
   */
  searchTeams(query: string, limit: number = 15): string[] {
    if (!query) return this.sortedTeamNames.slice(0, limit);
    
    const lower = query.toLowerCase();
    const results: string[] = [];
    
    for (const team of this.sortedTeamNames) {
      if (team.toLowerCase().includes(lower)) {
        results.push(team);
        if (results.length >= limit) break;
      }
    }
    
    return results;
  }

  /**
   * Récupère les joueurs d'une équipe (O(1) avec index)
   */
  getTeamPlayers(teamName: string): PlayerData[] {
    const teamData = this.teamIndex.get(teamName);
    return teamData?.players || [];
  }

  /**
   * Récupère les tirs d'une équipe (O(1) avec index)
   */
  getTeamShots(teamName: string): ShotEvent[] {
    const teamData = this.teamIndex.get(teamName);
    return teamData?.shots || [];
  }

  /**
   * Récupère les stats d'une équipe (O(1) avec index)
   */
  getTeamStats(teamName: string): TeamStats | null {
    const teamData = this.teamIndex.get(teamName);
    return teamData?.stats || null;
  }

  /**
   * Récupère les joueurs par position (O(1) avec index)
   */
  getPlayersByPosition(position: string): PlayerData[] {
    return this.positionIndex.get(position) || [];
  }

  /**
   * Récupère les équipes d'une ligue
   */
  getTeamsByLeague(league: string): string[] {
    const teams = this.leagueIndex.get(league);
    return teams ? Array.from(teams).sort() : [];
  }

  /**
   * Recherche de joueurs optimisée avec limite
   */
  searchPlayers(query: string, options?: {
    team?: string;
    position?: string;
    league?: string;
    limit?: number;
  }): PlayerData[] {
    const limit = options?.limit || 50;
    const lower = (query || '').toLowerCase();
    const results: PlayerData[] = [];
    
    // Si on a une équipe, utiliser l'index
    const sourceData = options?.team 
      ? this.getTeamPlayers(options.team)
      : this.allPlayers;
    
    for (const player of sourceData) {
      // Filtre position
      if (options?.position && player.Position !== options.position) continue;
      
      // Filtre recherche
      if (query) {
        const playerName = typeof player.Player === 'string' ? player.Player.toLowerCase() : '';
        const teamName = typeof player.Team === 'string' ? player.Team.toLowerCase() : '';
        if (!playerName.includes(lower) && !teamName.includes(lower)) continue;
      }
      
      results.push(player);
      if (results.length >= limit) break;
    }
    
    return results;
  }

  /**
   * Compte les joueurs d'une équipe (rapide)
   */
  getTeamPlayerCount(teamName: string): number {
    const teamData = this.teamIndex.get(teamName);
    return teamData?.players.length || 0;
  }

  /**
   * Calcul des stats agrégées d'équipe (avec cache)
   */
  getTeamAggregatedStats(teamName: string): {
    playerCount: number;
    avgAge: number;
    totalMarketValue: number;
    totalGoals: number;
    totalAssists: number;
    avgXG: number;
    avgXA: number;
    avgXGPer90: number;
    avgXAPer90: number;
    avgPassAccuracy: number;
    avgDefensiveActions: number;
    avgDribbleSuccess: number;
    avgAerialWon: number;
  } {
    const cacheKey = `team_stats_${teamName}`;
    const cached = this.getFromCache<ReturnType<typeof this.getTeamAggregatedStats>>(cacheKey);
    if (cached) return cached;
    
    const players = this.getTeamPlayers(teamName);
    
    if (players.length === 0) {
      return {
        playerCount: 0,
        avgAge: 0,
        totalMarketValue: 0,
        totalGoals: 0,
        totalAssists: 0,
        avgXG: 0,
        avgXA: 0,
        avgXGPer90: 0,
        avgXAPer90: 0,
        avgPassAccuracy: 0,
        avgDefensiveActions: 0,
        avgDribbleSuccess: 0,
        avgAerialWon: 0
      };
    }
    
    let totalAge = 0;
    let totalMarketValue = 0;
    let totalGoals = 0;
    let totalAssists = 0;
    let totalXG = 0;
    let totalXA = 0;
    let totalXGPer90 = 0;
    let totalXAPer90 = 0;
    let totalPassAccuracy = 0;
    let totalDefensiveActions = 0;
    let totalDribbleSuccess = 0;
    let totalAerialWon = 0;
    
    players.forEach(p => {
      totalAge += Number(p.Age) || 0;
      totalMarketValue += Number(p['Market value']) || 0;
      totalGoals += Number(p.Goals) || 0;
      totalAssists += Number(p.Assists) || 0;
      totalXG += Number(p.xG) || 0;
      totalXA += Number(p.xA) || 0;
      totalXGPer90 += Number(p['xG per 90']) || 0;
      totalXAPer90 += Number(p['xA per 90']) || 0;
      totalPassAccuracy += Number(p['Accurate passes, %']) || 0;
      totalDefensiveActions += Number(p['Successful defensive actions per 90']) || 0;
      totalDribbleSuccess += Number(p['Successful dribbles, %']) || 0;
      totalAerialWon += Number(p['Aerial duels won, %']) || 0;
    });
    
    const count = players.length;
    const result = {
      playerCount: count,
      avgAge: Math.round((totalAge / count) * 10) / 10,
      totalMarketValue,
      totalGoals,
      totalAssists,
      avgXG: Math.round((totalXG / count) * 100) / 100,
      avgXA: Math.round((totalXA / count) * 100) / 100,
      avgXGPer90: Math.round((totalXGPer90 / count) * 100) / 100,
      avgXAPer90: Math.round((totalXAPer90 / count) * 100) / 100,
      avgPassAccuracy: Math.round((totalPassAccuracy / count) * 10) / 10,
      avgDefensiveActions: Math.round((totalDefensiveActions / count) * 100) / 100,
      avgDribbleSuccess: Math.round((totalDribbleSuccess / count) * 10) / 10,
      avgAerialWon: Math.round((totalAerialWon / count) * 10) / 10
    };
    
    this.setCache(cacheKey, result);
    return result;
  }

  // ============================================
  // CACHE HELPERS
  // ============================================

  private getFromCache<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    
    if (Date.now() - entry.timestamp > this.CACHE_TTL) {
      this.cache.delete(key);
      return null;
    }
    
    return entry.data as T;
  }

  private setCache<T>(key: string, data: T): void {
    this.cache.set(key, { data, timestamp: Date.now() });
  }

  /**
   * Vide le cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Vérifie si le service est initialisé
   */
  isReady(): boolean {
    return this.isInitialized;
  }
}

// Singleton
export const queryService = new OptimizedQueryService();

export default queryService;
