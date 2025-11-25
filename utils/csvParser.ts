/**
 * ScoutVision AI - CSV Parser
 * Parser CSV avancé avec validation, normalisation et détection automatique
 */

import { PlayerData, TeamStats, ShotEvent } from '../types';

// ============================================
// CONSTANTS
// ============================================

/**
 * Mappings de normalisation des noms de colonnes
 * Permet de gérer les variations dans les exports CSV
 */
const COLUMN_MAPPINGS: Record<string, string> = {
  // Player identification
  'player': 'Player',
  'player_name': 'Player',
  'name': 'Player',
  'full_name': 'Player',
  
  // Team
  'team': 'Team',
  'club': 'Team',
  'team_name': 'Team',
  'squad': 'Team',
  
  // Position
  'position': 'Position',
  'pos': 'Position',
  'positions': 'Position',
  
  // League
  'league': 'League',
  'competition': 'League',
  'comp': 'League',
  
  // Age
  'age': 'Age',
  'player_age': 'Age',
  
  // Market value variations
  'market_value': 'Market value',
  'market value': 'Market value',
  'value': 'Market value',
  'transfer_value': 'Market value',
  
  // Minutes
  'minutes_played': 'Minutes played',
  'minutes played': 'Minutes played',
  'mins': 'Minutes played',
  'minutes': 'Minutes played',
  
  // Matches
  'matches_played': 'Matches played',
  'matches played': 'Matches played',
  'appearances': 'Matches played',
  'games': 'Matches played',
  
  // Height/Weight
  'height': 'Height',
  'weight': 'Weight',
  
  // Foot
  'foot': 'Foot',
  'preferred_foot': 'Foot',
  
  // Country
  'country': 'Passport country',
  'nationality': 'Passport country',
  'passport_country': 'Passport country'
};

/**
 * Colonnes qui devraient toujours être des nombres
 */
const NUMERIC_COLUMNS = new Set([
  'Age', 'Height', 'Weight', 'Market value',
  'Minutes played', 'Matches played', 'Goals', 'Assists',
  'xG', 'xA', 'xG per 90', 'xA per 90'
]);

// ============================================
// LINE PARSER
// ============================================

/**
 * Parse une ligne CSV en gérant les quotes et délimiteurs
 */
function parseLine(line: string, delimiter: string = ','): string[] {
  const values: string[] = [];
  let current = '';
  let inQuote = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];
    
    if (inQuote) {
      if (char === '"' && nextChar === '"') {
        current += '"';
        i++; // Skip escaped quote
      } else if (char === '"') {
        inQuote = false;
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuote = true;
      } else if (char === delimiter) {
        values.push(current);
        current = '';
      } else {
        current += char;
      }
    }
  }
  values.push(current);
  return values;
}

/**
 * Détecte le délimiteur utilisé dans le CSV
 */
function detectDelimiter(firstLine: string): string {
  const tabCount = (firstLine.match(/\t/g) || []).length;
  const commaCount = (firstLine.match(/,/g) || []).length;
  const semicolonCount = (firstLine.match(/;/g) || []).length;
  
  if (tabCount > commaCount && tabCount > semicolonCount) return '\t';
  if (semicolonCount > commaCount) return ';';
  return ',';
}

/**
 * Normalise un nom de colonne
 */
function normalizeColumnName(name: string): string {
  const cleaned = name.trim().toLowerCase();
  return COLUMN_MAPPINGS[cleaned] || name.trim();
}

/**
 * Parse et nettoie une valeur
 */
function parseValue(value: string, columnName: string): string | number {
  const trimmed = value.trim();
  
  // Valeurs vides ou manquantes
  if (trimmed === '' || trimmed === '-' || trimmed === 'N/A' || trimmed === 'null') {
    return NUMERIC_COLUMNS.has(columnName) ? 0 : '';
  }
  
  // Tenter conversion numérique
  const numericValue = trimmed.replace(/,/g, '.').replace(/[€$£%]/g, '').trim();
  
  // Gestion des millions/milliards
  if (numericValue.match(/^[\d.]+[MKB]$/i)) {
    const num = parseFloat(numericValue);
    const suffix = numericValue.slice(-1).toUpperCase();
    if (suffix === 'K') return num * 1000;
    if (suffix === 'M') return num * 1000000;
    if (suffix === 'B') return num * 1000000000;
  }
  
  const parsed = parseFloat(numericValue);
  if (!isNaN(parsed) && isFinite(parsed)) {
    return parsed;
  }
  
  return trimmed;
}

