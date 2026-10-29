import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { TeamStats } from '../types';
import { percentileRank, teamRank } from './recruitment';
import {
  STYLE_METRICS, STYLE_MIN_MATCHES, STYLE_PCA_VARIANCE, styleMapPopulation, STYLE_TREND_MATCHES, TEAM_METRICS, styleReliability, teamCohort, teamMetric, teamMetricRank,
  teamMetricRanks, teamTotals, teamValue,
} from './teamMetrics';

const team = (id: string, over: Record<string, unknown> = {}): TeamStats => ({
  team_id: id, team: id, competition: 'FRA', league: 'Ligue 1 2025-26', season: '2025-26', ...over,
} as TeamStats);

describe('valeurs absentes', () => {
  it('null, undefined, "", NaN : jamais 0', () => {
    for (const v of [null, undefined, '', NaN, Infinity, '1.2']) expect(teamValue(team('a', { PPDA: v }), 'PPDA')).toBeNull();
    expect(teamValue(team('a', { PPDA: 0 }), 'PPDA')).toBe(0);
    expect(teamValue(null, 'PPDA')).toBeNull();
  });

  it('une équipe sans valeur n\'a pas de rang (pas de P50) et ne compte pas dans la cohorte', () => {
    const ppda = teamMetric('PPDA')!;
    for (const v of [null, undefined, '', NaN]) {
      const cohort = [team('a', { PPDA: v }), team('b', { PPDA: 8 }), team('c', { PPDA: 12 })];
      const r = teamMetricRank(cohort[0], cohort, ppda);
      expect(r.value).toBeNull();
      expect(r.rank).toBeUndefined();
      expect(r.teams).toBe(2);
      // les autres se classent sans l'absente
      expect(teamMetricRank(cohort[1], cohort, ppda).rank).toBeCloseTo(75, 10);
    }
  });

  it('cohorte entièrement absente (championnat sans analytics) : aucun rang', () => {
    const cohort = [team('a'), team('b'), team('c')];
    expect(teamMetricRanks(cohort[0], cohort, STYLE_METRICS).every(r => r.rank === undefined && r.value === null)).toBe(true);
  });
});

describe('rang : source unique teamRank', () => {
  const cohort = Array.from({ length: 18 }, (_, i) => team(`t${i}`, { 'xG per 90': 1 + i * 0.1, 'xGA per 90': 2 - i * 0.05, PPDA: 8 + i }));

  it('identique au calcul du Recrutement pour chaque métrique', () => {
    TEAM_METRICS.filter(m => ['xG per 90', 'xGA per 90', 'PPDA'].includes(m.key)).forEach(m => {
      cohort.forEach(t => expect(teamMetricRank(t, cohort, m).rank).toBe(teamRank(t, cohort, m.key, m.direction === 'higher')));
    });
  });

  it('premier de 18 : 100 − 50/18 (97,2), pas le P94 de l\'ancienne formule ; dernier : 2,8', () => {
    const xg = teamMetric('xG per 90')!;
    expect(teamMetricRank(cohort[17], cohort, xg).rank).toBeCloseTo(100 - 50 / 18, 10);
    expect(teamMetricRank(cohort[0], cohort, xg).rank).toBeCloseTo(50 / 18, 10);
    // ancienne formule de l'onglet tactique : part strictement inférieure, plafonnée à 17/18
    expect(Math.round((17 / 18) * 100)).toBe(94);
  });

  it('sens inversé : moins d\'xG concédés et PPDA bas classent haut', () => {
    expect(teamMetricRank(cohort[17], cohort, teamMetric('xGA per 90')!).rank).toBeCloseTo(100 - 50 / 18, 10);
    expect(teamMetricRank(cohort[0], cohort, teamMetric('PPDA')!).rank).toBeCloseTo(100 - 50 / 18, 10);
  });

  it('égalités : rang moyen, deux équipes égales ont le même rang', () => {
    const tied = [team('a', { PPDA: 10 }), team('b', { PPDA: 10 }), team('c', { PPDA: 8 }), team('d', { PPDA: 12 })];
    const ppda = teamMetric('PPDA')!;
    const a = teamMetricRank(tied[0], tied, ppda).rank;
    expect(a).toBe(teamMetricRank(tied[1], tied, ppda).rank);
    expect(a).toBeCloseTo(50, 10);
    expect(percentileRank([1, 1, 1], 1)).toBe(50);
  });

  it('cohorte = même compétition et même saison, jamais mélangées', () => {
    const teams = [team('a'), team('b', { league: 'Ligue 1 2024-25', season: '2024-25' }), team('c', { competition: 'UCL', league: 'Champions League 2025-26' }), team('d')];
    expect(teamCohort(teams[0], teams).map(t => t.team_id)).toEqual(['a', 'd']);
  });
});

describe('totaux d\'équipe', () => {
  it('buts de toute l\'équipe depuis team_season, null si inconnus', () => {
    // PSG 2026-27 : 1,833 but par 90 sur 6 matchs = 11 (somme des joueurs suivis : 10)
    expect(teamTotals(team('psg', { Matches: 6, 'Goals per 90': 1.833, 'Goals against per 90': 1.333 }))).toEqual({ matches: 6, goalsFor: 11, goalsAgainst: 8 });
    expect(teamTotals(team('x', { Matches: 6 }))).toEqual({ matches: 6, goalsFor: null, goalsAgainst: null });
    expect(teamTotals(null)).toEqual({ matches: null, goalsFor: null, goalsAgainst: null });
  });
});

