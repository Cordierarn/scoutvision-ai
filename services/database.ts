/**
 * ScoutVision AI - Database Service
 * Base de données relationnelle en mémoire pour les données CSV
 * 
 * Relations:
 * - Players belongsTo Team
 * - Shots belongsTo Player
 * - Shots belongsTo Team
 * - Teams hasMany Players
 * - Teams hasMany Shots
 * - Players hasMany Shots
 */

import { PlayerData, TeamStats, ShotEvent } from '../types';

// ============================================
// INTERFACES
// ============================================

/**
 * Entité Player normalisée avec ID unique
 */
export interface PlayerEntity {
  id: string;
  name: string;
  teamId: string | null;
  teamName: string;
  position: string;
  league: string;
  age: number;
  height: number;
  weight: number;
  foot: string;
  marketValue: number;
  passportCountry: string;
  birthCountry: string;
  contractExpires: string;
  onLoan: boolean;
  matchesPlayed: number;
  minutesPlayed: number;
  
  // Métriques (stockées séparément pour flexibilité)
  metrics: Record<string, number>;
  
  // Données brutes originales
  rawData: PlayerData;
}

/**
 * Entité Team normalisée avec ID unique
 */
export interface TeamEntity {
  id: string;
  name: string;
  league: string;
  season: string;
  squadId: string;
  
  // Stats agrégées
  stats: Record<string, number>;
  
  // Données brutes originales
  rawData: TeamStats | null;
}

/**
 * Entité Shot normalisée avec références
 */
export interface ShotEntity {
  id: string;
  playerId: string | null;
  playerName: string;
  teamId: string | null;
  teamName: string;
  
  // Coordonnées
  x: number;
  y: number;
  endX: number;
  endY: number;
  
  // Détails du tir
  xg: number;
  result: string;
  situation: string;
  shotType: string;
  bodyPart: string;
  minute: number;
  match: string;
  
  // Données brutes originales
  rawData: ShotEvent;
}

/**
 * Index pour recherche rapide
 */
interface DatabaseIndex<T> {
  byId: Map<string, T>;
  byName: Map<string, T[]>;
  byTeam: Map<string, T[]>;
  byLeague: Map<string, T[]>;
}

// ============================================
// DATABASE CLASS
// ============================================

class ScoutVisionDatabase {
  // Entités
  private players: Map<string, PlayerEntity> = new Map();
  private teams: Map<string, TeamEntity> = new Map();
  private shots: Map<string, ShotEntity> = new Map();
  
  // Index pour recherche rapide
  private playersByTeam: Map<string, Set<string>> = new Map();
  private playersByLeague: Map<string, Set<string>> = new Map();
  private playersByPosition: Map<string, Set<string>> = new Map();
  private shotsByPlayer: Map<string, Set<string>> = new Map();
  private shotsByTeam: Map<string, Set<string>> = new Map();
  
  // Cache de noms normalisés pour le matching
  private normalizedTeamNames: Map<string, string> = new Map();
  private normalizedPlayerNames: Map<string, string> = new Map();
  
  // ============================================
  // INITIALIZATION
  // ============================================
  
  /**
   * Initialise la base de données avec les données CSV parsées
   */
  initialize(
    playerData: PlayerData[],
    teamStats: TeamStats[],
    shotEvents: ShotEvent[]
  ): void {
    console.log('🗄️ Initializing ScoutVision Database...');
    
    // 1. D'abord charger les équipes (pour les références)
    this.loadTeams(teamStats, playerData);
    
    // 2. Ensuite charger les joueurs (avec références aux équipes)
    this.loadPlayers(playerData);
    
    // 3. Enfin charger les tirs (avec références aux joueurs et équipes)
    this.loadShots(shotEvents);
    
    console.log(`✅ Database initialized:`);
    console.log(`   - ${this.teams.size} teams`);
    console.log(`   - ${this.players.size} players`);
    console.log(`   - ${this.shots.size} shots`);
  }
  
  /**
   * Normalise un nom pour le matching
   */
  private normalizeName(name: string): string {
    return name
      .toLowerCase()
      .trim()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // Enlever les accents
      .replace(/[^a-z0-9\s]/g, '') // Enlever les caractères spéciaux
      .replace(/\s+/g, ' '); // Normaliser les espaces
  }
  
  /**
   * Génère un ID unique
   */
  private generateId(prefix: string, name: string, extra: string = ''): string {
    const normalized = this.normalizeName(name + extra);
    return `${prefix}_${normalized.replace(/\s/g, '_')}`;
  }
  
  // ============================================
  // TEAM LOADING
  // ============================================
  
