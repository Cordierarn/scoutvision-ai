import { describe, expect, it } from 'vitest';
import { buildOppositionFacts } from './oppositionFacts';
import { STRIKER } from './scoutReportFixtures';
import { TeamStats } from '../types';
import { TEAM_METRICS } from './teamMetrics';

const stats: TeamStats = { team_id: 't1', team: 'Club Fixture', competition: 'FIX-L1', league: 'Ligue Fixture 2026-27', season: '2026-27', Matches: 10, 'Goals per 90': 1.84, 'Goals against per 90': 0.9, PPDA: 9.123, Style: 'Pressing haut' };
const ppda = TEAM_METRICS.find(m => m.key === 'PPDA')!;

describe('buildOppositionFacts', () => {
  it('reprend les faits affichés (statistiques arrondies, rangs, formation, profil, joueurs clés) sans ligne brute', () => {
    const facts = buildOppositionFacts({
      name: 'Club Fixture', competition: 'Ligue Fixture', season: '26-27', stats, seasonInProgress: true, isCup: false,
      ranks: [{ def: ppda, value: 9.123, rank: 12.4, teams: 20 }, { def: ppda, value: null, rank: undefined, teams: 20 }],
      mainFormation: { formation: '4-3-3', matches: 8, status: 'complete', invalidSlots: 0, mergedSlots: 0, slots: [{ slot: 1, x: 0.05, y: 0.5, players: [['g', 'Gardien Fixture', 8]] }, { slot: 2, x: 0.3, y: 0.1, players: [['d', 'Latéral Fixture', 7]] }, { slot: 9, x: 0.85, y: 0.5, players: [] }] },
      profile: [{ key: 'finishing', label: 'Finition', value: 61.2, rank: 70.6, teams: 20 }],
      players: [STRIKER, { ...STRIKER, Player: 'Remplaçant Fixture', 'Minutes played': 200 }],
    });
    expect(facts.team).toEqual({ name: 'Club Fixture', competition: 'Ligue Fixture', season: '26-27', matches: 10, goalsForPer90: 1.84, goalsAgainstPer90: 0.9, style: 'Pressing haut', seasonInProgress: true });
    expect(facts.ranks).toEqual([{ metric: ppda.label, value: 9.1, rank: 12, of: 20, sense: ppda.sense }]);
    expect(facts.formation).toEqual({ formation: '4-3-3', matches: 8, starters: [{ position: 'gardien', player: 'Gardien Fixture', starts: 8 }, { position: 'défenseur gauche', player: 'Latéral Fixture', starts: 7 }, { position: 'attaquant axial', player: '—', starts: 0 }] });
    expect(facts.squadProfile).toEqual([{ dimension: 'Finition', value: 61, rank: 71, of: 20 }]);
    expect(facts.keyPlayers[0]).toMatchObject({ name: 'Attaquant Fixture', position: 'Avant-centre', minutes: 1000, age: 23, matches: 12 });
    expect(facts.keyPlayers[0].role).toBeDefined();
    expect(facts.keyPlayers[1].name).toBe('Remplaçant Fixture');
    expect(JSON.stringify(facts)).not.toContain('npxG per 90 pct');   // jamais la ligne brute
  });
  it('sans statistiques ni formation : équipe minimale et joueurs seulement', () => {
    const facts = buildOppositionFacts({ name: 'X', competition: 'Y', season: '2026', stats: null, ranks: [], players: [] });
    expect(facts).toEqual({ team: { name: 'X', competition: 'Y', season: '2026' }, ranks: [], keyPlayers: [] });
  });
});
