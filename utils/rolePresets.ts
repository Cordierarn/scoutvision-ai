/**
 * ScoutVision AI - Rôles du Chasseur de pépites
 *
 * Chaque rôle a deux étages, à la manière des profils par poste de la recherche
 * (indicateurs propres au poste, regroupés en dimensions offensives et défensives) :
 * - `metrics` : critères éliminatoires, percentile minimum parmi les joueurs du même
 *   rôle et du même niveau de compétition ; l'exigence les fait monter ou descendre ;
 * - `weights` : critères de classement, pondérés dans l'indice du rôle (0-100) ; un
 *   poids négatif compte « moins c'est mieux » (100 - percentile).
 * `midfieldProfiles` : profils de milieu appris par le pipeline (k-means sur les actions),
 * un joueur du bon profil gagne MIDFIELD_PROFILE_BONUS points d'indice.
 * Toutes les métriques sont des clés de public/data/players/<saison>.json.
 */

import { PlayerData } from '../types';

export interface RolePreset {
  positions: string[];
  metrics: Record<string, number>;          // critères éliminatoires : percentile minimum
  weights?: Record<string, number>;         // critères de classement : poids (négatif = inversé)
  midfieldProfiles?: string[];
  description?: string;
  category?: string;
  custom?: boolean;
}

export interface RoleCategory {
  key: string;
  label: string;
  icon: 'Hand' | 'Shield' | 'MoveHorizontal' | 'Anchor' | 'Repeat' | 'Wand2' | 'Zap' | 'Crosshair' | 'Flag';
}

export const ROLE_CATEGORIES: RoleCategory[] = [
  { key: 'gk', label: 'Gardien', icon: 'Hand' },
  { key: 'cb', label: 'Défenseur central', icon: 'Shield' },
  { key: 'fb', label: 'Latéral et piston', icon: 'MoveHorizontal' },
  { key: 'dm', label: 'Milieu défensif', icon: 'Anchor' },
  { key: 'cm', label: 'Milieu central', icon: 'Repeat' },
  { key: 'am', label: 'Milieu offensif', icon: 'Wand2' },
  { key: 'w', label: 'Ailier', icon: 'Zap' },
  { key: 'st', label: 'Avant-centre', icon: 'Crosshair' },
  { key: 'sp', label: 'Spécialiste', icon: 'Flag' },
];

// Les critères éliminatoires comptent ce poids dans l'indice
const CORE_WEIGHT = 1.5;
export const MIDFIELD_PROFILE_BONUS = 5;

