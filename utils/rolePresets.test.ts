import { describe, expect, it } from 'vitest';
import { PlayerData } from '../types';
import {
  DEFAULT_ROLE_PRESETS, MIDFIELD_PROFILE_BONUS, RolePreset, bestPreset, presetWeights, presetsForPosition,
  roleIndex, weightedRoleScore,
} from './rolePresets';

const player = (fields: Record<string, string | number>): PlayerData =>
  ({ Player: 'X', Team: 'T', League: 'L', Position: 'CB', 'Matches played': 10, 'Minutes played': 900, ...fields });

const preset: RolePreset = { positions: ['CB'], metrics: { A: 60, B: 50 }, weights: { B: 2, C: -1 } };

describe('presetWeights', () => {
  it('donne 1,5 aux critères éliminatoires sauf s\'ils ont un poids de classement', () => {
    expect(presetWeights(preset)).toEqual({ A: 1.5, B: 2, C: -1 });
  });
});

describe('weightedRoleScore', () => {
  it('fait la moyenne pondérée et inverse les poids négatifs', () => {
    const v: Record<string, number> = { A: 80, B: 50, C: 30 };
    // (1,5*80 + 2*50 + 1*(100-30)) / 4,5
    expect(weightedRoleScore(preset, k => v[k])).toBeCloseTo((120 + 100 + 70) / 4.5, 10);
  });

  it('ignore les métriques absentes et renormalise', () => {
    expect(weightedRoleScore(preset, k => (k === 'A' ? 70 : undefined))).toBe(70);
  });

  it('renvoie undefined sans aucune métrique', () => {
    expect(weightedRoleScore(preset, () => undefined)).toBeUndefined();
  });

  it('ajoute les poids supplémentaires, signés', () => {
    const v: Record<string, number> = { A: 80, B: 50, C: 30, D: 10 };
    const plain = weightedRoleScore(preset, k => v[k])!;
    const extra = weightedRoleScore(preset, k => v[k], { D: -1 })!;
    expect(extra).toBeCloseTo((120 + 100 + 70 + 90) / 5.5, 10);
    expect(extra).toBeGreaterThan(plain);
  });
});

describe('roleIndex', () => {
  it('arrondit, ajoute le bonus de profil de milieu et plafonne à 100', () => {
    const p = player({ 'A pct': 80, 'B pct': 50, 'C pct': 30 });
    expect(roleIndex(p, preset)).toBe(Math.round(290 / 4.5));
    const mid = { ...preset, midfieldProfiles: ['sentinelle'] };
    expect(roleIndex({ ...p, 'Midfield profile': 'sentinelle' }, mid)).toBe(Math.round(290 / 4.5 + MIDFIELD_PROFILE_BONUS));
    expect(roleIndex(player({ 'A pct': 100, 'B pct': 100, 'C pct': 0, 'Midfield profile': 'sentinelle' }), mid)).toBe(100);
  });

  it('vaut 0 sans percentile', () => {
    expect(roleIndex(player({}), preset)).toBe(0);
  });
});

describe('rôles par défaut (rolePresets.json)', () => {
  it('charge 27 rôles cohérents', () => {
    const entries = Object.entries(DEFAULT_ROLE_PRESETS);
    expect(entries.length).toBe(27);
    entries.forEach(([, p]) => {
      expect(p.positions.length).toBeGreaterThan(0);
      Object.values(p.metrics).forEach(min => expect(min).toBeGreaterThanOrEqual(0));
      Object.values(p.metrics).forEach(min => expect(min).toBeLessThanOrEqual(100));
    });
  });

  it('place d\'abord les rôles dont c\'est le poste principal', () => {
    const st = presetsForPosition('ST').map(([name]) => name);
    expect(st[0]).toBe('Renard des surfaces');
    expect(st.indexOf('Neuf et demi')).toBeGreaterThan(st.indexOf('Attaquant presseur'));
  });

  it('écarte les spécialistes des rôles d\'un poste', () => {
    const cm = presetsForPosition('CM').map(([name]) => name);
    expect(cm).toContain('Regista');
    expect(cm).not.toContain('Créateur sur coups de pied arrêtés');
    expect(presetsForPosition(undefined)).toEqual([]);
  });

  it('choisit le rôle d\'indice le plus haut', () => {
    const presets = {
      un: { positions: ['CB'], metrics: { A: 50 } },
      deux: { positions: ['CB'], metrics: { B: 50 } },
      autre: { positions: ['ST'], metrics: { C: 50 } },
    };
    const best = bestPreset(player({ 'A pct': 40, 'B pct': 75, 'C pct': 99 }), presets);
    expect(best?.name).toBe('deux');
    expect(best?.index).toBe(75);
  });
});
