/**
 * ScoutVision - fixtures de test des dossiers de scouting (données synthétiques, jamais réelles)
 * Utilisées uniquement par les tests ; aucun écran du produit ne les importe.
 */

import { PlayerData } from '../types';

// Ligne joueur-saison synthétique (fixture de test, pas une donnée réelle)
export const STRIKER: PlayerData = {
  Player: 'Attaquant Fixture', 'Player ID': 'fx-1', Team: 'Club Fixture', 'Team ID': 'tf-1', League: 'Ligue Fixture 2026-27', Season: '2026-27', Competition: 'FIX-L1',
  Position: 'ST', Age: 23, 'Matches played': 12, 'Starts': 11, 'Minutes played': 1000, 'Market value': 12_000_000, 'Estimated value': 9_500_000,
  'npxG per 90': 0.55, 'npxG per 90 pct': 91, 'Touches in box per 90': 6.1, 'Touches in box per 90 pct': 84, 'Goals per 90': 0.6, 'Goals per 90 pct': 88,
  'xGOT per 90': 0.5, 'xGOT per 90 pct': 80, 'Shots on target per 90': 1.4, 'Shots on target per 90 pct': 77,
  'Big chances missed per 90': 0.4, 'Big chances missed per 90 pct': 70, 'Aerial duels per 90': 2.1, 'Aerial duels per 90 pct': 20,
  'Aerial duels won, %': 38, 'Aerial duels won, % pct': 18, 'Fouls suffered per 90': 0.9, 'Fouls suffered per 90 pct': 30,
  'Duels won per 90': 3, 'Duels won per 90 pct': 35, 'xA per 90': 0.12, 'xA per 90 pct': 48, 'Key passes per 90': 0.8, 'Key passes per 90 pct': 45,
  'RAPM net': 0.08, 'RAPM off': 0.1, 'RAPM def': -0.02, 'RAPM net pct': 72, 'RAPM minutes': 1000,
} as unknown as PlayerData;
