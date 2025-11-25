/**
 * ScoutVision AI - Database Hook
 * Hook React pour accéder à la base de données relationnelle
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { database, PlayerEntity, TeamEntity, ShotEntity } from '../services/database';
import { PlayerData, TeamStats, ShotEvent } from '../types';

// ============================================
// TYPES
// ============================================

interface DatabaseState {
  isInitialized: boolean;
  isLoading: boolean;
  error: string | null;
  stats: {
    teamCount: number;
    playerCount: number;
    shotCount: number;
    leagueCount: number;
    positionCount: number;
  };
}

interface UseDatabaseResult extends DatabaseState {
  // Initialisation
  initialize: (players: PlayerData[], teams: TeamStats[], shots: ShotEvent[]) => void;
  
  // Teams
  getAllTeams: () => TeamEntity[];
  getTeamById: (id: string) => TeamEntity | undefined;
  getTeamByName: (name: string) => TeamEntity | undefined;
  getTeamsByLeague: (league: string) => TeamEntity[];
  getTeamPlayers: (teamId: string) => PlayerEntity[];
  getTeamShots: (teamName: string) => ShotEntity[];
  getTeamStats: (teamName: string) => ReturnType<typeof database.getTeamStats>;
  
  // Players
  getAllPlayers: () => PlayerEntity[];
  getPlayerById: (id: string) => PlayerEntity | undefined;
  getPlayerByName: (name: string, teamName?: string) => PlayerEntity | undefined;
  getPlayersByTeam: (teamName: string) => PlayerEntity[];
  getPlayersByPosition: (position: string) => PlayerEntity[];
  getPlayersByLeague: (league: string) => PlayerEntity[];
  getPlayerTeam: (playerId: string) => TeamEntity | undefined;
  getPlayerShots: (playerId: string) => ShotEntity[];
  getPlayerStats: (playerId: string) => ReturnType<typeof database.getPlayerStats>;
  
  // Shots
  getAllShots: () => ShotEntity[];
  getShotById: (id: string) => ShotEntity | undefined;
  getShotsByTeam: (teamName: string) => ShotEntity[];
  getShotsByPlayer: (playerId: string) => ShotEntity[];
  getShotsByResult: (result: string) => ShotEntity[];
  
  // Search
  searchPlayers: typeof database.searchPlayers;
  searchTeams: typeof database.searchTeams;
  
  // Utilities
  getAvailableLeagues: () => string[];
  getAvailablePositions: () => string[];
  
  // Export (pour compatibilité)
  exportPlayersAsPlayerData: () => PlayerData[];
  exportTeamsAsTeamStats: () => TeamStats[];
  exportShotsAsShotEvents: () => ShotEvent[];
}

// ============================================
// HOOK
// ============================================

export function useDatabase(): UseDatabaseResult {
  const [state, setState] = useState<DatabaseState>({
    isInitialized: false,
    isLoading: false,
    error: null,
    stats: {
      teamCount: 0,
      playerCount: 0,
      shotCount: 0,
      leagueCount: 0,
      positionCount: 0
    }
  });
  
  // Initialisation
  const initialize = useCallback((
    players: PlayerData[],
    teams: TeamStats[],
    shots: ShotEvent[]
  ) => {
    setState(prev => ({ ...prev, isLoading: true, error: null }));
    
    try {
      database.clear();
      database.initialize(players, teams, shots);
      
      setState({
        isInitialized: true,
        isLoading: false,
        error: null,
        stats: database.getStats()
      });
    } catch (err) {
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: err instanceof Error ? err.message : 'Unknown error'
      }));
    }
  }, []);
  
  // Méthodes mémoïsées pour éviter les re-renders inutiles
  const methods = useMemo(() => ({
    // Teams
    getAllTeams: () => database.getAllTeams(),
    getTeamById: (id: string) => database.getTeamById(id),
    getTeamByName: (name: string) => database.getTeamByName(name),
    getTeamsByLeague: (league: string) => database.getTeamsByLeague(league),
    getTeamPlayers: (teamId: string) => database.getTeamPlayers(teamId),
    getTeamShots: (teamName: string) => database.getTeamShots(teamName),
    getTeamStats: (teamName: string) => database.getTeamStats(teamName),
    
    // Players
    getAllPlayers: () => database.getAllPlayers(),
    getPlayerById: (id: string) => database.getPlayerById(id),
    getPlayerByName: (name: string, teamName?: string) => database.getPlayerByName(name, teamName),
    getPlayersByTeam: (teamName: string) => database.getPlayersByTeam(teamName),
    getPlayersByPosition: (position: string) => database.getPlayersByPosition(position),
    getPlayersByLeague: (league: string) => database.getPlayersByLeague(league),
    getPlayerTeam: (playerId: string) => database.getPlayerTeam(playerId),
    getPlayerShots: (playerId: string) => database.getPlayerShots(playerId),
    getPlayerStats: (playerId: string) => database.getPlayerStats(playerId),
    
    // Shots
    getAllShots: () => database.getAllShots(),
    getShotById: (id: string) => database.getShotById(id),
    getShotsByTeam: (teamName: string) => database.getShotsByTeam(teamName),
    getShotsByPlayer: (playerId: string) => database.getShotsByPlayer(playerId),
    getShotsByResult: (result: string) => database.getShotsByResult(result),
    
    // Search
    searchPlayers: database.searchPlayers.bind(database),
    searchTeams: database.searchTeams.bind(database),
    
    // Utilities
    getAvailableLeagues: () => database.getAvailableLeagues(),
    getAvailablePositions: () => database.getAvailablePositions(),
    
    // Export
    exportPlayersAsPlayerData: () => database.exportPlayersAsPlayerData(),
    exportTeamsAsTeamStats: () => database.exportTeamsAsTeamStats(),
    exportShotsAsShotEvents: () => database.exportShotsAsShotEvents()
  }), []);
  
  return {
    ...state,
    initialize,
    ...methods
  };
}

// ============================================
// HELPER HOOKS
// ============================================

/**
 * Hook pour récupérer les données d'une équipe
 */
