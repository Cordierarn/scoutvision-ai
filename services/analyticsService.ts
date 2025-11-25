/**
 * ScoutVision AI - Analytics Service
 * Service avancé d'analyse statistique des joueurs
 */

import { 
  PlayerData, 
  MetricBounds, 
  PercentileAnalysis,
  PlayerPercentileProfile,
  ClusterConfig,
  ClusterResult
} from '../types';
import { 
  extractNumericMetricKeys,
  calculateMetricBounds,
  calculateAllMetricBounds,
  normalizeValue,
  calculateZScore,
  calculatePercentile,
  PROFILE_KEYS
} from './playerService';

// ============================================
// PERCENTILE ANALYSIS
// ============================================

/**
 * Analyse complète des percentiles d'un joueur
 */
export function analyzePlayerPercentiles(
  player: PlayerData,
  cohort: PlayerData[],
  metricKeys?: string[]
): PercentileAnalysis[] {
  const keys = metricKeys || extractNumericMetricKeys(cohort);
  const analyses: PercentileAnalysis[] = [];

  keys.forEach(metric => {
    const playerValue = Number(player[metric]) || 0;
    const cohortValues = cohort
      .map(p => Number(p[metric]))
      .filter(v => !isNaN(v) && isFinite(v));

    if (cohortValues.length === 0) return;

    const bounds = calculateMetricBounds(cohort, metric);
    const percentile = calculatePercentile(playerValue, cohortValues);
    const zScore = calculateZScore(playerValue, bounds);

    // Calculer le rang
    const sorted = [...cohortValues].sort((a, b) => b - a);
    const rank = sorted.findIndex(v => v <= playerValue) + 1;

    analyses.push({
      metric,
      value: playerValue,
      percentile,
      zScore: Number(zScore.toFixed(2)),
      cohortMean: Number(bounds.mean.toFixed(2)),
      cohortStdDev: Number(bounds.stdDev.toFixed(2)),
      cohortSize: cohortValues.length,
      rank: rank || cohortValues.length
    });
  });

  // Trier par percentile décroissant
  return analyses.sort((a, b) => b.percentile - a.percentile);
}

/**
 * Génère le profil percentile complet d'un joueur
 */
export function generatePercentileProfile(
  player: PlayerData,
  cohort: PlayerData[]
): PlayerPercentileProfile {
  const metricKeys = extractNumericMetricKeys(cohort);
  const bounds = calculateAllMetricBounds(cohort);
  
  const percentiles: Record<string, number> = {};
  const zScores: Record<string, number> = {};
  const averages: Record<string, number> = {};

  metricKeys.forEach(key => {
    const playerValue = Number(player[key]) || 0;
    const cohortValues = cohort.map(p => Number(p[key]) || 0);
    
    percentiles[key] = calculatePercentile(playerValue, cohortValues);
    zScores[key] = Number(calculateZScore(playerValue, bounds[key]).toFixed(2));
    averages[key] = Number(bounds[key].mean.toFixed(2));
  });

  return {
    player,
    percentiles,
    zScores,
    averages
  };
}

/**
 * Identifie les forces et faiblesses d'un joueur
 */
export function identifyStrengthsAndWeaknesses(
  profile: PlayerPercentileProfile,
  thresholdStrength: number = 75,
  thresholdWeakness: number = 25
): { strengths: string[]; weaknesses: string[]; average: string[] } {
  const strengths: string[] = [];
  const weaknesses: string[] = [];
  const average: string[] = [];

  Object.entries(profile.percentiles).forEach(([metric, percentile]) => {
    if (percentile >= thresholdStrength) {
      strengths.push(metric);
    } else if (percentile <= thresholdWeakness) {
      weaknesses.push(metric);
    } else {
      average.push(metric);
    }
  });

  return { strengths, weaknesses, average };
}

// ============================================
// RADAR CHART DATA
// ============================================

/**
 * Prépare les données pour un graphique radar
 */
export function prepareRadarData(
  player: PlayerData,
  cohort: PlayerData[],
  metrics: string[]
): Array<{
  subject: string;
  fullSubject: string;
  value: number;
  percentile: number;
  cohortAvg: number;
  fullMark: number;
}> {
  const bounds = calculateAllMetricBounds(cohort);

  return metrics.map(metric => {
    const playerValue = Number(player[metric]) || 0;
    const cohortValues = cohort.map(p => Number(p[metric]) || 0);
    const percentile = calculatePercentile(playerValue, cohortValues);
    
    // Label raccourci pour l'affichage
    const label = metric.length > 15 
      ? metric.substring(0, 12) + '..' 
      : metric;

    return {
      subject: label,
      fullSubject: metric,
      value: playerValue,
      percentile,
      cohortAvg: bounds[metric]?.mean || 0,
      fullMark: 100
    };
  });
}

