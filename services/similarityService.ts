/**
 * ScoutVision AI - Similarity Service
 * Service avancé de recherche de joueurs similaires
 */

import { 
  PlayerData, 
  SimilarityResult, 
  MetricBounds 
} from '../types';
import {
  extractNumericMetricKeys,
  calculateMetricBounds,
  normalizeValue,
  PROFILE_KEYS,
  EXCLUDED_METRIC_KEYS
} from './playerService';

// ============================================
// CONSTANTS
// ============================================

/**
 * Poids des catégories de métriques pour la similarité
 */
export const METRIC_CATEGORY_WEIGHTS: Record<string, number> = {
  attacking: 1.0,
  defensive: 1.0,
  passing: 0.8,
  physical: 0.6,
  possession: 0.9
};

/**
 * Mapping des métriques vers leurs catégories
 */
export const METRIC_CATEGORIES: Record<string, string> = {
  // Attacking
  'xG': 'attacking',
  'xG per 90': 'attacking',
  'Goals': 'attacking',
  'Goals per 90': 'attacking',
  'Non-penalty goals per 90': 'attacking',
  'Shots per 90': 'attacking',
  'Shots on target, %': 'attacking',
  'Touches in box per 90': 'attacking',
  
  // Creation
  'xA': 'attacking',
  'xA per 90': 'attacking',
  'Assists': 'attacking',
  'Key passes per 90': 'attacking',
  'Shot assists per 90': 'attacking',
  'Deep completions per 90': 'attacking',
  
  // Defensive
  'Successful defensive actions per 90': 'defensive',
  'Defensive duels won, %': 'defensive',
  'Aerial duels won, %': 'defensive',
  'PAdj Interceptions': 'defensive',
  'PAdj Sliding tackles': 'defensive',
  'Shots blocked per 90': 'defensive',
  
  // Passing
  'Passes per 90': 'passing',
  'Accurate passes, %': 'passing',
  'Progressive passes per 90': 'passing',
  'Passes to final third per 90': 'passing',
  'Accurate long passes, %': 'passing',
  'Accurate crosses, %': 'passing',
  
  // Possession
  'Dribbles per 90': 'possession',
  'Successful dribbles, %': 'possession',
  'Progressive runs per 90': 'possession',
  'Offensive duels won, %': 'possession',
  
  // Physical
  'Duels won, %': 'physical',
  'Duels per 90': 'physical'
};

// ============================================
// SIMILARITY ALGORITHMS
// ============================================

/**
 * Algorithme principal de similarité utilisant la distance euclidienne pondérée
 */
export function findSimilarPlayers(
  referencePlayer: PlayerData,
  candidates: PlayerData[],
  options: SimilarityOptions = {}
): SimilarityResult[] {
  const {
    maxResults = 10,
    samePositionOnly = false,
    excludeSameTeam = false,
    minMinutes = 450,
    customWeights = {},
    algorithm = 'euclidean'
  } = options;

  // Filtrer les candidats
  let filteredCandidates = candidates.filter(p => {
    // Exclure le joueur de référence
    if (p.Player === referencePlayer.Player && p.Team === referencePlayer.Team) {
      return false;
    }

    // Filtre par position
    if (samePositionOnly) {
      const refPositions = referencePlayer.Position?.split(',').map(s => s.trim()) || [];
      const candPositions = p.Position?.split(',').map(s => s.trim()) || [];
      if (!refPositions.some(rp => candPositions.includes(rp))) {
        return false;
      }
    }

    // Exclure la même équipe
    if (excludeSameTeam && p.Team === referencePlayer.Team) {
      return false;
    }

    // Filtre par minutes
    if ((Number(p['Minutes played']) || 0) < minMinutes) {
      return false;
    }

    return true;
  });

  // Identifier les métriques numériques
  const metricKeys = extractNumericMetricKeys(candidates);

  // Calculer les bornes pour normalisation
  const bounds: Record<string, MetricBounds> = {};
  metricKeys.forEach(key => {
    bounds[key] = calculateMetricBounds(candidates, key);
  });

  // Calculer la similarité pour chaque candidat
  const results: SimilarityResult[] = filteredCandidates.map(candidate => {
    let distance: number;
    let breakdown: Record<string, number> = {};

    switch (algorithm) {
      case 'cosine':
        distance = cosineSimilarity(referencePlayer, candidate, metricKeys, bounds);
        break;
      case 'manhattan':
        distance = manhattanDistance(referencePlayer, candidate, metricKeys, bounds, customWeights);
        break;
      case 'weighted':
        const result = weightedEuclideanDistance(referencePlayer, candidate, metricKeys, bounds, customWeights);
        distance = result.distance;
        breakdown = result.breakdown;
        break;
      default:
        distance = euclideanDistance(referencePlayer, candidate, metricKeys, bounds);
    }

    // Convertir la distance en score de similarité (0-100)
    const maxPossibleDistance = Math.sqrt(metricKeys.length);
    const score = Math.max(0, Math.round(100 * (1 - (distance / (maxPossibleDistance * 0.6)))));

    return {
      player: candidate,
      score,
      distance,
      matchedMetrics: metricKeys.length,
      breakdown
    };
  });

  // Trier par score décroissant et retourner les top N
  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);
}

