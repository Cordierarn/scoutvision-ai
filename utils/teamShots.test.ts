import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { ShotEvent } from '../types';
import { DEFAULT_SHOT_FILTERS, filterShots, matchTeams, shotSide, shotTeams, splitTeamShots, summarizeShots, topScorers } from './teamShots';

type Row = [string, number, string, number, number, number, string, string, string, 'h' | 'a', string, string, boolean | null];
const shot = ([id, minute, result, X, Y, xG, player, player_id, team, h_a, situation, shotType, isOwnGoal]: Row): ShotEvent => ({
  id, match_id: id.split('_s_')[0], minute, result: result as ShotEvent['result'], X, Y, xG, player, player_id, team, h_a,
  situation: situation as ShotEvent['situation'], shotType: shotType as ShotEvent['shotType'], isOwnGoal: isOwnGoal ?? undefined,
});

// Données fictives à la forme des fichiers de tirs du pipeline (shots/{saison}/{compétition}.json) : quatre buts
// contre son camp dans les matchs du Club A et, pour chacun de ces matchs, un tir de chaque équipe
const CLUB_A: ShotEvent[] = ([
  ['m_1_s_1', 32, 'Goal', 0.074, 0.684, 0, 'Joueur 1', 'p_1', 'Club A', 'a', 'OpenPlay', 'LeftFoot', true],
  ['m_1_s_2', 61, 'Goal', 0.961, 0.507, 0.22, 'Joueur 2', 'p_2', 'Club B', 'h', 'FromCorner', 'Head', null],
  ['m_1_s_3', 67, 'Goal', 0.903, 0.663, 0.07, 'Joueur 3', 'p_3', 'Club A', 'a', 'OpenPlay', 'RightFoot', null],
  ['m_2_s_1', 3, 'Goal', 0.125, 0.723, 0, 'Joueur 4', 'p_4', 'Club A', 'a', 'OpenPlay', 'RightFoot', true],
  ['m_2_s_2', 34, 'Goal', 0.895, 0.5, 0.79, 'Joueur 5', 'p_5', 'Club C', 'h', 'Penalty', 'RightFoot', null],
  ['m_2_s_3', 15, 'BlockedShot', 0.881, 0.351, 0.05, 'Joueur 6', 'p_6', 'Club A', 'a', 'SetPiece', 'RightFoot', null],
  ['m_3_s_1', 33, 'Goal', 0.044, 0.509, 0, 'Joueur 7', 'p_7', 'Club A', 'a', 'FromCorner', 'LeftFoot', true],
  ['m_3_s_2', 29, 'Goal', 0.93, 0.613, 0.19, 'Joueur 8', 'p_8', 'Club D', 'h', 'FromCorner', 'RightFoot', null],
  ['m_3_s_3', 61, 'Goal', 0.925, 0.471, 0.09, 'Joueur 3', 'p_3', 'Club A', 'a', 'OpenPlay', 'Head', null],
  ['m_4_s_1', 33, 'Goal', 0.026, 0.545, 0, 'Joueur 9', 'p_9', 'Club E', 'h', 'OpenPlay', 'LeftFoot', true],
  ['m_4_s_2', 15, 'BlockedShot', 0.792, 0.786, 0.04, 'Joueur 10', 'p_10', 'Club E', 'h', 'DirectFreekick', 'RightFoot', null],
  ['m_4_s_3', 62, 'Goal', 0.902, 0.393, 0.86, 'Joueur 11', 'p_11', 'Club A', 'a', 'OpenPlay', 'RightFoot', null],
  // match sans Club A : jamais compté
  ['m_zzzzzz_s_1', 10, 'Goal', 0.9, 0.5, 0.3, 'Autre', 'p_x', 'Club F', 'h', 'OpenPlay', 'RightFoot', null],
  ['m_zzzzzz_s_2', 20, 'Goal', 0.05, 0.5, 0, 'Autre CSC', 'p_y', 'Club G', 'a', 'OpenPlay', 'RightFoot', true],
] as Row[]).map(shot);