  private loadTeams(teamStats: TeamStats[], playerData: PlayerData[]): void {
    // D'abord depuis teamStats
    teamStats.forEach(ts => {
      if (!ts.team || typeof ts.team !== 'string') return;
      
      const id = this.generateId('team', ts.team, ts.league || '');
      const normalizedName = this.normalizeName(ts.team);
      
      const team: TeamEntity = {
        id,
        name: ts.team,
        league: String(ts.league || ''),
        season: String(ts.season || ''),
        squadId: String(ts.squad_id || ''),
        stats: this.extractTeamStats(ts),
        rawData: ts
      };
      
      this.teams.set(id, team);
      this.normalizedTeamNames.set(normalizedName, id);
    });
    
    // Ensuite ajouter les équipes manquantes depuis playerData
    playerData.forEach(p => {
      if (!p.Team || typeof p.Team !== 'string') return;
      
      const normalizedName = this.normalizeName(p.Team);
      if (this.normalizedTeamNames.has(normalizedName)) return;
      
      const id = this.generateId('team', p.Team, p.League || '');
      
      const team: TeamEntity = {
        id,
        name: p.Team,
        league: String(p.League || ''),
        season: '',
        squadId: '',
        stats: {},
        rawData: null
      };
      
      this.teams.set(id, team);
      this.normalizedTeamNames.set(normalizedName, id);
    });
  }
  
  private extractTeamStats(ts: TeamStats): Record<string, number> {
    const stats: Record<string, number> = {};
    
    Object.entries(ts).forEach(([key, value]) => {
      if (typeof value === 'number' && !isNaN(value)) {
        stats[key] = value;
      }
    });
    
    return stats;
  }
  
  // ============================================
  // PLAYER LOADING
  // ============================================
  
  private loadPlayers(playerData: PlayerData[]): void {
    playerData.forEach(p => {
      if (!p.Player || typeof p.Player !== 'string') return;
      
      const id = this.generateId('player', p.Player, p.Team || '');
      const normalizedName = this.normalizeName(p.Player);
      
      // Trouver l'équipe correspondante
      const teamId = this.findTeamId(p.Team);
      
      const player: PlayerEntity = {
        id,
        name: p.Player,
        teamId,
        teamName: String(p.Team || ''),
        position: String(p.Position || ''),
        league: String(p.League || ''),
        age: Number(p.Age) || 0,
        height: Number(p.Height) || 0,
        weight: Number(p.Weight) || 0,
        foot: String(p.Foot || ''),
        marketValue: Number(p['Market value']) || 0,
        passportCountry: String(p['Passport country'] || ''),
        birthCountry: String(p['Birth country'] || ''),
        contractExpires: String(p['Contract expires'] || ''),
        onLoan: p['On loan'] === 'Yes' || p['On loan'] === 'true',
        matchesPlayed: Number(p['Matches played']) || 0,
        minutesPlayed: Number(p['Minutes played']) || 0,
        metrics: this.extractPlayerMetrics(p),
        rawData: p
      };
      
      this.players.set(id, player);
      this.normalizedPlayerNames.set(normalizedName, id);
      
      // Mettre à jour les index
      this.addToIndex(this.playersByTeam, player.teamName, id);
      this.addToIndex(this.playersByLeague, player.league, id);
      this.addToIndex(this.playersByPosition, player.position, id);
    });
  }
  
  private extractPlayerMetrics(p: PlayerData): Record<string, number> {
    const metrics: Record<string, number> = {};
    const excludeKeys = new Set([
      'Player', 'Team', 'Position', 'League', 'Age', 'Height', 'Weight',
      'Foot', 'Market value', 'Passport country', 'Birth country',
      'Contract expires', 'On loan', 'Matches played', 'Minutes played'
    ]);
    
    Object.entries(p).forEach(([key, value]) => {
      if (!excludeKeys.has(key) && typeof value === 'number' && !isNaN(value)) {
        metrics[key] = value;
      }
    });
    
    return metrics;
  }
  
  private findTeamId(teamName: string | undefined): string | null {
    if (!teamName || typeof teamName !== 'string') return null;
    
    const normalized = this.normalizeName(teamName);
    return this.normalizedTeamNames.get(normalized) || null;
  }
  
  // ============================================
  // SHOT LOADING
  // ============================================
  
