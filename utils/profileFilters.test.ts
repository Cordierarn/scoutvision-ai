/** Filtres qualitatifs (compétition, niveau, club, nationalité, pied, taille) : joueurs et clubs fictifs */
import { describe, expect, it } from 'vitest';
import { EMPTY_PROFILE, ProfileFilters, applyProfileFilters, isProfileActive, profileChips, validateProfileFilters } from './profileFilters';
import { nationName, NATION_GROUPS } from './nations';

const row = (o: Record<string, unknown>) => ({ Player: 'Joueur', Competition: 'AAA', 'League tier': 1, 'Team ID': 't1', Team: 'Club A', 'Passport country': 'FRA', Foot: 'Left', Height: 180, ...o });
const rows = [
  row({ Player: 'A' }),
  row({ Player: 'B', Competition: 'BBB', 'League tier': 2, 'Team ID': 't2', Team: 'Club B', 'Passport country': 'BRA', Foot: 'Right', Height: 190 }),
  row({ Player: 'C', Foot: 'Both', Height: 172 }),
  row({ Player: 'D', Foot: undefined, Height: null, 'Passport country': null }),
  row({ Player: 'E', Foot: '', Height: undefined, 'Passport country': '' }),
];
const f = (o: Omit<Partial<ProfileFilters>, 'includeMissing'> & { includeMissing?: Partial<ProfileFilters['includeMissing']> }): ProfileFilters => ({ ...EMPTY_PROFILE, ...o, includeMissing: { ...EMPTY_PROFILE.includeMissing, ...(o.includeMissing ?? {}) } });
const names = (r: { rows: { Player: unknown }[] }) => r.rows.map(x => x.Player);

describe('applyProfileFilters : sélection multiple', () => {
  it('sans filtre : tout passe, aucun compteur', () => {
    const r = applyProfileFilters(rows, EMPTY_PROFILE);
    expect(r.rows).toHaveLength(5);
    expect(r.missing).toEqual({ nation: 0, foot: 0, height: 0 });
    expect(isProfileActive(EMPTY_PROFILE)).toBe(false);
  });

  it('compétitions, niveaux et clubs : union des valeurs choisies', () => {
    expect(names(applyProfileFilters(rows, f({ competitions: ['BBB'] })))).toEqual(['B']);
    expect(names(applyProfileFilters(rows, f({ competitions: ['AAA', 'BBB'] })))).toHaveLength(5);
    expect(names(applyProfileFilters(rows, f({ tiers: [2] })))).toEqual(['B']);
    expect(names(applyProfileFilters(rows, f({ teams: ['t1'] })))).toEqual(['A', 'C', 'D', 'E']);
  });

  it('les critères se cumulent (ET entre champs, OU dans un champ)', () => {
    expect(names(applyProfileFilters(rows, f({ teams: ['t1'], feet: ['Left', 'Both'] })))).toEqual(['A', 'C']);
  });

  it('pied : choix exact, « gauche » ne retient pas « les deux pieds »', () => {
    expect(names(applyProfileFilters(rows, f({ feet: ['Left'] })))).toEqual(['A']);
  });

  it('taille : bornes incluses', () => {
    expect(names(applyProfileFilters(rows, f({ heightMin: 180, heightMax: 190 })))).toEqual(['A', 'B']);
    expect(names(applyProfileFilters(rows, f({ heightMax: 175 })))).toEqual(['C']);
  });
});