export function useTeam(teamName: string) {
  const db = useDatabase();
  
  const team = useMemo(() => 
    db.getTeamByName(teamName), 
    [teamName, db.isInitialized]
  );
  
  const players = useMemo(() => 
    db.getPlayersByTeam(teamName),
    [teamName, db.isInitialized]
  );
  
  const shots = useMemo(() =>
    db.getShotsByTeam(teamName),
    [teamName, db.isInitialized]
  );
  
  const stats = useMemo(() =>
    db.getTeamStats(teamName),
    [teamName, db.isInitialized]
  );
  
  return { team, players, shots, stats };
}

/**
 * Hook pour récupérer les données d'un joueur
 */
export function usePlayer(playerName: string, teamName?: string) {
  const db = useDatabase();
  
  const player = useMemo(() =>
    db.getPlayerByName(playerName, teamName),
    [playerName, teamName, db.isInitialized]
  );
  
  const team = useMemo(() =>
    player?.teamId ? db.getTeamById(player.teamId) : undefined,
    [player, db.isInitialized]
  );
  
  const shots = useMemo(() =>
    player ? db.getPlayerShots(player.id) : [],
    [player, db.isInitialized]
  );
  
  const stats = useMemo(() =>
    player ? db.getPlayerStats(player.id) : null,
    [player, db.isInitialized]
  );
  
  return { player, team, shots, stats };
}

/**
 * Hook pour rechercher des joueurs
 */
export function usePlayerSearch(query: string, options?: Parameters<typeof database.searchPlayers>[1]) {
  const db = useDatabase();
  
  const results = useMemo(() =>
    db.searchPlayers(query, options),
    [query, options, db.isInitialized]
  );
  
  return results;
}

/**
 * Hook pour rechercher des équipes
 */
export function useTeamSearch(query: string, options?: Parameters<typeof database.searchTeams>[1]) {
  const db = useDatabase();
  
  const results = useMemo(() =>
    db.searchTeams(query, options),
    [query, options, db.isInitialized]
  );
  
  return results;
}

export default useDatabase;
