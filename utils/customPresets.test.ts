import { describe, expect, it } from 'vitest';
import { DEFAULT_ROLE_PRESETS } from './rolePresets';
import {
  CUSTOM_PRESETS_KEY, CUSTOM_PRESETS_VERSION, loadCustomPresets, parseThreshold, presetNameError, sanitizePresets, saveCustomPresets,
} from './customPresets';

const memoryStorage = (init: Record<string, string> = {}) => {
  const data = { ...init };
  return { data, getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => { data[k] = v; } };
};

describe('parseThreshold', () => {
  it('borne à 0-99 et refuse NaN', () => {
    expect(parseThreshold('65')).toBe(65);
    expect(parseThreshold('62,5')).toBe(62.5);
    expect(parseThreshold('150')).toBe(99);
    expect(parseThreshold('-3')).toBe(0);
    expect(parseThreshold('')).toBeNull();
    expect(parseThreshold('abc')).toBeNull();
    expect(parseThreshold(NaN)).toBeNull();
  });
});

describe('presetNameError', () => {
  it('refuse un nom vide, trop long, officiel ou déjà pris', () => {
    expect(presetNameError('  ', DEFAULT_ROLE_PRESETS)).not.toBeNull();
    expect(presetNameError('x'.repeat(61), DEFAULT_ROLE_PRESETS)).not.toBeNull();
    expect(presetNameError('stoppeur', DEFAULT_ROLE_PRESETS)).toMatch(/officiel/);
    expect(presetNameError('Mon rôle', DEFAULT_ROLE_PRESETS, ['mon rôle'])).not.toBeNull();
    expect(presetNameError('Défenseur sobre', DEFAULT_ROLE_PRESETS)).toBeNull();
  });
});

describe('sanitizePresets', () => {
  it('garde les rôles valides, écarte postes inconnus, NaN et seuils hors bornes', () => {
    const out = sanitizePresets({
      'Valide': { positions: ['CB', 'XX'], metrics: { A: 60, B: 'x', C: 150, D: null } },
      'Sans seuil': { positions: ['CB'], metrics: { A: 'NaN' } },
      'Sans poste': { positions: ['ZZ'], metrics: { A: 60 } },
      '': { positions: ['CB'], metrics: { A: 60 } },
    }, DEFAULT_ROLE_PRESETS);
    expect(Object.keys(out)).toEqual(['Valide']);
    expect(out.Valide).toEqual({ positions: ['CB'], metrics: { A: 60 }, custom: true });
  });

  it('ne laisse jamais un rôle personnalisé remplacer un rôle officiel', () => {
    const out = sanitizePresets({ 'Stoppeur': { positions: ['CB'], metrics: { A: 60 } } }, DEFAULT_ROLE_PRESETS);
    expect(out['Stoppeur']).toBeUndefined();
    expect(out['Stoppeur (perso)']).toBeDefined();
  });

  it('résiste à un contenu inattendu', () => {
    expect(sanitizePresets(null, DEFAULT_ROLE_PRESETS)).toEqual({});
    expect(sanitizePresets([1, 2], DEFAULT_ROLE_PRESETS)).toEqual({});
    expect(sanitizePresets('texte', DEFAULT_ROLE_PRESETS)).toEqual({});
  });
});

describe('loadCustomPresets / saveCustomPresets', () => {
  it('relit la version courante', () => {
    const s = memoryStorage();
    saveCustomPresets({ 'Mon rôle': { positions: ['CM'], metrics: { A: 55 }, custom: true } }, s);
    expect(JSON.parse(s.data[CUSTOM_PRESETS_KEY]).version).toBe(CUSTOM_PRESETS_VERSION);
    expect(loadCustomPresets(DEFAULT_ROLE_PRESETS, s)).toEqual({ 'Mon rôle': { positions: ['CM'], metrics: { A: 55 }, custom: true } });
  });

  it('reprend l\'ancienne clé v2 en la validant', () => {
    const s = memoryStorage({ scoutvision_role_presets_v2: JSON.stringify({ 'Regista': { positions: ['DM'], metrics: { A: 70 }, custom: true }, 'Cassé': { positions: [], metrics: {} } }) });
    const out = loadCustomPresets(DEFAULT_ROLE_PRESETS, s);
    expect(Object.keys(out)).toEqual(['Regista (perso)']);
    expect(JSON.parse(s.data[CUSTOM_PRESETS_KEY]).presets['Regista (perso)']).toBeDefined();
  });

  it('renvoie un objet vide pour un stockage illisible ou une autre version', () => {
    expect(loadCustomPresets(DEFAULT_ROLE_PRESETS, memoryStorage({ [CUSTOM_PRESETS_KEY]: '{pas du json' }))).toEqual({});
    expect(loadCustomPresets(DEFAULT_ROLE_PRESETS, memoryStorage({ [CUSTOM_PRESETS_KEY]: JSON.stringify({ version: 99, presets: { a: {} } }) }))).toEqual({});
    expect(loadCustomPresets(DEFAULT_ROLE_PRESETS, null)).toEqual({});
  });
});
