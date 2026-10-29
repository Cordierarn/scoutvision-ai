import { describe, expect, it } from 'vitest';
import { LineupSlot, TeamLineups } from '../services/dataLoader';
import { formationPositions, isExploitableFormation, isOutOfPosition, isValidSlotPosition, lineupCoverage, normalizeFormation, orderFormations, recruitmentFormation } from './teamLineups';

const slot = (n: number, x: number, y: number, players: [string, string, number][] = [[`p${n}`, `Joueur ${n}`, 3]]): LineupSlot => ({ slot: n, x, y, players });
const eleven = (offset = 0): LineupSlot[] => Array.from({ length: 11 }, (_, i) => slot(offset + i, 0.1 + i * 0.07, (i % 4) * 0.25 + 0.1));

describe('coordonnées des cases', () => {
  it('(0, 0), NaN, hors [0, 1] : invalides', () => {
    expect(isValidSlotPosition({ x: 0, y: 0 })).toBe(false);
    expect(isValidSlotPosition({ x: NaN, y: 0.5 })).toBe(false);
    expect(isValidSlotPosition({ x: 0.5, y: 1.2 })).toBe(false);
    expect(isValidSlotPosition({ x: undefined as unknown as number, y: 0.5 })).toBe(false);
    expect(isValidSlotPosition({ x: 0.1, y: 0.5 })).toBe(true);
    expect(isValidSlotPosition({ x: 0, y: 0.5 })).toBe(true);
  });

  it('Crvena Zvezda 2026-27, 3-2-4-1 (7 matchs) : 4 cases sans position, rien placé en (0, 0)', () => {
    const f = normalizeFormation({ formation: '3-2-4-1', matches: 7, slots: [
      slot(0, 0, 0, [['p_2cMfLv', 'Matheus Lima Magalhães', 7]]), slot(1, 0, 0), slot(2, 0, 0), slot(3, 0, 0),
    ] });
    expect(f).toMatchObject({ slots: [], invalidSlots: 4, status: 'incomplete' });
  });

  it('cases en partie invalides : seules les valides sont placées, la formation est incomplète', () => {
    const slots = eleven(); slots[3] = slot(3, 0, 0);
    const f = normalizeFormation({ formation: '4-3-3', matches: 5, slots });
    expect(f.slots).toHaveLength(10);
    expect(f.invalidSlots).toBe(1);
    expect(f.status).toBe('incomplete');
    expect(f.slots.some(s => s.x === 0 && s.y === 0)).toBe(false);
  });
});

describe('doublons de position_id', () => {
  it('Racing Club 2025-26, 3-4-1-2 : 18 cases, deux grilles aux mêmes coordonnées → 11 postes', () => {
    const racing: [number, number, number][] = [[11, 0.1, 0.5], [37, 0.29, 0.21], [35, 0.29, 0.5], [33, 0.29, 0.79], [68, 0.49, 0.13], [76, 0.49, 0.13],
      [66, 0.49, 0.38], [74, 0.49, 0.38], [58, 0.49, 0.63], [64, 0.49, 0.63], [52, 0.49, 0.88], [62, 0.49, 0.88], [85, 0.68, 0.5], [95, 0.68, 0.5],
      [106, 0.87, 0.3], [116, 0.87, 0.3], [104, 0.87, 0.7], [114, 0.87, 0.7]];
    const f = normalizeFormation({ formation: '3-4-1-2', matches: 6, slots: racing.map(([n, x, y]) => slot(n, x, y, [[n === 76 ? 'p68' : `p${n}`, 'J', n > 70 ? 4 : 2]])) });
    expect(f.slots).toHaveLength(11);
    expect(f.mergedSlots).toBe(7);
    expect(f.status).toBe('complete');
    // même joueur sous les deux identifiants : titularisations additionnées
    expect(f.slots.find(s => s.x === 0.49 && s.y === 0.13)!.players[0]).toEqual(['p68', 'J', 6]);
  });

  it('11 cases dont deux aux mêmes coordonnées : rien n\'est fusionné', () => {
    const slots = eleven(); slots[10] = slot(10, slots[9].x, slots[9].y);
    expect(normalizeFormation({ formation: '4-4-2', matches: 3, slots }).slots).toHaveLength(11);
  });

  it('plus de 11 postes distincts après fusion : formation irrégulière', () => {
    const slots = [...eleven(), slot(99, 0.95, 0.95)];
    expect(normalizeFormation({ formation: '5-4-1', matches: 2, slots }).status).toBe('irregular');
  });
});

describe('ordre des formations', () => {
  const lineups: TeamLineups = {
    matches: 11,
    formations: [
      { formation: '4-1-4-1', matches: 2, slots: eleven() },
      { formation: '3-4-3', matches: 1, slots: eleven() },
      { formation: '4-2-3-1', matches: 1, slots: eleven() },
      { formation: '3-2-4-1', matches: 7, slots: [slot(0, 0, 0), slot(1, 0, 0)] },
    ],
  };

  it('la plus utilisée d\'abord, même incomplète (le pipeline la rangeait en dernier)', () => {
    expect(orderFormations(lineups).map(f => `${f.formation}:${f.matches}:${f.status}`))
      .toEqual(['3-2-4-1:7:incomplete', '4-1-4-1:2:complete', '3-4-3:1:complete', '4-2-3-1:1:complete']);
  });

  it('égalité de matchs : la complète d\'abord', () => {
    const tie: TeamLineups = { matches: 4, formations: [{ formation: 'A', matches: 2, slots: [slot(0, 0, 0)] }, { formation: 'B', matches: 2, slots: eleven() }] };
    expect(orderFormations(tie).map(f => f.formation)).toEqual(['B', 'A']);
    expect(orderFormations(null)).toEqual([]);
  });

  it('couverture : matchs avec composition contre matchs de l\'équipe', () => {
    expect(lineupCoverage(lineups, 11)).toEqual({ matchesWithLineups: 11, teamMatches: 11, shownMatches: 11, complete: true });
    expect(lineupCoverage({ matches: 30, formations: [{ formation: 'A', matches: 26, slots: [] }] }, 33))
      .toEqual({ matchesWithLineups: 30, teamMatches: 33, shownMatches: 26, complete: false });
  });
});