  private loadShots(shotEvents: ShotEvent[]): void {
    shotEvents.forEach((s, index) => {
      const id = `shot_${index}_${s.player || 'unknown'}`;
      
      // Trouver le joueur et l'équipe correspondants
      const playerId = this.findPlayerId(s.player, s.team);
      const teamId = this.findTeamId(s.team);
      
      const shot: ShotEntity = {
        id,
        playerId,
        playerName: String(s.player || ''),
        teamId,
        teamName: String(s.team || ''),
        x: Number(s.X) || 0,
        y: Number(s.Y) || 0,
        endX: 0, // Non disponible dans ShotEvent
        endY: 0, // Non disponible dans ShotEvent
        xg: Number(s.xG) || 0,
        result: String(s.result || ''),
        situation: String(s.situation || ''),
        shotType: String(s.shotType || ''),
        bodyPart: String(s.shotType || ''), // Utiliser shotType comme fallback
        minute: Number(s.minute) || 0,
        match: String(s.match_id || ''),
        rawData: s
      };
      
      this.shots.set(id, shot);
      
      // Mettre à jour les index
      if (playerId) {
        this.addToIndex(this.shotsByPlayer, playerId, id);
      }
      if (shot.teamName) {
        this.addToIndex(this.shotsByTeam, shot.teamName, id);
      }
    });
  }
  
  private findPlayerId(playerName: string | undefined, teamName: string | undefined): string | null {
    if (!playerName || typeof playerName !== 'string') return null;
    
    const normalized = this.normalizeName(playerName);
    
    // Essayer de trouver par nom exact
    const directMatch = this.normalizedPlayerNames.get(normalized);
    if (directMatch) return directMatch;
    
    // Essayer de trouver par nom + équipe
    if (teamName) {
      const withTeam = this.normalizeName(playerName + teamName);
      const teamMatch = this.normalizedPlayerNames.get(withTeam);
      if (teamMatch) return teamMatch;
    }
    
    // Recherche partielle
    for (const [name, id] of this.normalizedPlayerNames.entries()) {
      if (name.includes(normalized) || normalized.includes(name)) {
        return id;
      }
    }
    
    return null;
  }
  
  // ============================================
  // INDEX HELPERS
  // ============================================
  
  private addToIndex(index: Map<string, Set<string>>, key: string, value: string): void {
    if (!key) return;
    
    if (!index.has(key)) {
      index.set(key, new Set());
    }
    index.get(key)!.add(value);
  }
  
  // ============================================
  // QUERY METHODS - TEAMS
  // ============================================
  
  getAllTeams(): TeamEntity[] {
    return Array.from(this.teams.values());
  }
  
  getTeamById(id: string): TeamEntity | undefined {
    return this.teams.get(id);
  }
  
  getTeamByName(name: string): TeamEntity | undefined {
    const normalized = this.normalizeName(name);
    const id = this.normalizedTeamNames.get(normalized);
    return id ? this.teams.get(id) : undefined;
  }
  
  getTeamsByLeague(league: string): TeamEntity[] {
    return this.getAllTeams().filter(t => t.league === league);
  }
  
  getTeamPlayers(teamId: string): PlayerEntity[] {
    const team = this.teams.get(teamId);
    if (!team) return [];
    
    const playerIds = this.playersByTeam.get(team.name);
    if (!playerIds) return [];
    
    return Array.from(playerIds)
      .map(id => this.players.get(id))
      .filter((p): p is PlayerEntity => p !== undefined);
  }
  
  getTeamShots(teamName: string): ShotEntity[] {
    const shotIds = this.shotsByTeam.get(teamName);
    if (!shotIds) return [];
    
    return Array.from(shotIds)
      .map(id => this.shots.get(id))
      .filter((s): s is ShotEntity => s !== undefined);
  }
  
  // ============================================
  // QUERY METHODS - PLAYERS
  // ============================================
  
  getAllPlayers(): PlayerEntity[] {
    return Array.from(this.players.values());
  }
  
  getPlayerById(id: string): PlayerEntity | undefined {
    return this.players.get(id);
  }
  
  getPlayerByName(name: string, teamName?: string): PlayerEntity | undefined {
    const normalized = this.normalizeName(name + (teamName || ''));
    const id = this.normalizedPlayerNames.get(normalized);
    
    if (id) return this.players.get(id);
    
    // Fallback: recherche par nom simple
    const simpleNormalized = this.normalizeName(name);
    const simpleId = this.normalizedPlayerNames.get(simpleNormalized);
    return simpleId ? this.players.get(simpleId) : undefined;
  }
  
  getPlayersByTeam(teamName: string): PlayerEntity[] {
    const playerIds = this.playersByTeam.get(teamName);
    if (!playerIds) return [];
    
    return Array.from(playerIds)
      .map(id => this.players.get(id))
      .filter((p): p is PlayerEntity => p !== undefined);
  }
  
