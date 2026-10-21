import { describe, expect, it } from 'vitest';
import { PlayerData, TeamStats } from '../types';
import { AgeCurves, MarketValues, TransferModel } from '../services/dataLoader';
import { RolePreset } from './rolePresets';
import { PlacedSlot } from './lineup';
import {
  Candidate, DEFAULT_FILTERS, Models, Target, complementFor, forecastMetric, forecastRole, leagueLevel, leagueRows,
  markEfficient, monthsUntil, peerIndices, percentileRank, positionFromSlot, rankCandidates, slotNeeds, slotPartner,
  needOrder, squadProfile, teamRank,
} from './recruitment';

const player = (fields: Record<string, string | number | undefined>): PlayerData => ({
  Player: 'X', Team: 'T', League: 'L', Position: 'CB', 'Matches played': 30, 'Minutes played': 2500,
  'Player ID': 'p', 'Team ID': 't', Competition: 'AAA', 'League tier': 1, Age: 25, ...fields,
});

const curves: AgeCurves = {
  pairs: 100,
  curves: { CB: { A: { beta: -0.5, ages: { '25': [1, 100], '33': [-6, 40] } } } },
};

const transfer: TransferModel = {
  pairs: 1000, movers: 200, clubChanges: 100, context: ['Team field tilt'],
  leagues: { AAA: { level: 4, moves: 80 }, BBB: { level: -2, moves: 40 }, CCC: { level: 0, moves: 5 } },
  tierLevels: { '1': 4, '2': 0, '3': -2 },
  metrics: {
    A: { league: 1, context: [0.5], leagueChange: -2, clubChange: -1 },
    B: { league: 2, context: [0], leagueChange: 0, clubChange: 0 },
  },
  validation: null,
};

const models: Models = { curves, transfer };
const target: Target = { teamId: 't', competition: 'AAA', tier: 1, context: { 'Team field tilt': 60 } };

describe('leagueLevel', () => {
  it('prend le niveau du championnat, sinon celui de son niveau PitchAPI', () => {
    expect(leagueLevel(transfer, 'BBB', 2)).toBe(-2);
    expect(leagueLevel(transfer, 'ZZZ', 3)).toBe(-2);
    expect(leagueLevel(transfer, 'ZZZ', undefined)).toBe(0);
    expect(leagueLevel({ ...transfer, tierLevels: {} }, 'ZZZ', 1)).toBe(0);
  });
});

describe('forecastMetric', () => {
  it('sans équipe cible : courbes d\'âge seules', () => {
    const f = forecastMetric(player({ 'A pct': 80 }), 'A', models)!;
    expect(f.regression).toBeCloseTo(-15, 10);
    expect(f.age).toBe(1);
    expect(f.development).toBeCloseTo(80 - 0.5 * 30 + 1, 10);
    expect([f.league, f.context, f.adaptation]).toEqual([0, 0, 0]);
    expect(f.next).toBeCloseTo(f.development, 10);
  });

  it('dans sa propre équipe : aucun terme de transfert', () => {
    const f = forecastMetric(player({ 'A pct': 80, 'Team field tilt': 40 }), 'A', models, target)!;
    expect(f.next).toBeCloseTo(f.development, 10);
  });

  it('changement de championnat : niveau, contexte et adaptation', () => {
    const p = player({ 'A pct': 60, 'Team ID': 'o', Competition: 'BBB', 'League tier': 2, 'Team field tilt': 50 });
    const f = forecastMetric(p, 'A', models, target)!;
    expect(f.league).toBeCloseTo(1 * (-2 - 4), 10);          // montée de niveau : percentile en baisse
    expect(f.context).toBeCloseTo(0.5 * (60 - 50), 10);      // équipe plus dominante
    expect(f.adaptation).toBe(-2);
    expect(f.next).toBeCloseTo(f.development - 6 + 5 - 2, 10);
  });

  it('même championnat, autre club : coût de changement de club seulement', () => {
    const p = player({ 'A pct': 60, 'Team ID': 'o', 'Team field tilt': 60 });
    const f = forecastMetric(p, 'A', models, target)!;
    expect(f.league).toBe(0);
    expect(f.context).toBe(0);
    expect(f.adaptation).toBe(-1);
  });

  it('sans contexte connu, sans courbe ou sans coefficient : termes neutres', () => {
    const p = player({ 'A pct': 60, 'B pct': 30, 'C pct': 10, 'Team ID': 'o', Competition: 'BBB' });
    expect(forecastMetric(p, 'A', models, target)!.context).toBe(0);
    const b = forecastMetric(p, 'B', models, target)!;
    expect(b.development).toBe(30);                          // pas de courbe pour B
    expect(b.league).toBeCloseTo(2 * (-2 - 4), 10);
    const c = forecastMetric(p, 'C', models, target)!;      // ni courbe ni coefficient
    expect(c.next).toBe(10);
    expect(forecastMetric(p, 'D', models, target)).toBeUndefined();
  });

  it('borne le percentile à 0-100', () => {
    const p = player({ 'B pct': 5, 'Team ID': 'o', Competition: 'BBB' });
    expect(forecastMetric(p, 'B', models, target)!.next).toBe(0);
  });
});

