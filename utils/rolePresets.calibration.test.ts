/**
 * Calibration des rôles officiels (audit des 27 rôles) : seuils, postes, poids des planchers,
 * cohérence de l'indice entre la fiche joueur et le Chasseur de pépites
 */
import { describe, expect, it } from 'vitest';
import { PlayerData } from '../types';
import {
  DEFAULT_ROLE_PRESETS as R, presetWeights, presetsForPosition, rankPresets, roleIndex, roleIndexBreakdown,
} from './rolePresets';
import { DEFAULT_CONSTRAINTS, filterProspects } from './prospects';
import { sanitizePresets } from './customPresets';

const NOW = new Date('2026-10-26T12:00:00Z');
const CAPS = { marketValue: true, contract: true, estimate: true };
const OPEN = { ...DEFAULT_CONSTRAINTS, ageMax: 99, minutesMin: 0, valueMax: null };

// Joueur dont tous les percentiles des rôles officiels valent `v`, sauf ceux précisés
const allMetrics = Array.from(new Set(Object.values(R).flatMap(p => Object.keys(presetWeights(p)))));
const player = (Position: string, v: number, fields: Record<string, number | string | undefined> = {}): PlayerData => ({
  Player: `${Position}-${v}`, Team: 'T', League: 'L 2026-27', Competition: 'ESP', Position, Age: 22,
  'Minutes played': 900, 'Matches played': 10,
  ...Object.fromEntries(allMetrics.map(m => [`${m} pct`, v])),
  ...fields,
} as PlayerData);

describe('seuils calibrés', () => {
  it('appliquent exactement les changements validés', () => {
    expect(R['Gardien libéro'].metrics).toEqual({ 'Exits per 90': 60, 'Accurate long passes, %': 55, 'Prevented goals per 90': 45 });
    expect(R['Gardien relanceur'].metrics).toEqual({ 'Accurate passes, %': 65, 'Passes per 90': 70 });
    expect(R['Défenseur porteur'].metrics).toEqual({ 'Progressive runs per 90': 70, 'Progressive carry distance per 90': 65, 'Ground duels won, %': 30 });
    expect(R['Milieu percuteur'].metrics).toEqual({ 'Dribbles per 90': 70, 'Progressive runs per 90': 70, 'Successful dribbles, %': 45 });
    expect(R['Numéro 10'].metrics).toEqual({ 'Key passes per 90': 70, 'xA per 90': 70, 'xT per 90': 60 });
    expect(R['Neuf et demi'].metrics).toEqual({ 'xG per 90': 70, 'Touches in box per 90': 65, 'Shots per 90': 60, 'Key passes per 90': 40 });
    expect(R['Créateur excentré'].metrics['xA per 90']).toBe(70);
    expect(R['Faux neuf'].metrics['Passes per 90']).toBe(70);
    expect(R['Attaquant presseur'].metrics).toEqual({ 'PAdj Recoveries': 60, 'Successful defensive actions per 90': 60, 'xG per 90': 45 });
  });

  it('conserve les deux exceptions décidées', () => {
    expect(R['Gardien sur sa ligne'].metrics['Prevented goals per 90']).toBe(65);
    expect(R["Défenseur d'anticipation"].metrics['PAdj Interceptions']).toBe(70);
  });

  it('ne change que la description de deux rôles, sans prétendre mesurer ce qui est absent', () => {
    expect(R['Attaquant de profondeur'].metrics).toEqual({ 'Progressive runs per 90': 70, 'Carries into box per 90': 65, 'xG per 90': 60 });
    expect(R['Attaquant de profondeur'].description).toMatch(/courses sans ballon ne sont pas mesurées/);
    expect(R['Créateur sur coups de pied arrêtés'].metrics).toEqual({ 'Big chances created per 90': 70, 'Key passes per 90': 65, 'Accurate crosses, %': 60 });
    expect(R['Créateur sur coups de pied arrêtés'].description).toMatch(/pas isolés dans les données/);
  });

  it('laisse les seize autres rôles identiques', () => {
    const unchanged = ['Gardien sur sa ligne', 'Défenseur relanceur', 'Stoppeur', "Défenseur d'anticipation", 'Latéral offensif',
      'Latéral défensif', 'Latéral intérieur', 'Sentinelle', 'Regista', 'Milieu récupérateur', 'Milieu box-to-box', 'Mezzala',
      'Ailier de débordement', 'Attaquant intérieur', 'Renard des surfaces', 'Pivot'];
    expect(Object.fromEntries(unchanged.map(n => [n, R[n]]))).toMatchSnapshot();
  });
});

describe('postes', () => {
  it('réserve Faux neuf aux avant-centres et Créateur excentré aux ailiers', () => {
    expect(R['Faux neuf'].positions).toEqual(['ST']);
    expect(R['Créateur excentré'].positions).toEqual(['W']);
    const am = presetsForPosition('AM').map(([n]) => n);
    expect(am).not.toContain('Faux neuf');
    expect(am).not.toContain('Créateur excentré');
    expect(am).toContain('Numéro 10');
    expect(presetsForPosition('ST').map(([n]) => n)).toContain('Faux neuf');
    expect(presetsForPosition('W').map(([n]) => n)).toContain('Créateur excentré');
  });

  it('écarte un milieu offensif de Faux neuf et Créateur excentré dans le Chasseur', () => {
    const am = player('AM', 95);
    expect(filterProspects([am], R['Faux neuf'], 1, OPEN, CAPS, NOW).funnel.position).toBe(0);
    expect(filterProspects([am], R['Créateur excentré'], 1, OPEN, CAPS, NOW).funnel.position).toBe(0);
    expect(filterProspects([am], R['Numéro 10'], 1, OPEN, CAPS, NOW).players).toHaveLength(1);
  });
});

