/**
 * ScoutVision AI - Libellés français
 * Les clés des données restent en anglais (colonnes produites par scripts/prepare_data.py) ;
 * ces fonctions donnent le libellé affiché. Les noms propres (joueurs, clubs, compétitions)
 * ne sont pas traduits.
 */

const METRIC_LABELS: Record<string, string> = {
  // Totaux
  'Goals': 'Buts',
  'Assists': 'Passes décisives',
  'xG': 'xG',
  'xA': 'xA',
  'Errors leading to goal': 'Erreurs menant à un but',

  // Finition
  'Goals per 90': 'Buts par 90',
  'xG per 90': 'xG par 90',
  'npxG per 90': 'npxG par 90',
  'xGOT per 90': 'xGOT par 90',
  'Shots per 90': 'Tirs par 90',
  'Shots on target per 90': 'Tirs cadrés par 90',
  'Shots on target, %': 'Tirs cadrés, %',
  'Big chances missed per 90': 'Grosses occasions manquées par 90',
  'Touches in box per 90': 'Touches dans la surface par 90',

  // Création
  'Assists per 90': 'Passes décisives par 90',
  'xA per 90': 'xA par 90',
  'xAG per 90': 'xAG par 90',
  'Key passes per 90': 'Passes clés par 90',
  'Big chances created per 90': 'Grosses occasions créées par 90',
  'Shot-creating actions per 90': 'Actions menant à un tir par 90',
  'Goal-creating actions per 90': 'Actions menant à un but par 90',
  'Second assists per 90': 'Avant-dernières passes par 90',
  'xG chain per 90': 'xG chain par 90',
  'xG buildup per 90': 'xG buildup par 90',

  // Passe
  'Passes per 90': 'Passes par 90',
  'Accurate passes, %': 'Passes réussies, %',
  'Progressive passes per 90': 'Passes progressives par 90',
  'Progressive pass distance per 90': 'Distance de passes progressives par 90',
  'Passes to final third per 90': 'Passes vers le dernier tiers par 90',
  'Passes to penalty area per 90': 'Passes dans la surface par 90',
  'Through passes per 90': 'Passes en profondeur par 90',
  'Switches per 90': 'Changements d\'aile par 90',
  'Crosses per 90': 'Centres par 90',
  'Accurate crosses, %': 'Centres réussis, %',
  'Long passes per 90': 'Passes longues par 90',
  'Accurate long passes, %': 'Passes longues réussies, %',

  // Conduite et dribble
  'Dribbles per 90': 'Dribbles par 90',
  'Successful dribbles, %': 'Dribbles réussis, %',
  'Progressive runs per 90': 'Courses progressives par 90',
  'Progressive carry distance per 90': 'Distance de conduites progressives par 90',
  'Carries into final third per 90': 'Conduites vers le dernier tiers par 90',
  'Carries into box per 90': 'Conduites dans la surface par 90',
  'Touches per 90': 'Touches par 90',
  'Dispossessed per 90': 'Pertes de balle subies par 90',
  'Miscontrols per 90': 'Contrôles manqués par 90',
  'Fouls suffered per 90': 'Fautes subies par 90',

  // Défense
  'Successful defensive actions per 90': 'Actions défensives réussies par 90',
  'Tackles per 90': 'Tacles par 90',
  'Interceptions per 90': 'Interceptions par 90',
  'PAdj Tackles': 'Tacles (ajustés à la possession)',
  'PAdj Interceptions': 'Interceptions (ajustées à la possession)',
  'PAdj Recoveries': 'Récupérations (ajustées à la possession)',
  'Recoveries per 90': 'Récupérations par 90',
  'Clearances per 90': 'Dégagements par 90',
  'Shots blocked per 90': 'Tirs contrés par 90',
  'Dribbled past per 90': 'Dribbles subis par 90',
  'Fouls per 90': 'Fautes commises par 90',
  'Duels won per 90': 'Duels gagnés par 90',
  'Duels won, %': 'Duels gagnés, %',
  'Ground duels won, %': 'Duels au sol gagnés, %',
  'Aerial duels per 90': 'Duels aériens par 90',
  'Aerial duels won per 90': 'Duels aériens gagnés par 90',
  'Aerial duels won, %': 'Duels aériens gagnés, %',

  // Valeur de possession
  'xT per 90': 'xT par 90',
  'VAEP per 90': 'VAEP par 90',
  'VAEP offensive per 90': 'VAEP offensive par 90',
  'VAEP defensive per 90': 'VAEP défensive par 90',

  // Gardien
  'Saves per 90': 'Arrêts par 90',
  'Save rate, %': 'Arrêts, %',
  'Prevented goals per 90': 'Buts évités par 90',
  'Conceded goals per 90': 'Buts encaissés par 90',
  'xGOT against per 90': 'xGOT concédés par 90',
  'Exits per 90': 'Sorties par 90',
  'High claims per 90': 'Captations aériennes par 90',
  'Punches per 90': 'Ballons boxés par 90',
  'Claim rate, %': 'Captations réussies, %',
  'Launch rate, %': 'Relances longues, %',
  'Distribution accuracy, %': 'Relances réussies, %',

  // Impact et réseau
  'Rating': 'Note',
  'RAPM off': 'RAPM offensif',
  'RAPM def': 'RAPM défensif',
  'RAPM net': 'RAPM net',
  'Finishing skill': 'Talent de finition',
  'Pass share, %': 'Part des passes de l\'équipe, %',
  'Network betweenness': 'Rôle de relais (centralité)',

  // Profil et temps de jeu
  'Age': 'Âge',
  'Market value': 'Valeur marchande',
  'Estimated value': 'Valeur estimée',
  'Matches played': 'Matchs joués',
  'Starts': 'Titularisations',
  'Minutes played': 'Minutes jouées',
  'Minutes share': 'Part des minutes',
  'Height': 'Taille',

  // Équipes (team_season)
  'Matches': 'Matchs',
  'xGA per 90': 'xG concédés par 90',
  'npxGA per 90': 'npxG concédés par 90',
  'Shots against per 90': 'Tirs concédés par 90',
  'Goals against per 90': 'Buts encaissés par 90',
  'Possession, %': 'Possession, %',
  'Field tilt': 'Domination territoriale',
  'Average action height': 'Hauteur moyenne des actions',
  'Defensive line height': 'Hauteur de la ligne défensive',
  'PPDA': 'PPDA',
  'Ball recovery time': 'Temps de récupération du ballon',
  'Passes per sequence': 'Passes par séquence',
  'Direct speed': 'Vitesse de projection',
  'Pass accuracy, %': 'Passes réussies, %',
};