/**
 * Sélectionne automatiquement les meilleures métriques pour un radar
 * basé sur la position du joueur
 */
export function selectMetricsForPosition(
  position: string,
  availableMetrics: string[]
): string[] {
  const positionMetricMap: Record<string, string[]> = {
    'GK': [
      'Save rate, %', 'Prevented goals per 90', 'Exits per 90',
      'Accurate passes, %', 'Accurate long passes, %', 'Clean sheets'
    ],
    'CB': [
      'Defensive duels won, %', 'Aerial duels won, %', 'PAdj Interceptions',
      'Accurate passes, %', 'Progressive passes per 90', 'Shots blocked per 90'
    ],
    'LB': [
      'xA per 90', 'Key passes per 90', 'Progressive passes per 90',
      'Accurate crosses, %', 'Defensive duels won, %', 'Progressive runs per 90'
    ],
    'RB': [
      'xA per 90', 'Key passes per 90', 'Progressive passes per 90',
      'Accurate crosses, %', 'Defensive duels won, %', 'Progressive runs per 90'
    ],
    'DMF': [
      'PAdj Interceptions', 'Defensive duels won, %', 'Passes per 90',
      'Accurate passes, %', 'Progressive passes per 90', 'Duels won, %'
    ],
    'CMF': [
      'xA per 90', 'Key passes per 90', 'Progressive passes per 90',
      'xG per 90', 'Accurate passes, %', 'Duels won, %'
    ],
    'AMF': [
      'xA per 90', 'xG per 90', 'Key passes per 90',
      'Shot assists per 90', 'Progressive runs per 90', 'Dribbles per 90'
    ],
    'LW': [
      'xG per 90', 'xA per 90', 'Dribbles per 90',
      'Successful dribbles, %', 'Key passes per 90', 'Shots per 90'
    ],
    'RW': [
      'xG per 90', 'xA per 90', 'Dribbles per 90',
      'Successful dribbles, %', 'Key passes per 90', 'Shots per 90'
    ],
    'CF': [
      'xG per 90', 'Goals per 90', 'Shots on target, %',
      'Touches in box per 90', 'Aerial duels won, %', 'Offensive duels won, %'
    ]
  };

  // Trouver les métriques par défaut pour la position
  const primaryPosition = position.split(',')[0]?.trim() || 'CMF';
  let targetMetrics = positionMetricMap[primaryPosition] || positionMetricMap['CMF'];

  // Filtrer les métriques disponibles
  const result = targetMetrics.filter(m => availableMetrics.includes(m));

  // Si pas assez de métriques, ajouter des métriques génériques
  if (result.length < 6) {
    const genericMetrics = [
      'xG', 'xA', 'Passes per 90', 'Accurate passes, %',
      'Duels won, %', 'Successful defensive actions per 90'
    ];
    genericMetrics.forEach(m => {
      if (!result.includes(m) && availableMetrics.includes(m) && result.length < 8) {
        result.push(m);
      }
    });
  }

  return result.slice(0, 8);
}

// ============================================
// DISTRIBUTION ANALYSIS
// ============================================

/**
 * Calcule la distribution des valeurs d'une métrique
 */
export function calculateDistribution(
  data: PlayerData[],
  metric: string,
  bins: number = 10
): { range: string; count: number; percentage: number }[] {
  const values = data
    .map(p => Number(p[metric]))
    .filter(v => !isNaN(v) && isFinite(v));

  if (values.length === 0) return [];

  const min = Math.min(...values);
  const max = Math.max(...values);
  const binWidth = (max - min) / bins;

  const distribution: { range: string; count: number; percentage: number }[] = [];

  for (let i = 0; i < bins; i++) {
    const binMin = min + (i * binWidth);
    const binMax = min + ((i + 1) * binWidth);
    const count = values.filter(v => v >= binMin && (i === bins - 1 ? v <= binMax : v < binMax)).length;
    
    distribution.push({
      range: `${binMin.toFixed(1)}-${binMax.toFixed(1)}`,
      count,
      percentage: Number(((count / values.length) * 100).toFixed(1))
    });
  }

  return distribution;
}

/**
 * Détecte les outliers (valeurs aberrantes)
 */
export function detectOutliers(
  data: PlayerData[],
  metric: string,
  threshold: number = 2.5 // Z-score threshold
): { player: PlayerData; value: number; zScore: number }[] {
  const bounds = calculateMetricBounds(data, metric);
  const outliers: { player: PlayerData; value: number; zScore: number }[] = [];

  data.forEach(player => {
    const value = Number(player[metric]);
    if (isNaN(value)) return;

    const zScore = calculateZScore(value, bounds);
    if (Math.abs(zScore) > threshold) {
      outliers.push({
        player,
        value,
        zScore: Number(zScore.toFixed(2))
      });
    }
  });

  return outliers.sort((a, b) => Math.abs(b.zScore) - Math.abs(a.zScore));
}

