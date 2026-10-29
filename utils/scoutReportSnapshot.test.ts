import { describe, expect, it } from 'vitest';
import { buildSnapshot, compareSnapshot, observationPriorities, playerRef, roleMetrics, strengthsAndLimits, summarySections } from './scoutReportSnapshot';
import { STRIKER } from './scoutReportFixtures';

describe('playerRef', () => {
  it('identifie le dossier par playerSeasonId (identifiant, club, compétition, saison), jamais par le nom seul', () => {
    const ref = playerRef(STRIKER, { key: 'FIX-L1', name: 'Ligue Fixture', tier: 2, seasons: [] });
    expect(ref.playerSeasonId).toBe('fx-1_tf-1_FIX-L1_2026-27');
    expect(ref).toMatchObject({ playerId: 'fx-1', teamId: 'tf-1', name: 'Attaquant Fixture', team: 'Club Fixture', competition: 'FIX-L1', competitionName: 'Ligue Fixture', season: '2026-27', position: 'ST', age: 23, minutes: 1000 });
    expect(playerRef({ ...STRIKER, Competition: 'FIX-CUP' }).playerSeasonId).not.toBe(ref.playerSeasonId);
    expect(playerRef({ ...STRIKER, 'Team ID': 'tf-2' }).playerSeasonId).not.toBe(ref.playerSeasonId);
  });
});

describe('buildSnapshot', () => {
  it('conserve les faits du rapport, les rôles officiels, les indicateurs et la date des données, pas la ligne entière', () => {
    const snap = buildSnapshot(STRIKER, { seasonInProgress: true, dataIndex: { generatedAt: '2026-10-20T00:00:00.000Z' } as never });
    expect(snap.facts.player.name).toBe('Attaquant Fixture');
    expect(snap.facts.metrics.some(m => m.metric === 'npxG par 90' && m.percentile === 91)).toBe(true);
    expect(snap.bestRoles.length).toBeGreaterThan(0);
    expect(snap.bestRoles.map(r => r.role)).toContain('Renard des surfaces');
    expect(snap.indicators?.rapm).toMatchObject({ net: 0.08, off: 0.1, def: -0.02, pct: 72, minutes: 1000 });
    expect(snap.indicators?.valuation).toEqual({ market: 12_000_000, estimate: 9_500_000 });
    expect(snap.seasonInProgress).toBe(true);
    expect(snap.dataUpdatedAt).toBe('2026-10-20T00:00:00.000Z');
    expect(JSON.stringify(snap)).not.toContain('"Minutes played"');   // jamais la ligne brute
    expect(JSON.stringify(snap).length).toBeLessThan(12_000);
  });

  it('privilégie les faits renvoyés par le serveur quand ils sont fournis', () => {
    const facts = buildSnapshot(STRIKER).facts;
    const served = { ...facts, sample: { ...facts.sample, minutes: 1234 } };
    expect(buildSnapshot(STRIKER, { facts: served }).facts.sample.minutes).toBe(1234);
  });
});

describe('compareSnapshot (fraîcheur, lecture neutre)', () => {
  it('ne signale rien quand les données n\'ont pas changé', () => {
    const snap = buildSnapshot(STRIKER);
    expect(compareSnapshot(snap, buildSnapshot(STRIKER).facts)).toEqual({ changed: false, reasons: [] });
  });
  it('signale l\'échantillon, les percentiles, la valeur et la date des données plus récente', () => {
    const snap = buildSnapshot(STRIKER, { dataIndex: { generatedAt: '2026-10-20T00:00:00.000Z' } as never });
    const live = buildSnapshot({ ...STRIKER, 'Minutes played': 1180, 'Matches played': 14, 'npxG per 90 pct': 86, 'Market value': 15_000_000 }).facts;
    const cmp = compareSnapshot(snap, live, '2026-10-27T00:00:00.000Z');
    expect(cmp.changed).toBe(true);
    expect(cmp.reasons.some(r => r.includes('données publiées le 2026-10-27'))).toBe(true);
    expect(cmp.reasons.some(r => r.includes('12 matchs / 1000 min → 14 matchs / 1180 min'))).toBe(true);
    expect(cmp.reasons.some(r => /1 percentile sur \d+ ont changé \(écart maximal 5 points\)/.test(r))).toBe(true);
    expect(cmp.reasons).toContain('valeur de marché Transfermarkt différente');
  });
});

describe('lectures du snapshot', () => {
  it('forces ≥ 75 et limites ≤ 25 dans le sens de la métrique', () => {
    const { strengths, limits } = strengthsAndLimits(buildSnapshot(STRIKER).facts);
    expect(strengths.map(m => m.metric)).toContain('npxG par 90');
    expect(strengths.every(m => (m.lessIsPreferable ? 100 - m.percentile : m.percentile) >= 75)).toBe(true);
    expect(limits.map(m => m.metric)).toContain('Duels aériens gagnés, %');
    expect(strengths.length).toBeLessThanOrEqual(5);
  });
  it('métriques du rôle dans l\'ordre des poids du preset', () => {
    const list = roleMetrics(buildSnapshot(STRIKER).facts, 'Renard des surfaces');
    expect(list[0].metric).toBe('npxG par 90');
    expect(list.map(m => m.metric)).toContain('Buts par 90');
  });
  it('découpe une synthèse en sections et extrait les priorités d\'observation', () => {
    const content = ['Intro.', '### 1. Contexte et profil', '- a', '### 5. Priorités d\'observation', '- **Vidéo** : prise d\'information.', '- Live : duels.', ''].join('\n');
    const sections = summarySections(content);
    expect(sections.map(s => s.title)).toEqual(['', '1. Contexte et profil', '5. Priorités d\'observation']);
    expect(observationPriorities(content)).toEqual(['Vidéo : prise d\'information.', 'Live : duels.']);
    expect(observationPriorities('')).toEqual([]);
  });
});
