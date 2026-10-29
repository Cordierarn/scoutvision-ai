import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { ShotEvent } from '../types';
import { matchTeams, shotSide, shotTeams, splitTeamShots, summarizeShots, topScorers } from './teamShots';

type Row = [string, number, string, number, number, number, string, string, string, 'h' | 'a', string, string, boolean | null];
const shot = ([id, minute, result, X, Y, xG, player, player_id, team, h_a, situation, shotType, isOwnGoal]: Row): ShotEvent => ({
  id, match_id: id.split('_s_')[0], minute, result: result as ShotEvent['result'], X, Y, xG, player, player_id, team, h_a,
  situation: situation as ShotEvent['situation'], shotType: shotType as ShotEvent['shotType'], isOwnGoal: isOwnGoal ?? undefined,
});

// Ligue 1 2025-26, données réelles (shots/2025-26/FRA.json) : les quatre buts contre son camp des
// matchs du Havre et, pour chacun de ces matchs, un tir de chaque équipe
const LE_HAVRE: ShotEvent[] = ([
  ['m_0oDeA8_s_27nnis', 32, 'Goal', 0.074, 0.684, 0, 'Gautier Lloris', 'p_3Sur8L', 'Le Havre', 'a', 'OpenPlay', 'LeftFoot', true],
  ['m_0oDeA8_s_4XYCAG', 61, 'Goal', 0.961, 0.507, 0.22, 'Eric Dier', 'p_42uUhE', 'Monaco', 'h', 'FromCorner', 'Head', null],
  ['m_0oDeA8_s_39XP30', 67, 'Goal', 0.903, 0.663, 0.07, 'Rassoul Ndiaye', 'p_3cXQGM', 'Le Havre', 'a', 'OpenPlay', 'RightFoot', null],
  ['m_0hdOXv_s_0YGyJ9', 3, 'Goal', 0.125, 0.723, 0, 'Yanis Zouaoui', 'p_1bOTg3', 'Le Havre', 'a', 'OpenPlay', 'RightFoot', true],
  ['m_0hdOXv_s_06XWHN', 34, 'Goal', 0.895, 0.5, 0.79, 'Ignatius Ganago', 'p_0QPAnu', 'Nantes', 'h', 'Penalty', 'RightFoot', null],
  ['m_0hdOXv_s_3qCPXT', 15, 'BlockedShot', 0.881, 0.351, 0.05, 'Fodé Doucouré', 'p_0MKFKy', 'Le Havre', 'a', 'SetPiece', 'RightFoot', null],
  ['m_4axwU3_s_1mtOQW', 33, 'Goal', 0.044, 0.509, 0, 'Ayumu Seko', 'p_1Vddac', 'Le Havre', 'a', 'FromCorner', 'LeftFoot', true],
  ['m_4axwU3_s_4DbYAX', 29, 'Goal', 0.93, 0.613, 0.19, 'Ciro Immobile', 'p_4IGgPF', 'Paris FC', 'h', 'FromCorner', 'RightFoot', null],
  ['m_4axwU3_s_0vkMOu', 61, 'Goal', 0.925, 0.471, 0.09, 'Rassoul Ndiaye', 'p_3cXQGM', 'Le Havre', 'a', 'OpenPlay', 'Head', null],
  ['m_45cKNY_s_3dwhvG', 33, 'Goal', 0.026, 0.545, 0, 'Abdoulaye Faye', 'p_4dKTDq', 'Lorient', 'h', 'OpenPlay', 'LeftFoot', true],
  ['m_45cKNY_s_3A1Nkt', 15, 'BlockedShot', 0.792, 0.786, 0.04, 'Pablo Pagis', 'p_2TnqGk', 'Lorient', 'h', 'DirectFreekick', 'RightFoot', null],
  ['m_45cKNY_s_4C2fXd', 62, 'Goal', 0.902, 0.393, 0.86, 'Issa Soumaré', 'p_4WUhc4', 'Le Havre', 'a', 'OpenPlay', 'RightFoot', null],
  // match sans Le Havre : jamais compté
  ['m_zzzzzz_s_1', 10, 'Goal', 0.9, 0.5, 0.3, 'Autre', 'p_x', 'Lens', 'h', 'OpenPlay', 'RightFoot', null],
  ['m_zzzzzz_s_2', 20, 'Goal', 0.05, 0.5, 0, 'Autre CSC', 'p_y', 'Lille', 'a', 'OpenPlay', 'RightFoot', true],
] as Row[]).map(shot);

