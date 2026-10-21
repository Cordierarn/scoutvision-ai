import { describe, expect, it } from 'vitest';
import { LineupSlot } from '../services/dataLoader';
import { placeEleven } from './lineup';

const slot = (id: number, players: [string, number][]): LineupSlot =>
  ({ slot: id, x: 0.5, y: 0.5, players: players.map(([p, starts]) => [p, p.toUpperCase(), starts]) });

describe('placeEleven', () => {
  it('donne un titulaire différent à chaque case', () => {
    // a est le plus titularisé des deux cases : la case 2 se rabat sur b
    const placed = placeEleven([slot(1, [['a', 20], ['c', 3]]), slot(2, [['a', 10], ['b', 8]])]);
    expect(placed.map(p => p.starter?.id)).toEqual(['a', 'b']);
    expect(placed[1].backups.map(b => b.id)).toEqual(['a']);
  });

  it('déplace un joueur déjà placé pour remplir une case (chemin augmentant)', () => {
    // case 1 : a ou b ; case 2 : seulement a. a doit aller en case 2 et b en case 1
    const placed = placeEleven([slot(1, [['a', 30], ['b', 5]]), slot(2, [['a', 4]])]);
    expect(placed.map(p => p.starter?.id)).toEqual(['b', 'a']);
  });

  it('laisse vide une case sans candidat libre', () => {
    const placed = placeEleven([slot(1, [['a', 9]]), slot(2, [['a', 3]])]);
    expect(placed.filter(p => p.starter).length).toBe(1);
    expect(placed.find(p => !p.starter)?.backups.map(b => b.id)).toEqual(['a']);
  });
});

describe('placeEleven : cas réels', () => {
  it('maximise les titularisations à nombre de cases égal', () => {
    // a : 12 en case 1, 11 en case 2 ; b : 10 en case 1 ; c : 2 en case 2
    // (a, c) = 14 ; (b, a) = 21 : a passe en case 2
    const placed = placeEleven([slot(1, [['a', 12], ['b', 10]]), slot(2, [['a', 11], ['c', 2]])]);
    expect(placed.map(p => p.starter?.id)).toEqual(['b', 'a']);
  });

  it('pourvoit 11 cases distinctes sur une formation complète', () => {
    const slots = Array.from({ length: 11 }, (_, i) =>
      slot(i + 1, [[`p${i}`, 20 - i], [`p${(i + 1) % 11}`, 5], ['star', 30]]));
    const placed = placeEleven(slots);
    const starters = placed.map(p => p.starter?.id);
    expect(starters.every(Boolean)).toBe(true);
    expect(new Set(starters).size).toBe(11);
  });

  it('renvoie une liste vide sans case', () => {
    expect(placeEleven([])).toEqual([]);
  });
});

describe('placeEleven : optimalité', () => {
  // Recherche exhaustive : le plus de cases pourvues, puis le plus de titularisations
  const brute = (slots: LineupSlot[]): [number, number] => {
    let best: [number, number] = [0, 0];
    const go = (i: number, used: Set<string>, filled: number, starts: number) => {
      if (i === slots.length) {
        if (filled > best[0] || (filled === best[0] && starts > best[1])) best = [filled, starts];
        return;
      }
      go(i + 1, used, filled, starts);
      slots[i].players.forEach(([id, , s]) => {
        if (used.has(id)) return;
        used.add(id);
        go(i + 1, used, filled + 1, starts + s);
        used.delete(id);
      });
    };
    go(0, new Set(), 0, 0);
    return best;
  };

  it('égale la recherche exhaustive sur 300 cas aléatoires', () => {
    let seed = 42;
    const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    for (let t = 0; t < 300; t++) {
      const nSlots = 2 + Math.floor(rand() * 5);
      const pool = Array.from({ length: 2 + Math.floor(rand() * 6) }, (_, i) => `p${i}`);
      const slots = Array.from({ length: nSlots }, (_, i) => {
        const chosen = pool.filter(() => rand() < 0.45);
        return slot(i + 1, chosen.map(id => [id, 1 + Math.floor(rand() * 30)] as [string, number]));
      }).map(s => ({ ...s, players: [...s.players].sort((a, b) => b[2] - a[2]) }));
      const placed = placeEleven(slots);
      const ids = placed.map(p => p.starter?.id).filter(Boolean);
      expect(new Set(ids).size).toBe(ids.length);
      const got: [number, number] = [ids.length, placed.reduce((s, p) => s + (p.starter?.starts ?? 0), 0)];
      expect(got).toEqual(brute(slots));
    }
  });

  it('additionne les titularisations d\'un joueur listé sous deux graphies', () => {
    const placed = placeEleven([{
      slot: 1, x: 0.5, y: 0.5,
      players: [['a', 'Inigo Cordoba', 6], ['b', 'B', 8], ['a', 'Iñigo Córdoba', 5]],
    }]);
    expect(placed[0].starter).toEqual({ id: 'a', name: 'Inigo Cordoba', starts: 11 });
    expect(placed[0].backups.map(b => b.id)).toEqual(['b']);
  });
});
