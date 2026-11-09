import { describe, expect, it } from 'vitest';
import { PlayerData } from '../types';
import { RolePreset, roleIndex, DEFAULT_ROLE_PRESETS } from './rolePresets';
import {
  DEFAULT_CONSTRAINTS, ESTIMATE_RATIO_MIN, ProspectConstraints, constraintsFromAi, effectiveThresholds, filterProspects, seasonCapabilities,
} from './prospects';
import { EMPTY_PROFILE, ProfileFilters } from './profileFilters';

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
      { s: 0.9, c: { ...DEFAULT_CONSTRAINTS, ageMax: 32, minutesMin: 0, contractMonths: 12, estimateAboveMarket: true, profile: { ...EMPTY_PROFILE, competitions: ['ESP'] } } },
      { s: 1.2, c: { ...DEFAULT_CONSTRAINTS, ageMax: 32, valueMax: 60_000_000 } },
    ];
    cases.forEach(({ s, c }) => {
      const legacy = legacyFilter(data, preset, s, {
        ageLimit: c.ageMax, marketValueLimit: c.valueMax!, contractMonths: c.contractMonths, undervaluedOnly: c.estimateAboveMarket,
        minMinutesPlayed: c.minutesMin, selectedLeague: c.profile.competitions[0] === 'ESP' ? 'LaLiga 2026-27' : '',
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
    expect(r.funnel).toEqual({ total: 5, position: 4, constraints: 3, profile: 3, eligible: 1, noMarketValue: 0, insufficientData: 1, belowThreshold: 1 });
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
    const r = filterProspects(data, preset, 1, { ...DEFAULT_CONSTRAINTS, profile: { ...EMPTY_PROFILE, competitions: ['ESP'] } }, ALL_CAPS, NOW);
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

describe('filterProspects : filtres qualitatifs (joueurs fictifs)', () => {
  const ok = { 'A pct': 90, 'B pct': 90 };
  const withProfile = (o: Omit<Partial<ProfileFilters>, 'includeMissing'> & { includeMissing?: Partial<ProfileFilters['includeMissing']> }): ProspectConstraints =>
    ({ ...DEFAULT_CONSTRAINTS, profile: { ...EMPTY_PROFILE, ...o, includeMissing: { ...EMPTY_PROFILE.includeMissing, ...(o.includeMissing ?? {}) } } });
  const names = (r: { players: PlayerData[] }) => r.players.map(p => p.Player).sort();

  it('sélection multiple de compétitions : union des compétitions choisies, aucune = toutes', () => {
    const data = [
      player({ Player: 'a', Competition: 'AAA', ...ok }),
      player({ Player: 'b', Competition: 'BBB', ...ok }),
      player({ Player: 'c', Competition: 'CCC', ...ok }),
      player({ Player: 'sans compétition', Competition: undefined, ...ok }),
    ];
    expect(names(filterProspects(data, preset, 1, withProfile({ competitions: ['AAA', 'BBB'] }), ALL_CAPS, NOW))).toEqual(['a', 'b']);
    expect(names(filterProspects(data, preset, 1, withProfile({ competitions: [] }), ALL_CAPS, NOW))).toHaveLength(4);
    expect(filterProspects(data, preset, 1, withProfile({ competitions: ['CCC'] }), ALL_CAPS, NOW).funnel).toMatchObject({ position: 4, constraints: 4, profile: 1, eligible: 1 });
  });

  it('niveau, club, nationalité, pied et taille se cumulent', () => {
    const data = [
      player({ Player: 'gaucher grand', 'League tier': 2, 'Team ID': 't1', 'Passport country': 'FRA', Foot: 'Left', Height: 188, ...ok }),
      player({ Player: 'droitier', 'League tier': 2, 'Team ID': 't1', 'Passport country': 'FRA', Foot: 'Right', Height: 188, ...ok }),
      player({ Player: 'petit', 'League tier': 2, 'Team ID': 't1', 'Passport country': 'FRA', Foot: 'Left', Height: 170, ...ok }),
      player({ Player: 'autre club', 'League tier': 2, 'Team ID': 't2', 'Passport country': 'FRA', Foot: 'Left', Height: 188, ...ok }),
      player({ Player: 'autre pays', 'League tier': 2, 'Team ID': 't1', 'Passport country': 'BRA', Foot: 'Left', Height: 188, ...ok }),
      player({ Player: 'niveau 1', 'League tier': 1, 'Team ID': 't1', 'Passport country': 'FRA', Foot: 'Left', Height: 188, ...ok }),
    ];
    const r = filterProspects(data, preset, 1, withProfile({ tiers: [2], teams: ['t1'], nations: ['FRA'], feet: ['Left'], heightMin: 180 }), ALL_CAPS, NOW);
    expect(names(r)).toEqual(['gaucher grand']);
    expect(r.funnel).toMatchObject({ position: 6, constraints: 6, profile: 1, eligible: 1 });
  });

  it('un joueur sans donnée n\'est jamais retenu ; il est compté, et retenu seulement si l\'option l\'inclut', () => {
    const data = [
      player({ Player: 'gaucher', Foot: 'Left', ...ok }),
      player({ Player: 'pied inconnu', ...ok }),
      player({ Player: 'pied vide', Foot: '', ...ok }),
    ];
    const r = filterProspects(data, preset, 1, withProfile({ feet: ['Left'] }), ALL_CAPS, NOW);
    expect(names(r)).toEqual(['gaucher']);
    expect(r.missing).toEqual({ nation: 0, foot: 2, height: 0 });
    expect(r.funnel).toMatchObject({ constraints: 3, profile: 1, eligible: 1 });
    const inc = filterProspects(data, preset, 1, withProfile({ feet: ['Left'], includeMissing: { foot: true } }), ALL_CAPS, NOW);
    expect(names(inc)).toEqual(['gaucher', 'pied inconnu', 'pied vide']);
    expect(inc.missing.foot).toBe(2);                                  // toujours comptés, affichés « inclus »
    expect(inc.funnel).toMatchObject({ constraints: 3, profile: 3, eligible: 3 });
  });

  it('population du compteur : postes du rôle, toutes les autres contraintes et les autres critères de profil passés', () => {
    const noFoot = { Foot: undefined, Height: 180, ...ok };
    const data = [
      player({ Player: 'compté', ...noFoot }),
      player({ Player: 'compté sous le seuil', ...noFoot, 'A pct': 5 }),   // avant les seuils du rôle : compté
      player({ Player: 'autre poste', ...noFoot, Position: 'ST' }),
      player({ Player: 'trop vieux', ...noFoot, Age: 30 }),
      player({ Player: 'peu de minutes', ...noFoot, 'Minutes played': 100 }),
      player({ Player: 'trop cher', ...noFoot, 'Market value': 90_000_000 }),
      player({ Player: 'valeur inconnue', ...noFoot, 'Market value': undefined }),
      player({ Player: 'autre compétition', ...noFoot, Competition: 'BBB' }),
      player({ Player: 'trop petit', ...noFoot, Height: 160 }),
      player({ Player: 'taille inconnue aussi', ...noFoot, Height: undefined }),
    ];
    const r = filterProspects(data, preset, 1, withProfile({ competitions: ['ESP'], feet: ['Left'], heightMin: 170 }), ALL_CAPS, NOW);
    expect(r.players).toEqual([]);
    expect(r.missing).toEqual({ nation: 0, foot: 2, height: 0 });
    // Valeur inconnue et pied inconnu : ni l'un ni l'autre compteur (chacun ne compte que les joueurs écartés pour cette seule raison)
    expect(r.funnel.noMarketValue).toBe(0);
    // Entonnoir : après contraintes (valeur connue), puis après profil
    expect(r.funnel).toMatchObject({ position: 9, constraints: 5, profile: 0, eligible: 0 });
    // Taille incluse : le joueur sans pied ni taille compte pour le pied ; il est compté pour la taille, sans pied inclus
    const incHeight = filterProspects(data, preset, 1, withProfile({ competitions: ['ESP'], feet: ['Left'], heightMin: 170, includeMissing: { height: true } }), ALL_CAPS, NOW);
    expect(incHeight.missing).toEqual({ nation: 0, foot: 3, height: 0 });
    const incFoot = filterProspects(data, preset, 1, withProfile({ competitions: ['ESP'], feet: ['Left'], heightMin: 170, includeMissing: { foot: true } }), ALL_CAPS, NOW);
    expect(incFoot.missing).toEqual({ nation: 0, foot: 2, height: 1 });
  });

  it('valeur de marché inconnue : comptée à part seulement si le profil est satisfait', () => {
    const data = [
      player({ Player: 'valeur inconnue, gaucher', 'Market value': undefined, Foot: 'Left', ...ok }),
      player({ Player: 'valeur inconnue, droitier', 'Market value': undefined, Foot: 'Right', ...ok }),
    ];
    const r = filterProspects(data, preset, 1, withProfile({ feet: ['Left'] }), ALL_CAPS, NOW);
    expect(r.funnel.noMarketValue).toBe(1);
    expect(r.missing.foot).toBe(0);
  });

  it('sans filtre qualitatif : aucun compteur, résultat inchangé', () => {
    const data = [player({ Player: 'x', ...ok }), player({ Player: 'y', Foot: undefined, ...ok })];
    const r = filterProspects(data, preset, 1, DEFAULT_CONSTRAINTS, ALL_CAPS, NOW);
    expect(names(r)).toEqual(['x', 'y']);
    expect(r.missing).toEqual({ nation: 0, foot: 0, height: 0 });
  });
});

describe('constraintsFromAi : configuration de l\'assistant IA', () => {
  it('une compétition renvoyée devient la sélection [clé], le reste du profil est conservé', () => {
    const prev: ProspectConstraints = { ...DEFAULT_CONSTRAINTS, profile: { ...EMPTY_PROFILE, competitions: ['AAA', 'BBB'], feet: ['Left'] } };
    const next = constraintsFromAi(prev, { competition: 'CCC', ageMax: 21, extraCriteria: [], explanation: '' }, ALL_CAPS);
    expect(next.profile).toEqual({ ...EMPTY_PROFILE, competitions: ['CCC'], feet: ['Left'] });
    expect(next.ageMax).toBe(21);
    expect(next).not.toHaveProperty('competition');
  });

  it('sans compétition : sélection inchangée ; valeur, contrat et estimation seulement si la saison les fournit', () => {
    const prev: ProspectConstraints = { ...DEFAULT_CONSTRAINTS, profile: { ...EMPTY_PROFILE, competitions: ['AAA'] } };
    const next = constraintsFromAi(prev, { valueMax: 5_000_000, contractMonths: 12, estimateAboveMarket: true, extraCriteria: [], explanation: '' }, NO_CAPS);
    expect(next).toEqual(prev);
    expect(constraintsFromAi(prev, { valueMax: 5_000_000, extraCriteria: [], explanation: '' }, ALL_CAPS).valueMax).toBe(5_000_000);
  });
});
