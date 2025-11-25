/**
 * ScoutVision AI - Data Loader Service
 * Charge les fichiers CSV au démarrage de l'application
 */

import { PlayerData, TeamStats, ShotEvent } from '../types';
import { parseCSV, parseTeamStatsCSV, parseShotEventsCSV } from '../utils/csvParser';
import { database } from './database';
import { queryService } from './queryService';

// ============================================
// TYPES
// ============================================

export interface DataLoadResult {
  players: PlayerData[];
  teams: TeamStats[];
  shots: ShotEvent[];
  stats: {
    playerCount: number;
    teamCount: number;
    shotCount: number;
    loadTime: number;
  };
}

export interface LoadingState {
  isLoading: boolean;
  progress: number;
  currentStep: string;
  error: string | null;
}

// ============================================
// DATA LOADER CLASS
// ============================================

class DataLoader {
  private isLoaded = false;
  private data: DataLoadResult | null = null;
  private loadingPromise: Promise<DataLoadResult> | null = null;

  /**
   * Charge toutes les données depuis les fichiers CSV
   */
  async loadAllData(onProgress?: (state: LoadingState) => void): Promise<DataLoadResult> {
    // Si déjà chargé, retourner les données en cache
    if (this.isLoaded && this.data) {
      return this.data;
    }

    // Si un chargement est en cours, attendre sa fin
    if (this.loadingPromise) {
      return this.loadingPromise;
    }

    // Commencer le chargement
    this.loadingPromise = this.performLoad(onProgress);
    
    try {
      this.data = await this.loadingPromise;
      this.isLoaded = true;
      return this.data;
    } finally {
      this.loadingPromise = null;
    }
  }

  private async performLoad(onProgress?: (state: LoadingState) => void): Promise<DataLoadResult> {
    const startTime = performance.now();
    
    const updateProgress = (progress: number, currentStep: string) => {
      onProgress?.({
        isLoading: true,
        progress,
        currentStep,
        error: null
      });
    };

    try {
      updateProgress(0, 'Loading player data...');
      
      // Charger les fichiers CSV en parallèle
      const [playersText, teamsText, shotsText] = await Promise.all([
        this.fetchCSV('/data/players.csv'),
        this.fetchCSV('/data/teams.csv'),
        this.fetchCSV('/data/shots.csv')
      ]);

      updateProgress(30, 'Parsing player data...');
      const players = parseCSV(playersText);
      
      updateProgress(50, 'Parsing team data...');
      const teams = parseTeamStatsCSV(teamsText);
      
      updateProgress(70, 'Parsing shot data...');
      const shots = parseShotEventsCSV(shotsText);

      updateProgress(80, 'Building database...');
      
      // Initialiser la base de données
      database.clear();
      database.initialize(players, teams, shots);

      updateProgress(90, 'Building query indexes...');
      
      // Initialiser le service de requêtes optimisées
      queryService.initialize(players, teams, shots);

      const loadTime = performance.now() - startTime;
      
      updateProgress(100, 'Ready!');

      const result: DataLoadResult = {
        players,
        teams,
        shots,
        stats: {
          playerCount: players.length,
          teamCount: teams.length,
          shotCount: shots.length,
          loadTime: Math.round(loadTime)
        }
      };

      console.log(`✅ Data loaded in ${result.stats.loadTime}ms:`);
      console.log(`   - ${result.stats.playerCount} players`);
      console.log(`   - ${result.stats.teamCount} teams`);
      console.log(`   - ${result.stats.shotCount} shots`);

      return result;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      onProgress?.({
        isLoading: false,
        progress: 0,
        currentStep: 'Error',
        error: errorMessage
      });
      throw error;
    }
  }

  private async fetchCSV(path: string): Promise<string> {
    const response = await fetch(path);
    if (!response.ok) {
      throw new Error(`Failed to load ${path}: ${response.statusText}`);
    }
    return response.text();
  }

  /**
   * Vérifie si les données sont chargées
   */
  isDataLoaded(): boolean {
    return this.isLoaded;
  }

  /**
   * Retourne les données en cache (ou null si non chargées)
   */
  getCachedData(): DataLoadResult | null {
    return this.data;
  }

  /**
   * Force le rechargement des données
   */
  async reload(onProgress?: (state: LoadingState) => void): Promise<DataLoadResult> {
    this.isLoaded = false;
    this.data = null;
    return this.loadAllData(onProgress);
  }
}

// Singleton
export const dataLoader = new DataLoader();

export default dataLoader;
