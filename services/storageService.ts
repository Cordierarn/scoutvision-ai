import { PlayerData, getPlayerSeasonId } from '../types';

const WATCHLIST_KEY = 'scoutvision_watchlist';

export interface WatchlistPlayer {
  player: PlayerData;
  addedAt: string;
  notes: string;
  tags: string[];
}

// ============ WATCHLIST ============

export function getWatchlist(): WatchlistPlayer[] {
  try {
    const stored = localStorage.getItem(WATCHLIST_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch (e) {
    console.error('Failed to load watchlist', e);
    return [];
  }
}

export function addToWatchlist(player: PlayerData, notes: string = '', tags: string[] = []): boolean {
  const watchlist = getWatchlist();
  const playerId = getPlayerSeasonId(player);
  
  // Check if already exists
  if (watchlist.some(w => getPlayerSeasonId(w.player) === playerId)) {
    return false; // Already in watchlist
  }
  
  watchlist.push({
    player,
    addedAt: new Date().toISOString(),
    notes,
    tags
  });
  
  localStorage.setItem(WATCHLIST_KEY, JSON.stringify(watchlist));
  return true;
}

export function removeFromWatchlist(player: PlayerData): boolean {
  const watchlist = getWatchlist();
  const playerId = getPlayerSeasonId(player);
  const filtered = watchlist.filter(w => getPlayerSeasonId(w.player) !== playerId);
  
  if (filtered.length === watchlist.length) {
    return false; // Not found
  }
  
  localStorage.setItem(WATCHLIST_KEY, JSON.stringify(filtered));
  return true;
}

export function updateWatchlistNotes(player: PlayerData, notes: string): boolean {
  const watchlist = getWatchlist();
  const playerId = getPlayerSeasonId(player);
  const index = watchlist.findIndex(w => getPlayerSeasonId(w.player) === playerId);
  
  if (index === -1) return false;
  
  watchlist[index].notes = notes;
  localStorage.setItem(WATCHLIST_KEY, JSON.stringify(watchlist));
  return true;
}

export function clearWatchlist(): void {
  localStorage.removeItem(WATCHLIST_KEY);
}