export const DEFAULT_ROLE_PRESETS: Record<string, RolePreset> = {
  // ====== Gardien ======
  'Gardien sur sa ligne': {
    category: 'gk', positions: ['GK'],
    description: 'Arrête plus que ce que la qualité des tirs subis laisse attendre.',
    metrics: { 'Prevented goals per 90': 65, 'Save rate, %': 60 },
    weights: { 'Saves per 90': 0.5, 'High claims per 90': 0.5, 'Claim rate, %': 0.5, 'Punches per 90': 0.3 },
  },
  'Gardien libéro': {
    category: 'gk', positions: ['GK'],
    description: 'Couvre la profondeur et sort de sa surface, sans renoncer à la relance.',
    metrics: { 'Exits per 90': 65, 'Accurate long passes, %': 55, 'Prevented goals per 90': 45 },
    weights: { 'Passes per 90': 1, 'Accurate passes, %': 1, 'High claims per 90': 0.5, 'Launch rate, %': -0.5 },
  },
  'Gardien relanceur': {
    category: 'gk', positions: ['GK'],
    description: 'Premier relanceur : beaucoup de passes, courtes et précises.',
    metrics: { 'Accurate passes, %': 65, 'Passes per 90': 65 },
    weights: { 'Launch rate, %': -1.5, 'Distribution accuracy, %': 1, 'xG buildup per 90': 1, 'Prevented goals per 90': 0.5 },
  },

  // ====== Défenseur central ======
  'Défenseur relanceur': {
    category: 'cb', positions: ['CB'],
    description: 'Fait progresser le ballon par la passe, y compris longue et vers le dernier tiers.',
    metrics: { 'Progressive passes per 90': 70, 'Accurate passes, %': 60, 'Passes to final third per 90': 60 },
    weights: { 'Accurate long passes, %': 1, 'Switches per 90': 0.5, 'xG buildup per 90': 1, 'Pass share, %': 1, 'Ground duels won, %': 0.5 },
  },
  'Stoppeur': {
    category: 'cb', positions: ['CB'],
    description: 'Gagne ses duels au sol et dans les airs, dégage et contre les tirs.',
    metrics: { 'Aerial duels won, %': 65, 'Ground duels won, %': 60, 'Clearances per 90': 55 },
    weights: { 'Shots blocked per 90': 1, 'PAdj Tackles': 1, 'Aerial duels per 90': 1, 'Dribbled past per 90': -1, 'Fouls per 90': -0.5 },
  },
  'Défenseur d\'anticipation': {
    category: 'cb', positions: ['CB'],
    description: 'Lit le jeu : intercepte et récupère plutôt que d\'aller au duel.',
    metrics: { 'PAdj Interceptions': 70, 'PAdj Recoveries': 60 },
    weights: { 'Ground duels won, %': 1, 'Accurate passes, %': 0.5, 'Progressive passes per 90': 0.5, 'Dribbled past per 90': -1 },
  },
  'Défenseur porteur': {
    category: 'cb', positions: ['CB'],
    description: 'Casse les lignes balle au pied ; utile en défense à trois.',
    metrics: { 'Progressive runs per 90': 70, 'Progressive carry distance per 90': 65 },
    weights: { 'Carries into final third per 90': 1, 'Progressive passes per 90': 1, 'Ground duels won, %': 0.5, 'Dispossessed per 90': -0.5 },
  },

  // ====== Latéral et piston ======
  'Latéral offensif': {
    category: 'fb', positions: ['FB', 'WB'],
    description: 'Donne de la largeur, remonte le couloir et sert la surface.',
    metrics: { 'Progressive runs per 90': 65, 'Crosses per 90': 60, 'xA per 90': 60 },
    weights: { 'Carries into final third per 90': 1, 'Key passes per 90': 1, 'Touches in box per 90': 0.5, 'Dribbles per 90': 0.5, 'Ground duels won, %': 0.5 },
  },
  'Latéral défensif': {
    category: 'fb', positions: ['FB', 'WB'],
    description: 'Ferme son couloir : duels gagnés, peu de dribbles subis.',
    metrics: { 'Ground duels won, %': 65, 'PAdj Tackles': 60, 'PAdj Interceptions': 55 },
    weights: { 'Aerial duels won, %': 1, 'Dribbled past per 90': -1.5, 'Accurate passes, %': 0.5, 'Fouls per 90': -0.5 },
  },
  'Latéral intérieur': {
    category: 'fb', positions: ['FB', 'WB'],
    description: 'Rentre dans l\'axe à la relance et participe à la circulation.',
    metrics: { 'Passes per 90': 65, 'Accurate passes, %': 65, 'Progressive passes per 90': 60 },
    weights: { 'Pass share, %': 1, 'xG buildup per 90': 1, 'Passes to final third per 90': 1, 'PAdj Interceptions': 0.5 },
  },

  // ====== Milieu défensif ======
  'Sentinelle': {
    category: 'dm', positions: ['DM', 'CM'], midfieldProfiles: ['sentinelle'],
    description: 'Protège la défense : intercepte, tacle, perd peu de ballons.',
    metrics: { 'PAdj Interceptions': 65, 'PAdj Tackles': 60, 'Ground duels won, %': 60 },
    weights: { 'Accurate passes, %': 1, 'Aerial duels won, %': 0.5, 'Dispossessed per 90': -1, 'Fouls per 90': -0.5 },
  },
  'Regista': {
    category: 'dm', positions: ['DM', 'CM'], midfieldProfiles: ['organisateur'],
    description: 'Organise depuis la base : volume, progression et changements d\'aile.',
    metrics: { 'Progressive passes per 90': 70, 'Passes per 90': 65, 'Accurate passes, %': 65 },
    weights: { 'Accurate long passes, %': 1, 'Switches per 90': 1, 'xG buildup per 90': 1.5, 'Pass share, %': 1 },
  },
  'Milieu récupérateur': {
    category: 'dm', positions: ['DM', 'CM'], midfieldProfiles: ['sentinelle', 'box-to-box'],
    description: 'Va chercher le ballon : récupérations et duels en volume.',
    metrics: { 'PAdj Recoveries': 65, 'Duels won per 90': 65, 'PAdj Tackles': 60 },
    weights: { 'Ground duels won, %': 1, 'VAEP defensive per 90': 1, 'Fouls per 90': -0.5 },
  },

  // ====== Milieu central ======
  'Milieu box-to-box': {
    category: 'cm', positions: ['CM', 'DM'], midfieldProfiles: ['box-to-box'],
    description: 'Couvre tout le terrain : défend, porte le ballon et arrive dans la surface.',
    metrics: { 'Progressive runs per 90': 60, 'Successful defensive actions per 90': 60, 'Touches in box per 90': 55 },
    weights: { 'xG per 90': 1, 'Shot-creating actions per 90': 1, 'Duels won per 90': 1, 'Carries into final third per 90': 0.5 },
  },
  'Milieu percuteur': {
    category: 'cm', positions: ['CM', 'AM'],
    description: 'Élimine et casse les lignes balle au pied.',
    metrics: { 'Dribbles per 90': 70, 'Progressive runs per 90': 70, 'Successful dribbles, %': 55 },
    weights: { 'Carries into final third per 90': 1, 'Fouls suffered per 90': 1, 'xT per 90': 1, 'Dispossessed per 90': -0.5 },
  },
  'Mezzala': {
    category: 'cm', positions: ['CM', 'AM'],
    description: 'Milieu relayeur qui s\'infiltre entre les lignes vers la surface.',
    metrics: { 'Touches in box per 90': 60, 'Key passes per 90': 60, 'Progressive runs per 90': 60 },
    weights: { 'xG per 90': 1, 'xA per 90': 1, 'Shot-creating actions per 90': 1, 'Carries into box per 90': 0.5 },
  },

  // ====== Milieu offensif ======
  'Numéro 10': {
    category: 'am', positions: ['AM', 'CM'], midfieldProfiles: ['meneur offensif'],
    description: 'Crée les occasions dans les 30 derniers mètres.',
    metrics: { 'Key passes per 90': 70, 'xA per 90': 70, 'Shot-creating actions per 90': 65 },
    weights: { 'Through passes per 90': 1, 'Passes to penalty area per 90': 1, 'xT per 90': 1.5, 'Big chances created per 90': 1 },
  },
  'Neuf et demi': {
    category: 'am', positions: ['AM', 'ST'],
    description: 'Second attaquant : arrive dans la surface et tire.',
    metrics: { 'xG per 90': 70, 'Touches in box per 90': 65, 'Shots per 90': 60 },
    weights: { 'Goals per 90': 1, 'npxG per 90': 1, 'Carries into box per 90': 0.5, 'xA per 90': 0.5 },
  },

  // ====== Ailier ======
  'Ailier de débordement': {
    category: 'w', positions: ['W', 'WB'],
    description: 'Élimine sur l\'aile et centre.',
    metrics: { 'Dribbles per 90': 70, 'Crosses per 90': 60, 'Progressive runs per 90': 65 },
    weights: { 'Successful dribbles, %': 1, 'Accurate crosses, %': 1, 'Carries into final third per 90': 1, 'xA per 90': 1 },
  },
  'Attaquant intérieur': {
    category: 'w', positions: ['W'],
    description: 'Ailier qui rentre vers le but pour tirer.',
    metrics: { 'npxG per 90': 70, 'Shots per 90': 65, 'Touches in box per 90': 65 },
    weights: { 'Dribbles per 90': 1, 'Carries into box per 90': 1, 'Goals per 90': 1, 'xGOT per 90': 0.5 },
  },
  'Créateur excentré': {
    category: 'w', positions: ['W', 'AM'],
    description: 'Ailier passeur qui crée depuis le côté.',
    metrics: { 'Key passes per 90': 70, 'xA per 90': 65, 'Passes to penalty area per 90': 60 },
    weights: { 'Shot-creating actions per 90': 1, 'xT per 90': 1.5, 'Through passes per 90': 0.5, 'Big chances created per 90': 1 },
  },

  // ====== Avant-centre ======
  'Renard des surfaces': {
    category: 'st', positions: ['ST'],
    description: 'Vit dans la surface et convertit ses occasions.',
    metrics: { 'npxG per 90': 75, 'Touches in box per 90': 70, 'Goals per 90': 65 },
    weights: { 'xGOT per 90': 1, 'Shots on target per 90': 1, 'Big chances missed per 90': -0.5 },
  },
  'Pivot': {
    category: 'st', positions: ['ST'],
    description: 'Point d\'appui : gagne les ballons aériens et provoque des fautes.',
    metrics: { 'Aerial duels per 90': 70, 'Aerial duels won, %': 60, 'Fouls suffered per 90': 55 },
    weights: { 'Duels won per 90': 1, 'xA per 90': 0.5, 'Key passes per 90': 0.5, 'Touches in box per 90': 0.5 },
  },
  'Faux neuf': {
    category: 'st', positions: ['ST', 'AM'],
    description: 'Décroche pour participer au jeu et créer.',
    metrics: { 'Key passes per 90': 65, 'Shot-creating actions per 90': 65, 'Passes per 90': 60 },
    weights: { 'xA per 90': 1, 'Progressive passes per 90': 1, 'xT per 90': 1, 'xG per 90': 0.5 },
  },
  'Attaquant de profondeur': {
    category: 'st', positions: ['ST'],
    description: 'Attaque l\'espace et porte le ballon vers la surface.',
    metrics: { 'Progressive runs per 90': 70, 'Carries into box per 90': 65, 'xG per 90': 60 },
    weights: { 'Dribbles per 90': 1, 'Touches in box per 90': 1, 'Goals per 90': 0.5 },
  },
  'Attaquant presseur': {
    category: 'st', positions: ['ST', 'W'],
    description: 'Premier défenseur : presse et récupère haut sans perdre la menace.',
    metrics: { 'PAdj Recoveries': 60, 'Successful defensive actions per 90': 65, 'xG per 90': 55 },
    weights: { 'Duels won per 90': 1, 'VAEP defensive per 90': 1, 'Fouls suffered per 90': 0.5 },
  },

  // ====== Spécialiste ======
  'Créateur sur coups de pied arrêtés': {
    category: 'sp', positions: ['AM', 'CM', 'W', 'ST', 'FB', 'WB'],
    description: 'Crée des occasions franches, notamment sur centres et balles arrêtées.',
    metrics: { 'Big chances created per 90': 70, 'Key passes per 90': 65, 'Accurate crosses, %': 60 },
    weights: { 'Shot-creating actions per 90': 1, 'xA per 90': 1, 'Crosses per 90': 0.5 },
  },
};

