/**
 * ScoutVision AI - Scoring Utils
 * Système avancé de scoring et d'évaluation de joueurs par rôle
 */

import { PlayerData, RoleDefinition, RoleScoreResult, RoleCategory, MetricBounds } from '../types';

// ============================================
// ROLE DEFINITIONS - Expanded & Refined
// ============================================

/**
 * Définitions complètes des rôles avec métriques pondérées
 *
 * @deprecated Ancien système de rôles, conservé pour comparaison. La source de vérité des
 * rôles tactiques est utils/rolePresets.json (rolePresets.ts : roleIndex, roleIndexBreakdown,
 * rankPresets), utilisée par la fiche joueur, le Chasseur de pépites, le recrutement et
 * scripts/models.py. Plus aucun écran n'affiche ces scores.
 */
export const ROLE_DEFINITIONS: Record<string, RoleDefinition> = {
  // ========== GOALKEEPERS ==========
  'Shot-Stopping Goalkeeper': {
    name: 'Shot-Stopping Goalkeeper',
    category: 'goalkeeper',
    positions: ['GK'],
    metrics: {
      'Prevented goals per 90': 0.30,
      'Save rate, %': 0.30,
      'xGOT against per 90': -0.10, // Négatif = moins c'est mieux
      'High claims per 90': 0.10,
      'Claim rate, %': 0.10,
      'Conceded goals per 90': -0.10 // Négatif = moins c'est mieux
    },
    description: 'Gardien spécialisé dans les arrêts réflexes'
  },
  'Sweeper Keeper': {
    name: 'Sweeper Keeper',
    category: 'goalkeeper',
    positions: ['GK'],
    metrics: {
      'Exits per 90': 0.25,
      'Accurate passes, %': 0.20,
      'Accurate long passes, %': 0.15,
      'Save rate, %': 0.15,
      'Prevented goals per 90': 0.10,
      'High claims per 90': 0.10,
      'Passes per 90': 0.05
    },
    description: 'Gardien libéro qui sort de sa surface et participe au jeu'
  },
  'Ball-Playing Goalkeeper': {
    name: 'Ball-Playing Goalkeeper',
    category: 'goalkeeper',
    positions: ['GK'],
    metrics: {
      'Accurate passes, %': 0.25,
      'Passes per 90': 0.20,
      'Accurate long passes, %': 0.15,
      'Save rate, %': 0.15,
      'Distribution accuracy, %': 0.10,
      'Launch rate, %': -0.10, // Négatif = moins c'est mieux
      'Prevented goals per 90': 0.05
    },
    description: 'Gardien moderne excellent dans la relance'
  },

  // ========== DEFENDERS ==========
  'Defensive CB': {
    name: 'Defensive CB',
    category: 'defender',
    positions: ['CB'],
    metrics: {
      'Ground duels won, %': 0.20,
      'Aerial duels won, %': 0.20,
      'PAdj Interceptions': 0.15,
      'Shots blocked per 90': 0.12,
      'Clearances per 90': 0.12,
      'Duels won, %': 0.10,
      'PAdj Tackles': 0.06,
      'Fouls per 90': -0.05 // Négatif = moins c'est mieux
    },
    description: 'Défenseur central robuste et dominant dans les duels'
  },
  'Ball-Playing CB': {
    name: 'Ball-Playing CB',
    category: 'defender',
    positions: ['CB'],
    metrics: {
      'Progressive passes per 90': 0.22,
      'Accurate passes, %': 0.18,
      'Accurate long passes, %': 0.15,
      'Passes to final third per 90': 0.12,
      'Ground duels won, %': 0.12,
      'Passes per 90': 0.08,
      'PAdj Interceptions': 0.08,
      'xG buildup per 90': 0.05
    },
    description: 'Défenseur technique excellent dans la relance'
  },
  'Wide CB': {
    name: 'Wide CB',
    category: 'defender',
    positions: ['CB'],
    metrics: {
      'Progressive runs per 90': 0.20,
      'Progressive passes per 90': 0.18,
      'Ground duels won, %': 0.15,
      'Accurate passes, %': 0.12,
      'Aerial duels won, %': 0.12,
      'Dribbles per 90': 0.08,
      'Successful defensive actions per 90': 0.10,
      'PAdj Interceptions': 0.05
    },
    description: 'Défenseur central capable de jouer large en 3 défenseurs'
  },
  'Attacking Fullback': {
    name: 'Attacking Fullback',
    category: 'defender',
    positions: ['FB', 'WB'],
    metrics: {
      'xA per 90': 0.18,
      'Key passes per 90': 0.15,
      'Accurate crosses, %': 0.14,
      'Progressive runs per 90': 0.14,
      'Crosses per 90': 0.10,
      'Dribbles per 90': 0.08,
      'Ground duels won, %': 0.10,
      'Successful dribbles, %': 0.06,
      'Passes to penalty area per 90': 0.05
    },
    description: 'Latéral offensif apportant le surnombre'
  },
  'Defensive Fullback': {
    name: 'Defensive Fullback',
    category: 'defender',
    positions: ['FB', 'WB'],
    metrics: {
      'Ground duels won, %': 0.25,
      'PAdj Interceptions': 0.20,
      'Aerial duels won, %': 0.15,
      'Accurate passes, %': 0.15,
      'PAdj Tackles': 0.12,
      'Duels won, %': 0.08,
      'Fouls per 90': -0.05 // Négatif = moins c'est mieux
    },
    description: 'Latéral défensif solide'
  },
  'Inverted Fullback': {
    name: 'Inverted Fullback',
    category: 'defender',
    positions: ['FB', 'WB'],
    metrics: {
      'Progressive passes per 90': 0.22,
      'Passes per 90': 0.18,
      'Accurate passes, %': 0.15,
      'Key passes per 90': 0.12,
      'PAdj Interceptions': 0.12,
      'Passes to final third per 90': 0.10,
      'xG buildup per 90': 0.06,
      'Ground duels won, %': 0.05
    },
    description: 'Latéral rentrant dans l\'entrejeu (style Cancelo/Walker)'
  },

  // ========== MIDFIELDERS ==========
  'Defensive Mid': {
    name: 'Defensive Mid',
    category: 'midfielder',
    positions: ['DM', 'CM'],
    metrics: {
      'PAdj Interceptions': 0.22,
      'Ground duels won, %': 0.20,
      'PAdj Tackles': 0.18,
      'Aerial duels won, %': 0.12,
      'Accurate passes, %': 0.10,
      'Duels won per 90': 0.08,
      'Shots blocked per 90': 0.05,
      'Fouls per 90': -0.05 // Négatif = moins c'est mieux
    },
    description: 'Sentinelle récupératrice devant la défense'
  },
  'Deep-Lying Playmaker': {
    name: 'Deep-Lying Playmaker',
    category: 'midfielder',
    positions: ['DM', 'CM'],
    metrics: {
      'Progressive passes per 90': 0.22,
      'Passes per 90': 0.18,
      'Accurate passes, %': 0.15,
      'Passes to final third per 90': 0.12,
      'Accurate long passes, %': 0.10,
      'xG buildup per 90': 0.08,
      'PAdj Interceptions': 0.08,
      'xA per 90': 0.07
    },
    description: 'Régisseur dictant le tempo depuis la base (style Busquets/Pirlo)'
  },
  'Ball-Winning Midfielder': {
    name: 'Ball-Winning Midfielder',
    category: 'midfielder',
    positions: ['DM', 'CM'],
    metrics: {
      'PAdj Tackles': 0.25,
      'PAdj Recoveries': 0.22,
      'Ground duels won, %': 0.20,
      'Duels won per 90': 0.15,
      'Aerial duels won, %': 0.08,
      'PAdj Interceptions': 0.05,
      'Fouls per 90': -0.05 // Négatif = moins c'est mieux
    },
    description: 'Milieu récupérateur agressif (style Kanté/Ndidi)'
  },
  'Box-to-Box': {
    name: 'Box-to-Box',
    category: 'midfielder',
    positions: ['CM', 'DM', 'AM'],
    metrics: {
      'Progressive runs per 90': 0.15,
      'Successful defensive actions per 90': 0.15,
      'xA per 90': 0.12,
      'Duels won, %': 0.12,
      'xG per 90': 0.10,
      'Passes per 90': 0.10,
      'Key passes per 90': 0.08,
      'PAdj Recoveries': 0.08,
      'Touches in box per 90': 0.05,
      'Shots per 90': 0.05
    },
    description: 'Milieu complet couvrant tout le terrain (style Bellingham/Goretzka)'
  },
  'Mezzala': {
    name: 'Mezzala',
    category: 'midfielder',
    positions: ['CM', 'AM'],
    metrics: {
      'Progressive runs per 90': 0.20,
      'xA per 90': 0.18,
      'Key passes per 90': 0.15,
      'Dribbles per 90': 0.12,
      'xG per 90': 0.12,
      'Successful dribbles, %': 0.08,
      'Touches in box per 90': 0.08,
      'Shot-creating actions per 90': 0.07
    },
    description: 'Milieu offensif infiltrant sur les côtés (style Barella)'
  },
  'Carrilero': {
    name: 'Carrilero',
    category: 'midfielder',
    positions: ['CM', 'DM'],
    metrics: {
      'Passes per 90': 0.20,
      'Accurate passes, %': 0.18,
      'Successful defensive actions per 90': 0.15,
      'Progressive passes per 90': 0.15,
      'Duels won, %': 0.12,
      'PAdj Interceptions': 0.10,
      'Passes to final third per 90': 0.10
    },
    description: 'Milieu relayeur équilibré faisant la liaison'
  },
  'Advanced Playmaker': {
    name: 'Advanced Playmaker',
    category: 'midfielder',
    positions: ['AM', 'CM'],
    metrics: {
      'xA per 90': 0.22,
      'Key passes per 90': 0.18,
      'Shot-creating actions per 90': 0.15,
      'Progressive passes per 90': 0.12,
      'Big chances created per 90': 0.10,
      'Passes to penalty area per 90': 0.08,
      'Through passes per 90': 0.08,
      'xT per 90': 0.07
    },
    description: 'Meneur de jeu créatif dans les 30 derniers mètres (style De Bruyne/Özil)'
  },
  'Shadow Striker': {
    name: 'Shadow Striker',
    category: 'midfielder',
    positions: ['AM', 'ST'],
    metrics: {
      'xG per 90': 0.25,
      'Goals per 90': 0.20,
      'Shots per 90': 0.15,
      'Touches in box per 90': 0.15,
      'Shots on target, %': 0.10,
      'Carries into box per 90': 0.08,
      'xA per 90': 0.07
    },
    description: 'Second attaquant se projetant dans la surface (style Müller)'
  },
  'Trequartista': {
    name: 'Trequartista',
    category: 'midfielder',
    positions: ['AM'],
    metrics: {
      'xA per 90': 0.20,
      'xG per 90': 0.18,
      'Key passes per 90': 0.15,
      'Dribbles per 90': 0.12,
      'Shot-creating actions per 90': 0.10,
      'Successful dribbles, %': 0.10,
      'Through passes per 90': 0.08,
      'Touches in box per 90': 0.07
    },
    description: 'Fantaisiste libre créateur et buteur (style Dybala/Riquelme)'
  },

  // ========== ATTACKERS ==========
  'Inside Forward': {
    name: 'Inside Forward',
    category: 'attacker',
    positions: ['W', 'AM'],
    metrics: {
      'xG per 90': 0.22,
      'Goals per 90': 0.18,
      'Shots per 90': 0.12,
      'Shots on target, %': 0.12,
      'Dribbles per 90': 0.10,
      'Touches in box per 90': 0.10,
      'Successful dribbles, %': 0.08,
      'npxG per 90': 0.08
    },
    description: 'Ailier rentrant buteur coupant vers le but (style Salah/Robben)'
  },
  'Inverted Winger': {
    name: 'Inverted Winger',
    category: 'attacker',
    positions: ['W', 'AM'],
    metrics: {
      'xA per 90': 0.20,
      'Key passes per 90': 0.18,
      'Progressive passes per 90': 0.15,
      'Dribbles per 90': 0.12,
      'Shot-creating actions per 90': 0.10,
      'Passes to penalty area per 90': 0.10,
      'Through passes per 90': 0.08,
      'Successful dribbles, %': 0.07
    },
    description: 'Ailier inversé créateur orienté passe (style Messi/Griezmann)'
  },
  'Traditional Winger': {
    name: 'Traditional Winger',
    category: 'attacker',
    positions: ['W', 'WB'],
    metrics: {
      'Accurate crosses, %': 0.20,
      'Crosses per 90': 0.18,
      'xA per 90': 0.15,
      'Dribbles per 90': 0.15,
      'Successful dribbles, %': 0.12,
      'Progressive runs per 90': 0.10,
      'Carries into final third per 90': 0.05,
      'Key passes per 90': 0.05
    },
    description: 'Ailier débordant classique qui centre'
  },
  'Wide Playmaker': {
    name: 'Wide Playmaker',
    category: 'attacker',
    positions: ['W', 'AM'],
    metrics: {
      'xA per 90': 0.22,
      'Key passes per 90': 0.18,
      'Progressive passes per 90': 0.15,
      'Shot-creating actions per 90': 0.12,
      'Passes to penalty area per 90': 0.10,
      'Passes per 90': 0.08,
      'Through passes per 90': 0.08,
      'Accurate passes, %': 0.07
    },
    description: 'Ailier créateur organisateur depuis l\'aile'
  },
  'Advanced Striker': {
    name: 'Advanced Striker',
    category: 'attacker',
    positions: ['ST'],
    metrics: {
      'xG per 90': 0.22,
      'Goals per 90': 0.18,
      'Shots on target, %': 0.15,
      'Touches in box per 90': 0.12,
      'Progressive runs per 90': 0.10,
      'Shots per 90': 0.08,
      'xGOT per 90': 0.08,
      'npxG per 90': 0.07
    },
    description: 'Attaquant de pointe complet (style Lewandowski/Haaland)'
  },
  'Poacher': {
    name: 'Poacher',
    category: 'attacker',
    positions: ['ST'],
    metrics: {
      'Goals per 90': 0.28,
      'xG per 90': 0.22,
      'Shots on target, %': 0.18,
      'Touches in box per 90': 0.15,
      'xGOT per 90': 0.12,
      'npxG per 90': 0.05
    },
    description: 'Renard des surfaces finisseur (style Inzaghi/Chicharito)'
  },
  'Target Man': {
    name: 'Target Man',
    category: 'attacker',
    positions: ['ST'],
    metrics: {
      'Aerial duels won, %': 0.25,
      'Aerial duels won per 90': 0.18,
      'xG per 90': 0.15,
      'xA per 90': 0.12,
      'Duels won, %': 0.12,
      'Fouls suffered per 90': 0.10,
      'Key passes per 90': 0.08
    },
    description: 'Attaquant pivot physique point d\'appui (style Giroud/Dzeko)'
  },
  'False 9': {
    name: 'False 9',
    category: 'attacker',
    positions: ['ST', 'AM'],
    metrics: {
      'xA per 90': 0.22,
      'Key passes per 90': 0.18,
      'Progressive passes per 90': 0.15,
      'Dribbles per 90': 0.12,
      'xG per 90': 0.10,
      'Shot-creating actions per 90': 0.10,
      'Passes to penalty area per 90': 0.08,
      'Through passes per 90': 0.05
    },
    description: 'Faux 9 décrochant créateur (style Messi/Firmino)'
  },
  'Pressing Forward': {
    name: 'Pressing Forward',
    category: 'attacker',
    positions: ['ST', 'W'],
    metrics: {
      'Successful defensive actions per 90': 0.22,
      'xG per 90': 0.18,
      'PAdj Recoveries': 0.18,
      'Progressive runs per 90': 0.15,
      'Duels won per 90': 0.12,
      'xA per 90': 0.08,
      'Fouls suffered per 90': 0.07
    },
    description: 'Attaquant presseur travailleur (style Firmino/Luis Diaz)'
  },
  'Complete Forward': {
    name: 'Complete Forward',
    category: 'attacker',
    positions: ['ST'],
    metrics: {
      'xG per 90': 0.16,
      'xA per 90': 0.14,
      'Goals per 90': 0.12,
      'Key passes per 90': 0.12,
      'Aerial duels won, %': 0.12,
      'Dribbles per 90': 0.10,
      'Shots on target, %': 0.08,
      'xT per 90': 0.08,
      'Touches in box per 90': 0.08
    },
    description: 'Attaquant complet polyvalent (style Benzema/Kane)'
  }
};