describe('buts contre son camp', () => {
  it('le but est crédité à l\'adversaire de l\'équipe du joueur', () => {
    const teams = matchTeams(CLUB_A);
    const ownGoal = CLUB_A[0];
    expect(shotTeams(ownGoal, teams.get(ownGoal.match_id!))).toEqual({ shooter: 'Club A', attacking: 'Club B', conceding: 'Club A' });
    const header = CLUB_A[1];
    expect(shotTeams(header, teams.get(header.match_id!))).toEqual({ shooter: 'Club B', attacking: 'Club B', conceding: 'Club A' });
    expect(shotTeams(ownGoal, undefined)).toEqual({ shooter: 'Club A', attacking: null, conceding: 'Club A' });
  });

  it('côté du tir pour une équipe : un CSC de l\'équipe est « contre », un CSC adverse est « pour »', () => {
    expect(shotSide(CLUB_A[0], 'Club A')).toBe('against');
    expect(shotSide(CLUB_A[2], 'Club A')).toBe('for');
    expect(shotSide(CLUB_A[9], 'Club A')).toBe('for');      // Joueur 9 (Club E) contre son camp
    expect(shotSide(CLUB_A[1], 'Club A')).toBe('against');
  });

  it('Club A : trois CSC concédés et un CSC en sa faveur, séparés des tirs', () => {
    const s = splitTeamShots(CLUB_A, 'Club A');
    expect(s.matches).toBe(4);
    expect(s.ownGoalsAgainst.map(x => x.player)).toEqual(['Joueur 1', 'Joueur 4', 'Joueur 7']);
    expect(s.ownGoalsFor.map(x => x.player)).toEqual(['Joueur 9']);
    expect(s.for.map(x => x.player)).toEqual(['Joueur 3', 'Joueur 6', 'Joueur 3', 'Joueur 11']);
    expect(s.against.map(x => x.team)).toEqual(['Club B', 'Club C', 'Club D', 'Club E']);
    expect([...s.for, ...s.against].some(x => x.isOwnGoal)).toBe(false);

    const pour = summarizeShots(s.for, s.ownGoalsFor);
    // ancien calcul (tous les tirs dont team = Club A) : 6 buts dont 3 CSC concédés
    expect(CLUB_A.filter(x => x.team === 'Club A' && x.result === 'Goal').length).toBe(6);
    expect(pour).toMatchObject({ shots: 4, goals: 3, ownGoals: 1, totalGoals: 4, onTarget: 3, penalties: 0 });
    expect(pour.xG).toBeCloseTo(0.07 + 0.05 + 0.09 + 0.86, 10);
    expect(pour.conversion).toBeCloseTo(75, 10);
    const contre = summarizeShots(s.against, s.ownGoalsAgainst);
    expect(contre).toMatchObject({ shots: 4, goals: 3, ownGoals: 3, totalGoals: 6, penalties: 1 });
    expect(contre.npxG).toBeCloseTo(0.22 + 0.19 + 0.04, 10);
  });

  it('un CSC n\'est jamais un buteur', () => {
    const s = splitTeamShots(CLUB_A, 'Club A');
    expect(topScorers([...s.for, ...s.ownGoalsFor, ...s.ownGoalsAgainst]).map(x => x.name)).toEqual(['Joueur 3', 'Joueur 11', 'Joueur 6']);
    expect(topScorers(s.for)[0]).toMatchObject({ id: 'p_3', goals: 2, shots: 2 });
  });

  it('sans tir : conversion absente, pas 0 %', () => {
    expect(summarizeShots([]).conversion).toBeNull();
  });

  // Saison close (FRA 2025-26), quand les données sont présentes localement (npm run data:pull) : propriété vérifiée
  // pour chaque équipe, jamais un club nommé
  const FILE = 'public/data/shots/2025-26/FRA.json';
  it.skipIf(!existsSync(FILE))('saison complète : pour chaque équipe, total = buts naïfs − CSC concédés + CSC en faveur ; au moins une équipe à 3 CSC concédés et 1 en faveur', () => {
    const d = JSON.parse(readFileSync(FILE, 'utf8')) as { columns: string[]; rows: unknown[][] };
    const all = d.rows.map(r => Object.fromEntries(d.columns.map((c, i) => [c, r[i]])) as unknown as ShotEvent);
    const teams = [...new Set(all.map(x => x.team))];
    expect(teams.length).toBeGreaterThanOrEqual(18);
    let threeAndOne = 0;
    for (const t of teams) {
      const s = splitTeamShots(all, t);
      const naive = all.filter(x => x.team === t && x.result === 'Goal').length;       // ancien calcul : CSC concédés comptés pour
      expect(summarizeShots(s.for, s.ownGoalsFor).totalGoals).toBe(naive - s.ownGoalsAgainst.length + s.ownGoalsFor.length);
      expect([...s.for, ...s.against].some(x => x.isOwnGoal)).toBe(false);
      if (s.ownGoalsAgainst.length === 3 && s.ownGoalsFor.length === 1) threeAndOne++;
    }
    expect(threeAndOne).toBeGreaterThanOrEqual(1);
  });
});

describe('filtres de tirs', () => {
  const s = splitTeamShots(CLUB_A, 'Club A');
  it('situation, hors penalty, résultat', () => {
    expect(filterShots(s.against, { ...DEFAULT_SHOT_FILTERS, nonPenalty: true }).map(x => x.team)).toEqual(['Club B', 'Club D', 'Club E']);
    expect(filterShots(s.against, { ...DEFAULT_SHOT_FILTERS, situation: 'Penalty' }).map(x => x.player)).toEqual(['Joueur 5']);
    expect(filterShots(s.for, { ...DEFAULT_SHOT_FILTERS, result: 'offTarget' }).map(x => x.result)).toEqual(['BlockedShot']);
    expect(filterShots(s.for, { ...DEFAULT_SHOT_FILTERS, result: 'goal' })).toHaveLength(3);
    expect(filterShots(s.for, DEFAULT_SHOT_FILTERS)).toEqual(s.for);
  });
});

describe('limite connue : match sans tir de l\'équipe', () => {
  it('les tirs adverses d\'un match où l\'équipe n\'a pas tiré ne sont pas rattachés (pas de liste des matchs publiée)', () => {
    const solo = shot(['m_solo00_s_1', 50, 'Goal', 0.9, 0.5, 0.4, 'Adversaire', 'p_adv', 'Club B', 'h', 'OpenPlay', 'RightFoot', null]);
    const s = splitTeamShots([...CLUB_A, solo], 'Club A');
    expect(s.matches).toBe(4);
    expect(s.against.some(x => x.match_id === 'm_solo00')).toBe(false);
  });
});