  getPlayersByPosition(position: string): PlayerEntity[] {
    const playerIds = this.playersByPosition.get(position);
    if (!playerIds) return [];
    
    return Array.from(playerIds)
      .map(id => this.players.get(id))
      .filter((p): p is PlayerEntity => p !== undefined);
  }
  
  getPlayersByLeague(league: string): PlayerEntity[] {
    const playerIds = this.playersByLeague.get(league);
    if (!playerIds) return [];
    
    return Array.from(playerIds)
      .map(id => this.players.get(id))
      .filter((p): p is PlayerEntity => p !== undefined);
  }
  
  getPlayerTeam(playerId: string): TeamEntity | undefined {
    const player = this.players.get(playerId);
    if (!player || !player.teamId) return undefined;
    
    return this.teams.get(player.teamId);
  }
  
  getPlayerShots(playerId: string): ShotEntity[] {
    const shotIds = this.shotsByPlayer.get(playerId);
    if (!shotIds) return [];
    
    return Array.from(shotIds)
      .map(id => this.shots.get(id))
      .filter((s): s is ShotEntity => s !== undefined);
  }
  
  // ============================================
  // QUERY METHODS - SHOTS
  // ============================================
  
  getAllShots(): ShotEntity[] {
    return Array.from(this.shots.values());
  }
  
  getShotById(id: string): ShotEntity | undefined {
    return this.shots.get(id);
  }
  
  getShotsByTeam(teamName: string): ShotEntity[] {
    return this.getTeamShots(teamName);
  }
  
  getShotsByPlayer(playerId: string): ShotEntity[] {
    return this.getPlayerShots(playerId);
  }
  
  getShotsByResult(result: string): ShotEntity[] {
    return this.getAllShots().filter(s => s.result === result);
  }
  
  // ============================================
  // SEARCH METHODS
  // ============================================
  
  searchPlayers(query: string, options?: {
    limit?: number;
    position?: string;
    league?: string;
    team?: string;
    minAge?: number;
    maxAge?: number;
    minMarketValue?: number;
    maxMarketValue?: number;
  }): PlayerEntity[] {
    const normalized = this.normalizeName(query);
    let results = this.getAllPlayers();
    
    // Filtrer par recherche texte
    if (query) {
      results = results.filter(p => {
        const nameMatch = this.normalizeName(p.name).includes(normalized);
        const teamMatch = this.normalizeName(p.teamName).includes(normalized);
        return nameMatch || teamMatch;
      });
    }
    
    // Appliquer les filtres
    if (options) {
      if (options.position) {
        results = results.filter(p => p.position === options.position);
      }
      if (options.league) {
        results = results.filter(p => p.league === options.league);
      }
      if (options.team) {
        results = results.filter(p => p.teamName === options.team);
      }
      if (options.minAge !== undefined) {
        results = results.filter(p => p.age >= options.minAge!);
      }
      if (options.maxAge !== undefined) {
        results = results.filter(p => p.age <= options.maxAge!);
      }
      if (options.minMarketValue !== undefined) {
        results = results.filter(p => p.marketValue >= options.minMarketValue!);
      }
      if (options.maxMarketValue !== undefined) {
        results = results.filter(p => p.marketValue <= options.maxMarketValue!);
      }
      if (options.limit) {
        results = results.slice(0, options.limit);
      }
    }
    
    return results;
  }
  
  searchTeams(query: string, options?: {
    limit?: number;
    league?: string;
  }): TeamEntity[] {
    const normalized = this.normalizeName(query);
    let results = this.getAllTeams();
    
    if (query) {
      results = results.filter(t => 
        this.normalizeName(t.name).includes(normalized)
      );
    }
    
    if (options) {
      if (options.league) {
        results = results.filter(t => t.league === options.league);
      }
      if (options.limit) {
        results = results.slice(0, options.limit);
      }
    }
    
    return results;
  }
  
  // ============================================
  // AGGREGATION METHODS
  // ============================================
  