// ============================================
// SCORING FUNCTIONS
// ============================================

export interface ScoredPlayer extends PlayerData {
  roleScore: number;
}

/**
 * Percentile (0-100) d'une métrique pour un rôle : un poids négatif inverse
 * le percentile (moins c'est mieux). undefined si la métrique n'est pas notée.
 */
function metricPercentile(player: PlayerData, metric: string, weight: number): number | undefined {
  const pct = player[`${metric} pct`];
  if (typeof pct !== 'number') return undefined;
  return weight < 0 ? 100 - pct : pct;
}

/**
 * Calcule le score d'un joueur pour un rôle donné (0-100)
 * Moyenne pondérée des percentiles par rôle et par niveau : les métriques
 * sont comparables quelle que soit leur échelle. Les métriques sans
 * percentile (analytics absente) sont ignorées et les poids renormalisés.
 *
 * @deprecated Ancien système de rôles (ROLE_DEFINITIONS) : utiliser utils/rolePresets.ts.
 */
export function calculateRoleScore(player: PlayerData, role: string): number {
  const definition = ROLE_DEFINITIONS[role];
  if (!definition) return 0;

  let score = 0;
  let totalWeight = 0;

  Object.entries(definition.metrics).forEach(([metric, weight]) => {
    const pct = metricPercentile(player, metric, weight);
    if (pct === undefined) return;
    score += pct * Math.abs(weight);
    totalWeight += Math.abs(weight);
  });

  return totalWeight > 0 ? Math.round(score / totalWeight) : 0;
}