describe('poids', () => {
  it('fait peser les planchers 0,5 et non 1,5', () => {
    expect(presetWeights(R['Défenseur porteur'])['Ground duels won, %']).toBe(0.5);
    expect(presetWeights(R['Neuf et demi'])['Key passes per 90']).toBe(0.5);
    expect(presetWeights(R['Gardien libéro'])['Prevented goals per 90']).toBe(0.5);
    // Utilisés tels quels par la décomposition
    const cases: [string, string, string][] = [
      ['Défenseur porteur', 'CB', 'Ground duels won, %'], ['Neuf et demi', 'ST', 'Key passes per 90'], ['Gardien libéro', 'GK', 'Prevented goals per 90'],
    ];
    cases.forEach(([role, pos, metric]) => {
      const t = roleIndexBreakdown(player(pos, 70), R[role]).terms.find(x => x.metric === metric)!;
      expect(t).toMatchObject({ weight: 0.5, eliminatory: true, ranking: true });
    });
  });

  it('Numéro 10 : xT éliminatoire compté une seule fois (1,5), actions menant à un tir en classement (1)', () => {
    const w = presetWeights(R['Numéro 10']);
    expect(w['xT per 90']).toBe(1.5);
    expect(w['Shot-creating actions per 90']).toBe(1);
    expect(R['Numéro 10'].weights).not.toHaveProperty('xT per 90');
    const terms = roleIndexBreakdown(player('AM', 80), R['Numéro 10']).terms;
    expect(terms.filter(t => t.metric === 'xT per 90')).toHaveLength(1);
  });

  it('Gardien relanceur : précision de relance hors de l\'indice, relances longues à −1', () => {
    const w = presetWeights(R['Gardien relanceur']);
    expect(w).not.toHaveProperty('Distribution accuracy, %');
    expect(w['Launch rate, %']).toBe(-1);
  });
});

describe('cohérence de l\'indice', () => {
  it('roleIndexBreakdown égale roleIndex sur tous les rôles officiels et postes compatibles', () => {
    let seed = 11;
    const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    for (let i = 0; i < 200; i++) {
      Object.values(R).forEach(pr => pr.positions.forEach(pos => {
        const fields: Record<string, number | undefined> = {};
        allMetrics.forEach(m => { fields[`${m} pct`] = rand() < 0.1 ? undefined : Math.round(rand() * 100); });
        const p = player(pos, 50, fields);
        expect(roleIndexBreakdown(p, pr).total).toBe(roleIndex(p, pr));
      }));
    }
  });

  it('donne le même indice dans la fiche (rankPresets) et le Chasseur (roleIndex des éligibles)', () => {
    ['ST', 'AM', 'W', 'CB', 'GK', 'CM'].forEach((pos, i) => {
      const p = player(pos, 60 + i * 5);
      rankPresets(p, R, 10).forEach(({ name, index }) => {
        const search = filterProspects([p], R[name], 1, OPEN, CAPS, NOW);
        if (search.players.length) expect(roleIndex(search.players[0], R[name])).toBe(index);
        expect(roleIndexBreakdown(p, R[name]).total).toBe(index);
      });
    });
  });
});

describe('données manquantes', () => {
  it('rend non éligible, sans P0, un joueur sans xT pour Numéro 10 ou sans plancher de duels pour Défenseur porteur', () => {
    const n10 = filterProspects([player('AM', 90, { 'xT per 90 pct': undefined })], R['Numéro 10'], 1, OPEN, CAPS, NOW);
    expect(n10.players).toHaveLength(0);
    expect(n10.funnel.insufficientData).toBe(1);
    const cb = filterProspects([player('CB', 90, { 'Ground duels won, % pct': undefined })], R['Défenseur porteur'], 1, OPEN, CAPS, NOW);
    expect(cb.funnel.insufficientData).toBe(1);
  });

  it('applique les planchers bas comme de vrais seuils', () => {
    const weak = filterProspects([player('CB', 90, { 'Ground duels won, % pct': 25 })], R['Défenseur porteur'], 1, OPEN, CAPS, NOW);
    expect(weak.funnel.belowThreshold).toBe(1);
    const ok = filterProspects([player('CB', 90, { 'Ground duels won, % pct': 30 })], R['Défenseur porteur'], 1, OPEN, CAPS, NOW);
    expect(ok.players).toHaveLength(1);
  });
});

describe('rôles personnalisés', () => {
  it('gardent leur propre définition, indépendante des rôles officiels', () => {
    const custom = sanitizePresets({ 'Mon 9 créatif': { positions: ['AM', 'ST'], metrics: { 'Shot-creating actions per 90': 60, 'Passes per 90': 60 } } }, R)['Mon 9 créatif'];
    expect(custom.positions).toEqual(['AM', 'ST']);
    const p = player('AM', 80);
    expect(filterProspects([p], custom, 1, OPEN, CAPS, NOW).players).toHaveLength(1);
    expect(roleIndex(p, custom)).toBe(80);
  });

  it('ne peuvent toujours pas prendre le nom d\'un rôle officiel modifié', () => {
    const out = sanitizePresets({ 'Faux neuf': { positions: ['AM'], metrics: { 'Key passes per 90': 60 } } }, R);
    expect(out['Faux neuf']).toBeUndefined();
    expect(out['Faux neuf (perso)'].positions).toEqual(['AM']);
    expect(R['Faux neuf'].positions).toEqual(['ST']);
  });
});