// ============================================
// MAIN PARSER
// ============================================

/**
 * Parse un fichier CSV en données structurées
 */
export function parseCSV(csvText: string): PlayerData[] {
  // Nettoyer le BOM et les caractères spéciaux
  const cleanText = csvText
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
  
  const lines = cleanText.split('\n').filter(line => line.trim() !== '');
  if (lines.length < 2) return [];

  // Détecter le délimiteur
  const delimiter = detectDelimiter(lines[0]);
  
  // Parser les headers
  let headers = parseLine(lines[0], delimiter).map(h => normalizeColumnName(h));
  
  // Fixer le premier header vide (souvent l'index)
  if (headers[0] === '') {
    headers[0] = 'Index';
  }
  
  // Supprimer les doublons dans les headers
  const headerCounts: Record<string, number> = {};
  headers = headers.map(h => {
    if (headerCounts[h] !== undefined) {
      headerCounts[h]++;
      return `${h}_${headerCounts[h]}`;
    }
    headerCounts[h] = 0;
    return h;
  });

  const result: PlayerData[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    try {
      let row = parseLine(line, delimiter).map(val => val.trim());
      
      // Gérer les lignes wrappées dans des quotes
      if (row.length === 1 && line.trim().startsWith('"') && line.trim().endsWith('"')) {
        const unwrapped = line.trim().slice(1, -1).replace(/""/g, '"');
        row = parseLine(unwrapped, delimiter).map(val => val.trim());
      }
      
      // Ajuster si la row a une colonne de plus que les headers (index implicite)
      if (row.length === headers.length + 1) {
        row = row.slice(1);
      }

      // Vérifier que la row correspond aux headers
      if (row.length !== headers.length) {
        continue; // Skip les lignes malformées
      }

      const obj: Record<string, string | number> = {};
      
      headers.forEach((header, index) => {
        const cleanKey = header.replace(/^"|"$/g, '').trim();
        obj[cleanKey] = parseValue(row[index], cleanKey);
      });

      // Validation stricte - on exige un nom de joueur non vide
      const playerName = obj['Player'] || obj['player'] || obj['name'];
      if (playerName && String(playerName).trim() !== '') {
        // S'assurer que Player est bien défini
        if (!obj['Player']) {
          obj['Player'] = String(playerName);
        }
        result.push(obj as PlayerData);
      }
    } catch (err) {
      console.warn(`Erreur parsing ligne ${i}:`, err);
      continue;
    }
  }

  // Filtrer une dernière fois pour exclure les entrées sans Player valide
  return result.filter(p => p.Player && String(p.Player).trim() !== '');
}

/**
 * Parse spécifiquement les données d'équipe (format différent)
 */
export function parseTeamStatsCSV(csvText: string): TeamStats[] {
  const rawData = parseCSV(csvText);
  
  return rawData.map(row => ({
    team: String(row['team'] || row['Team'] || ''),
    squad_id: String(row['squad_id'] || ''),
    league: String(row['league'] || row['League'] || ''),
    season: String(row['season'] || ''),
    ...row
  })) as TeamStats[];
}

/**
 * Parse spécifiquement les événements de tir
 */
export function parseShotEventsCSV(csvText: string): ShotEvent[] {
  const rawData = parseCSV(csvText);
  
  return rawData.map((row, index) => ({
    id: String(row['id'] || `shot_${index}`),
    minute: Number(row['minute'] || row['Minute'] || 0),
    result: String(row['result'] || row['Result'] || 'MissedShots') as ShotEvent['result'],
    X: Number(row['X'] || row['x'] || 0),
    Y: Number(row['Y'] || row['y'] || 0),
    xG: Number(row['xG'] || row['xg'] || 0),
    player: String(row['player'] || row['Player'] || ''),
    team: String(row['team'] || row['Team'] || ''),
    h_a: (String(row['h_a'] || row['home_away'] || 'h').toLowerCase() === 'h' ? 'h' : 'a') as 'h' | 'a',
    situation: String(row['situation'] || row['Situation'] || 'OpenPlay') as ShotEvent['situation'],
    lastAction: String(row['lastAction'] || row['last_action'] || ''),
    shotType: String(row['shotType'] || row['shot_type'] || 'RightFoot') as ShotEvent['shotType'],
    match_id: String(row['match_id'] || ''),
    season: String(row['season'] || '')
  }));
}