  getTeamStats(teamName: string): {
    playerCount: number;
    avgAge: number;
    totalMarketValue: number;
    totalGoals: number;
    totalAssists: number;
    totalXG: number;
    totalXA: number;
    shotCount: number;
    goalCount: number;
    avgXG: number;
  } {
    const players = this.getPlayersByTeam(teamName);
    const shots = this.getShotsByTeam(teamName);
    
    const playerCount = players.length;
    const avgAge = playerCount > 0 
      ? players.reduce((sum, p) => sum + p.age, 0) / playerCount 
      : 0;
    const totalMarketValue = players.reduce((sum, p) => sum + p.marketValue, 0);
    const totalGoals = players.reduce((sum, p) => sum + (p.metrics['Goals'] || 0), 0);
    const totalAssists = players.reduce((sum, p) => sum + (p.metrics['Assists'] || 0), 0);
    const totalXG = players.reduce((sum, p) => sum + (p.metrics['xG'] || 0), 0);
    const totalXA = players.reduce((sum, p) => sum + (p.metrics['xA'] || 0), 0);
    
    const shotCount = shots.length;
    const goalCount = shots.filter(s => s.result === 'Goal').length;
    const avgXG = shotCount > 0 
      ? shots.reduce((sum, s) => sum + s.xg, 0) / shotCount 
      : 0;
    
    return {
      playerCount,
      avgAge: Math.round(avgAge * 10) / 10,
      totalMarketValue,
      totalGoals,
      totalAssists,
      totalXG: Math.round(totalXG * 100) / 100,
      totalXA: Math.round(totalXA * 100) / 100,
      shotCount,
      goalCount,
      avgXG: Math.round(avgXG * 1000) / 1000
    };
  }
  
  getPlayerStats(playerId: string): {
    shots: number;
    goals: number;
    xgTotal: number;
    avgXG: number;
    conversionRate: number;
    bodyPartBreakdown: Record<string, number>;
    situationBreakdown: Record<string, number>;
  } {
    const shots = this.getPlayerShots(playerId);
    
    const shotCount = shots.length;
    const goalCount = shots.filter(s => s.result === 'Goal').length;
    const xgTotal = shots.reduce((sum, s) => sum + s.xg, 0);
    
    const bodyPartBreakdown: Record<string, number> = {};
    const situationBreakdown: Record<string, number> = {};
    
    shots.forEach(s => {
      bodyPartBreakdown[s.bodyPart] = (bodyPartBreakdown[s.bodyPart] || 0) + 1;
      situationBreakdown[s.situation] = (situationBreakdown[s.situation] || 0) + 1;
    });
    
    return {
      shots: shotCount,
      goals: goalCount,
      xgTotal: Math.round(xgTotal * 100) / 100,
      avgXG: shotCount > 0 ? Math.round((xgTotal / shotCount) * 1000) / 1000 : 0,
      conversionRate: shotCount > 0 ? Math.round((goalCount / shotCount) * 1000) / 10 : 0,
      bodyPartBreakdown,
      situationBreakdown
    };
  }
  
  // ============================================
  // UTILITY METHODS
  // ============================================
  
  getAvailableLeagues(): string[] {
    const leagues = new Set<string>();
    this.players.forEach(p => {
      if (p.league) leagues.add(p.league);
    });
    return Array.from(leagues).sort();
  }
  
  getAvailablePositions(): string[] {
    const positions = new Set<string>();
    this.players.forEach(p => {
      if (p.position) positions.add(p.position);
    });
    return Array.from(positions).sort();
  }
  
  getStats(): {
    teamCount: number;
    playerCount: number;
    shotCount: number;
    leagueCount: number;
    positionCount: number;
  } {
    return {
      teamCount: this.teams.size,
      playerCount: this.players.size,
      shotCount: this.shots.size,
      leagueCount: this.getAvailableLeagues().length,
      positionCount: this.getAvailablePositions().length
    };
  }
  
  // ============================================
  // EXPORT METHODS (pour compatibilité avec l'existant)
  // ============================================
  
  /**
   * Exporte les joueurs au format PlayerData original
   */
  exportPlayersAsPlayerData(): PlayerData[] {
    return this.getAllPlayers().map(p => p.rawData);
  }
  
  /**
   * Exporte les équipes au format TeamStats original
   */
  exportTeamsAsTeamStats(): TeamStats[] {
    return this.getAllTeams()
      .filter(t => t.rawData !== null)
      .map(t => t.rawData as TeamStats);
  }
  
  /**
   * Exporte les tirs au format ShotEvent original
   */
  exportShotsAsShotEvents(): ShotEvent[] {
    return this.getAllShots().map(s => s.rawData);
  }
  
  /**
   * Réinitialise la base de données
   */
  clear(): void {
    this.players.clear();
    this.teams.clear();
    this.shots.clear();
    this.playersByTeam.clear();
    this.playersByLeague.clear();
    this.playersByPosition.clear();
    this.shotsByPlayer.clear();
    this.shotsByTeam.clear();
    this.normalizedTeamNames.clear();
    this.normalizedPlayerNames.clear();
  }
}

// Singleton instance
export const database = new ScoutVisionDatabase();

export default database;