export interface SimilarityOptions {
  maxResults?: number;
  samePositionOnly?: boolean;
  excludeSameTeam?: boolean;
  minMinutes?: number;
  customWeights?: Record<string, number>;
  algorithm?: 'euclidean' | 'cosine' | 'manhattan' | 'weighted';
}

// ============================================
// DISTANCE FUNCTIONS
// ============================================

/**
 * Distance euclidienne standard
 */
function euclideanDistance(
  playerA: PlayerData,
  playerB: PlayerData,
  metricKeys: string[],
  bounds: Record<string, MetricBounds>
): number {
  let sumSquaredDiff = 0;
  let count = 0;

  metricKeys.forEach(key => {
    const valA = normalizeValue(Number(playerA[key]) || 0, bounds[key]);
    const valB = normalizeValue(Number(playerB[key]) || 0, bounds[key]);
    sumSquaredDiff += Math.pow(valA - valB, 2);
    count++;
  });

  return Math.sqrt(sumSquaredDiff);
}

/**
 * Distance euclidienne pondérée par catégorie
 */
function weightedEuclideanDistance(
  playerA: PlayerData,
  playerB: PlayerData,
  metricKeys: string[],
  bounds: Record<string, MetricBounds>,
  customWeights: Record<string, number>
): { distance: number; breakdown: Record<string, number> } {
  let sumWeightedSquaredDiff = 0;
  let totalWeight = 0;
  const breakdown: Record<string, number> = {};

  metricKeys.forEach(key => {
    const valA = normalizeValue(Number(playerA[key]) || 0, bounds[key]);
    const valB = normalizeValue(Number(playerB[key]) || 0, bounds[key]);
    
    // Déterminer le poids
    let weight = customWeights[key] || 1;
    const category = METRIC_CATEGORIES[key];
    if (category && !customWeights[key]) {
      weight = METRIC_CATEGORY_WEIGHTS[category] || 1;
    }

    const diff = Math.pow(valA - valB, 2) * weight;
    sumWeightedSquaredDiff += diff;
    totalWeight += weight;
    
    // Stocker la contribution de cette métrique
    breakdown[key] = Number(Math.sqrt(Math.pow(valA - valB, 2)).toFixed(3));
  });

  const distance = Math.sqrt(sumWeightedSquaredDiff / (totalWeight || 1));
  return { distance, breakdown };
}

/**
 * Distance de Manhattan
 */
function manhattanDistance(
  playerA: PlayerData,
  playerB: PlayerData,
  metricKeys: string[],
  bounds: Record<string, MetricBounds>,
  weights: Record<string, number>
): number {
  let totalDiff = 0;

  metricKeys.forEach(key => {
    const valA = normalizeValue(Number(playerA[key]) || 0, bounds[key]);
    const valB = normalizeValue(Number(playerB[key]) || 0, bounds[key]);
    const weight = weights[key] || 1;
    totalDiff += Math.abs(valA - valB) * weight;
  });

  return totalDiff / metricKeys.length;
}

