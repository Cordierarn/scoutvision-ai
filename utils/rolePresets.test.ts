import { describe, expect, it } from 'vitest';
import { PlayerData } from '../types';
import {
  DEFAULT_ROLE_PRESETS, MIDFIELD_PROFILE_BONUS, RolePreset, bestPreset, presetWeights, presetsForPosition,
  rankPresets, roleIndex, roleIndexBreakdown, weightedRoleScore,
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

describe('roleIndexBreakdown', () => {
  it('reproduit roleIndex et explique chaque terme', () => {
    const p = player({ 'A pct': 80, 'B pct': 50, 'C pct': 30 });
    const b = roleIndexBreakdown(p, preset);
    expect(b.total).toBe(roleIndex(p, preset));
    const byMetric = Object.fromEntries(b.terms.map(t => [t.metric, t]));
    expect(byMetric.A).toMatchObject({ eliminatory: true, ranking: false, weight: 1.5, inverted: false, scored: 80 });
    expect(byMetric.B).toMatchObject({ eliminatory: true, ranking: true, weight: 2 });
    expect(byMetric.C).toMatchObject({ eliminatory: false, ranking: true, weight: -1, inverted: true, percentile: 30, scored: 70 });
    // Les contributions somment la moyenne pondérée, les parts somment 1
    expect(b.terms.reduce((s, t) => s + t.contribution, 0)).toBeCloseTo(b.weightedScore!, 10);
    expect(b.terms.reduce((s, t) => s + t.share, 0)).toBeCloseTo(1, 10);
    expect(b.bonus).toBe(0);
  });

  it('ignore les percentiles absents sans les compter comme 0', () => {
    const p = player({ 'A pct': 70 });
    const b = roleIndexBreakdown(p, preset);
    const byMetric = Object.fromEntries(b.terms.map(t => [t.metric, t]));
    expect(byMetric.B).toMatchObject({ percentile: undefined, scored: undefined, share: 0, contribution: 0 });
    expect(b.total).toBe(roleIndex(p, preset));
    expect(b.total).toBe(70);
  });

  it('inclut le bonus de profil de milieu et le plafond', () => {
    const mid = { ...preset, midfieldProfiles: ['sentinelle'] };
    const p = player({ 'A pct': 100, 'B pct': 100, 'C pct': 0, 'Midfield profile': 'sentinelle' });
    const b = roleIndexBreakdown(p, mid);
    expect(b.bonus).toBe(MIDFIELD_PROFILE_BONUS);
    expect(b.total).toBe(100);
    expect(b.total).toBe(roleIndex(p, mid));
  });

  it('vaut 0 sans aucun percentile, sans bonus', () => {
    const b = roleIndexBreakdown(player({ 'Midfield profile': 'sentinelle' }), { ...preset, midfieldProfiles: ['sentinelle'] });
    expect(b).toMatchObject({ weightedScore: undefined, bonus: 0, total: 0 });
  });

  it('égale roleIndex sur les 27 rôles officiels pour des joueurs variés', () => {
    // Générateur pseudo-aléatoire déterministe
    let seed = 42;
    const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const metrics = Array.from(new Set(Object.values(DEFAULT_ROLE_PRESETS)
      .flatMap(p => Object.keys(presetWeights(p)))));
    const profiles = ['sentinelle', 'organisateur', 'box-to-box', 'meneur offensif', 'autre'];
    for (let i = 0; i < 300; i++) {
      const fields: Record<string, string | number> = { 'Midfield profile': profiles[i % profiles.length] };
      metrics.forEach(m => { if (rand() > 0.15) fields[`${m} pct`] = Math.round(rand() * 100); });
      const p = player(fields);
      Object.values(DEFAULT_ROLE_PRESETS).forEach(pr => {
        expect(roleIndexBreakdown(p, pr).total).toBe(roleIndex(p, pr));
      });
    }
  });
});

describe('rankPresets', () => {
  it('classe les rôles du poste par indice, le premier étant bestPreset', () => {
    const fields: Record<string, number> = {};
    Object.values(DEFAULT_ROLE_PRESETS).forEach(pr => Object.keys(presetWeights(pr)).forEach(m => { fields[`${m} pct`] = (m.length * 7) % 100; }));
    const p = player({ ...fields, Position: 'ST' });
    const ranked = rankPresets(p, DEFAULT_ROLE_PRESETS, 10);
    expect(ranked[0].name).toBe(bestPreset(p)!.name);
    expect(ranked[0].index).toBe(bestPreset(p)!.index);
    ranked.forEach(r => expect(r.index).toBe(roleIndex(p, r.preset)));
    for (let i = 1; i < ranked.length; i++) expect(ranked[i - 1].index).toBeGreaterThanOrEqual(ranked[i].index);
  });

  it('écarte les rôles sans aucun percentile', () => {
    expect(rankPresets(player({ Position: 'ST' }))).toEqual([]);
  });
});
