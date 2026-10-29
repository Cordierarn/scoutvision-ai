import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SAVED_FILTERS_KEY, consumeSharedFilters, decodeShare, encodeShare, loadSavedFilters, removeSavedFilter, saveFilter, setPendingSharedFilters, shareUrl, sharedFromHash,
  validateHunterFilters, validatePlayersFilters, validateSimilarFilters, StorageLike,
} from './savedFilters';

class MemoryStorage implements StorageLike { map = new Map<string, string>(); getItem(k: string) { return this.map.get(k) ?? null; } setItem(k: string, v: string) { this.map.set(k, v); } }
const players = { searchTerm: 'mbap', positionFilter: 'ST', sortField: 'xG per 90', sortOrder: 'desc' as const, conditions: [{ key: 'Age', min: 18, max: 23 }, { key: 'Minutes played', min: 500, max: '' as const }] };
const hunter = { role: 'Renard des surfaces', strictness: 0.9, constraints: { ageMax: 23, minutesMin: 300, valueMax: 20_000_000, contractMonths: 12, estimateAboveMarket: true, competition: 'FRA' } };
const similar = { samePosition: true, ageMax: 26, minMinutes: 450, competition: '', tier: 1 };

afterEach(() => { setPendingSharedFilters(null); vi.unstubAllGlobals(); });

describe('validation par page', () => {
  it('garde les champs attendus, refuse l\'illisible, écarte les conditions invalides', () => {
    expect(validatePlayersFilters(players)).toEqual(players);
    expect(validatePlayersFilters({ ...players, conditions: [{ key: 'Age', min: 'x', max: 23 }, 42, { key: 'Goals', min: 1, max: 5 }] })?.conditions).toEqual([{ key: 'Goals', min: 1, max: 5 }]);
    expect(validatePlayersFilters({ ...players, sortOrder: 'up' })).toBeNull();
    expect(validateHunterFilters(hunter)).toEqual(hunter);
    expect(validateHunterFilters({ ...hunter, strictness: 9 })?.strictness).toBe(1);
    expect(validateHunterFilters({ role: 'x', constraints: { ageMax: 23 } })).toBeNull();
    expect(validateSimilarFilters(similar)).toEqual(similar);
    expect(validateSimilarFilters({ ...similar, minMinutes: 'n' })).toBeNull();
    expect(validateSimilarFilters({ minMinutes: 450, ageMax: null, tier: null })).toEqual({ samePosition: true, ageMax: null, minMinutes: 450, competition: '', tier: null });
  });
});

describe('stockage des filtres enregistrés', () => {
  it('enregistre, remplace par nom, liste par page, supprime, ignore les entrées illisibles', () => {
    const storage = new MemoryStorage();
    const a = saveFilter('  U23 Ligue 1 ', { page: 'hunter', data: hunter }, storage, '2026-10-30T10:00:00.000Z');
    expect(a).toMatchObject({ name: 'U23 Ligue 1', page: 'hunter', createdAt: '2026-10-30T10:00:00.000Z', data: hunter });
    const b = saveFilter('u23 ligue 1', { page: 'hunter', data: { ...hunter, strictness: 1.1 } }, storage, '2026-10-30T11:00:00.000Z');
    expect(b.id).toBe(a.id);                                           // même nom, même page : remplacé
    saveFilter('Jeunes buteurs', { page: 'players', data: players }, storage);
    expect(loadSavedFilters('hunter', storage).map(f => (f.data as typeof hunter).strictness)).toEqual([1.1]);
    expect(loadSavedFilters(undefined, storage)).toHaveLength(2);
    const raw = JSON.parse(storage.getItem(SAVED_FILTERS_KEY)!);
    raw.push({ id: 'x' }, null, { id: 'y', name: 'bad', page: 'players', createdAt: 'z', data: { sortOrder: 'nope' } });
    storage.setItem(SAVED_FILTERS_KEY, JSON.stringify(raw));
    expect(loadSavedFilters(undefined, storage)).toHaveLength(2);
    removeSavedFilter(a.id, storage);
    expect(loadSavedFilters('hunter', storage)).toEqual([]);
    expect(() => saveFilter('   ', { page: 'players', data: players }, storage)).toThrow(/nom/);
    expect(loadSavedFilters(undefined, null)).toEqual([]);
  });
});

describe('lien de partage', () => {
  it('encode et décode à l\'identique, refuse un code altéré ou étranger', () => {
    const code = encodeShare({ page: 'players', data: players });
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeShare(code)).toEqual({ page: 'players', data: players });
    expect(decodeShare(code.slice(0, -5) + 'zzzzz')).toBeNull();
    expect(decodeShare('')).toBeNull();
    expect(decodeShare(encodeShare({ page: 'similar', data: similar }))).toEqual({ page: 'similar', data: similar });
    expect(sharedFromHash(`#partage=${code}`)).toEqual({ page: 'players', data: players });
    expect(sharedFromHash('#autre=1&partage=' + code)?.page).toBe('players');
    expect(sharedFromHash('#rien')).toBeNull();
    expect(shareUrl({ page: 'hunter', data: hunter }, 'https://exemple.test/app')).toBe(`https://exemple.test/app#partage=${encodeShare({ page: 'hunter', data: hunter })}`);
    expect(code).not.toContain('Mbapp');   // seulement des réglages, aucune donnée joueur en clair n'est attendue ici
  });
  it('le filtre partagé est consommé une seule fois, par la bonne page', () => {
    setPendingSharedFilters({ page: 'hunter', data: hunter });
    expect(consumeSharedFilters('players')).toBeNull();
    expect(consumeSharedFilters('hunter')).toEqual(hunter);
    expect(consumeSharedFilters('hunter')).toBeNull();
  });
});
