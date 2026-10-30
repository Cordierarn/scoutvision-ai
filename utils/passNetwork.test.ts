import { describe, expect, it } from 'vitest';
import type { TeamNetwork } from '../services/dataLoader';
import { DEFAULT_NETWORK_FILTERS, filterNetwork, linkScale, networkView, playerLinks, playerScale, shortName } from './passNetwork';

// Fixture synthétique : équipe fictive sur 4 matchs avec réseau
const RAW: TeamNetwork = {
  matches: 4,
  players: {
    p_a: ['Gardien Fixture', 0.1, 0.5, 4, 80, 20],
    p_b: ['Latéral Fixture', 0.35, 0.1, 4, 120, 100],
    p_c: ['Milieu Fixture', 0.5, 0.5, 2, 60, 70],
    p_d: ['Remplaçant Fixture', 0.8, 0.6, 1, 5, 4],
  },
  edges: [
    ['p_a', 'p_b', 30, 4], ['p_b', 'p_a', 10, 3],
    ['p_b', 'p_c', 24, 2], ['p_c', 'p_b', 16, 2],
    ['p_c', 'p_d', 3, 1],
    ['p_c', 'p_c', 9, 1],            // auto-lien, ignoré
    ['p_b', 'p_zz', 50, 4],          // joueur absent des nœuds, ignoré
  ],
};

describe('networkView', () => {
  it('lit joueurs et liens non orientés rapportés aux matchs de l\'équipe', () => {
    const view = networkView(RAW)!;
    expect(view.matches).toBe(4);
    expect(view.players.map(p => p.id)).toEqual(['p_b', 'p_c', 'p_a', 'p_d']);
    expect(view.players[0]).toMatchObject({ name: 'Latéral Fixture', share: 1, perMatch: 55 });
    expect(view.players[1]).toMatchObject({ share: 0.5, perMatch: 32.5 });
    expect(view.links).toHaveLength(3);
    expect(view.links[0]).toEqual({ a: 'p_a', b: 'p_b', passes: 40, ab: 30, ba: 10, matches: 4, perMatch: 10 });
    expect(view.links[1]).toEqual({ a: 'p_b', b: 'p_c', passes: 40, ab: 24, ba: 16, matches: 2, perMatch: 10 });
    expect(view.links[2]).toMatchObject({ a: 'p_c', b: 'p_d', passes: 3, perMatch: 0.8 });
  });

  it('retourne null sans réseau', () => {
    expect(networkView(null)).toBeNull();
    expect(networkView({ matches: 0, players: {}, edges: [] })).toBeNull();
  });
});

describe('filterNetwork', () => {
  const view = networkView(RAW)!;

  it('garde les joueurs assez présents et les liens assez fréquents entre eux', () => {
    const f = filterNetwork(view, DEFAULT_NETWORK_FILTERS);
    expect(f.players.map(p => p.id)).toEqual(['p_b', 'p_c', 'p_a']);
    expect(f.hiddenPlayers).toBe(1);
    expect(f.links.map(l => `${l.a}-${l.b}`)).toEqual(['p_a-p_b', 'p_b-p_c']);
    expect(f.hiddenLinks).toBe(0);
  });

  it('compte les liens masqués par le seuil de passes, pas ceux d\'un joueur masqué', () => {
    const f = filterNetwork(view, { minShare: 0, minPerMatch: 5 });
    expect(f.players).toHaveLength(4);
    expect(f.links).toHaveLength(2);
    expect(f.hiddenLinks).toBe(1);
    const g = filterNetwork(view, { minShare: 0.75, minPerMatch: 0 });
    expect(g.players.map(p => p.id)).toEqual(['p_b', 'p_a']);
    expect(g.links).toHaveLength(1);
    expect(g.hiddenLinks).toBe(0);
  });
});

describe('playerLinks et échelles', () => {
  const view = networkView(RAW)!;

  it('donne les partenaires d\'un joueur avec le sens des passes', () => {
    const links = playerLinks(view, 'p_b');
    expect(links.map(l => l.partner.id)).toEqual(['p_a', 'p_c']);
    expect(links[0]).toMatchObject({ given: 10, got: 30 });
    expect(links[1]).toMatchObject({ given: 24, got: 16 });
    expect(playerLinks(view, 'p_inconnu')).toEqual([]);
  });

  it('met les liens et les joueurs à l\'échelle du maximum affiché', () => {
    const ls = linkScale(view.links);
    expect(ls(view.links[0])).toBe(1);
    expect(ls(view.links[2])).toBeCloseTo(0.08);
    const ps = playerScale(view.players);
    expect(ps(view.players[0])).toBe(1);
    expect(ps(view.players[1])).toBeCloseTo(Math.sqrt(32.5 / 55));
    expect(linkScale([])(view.links[0])).toBe(0);
  });

  it('abrège un nom à son dernier mot', () => {
    expect(shortName('Latéral Fixture')).toBe('Fixture');
    expect(shortName('Mononyme')).toBe('Mononyme');
  });
});
