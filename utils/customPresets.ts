/**
 * ScoutVision - rôles personnalisés du Chasseur de pépites (stockage local du navigateur)
 *
 * Stockage versionné { version, presets } ; tout est validé à la lecture :
 * nom non vide, distinct d'un rôle officiel ; postes connus ; seuils finis entre 0 et 99
 * (percentile minimum). Le calcul reste celui des rôles officiels (roleIndex).
 * Les rôles de l'ancienne version (clé v2, objet brut) sont repris à la première lecture.
 */

import { RolePreset } from './rolePresets';

export const CUSTOM_PRESETS_KEY = 'scoutvision_role_presets';
export const CUSTOM_PRESETS_VERSION = 3;
const LEGACY_KEY_V2 = 'scoutvision_role_presets_v2';

export const POSITIONS = ['GK', 'CB', 'FB', 'WB', 'DM', 'CM', 'AM', 'W', 'ST'];
export const MAX_PRESET_NAME = 60;
export const THRESHOLD_MIN = 0;
export const THRESHOLD_MAX = 99;

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Seuil saisi : nombre fini borné à [0, 99], sinon null (champ vide, texte : jamais NaN) */
export function parseThreshold(raw: string | number): number | null {
  if (typeof raw === 'string' && raw.trim() === '') return null;
  const v = typeof raw === 'number' ? raw : Number(raw.replace(',', '.'));
  if (!Number.isFinite(v)) return null;
  return Math.min(THRESHOLD_MAX, Math.max(THRESHOLD_MIN, v));
}

/** Nom pris par un rôle officiel (sans tenir compte de la casse ni des espaces) */
export function isOfficialName(name: string, official: Record<string, RolePreset>): boolean {
  const n = name.trim().toLocaleLowerCase('fr');
  return Object.keys(official).some(k => k.toLocaleLowerCase('fr') === n);
}

/** Raison du refus d'un nom, ou null s'il est valable */
export function presetNameError(name: string, official: Record<string, RolePreset>, existingCustom: string[] = []): string | null {
  const n = name.trim();
  if (!n) return 'Nom requis.';
  if (n.length > MAX_PRESET_NAME) return `${MAX_PRESET_NAME} caractères au plus.`;
  if (isOfficialName(n, official)) return 'Ce nom est celui d\'un rôle officiel.';
  if (existingCustom.some(k => k.toLocaleLowerCase('fr') === n.toLocaleLowerCase('fr'))) return 'Un de vos rôles porte déjà ce nom.';
  return null;
}

/**
 * Rôle personnalisé valide, ou null : postes connus, au moins un seuil valide, poids finis
 */
export function sanitizePreset(raw: unknown): RolePreset | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const positions = Array.isArray(r.positions) ? r.positions.filter((p): p is string => typeof p === 'string' && POSITIONS.includes(p)) : [];
  const metrics: Record<string, number> = {};
  if (r.metrics && typeof r.metrics === 'object') {
    Object.entries(r.metrics as Record<string, unknown>).forEach(([k, v]) => {
      if (k && finite(v) && v >= THRESHOLD_MIN && v <= THRESHOLD_MAX) metrics[k] = v;
    });
  }
  if (positions.length === 0 || Object.keys(metrics).length === 0) return null;
  const preset: RolePreset = { positions: Array.from(new Set(positions)), metrics, custom: true };
  if (r.weights && typeof r.weights === 'object') {
    const weights: Record<string, number> = {};
    Object.entries(r.weights as Record<string, unknown>).forEach(([k, v]) => { if (k && finite(v)) weights[k] = v; });
    if (Object.keys(weights).length > 0) preset.weights = weights;
  }
  if (typeof r.description === 'string') preset.description = r.description.slice(0, 200);
  return preset;
}

/**
 * Rôles personnalisés valides d'un objet brut ; un nom officiel est renommé « (perso) »
 * pour ne jamais remplacer un rôle officiel ni perdre le rôle de l'utilisateur
 */
export function sanitizePresets(raw: unknown, official: Record<string, RolePreset>): Record<string, RolePreset> {
  const out: Record<string, RolePreset> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  Object.entries(raw as Record<string, unknown>).forEach(([name, value]) => {
    const preset = sanitizePreset(value);
    let n = name.trim().slice(0, MAX_PRESET_NAME);
    if (!preset || !n) return;
    if (isOfficialName(n, official)) n = `${n.slice(0, MAX_PRESET_NAME - 8)} (perso)`;
    if (isOfficialName(n, official) || out[n]) return;
    out[n] = preset;
  });
  return out;
}

interface StorageLike { getItem(k: string): string | null; setItem(k: string, v: string): void }

const defaultStorage = (): StorageLike | null => {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
};

export function loadCustomPresets(official: Record<string, RolePreset>, storage: StorageLike | null = defaultStorage()): Record<string, RolePreset> {
  if (!storage) return {};
  try {
    const saved = JSON.parse(storage.getItem(CUSTOM_PRESETS_KEY) ?? 'null');
    if (saved?.version === CUSTOM_PRESETS_VERSION) return sanitizePresets(saved.presets, official);
    // Reprise de l'ancienne clé (objet brut de rôles personnalisés)
    const legacy = JSON.parse(storage.getItem(LEGACY_KEY_V2) ?? 'null');
    if (legacy) {
      const presets = sanitizePresets(legacy, official);
      saveCustomPresets(presets, storage);
      return presets;
    }
  } catch { /* stockage illisible : aucun rôle personnalisé */ }
  return {};
}

export function saveCustomPresets(presets: Record<string, RolePreset>, storage: StorageLike | null = defaultStorage()): void {
  if (!storage) return;
  try { storage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify({ version: CUSTOM_PRESETS_VERSION, presets })); } catch { /* non bloquant */ }
}
