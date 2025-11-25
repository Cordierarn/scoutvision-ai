import { PlayerData, getPlayerSeasonId } from '../types';

const WATCHLIST_KEY = 'scoutvision_watchlist';
const SEARCH_HISTORY_KEY = 'scoutvision_search_history';

export interface WatchlistPlayer {
  player: PlayerData;
  addedAt: string;
  notes: string;
  tags: string[];
}

export interface SearchHistoryItem {
  query: string;
  type: 'player' | 'team' | 'filter';
  timestamp: string;
  context?: string; // e.g., "Gem Hunter - Box-to-Box"
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

export function isInWatchlist(player: PlayerData): boolean {
  const watchlist = getWatchlist();
  const playerId = getPlayerSeasonId(player);
  return watchlist.some(w => getPlayerSeasonId(w.player) === playerId);
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

export function updateWatchlistTags(player: PlayerData, tags: string[]): boolean {
  const watchlist = getWatchlist();
  const playerId = getPlayerSeasonId(player);
  const index = watchlist.findIndex(w => getPlayerSeasonId(w.player) === playerId);
  
  if (index === -1) return false;
  
  watchlist[index].tags = tags;
  localStorage.setItem(WATCHLIST_KEY, JSON.stringify(watchlist));
  return true;
}

export function clearWatchlist(): void {
  localStorage.removeItem(WATCHLIST_KEY);
}

// ============ SEARCH HISTORY ============

const MAX_HISTORY_ITEMS = 15;

export function getSearchHistory(): SearchHistoryItem[] {
  try {
    const stored = localStorage.getItem(SEARCH_HISTORY_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch (e) {
    console.error('Failed to load search history', e);
    return [];
  }
}

export function addToSearchHistory(
  query: string, 
  type: 'player' | 'team' | 'filter' = 'player',
  context?: string
): void {
  if (!query.trim()) return;
  
  const history = getSearchHistory();
  
  // Remove duplicates of the same query
  const filtered = history.filter(h => h.query.toLowerCase() !== query.toLowerCase());
  
  // Add new item at the beginning
  filtered.unshift({
    query,
    type,
    timestamp: new Date().toISOString(),
    context
  });
  
  // Keep only last N items
  const trimmed = filtered.slice(0, MAX_HISTORY_ITEMS);
  
  localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(trimmed));
}

export function removeFromSearchHistory(query: string): void {
  const history = getSearchHistory();
  const filtered = history.filter(h => h.query !== query);
  localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(filtered));
}

export function clearSearchHistory(): void {
  localStorage.removeItem(SEARCH_HISTORY_KEY);
}
