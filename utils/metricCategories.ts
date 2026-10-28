/**
 * ScoutVision - catégories de lecture des métriques d'un joueur (« Toutes les métriques »)
 * D'après la définition de chaque colonne dans scripts/prepare_data.py (PLAYER_METRICS,
 * COMPUTED_RATES) et les modèles du pipeline (RAPM, finition, réseau de passes).
 * Une métrique absente de cette table reste affichée, dans « Autres ».
 */

export interface MetricCategory {
  id: string;
  label: string;
  keys: string[];
}

export const METRIC_CATEGORIES: MetricCategory[] = [
  {
    id: 'finishing', label: 'Finition',
    keys: ['Goals', 'xG', 'Goals per 90', 'xG per 90', 'npxG per 90', 'xGOT per 90', 'Shots per 90',
      'Shots on target per 90', 'Shots on target, %', 'Big chances missed per 90', 'Touches in box per 90'],
  },
  {
    id: 'creation', label: 'Création',
    keys: ['Assists', 'xA', 'Assists per 90', 'xA per 90', 'xAG per 90', 'Key passes per 90', 'Big chances created per 90',
      'Shot-creating actions per 90', 'Goal-creating actions per 90', 'Second assists per 90',
      'Passes to penalty area per 90', 'Through passes per 90', 'Crosses per 90', 'Accurate crosses, %'],
  },
  {
    id: 'progression', label: 'Progression',
    keys: ['Progressive passes per 90', 'Progressive pass distance per 90', 'Passes to final third per 90',
      'Progressive runs per 90', 'Progressive carry distance per 90', 'Carries into final third per 90',
      'Carries into box per 90', 'Dribbles per 90', 'Successful dribbles, %'],
  },
  {
    id: 'possession', label: 'Possession / sécurité',
    keys: ['Passes per 90', 'Accurate passes, %', 'Long passes per 90', 'Accurate long passes, %', 'Touches per 90',
      'Dispossessed per 90', 'Miscontrols per 90', 'Fouls suffered per 90', 'Errors leading to goal'],
  },
  {
    id: 'circulation', label: 'Circulation',
    keys: ['Pass share, %', 'Network betweenness', 'xG chain per 90', 'xG buildup per 90', 'Switches per 90'],
  },
  {
    id: 'defending', label: 'Défense / récupération',
    keys: ['Successful defensive actions per 90', 'Tackles per 90', 'Interceptions per 90', 'PAdj Tackles',
      'PAdj Interceptions', 'PAdj Recoveries', 'Recoveries per 90', 'Clearances per 90', 'Shots blocked per 90',
      'Dribbled past per 90', 'Fouls per 90'],
  },
  {
    id: 'duels', label: 'Duels',
    keys: ['Duels won per 90', 'Duels won, %', 'Ground duels won, %', 'Aerial duels per 90', 'Aerial duels won per 90',
      'Aerial duels won, %'],
  },
  {
    id: 'models', label: 'Modèles avancés',
    keys: ['xT per 90', 'VAEP per 90', 'VAEP offensive per 90', 'VAEP defensive per 90', 'RAPM net', 'RAPM off',
      'RAPM def', 'Finishing skill'],
  },
  {
    id: 'goalkeeping', label: 'Gardien',
    keys: ['Saves per 90', 'Save rate, %', 'Prevented goals per 90', 'Conceded goals per 90', 'xGOT against per 90',
      'Exits per 90', 'High claims per 90', 'Punches per 90', 'Claim rate, %', 'Launch rate, %',
      'Distribution accuracy, %'],
  },
  { id: 'rating', label: 'Note globale', keys: ['Rating'] },
];

export const OTHER_CATEGORY: MetricCategory = { id: 'other', label: 'Autres', keys: [] };

const CATEGORY_OF = new Map<string, string>(METRIC_CATEGORIES.flatMap(c => c.keys.map(k => [k, c.id] as [string, string])));

/**
 * Répartit des métriques par catégorie, dans l'ordre de la table ; aucune métrique n'est perdue
 */
export function groupMetrics(keys: string[]): { category: MetricCategory; keys: string[] }[] {
  const present = new Set(keys);
  const groups = METRIC_CATEGORIES
    .map(category => ({ category, keys: category.keys.filter(k => present.has(k)) }))
    .filter(g => g.keys.length > 0);
  const others = keys.filter(k => !CATEGORY_OF.has(k));
  if (others.length > 0) groups.push({ category: OTHER_CATEGORY, keys: others });
  return groups;
}
