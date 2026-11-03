/**
 * Contexte statistique des équipes (server/bettingContext.ts) sur un dossier de données fictif :
 * classements, profils par compétition, système habituel, joueurs clés agrégés, relecture du cache.
 */
import { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { contextLoader, pickKeyPlayers, regulars } from './bettingContext';

const TEAM_COLS = ['team_id', 'team', 'competition', 'Matches', 'xG per 90', 'xGA per 90', 'Possession, %', 'PPDA', 'Style'];
const PLAYER_COLS = ['Player ID', 'Player', 'Team ID', 'Position', 'Age', 'Matches played', 'Starts', 'Minutes played', 'Minutes share', 'Goals', 'Assists', 'xG', 'xA', 'Rating', 'VAEP per 90', 'RAPM net'];
let dir = '';

function write(rel: string, value: unknown) {
  const file = path.join(dir, rel);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value));
}

function fixture() {
  dir = mkdtempSync(path.join(tmpdir(), 'sv-context-'));
  write('forecast.json', {
    matches: [{ match_id: 'm1', competition: 'CUP', home: 'Club A', away: 'Club B', pHome: 0.5, pDraw: 0.25, pAway: 0.25, xgHome: 1.6, xgAway: 1.0,
      leverage: { home: { objective: 'top 4', delta: 0.08 } }, market: { fair: [0.52, 0.26, 0.22] } }],
    tables: { AAA: [{ rank: 2, team: 'Club A', played: 10, points: 21, goalDiff: 8, projectedPoints: 70.2, pTitle: 0.2, pTop4: 0.8, pBottom3: 0 }] },
  });
  write('teams/2026-27.json', { columns: TEAM_COLS, rows: [
    ['t_a', 'Club A', 'AAA', 10, 1.8, 1.0, 55.5, 9.1, 'High press'], ['t_a', 'Club A', 'CUP', 3, 1.2, 1.4, 48, 11, 'Patient build-up'],
    ['t_b', 'Club B', 'CUP', 3, 1.0, 1.1, 45, 12, 'Direct'],
  ] });
  const p = (id: string, name: string, team: string, pos: string, share: number, minutes: number, goals: number, assists: number, xg: number) =>
    [id, name, team, pos, 25, 5, 5, minutes, share, goals, assists, xg, 0.5, 7.1, 0.12, 0.1];
  write('players/2026-27.json', { columns: PLAYER_COLS, rows: [
    p('p1', 'Défenseur A', 't_a', 'CB', 0.95, 900, 0, 0, 0.2), p('p1', 'Défenseur A', 't_a', 'CB', 0.9, 270, 1, 0, 0.1),   // deux compétitions : agrégées
    ...['p2', 'p3', 'p4', 'p5', 'p6', 'p7'].map((id, i) => p(id, `Régulier ${i}`, 't_a', 'CM', 0.9 - i * 0.05, 800, 0, 0, 0.1)),
    p('p8', 'Buteur A', 't_a', 'ST', 0.4, 300, 6, 1, 4.2),
    p('p9', 'Joueur B', 't_b', 'GK', 1, 270, 0, 0, 0),
  ] });
  write('lineups/2026-27/CUP.json', { t_a: { matches: 3, formations: [{ formation: '4-3-3', matches: 3, slots: [{ players: [['p1', 'Défenseur A', 3]] }, { players: [['p8', 'Buteur A', 2], ['p2', 'Régulier 0', 1]] }] }] } });
}

afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });

describe('contexte des équipes', () => {
  it('assemble probabilités, classement, enjeu, profils (compétition du match d\'abord), système et joueurs clés', () => {
    fixture();
    const c = contextLoader(dir)('m1', 'CUP', 'Club A', 'Club B', '2026-27')!;
    expect(c.model1x2).toEqual({ home: 0.5, draw: 0.25, away: 0.25 });
    expect(c.market1x2NoVig).toEqual({ home: 0.52, draw: 0.26, away: 0.22 });
    expect(c.home.standings).toEqual([{ competition: 'AAA', rank: 2, played: 10, points: 21, goalDiff: 8, projectedPoints: 70.2, pTitle: 0.2, pTop4: 0.8, pBottom3: 0 }]);
    expect(c.home.seasonStakes).toEqual({ objective: 'top 4', swing: 0.08 });
    expect(c.home.profiles.map(p => p.competition)).toEqual(['CUP', 'AAA']);
    expect(c.home.profiles[1].metrics['xG per 90']).toBe(1.8);
    expect(c.home.usualSystem).toEqual({ formation: '4-3-3', matches: 3, xi: ['Défenseur A', 'Buteur A'] });
    const def = c.home.keyPlayers.find(p => p.name === 'Défenseur A')!;
    expect([def.matches, def.goals, def.minutesShare]).toEqual([10, 1, 0.95]);
    expect(c.home.keyPlayers.map(p => p.name)).toContain('Buteur A');            // peu de minutes mais décisif
    expect(regulars(c.home)).toContain('Buteur A');
    expect(c.away.standings).toEqual([]);
    expect(c.away.usualSystem).toBeNull();
  });

  it('ajoute les plus décisifs aux plus utilisés, sans doublon', () => {
    const mk = (name: string, goals: number) => ({ name, goals, assists: 0, xG: goals, xA: 0 });
    const list = [mk('a', 0), mk('b', 3), mk('c', 0), mk('d', 0), mk('e', 0), mk('f', 0), mk('g', 0), mk('h', 7), mk('i', 1)];
    expect(pickKeyPlayers(list).map(p => p.name)).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'h', 'i']);
  });

  it('relit un fichier modifié et tolère un dossier vide', () => {
    fixture();
    const load = contextLoader(dir);
    expect(load('m1', 'CUP', 'Club A', 'Club B', '2026-27')!.model1x2?.home).toBe(0.5);
    write('forecast.json', { matches: [{ match_id: 'm1', pHome: 0.6, pDraw: 0.2, pAway: 0.2 }], tables: {} });
    utimesSync(path.join(dir, 'forecast.json'), new Date(), new Date(Date.now() + 5000));
    expect(load('m1', 'CUP', 'Club A', 'Club B', '2026-27')!.model1x2?.home).toBe(0.6);
    const empty = contextLoader(mkdtempSync(path.join(tmpdir(), 'sv-empty-')))('m1', 'CUP', 'Club A', 'Club B', '2026-27')!;
    expect([empty.model1x2, empty.home.keyPlayers, empty.home.profiles]).toEqual([null, [], []]);
  });
});