// ============================================
// K-MEANS CLUSTERING
// ============================================

/**
 * Implémentation simple du clustering K-means
 */
export function kMeansClustering(
  data: PlayerData[],
  config: ClusterConfig
): ClusterResult[] {
  const { k, maxIterations, metrics } = config;
  
  if (data.length < k || metrics.length === 0) {
    return [];
  }

  // Normaliser les données
  const bounds: Record<string, MetricBounds> = {};
  metrics.forEach(m => {
    bounds[m] = calculateMetricBounds(data, m);
  });

  // Créer les vecteurs normalisés
  const vectors: { player: PlayerData; vector: number[] }[] = data.map(player => ({
    player,
    vector: metrics.map(m => normalizeValue(Number(player[m]) || 0, bounds[m]))
  }));

  // Initialiser les centroides aléatoirement
  const shuffled = [...vectors].sort(() => Math.random() - 0.5);
  let centroids = shuffled.slice(0, k).map(v => [...v.vector]);

  // Assignments
  let assignments: number[] = new Array(vectors.length).fill(0);

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const newAssignments: number[] = [];

    // Assigner chaque point au centroide le plus proche
    vectors.forEach(({ vector }) => {
      let minDist = Infinity;
      let minIndex = 0;

      centroids.forEach((centroid, idx) => {
        const dist = euclideanDistance(vector, centroid);
        if (dist < minDist) {
          minDist = dist;
          minIndex = idx;
        }
      });

      newAssignments.push(minIndex);
    });

    // Vérifier la convergence
    if (arraysEqual(assignments, newAssignments)) {
      break;
    }
    assignments = newAssignments;

    // Recalculer les centroides
    centroids = centroids.map((_, clusterIdx) => {
      const clusterVectors = vectors
        .filter((_, i) => assignments[i] === clusterIdx)
        .map(v => v.vector);

      if (clusterVectors.length === 0) {
        return centroids[clusterIdx]; // Garder l'ancien si cluster vide
      }

      return clusterVectors[0].map((_, dimIdx) => {
        const sum = clusterVectors.reduce((acc, v) => acc + v[dimIdx], 0);
        return sum / clusterVectors.length;
      });
    });
  }

  // Construire les résultats
  const results: ClusterResult[] = centroids.map((centroid, idx) => {
    const clusterPlayers = vectors
      .filter((_, i) => assignments[i] === idx)
      .map(v => v.player);

    return {
      clusterId: idx,
      centroid,
      players: clusterPlayers,
      size: clusterPlayers.length,
      label: generateClusterLabel(clusterPlayers, metrics, bounds)
    };
  });

  return results.filter(r => r.size > 0).sort((a, b) => b.size - a.size);
}

/**
 * Distance euclidienne entre deux vecteurs
 */
function euclideanDistance(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += Math.pow(a[i] - b[i], 2);
  }
  return Math.sqrt(sum);
}

/**
 * Compare deux tableaux
 */
function arraysEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((val, idx) => val === b[idx]);
}

/**
 * Génère un label descriptif pour un cluster
 */
function generateClusterLabel(
  players: PlayerData[],
  metrics: string[],
  bounds: Record<string, MetricBounds>
): string {
  if (players.length === 0) return 'Empty';

  // Calculer les moyennes du cluster
  const clusterMeans: Record<string, number> = {};
  metrics.forEach(m => {
    const values = players.map(p => Number(p[m]) || 0);
    clusterMeans[m] = values.reduce((a, b) => a + b, 0) / values.length;
  });

  // Trouver les métriques où le cluster excelle
  const strengths: string[] = [];
  metrics.forEach(m => {
    const normalized = normalizeValue(clusterMeans[m], bounds[m]);
    if (normalized > 0.7) {
      strengths.push(m.split(' ')[0]); // Premier mot de la métrique
    }
  });

  if (strengths.length > 0) {
    return `High ${strengths.slice(0, 2).join('/')}`;
  }

  // Sinon, label générique basé sur la position dominante
  const positions: Record<string, number> = {};
  players.forEach(p => {
    const pos = p.Position?.split(',')[0]?.trim() || 'Unknown';
    positions[pos] = (positions[pos] || 0) + 1;
  });

  const dominantPos = Object.entries(positions)
    .sort((a, b) => b[1] - a[1])[0];

  return dominantPos ? `${dominantPos[0]} Group` : 'Mixed';
}

// ============================================
// TREND ANALYSIS
// ============================================

