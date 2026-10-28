import { describe, expect, it } from 'vitest';
import { PlayerData } from '../types';
import { RolePreset, roleIndex, DEFAULT_ROLE_PRESETS } from './rolePresets';
import {
  DEFAULT_CONSTRAINTS, ESTIMATE_RATIO_MIN, ProspectConstraints, effectiveThresholds, filterProspects, seasonCapabilities,
} from './prospects';

const NOW = new Date('2026-10-26T12:00:00Z');
const ALL_CAPS = { marketValue: true, contract: true, estimate: true };
const NO_CAPS = { marketValue: false, contract: false, estimate: false };

const player = (fields: Record<string, string | number | undefined>): PlayerData =>
  ({ Player: 'X', Team: 'T', League: 'L 2026-27', Competition: 'ESP', Position: 'CB', Age: 21, 'Minutes played': 900,
    'Matches played': 10, 'Market value': 1_000_000, ...fields } as PlayerData);

const preset: RolePreset = { positions: ['CB'], metrics: { A: 60, B: 50 }, weights: { C: 1 } };

/**
 * Filtre historique du Chasseur (Prospects.tsx avant extraction), recopié tel quel : référence
 * pour vérifier que seuls les comportements décidés ont changé
 */
function legacyFilter(data: PlayerData[], pr: RolePreset, strictness: number, c: {
  ageLimit: number; marketValueLimit: number; contractMonths: number; undervaluedOnly: boolean; minMinutesPlayed: number; selectedLeague: string;
}, now: Date) {
  const thresholds: Record<string, number> = {};
  Object.entries(pr.metrics).forEach(([k, v]) => { thresholds[k] = Math.min(99, Math.round(v * strictness)); });
  const deadline = new Date(now); deadline.setMonth(deadline.getMonth() + c.contractMonths);
  const out = data.filter(p => {
    if ((Number(p.Age) || 100) > c.ageLimit) return false;
    if ((Number(p['Market value']) || 0) > c.marketValueLimit) return false;
    if (c.contractMonths > 0) {
      const end = p['Contract expires'] ? new Date(p['Contract expires']) : null;
      if (!end || end > deadline) return false;
    }
    if (c.undervaluedOnly) {
      const m = Number(p['Market value']); const e = Number(p['Estimated value']);
      if (!m || !e || e / m < 1.5) return false;
    }
    if ((Number(p['Minutes played']) || 0) < c.minMinutesPlayed) return false;
    if (c.selectedLeague && p.League !== c.selectedLeague) return false;
    if (!pr.positions.includes(p.Position)) return false;
    for (const [k, min] of Object.entries(thresholds)) if ((Number(p[`${k} pct`]) || 0) < min) return false;
    return true;
  });
  out.sort((a, b) => roleIndex(b, pr) - roleIndex(a, pr));
  return out;
}

describe('effectiveThresholds', () => {
  it('multiplie, arrondit et plafonne à 99', () => {
    expect(effectiveThresholds({ positions: [], metrics: { A: 70, B: 95 } }, 0.9)).toEqual({ A: 63, B: 86 });
    expect(effectiveThresholds({ positions: [], metrics: { A: 70, B: 95 } }, 1.1)).toEqual({ A: 77, B: 99 });
  });
});