/**
 * Libellé français d'une métrique (la clé anglaise si elle n'est pas répertoriée)
 */
export function metricLabel(key: string): string {
  return METRIC_LABELS[key] ?? key;
}

const POSITIONS: Record<string, { short: string; long: string }> = {
  GK: { short: 'GB', long: 'Gardien' },
  CB: { short: 'DC', long: 'Défenseur central' },
  FB: { short: 'DL', long: 'Latéral' },
  WB: { short: 'PIS', long: 'Piston' },
  DM: { short: 'MDC', long: 'Milieu défensif' },
  CM: { short: 'MC', long: 'Milieu central' },
  AM: { short: 'MOC', long: 'Milieu offensif' },
  W: { short: 'AIL', long: 'Ailier' },
  ST: { short: 'BU', long: 'Avant-centre' },
};

/**
 * Abréviation française d'un poste (rôle PitchAPI : GK, CB, FB, WB, DM, CM, AM, W, ST)
 */
export function positionLabel(position: string | undefined): string {
  if (!position) return '';
  return POSITIONS[position]?.short ?? position;
}

/**
 * Nom complet français d'un poste
 */
export function positionName(position: string | undefined): string {
  if (!position) return '';
  return POSITIONS[position]?.long ?? position;
}

const ROLE_LABELS: Record<string, string> = {
  'Shot-Stopping Goalkeeper': 'Gardien sur sa ligne',
  'Sweeper Keeper': 'Gardien libéro',
  'Ball-Playing Goalkeeper': 'Gardien relanceur',
  'Defensive CB': 'Défenseur central stoppeur',
  'Ball-Playing CB': 'Défenseur central relanceur',
  'Wide CB': 'Défenseur central excentré',
  'Attacking Fullback': 'Latéral offensif',
  'Defensive Fullback': 'Latéral défensif',
  'Inverted Fullback': 'Latéral intérieur',
  'Defensive Mid': 'Sentinelle',
  'Deep-Lying Playmaker': 'Meneur reculé',
  'Ball-Winning Midfielder': 'Milieu récupérateur',
  'Box-to-Box': 'Milieu box-to-box',
  'Mezzala': 'Mezzala',
  'Carrilero': 'Relayeur',
  'Advanced Playmaker': 'Meneur de jeu avancé',
  'Shadow Striker': 'Neuf et demi',
  'Trequartista': 'Trequartista',
  'Inside Forward': 'Attaquant intérieur',
  'Inverted Winger': 'Ailier inversé',
  'Traditional Winger': 'Ailier de débordement',
  'Wide Playmaker': 'Créateur excentré',
  'Advanced Striker': 'Attaquant de pointe',
  'Poacher': 'Renard des surfaces',
  'Target Man': 'Pivot',
  'False 9': 'Faux neuf',
  'Pressing Forward': 'Attaquant presseur',
  'Complete Forward': 'Attaquant complet',
};