/**
 * Percentile d'un joueur sur une métrique (undefined si non noté)
 */
const pct = (p: PlayerData, key: string): number | undefined => {
  const v = p[`${key} pct`];
  return typeof v === 'number' ? v : undefined;
};

/**
 * Indice du rôle (0-100) : moyenne pondérée des percentiles des critères éliminatoires
 * (poids CORE_WEIGHT) et des critères de classement (poids absolu, inversé si négatif),
 * plus MIDFIELD_PROFILE_BONUS si le profil de milieu correspond. Les métriques sans
 * percentile (analytics absente) sont ignorées et les poids renormalisés.
 */
export function roleIndex(player: PlayerData, preset: RolePreset): number {
  let sum = 0;
  let total = 0;
  const add = (key: string, weight: number) => {
    const v = pct(player, key);
    if (v === undefined || weight === 0) return;
    sum += Math.abs(weight) * (weight < 0 ? 100 - v : v);
    total += Math.abs(weight);
  };
  Object.keys(preset.metrics).forEach(key => {
    if (!(preset.weights && key in preset.weights)) add(key, CORE_WEIGHT);
  });
  Object.entries(preset.weights ?? {}).forEach(([key, w]) => add(key, w));
  if (total === 0) return 0;
  const bonus = preset.midfieldProfiles?.includes(String(player['Midfield profile'])) ? MIDFIELD_PROFILE_BONUS : 0;
  return Math.min(100, Math.round(sum / total + bonus));
}