describe('forecastRole', () => {
  const preset: RolePreset = { positions: ['CB'], metrics: { A: 50 }, weights: { B: 1 } };

  it('décompose l\'écart entre l\'indice actuel et l\'indice projeté', () => {
    const p = player({ 'A pct': 70, 'B pct': 60, 'Team ID': 'o', Competition: 'BBB', 'Team field tilt': 55 });
    const f = forecastRole(p, preset, models, target)!;
    const parts = f.parts.regression + f.parts.age + f.parts.league + f.parts.context + f.parts.adaptation;
    expect(f.now + parts).toBeCloseTo(f.next, 10);
    expect(f.now).toBeCloseTo((1.5 * 70 + 60) / 2.5, 10);
    expect(f.parts.league).toBeLessThan(0);
  });

  it('compte les poids de complémentarité', () => {
    const p = player({ 'A pct': 70, 'B pct': 60, 'C pct': 90 });
    const plain = forecastRole(p, preset, models)!;
    const extra = forecastRole(p, preset, models, undefined, { C: 1 })!;
    expect(extra.now).toBeGreaterThan(plain.now);
    expect(extra.metrics.C).toBeDefined();
  });

  it('renvoie undefined sans percentile', () => {
    expect(forecastRole(player({}), preset, models)).toBeUndefined();
  });
});

describe('outils', () => {
  it('percentileRank : part des valeurs inférieures, égalités pour moitié', () => {
    expect(percentileRank([], 5)).toBe(50);
    expect(percentileRank([1, 2, 3, 4], 0)).toBe(0);
    expect(percentileRank([1, 2, 3, 4], 9)).toBe(100);
    expect(percentileRank([1, 2, 2, 4], 2)).toBe(50);
    expect(percentileRank([10, 20, 30, 40], 25)).toBe(50);
  });

  it('monthsUntil', () => {
    const asOf = new Date('2026-10-20');
    expect(monthsUntil('2027-06-30', asOf)).toBeCloseTo(8.3, 1);
    expect(monthsUntil('2026-06-30', asOf)).toBeLessThan(0);
    expect(monthsUntil(undefined, asOf)).toBeUndefined();
    expect(monthsUntil('inconnu', asOf)).toBeUndefined();
  });

  it('leagueRows : une ligne de championnat par joueur, la plus jouée', () => {
    const rows = leagueRows([
      player({ 'Player ID': 'a', Competition: 'AAA', 'Minutes played': 900 }),
      player({ 'Player ID': 'a', Competition: 'BBB', 'Minutes played': 1500 }),
      player({ 'Player ID': 'a', Competition: 'UCL', 'Minutes played': 3000 }),
      player({ 'Player ID': 'b', Competition: 'UCL', 'Minutes played': 600 }),
    ], c => c !== 'UCL');
    expect(rows.map(r => [r['Player ID'], r.Competition])).toEqual([['a', 'BBB']]);
  });

  it('positionFromSlot', () => {
    expect(positionFromSlot(0.1, 0.5)).toBe('GK');
    expect(positionFromSlot(0.3, 0.5)).toBe('CB');
    expect(positionFromSlot(0.3, 0.05)).toBe('FB');
    expect(positionFromSlot(0.6, 0.5)).toBe('CM');
    expect(positionFromSlot(0.85, 0.5)).toBe('ST');
    expect(positionFromSlot(0.85, 0.95)).toBe('W');
  });
});