describe('applyProfileFilters : valeurs absentes', () => {
  it('un joueur sans donnée n\'est jamais retenu ; le nombre écarté faute de donnée est compté', () => {
    const r = applyProfileFilters(rows, f({ feet: ['Left', 'Right', 'Both'] }));
    expect(names(r)).toEqual(['A', 'B', 'C']);
    expect(r.missing.foot).toBe(2);
    const n = applyProfileFilters(rows, f({ nations: ['FRA', 'BRA'] }));
    expect(n.missing.nation).toBe(2);
    const h = applyProfileFilters(rows, f({ heightMin: 150 }));
    expect(h.missing.height).toBe(2);
  });

  it('option « inclure les joueurs sans donnée »', () => {
    const r = applyProfileFilters(rows, f({ feet: ['Left'], includeMissing: { foot: true } }));
    expect(names(r)).toEqual(['A', 'D', 'E']);
    expect(r.missing.foot).toBe(2); // toujours affiché, à côté de l'option cochée
  });

  it('le compteur ne compte que les joueurs qui passent les autres critères', () => {
    const r = applyProfileFilters(rows, f({ competitions: ['BBB'], feet: ['Right'] }));
    expect(r.missing.foot).toBe(0);
  });

  it('jamais de valeur inventée : un pied inconnu ou une taille non numérique valent « sans donnée »', () => {
    const odd = [row({ Player: 'X', Foot: 'Unknown', Height: 'abc' })];
    const r = applyProfileFilters(odd, f({ feet: ['Left'], heightMin: 100 }));
    expect(r.rows).toHaveLength(0);
  });
});

describe('validateProfileFilters (filtres enregistrés et liens)', () => {
  it('absent : filtres vides (ancien lien)', () => {
    expect(validateProfileFilters(undefined)).toEqual(EMPTY_PROFILE);
  });

  it('nettoie les valeurs invalides au lieu de rejeter tout le filtre', () => {
    const v = validateProfileFilters({ competitions: ['AAA', 3, 'x'.repeat(30)], tiers: [1, 9, '2'], teams: ['t1'], nations: ['fra', 'BRA', 'TOOLONG'], feet: ['Left', 'Gauche'], heightMin: 120, heightMax: 999, includeMissing: { foot: true, nation: 'oui' } });
    expect(v.competitions).toEqual(['AAA']);
    expect(v.tiers).toEqual([1]);
    expect(v.teams).toEqual(['t1']);
    expect(v.nations).toEqual(['FRA', 'BRA']);
    expect(v.feet).toEqual(['Left']);
    expect(v.heightMin).toBe(120);
    expect(v.heightMax).toBeNull();
    expect(v.includeMissing).toEqual({ nation: false, foot: true, height: false });
  });
});

describe('puces', () => {
  it('une puce par valeur choisie, avec libellé lisible', () => {
    const chips = profileChips(f({ nations: ['FRA'], feet: ['Left'], heightMin: 180, tiers: [1] }), { competition: k => k, team: k => k });
    expect(chips.map(c => c.label)).toEqual(['Niveau 1', 'France', 'Pied gauche', 'Taille ≥ 180 cm']);
  });
});

describe('nationalités en français', () => {
  it('codes FIFA vers noms français, subdivisions britanniques et cas particuliers', () => {
    expect(nationName('GER')).toBe('Allemagne');
    expect(nationName('ENG')).toBe('Angleterre');
    expect(nationName('SCO')).toBe('Écosse');
    expect(nationName('COD')).toBe('RD Congo');
    expect(nationName('KVX')).toBe('Kosovo');
    expect(nationName('SRI')).toBe('Sri Lanka');
    expect(nationName('ZZZ')).toBe('ZZZ');
  });

  it('raccourcis : UE à 27, puis UE + EEE + Suisse ; le Royaume-Uni n\'y est pas', () => {
    const eu = NATION_GROUPS.find(g => g.id === 'eu')!.codes;
    const eea = NATION_GROUPS.find(g => g.id === 'eea')!.codes;
    expect(eu).toHaveLength(27);
    expect(eea).toHaveLength(31);
    for (const c of ['ENG', 'SCO', 'WAL', 'NIR']) { expect(eu).not.toContain(c); expect(eea).not.toContain(c); }
    expect(eea).toEqual(expect.arrayContaining(['NOR', 'ISL', 'LIE', 'SUI']));
    expect(eu).toContain('IRL');
  });
});
