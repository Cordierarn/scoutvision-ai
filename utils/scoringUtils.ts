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
 */
export const ROLE_DEFINITIONS: Record<string, RoleDefinition> = {
  // ========== GOALKEEPERS ==========
  'Shot-Stopping Goalkeeper': {
    name: 'Shot-Stopping Goalkeeper',
    category: 'goalkeeper',
    positions: ['GK'],
    metrics: {
      'Save rate, %': 0.30,
      'Prevented goals per 90': 0.25,
      'Clean sheets': 0.15,
      'Aerial duels won, %': 0.10,
      'Conceded goals per 90': -0.10, // Négatif = moins c'est mieux
      'Shots against per 90': 0.05,
      'xG against per 90': -0.05
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
      'Aerial duels per 90': 0.10,
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
      'Progressive passes per 90': 0.10,
      'Accurate short / medium passes, %': 0.10,
      'Prevented goals per 90': 0.05
    },
    description: 'Gardien moderne excellent dans la relance'
  },

  // ========== CENTRAL DEFENDERS ==========
  'Defensive CB': {
    name: 'Defensive CB',
    category: 'defender',
    positions: ['CB', 'LCB', 'RCB'],
    metrics: {
      'Defensive duels won, %': 0.20,
      'Aerial duels won, %': 0.20,
      'PAdj Interceptions': 0.15,
      'Shots blocked per 90': 0.12,
      'Successful defensive actions per 90': 0.12,
      'Duels won, %': 0.10,
      'Sliding tackles per 90': 0.06,
      'Fouls per 90': -0.05
    },
    description: 'Défenseur central robuste et dominant dans les duels'
  },
  'Ball-Playing CB': {
    name: 'Ball-Playing CB',
    category: 'defender',
    positions: ['CB', 'LCB', 'RCB'],
    metrics: {
      'Progressive passes per 90': 0.22,
      'Accurate passes, %': 0.18,
      'Accurate long passes, %': 0.15,
      'Passes to final third per 90': 0.12,
      'Defensive duels won, %': 0.12,
      'Passes per 90': 0.08,
      'PAdj Interceptions': 0.08,
      'Accurate forward passes, %': 0.05
    },
    description: 'Défenseur technique excellent dans la relance'
  },
  'Wide CB': {
    name: 'Wide CB',
    category: 'defender',
    positions: ['CB', 'LCB', 'RCB'],
    metrics: {
      'Progressive runs per 90': 0.20,
      'Progressive passes per 90': 0.18,
      'Defensive duels won, %': 0.15,
      'Accurate passes, %': 0.12,
      'Aerial duels won, %': 0.12,
      'Dribbles per 90': 0.08,
      'Successful defensive actions per 90': 0.10,
      'PAdj Interceptions': 0.05
    },
    description: 'Défenseur central capable de jouer large en 3 défenseurs'
  },

  // ========== FULLBACKS ==========
  'Attacking RB': {
    name: 'Attacking RB',
    category: 'defender',
    positions: ['RB', 'RWB'],
    metrics: {
      'xA per 90': 0.18,
      'Key passes per 90': 0.15,
      'Accurate crosses, %': 0.14,
      'Progressive runs per 90': 0.14,
      'Crosses per 90': 0.10,
      'Dribbles per 90': 0.08,
      'Defensive duels won, %': 0.10,
      'Successful dribbles, %': 0.06,
      'Deep completions per 90': 0.05
    },
    description: 'Latéral droit offensif apportant le surnombre'
  },
  'Attacking LB': {
    name: 'Attacking LB',
    category: 'defender',
    positions: ['LB', 'LWB'],
    metrics: {
      'xA per 90': 0.18,
      'Key passes per 90': 0.15,
      'Accurate crosses, %': 0.14,
      'Progressive runs per 90': 0.14,
      'Crosses per 90': 0.10,
      'Dribbles per 90': 0.08,
      'Defensive duels won, %': 0.10,
      'Successful dribbles, %': 0.06,
      'Deep completions per 90': 0.05
    },
    description: 'Latéral gauche offensif moderne'
  },
  'Defensive RB': {
    name: 'Defensive RB',
    category: 'defender',
    positions: ['RB', 'RWB'],
    metrics: {
      'Defensive duels won, %': 0.25,
      'PAdj Interceptions': 0.20,
      'Aerial duels won, %': 0.15,
      'Accurate passes, %': 0.15,
      'Successful defensive actions per 90': 0.12,
      'Duels won, %': 0.08,
      'Fouls per 90': -0.05
    },
    description: 'Latéral droit défensif solide'
  },
  'Defensive LB': {
    name: 'Defensive LB',
    category: 'defender',
    positions: ['LB', 'LWB'],
    metrics: {
      'Defensive duels won, %': 0.25,
      'PAdj Interceptions': 0.20,
      'Aerial duels won, %': 0.15,
      'Accurate passes, %': 0.15,
      'Successful defensive actions per 90': 0.12,
      'Duels won, %': 0.08,
      'Fouls per 90': -0.05
    },
    description: 'Latéral gauche défensif fiable'
  },
  'Inverted Fullback': {
    name: 'Inverted Fullback',
    category: 'defender',
    positions: ['RB', 'LB', 'RWB', 'LWB'],
    metrics: {
      'Progressive passes per 90': 0.22,
      'Passes per 90': 0.18,
      'Accurate passes, %': 0.15,
      'Key passes per 90': 0.12,
      'PAdj Interceptions': 0.12,
      'Passes to final third per 90': 0.10,
      'Accurate short / medium passes, %': 0.06,
      'Defensive duels won, %': 0.05
    },
    description: 'Latéral rentrant dans l\'entrejeu (style Cancelo/Walker)'
  },

  // ========== DEFENSIVE MIDFIELDERS ==========
  'Defensive Mid': {
    name: 'Defensive Mid',
    category: 'midfielder',
    positions: ['DMF', 'LDMF', 'RDMF'],
    metrics: {
      'PAdj Interceptions': 0.22,
      'Defensive duels won, %': 0.20,
      'Successful defensive actions per 90': 0.18,
      'Aerial duels won, %': 0.12,
      'Accurate passes, %': 0.10,
      'Duels per 90': 0.08,
      'Shots blocked per 90': 0.05,
      'Fouls per 90': -0.05
    },
    description: 'Sentinelle récupératrice devant la défense'
  },
  'Deep-Lying Playmaker': {
    name: 'Deep-Lying Playmaker',
    category: 'midfielder',
    positions: ['DMF', 'LDMF', 'RDMF', 'LCMF', 'RCMF'],
    metrics: {
      'Progressive passes per 90': 0.22,
      'Passes per 90': 0.18,
      'Accurate passes, %': 0.15,
      'Passes to final third per 90': 0.12,
      'Accurate long passes, %': 0.10,
      'Key passes per 90': 0.08,
      'PAdj Interceptions': 0.08,
      'xA per 90': 0.07
    },
    description: 'Régisseur dictant le tempo depuis la base (style Busquets/Pirlo)'
  },
  'Ball-Winning Midfielder': {
    name: 'Ball-Winning Midfielder',
    category: 'midfielder',
    positions: ['DMF', 'LDMF', 'RDMF', 'LCMF', 'RCMF'],
    metrics: {
      'PAdj Interceptions': 0.25,
      'Successful defensive actions per 90': 0.22,
      'Defensive duels won, %': 0.20,
      'Duels per 90': 0.15,
      'Aerial duels won, %': 0.08,
      'Sliding tackles per 90': 0.05,
      'Fouls per 90': -0.05
    },
    description: 'Milieu récupérateur agressif (style Kanté/Ndidi)'
  },

  // ========== CENTRAL MIDFIELDERS ==========
  'Box-to-Box': {
    name: 'Box-to-Box',
    category: 'midfielder',
    positions: ['LCMF', 'RCMF', 'DMF', 'LDMF', 'RDMF'],
    metrics: {
      'Progressive runs per 90': 0.15,
      'Successful defensive actions per 90': 0.15,
      'xA per 90': 0.12,
      'Duels won, %': 0.12,
      'xG per 90': 0.10,
      'Passes per 90': 0.10,
      'Key passes per 90': 0.08,
      'PAdj Interceptions': 0.08,
      'Touches in box per 90': 0.05,
      'Shots per 90': 0.05
    },
    description: 'Milieu complet couvrant tout le terrain (style Bellingham/Goretzka)'
  },
  'Mezzala': {
    name: 'Mezzala',
    category: 'midfielder',
    positions: ['LCMF', 'RCMF', 'LAMF', 'RAMF'],
    metrics: {
      'Progressive runs per 90': 0.20,
      'xA per 90': 0.18,
      'Key passes per 90': 0.15,
      'Dribbles per 90': 0.12,
      'xG per 90': 0.12,
      'Successful dribbles, %': 0.08,
      'Touches in box per 90': 0.08,
      'Shot assists per 90': 0.07
    },
    description: 'Milieu offensif infiltrant sur les côtés (style Barella)'
  },
  'Carrilero': {
    name: 'Carrilero',
    category: 'midfielder',
    positions: ['LCMF', 'RCMF', 'DMF'],
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

  // ========== ATTACKING MIDFIELDERS ==========
  'Advanced Playmaker': {
    name: 'Advanced Playmaker',
    category: 'midfielder',
    positions: ['AMF', 'LAMF', 'RAMF'],
    metrics: {
      'xA per 90': 0.22,
      'Key passes per 90': 0.18,
      'Shot assists per 90': 0.15,
      'Progressive passes per 90': 0.12,
      'Deep completions per 90': 0.10,
      'Passes to penalty area per 90': 0.08,
      'Through passes per 90': 0.08,
      'Smart passes per 90': 0.07
    },
    description: 'Meneur de jeu créatif dans les 30 derniers mètres (style De Bruyne/Özil)'
  },
  'Shadow Striker': {
    name: 'Shadow Striker',
    category: 'midfielder',
    positions: ['AMF', 'LAMF', 'RAMF', 'CF'],
    metrics: {
      'xG per 90': 0.25,
      'Goals per 90': 0.20,
      'Shots per 90': 0.15,
      'Touches in box per 90': 0.15,
      'Shots on target, %': 0.10,
      'Offensive duels won, %': 0.08,
      'xA per 90': 0.07
    },
    description: 'Second attaquant se projetant dans la surface (style Müller)'
  },
  'Trequartista': {
    name: 'Trequartista',
    category: 'midfielder',
    positions: ['AMF', 'LAMF', 'RAMF'],
    metrics: {
      'xA per 90': 0.20,
      'xG per 90': 0.18,
      'Key passes per 90': 0.15,
      'Dribbles per 90': 0.12,
      'Shot assists per 90': 0.10,
      'Successful dribbles, %': 0.10,
      'Through passes per 90': 0.08,
      'Touches in box per 90': 0.07
    },
    description: 'Fantaisiste libre créateur et buteur (style Dybala/Riquelme)'
  },

  // ========== WINGERS ==========
  'Inside Forward': {
    name: 'Inside Forward',
    category: 'attacker',
    positions: ['LW', 'RW', 'LWF', 'RWF', 'LAMF', 'RAMF'],
    metrics: {
      'xG per 90': 0.22,
      'Goals per 90': 0.18,
      'Shots per 90': 0.12,
      'Shots on target, %': 0.12,
      'Dribbles per 90': 0.10,
      'Touches in box per 90': 0.10,
      'Successful dribbles, %': 0.08,
      'Non-penalty goals per 90': 0.08
    },
    description: 'Ailier rentrant buteur coupant vers le but (style Salah/Robben)'
  },
  'Inverted Winger': {
    name: 'Inverted Winger',
    category: 'attacker',
    positions: ['LW', 'RW', 'LWF', 'RWF', 'LAMF', 'RAMF'],
    metrics: {
      'xA per 90': 0.20,
      'Key passes per 90': 0.18,
      'Progressive passes per 90': 0.15,
      'Dribbles per 90': 0.12,
      'Shot assists per 90': 0.10,
      'Passes to penalty area per 90': 0.10,
      'Through passes per 90': 0.08,
      'Successful dribbles, %': 0.07
    },
    description: 'Ailier inversé créateur orienté passe (style Messi/Griezmann)'
  },
  'Traditional Winger': {
    name: 'Traditional Winger',
    category: 'attacker',
    positions: ['LW', 'RW', 'LWF', 'RWF'],
    metrics: {
      'Accurate crosses, %': 0.20,
      'Crosses per 90': 0.18,
      'xA per 90': 0.15,
      'Dribbles per 90': 0.15,
      'Successful dribbles, %': 0.12,
      'Progressive runs per 90': 0.10,
      'Deep completions per 90': 0.05,
      'Key passes per 90': 0.05
    },
    description: 'Ailier débordant classique qui centre (style Hakimi/TAA)'
  },
  'Wide Playmaker': {
    name: 'Wide Playmaker',
    category: 'attacker',
    positions: ['LW', 'RW', 'LWF', 'RWF', 'LAMF', 'RAMF'],
    metrics: {
      'xA per 90': 0.22,
      'Key passes per 90': 0.18,
      'Progressive passes per 90': 0.15,
      'Shot assists per 90': 0.12,
      'Passes to penalty area per 90': 0.10,
      'Passes per 90': 0.08,
      'Through passes per 90': 0.08,
      'Accurate passes, %': 0.07
    },
    description: 'Ailier créateur organisateur depuis l\'aile'
  },

  // ========== STRIKERS ==========
  'Advanced Striker': {
    name: 'Advanced Striker',
    category: 'attacker',
    positions: ['CF'],
    metrics: {
      'xG per 90': 0.22,
      'Goals per 90': 0.18,
      'Shots on target, %': 0.15,
      'Touches in box per 90': 0.12,
      'Offensive duels won, %': 0.10,
      'Shots per 90': 0.08,
      'Head goals per 90': 0.08,
      'Non-penalty goals per 90': 0.07
    },
    description: 'Attaquant de pointe complet (style Lewandowski/Haaland)'
  },
  'Poacher': {
    name: 'Poacher',
    category: 'attacker',
    positions: ['CF'],
    metrics: {
      'Goals per 90': 0.28,
      'xG per 90': 0.22,
      'Shots on target, %': 0.18,
      'Touches in box per 90': 0.15,
      'Goal conversion, %': 0.12,
      'Non-penalty goals per 90': 0.05
    },
    description: 'Renard des surfaces finisseur (style Inzaghi/Chicharito)'
  },
  'Target Man': {
    name: 'Target Man',
    category: 'attacker',
    positions: ['CF'],
    metrics: {
      'Aerial duels won, %': 0.25,
      'Duels won, %': 0.18,
      'xG per 90': 0.15,
      'xA per 90': 0.12,
      'Head goals per 90': 0.12,
      'Offensive duels won, %': 0.10,
      'Key passes per 90': 0.08
    },
    description: 'Attaquant pivot physique point d\'appui (style Giroud/Dzeko)'
  },
  'False 9': {
    name: 'False 9',
    category: 'attacker',
    positions: ['CF', 'AMF'],
    metrics: {
      'xA per 90': 0.22,
      'Key passes per 90': 0.18,
      'Progressive passes per 90': 0.15,
      'Dribbles per 90': 0.12,
      'xG per 90': 0.10,
      'Shot assists per 90': 0.10,
      'Passes to penalty area per 90': 0.08,
      'Through passes per 90': 0.05
    },
    description: 'Faux 9 décrochant créateur (style Messi/Firmino)'
  },
  'Pressing Forward': {
    name: 'Pressing Forward',
    category: 'attacker',
    positions: ['CF', 'LW', 'RW'],
    metrics: {
      'Successful defensive actions per 90': 0.22,
      'xG per 90': 0.18,
      'Duels per 90': 0.18,
      'Progressive runs per 90': 0.15,
      'Offensive duels won, %': 0.12,
      'xA per 90': 0.08,
      'Fouls suffered per 90': 0.07
    },
    description: 'Attaquant presseur travailleur (style Firmino/Luis Diaz)'
  },
  'Complete Forward': {
    name: 'Complete Forward',
    category: 'attacker',
    positions: ['CF'],
    metrics: {
      'xG per 90': 0.16,
      'xA per 90': 0.14,
      'Goals per 90': 0.12,
      'Key passes per 90': 0.12,
      'Aerial duels won, %': 0.12,
      'Dribbles per 90': 0.10,
      'Shots on target, %': 0.08,
      'Offensive duels won, %': 0.08,
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
 * Calcule le score d'un joueur pour un rôle donné
 */
export function calculateRoleScore(
  player: PlayerData,
  role: string,
  normalize: boolean = false,
  maxScores?: Record<string, number>
): number {
  const definition = ROLE_DEFINITIONS[role];
  if (!definition) return 0;

  let score = 0;
  let totalWeight = 0;

  Object.entries(definition.metrics).forEach(([metric, weight]) => {
    const value = Number(player[metric]) || 0;
    score += value * weight;
    totalWeight += weight;
  });

  // Normaliser si demandé
  if (normalize && maxScores && maxScores[role] > 0) {
    return Math.round((score / maxScores[role]) * 100);
  }

  return Number(score.toFixed(2));
}

/**
 * Calcule le score détaillé avec breakdown
 */
export function calculateDetailedRoleScore(
  player: PlayerData,
  role: string,
  cohort: PlayerData[]
): RoleScoreResult | null {
  const definition = ROLE_DEFINITIONS[role];
  if (!definition) return null;

  let rawScore = 0;
  const breakdown: RoleScoreResult['breakdown'] = [];

  Object.entries(definition.metrics).forEach(([metric, weight]) => {
    const value = Number(player[metric]) || 0;
    const contribution = value * weight;
    rawScore += contribution;

    breakdown.push({
      metric,
      value,
      weight,
      contribution: Number(contribution.toFixed(3))
    });
  });

  // Calculer le score normalisé et le percentile
  const cohortScores = cohort.map(p => calculateRoleScore(p, role, false));
  const maxScore = Math.max(...cohortScores, 1);
  const normalizedScore = Math.round((rawScore / maxScore) * 100);

  // Percentile
  const sortedScores = [...cohortScores].sort((a, b) => a - b);
  const rank = sortedScores.filter(s => s < rawScore).length;
  const percentile = Math.round((rank / cohortScores.length) * 100);

  return {
    role,
    rawScore: Number(rawScore.toFixed(2)),
    normalizedScore,
    percentile,
    breakdown: breakdown.sort((a, b) => b.contribution - a.contribution)
  };
}

/**
 * Calcule les scores maximum pour chaque rôle dans le dataset
 */
export function calculateMaxScores(data: PlayerData[]): Record<string, number> {
  const maxes: Record<string, number> = {};

  Object.keys(ROLE_DEFINITIONS).forEach(role => {
    let max = 0;
    data.forEach(player => {
      const score = calculateRoleScore(player, role, false);
      if (score > max) max = score;
    });
    maxes[role] = max > 0 ? max : 1;
  });

  return maxes;
}

/**
 * Retourne les meilleurs rôles pour un joueur
 */
export function getBestRoles(
  player: PlayerData,
  allPlayers: PlayerData[],
  limit: number = 3
): RoleScoreResult[] {
  const maxScores = calculateMaxScores(allPlayers);
  const results: RoleScoreResult[] = [];

  // Filtrer les rôles compatibles avec la position du joueur
  const playerPositions = player.Position?.split(',').map(p => p.trim()) || [];
  
  Object.entries(ROLE_DEFINITIONS).forEach(([roleName, definition]) => {
    // Vérifier la compatibilité de position
    const isCompatible = definition.positions.some(pos => 
      playerPositions.some(pp => pos === pp || pp.includes(pos))
    );

    if (!isCompatible) return;

    const detailed = calculateDetailedRoleScore(player, roleName, allPlayers);
    if (detailed) {
      results.push(detailed);
    }
  });

  return results
    .sort((a, b) => b.normalizedScore - a.normalizedScore)
    .slice(0, limit);
}

/**
 * Retourne tous les rôles disponibles pour une position
 */
export function getRolesForPosition(position: string): string[] {
  const roles: string[] = [];
  const positions = position.split(',').map(p => p.trim());

  Object.entries(ROLE_DEFINITIONS).forEach(([roleName, definition]) => {
    if (definition.positions.some(p => positions.includes(p))) {
      roles.push(roleName);
    }
  });

  return roles;
}

/**
 * Retourne les rôles par catégorie
 */
export function getRolesByCategory(category: RoleCategory): string[] {
  return Object.entries(ROLE_DEFINITIONS)
    .filter(([_, def]) => def.category === category)
    .map(([name, _]) => name);
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
 */
export function filterPlayersByRole(
  data: PlayerData[],
  role: string
): PlayerData[] {
  const definition = ROLE_DEFINITIONS[role];
  if (!definition) return data;

  return data.filter(player => {
    const playerPositions = player.Position?.split(',').map(p => p.trim()) || [];
    return definition.positions.some(pos => playerPositions.includes(pos));
  });
}

/**
 * Classe les joueurs pour un rôle donné
 */
export function rankPlayersForRole(
  data: PlayerData[],
  role: string,
  limit?: number
): ScoredPlayer[] {
  const definition = ROLE_DEFINITIONS[role];
  if (!definition) return [];

  // Filtrer par position
  const compatiblePlayers = filterPlayersByRole(data, role);
  
  // Calculer les scores max
  const maxScores = calculateMaxScores(compatiblePlayers);

  // Scorer et trier
  const scored: ScoredPlayer[] = compatiblePlayers.map(player => ({
    ...player,
    roleScore: calculateRoleScore(player, role, true, maxScores)
  }));

  const sorted = scored.sort((a, b) => b.roleScore - a.roleScore);

  return limit ? sorted.slice(0, limit) : sorted;
}

// ============================================
// METRIC GROUPS
// ============================================

/**
 * Groupes de métriques par catégorie pour l'UI
 */
export const METRIC_GROUPS = {
  attacking: {
    name: 'Attacking',
    keys: ['xG', 'xG per 90', 'Goals', 'Goals per 90', 'Non-penalty goals per 90', 'Shots per 90', 'Shots on target, %', 'Touches in box per 90']
  },
  creation: {
    name: 'Creation',
    keys: ['xA', 'xA per 90', 'Assists', 'Key passes per 90', 'Shot assists per 90', 'Deep completions per 90', 'Accurate crosses, %']
  },
  passing: {
    name: 'Passing',
    keys: ['Passes per 90', 'Accurate passes, %', 'Progressive passes per 90', 'Passes to final third per 90', 'Accurate long passes, %']
  },
  defensive: {
    name: 'Defensive',
    keys: ['Successful defensive actions per 90', 'Defensive duels won, %', 'PAdj Interceptions', 'Aerial duels won, %', 'Shots blocked per 90']
  },
  possession: {
    name: 'Possession',
    keys: ['Dribbles per 90', 'Successful dribbles, %', 'Progressive runs per 90', 'Offensive duels won, %']
  },
  physical: {
    name: 'Physical',
    keys: ['Duels won, %', 'Duels per 90', 'Aerial duels won, %']
  }
};