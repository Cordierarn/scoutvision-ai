/**
 * Position-Based Metrics Configuration
 * Définit les métriques pertinentes pour chaque type de position
 */

export type PositionCategory = 'GK' | 'DEF' | 'FB' | 'MID' | 'ATT_MID' | 'WING' | 'FWD';

/**
 * Détermine la catégorie de position d'un joueur
 */
export function getPositionCategory(position: string): PositionCategory {
  if (!position) return 'MID';
  
  const pos = position.toUpperCase().trim();
  
  // Goalkeeper
  if (pos === 'GK') return 'GK';
  
  // Central Defenders
  if (['CB', 'LCB', 'RCB'].includes(pos)) return 'DEF';
  
  // Full-backs / Wing-backs
  if (['LB', 'RB', 'LWB', 'RWB'].includes(pos)) return 'FB';
  
  // Defensive / Central Midfielders
  if (['DMF', 'LDMF', 'RDMF', 'CMF', 'LCMF', 'RCMF'].includes(pos)) return 'MID';
  
  // Attacking Midfielders
  if (['AMF', 'LAMF', 'RAMF'].includes(pos)) return 'ATT_MID';
  
  // Wingers
  if (['LW', 'RW', 'LWF', 'RWF'].includes(pos)) return 'WING';
  
  // Forwards
  if (['CF', 'SS', 'ST'].includes(pos)) return 'FWD';
  
  return 'MID'; // Default
}

/**
 * Métriques par catégorie de position (8 métriques clés pour chaque)
 */
export const POSITION_METRICS: Record<PositionCategory, string[]> = {
  GK: [
    'Save rate, %',
    'Prevented goals per 90',
    'xG against per 90',
    'Exits per 90',
    'Aerial duels won, %',
    'Accurate passes, %',
    'Accurate long passes, %',
    'Clean sheets'
  ],
  
  DEF: [
    'Defensive duels won, %',
    'Aerial duels won, %',
    'PAdj Interceptions',
    'Shots blocked per 90',
    'Successful defensive actions per 90',
    'Accurate passes, %',
    'Progressive passes per 90',
    'Accurate long passes, %'
  ],
  
  FB: [
    'Defensive duels won, %',
    'Crosses per 90',
    'Accurate crosses, %',
    'Progressive runs per 90',
    'Dribbles per 90',
    'Successful dribbles, %',
    'Key passes per 90',
    'Interceptions per 90'
  ],
  
  MID: [
    'Accurate passes, %',
    'Progressive passes per 90',
    'Key passes per 90',
    'Passes to final third per 90',
    'Defensive duels won, %',
    'Duels won, %',
    'xA',
    'Successful defensive actions per 90'
  ],
  
  ATT_MID: [
    'xG',
    'xA',
    'Key passes per 90',
    'Smart passes per 90',
    'Through passes per 90',
    'Dribbles per 90',
    'Successful dribbles, %',
    'Goals per 90'
  ],
  
  WING: [
    'xG',
    'xA',
    'Dribbles per 90',
    'Successful dribbles, %',
    'Crosses per 90',
    'Accurate crosses, %',
    'Progressive runs per 90',
    'Key passes per 90'
  ],
  
  FWD: [
    'Goals per 90',
    'xG per 90',
    'xG',
    'Goal conversion, %',
    'Shots per 90',
    'Shots on target, %',
    'Aerial duels won, %',
    'Touches in box per 90'
  ]
};

/**
 * Métriques pour le calcul de similarité par catégorie
 * Plus de métriques pour un calcul plus précis
 */