// ============================================
// AUTO-DETECTION
// ============================================

/**
 * Détecte automatiquement le type de données dans le CSV
 */
export function detectCSVType(csvText: string): 'players' | 'teams' | 'shots' | 'unknown' {
  const sample = csvText.substring(0, 2000).toLowerCase();
  
  // Détection par colonnes caractéristiques
  if (sample.includes('keeper_') || sample.includes('standard_goals') || sample.includes('possession_poss')) {
    return 'teams';
  }
  
  if (sample.includes('xg') && sample.includes('result') && (sample.includes('minute') || sample.includes('x') && sample.includes('y'))) {
    return 'shots';
  }
  
  if (sample.includes('player') || sample.includes('position') || sample.includes('age')) {
    return 'players';
  }
  
  return 'unknown';
}

/**
 * Parse automatiquement en détectant le type
 */
export function autoParseCSV(csvText: string): {
  type: 'players' | 'teams' | 'shots' | 'unknown';
  data: PlayerData[] | TeamStats[] | ShotEvent[];
} {
  const type = detectCSVType(csvText);
  
  switch (type) {
    case 'teams':
      return { type, data: parseTeamStatsCSV(csvText) };
    case 'shots':
      return { type, data: parseShotEventsCSV(csvText) };
    case 'players':
    default:
      return { type: type === 'unknown' ? 'players' : type, data: parseCSV(csvText) };
  }
}

// ============================================
// VALIDATION
// ============================================

/**
 * Valide et nettoie les données parsées
 */
export function validateAndCleanData(data: PlayerData[]): {
  valid: PlayerData[];
  invalid: { row: number; errors: string[] }[];
} {
  const valid: PlayerData[] = [];
  const invalid: { row: number; errors: string[] }[] = [];

  data.forEach((player, index) => {
    const errors: string[] = [];

    // Vérifications obligatoires
    if (!player.Player || String(player.Player).trim() === '') {
      errors.push('Missing Player name');
    }

    if (!player.Team || String(player.Team).trim() === '') {
      errors.push('Missing Team');
    }

    // Vérifications de plausibilité
    const age = Number(player.Age);
    if (player.Age && (isNaN(age) || age < 14 || age > 50)) {
      errors.push(`Invalid Age: ${player.Age}`);
    }

    const minutes = Number(player['Minutes played']);
    if (player['Minutes played'] && (isNaN(minutes) || minutes < 0 || minutes > 6000)) {
      errors.push(`Invalid Minutes: ${player['Minutes played']}`);
    }

    if (errors.length === 0) {
      valid.push(player);
    } else {
      invalid.push({ row: index + 2, errors }); // +2 pour header + 0-index
    }
  });

  return { valid, invalid };
}

// ============================================
// DEMO DATA
// ============================================

/**
 * Génère des données de démonstration
 */