/**
 * Compare les stats d'un joueur entre deux saisons
 */
export function compareSeasons(
  currentSeason: PlayerData,
  previousSeason: PlayerData | null,
  metrics: string[]
): { metric: string; current: number; previous: number | null; change: number | null; trend: 'up' | 'down' | 'stable' }[] {
  return metrics.map(metric => {
    const current = Number(currentSeason[metric]) || 0;
    const previous = previousSeason ? Number(previousSeason[metric]) || null : null;
    
    let change: number | null = null;
    let trend: 'up' | 'down' | 'stable' = 'stable';

    if (previous !== null && previous !== 0) {
      change = ((current - previous) / previous) * 100;
      if (change > 5) trend = 'up';
      else if (change < -5) trend = 'down';
    }

    return {
      metric,
      current: Number(current.toFixed(2)),
      previous: previous !== null ? Number(previous.toFixed(2)) : null,
      change: change !== null ? Number(change.toFixed(1)) : null,
      trend
    };
  });
}

// ============================================
// CORRELATION ANALYSIS
// ============================================

/**
 * Calcule la corrélation de Pearson entre deux métriques
 */
export function calculateCorrelation(
  data: PlayerData[],
  metricA: string,
  metricB: string
): number {
  const pairs = data
    .map(p => ({
      a: Number(p[metricA]),
      b: Number(p[metricB])
    }))
    .filter(p => !isNaN(p.a) && !isNaN(p.b) && isFinite(p.a) && isFinite(p.b));

  if (pairs.length < 3) return 0;

  const n = pairs.length;
  const sumA = pairs.reduce((acc, p) => acc + p.a, 0);
  const sumB = pairs.reduce((acc, p) => acc + p.b, 0);
  const sumAB = pairs.reduce((acc, p) => acc + p.a * p.b, 0);
  const sumA2 = pairs.reduce((acc, p) => acc + p.a * p.a, 0);
  const sumB2 = pairs.reduce((acc, p) => acc + p.b * p.b, 0);

  const numerator = n * sumAB - sumA * sumB;
  const denominator = Math.sqrt(
    (n * sumA2 - sumA * sumA) * (n * sumB2 - sumB * sumB)
  );

  if (denominator === 0) return 0;

  return Number((numerator / denominator).toFixed(3));
}

/**
 * Trouve les métriques les plus corrélées avec une métrique cible
 */
export function findCorrelatedMetrics(
  data: PlayerData[],
  targetMetric: string,
  availableMetrics: string[],
  topN: number = 5
): { metric: string; correlation: number }[] {
  const correlations = availableMetrics
    .filter(m => m !== targetMetric)
    .map(metric => ({
      metric,
      correlation: calculateCorrelation(data, targetMetric, metric)
    }))
    .sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));

  return correlations.slice(0, topN);
}

// ============================================
// POSITION VALUE METRICS (PVM)
// ============================================

/**
 * Calcule un score de valeur composite pour un joueur
 * basé sur sa position et ses métriques
 */
export function calculatePositionValue(
  player: PlayerData,
  cohort: PlayerData[]
): { score: number; breakdown: Record<string, number> } {
  const position = player.Position?.split(',')[0]?.trim() || 'CMF';
  const metricKeys = extractNumericMetricKeys(cohort);
  const selectedMetrics = selectMetricsForPosition(position, metricKeys);
  
  const breakdown: Record<string, number> = {};
  let totalScore = 0;

  selectedMetrics.forEach(metric => {
    const playerValue = Number(player[metric]) || 0;
    const cohortValues = cohort.map(p => Number(p[metric]) || 0);
    const percentile = calculatePercentile(playerValue, cohortValues);
    
    breakdown[metric] = percentile;
    totalScore += percentile;
  });

  const averageScore = selectedMetrics.length > 0 
    ? totalScore / selectedMetrics.length 
    : 50;

  return {
    score: Math.round(averageScore),
    breakdown
  };
}

/**
 * Identifie les prospects à haut potentiel
 */
export function identifyHighPotentialProspects(
  data: PlayerData[],
  maxAge: number = 23,
  minScore: number = 70
): Array<{ player: PlayerData; score: number; valueRatio: number }> {
  const youngPlayers = data.filter(p => {
    const age = Number(p.Age) || 0;
    return age <= maxAge && age >= 16;
  });

  const results = youngPlayers.map(player => {
    const { score } = calculatePositionValue(player, data);
    const marketValue = Number(player['Market value']) || 1;
    const valueRatio = score / (marketValue / 1000000); // Score par million

    return { player, score, valueRatio };
  });

  return results
    .filter(r => r.score >= minScore)
    .sort((a, b) => b.valueRatio - a.valueRatio);
}