/**
 * Similarité cosinus (mesure d'angle, pas de distance)
 */
function cosineSimilarity(
  playerA: PlayerData,
  playerB: PlayerData,
  metricKeys: string[],
  bounds: Record<string, MetricBounds>
): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  metricKeys.forEach(key => {
    const valA = normalizeValue(Number(playerA[key]) || 0, bounds[key]);
    const valB = normalizeValue(Number(playerB[key]) || 0, bounds[key]);
    
    dotProduct += valA * valB;
    normA += valA * valA;
    normB += valB * valB;
  });

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 1; // Distance maximale si vecteurs nuls

  // Convertir similarité (0-1) en distance (0-1)
  const similarity = dotProduct / denominator;
  return 1 - similarity;
}

// ============================================
// POSITION-SPECIFIC SIMILARITY
// ============================================

/**
 * Métriques clés par position pour une similarité ciblée
 */
export const POSITION_KEY_METRICS: Record<string, string[]> = {
  'GK': [
    'Save rate, %', 'Prevented goals per 90', 'Exits per 90',
    'Accurate passes, %', 'Accurate long passes, %'
  ],
  'CB': [
    'Defensive duels won, %', 'Aerial duels won, %', 'PAdj Interceptions',
    'Progressive passes per 90', 'Accurate passes, %'
  ],
  'LB': [
    'xA per 90', 'Progressive passes per 90', 'Accurate crosses, %',
    'Defensive duels won, %', 'Progressive runs per 90'
  ],
  'RB': [
    'xA per 90', 'Progressive passes per 90', 'Accurate crosses, %',
    'Defensive duels won, %', 'Progressive runs per 90'
  ],
  'DMF': [
    'PAdj Interceptions', 'Passes per 90', 'Accurate passes, %',
    'Progressive passes per 90', 'Defensive duels won, %'
  ],
  'CMF': [
    'xA per 90', 'Progressive passes per 90', 'Key passes per 90',
    'Accurate passes, %', 'Duels won, %'
  ],
  'AMF': [
    'xG per 90', 'xA per 90', 'Key passes per 90',
    'Dribbles per 90', 'Shot assists per 90'
  ],
  'LW': [
    'xG per 90', 'xA per 90', 'Dribbles per 90',
    'Successful dribbles, %', 'Progressive runs per 90'
  ],
  'RW': [
    'xG per 90', 'xA per 90', 'Dribbles per 90',
    'Successful dribbles, %', 'Progressive runs per 90'
  ],
  'CF': [
    'xG per 90', 'Goals per 90', 'Shots on target, %',
    'Touches in box per 90', 'Aerial duels won, %'
  ]
};

/**
 * Trouve des joueurs similaires avec métriques spécifiques à la position
 */
export function findPositionSpecificSimilar(
  referencePlayer: PlayerData,
  candidates: PlayerData[],
  options: SimilarityOptions = {}
): SimilarityResult[] {
  const primaryPosition = referencePlayer.Position?.split(',')[0]?.trim() || 'CMF';
  const keyMetrics = POSITION_KEY_METRICS[primaryPosition] || POSITION_KEY_METRICS['CMF'];

  // Filtrer les métriques disponibles
  const availableMetrics = extractNumericMetricKeys(candidates);
  const filteredMetrics = keyMetrics.filter(m => availableMetrics.includes(m));

  // Créer des poids élevés pour ces métriques
  const customWeights: Record<string, number> = {};
  filteredMetrics.forEach(m => {
    customWeights[m] = 2.0; // Double poids pour les métriques clés
  });

  return findSimilarPlayers(referencePlayer, candidates, {
    ...options,
    customWeights,
    algorithm: 'weighted'
  });
}

// ============================================
// REPLACEMENT FINDER
// ============================================

/**
 * Trouve des remplacements potentiels pour un joueur
 * en tenant compte de l'âge et de la valeur marchande
 */