export const SIMILARITY_METRICS: Record<PositionCategory, string[]> = {
  GK: [
    'Save rate, %',
    'Prevented goals per 90',
    'xG against per 90',
    'Exits per 90',
    'Aerial duels per 90',
    'Aerial duels won, %',
    'Accurate passes, %',
    'Accurate long passes, %',
    'Received passes per 90',
    'Back passes received as GK per 90'
  ],
  
  DEF: [
    'Defensive duels per 90',
    'Defensive duels won, %',
    'Aerial duels per 90',
    'Aerial duels won, %',
    'PAdj Interceptions',
    'Interceptions per 90',
    'Shots blocked per 90',
    'Successful defensive actions per 90',
    'Accurate passes, %',
    'Accurate long passes, %',
    'Progressive passes per 90',
    'Forward passes per 90'
  ],
  
  FB: [
    'Defensive duels won, %',
    'Successful defensive actions per 90',
    'Interceptions per 90',
    'Crosses per 90',
    'Accurate crosses, %',
    'Progressive runs per 90',
    'Dribbles per 90',
    'Successful dribbles, %',
    'Key passes per 90',
    'xA',
    'Accurate passes, %',
    'Duels won, %'
  ],
  
  MID: [
    'Accurate passes, %',
    'Progressive passes per 90',
    'Forward passes per 90',
    'Key passes per 90',
    'Passes to final third per 90',
    'Defensive duels per 90',
    'Defensive duels won, %',
    'Duels won, %',
    'xA',
    'xG',
    'Successful defensive actions per 90',
    'Interceptions per 90'
  ],
  
  ATT_MID: [
    'xG',
    'xA',
    'Goals per 90',
    'Assists per 90',
    'Key passes per 90',
    'Smart passes per 90',
    'Through passes per 90',
    'Dribbles per 90',
    'Successful dribbles, %',
    'Shots per 90',
    'Offensive duels won, %',
    'Progressive runs per 90'
  ],
  
  WING: [
    'xG',
    'xA',
    'Goals per 90',
    'Assists per 90',
    'Dribbles per 90',
    'Successful dribbles, %',
    'Crosses per 90',
    'Accurate crosses, %',
    'Progressive runs per 90',
    'Key passes per 90',
    'Offensive duels per 90',
    'Accelerations per 90'
  ],
  
  FWD: [
    'Goals per 90',
    'xG per 90',
    'xG',
    'Goal conversion, %',
    'Shots per 90',
    'Shots on target, %',
    'Aerial duels per 90',
    'Aerial duels won, %',
    'Touches in box per 90',
    'Offensive duels per 90',
    'Offensive duels won, %',
    'Head goals per 90'
  ]
};

/**
 * Obtient les métriques de radar adaptées à la position du joueur
 */
export function getRadarMetricsForPosition(position: string): string[] {
  const category = getPositionCategory(position);
  return POSITION_METRICS[category];
}

/**
 * Obtient les métriques de similarité adaptées à la position du joueur
 */
export function getSimilarityMetricsForPosition(position: string): string[] {
  const category = getPositionCategory(position);
  return SIMILARITY_METRICS[category];
}

/**
 * Filtre les métriques disponibles pour ne garder que celles présentes dans les données
 */
export function filterAvailableMetrics(metrics: string[], playerData: Record<string, any>): string[] {
  return metrics.filter(m => playerData[m] !== undefined && typeof playerData[m] === 'number');
}

/**
 * Obtient les 8 meilleures métriques d'un joueur (en percentile vs cohorte)
 */
export function getTopPerformingMetrics(
  player: Record<string, any>,
  cohort: Record<string, any>[],
  count: number = 8
): string[] {
  // Get all numeric metrics
  const numericKeys = Object.keys(player).filter(key => 
    typeof player[key] === 'number' &&
    !['Age', 'Market value', 'Height', 'Weight', 'Matches played', 'Minutes played'].includes(key)
  );
  
  // Calculate percentile for each metric
  const metricsWithPercentile = numericKeys.map(key => {
    const playerVal = Number(player[key]) || 0;
    const values = cohort.map(p => Number(p[key]) || 0).sort((a, b) => a - b);
    const countBelow = values.filter(v => v < playerVal).length;
    const percentile = values.length > 0 ? (countBelow / values.length) * 100 : 50;
    
    return { key, percentile, value: playerVal };
  });
  
  // Sort by percentile descending and take top N
  return metricsWithPercentile
    .filter(m => m.value > 0) // Exclude zero values
    .sort((a, b) => b.percentile - a.percentile)
    .slice(0, count)
    .map(m => m.key);
}

/**
 * Nom de la catégorie de position pour l'affichage
 */
export function getPositionCategoryLabel(category: PositionCategory): string {
  const labels: Record<PositionCategory, string> = {
    GK: 'Goalkeeper',
    DEF: 'Central Defender',
    FB: 'Full-Back',
    MID: 'Midfielder',
    ATT_MID: 'Attacking Mid',
    WING: 'Winger',
    FWD: 'Forward'
  };
  return labels[category];
}