describe('filterProspects : équivalence avec le filtre historique sur données complètes', () => {
  it('donne exactement les mêmes joueurs dans le même ordre', () => {
    let seed = 7;
    const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const positions = ['CB', 'FB', 'ST', 'CM'];
    const data: PlayerData[] = Array.from({ length: 600 }, (_, i) => player({
      Player: `P${i}`, Position: positions[i % 4], Age: 17 + Math.floor(rand() * 16),
      'Minutes played': Math.floor(rand() * 3000), 'Market value': Math.round(rand() * 60) * 1_000_000 + 100_000,
      'Estimated value': Math.round(rand() * 90) * 1_000_000 + 100_000,
      'Contract expires': `202${7 + Math.floor(rand() * 3)}-06-30`,
      Competition: i % 3 ? 'ESP' : 'FRA', League: i % 3 ? 'LaLiga 2026-27' : 'Ligue 1 2026-27',
      'A pct': Math.round(rand() * 100), 'B pct': Math.round(rand() * 100), 'C pct': Math.round(rand() * 100),
    }));
    const cases = [
      { s: 1, c: { ...DEFAULT_CONSTRAINTS } },
      { s: 0.8, c: { ...DEFAULT_CONSTRAINTS, ageMax: 30, valueMax: 50_000_000, minutesMin: 0 } },
      { s: 0.9, c: { ...DEFAULT_CONSTRAINTS, ageMax: 32, minutesMin: 0, contractMonths: 12, estimateAboveMarket: true, competition: 'ESP' } },
      { s: 1.2, c: { ...DEFAULT_CONSTRAINTS, ageMax: 32, valueMax: 60_000_000 } },
    ];
    cases.forEach(({ s, c }) => {
      const legacy = legacyFilter(data, preset, s, {
        ageLimit: c.ageMax, marketValueLimit: c.valueMax!, contractMonths: c.contractMonths, undervaluedOnly: c.estimateAboveMarket,
        minMinutesPlayed: c.minutesMin, selectedLeague: c.competition === 'ESP' ? 'LaLiga 2026-27' : c.competition,
      }, NOW);
      const now = filterProspects(data, preset, s, c, ALL_CAPS, NOW);
      expect(now.players.map(p => p.Player)).toEqual(legacy.map(p => p.Player));
      expect(now.players.length).toBeGreaterThan(0);
    });
  });
});

describe('filterProspects : entonnoir', () => {
  it('compte chaque étape à partir du filtrage réel', () => {
    const data = [
      player({ Player: 'ok', 'A pct': 80, 'B pct': 70, 'C pct': 10 }),
      player({ Player: 'autre poste', Position: 'ST', 'A pct': 99, 'B pct': 99 }),
      player({ Player: 'trop vieux', Age: 30, 'A pct': 99, 'B pct': 99 }),
      player({ Player: 'sous le seuil', 'A pct': 10, 'B pct': 99 }),
      player({ Player: 'percentile absent', 'A pct': 90 }),
    ];
    const r = filterProspects(data, preset, 1, DEFAULT_CONSTRAINTS, ALL_CAPS, NOW);
    expect(r.funnel).toEqual({ total: 5, position: 4, constraints: 3, eligible: 1, noMarketValue: 0, insufficientData: 1, belowThreshold: 1 });
    expect(r.players.map(p => p.Player)).toEqual(['ok']);
  });
});

describe('filterProspects : percentile manquant', () => {
  it('rend le joueur non éligible et le compte en données insuffisantes, même avec un seuil à 0', () => {
    const zero: RolePreset = { positions: ['CB'], metrics: { A: 0 } };
    const r = filterProspects([player({ Player: 'sans A' }), player({ Player: 'avec A', 'A pct': 0 })], zero, 1, DEFAULT_CONSTRAINTS, ALL_CAPS, NOW);
    expect(r.players.map(p => p.Player)).toEqual(['avec A']);
    expect(r.funnel.insufficientData).toBe(1);
  });

  it('compte sous le seuil, pas en données insuffisantes, un joueur qui échoue aussi sur un percentile connu', () => {
    const r = filterProspects([player({ 'A pct': 10 })], preset, 1, DEFAULT_CONSTRAINTS, ALL_CAPS, NOW);
    expect(r.funnel).toMatchObject({ belowThreshold: 1, insufficientData: 0 });
  });
});

describe('filterProspects : valeur de marché inconnue', () => {
  const data = [
    player({ Player: 'connue', 'A pct': 90, 'B pct': 90 }),
    player({ Player: 'inconnue', 'Market value': undefined, 'A pct': 90, 'B pct': 90 }),
    player({ Player: 'trop chère', 'Market value': 80_000_000, 'A pct': 90, 'B pct': 90 }),
  ];

  it('exclut une valeur inconnue quand une valeur maximum est fixée, et la compte', () => {
    const r = filterProspects(data, preset, 1, DEFAULT_CONSTRAINTS, ALL_CAPS, NOW);
    expect(r.players.map(p => p.Player)).toEqual(['connue']);
    expect(r.funnel.noMarketValue).toBe(1);
  });

  it('garde une valeur inconnue sans limite de valeur', () => {
    const r = filterProspects(data, preset, 1, { ...DEFAULT_CONSTRAINTS, valueMax: null }, ALL_CAPS, NOW);
    expect(r.players.map(p => p.Player).sort()).toEqual(['connue', 'inconnue', 'trop chère']);
    expect(r.funnel.noMarketValue).toBe(0);
  });

  it('ne compte pas en « valeur indisponible » un joueur exclu par une autre contrainte', () => {
    const r = filterProspects([player({ 'Market value': undefined, Age: 35, 'A pct': 90, 'B pct': 90 })], preset, 1, DEFAULT_CONSTRAINTS, ALL_CAPS, NOW);
    expect(r.funnel.noMarketValue).toBe(0);
  });
});