export function findReplacements(
  referencePlayer: PlayerData,
  candidates: PlayerData[],
  options: ReplacementOptions = {}
): ReplacementResult[] {
  const {
    maxAge = 28,
    maxMarketValue,
    preferYounger = true,
    minSimilarityScore = 60
  } = options;

  // D'abord, trouver les joueurs similaires
  const similar = findPositionSpecificSimilar(referencePlayer, candidates, {
    maxResults: 50,
    samePositionOnly: true,
    excludeSameTeam: true,
    minMinutes: 900
  });

  // Filtrer et enrichir les résultats
  const replacements: ReplacementResult[] = similar
    .filter(s => {
      const age = Number(s.player.Age) || 99;
      const value = Number(s.player['Market value']) || 0;

      if (age > maxAge) return false;
      if (maxMarketValue && value > maxMarketValue) return false;
      if (s.score < minSimilarityScore) return false;

      return true;
    })
    .map(s => {
      const refAge = Number(referencePlayer.Age) || 0;
      const candAge = Number(s.player.Age) || 0;
      const refValue = Number(referencePlayer['Market value']) || 1;
      const candValue = Number(s.player['Market value']) || 1;

      // Calculer le score de remplacement
      let replacementScore = s.score;

      // Bonus si plus jeune
      if (preferYounger && candAge < refAge) {
        replacementScore += Math.min(10, (refAge - candAge) * 2);
      }

      // Bonus si moins cher
      if (candValue < refValue) {
        const valueRatio = candValue / refValue;
        replacementScore += Math.round((1 - valueRatio) * 10);
      }

      return {
        ...s,
        replacementScore: Math.min(100, replacementScore),
        ageComparison: candAge - refAge,
        valueComparison: candValue - refValue
      };
    });

  // Trier par score de remplacement
  return replacements.sort((a, b) => b.replacementScore - a.replacementScore);
}

export interface ReplacementOptions {
  maxAge?: number;
  maxMarketValue?: number;
  preferYounger?: boolean;
  minSimilarityScore?: number;
}

export interface ReplacementResult extends SimilarityResult {
  replacementScore: number;
  ageComparison: number;
  valueComparison: number;
}

// ============================================
// STYLE MATCHING
// ============================================

/**
 * Définitions des styles de jeu
 */
export const PLAY_STYLES: Record<string, { metrics: Record<string, number>; description: string }> = {
  'Poacher': {
    metrics: {
      'xG per 90': 0.4,
      'Touches in box per 90': 0.3,
      'Goals per 90': 0.2,
      'Shots per 90': 0.1
    },
    description: 'Finisseur de surface qui capitalise sur les occasions'
  },
  'Target Man': {
    metrics: {
      'Aerial duels won, %': 0.4,
      'xG per 90': 0.2,
      'Duels won, %': 0.2,
      'Hold-up play': 0.2
    },
    description: 'Attaquant physique servant de point d\'appui'
  },
  'False 9': {
    metrics: {
      'xA per 90': 0.3,
      'Key passes per 90': 0.3,
      'Dribbles per 90': 0.2,
      'Progressive passes per 90': 0.2
    },
    description: 'Attaquant décrochant pour créer'
  },
  'Pressing Forward': {
    metrics: {
      'Successful defensive actions per 90': 0.4,
      'xG per 90': 0.3,
      'Duels per 90': 0.3
    },
    description: 'Attaquant travailleur qui presse haut'
  },
  'Playmaker': {
    metrics: {
      'xA per 90': 0.3,
      'Key passes per 90': 0.3,
      'Progressive passes per 90': 0.2,
      'Accurate passes, %': 0.2
    },
    description: 'Créateur avec vision et technique'
  },
  'Ball Carrier': {
    metrics: {
      'Dribbles per 90': 0.35,
      'Successful dribbles, %': 0.25,
      'Progressive runs per 90': 0.25,
      'Offensive duels won, %': 0.15
    },
    description: 'Porteur de balle qui élimine les défenseurs'
  },
  'Box-to-Box': {
    metrics: {
      'Successful defensive actions per 90': 0.25,
      'xA per 90': 0.25,
      'Progressive runs per 90': 0.25,
      'Duels won, %': 0.25
    },
    description: 'Milieu complet couvrant tout le terrain'
  },
  'Deep-Lying Playmaker': {
    metrics: {
      'Passes per 90': 0.3,
      'Accurate passes, %': 0.3,
      'Progressive passes per 90': 0.3,
      'Accurate long passes, %': 0.1
    },
    description: 'Régisseur depuis les lignes arrières'
  },
  'Ball-Winning Midfielder': {
    metrics: {
      'PAdj Interceptions': 0.35,
      'Defensive duels won, %': 0.35,
      'Successful defensive actions per 90': 0.3
    },
    description: 'Récupérateur de ballons'
  },
  'Inverted Fullback': {
    metrics: {
      'Progressive passes per 90': 0.3,
      'Passes per 90': 0.3,
      'Accurate passes, %': 0.2,
      'PAdj Interceptions': 0.2
    },
    description: 'Latéral rentrant au milieu'
  },
  'Overlapping Fullback': {
    metrics: {
      'xA per 90': 0.3,
      'Accurate crosses, %': 0.3,
      'Progressive runs per 90': 0.25,
      'Key passes per 90': 0.15
    },
    description: 'Latéral offensif débordant'
  }
};