describe('diagnostic de l\'équipe', () => {
  it('squadProfile : moyenne pondérée par les minutes, gardiens à part', () => {
    const league = [
      player({ 'Team ID': 't', 'Player ID': '1', 'Aerial duels won, % pct': 90, 'Aerial duels won per 90 pct': 90, 'Minutes played': 3000 }),
      player({ 'Team ID': 't', 'Player ID': '2', 'Aerial duels won, % pct': 10, 'Aerial duels won per 90 pct': 10, 'Minutes played': 1000 }),
      player({ 'Team ID': 't', 'Player ID': 'g', Position: 'GK', 'Aerial duels won, % pct': 0, 'Prevented goals per 90 pct': 80, 'Save rate, % pct': 60 }),
      player({ 'Team ID': 'u', 'Player ID': '3', 'Aerial duels won, % pct': 50, 'Aerial duels won per 90 pct': 50 }),
      player({ 'Team ID': 'v', 'Player ID': '4', 'Aerial duels won, % pct': 20, 'Aerial duels won per 90 pct': 20 }),
    ];
    const profile = squadProfile('t', league);
    const aerial = profile.find(d => d.key === 'aerial')!;
    expect(aerial.value).toBeCloseTo((90 * 3000 + 10 * 1000) / 4000, 10);   // le gardien ne compte pas
    expect(aerial.teams).toBe(3);
    expect(aerial.rank).toBeCloseTo(100 * 2.5 / 3, 10);
    expect(profile.find(d => d.key === 'goalkeeping')!.value).toBe(70);
    expect(squadProfile('absente', league)).toEqual([]);
  });

  it('teamRank : sens inversé pour les métriques où moins c\'est mieux', () => {
    const team = (id: string, xga: number) => ({ team_id: id, team: id, competition: 'AAA', league: 'L', season: 'S', 'xGA per 90': xga }) as TeamStats;
    const cohort = [team('a', 1.0), team('b', 1.5), team('c', 2.0)];
    expect(teamRank(cohort[0], cohort, 'xGA per 90', false)).toBeCloseTo(100 * 2.5 / 3, 10);
    expect(teamRank(cohort[2], cohort, 'xGA per 90', false)).toBeCloseTo(100 * 0.5 / 3, 10);
    expect(teamRank(cohort[0], cohort, 'xG per 90', true)).toBeUndefined();
  });

  const placed = (id: number, x: number, y: number, starter: string | null, backups: [string, number][] = []): PlacedSlot => ({
    slot: { slot: id, x, y, players: [] },
    starter: starter ? { id: starter, name: starter, starts: 20 } : null,
    backups: backups.map(([b, starts]) => ({ id: b, name: b, starts })),
  });

  it('slotNeeds : rang projeté, niveaux et signaux', () => {
    // Profil de stoppeur : fort dans les duels, moyen à la relance
    const strong = player({ 'Player ID': 's', 'Aerial duels won, % pct': 95, 'Ground duels won, % pct': 95, 'Clearances per 90 pct': 95, 'Shots blocked per 90 pct': 95, 'PAdj Tackles pct': 95, 'Aerial duels per 90 pct': 95, 'Dribbled past per 90 pct': 5, 'Fouls per 90 pct': 5, 'Progressive passes per 90 pct': 40, 'Accurate passes, % pct': 40, 'Passes to final third per 90 pct': 40, 'PAdj Interceptions pct': 40, 'PAdj Recoveries pct': 40, 'Progressive runs per 90 pct': 30, 'Progressive carry distance per 90 pct': 30 });
    const weak = player({ 'Player ID': 'w', 'Aerial duels won, % pct': 10, 'Ground duels won, % pct': 10, 'Clearances per 90 pct': 10, 'PAdj Interceptions pct': 10, 'PAdj Recoveries pct': 10, 'Progressive passes per 90 pct': 10, 'Accurate passes, % pct': 10 });
    const others = Array.from({ length: 20 }, (_, i) => player({
      'Player ID': `o${i}`, 'Team ID': `x${i}`, 'Aerial duels won, % pct': 5 * i, 'Ground duels won, % pct': 5 * i,
      'Clearances per 90 pct': 5 * i, 'PAdj Interceptions pct': 5 * i, 'PAdj Recoveries pct': 5 * i,
      'Progressive passes per 90 pct': 5 * i, 'Accurate passes, % pct': 5 * i, 'Passes to final third per 90 pct': 5 * i,
      'Progressive runs per 90 pct': 5 * i, 'Progressive carry distance per 90 pct': 5 * i,
    }));
    const market: MarketValues = { scrapedAt: '2026-10-20', players: new Map([['s', { value: 1e7, contract: '2027-06-30' }]]) };
    const needs = slotNeeds(
      [placed(1, 0.3, 0.3, 's', [['b', 5]]), placed(2, 0.3, 0.7, 'w'), placed(3, 0.85, 0.5, 'absent')],
      [strong, weak], [strong, weak, ...others], { curves: null, transfer: null }, market, new Date('2026-10-20'),
    );
    const [s, w, none] = needs;
    expect(s.presetName).toBe('Stoppeur');
    expect(s.rank!).toBeGreaterThan(90);
    expect(s.flags).toContain('contract');
    expect(s.level).toBe('medium');                 // solide, mais fin de contrat dans 8 mois
    expect(w.need).toBeGreaterThan(80);
    expect(w.level).toBe('high');
    expect(w.flags).toContain('depth');             // aucun remplaçant avec 3 titularisations
    expect(none.flags).toContain('noStarter');
    expect(none.level).toBe('unknown');
    expect(none.position).toBe('ST');
    expect(none.need).toBe(100);
  });

  it('slotNeeds : un titulaire solide mais en déclin passe à renforcer', () => {
    const metrics = ['Aerial duels won, %', 'Ground duels won, %', 'Clearances per 90', 'Shots blocked per 90', 'PAdj Tackles', 'Aerial duels per 90'];
    const veteran = player({ 'Player ID': 'v', Age: 33, ...Object.fromEntries(metrics.map(m => [`${m} pct`, 90])) });
    const peers = Array.from({ length: 10 }, (_, i) => player({ 'Player ID': `o${i}`, 'Team ID': `x${i}`, Age: 26,
      ...Object.fromEntries(metrics.map(m => [`${m} pct`, 10 * i])) }));
    const decline: AgeCurves = { pairs: 1, curves: { CB: Object.fromEntries(metrics.map(m => [m, { beta: 0, ages: { '33': [-8, 50] } }])) } };
    // Retour vers la moyenne seul (joueur jeune au-dessus de la moyenne) : pas de déclin signalé
    const regressionOnly: AgeCurves = { pairs: 1, curves: { CB: Object.fromEntries(metrics.map(m => [m, { beta: -0.5, ages: {} }])) } };
    const [young] = slotNeeds([placed(1, 0.3, 0.5, 'v', [['b', 4]])], [{ ...veteran, Age: 24 }], [veteran, ...peers],
      { curves: regressionOnly, transfer: null }, null, new Date('2026-10-20'));
    expect(young.forecast!.parts.regression).toBeCloseTo(-20, 10);
    expect(young.flags).not.toContain('decline');
    const [need] = slotNeeds([placed(1, 0.3, 0.5, 'v', [['b', 4]])], [veteran], [veteran, ...peers],
      { curves: decline, transfer: null }, null, new Date('2026-10-20'));
    expect(need.forecast!.parts.age).toBeCloseTo(-8, 10);
    expect(need.forecast!.parts.regression).toBe(0);
    expect(need.flags).toEqual(['decline']);
    expect(need.need).toBeLessThan(35);
    expect(need.level).toBe('medium');
  });

  it('slotNeeds : doublure jugée en part des matchs de la formation', () => {
    const p1 = player({ 'Player ID': 'a', 'Aerial duels won, % pct': 50 });
    const run = (backupStarts: number) => slotNeeds([{
      slot: { slot: 1, x: 0.3, y: 0.5, players: [] },
      starter: { id: 'a', name: 'a', starts: 5 },
      backups: [{ id: 'b', name: 'b', starts: backupStarts }],
    }], [p1], [p1], { curves: null, transfer: null }, null, new Date('2026-10-20'))[0].flags;
    expect(run(1)).not.toContain('depth');          // 6 matchs : 1 titularisation suffit
    expect(run(0)).toContain('depth');
  });

  it('slotNeeds : poste en rotation, référence = remplaçant de la case ou joueur du même poste', () => {
    const cb = (id: string, minutes: number, pctValue: number) => player({ 'Player ID': id, 'Minutes played': minutes,
      'Aerial duels won, % pct': pctValue, 'Ground duels won, % pct': pctValue, 'Clearances per 90 pct': pctValue });
    const team = [cb('b', 1500, 30), cb('sq', 2000, 70), cb('s1', 2500, 50)];
    const needs = slotNeeds([
      placed(1, 0.3, 0.3, 's1'),                          // titulaire avec données
      placed(2, 0.3, 0.7, 'gone', [['b', 4]]),            // titulaire sans données, remplaçant b
      placed(3, 0.3, 0.5, 'gone2', [['s1', 2]]),          // remplaçant déjà titulaire ailleurs : effectif
    ], team, team, { curves: null, transfer: null }, null, new Date('2026-10-20'));
    expect(needs[1].starter?.['Player ID']).toBe('b');
    expect(needs[1].flags).toContain('rotation');
    expect(needs[2].starter?.['Player ID']).toBe('sq');
    expect(needs[2].flags).toContain('rotation');
    expect(needs[2].level).not.toBe('low');              // une rotation n'est jamais « solide »
  });

  it('slotNeeds : un titulaire sans percentile des rôles de son poste compte comme un poste à pourvoir', () => {
    const [need] = slotNeeds([placed(1, 0.3, 0.5, 'v')], [player({ 'Player ID': 'v' })], [], { curves: null, transfer: null },
      null, new Date('2026-10-20'));
    expect(need.forecast).toBeUndefined();
    expect(need.flags).toContain('noStarter');
  });

  it('needOrder : prioritaires, puis à renforcer, puis solides', () => {
    const n = (level: string, need: number) => ({ level, need }) as never;
    expect(needOrder([n('low', 30), n('medium', 20), n('high', 70), n('unknown', 100), n('medium', 50), n('high', 100)]))
      .toEqual([5, 2, 3, 4, 1, 0]);
  });

  it('slotPartner : l\'autre central, le latéral du même côté', () => {
    const need = (position: string, x: number, y: number) =>
      ({ placed: placed(Math.round(x * 100 + y * 10), x, y, 'z'), starter: player({ Position: position }), position, need: 0, level: 'low', flags: [] }) as never;
    const needs = [need('CB', 0.3, 0.35), need('CB', 0.3, 0.65), need('FB', 0.35, 0.05), need('W', 0.75, 0.1), need('W', 0.75, 0.9), need('GK', 0.1, 0.5)];
    expect(slotPartner(needs, 0)).toBe(needs[1]);
    expect(slotPartner(needs, 2)).toBe(needs[3]);
    expect(slotPartner(needs, 3)).toBe(needs[2]);
    expect(slotPartner(needs, 4)).toBeUndefined();  // pas de latéral à droite
    expect(slotPartner(needs, 5)).toBeUndefined();
  });

  it('complementFor : points faibles du partenaire, dans le bon sens', () => {
    const partner = player({ 'Aerial duels won, % pct': 12, 'Dribbled past per 90 pct': 90, 'Ground duels won, % pct': 30, 'Clearances per 90 pct': 34, 'PAdj Tackles pct': 80 });
    const c = complementFor(partner, 'CB');
    expect(c.map(x => x.metric)).toEqual(['Dribbled past per 90', 'Aerial duels won, %', 'Ground duels won, %']);
    expect(c[0]).toEqual({ metric: 'Dribbled past per 90', value: 10, weight: -1 });
    expect(c[1].weight).toBe(1);
  });
});