describe('filterProspects : saison historique (sans données de marché)', () => {
  const data = [player({ 'Market value': undefined, 'A pct': 90, 'B pct': 90 })];
  const c: ProspectConstraints = { ...DEFAULT_CONSTRAINTS, contractMonths: 12, estimateAboveMarket: true };

  it('détecte les données disponibles', () => {
    expect(seasonCapabilities(data)).toEqual(NO_CAPS);
    expect(seasonCapabilities([player({ 'Contract expires': '2028-06-30', 'Estimated value': 2e6 })])).toEqual(ALL_CAPS);
  });

  it('n\'applique ni valeur, ni contrat, ni estimation quand la saison ne les fournit pas', () => {
    const r = filterProspects(data, preset, 1, c, seasonCapabilities(data), NOW);
    expect(r.players).toHaveLength(1);
    expect(r.funnel.noMarketValue).toBe(0);
  });
});

describe('filterProspects : estimation, contrat, compétition', () => {
  it('applique le ratio estimation / marché', () => {
    const data = [
      player({ Player: 'oui', 'Estimated value': ESTIMATE_RATIO_MIN * 1_000_000, 'A pct': 90, 'B pct': 90 }),
      player({ Player: 'non', 'Estimated value': 1_000_000, 'A pct': 90, 'B pct': 90 }),
    ];
    const r = filterProspects(data, preset, 1, { ...DEFAULT_CONSTRAINTS, estimateAboveMarket: true }, ALL_CAPS, NOW);
    expect(r.players.map(p => p.Player)).toEqual(['oui']);
  });

  it('filtre sur la clé Competition, quelle que soit la saison', () => {
    const data = [
      player({ Player: '2026', Competition: 'ESP', League: 'LaLiga 2026-27', 'A pct': 90, 'B pct': 90 }),
      player({ Player: '2025', Competition: 'ESP', League: 'LaLiga 2025-26', 'A pct': 90, 'B pct': 90 }),
      player({ Player: 'FRA', Competition: 'FRA', League: 'Ligue 1 2026-27', 'A pct': 90, 'B pct': 90 }),
    ];
    const r = filterProspects(data, preset, 1, { ...DEFAULT_CONSTRAINTS, competition: 'ESP' }, ALL_CAPS, NOW);
    expect(r.players.map(p => p.Player).sort()).toEqual(['2025', '2026']);
  });

  it('exclut un contrat inconnu ou trop lointain quand une échéance est fixée', () => {
    const data = [
      player({ Player: 'proche', 'Contract expires': '2027-06-30', 'A pct': 90, 'B pct': 90 }),
      player({ Player: 'loin', 'Contract expires': '2030-06-30', 'A pct': 90, 'B pct': 90 }),
      player({ Player: 'inconnu', 'A pct': 90, 'B pct': 90 }),
    ];
    const r = filterProspects(data, preset, 1, { ...DEFAULT_CONSTRAINTS, contractMonths: 12 }, ALL_CAPS, NOW);
    expect(r.players.map(p => p.Player)).toEqual(['proche']);
  });
});

describe('filterProspects : rôles officiels', () => {
  it('classe par indice du rôle décroissant', () => {
    const pr = DEFAULT_ROLE_PRESETS['Stoppeur'];
    const data = [40, 95, 70].map((v, i) => player({ Player: `S${i}`, ...Object.fromEntries(Object.keys(pr.metrics).map(k => [`${k} pct`, 99])), 'Shots blocked per 90 pct': v }));
    const r = filterProspects(data, pr, 1, DEFAULT_CONSTRAINTS, ALL_CAPS, NOW);
    const idx = r.players.map(p => roleIndex(p, pr));
    expect(idx).toEqual([...idx].sort((a, b) => b - a));
    expect(r.players[0].Player).toBe('S1');
  });
});