export function generateDummyData(): PlayerData[] {
  const positions = ['CF', 'LW', 'RW', 'CAM', 'CM', 'CDM', 'LB', 'RB', 'CB', 'GK'];
  const teams = ['Real Madrid', 'Man City', 'Arsenal', 'Bayern', 'PSG', 'Inter', 'Barcelona', 'Liverpool'];
  const leagues = ['La Liga 2024-25', 'Premier League 2024-25', 'Serie A 2024-25', 'Bundesliga 2024-25', 'Ligue 1 2024-25'];
  const countries = ['France', 'Brazil', 'Argentina', 'Germany', 'Spain', 'England', 'Portugal', 'Netherlands'];
  
  const data: PlayerData[] = [];

  for (let i = 0; i < 100; i++) {
    const pos = positions[Math.floor(Math.random() * positions.length)];
    const isGK = pos === 'GK';
    const isDefender = ['CB', 'LB', 'RB'].includes(pos);
    const isAttacker = ['CF', 'LW', 'RW', 'CAM'].includes(pos);
    
    const age = Math.floor(Math.random() * 18) + 17;
    const potential = Math.max(0.5, 1 - (age - 17) * 0.03);
    
    data.push({
      Player: `Player ${i + 1}`,
      Team: teams[Math.floor(Math.random() * teams.length)],
      Position: pos,
      Age: age,
      "Market value": Math.floor(Math.random() * potential * 80000000) + 1000000,
      "Matches played": Math.floor(Math.random() * 30) + 5,
      "Minutes played": Math.floor(Math.random() * 2500) + 500,
      Goals: isGK ? 0 : Math.floor(Math.random() * (isAttacker ? 20 : 5)),
      xG: isGK ? 0 : Number((Math.random() * (isAttacker ? 15 : 3)).toFixed(2)),
      "xG per 90": isGK ? 0 : Number((Math.random() * (isAttacker ? 0.6 : 0.15)).toFixed(2)),
      Assists: isGK ? 0 : Math.floor(Math.random() * 12),
      xA: isGK ? 0 : Number((Math.random() * 10).toFixed(2)),
      "xA per 90": isGK ? 0 : Number((Math.random() * 0.3).toFixed(2)),
      "Duels won, %": Number((40 + Math.random() * 30).toFixed(1)),
      "Successful defensive actions per 90": Number((isDefender ? 6 + Math.random() * 6 : 2 + Math.random() * 4).toFixed(2)),
      "Successful attacking actions per 90": Number((isAttacker ? 2 + Math.random() * 4 : 0.5 + Math.random() * 2).toFixed(2)),
      "Defensive duels won, %": Number((45 + Math.random() * 25).toFixed(1)),
      "Aerial duels won, %": Number((40 + Math.random() * 30).toFixed(1)),
      "PAdj Interceptions": Number((isDefender ? 5 + Math.random() * 5 : 2 + Math.random() * 3).toFixed(2)),
      League: leagues[Math.floor(Math.random() * leagues.length)],
      Height: 165 + Math.floor(Math.random() * 30),
      Weight: 60 + Math.floor(Math.random() * 30),
      Foot: Math.random() > 0.75 ? "Left" : "Right",
      "Passes per 90": Number((30 + Math.random() * 50).toFixed(1)),
      "Accurate passes, %": Number((70 + Math.random() * 20).toFixed(1)),
      "Progressive passes per 90": Number((3 + Math.random() * 7).toFixed(2)),
      "Key passes per 90": Number((isAttacker ? 1 + Math.random() * 2 : 0.3 + Math.random() * 1).toFixed(2)),
      "Dribbles per 90": Number((isAttacker ? 3 + Math.random() * 5 : 0.5 + Math.random() * 2).toFixed(2)),
      "Successful dribbles, %": Number((40 + Math.random() * 30).toFixed(1)),
      "Progressive runs per 90": Number((1 + Math.random() * 4).toFixed(2)),
      "Passport country": countries[Math.floor(Math.random() * countries.length)],
      "Save rate, %": isGK ? Number((65 + Math.random() * 20).toFixed(1)) : 0,
      "Prevented goals per 90": isGK ? Number((-0.2 + Math.random() * 0.4).toFixed(2)) : 0,
      "Exits per 90": isGK ? Number((0.5 + Math.random() * 1.5).toFixed(2)) : 0
    } as PlayerData);
  }
  
  return data;
}

/**
 * Génère des données d'équipe de démonstration
 */
export function generateDummyTeamStats(): TeamStats[] {
  const teams = [
    { name: 'Real Madrid', league: 'La Liga' },
    { name: 'Barcelona', league: 'La Liga' },
    { name: 'Man City', league: 'Premier League' },
    { name: 'Arsenal', league: 'Premier League' },
    { name: 'Bayern Munich', league: 'Bundesliga' },
    { name: 'PSG', league: 'Ligue 1' },
    { name: 'Inter Milan', league: 'Serie A' },
    { name: 'Juventus', league: 'Serie A' }
  ];

  return teams.map(t => ({
    team: t.name,
    league: t.league,
    season: '24-25',
    standard_goals_p90: Number((1.5 + Math.random() * 1.5).toFixed(2)),
    standard_xg_p90: Number((1.3 + Math.random() * 1.2).toFixed(2)),
    possession_Poss: Number((45 + Math.random() * 20).toFixed(1)),
    passing_pass_completion_pct: Number((75 + Math.random() * 15).toFixed(1)),
    defense_tackles_won: Math.floor(300 + Math.random() * 200),
    keeper_clean_sheet_pct: Number((20 + Math.random() * 40).toFixed(1)),
    keeper_save_pct: Number((65 + Math.random() * 20).toFixed(1))
  })) as TeamStats[];
}