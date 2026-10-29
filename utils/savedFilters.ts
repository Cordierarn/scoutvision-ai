/**
 * ScoutVision - filtres enregistrés et lien de partage (Base joueurs, Chasseur de pépites, Joueurs similaires)
 *
 * Un filtre enregistré est un objet validé par page, stocké dans le navigateur sous une clé versionnée
 * (lecture tolérante : une entrée illisible est ignorée, les autres restent). Un lien de partage encode
 * le même objet dans le fragment de l'URL (`#partage=…`) : aucune donnée joueur, seulement les
 * réglages ; une page qui s'ouvre avec un fragment valide l'applique une fois puis l'efface.
 */

import type { ProspectConstraints } from './prospects';
import type { SimilarityFilters } from './similarity';

export const SAVED_FILTERS_KEY = 'scoutvision_saved_filters_v1';
export const SHARE_PARAM = 'partage';
const MAX_SAVED = 50;
const MAX_NAME = 60;

export type FilterPage = 'players' | 'hunter' | 'similar';

export interface PlayersFilters {
  searchTerm: string;
  positionFilter: string;
  sortField: string;
  sortOrder: 'asc' | 'desc';
  conditions: { key: string; min: number | ''; max: number | '' }[];
}

export interface HunterFilters {
  role: string;
  strictness: number;
  constraints: ProspectConstraints;
}

export type SimilarFilters = SimilarityFilters;

export type FilterData = { page: 'players'; data: PlayersFilters } | { page: 'hunter'; data: HunterFilters } | { page: 'similar'; data: SimilarFilters };

export interface SavedFilter {
  id: string;
  name: string;
  page: FilterPage;
  createdAt: string;
  data: FilterData['data'];
}