describe('fiabilité du style', () => {
  it('seuils mesurés : non nommé sous 5 matchs, tendance de 5 à 9, observé à partir de 10', () => {
    expect([STYLE_TREND_MATCHES, STYLE_MIN_MATCHES]).toEqual([5, 10]);
    expect(styleReliability(1, 'High press')).toBe('insufficient');
    expect(styleReliability(4, 'High press')).toBe('insufficient');
    expect(styleReliability(5, 'High press')).toBe('trend');
    expect(styleReliability(9, 'High press')).toBe('trend');
    expect(styleReliability(10, 'High press')).toBe('observed');
    expect(styleReliability(30, undefined)).toBe('unknown');
    expect(styleReliability(undefined, 'High press')).toBe('insufficient');
  });

  it('les 6 indicateurs du style suivent scripts/models.py (PPDA inversé)', () => {
    expect(STYLE_METRICS.map(m => m.key)).toEqual(['Possession, %', 'Field tilt', 'PPDA', 'Defensive line height', 'Direct speed', 'Passes per sequence']);
    expect(STYLE_METRICS.find(m => m.key === 'PPDA')!.direction).toBe('lower');
  });
});

// Données présentes localement (npm run data:pull) : la variance affichée suit les données
const TEAMS_DIR = 'public/data/teams';
describe.skipIf(!existsSync(TEAMS_DIR))('variance expliquée de la carte des styles', () => {
  it('ACP des 6 indicateurs sur toutes les équipes-saisons : PC1 et PC2 à 0,5 point près', () => {
    const rows: number[][] = [];
    readdirSync(TEAMS_DIR).filter(f => f.endsWith('.json')).forEach(f => {
      const d = JSON.parse(readFileSync(`${TEAMS_DIR}/${f}`, 'utf8')) as { columns: string[]; rows: unknown[][] };
      const idx = STYLE_METRICS.map(m => d.columns.indexOf(m.key));
      d.rows.forEach(r => {
        if (!idx.every(i => typeof r[i] === 'number' && Number.isFinite(r[i]))) return;    // équipe sans analytics : hors ACP
        rows.push(idx.map((i, k) => (STYLE_METRICS[k].direction === 'lower' ? -1 : 1) * (r[i] as number)));
      });
    });
    const n = rows.length, k = 6;
    const mean = Array.from({ length: k }, (_, j) => rows.reduce((s, r) => s + r[j], 0) / n);
    const sd = Array.from({ length: k }, (_, j) => Math.sqrt(rows.reduce((s, r) => s + (r[j] - mean[j]) ** 2, 0) / n));
    const z = rows.map(r => r.map((v, j) => (v - mean[j]) / sd[j]));
    const c = Array.from({ length: k }, (_, a) => Array.from({ length: k }, (_, b) => z.reduce((s, r) => s + r[a] * r[b], 0) / n));
    // Deux plus grandes valeurs propres : puissance itérée avec déflation ; total = trace (= 6)
    const eig: number[] = [];
    for (let e = 0; e < 2; e++) {
      let v = Array.from({ length: k }, (_, i) => 1 + i);
      for (let it = 0; it < 500; it++) {
        const w = c.map(r => r.reduce((s, x, j) => s + x * v[j], 0));
        const norm = Math.hypot(...w);
        v = w.map(x => x / norm);
      }
      const lambda = c.reduce((s, r, i) => s + v[i] * r.reduce((t, x, j) => t + x * v[j], 0), 0);
      eig.push(lambda);
      for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) c[a][b] -= lambda * v[a] * v[b];
    }
    const total = k;
    expect(Math.abs(eig[0] / total - STYLE_PCA_VARIANCE.pc1)).toBeLessThan(0.005);
    expect(Math.abs(eig[1] / total - STYLE_PCA_VARIANCE.pc2)).toBeLessThan(0.005);
  });
});

describe('carte des styles : une équipe-saison par point', () => {
  const lens = (season: string, Style: string, x = 1) => team('lens', { team: 'Lens', season, league: `Ligue 1 ${season}`, Style, 'Style x': x, 'Style y': 0 });
  const teams = [lens('2023-24', 'High press'), lens('2024-25', 'Patient build-up', 2), lens('2025-26', 'Patient build-up', 3),
    team('psg', { season: '2025-26', Style: 'Patient build-up', 'Style x': 4, 'Style y': 1 }),
    team('om', { season: '2024-25', league: 'Ligue 1 2024-25', Style: 'High press', 'Style x': 0, 'Style y': 0 }),
    team('ucl', { competition: 'UCL', Style: 'High press', 'Style x': 0, 'Style y': 0 }),
    team('kas', { season: '2025-26', Style: undefined })];
  it('Toutes les saisons : Lens 2023-24, 2024-25 et 2025-26 sont trois points distincts', () => {
    const pop = styleMapPopulation(teams[2], teams, true);
    expect(pop.filter(p => p.team.team_id === 'lens').map(p => `${p.team.season}:${p.kind}`)).toEqual(['2023-24:club', '2024-25:club', '2025-26:selected']);
    expect(pop.find(p => p.team.team_id === 'psg')?.kind).toBe('same');
    expect(pop.some(p => p.team.competition === 'UCL')).toBe(false);
    expect(pop.some(p => p.team.team_id === 'kas')).toBe(false);          // sans coordonnées
  });
  it('saison sélectionnée : seulement cette saison, aucun mélange', () => {
    const pop = styleMapPopulation(teams[2], teams, false);
    expect(pop.map(p => p.team.team_id)).toEqual(['lens', 'psg']);
    expect(pop.every(p => p.team.season === '2025-26')).toBe(true);
  });
});
