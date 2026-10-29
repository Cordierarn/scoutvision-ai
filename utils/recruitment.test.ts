import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { PlayerData, TeamStats } from '../types';
import { AgeCurves, MarketValues, TeamLineups, TransferModel } from '../services/dataLoader';
import { DEFAULT_ROLE_PRESETS, RolePreset } from './rolePresets';
import { PlacedSlot, placeEleven } from './lineup';
import { formationPositions, isOutOfPosition, orderFormations, recruitmentFormation } from './teamLineups';
import { seasonCapabilities } from './prospects';
import {
  Candidate, DEFAULT_FILTERS, Models, RoleForecast, Target, complementFor, complementReading, displayIndex, forecastMetric,
  forecastRole, incumbentForecast, isManifestlyOutOfPosition, candidateView, leagueLevel, leagueRows, markEfficient, monthsUntil, peerIndices,
  percentileRank, positionFromSlot, projectionCascade, projectionError, searchCandidates, seasonMarket, slotNeeds, slotPartner,
  needOrder, slotDepth, squadProfile, teamRank, CONTEXT_EFFECT_NOTABLE,
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

  it('contexte de l\'équipe cible null dans les données : terme nul, jamais lu comme 0', () => {
    const p = player({ 'A pct': 60, 'Team ID': 'o', Competition: 'BBB', 'Team field tilt': 40 });
    const f = forecastMetric(p, 'A', models, { ...target, context: { 'Team field tilt': null } })!;
    expect(f.context).toBe(0);
    // l'ancien calcul lisait null comme 0 : 0.5 * (0 - 40) = -20 points
    expect(forecastMetric(p, 'A', models, { ...target, context: { 'Team field tilt': 0 } })!.context).toBe(-20);
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

  it('projection sportive : les poids du rôle seulement, jamais de complémentarité', () => {
    const p = player({ 'A pct': 70, 'B pct': 60, 'C pct': 90 });
    const f = forecastRole(p, preset, models)!;
    expect(Object.keys(f.metrics).sort()).toEqual(['A', 'B']);
    // la lecture de complémentarité est à part et ne touche pas la projection
    const reading = complementReading(p, [{ metric: 'C', value: 20, weight: 1 }], models)!;
    expect(reading.metrics).toEqual([{ metric: 'C', partner: 20, candidate: 90, inverted: false }]);
    expect(forecastRole(p, preset, models)).toEqual(f);
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

  it('slotDepth : titulaire, doublure, 3e option, rotation et signaux, sans niveau de besoin', () => {
    const cb = (id: string, minutes: number, extra: Record<string, unknown> = {}) => player({ 'Player ID': id, 'Minutes played': minutes, ...extra });
    const team = [cb('s1', 2500), cb('b', 1500), cb('sq', 2000), cb('old', 2200)];
    const market = new Map([['s1', '2027-03-31'], ['b', '2029-06-30']]);
    const depth = slotDepth([
      placed(1, 0.3, 0.3, 's1', [['b', 4], ['x', 1]]),   // doublure b (4), 3e option x (sans données)
      placed(2, 0.3, 0.7, 'gone', [['b', 4]]),            // titulaire sous le seuil : rotation, référence b (remplaçant de la case)
      placed(3, 0.3, 0.5, 'old'),                         // aucune doublure
      placed(4, 0.85, 0.5, 'absent'),                     // personne du poste dans les données
    ], team, { contractOf: p => market.get(p['Player ID']!), asOf: new Date('2026-10-20'), declining: p => p['Player ID'] === 'old' });
    const [a, b, c, d] = depth;
    expect(a.options.map(o => o.lineup.id)).toEqual(['s1', 'b', 'x']);
    expect(a.backup?.player?.['Player ID']).toBe('b');
    expect(a.thirdOption).toMatchObject({ lineup: { id: 'x', starts: 1 } });
    expect(a.thirdOption?.player).toBeUndefined();          // sous le seuil : données insuffisantes
    expect(a.slotMatches).toBe(25);
    expect(a.coverage).toBeCloseTo(5 / 25, 10);
    expect(a.signals).toEqual(['contract']);                // contrat dans 5 mois, doublure suffisante
    expect(b.starter?.['Player ID']).toBe('b');
    expect(b.signals).toContain('rotation');
    expect(c.signals).toEqual(['depth', 'decline']);
    expect(d.signals).toEqual(['noStarter', 'depth']);
    expect(d.starter).toBeUndefined();
    expect(Object.keys(a)).not.toContain('level');
    expect(Object.keys(a)).not.toContain('need');
  });

  it('slotDepth et slotNeeds partagent titulaire de référence, rotation, doublure et contrat', () => {
    const p1 = player({ 'Player ID': 'a', 'Aerial duels won, % pct': 50 });
    const eleven = [placed(1, 0.3, 0.5, 'a', [['b', 1]]), placed(2, 0.3, 0.7, 'gone', [['a', 2]])];
    const market: MarketValues = { scrapedAt: '2026-10-20', players: new Map([['a', { value: 1e6, contract: '2027-01-31' }]]) };
    const needs = slotNeeds(eleven, [p1], [p1], { curves: null, transfer: null }, market, new Date('2026-10-20'));
    const depth = slotDepth(eleven, [p1], { contractOf: p => market.players.get(p['Player ID']!)?.contract, asOf: new Date('2026-10-20') });
    needs.forEach((n, i) => {
      expect(n.starter?.['Player ID']).toBe(depth[i].starter?.['Player ID']);
      expect(n.contractMonths).toBe(n.starter ? depth[i].contractMonths : undefined);
      (['depth', 'rotation', 'contract'] as const).forEach(f => expect(n.flags.includes(f)).toBe(depth[i].signals.includes(f)));
    });
  });

  it('saison passée : aucun signal de contrat venu de l\'instantané Transfermarkt (slotDepth et slotNeeds)', () => {
    const p1 = player({ 'Player ID': 'a', 'Aerial duels won, % pct': 50 });
    const eleven = [placed(1, 0.3, 0.5, 'a', [['b', 5]])];
    const market: MarketValues = { scrapedAt: '2026-10-20', players: new Map([['a', { value: 1e6, contract: '2027-01-31' }]]) };
    const asOf = new Date('2026-10-20');
    const none = { marketValue: false, contract: false, estimate: false };
    expect(slotNeeds(eleven, [p1], [p1], { curves: null, transfer: null }, market, asOf)[0].flags).toContain('contract');
    const past = seasonMarket(market, none);
    expect(past).toBeNull();
    const [need] = slotNeeds(eleven, [p1], [p1], { curves: null, transfer: null }, past, asOf);
    expect(need.flags).not.toContain('contract');
    expect(need.contractMonths).toBeUndefined();
    const [depth] = slotDepth(eleven, [p1], { contractOf: past ? p => past.players.get(p['Player ID']!)?.contract : undefined, asOf });
    expect(depth.signals).not.toContain('contract');
  });

  it('poste recherché : titulaire manifestement hors poste → la case de la formation, besoin à évaluer', () => {
    const winger = player({ 'Player ID': 'w', Position: 'W', 'Dribbles per 90 pct': 80, 'Crosses per 90 pct': 70 });
    const fb = player({ 'Player ID': 'f', Position: 'FB', 'Crosses per 90 pct': 60, 'PAdj Tackles pct': 60 });
    const eleven = [placed(1, 0.3, 0.05, 'w'), placed(2, 0.3, 0.95, 'f')];
    const positions = new Map([[1, 'FB'], [2, 'FB']]);
    const run = (sp?: Map<number, string>) => slotNeeds(eleven, [winger, fb], [winger, fb], { curves: null, transfer: null }, null, new Date('2026-10-20'), sp);
    const [before] = run();
    expect(before.position).toBe('W');                 // sans lecture de la formation : poste de la fiche
    const [w, f] = run(positions);
    expect(w.position).toBe('FB');                     // ailier aligné latéral : on cherche un latéral
    expect(w.level).toBe('unknown');
    expect(w.flags).toContain('outOfPosition');
    expect(w.forecast).toBeUndefined();                // percentiles parmi les ailiers : indice non comparable
    expect(w.starter?.['Player ID']).toBe('w');
    expect(f.position).toBe('FB');                     // cohérent : inchangé
    expect(f.flags).not.toContain('outOfPosition');
    expect(f.forecast).toBeDefined();
  });

  it('poste recherché : pistons et milieux ne basculent jamais (faux positifs exclus)', () => {
    expect(isManifestlyOutOfPosition('W', 'WB')).toBe(false);
    expect(isManifestlyOutOfPosition('WB', 'W')).toBe(false);
    expect(isManifestlyOutOfPosition('ST', 'WB')).toBe(false);
    expect(isManifestlyOutOfPosition('AM', 'CM')).toBe(false);
    expect(isManifestlyOutOfPosition('CM', 'W')).toBe(false);
    expect(isManifestlyOutOfPosition('DM', 'CB')).toBe(false);
    expect(isManifestlyOutOfPosition('W', 'FB')).toBe(true);
    expect(isManifestlyOutOfPosition('FB', 'ST')).toBe(true);
    expect(isManifestlyOutOfPosition('GK', 'CB')).toBe(true);
    expect(isManifestlyOutOfPosition('W', undefined)).toBe(false);
  });

  it('poste d\'une case sans données : la formation plutôt que la géométrie', () => {
    const [geo] = slotDepth([placed(1, 0.6, 0.5, null)], []);
    expect(geo.position).toBe('CM');
    const [read] = slotDepth([placed(1, 0.6, 0.5, null)], [], { slotPositions: new Map([[1, 'AM']]) });
    expect(read).toMatchObject({ position: 'AM', positionSource: 'slot' });
  });

  it('titulaire : une seule projection, celle de la ligne du besoin, sans complémentarité', () => {
    const metrics = ['Aerial duels won, %', 'Ground duels won, %', 'Clearances per 90', 'Progressive passes per 90', 'Accurate passes, %'];
    const cb = player({ 'Player ID': 'c', ...Object.fromEntries(metrics.map(m => [`${m} pct`, 55])) });
    const [need] = slotNeeds([placed(1, 0.3, 0.5, 'c')], [cb], [cb], models, null, new Date('2026-10-20'));
    expect(incumbentForecast(need, need.presetName, need.preset, models)).toBe(need.forecast);
    const other = Object.entries(DEFAULT_ROLE_PRESETS).find(([n, p]) => p.positions.includes('CB') && n !== need.presetName)!;
    expect(incumbentForecast(need, other[0], other[1], models)).toEqual(forecastRole(cb, other[1], models));
    expect(incumbentForecast({ ...need, forecast: undefined }, need.presetName, need.preset, models)).toBeUndefined();
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
    // titulaire hors poste : percentiles de son poste d'origine, pas un partenaire
    const outOfPosition = needs.map((n, i) => (i === 1 ? { ...(n as object), flags: ['outOfPosition'] } : n)) as never[];
    expect(slotPartner(outOfPosition, 0)).toBeUndefined();
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
    player({ 'Player ID': 'c1', 'Team ID': 'a', 'A pct': 90, 'B pct': 90, 'Team field tilt': 60 }),
    player({ 'Player ID': 'c2', 'Team ID': 'b', Competition: 'BBB', 'League tier': 2, 'A pct': 95, 'B pct': 95, 'Team field tilt': 50 }),
    player({ 'Player ID': 'c3', 'Team ID': 'c', 'A pct': 50, 'B pct': 50, Age: 19, 'Minutes played': 1000, 'Team field tilt': 55 }),
    player({ 'Player ID': 'c4', 'Team ID': 'd', 'A pct': 70, 'B pct': 70, Competition: 'CCC', 'League tier': 2 }),
    player({ 'Player ID': 'own', 'Team ID': 't', 'A pct': 99, 'B pct': 99 }),
    player({ 'Player ID': 'st', 'Team ID': 'e', Position: 'ST', 'A pct': 99, 'B pct': 99 }),
    player({ 'Player ID': 'short', 'Team ID': 'f', 'A pct': 99, 'B pct': 99, 'Minutes played': 500 }),
    player({ 'Player ID': 'nodata', 'Team ID': 'g' }),
  ];
  const run = (filters = {}, extra = {}) => searchCandidates({
    pool, preset, target, models, baseline: 60,
    filters: { ...DEFAULT_FILTERS, ...filters }, market, asOf: new Date('2026-10-20'), ...extra,
  });
  const ids = (r: ReturnType<typeof run>) => r.candidates.map(c => c.player['Player ID']).sort();

  it('écarte son équipe, les autres postes et les joueurs sous le seuil de minutes', () => {
    const list = ids(run());
    expect(list).toEqual(['c1', 'c2', 'c3', 'c4']);
  });

  it('classe par projection sportive et calcule le gain, sans rang ni « adéquation »', () => {
    const list = run().candidates;
    for (let i = 1; i < list.length; i++) expect(list[i - 1].forecast.next).toBeGreaterThanOrEqual(list[i].forecast.next);
    const c1 = list.find(c => c.player['Player ID'] === 'c1')!;
    expect(c1.gain).toBeCloseTo(c1.forecast.next - 60, 10);
    expect(Object.keys(c1)).not.toContain('rank');
    expect(Object.keys(c1)).not.toContain('thresholds');
  });

  it('complémentarité : lecture séparée, ni la projection ni le classement ne bougent', () => {
    const complements = [{ metric: 'C', value: 12, weight: 1 }, { metric: 'D', value: 20, weight: -1 }];
    const plain = run();
    const withReading = run({}, { complements });
    expect(withReading.candidates.map(c => c.player['Player ID'])).toEqual(plain.candidates.map(c => c.player['Player ID']));
    withReading.candidates.forEach((c, i) => expect(c.forecast).toEqual(plain.candidates[i].forecast));
    expect(plain.candidates[0].complement).toBeUndefined();
    const withC = searchCandidates({
      pool: [player({ 'Player ID': 'x', 'Team ID': 'x', 'A pct': 80, 'B pct': 80, 'C pct': 87, 'D pct': 30 })], preset, target, models,
      complements, filters: DEFAULT_FILTERS, market: null, asOf: new Date('2026-10-20'),
    }).candidates[0];
    expect(withC.complement!.metrics).toEqual([
      { metric: 'C', partner: 12, candidate: 87, inverted: false },
      { metric: 'D', partner: 20, candidate: 70, inverted: true },
    ]);
    expect(withC.complement!.mean).toBe(78.5);
  });

  it('projette la montée de niveau et signale contrat et marché < estimation', () => {
    const c2 = run().candidates.find(c => c.player['Player ID'] === 'c2')!;
    expect(c2.forecast.parts.league).toBeLessThan(0);
    expect(c2.flags).toContain('bigStep');
    expect(c2.flags).toContain('contract');
    expect(c2.flags).toContain('belowEstimate');
  });

  it('filtre l\'âge, le budget, le contrat et les championnats', () => {
    expect(ids(run({ maxAge: 21 }))).toEqual(['c3']);
    expect(ids(run({ maxValue: 6e6 }))).toEqual(['c2', 'c3']);
    expect(ids(run({ maxValue: 6e6, includeUnknownValue: true }))).toEqual(['c2', 'c3', 'c4']);
    expect(ids(run({ contractWithinMonths: 12 }))).toEqual(['c2']);
    expect(ids(run({ leagues: 'same' }))).toEqual(['c1', 'c3']);
    expect(ids(run({ leagues: 'other' }))).toEqual(['c2', 'c4']);
    expect(ids(run({ leagues: 'lower' }))).toEqual(['c2', 'c4']);
    expect(ids(run({ minAge: 20 }))).toEqual(['c1', 'c2', 'c4']);
  });

  it('entonnoir : étapes dures dans l\'ordre, exclusions faute de donnée comptées à part', () => {
    expect(run().funnel).toEqual({
      pool: 7, position: 6, minutes: 5, age: 5, ageUnknown: 0, leagues: 5, modelUnavailable: 0,
      budget: 5, valueUnknown: 0, contract: 5, contractUnknown: 0, projectable: 4, insufficientData: 1,
    });
    const f = run({ maxValue: 6e6, contractWithinMonths: 12 }).funnel;
    expect(f).toMatchObject({ leagues: 5, budget: 2, valueUnknown: 2, contract: 1, contractUnknown: 1, projectable: 1 });
    // le nombre affiché à chaque étape est le nombre de joueurs restants : décroissant
    const steps = [f.pool, f.position, f.minutes, f.age, f.leagues, f.budget, f.contract, f.projectable];
    steps.slice(1).forEach((v, i) => expect(v).toBeLessThanOrEqual(steps[i]));
    expect(run({ leagues: 'lower' }, { models: { curves, transfer: null } }).funnel.modelUnavailable).toBe(5);
    expect(run({ maxAge: 30 }, { pool: [player({ 'Player ID': 'na', 'Team ID': 'z', Age: undefined, 'A pct': 50 })] }).funnel.ageUnknown).toBe(1);
  });

  it('saison passée (marché null) : ni valeur, ni contrat, ni filtre de budget ou d\'échéance', () => {
    const r = run({ maxValue: 1e6, contractWithinMonths: 6 }, { market: null });
    expect(ids(r)).toEqual(['c1', 'c2', 'c3', 'c4']);
    r.candidates.forEach(c => {
      expect(c.market).toBeUndefined();
      expect(c.contractMonths).toBeUndefined();
      expect(c.efficient).toBe(false);
      expect(c.flags).not.toContain('contract');
      expect(c.flags).not.toContain('belowEstimate');
    });
  });

  it('contexte : indisponible signalé (terme nul), effet important signalé sans plafond', () => {
    const list = run().candidates;
    expect(list.find(c => c.player['Player ID'] === 'c4')!.flags).toContain('noContext');     // pas de field tilt
    expect(list.find(c => c.player['Player ID'] === 'c4')!.forecast.parts.context).toBe(0);
    expect(list.find(c => c.player['Player ID'] === 'c1')!.flags).not.toContain('noContext');
    const noTarget = run({}, { target: { ...target, context: { 'Team field tilt': null } } }).candidates;
    noTarget.forEach(c => { expect(c.flags).toContain('noContext'); expect(c.forecast.parts.context).toBe(0); });
    // écart de domination de 40 points : terme de contexte 0.5 × 40 × part de A dans l'indice
    const big = searchCandidates({
      pool: [player({ 'Player ID': 'x', 'Team ID': 'x', 'A pct': 50, 'B pct': 50, 'Team field tilt': 20 })], preset, target, models,
      filters: DEFAULT_FILTERS, market: null, asOf: new Date('2026-10-20'),
    }).candidates[0];
    expect(big.forecast.parts.context).toBeGreaterThanOrEqual(CONTEXT_EFFECT_NOTABLE);
    expect(big.forecast.metrics.A.context).toBe(20);                    // non plafonné
    expect(big.flags).toContain('contextEffect');
  });

  it('signale un championnat peu observé et un temps de jeu court', () => {
    const list = run().candidates;
    expect(list.find(c => c.player['Player ID'] === 'c4')!.flags).toContain('rareLeague');
    expect(list.find(c => c.player['Player ID'] === 'c3')!.flags).toContain('fewMinutes');
    const inProgress = run({}, { fewMinutes: 600 }).candidates;
    expect(inProgress.find(c => c.player['Player ID'] === 'c3')!.flags).not.toContain('fewMinutes');
  });

  it('peerIndices : joueurs éligibles au rôle seulement, triés', () => {
    const peers = peerIndices(pool, preset, models);
    expect(peers.length).toBe(6);
    expect([...peers].sort((a, b) => a - b)).toEqual(peers);
  });
});

describe('frontière valeur / performance', () => {
  const cand = (id: string, next: number, value?: number) =>
    ({ player: player({ 'Player ID': id }), forecast: { now: 0, next, parts: { regression: 0, age: 0, league: 0, context: 0, adaptation: 0 }, metrics: {} },
      market: value === undefined ? undefined : { value }, flags: [], efficient: false }) as Candidate;
  const efficient = (list: Candidate[]) => { markEfficient(list); return list.filter(c => c.efficient).map(c => c.player['Player ID']).sort(); };

  it('garde les candidats qu\'aucun autre ne domine en projection et en prix', () => {
    expect(efficient([cand('cher-bon', 80, 5e7), cand('moyen', 70, 1e7), cand('domine', 65, 2e7), cand('petit', 50, 1e6), cand('sans-valeur', 99)]))
      .toEqual(['cher-bon', 'moyen', 'petit']);
  });

  it('égalité parfaite : aucun ne domine l\'autre, les deux sont efficients', () => {
    expect(efficient([cand('moyen', 70, 1e7), cand('egal', 70, 1e7), cand('petit', 50, 1e6)])).toEqual(['egal', 'moyen', 'petit']);
  });

  it('même valeur, projection inférieure : dominé ; même projection, plus cher : dominé', () => {
    expect(efficient([cand('a', 70, 1e7), cand('b', 69, 1e7)])).toEqual(['a']);
    expect(efficient([cand('a', 70, 1e7), cand('b', 70, 2e7)])).toEqual(['a']);
    expect(efficient([cand('a', 70, 1e7), cand('b', 70, 1e7), cand('c', 70, 2e7)])).toEqual(['a', 'b']);
  });

  it('A domine B seulement si A est au moins aussi bon sur les deux axes et strictement meilleur sur l\'un', () => {
    const list = [cand('a', 80, 3e7), cand('b', 75, 1e7), cand('c', 75, 1e7), cand('d', 60, 5e5), cand('e', 60, 5e5), cand('f', 90, 3e7), cand('g', 55, 9e6)];
    markEfficient(list);
    const dominated = (x: Candidate) => list.some(y => y !== x && y.market?.value !== undefined
      && y.forecast.next >= x.forecast.next && y.market.value <= x.market!.value!
      && (y.forecast.next > x.forecast.next || y.market.value < x.market!.value!));
    list.forEach(c => expect(c.efficient).toBe(!dominated(c)));
  });
});

describe('affichage de la projection', () => {
  const forecast = (now: number, parts: number[], next?: number): RoleForecast => {
    const [regression, age, league, context, adaptation] = parts;
    return { now, next: next ?? now + parts.reduce((s, v) => s + v, 0), parts: { regression, age, league, context, adaptation }, metrics: {} };
  };

  it('cascade au dixième : actuel + étapes affichées = projeté affiché, chaque étape à moins d\'un dixième', () => {
    const f = forecast(77.04, [-12.64, 1.26, 6.24, 22.66, 1.09]);
    const c = projectionCascade(f);
    expect(c.now).toBe(77);
    expect(c.steps.map(s => s.shown)).toEqual([-12.6, 1.3, 6.2, 22.7, 1.1]);   // 77,0 −12,6 +1,3 +6,2 +22,7 +1,1 = 95,7
    const total = Math.round((c.now + c.steps.reduce((s, x) => s + x.shown, 0)) * 10) / 10;
    expect(total).toBe(c.next);
    expect(c.next).toBe(95.7);
    expect(c.rounded).toBe(96);
    expect(displayIndex(f.next)).toBe(c.rounded);
    c.steps.forEach(s => expect(Math.abs(s.shown - s.value)).toBeLessThanOrEqual(0.1 + 1e-9));
  });

  it('cascade : 1 000 projections aléatoires tombent juste au dixième', () => {
    let seed = 7;
    const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let k = 0; k < 1000; k++) {
      const now = 100 * rand();
      const parts = Array.from({ length: 5 }, () => 30 * rand() - 15);
      const c = projectionCascade(forecast(now, parts));
      const tenthsSum = Math.round(c.now * 10) + c.steps.reduce((s, x) => s + Math.round(x.shown * 10), 0);
      expect(tenthsSum).toBe(Math.round(c.next * 10));
      expect(c.rounded).toBe(Math.round(c.next));
    }
  });

  it('indice borné à 100 : étape « plafond » explicite', () => {
    const c = projectionCascade(forecast(98, [1, 2, 3, 0, 0], 100));
    expect(c.steps.map(s => s.key)).toEqual(['regression', 'age', 'league', 'context', 'adaptation', 'cap']);
    expect(c.steps[5].shown).toBe(-4);
    expect(c.next).toBe(100);
  });

  it('incertitude : erreur historique par type de mouvement, sans intervalle', () => {
    const validation = {
      season: '2025-26', pairs: 2426, movers: 405, clubChanges: 278, up: 213, down: 192, metric: {} as never,
      index: { movers: { persistence: 16.79, development: 13.88, model: 12.18 }, clubChanges: { persistence: 13.16, development: 12.21, model: 11.78 } } as never,
    };
    const t = { ...transfer, validation };
    expect(projectionError(t, true)).toEqual({ mae: 12.18, moves: 405, season: '2025-26', leagueChange: true });
    expect(projectionError(t, false)).toEqual({ mae: 11.78, moves: 278, season: '2025-26', leagueChange: false });
    expect(projectionError(transfer, true)).toBeUndefined();
    expect(projectionError(null, true)).toBeUndefined();
  });
});

describe('dossier du candidat (CandidateView)', () => {
  const preset: RolePreset = { positions: ['CB'], metrics: { A: 60 }, weights: { B: 1 } };
  const market: MarketValues = { scrapedAt: '2026-10-20', players: new Map([['x', { value: 5e6, contract: '2027-03-31', estimated: 9e6 }]]) };
  const pool = [player({ 'Player ID': 'x', 'Team ID': 'o', Competition: 'BBB', 'League tier': 2, 'A pct': 80, 'B pct': 70, 'C pct': 90, 'Team field tilt': 50, 'Minutes played': 1000 })];
  const run = (m: MarketValues | null) => searchCandidates({
    pool, preset, target, models, baseline: 50, complements: [{ metric: 'C', value: 20, weight: 1 }],
    filters: DEFAULT_FILTERS, market: m, asOf: new Date('2026-10-20'),
  }).candidates[0];
  const validation = { season: '2025-26', pairs: 1, movers: 405, clubChanges: 278, up: 1, down: 1, metric: {} as never,
    index: { movers: { model: 12.18 }, clubChanges: { model: 11.78 } } as never };

  it('blocs séparés : sport, complémentarité, valeur, incertitude, signaux ; aucun score global', () => {
    const c = run(market);
    const incumbent = { now: 52, next: 50, parts: { regression: 0, age: 0, league: 0, context: 0, adaptation: 0 }, metrics: {} };
    const v = candidateView(c, { incumbent, targetCompetition: 'AAA', transfer: { ...transfer, validation }, hasMarket: true });
    expect(Object.keys(v).sort()).toEqual(['complementarity', 'signals', 'sport', 'uncertainty', 'value']);
    expect(v.sport.next).toBe(c.forecast.next);
    expect(v.sport.gain).toBeCloseTo(c.forecast.next - 50, 10);
    expect(v.sport.leagueChange).toBe(true);
    expect(v.sport.cascade.rounded).toBe(displayIndex(c.forecast.next));
    expect(v.complementarity?.metrics[0]).toMatchObject({ metric: 'C', partner: 20, candidate: 90 });
    expect(v.uncertainty).toEqual({ mae: 12.18, moves: 405, season: '2025-26', leagueChange: true });
    expect(v.value).toMatchObject({ market: 5e6, estimate: 9e6, contract: '2027-03-31', belowEstimate: true, efficient: true });
    // valeur et contrat ne sont pas des signaux sportifs
    expect(c.flags).toContain('contract');
    expect(v.signals).not.toContain('contract');
    expect(v.signals).not.toContain('belowEstimate');
    expect(v.signals).toContain('fewMinutes');
  });

  it('saison passée : bloc valeur absent ; sans titulaire : pas de gain', () => {
    const v = candidateView(run(null), { targetCompetition: 'AAA', transfer, hasMarket: false });
    expect(v.value).toBeNull();
    expect(v.sport.gain).toBeUndefined();
    expect(v.uncertainty).toBeUndefined();          // validation absente du modèle de test
  });
});

describe('marché de la saison analysée', () => {
  const market: MarketValues = { scrapedAt: '2026-10-20', players: new Map([['a', { value: 2e6, contract: '2028-06-30', estimated: 3e6 }]]) };
  it('seasonMarket : rien pour une saison passée, les seuls champs portés par la saison sinon', () => {
    expect(seasonMarket(market, { marketValue: false, contract: false, estimate: false })).toBeNull();
    expect(seasonMarket(null, { marketValue: true, contract: true, estimate: true })).toBeNull();
    expect(seasonMarket(market, { marketValue: true, contract: true, estimate: true })).toBe(market);
    expect(seasonMarket(market, { marketValue: true, contract: false, estimate: false })!.players.get('a')).toEqual({ value: 2e6 });
  });

  // Données réelles (npm run data:pull) : seul 2026-27 porte l'instantané Transfermarkt
  const seasons: [string, boolean][] = [['2021-22', false], ['2024-25', false], ['2025-26', false], ['2026-27', true]];
  seasons.forEach(([s, current]) => {
    const file = `public/data/players/${s}.json`;
    it.skipIf(!existsSync(file))(`${s} : ${current ? 'valeur, contrat et estimation' : 'aucune donnée de marché 2026'}`, () => {
      const d = JSON.parse(readFileSync(file, 'utf8')) as { columns: string[]; rows: unknown[][] };
      const rows = d.rows.map(r => Object.fromEntries(d.columns.map((c, i) => [c, r[i]])) as unknown as PlayerData);
      const caps = seasonCapabilities(rows);
      expect(caps).toEqual({ marketValue: current, contract: current, estimate: current });
      expect(seasonMarket(market, caps) === null).toBe(!current);
      // l'âge reste celui de la saison analysée (lignes de la saison, jamais l'instantané)
      expect(rows.some(p => typeof p.Age === 'number')).toBe(true);
    });
  });
});

// Données réelles : besoins mesurés sur la formation de recrutement, 2025-26 et 2026-27
const lineupsDir = (s: string) => `public/data/lineups/${s}`;
const realSeason = (s: string) => {
  const d = JSON.parse(readFileSync(`public/data/players/${s}.json`, 'utf8')) as { columns: string[]; rows: unknown[][] };
  return d.rows.map(r => Object.fromEntries(d.columns.map((c, i) => [c, r[i]])) as unknown as PlayerData);
};

describe('données réelles : formation et poste recherché', () => {
  it.skipIf(!existsSync(lineupsDir('2025-26')))('2025-26 : les 48 écarts de poste de l\'audit, 15 suivent la formation, aucun piston ni milieu', () => {
    const rows = realSeason('2025-26');
    const asOf = new Date('2026-10-20');
    const counts = new Map<string, number>();
    let total = 0;
    const known: string[] = [];
    readdirSync(lineupsDir('2025-26')).forEach(f => {
      const comp = f.replace('.json', '');
      if (['UCL', 'UEL', 'UECL'].includes(comp)) return;
      const file = JSON.parse(readFileSync(`${lineupsDir('2025-26')}/${f}`, 'utf8')) as Record<string, TeamLineups>;
      const leagueAll = rows.filter(p => p.Competition === comp);
      Object.entries(file).forEach(([teamId, lu]) => {
        const teamRows = leagueAll.filter(p => p['Team ID'] === teamId);
        const formation = orderFormations(lu)[0];
        const sp = formation ? formationPositions(formation) : null;
        if (!teamRows.length || !sp) return;
        const eleven = placeEleven(formation.slots);
        const before = slotDepth(eleven, teamRows);
        const after = slotNeeds(eleven, teamRows, [], { curves: null, transfer: null }, null, asOf, sp);
        before.forEach((b, i) => {
          const slotPos = sp.get(b.placed.slot.slot)!;
          if (!isOutOfPosition(b.position, slotPos)) return;
          total++;
          const moved = after[i].position === slotPos;
          const key = `${b.position}→${slotPos}:${moved ? 'formation' : 'inchangé'}`;
          counts.set(key, (counts.get(key) ?? 0) + 1);
          if (moved) known.push(`${teamRows[0].Team}:${b.position}→${slotPos}`);
        });
      });
    });
    expect(total).toBe(48);
    const moved = [...counts].filter(([k]) => k.endsWith('formation'));
    const kept = [...counts].filter(([k]) => k.endsWith('inchangé'));
    expect(moved.reduce((s, [, v]) => s + v, 0)).toBe(15);
    // seuls basculent latéral ↔ ailier, latéral → avant-centre, central → avant-centre
    moved.forEach(([k]) => expect(['FB→W', 'W→FB', 'FB→ST', 'CB→ST']).toContain(k.split(':')[0]));
    // tous les cas gardés concernent un piston
    kept.forEach(([k]) => expect(k.split(':')[0]).toMatch(/WB/));
    expect(known).toContain('Sunderland:FB→W');
    expect(known).toContain('FC Dallas:W→FB');
  }, 60_000);

  it.skipIf(!existsSync(`${lineupsDir('2026-27')}/SRB.json`))('Crvena Zvezda 2026-27 : 3-2-4-1 insuffisamment renseignée, besoins sur 4-1-4-1', () => {
    const rows = realSeason('2026-27');
    const team = rows.find(p => p.Team === 'FK Crvena Zvezda' && p.Competition === 'SRB')!;
    const file = JSON.parse(readFileSync(`${lineupsDir('2026-27')}/SRB.json`, 'utf8')) as Record<string, TeamLineups>;
    const formations = orderFormations(file[team['Team ID']!]);
    expect(formations[0]).toMatchObject({ formation: '3-2-4-1', matches: 7, status: 'incomplete' });
    const choice = recruitmentFormation(formations)!;
    expect(formations[choice.index].formation).toBe('4-1-4-1');
    expect(choice.fallbackFrom?.formation).toBe('3-2-4-1');
    const formation = formations[choice.index];
    const teamRows = rows.filter(p => p.Competition === 'SRB' && p['Team ID'] === team['Team ID']);
    const needs = slotNeeds(placeEleven(formation.slots), teamRows, rows.filter(p => p.Competition === 'SRB'), { curves: null, transfer: null },
      null, new Date('2026-10-20'), formationPositions(formation));
    expect(needs).toHaveLength(11);
    // défaut des données SRB : les 11 joueurs de l'équipe sont enregistrés gardiens (percentiles parmi les gardiens)
    expect(teamRows.every(p => p.Position === 'GK')).toBe(true);
    expect(needs.find(n => n.position === 'GK')!.forecast).toBeDefined();
    needs.filter(n => n.starter && n.position !== 'GK').forEach(n => expect(n.flags).toContain('outOfPosition'));
  }, 60_000);
});