/**
 * Identifie le style de jeu d'un joueur
 */
export function identifyPlayStyle(
  player: PlayerData,
  availableMetrics: string[]
): { style: string; score: number; description: string }[] {
  const results: { style: string; score: number; description: string }[] = [];

  Object.entries(PLAY_STYLES).forEach(([style, definition]) => {
    let score = 0;
    let totalWeight = 0;

    Object.entries(definition.metrics).forEach(([metric, weight]) => {
      if (availableMetrics.includes(metric)) {
        const value = Number(player[metric]) || 0;
        // Score simple basé sur la valeur normalisée
        score += value * weight;
        totalWeight += weight;
      }
    });

    if (totalWeight > 0) {
      results.push({
        style,
        score: Number((score / totalWeight).toFixed(2)),
        description: definition.description
      });
    }
  });

  return results.sort((a, b) => b.score - a.score);
}

/**
 * Trouve des joueurs avec un style de jeu similaire
 */
export function findSimilarPlayStyle(
  referencePlayer: PlayerData,
  candidates: PlayerData[],
  style: string,
  maxResults: number = 10
): SimilarityResult[] {
  const styleDefinition = PLAY_STYLES[style];
  if (!styleDefinition) {
    return findSimilarPlayers(referencePlayer, candidates, { maxResults });
  }

  // Utiliser les métriques du style comme poids
  return findSimilarPlayers(referencePlayer, candidates, {
    maxResults,
    customWeights: styleDefinition.metrics,
    algorithm: 'weighted'
  });
}

// ============================================
// COMPARISON UTILITIES
// ============================================

/**
 * Compare deux joueurs sur un ensemble de métriques
 */
export function comparePlayers(
  playerA: PlayerData,
  playerB: PlayerData,
  metrics: string[]
): ComparisonResult[] {
  return metrics.map(metric => {
    const valA = Number(playerA[metric]) || 0;
    const valB = Number(playerB[metric]) || 0;
    const diff = valA - valB;
    const percentDiff = valB !== 0 ? ((valA - valB) / valB) * 100 : 0;

    return {
      metric,
      playerA: valA,
      playerB: valB,
      difference: Number(diff.toFixed(2)),
      percentDifference: Number(percentDiff.toFixed(1)),
      winner: diff > 0 ? 'A' : diff < 0 ? 'B' : 'tie'
    };
  });
}

export interface ComparisonResult {
  metric: string;
  playerA: number;
  playerB: number;
  difference: number;
  percentDifference: number;
  winner: 'A' | 'B' | 'tie';
}

/**
 * Génère un rapport de comparaison résumé
 */
export function generateComparisonSummary(
  comparisons: ComparisonResult[]
): { winsA: number; winsB: number; ties: number; advantage: 'A' | 'B' | 'even' } {
  let winsA = 0;
  let winsB = 0;
  let ties = 0;

  comparisons.forEach(c => {
    if (c.winner === 'A') winsA++;
    else if (c.winner === 'B') winsB++;
    else ties++;
  });

  const advantage = winsA > winsB ? 'A' : winsB > winsA ? 'B' : 'even';

  return { winsA, winsB, ties, advantage };
}