describe('poste occupé dans la formation', () => {
  const at = (n: number, x: number, y: number) => slot(n, x, y);
  it('4-2-3-1 : gardien, latéraux, axiaux, sentinelles, ailiers, meneur, avant-centre', () => {
    const slots = [at(1, 0.1, 0.5), at(2, 0.3, 0.1), at(3, 0.28, 0.38), at(4, 0.28, 0.62), at(5, 0.3, 0.9), at(6, 0.45, 0.35), at(7, 0.45, 0.65),
      at(8, 0.68, 0.12), at(9, 0.66, 0.5), at(10, 0.68, 0.88), at(11, 0.86, 0.5)];
    const p = formationPositions({ formation: '4-2-3-1', slots })!;
    expect([...p.values()]).toEqual(['GK', 'FB', 'CB', 'CB', 'FB', 'DM', 'DM', 'W', 'AM', 'W', 'ST']);
  });
  it('3-4-3 : pistons aux extrémités de la ligne de 4 ; 4-3-3 : milieux centraux', () => {
    const p343 = formationPositions({ formation: '3-4-3', slots: [at(1, 0.1, 0.5), at(2, 0.3, 0.2), at(3, 0.3, 0.5), at(4, 0.3, 0.8),
      at(5, 0.5, 0.1), at(6, 0.5, 0.4), at(7, 0.5, 0.6), at(8, 0.5, 0.9), at(9, 0.85, 0.2), at(10, 0.87, 0.5), at(11, 0.85, 0.8)] })!;
    expect([...p343.values()]).toEqual(['GK', 'CB', 'CB', 'CB', 'WB', 'CM', 'CM', 'WB', 'W', 'ST', 'W']);
    const p433 = formationPositions({ formation: '4-3-3', slots: [at(1, 0.1, 0.5), at(2, 0.3, 0.1), at(3, 0.28, 0.38), at(4, 0.28, 0.62), at(5, 0.3, 0.9),
      at(6, 0.5, 0.2), at(7, 0.48, 0.5), at(8, 0.5, 0.8), at(9, 0.85, 0.15), at(10, 0.87, 0.5), at(11, 0.85, 0.85)] })!;
    expect([...p433.values()].slice(5, 8)).toEqual(['CM', 'CM', 'CM']);
  });
  it('formation incomplète ou chaîne illisible : pas de poste', () => {
    expect(formationPositions({ formation: '4-3-3', slots: eleven().slice(0, 10) })).toBeNull();
    expect(formationPositions({ formation: 'inconnue', slots: eleven() })).toBeNull();
  });
  it('hors poste seulement à deux lignes ou plus (ou gardien)', () => {
    expect(isOutOfPosition('W', 'WB')).toBe(true);
    expect(isOutOfPosition('FB', 'W')).toBe(true);
    expect(isOutOfPosition('W', 'AM')).toBe(false);      // nuance de rôle
    expect(isOutOfPosition('AM', 'CM')).toBe(false);
    expect(isOutOfPosition('CB', 'DM')).toBe(false);
    expect(isOutOfPosition('GK', 'CB')).toBe(true);
    expect(isOutOfPosition(undefined, 'CB')).toBe(false);
  });
});

describe('formation des besoins de recrutement', () => {
  const lineups = (formations: { formation: string; matches: number; slots: LineupSlot[] }[]): TeamLineups => ({ matches: 10, formations } as TeamLineups);
  const empty = (n: number) => Array.from({ length: n }, (_, i) => slot(i, 0, 0));

  it('la plus utilisée si elle donne un onze exploitable : pas de repli', () => {
    const f = orderFormations(lineups([{ formation: '4-3-3', matches: 8, slots: eleven() }, { formation: '4-4-2', matches: 2, slots: eleven(20) }]));
    expect(recruitmentFormation(f)).toEqual({ index: 0 });
  });

  it('cas Crvena Zvezda : 3-2-4-1 sans case placée → repli sur la plus utilisée exploitable, annoncé', () => {
    const f = orderFormations(lineups([
      { formation: '4-1-4-1', matches: 2, slots: eleven() }, { formation: '3-4-3', matches: 1, slots: eleven(20) },
      { formation: '3-2-4-1', matches: 7, slots: empty(4) },
    ]));
    expect(f[0].formation).toBe('3-2-4-1');                 // l'Analyse d'équipe la montre toujours en premier
    expect(isExploitableFormation(f[0])).toBe(false);
    const choice = recruitmentFormation(f)!;
    expect(f[choice.index].formation).toBe('4-1-4-1');
    expect(choice.fallbackFrom?.formation).toBe('3-2-4-1');
  });

  it('formation irrégulière (plus de 11 cases) : exploitable ; aucune exploitable : la plus utilisée, sans repli', () => {
    const twelve = [...eleven(), slot(99, 0.95, 0.95)];
    expect(isExploitableFormation(normalizeFormation({ formation: '3-4-3', matches: 3, slots: twelve }))).toBe(true);
    const f = orderFormations(lineups([{ formation: '4-4-2', matches: 5, slots: eleven().slice(0, 7) }, { formation: '3-5-2', matches: 2, slots: empty(3) }]));
    expect(recruitmentFormation(f)).toEqual({ index: 0 });
    expect(recruitmentFormation([])).toBeNull();
  });
});