/**
 * Libellé français d'un rôle tactique (clé de ROLE_DEFINITIONS)
 */
export function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role;
}

const STYLE_LABELS: Record<string, string> = {
  'Dominant possession': 'Possession dominante',
  'Patient build-up': 'Construction patiente',
  'High press': 'Pressing haut',
  'Deep block & counter': 'Bloc bas et contre',
  'Direct & vertical': 'Jeu direct et vertical',
  'Mid-low block': 'Bloc médian-bas',
  'Balanced': 'Équilibré',
};

/**
 * Libellé français d'un style de jeu (scripts/models.py)
 */
export function styleLabel(style: string | undefined): string {
  if (!style) return '';
  return STYLE_LABELS[style] ?? style;
}

const FOOT_LABELS: Record<string, string> = { Right: 'droit', Left: 'gauche', Both: 'deux pieds' };

/**
 * Pied fort en français
 */
export function footLabel(foot: string | undefined): string {
  if (!foot) return '';
  return FOOT_LABELS[foot] ?? foot;
}

const SHOT_RESULT_LABELS: Record<string, string> = {
  Goal: 'But', SavedShot: 'Arrêté', MissedShots: 'Manqué', BlockedShot: 'Contré', ShotOnPost: 'Poteau',
};
const SHOT_TYPE_LABELS: Record<string, string> = {
  RightFoot: 'Pied droit', LeftFoot: 'Pied gauche', Head: 'Tête', OtherBodyPart: 'Autre',
};
const SITUATION_LABELS: Record<string, string> = {
  OpenPlay: 'Jeu courant', SetPiece: 'Coup de pied arrêté', FromCorner: 'Corner',
  DirectFreekick: 'Coup franc direct', Penalty: 'Penalty',
};

/** Résultat d'un tir en français */
export const shotResultLabel = (v: string | undefined) => (v ? SHOT_RESULT_LABELS[v] ?? v : '');
/** Surface de contact d'un tir en français */
export const shotTypeLabel = (v: string | undefined) => (v ? SHOT_TYPE_LABELS[v] ?? v : '');
/** Situation de jeu d'un tir en français */
export const situationLabel = (v: string | undefined) => (v ? SITUATION_LABELS[v] ?? v : '');