describe('candidats', () => {
  const preset: RolePreset = { positions: ['CB'], metrics: { A: 60 }, weights: { B: 1 } };
  const market: MarketValues = {
    scrapedAt: '2026-10-20',
    players: new Map([
      ['c1', { value: 2e7, contract: '2030-06-30' }],
      ['c2', { value: 5e6, contract: '2027-06-30', estimated: 1e7 }],
      ['c3', { value: 1e6 }],
    ]),
  };
  const pool = [
    player({ 'Player ID': 'c1', 'Team ID': 'a', 'A pct': 90, 'B pct': 90 }),
    player({ 'Player ID': 'c2', 'Team ID': 'b', Competition: 'BBB', 'League tier': 2, 'A pct': 95, 'B pct': 95 }),
    player({ 'Player ID': 'c3', 'Team ID': 'c', 'A pct': 50, 'B pct': 50, Age: 19, 'Minutes played': 1000 }),
    player({ 'Player ID': 'c4', 'Team ID': 'd', 'A pct': 70, 'B pct': 70, Competition: 'CCC', 'League tier': 2 }),
    player({ 'Player ID': 'own', 'Team ID': 't', 'A pct': 99, 'B pct': 99 }),
    player({ 'Player ID': 'st', 'Team ID': 'e', Position: 'ST', 'A pct': 99, 'B pct': 99 }),
    player({ 'Player ID': 'short', 'Team ID': 'f', 'A pct': 99, 'B pct': 99, 'Minutes played': 500 }),
  ];
  const run = (filters = {}, extra = {}) => rankCandidates({
    pool, preset, target, models, peers: [40, 50, 60, 70], baseline: 60,
    filters: { ...DEFAULT_FILTERS, ...filters }, market, asOf: new Date('2026-10-20'), ...extra,
  });

  it('écarte son équipe, les autres postes et les joueurs sous le seuil de minutes', () => {
    const ids = run().map(c => c.player['Player ID']);
    expect(ids).not.toContain('own');
    expect(ids).not.toContain('st');
    expect(ids).not.toContain('short');
    expect(ids.length).toBe(4);
  });

  it('classe par indice projeté et calcule l\'apport, le rang et les critères', () => {
    const list = run();
    for (let i = 1; i < list.length; i++) expect(list[i - 1].forecast.next).toBeGreaterThanOrEqual(list[i].forecast.next);
    const c1 = list.find(c => c.player['Player ID'] === 'c1')!;
    expect(c1.gain).toBeCloseTo(c1.forecast.next - 60, 10);
    expect(c1.rank).toBe(100);
    expect(c1.thresholds).toEqual({ met: 1, total: 1 });
  });

  it('projette la montée de niveau : un 95e percentile d\'un championnat plus faible baisse', () => {
    const c2 = run().find(c => c.player['Player ID'] === 'c2')!;
    expect(c2.forecast.parts.league).toBeLessThan(0);
    expect(c2.flags).toContain('bigStep');
    expect(c2.flags).toContain('contract');
    expect(c2.flags).toContain('undervalued');
  });

  it('filtre l\'âge, le budget, le contrat et les championnats', () => {
    const ids = (f: object) => run(f).map(c => c.player['Player ID']).sort();
    expect(ids({ maxAge: 21 })).toEqual(['c3']);
    expect(ids({ maxValue: 6e6 })).toEqual(['c2', 'c3']);
    expect(ids({ maxValue: 6e6, includeUnknownValue: true })).toEqual(['c2', 'c3', 'c4']);
    expect(ids({ contractWithinMonths: 12 })).toEqual(['c2']);
    expect(ids({ leagues: 'same' })).toEqual(['c1', 'c3']);
    expect(ids({ leagues: 'other' })).toEqual(['c2', 'c4']);
    expect(ids({ leagues: 'lower' })).toEqual(['c2', 'c4']);
    expect(ids({ minAge: 20 })).toEqual(['c1', 'c2', 'c4']);
  });

  it('signale un championnat peu observé et un temps de jeu court', () => {
    const list = run();
    expect(list.find(c => c.player['Player ID'] === 'c4')!.flags).toContain('rareLeague');
    expect(list.find(c => c.player['Player ID'] === 'c3')!.flags).toContain('fewMinutes');
    const inProgress = run({}, { fewMinutes: 600 });
    expect(inProgress.find(c => c.player['Player ID'] === 'c3')!.flags).not.toContain('fewMinutes');
  });

  it('peerIndices : joueurs éligibles au rôle seulement, triés', () => {
    const peers = peerIndices(pool, preset, models);
    expect(peers.length).toBe(6);
    expect([...peers].sort((a, b) => a - b)).toEqual(peers);
  });
});

describe('markEfficient', () => {
  const cand = (id: string, next: number, value?: number) =>
    ({ player: player({ 'Player ID': id }), forecast: { now: 0, next, parts: { regression: 0, age: 0, league: 0, context: 0, adaptation: 0 }, metrics: {} },
      rank: 0, market: value === undefined ? undefined : { value }, thresholds: { met: 0, total: 0 }, flags: [], efficient: false }) as Candidate;

  it('garde les candidats qu\'aucun autre ne domine en indice et en prix', () => {
    const list = [cand('cher-bon', 80, 5e7), cand('moyen', 70, 1e7), cand('domine', 65, 2e7), cand('petit', 50, 1e6), cand('egal', 70, 1e7), cand('sans-valeur', 99)];
    markEfficient(list);
    const efficient = list.filter(c => c.efficient).map(c => c.player['Player ID']);
    expect(efficient.sort()).toEqual(['cher-bon', 'moyen', 'petit']);
  });
});
