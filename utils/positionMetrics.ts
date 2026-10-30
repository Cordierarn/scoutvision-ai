/**
 * Position-Based Metrics Configuration
 * Définit les métriques pertinentes pour chaque type de position
 */

export type PositionCategory = 'GK' | 'DEF' | 'FB' | 'MID' | 'ATT_MID' | 'WING' | 'FWD';

/**
 * Détermine la catégorie de position d'un joueur
 * Rôles PitchAPI : GK, CB, FB, WB, DM, CM, AM, W, ST
 */
export function getPositionCategory(position: string): PositionCategory {
  if (!position) return 'MID';

  switch (position.toUpperCase().trim()) {
    case 'GK': return 'GK';
    case 'CB': return 'DEF';
    case 'FB':
    case 'WB': return 'FB';
    case 'DM':
    case 'CM': return 'MID';
    case 'AM': return 'ATT_MID';
    case 'W': return 'WING';
    case 'ST': return 'FWD';
    default: return 'MID';
  }
}

/**
 * Métriques par catégorie de position (8 métriques d'action, plus une métrique de valeur de
 * possession déjà calculée par le pipeline, choisie selon le poste : xT pour la progression du
 * ballon, VAEP pour la contribution totale, VAEP défensive pour les postes de récupération)
 */
export const POSITION_METRICS: Record<PositionCategory, string[]> = {
  GK: [
    'Save rate, %',
    'Prevented goals per 90',
    'xGOT against per 90',
    'Exits per 90',
    'High claims per 90',
    'Claim rate, %',
    'Accurate passes, %',
    'Accurate long passes, %'
  ],

  DEF: [
    'Ground duels won, %',
    'Aerial duels won, %',
    'PAdj Interceptions',
    'PAdj Tackles',
    'Shots blocked per 90',
    'Accurate passes, %',
    'Progressive passes per 90',
    'Accurate long passes, %',
    'VAEP defensive per 90'
  ],

  FB: [
    'Ground duels won, %',
    'Crosses per 90',
    'Accurate crosses, %',
    'Progressive runs per 90',
    'Dribbles per 90',
    'Key passes per 90',
    'xA per 90',
    'PAdj Interceptions',
    'xT per 90'
  ],

  MID: [
    'Accurate passes, %',
    'Progressive passes per 90',
    'Key passes per 90',
    'Passes to final third per 90',
    'Ground duels won, %',
    'PAdj Recoveries',
    'xG buildup per 90',
    'Successful defensive actions per 90',
    'VAEP per 90'
  ],

  ATT_MID: [
    'xG per 90',
    'xA per 90',
    'Key passes per 90',
    'Shot-creating actions per 90',
    'Through passes per 90',
    'Dribbles per 90',
    'Successful dribbles, %',
    'Goals per 90',
    'xT per 90'
  ],

  WING: [
    'xG per 90',
    'xA per 90',
    'Dribbles per 90',
    'Successful dribbles, %',
    'Crosses per 90',
    'Progressive runs per 90',
    'Carries into box per 90',
    'Key passes per 90',
    'xT per 90'
  ],

  FWD: [
    'Goals per 90',
    'npxG per 90',
    'xGOT per 90',
    'Shots per 90',
    'Shots on target, %',
    'Touches in box per 90',
    'Aerial duels won, %',
    'xA per 90',
    'VAEP per 90'
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
    'xGOT against per 90',
    'Exits per 90',
    'High claims per 90',
    'Punches per 90',
    'Claim rate, %',
    'Launch rate, %',
    'Accurate passes, %',
    'Accurate long passes, %',
    'Passes per 90',
    'Distribution accuracy, %'
  ],

  DEF: [
    'Duels won per 90',
    'Ground duels won, %',
    'Aerial duels per 90',
    'Aerial duels won, %',
    'PAdj Interceptions',
    'PAdj Tackles',
    'Shots blocked per 90',
    'Clearances per 90',
    'Accurate passes, %',
    'Accurate long passes, %',
    'Progressive passes per 90',
    'Progressive runs per 90'
  ],

  FB: [
    'Ground duels won, %',
    'Successful defensive actions per 90',
    'PAdj Interceptions',
    'Crosses per 90',
    'Accurate crosses, %',
    'Progressive runs per 90',
    'Dribbles per 90',
    'Successful dribbles, %',
    'Key passes per 90',
    'xA per 90',
    'Accurate passes, %',
    'Duels won, %'
  ],

  MID: [
    'Accurate passes, %',
    'Passes per 90',
    'Progressive passes per 90',
    'Key passes per 90',
    'Passes to final third per 90',
    'Ground duels won, %',
    'PAdj Recoveries',
    'PAdj Interceptions',
    'xA per 90',
    'xG per 90',
    'xG buildup per 90',
    'Progressive runs per 90'
  ],

  ATT_MID: [
    'xG per 90',
    'xA per 90',
    'Goals per 90',
    'Assists per 90',
    'Key passes per 90',
    'Shot-creating actions per 90',
    'Through passes per 90',
    'Dribbles per 90',
    'Successful dribbles, %',
    'Shots per 90',
    'Passes to penalty area per 90',
    'Progressive runs per 90'
  ],

  WING: [
    'xG per 90',
    'xA per 90',
    'Goals per 90',
    'Assists per 90',
    'Dribbles per 90',
    'Successful dribbles, %',
    'Crosses per 90',
    'Accurate crosses, %',
    'Progressive runs per 90',
    'Carries into box per 90',
    'Key passes per 90',
    'Touches in box per 90'
  ],

  FWD: [
    'Goals per 90',
    'xG per 90',
    'npxG per 90',
    'xGOT per 90',
    'Shots per 90',
    'Shots on target, %',
    'Aerial duels per 90',
    'Aerial duels won, %',
    'Touches in box per 90',
    'Big chances missed per 90',
    'xA per 90',
    'Dribbles per 90'
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
  // Métriques qui ont un percentile précalculé par rôle ("<métrique> pct")
  const withPercentile = Object.keys(player)
    .filter(key => key.endsWith(' pct') && typeof player[key] === 'number')
    .map(key => ({ key: key.slice(0, -4), percentile: player[key] as number }))
    .filter(m => typeof player[m.key] === 'number' && player[m.key] > 0);

  if (withPercentile.length > 0) {
    return withPercentile
      .sort((a, b) => b.percentile - a.percentile)
      .slice(0, count)
      .map(m => m.key);
  }

  // Repli : percentile calculé sur la cohorte
  const numericKeys = Object.keys(player).filter(key => 
    typeof player[key] === 'number' &&
    !['Age', 'Market value', 'Matches played', 'Starts', 'Minutes played', 'Minutes share', 'League tier'].includes(key)
  );
  
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
    GK: 'Gardien',
    DEF: 'Défenseur central',
    FB: 'Latéral',
    MID: 'Milieu',
    ATT_MID: 'Milieu offensif',
    WING: 'Ailier',
    FWD: 'Attaquant'
  };
  return labels[category];
}

/**
 * Colonnes numériques qui décrivent le contexte, pas la performance
 */
export const NON_METRIC_KEYS = new Set([
  'Age', 'Market value', 'Height', 'Matches played', 'Starts', 'Minutes played', 'Minutes share',
  'Analytics coverage', 'League tier', 'Team possession, %', 'Team PPDA', 'Team field tilt',
  'RAPM minutes', 'Career shots', 'Career goals - xG', 'Network matches', 'Estimated value'
]);

/**
 * Vrai si la colonne est une métrique de performance (hors percentiles "<métrique> pct")
 */
export function isMetricKey(key: string, value: unknown): boolean {
  return typeof value === 'number' && !key.endsWith(' pct') && !NON_METRIC_KEYS.has(key);
}

/**
 * Métriques présentes chez au moins un joueur (un joueur sans analytics n'a pas toutes les colonnes)
 */
export function getMetricKeys(players: Record<string, any>[]): string[] {
  const keys = new Set<string>();
  players.forEach(p => {
    Object.keys(p).forEach(key => {
      if (isMetricKey(key, p[key])) keys.add(key);
    });
  });
  return Array.from(keys).sort();
}