/**
 * Calcule le score détaillé avec breakdown
 *
 * @deprecated Ancien système de rôles (ROLE_DEFINITIONS) : utiliser utils/rolePresets.ts.
 */
export function calculateDetailedRoleScore(
  player: PlayerData,
  role: string,
  cohort: PlayerData[]
): RoleScoreResult | null {
  const definition = ROLE_DEFINITIONS[role];
  if (!definition) return null;

  const breakdown: RoleScoreResult['breakdown'] = [];

  Object.entries(definition.metrics).forEach(([metric, weight]) => {
    const pct = metricPercentile(player, metric, weight);
    breakdown.push({
      metric,
      value: Number(player[metric]) || 0,
      weight,
      contribution: pct === undefined ? 0 : Number((pct * Math.abs(weight)).toFixed(1))
    });
  });

  const score = calculateRoleScore(player, role);

  // Rang du joueur parmi les joueurs compatibles avec le rôle
  const cohortScores = filterPlayersByRole(cohort, role).map(p => calculateRoleScore(p, role));
  const rank = cohortScores.filter(s => s < score).length;
  const percentile = cohortScores.length > 0 ? Math.round((rank / cohortScores.length) * 100) : 50;

  return {
    role,
    rawScore: score,
    normalizedScore: score,
    percentile,
    breakdown: breakdown.sort((a, b) => b.contribution - a.contribution)
  };
}