export interface StorageLike { getItem(k: string): string | null; setItem(k: string, v: string): void }
const defaultStorage = (): StorageLike | null => { try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; } };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max = 200): string | undefined => (typeof v === 'string' && v.length <= max ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const bound = (v: unknown): number | '' | undefined => (v === '' ? '' : num(v));

// ============================================
// VALIDATION PAR PAGE
// ============================================

export function validatePlayersFilters(raw: unknown): PlayersFilters | null {
  if (!isObject(raw)) return null;
  const sortOrder = raw.sortOrder === 'asc' ? 'asc' : raw.sortOrder === 'desc' ? 'desc' : null;
  const sortField = str(raw.sortField, 120);
  if (!sortOrder || !sortField) return null;
  const conditions = Array.isArray(raw.conditions)
    ? raw.conditions.slice(0, 20).flatMap(c => {
      if (!isObject(c)) return [];
      const key = str(c.key, 120), min = bound(c.min), max = bound(c.max);
      return key && min !== undefined && max !== undefined ? [{ key, min, max }] : [];
    })
    : [];
  return { searchTerm: str(raw.searchTerm) ?? '', positionFilter: str(raw.positionFilter, 20) ?? 'All', sortField, sortOrder, conditions };
}

export function validateHunterFilters(raw: unknown): HunterFilters | null {
  if (!isObject(raw) || !isObject(raw.constraints)) return null;
  const c = raw.constraints;
  const ageMax = num(c.ageMax), minutesMin = num(c.minutesMin), contractMonths = num(c.contractMonths);
  if (ageMax === undefined || minutesMin === undefined || contractMonths === undefined) return null;
  const valueMax = c.valueMax === null ? null : num(c.valueMax);
  if (valueMax === undefined) return null;
  const strictness = num(raw.strictness);
  return {
    role: str(raw.role, 80) ?? '',
    strictness: strictness !== undefined && strictness > 0 && strictness <= 3 ? strictness : 1,
    constraints: {
      ageMax: Math.round(ageMax), minutesMin: Math.max(0, Math.round(minutesMin)), valueMax, contractMonths: Math.max(0, Math.round(contractMonths)),
      estimateAboveMarket: c.estimateAboveMarket === true, competition: str(c.competition, 20) ?? '',
    },
  };
}

export function validateSimilarFilters(raw: unknown): SimilarFilters | null {
  if (!isObject(raw)) return null;
  const minMinutes = num(raw.minMinutes);
  if (minMinutes === undefined) return null;
  const ageMax = raw.ageMax === null ? null : num(raw.ageMax);
  const tier = raw.tier === null ? null : num(raw.tier);
  if (ageMax === undefined || tier === undefined) return null;
  return { samePosition: raw.samePosition !== false, ageMax, minMinutes: Math.max(0, Math.round(minMinutes)), competition: str(raw.competition, 20) ?? '', tier };
}

export function validateFilterData(page: unknown, data: unknown): FilterData | null {
  if (page === 'players') { const d = validatePlayersFilters(data); return d ? { page, data: d } : null; }
  if (page === 'hunter') { const d = validateHunterFilters(data); return d ? { page, data: d } : null; }
  if (page === 'similar') { const d = validateSimilarFilters(data); return d ? { page, data: d } : null; }
  return null;
}

// ============================================
// STOCKAGE
// ============================================

const newId = (): string => {
  try { if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID(); } catch { /* repli */ }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

function parseSaved(raw: unknown): SavedFilter | null {
  if (!isObject(raw)) return null;
  const id = str(raw.id, 80), name = str(raw.name, MAX_NAME), createdAt = str(raw.createdAt, 40);
  const fd = validateFilterData(raw.page, raw.data);
  if (!id || !name || !createdAt || !fd) return null;
  return { id, name, page: fd.page, createdAt, data: fd.data };
}

/** Filtres enregistrés d'une page (ou de toutes) ; les entrées illisibles sont ignorées une à une */
export function loadSavedFilters(page?: FilterPage, storage: StorageLike | null = defaultStorage()): SavedFilter[] {
  if (!storage) return [];
  let raw: unknown;
  try { raw = JSON.parse(storage.getItem(SAVED_FILTERS_KEY) ?? '[]'); } catch { return []; }
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  return raw.map(parseSaved).filter((f): f is SavedFilter => !!f && !seen.has(f.id) && !!seen.add(f.id)).filter(f => !page || f.page === page);
}

function writeAll(list: SavedFilter[], storage: StorageLike | null) {
  if (!storage) return;
  storage.setItem(SAVED_FILTERS_KEY, JSON.stringify(list.slice(0, MAX_SAVED)));
}

export function saveFilter(name: string, fd: FilterData, storage: StorageLike | null = defaultStorage(), now = new Date().toISOString()): SavedFilter {
  const clean = name.trim().slice(0, MAX_NAME);
  if (!clean) throw new Error('Donnez un nom à ce filtre.');
  const all = loadSavedFilters(undefined, storage);
  // Même nom sur la même page : remplacé (l'identifiant est conservé)
  const existing = all.find(f => f.page === fd.page && f.name.toLocaleLowerCase('fr') === clean.toLocaleLowerCase('fr'));
  const saved: SavedFilter = { id: existing?.id ?? newId(), name: clean, page: fd.page, createdAt: now, data: fd.data };
  writeAll([saved, ...all.filter(f => f.id !== saved.id)], storage);
  return saved;
}

export function removeSavedFilter(id: string, storage: StorageLike | null = defaultStorage()): void {
  writeAll(loadSavedFilters(undefined, storage).filter(f => f.id !== id), storage);
}

// ============================================
// LIEN DE PARTAGE (fragment d'URL, base64url du JSON)
// ============================================

const toBase64Url = (s: string) => {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  bytes.forEach(b => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromBase64Url = (s: string) => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
};

export function encodeShare(fd: FilterData): string {
  return toBase64Url(JSON.stringify({ v: 1, page: fd.page, data: fd.data }));
}

export function decodeShare(code: string): FilterData | null {
  if (!code || code.length > 4000) return null;
  try {
    const raw = JSON.parse(fromBase64Url(code));
    return isObject(raw) && raw.v === 1 ? validateFilterData(raw.page, raw.data) : null;
  } catch { return null; }
}

/** URL de partage de la page courante avec le fragment `#partage=<code>` */
export function shareUrl(fd: FilterData, base = typeof location === 'undefined' ? '' : `${location.origin}${location.pathname}${location.search}`): string {
  return `${base}#${SHARE_PARAM}=${encodeShare(fd)}`;
}

/** Fragment de partage présent dans une URL (ou un fragment) ; null sinon */
export function sharedFromHash(hash: string): FilterData | null {
  const m = hash.replace(/^#/, '').match(new RegExp(`(?:^|&)${SHARE_PARAM}=([A-Za-z0-9_-]+)`));
  return m ? decodeShare(m[1]) : null;
}

// Fragment lu au démarrage de l'application, consommé une fois par la page concernée
let pending: FilterData | null = null;

/** Lit le fragment de l'URL une fois, le retire de la barre d'adresse et garde le filtre pour la page concernée */
export function takeSharedFilters(): FilterData | null {
  if (typeof location === 'undefined') return null;
  const fd = sharedFromHash(location.hash);
  if (fd) {
    pending = fd;
    try { history.replaceState(null, '', `${location.pathname}${location.search}`); } catch { /* sans historique */ }
  }
  return fd;
}

type DataOf = { players: PlayersFilters; hunter: HunterFilters; similar: SimilarFilters };

/** Le filtre partagé en attente pour cette page, consommé (une seule application) */
export function consumeSharedFilters<P extends FilterPage>(page: P): DataOf[P] | null {
  if (!pending || pending.page !== page) return null;
  const data = pending.data as DataOf[P];
  pending = null;
  return data;
}

/** Pour les tests : fixe le filtre en attente */
export function setPendingSharedFilters(fd: FilterData | null): void { pending = fd; }