describe('buts contre son camp', () => {
  it('le but est crédité à l\'adversaire de l\'équipe du joueur', () => {
    const teams = matchTeams(LE_HAVRE);
    const lloris = LE_HAVRE[0];
    expect(shotTeams(lloris, teams.get(lloris.match_id!))).toEqual({ shooter: 'Le Havre', attacking: 'Monaco', conceding: 'Le Havre' });
    const dier = LE_HAVRE[1];
    expect(shotTeams(dier, teams.get(dier.match_id!))).toEqual({ shooter: 'Monaco', attacking: 'Monaco', conceding: 'Le Havre' });
    expect(shotTeams(lloris, undefined)).toEqual({ shooter: 'Le Havre', attacking: null, conceding: 'Le Havre' });
  });

  it('côté du tir pour une équipe : un CSC de l\'équipe est « contre », un CSC adverse est « pour »', () => {
    expect(shotSide(LE_HAVRE[0], 'Le Havre')).toBe('against');
    expect(shotSide(LE_HAVRE[2], 'Le Havre')).toBe('for');
    expect(shotSide(LE_HAVRE[9], 'Le Havre')).toBe('for');      // Faye (Lorient) contre son camp
    expect(shotSide(LE_HAVRE[1], 'Le Havre')).toBe('against');
  });

  it('cas Le Havre 2025-26 : trois CSC concédés et un CSC en sa faveur, séparés des tirs', () => {
    const s = splitTeamShots(LE_HAVRE, 'Le Havre');
    expect(s.matches).toBe(4);
    expect(s.ownGoalsAgainst.map(x => x.player)).toEqual(['Gautier Lloris', 'Yanis Zouaoui', 'Ayumu Seko']);
    expect(s.ownGoalsFor.map(x => x.player)).toEqual(['Abdoulaye Faye']);
    expect(s.for.map(x => x.player)).toEqual(['Rassoul Ndiaye', 'Fodé Doucouré', 'Rassoul Ndiaye', 'Issa Soumaré']);
    expect(s.against.map(x => x.team)).toEqual(['Monaco', 'Nantes', 'Paris FC', 'Lorient']);
    expect([...s.for, ...s.against].some(x => x.isOwnGoal)).toBe(false);

    const pour = summarizeShots(s.for, s.ownGoalsFor);
    // ancien calcul (tous les tirs dont team = Le Havre) : 6 buts dont 3 CSC concédés
    expect(LE_HAVRE.filter(x => x.team === 'Le Havre' && x.result === 'Goal').length).toBe(6);
    expect(pour).toMatchObject({ shots: 4, goals: 3, ownGoals: 1, totalGoals: 4, onTarget: 3, penalties: 0 });
    expect(pour.xG).toBeCloseTo(0.07 + 0.05 + 0.09 + 0.86, 10);
    expect(pour.conversion).toBeCloseTo(75, 10);
    const contre = summarizeShots(s.against, s.ownGoalsAgainst);
    expect(contre).toMatchObject({ shots: 4, goals: 3, ownGoals: 3, totalGoals: 6, penalties: 1 });
    expect(contre.npxG).toBeCloseTo(0.22 + 0.19 + 0.04, 10);
  });

  it('un CSC n\'est jamais un buteur', () => {
    const s = splitTeamShots(LE_HAVRE, 'Le Havre');
    expect(topScorers([...s.for, ...s.ownGoalsFor, ...s.ownGoalsAgainst]).map(x => x.name)).toEqual(['Rassoul Ndiaye', 'Issa Soumaré', 'Fodé Doucouré']);
    expect(topScorers(s.for)[0]).toMatchObject({ id: 'p_3cXQGM', goals: 2, shots: 2 });
  });

  it('sans tir : conversion absente, pas 0 %', () => {
    expect(summarizeShots([]).conversion).toBeNull();
  });

  // Saison complète, quand les données sont présentes localement (npm run data:pull)
  const FILE = 'public/data/shots/2025-26/FRA.json';
  it.skipIf(!existsSync(FILE))('saison complète : 32 buts, comme team_season (34 avec l\'ancien calcul)', () => {
    const d = JSON.parse(readFileSync(FILE, 'utf8')) as { columns: string[]; rows: unknown[][] };
    const all = d.rows.map(r => Object.fromEntries(d.columns.map((c, i) => [c, r[i]])) as unknown as ShotEvent);
    const s = splitTeamShots(all, 'Le Havre');
    expect(all.filter(x => x.team === 'Le Havre' && x.result === 'Goal').length).toBe(34);
    expect(summarizeShots(s.for, s.ownGoalsFor).totalGoals).toBe(32);
    expect(s.ownGoalsAgainst.length).toBe(3);
    expect(s.ownGoalsFor.length).toBe(1);
  });
});