/**
 * Retourne les meilleurs rôles pour un joueur
 *
 * @deprecated Ancien système de rôles (ROLE_DEFINITIONS) : utiliser utils/rolePresets.ts.
 */
export function getBestRoles(
  player: PlayerData,
  allPlayers: PlayerData[],
  limit: number = 3
): RoleScoreResult[] {
  const results: RoleScoreResult[] = [];

  Object.entries(ROLE_DEFINITIONS).forEach(([roleName, definition]) => {
    if (!definition.positions.includes(player.Position)) return;

    const detailed = calculateDetailedRoleScore(player, roleName, allPlayers);
    if (detailed) {
      results.push(detailed);
    }
  });

  return results
    .sort((a, b) => b.normalizedScore - a.normalizedScore)
    .slice(0, limit);
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Obtient toutes les ligues disponibles
 */
export function getAvailableLeagues(data: PlayerData[]): string[] {
  const leagues = new Set(data.map(p => p.League).filter(Boolean));
  return Array.from(leagues).sort();
}

/**
 * Obtient toutes les équipes disponibles
 */
export function getAvailableTeams(data: PlayerData[]): string[] {
  const teams = new Set(data.map(p => p.Team).filter(Boolean));
  return Array.from(teams).sort();
}

/**
 * Obtient toutes les positions disponibles
 */
export function getAvailablePositions(data: PlayerData[]): string[] {
  const positions = new Set<string>();
  data.forEach(p => {
    if (p.Position) {
      p.Position.split(',').forEach(pos => positions.add(pos.trim()));
    }
  });
  return Array.from(positions).sort();
}

/**
 * Filtre les joueurs par position compatible avec un rôle
 *
 * @deprecated Ancien système de rôles (ROLE_DEFINITIONS) : utiliser utils/rolePresets.ts.
 */
export function filterPlayersByRole(
  data: PlayerData[],
  role: string
): PlayerData[] {
  const definition = ROLE_DEFINITIONS[role];
  if (!definition) return data;

  return data.filter(player => definition.positions.includes(player.Position));
}

// ============================================
// METRIC GROUPS
// ============================================
