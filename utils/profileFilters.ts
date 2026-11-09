/**
 * ScoutVision - filtres qualitatifs (Base joueurs, Chasseur de pépites)
 *
 * Compétitions, niveaux, clubs (identifiant), nationalités (code FIFA), pied fort et taille. Entre deux
 * champs les critères se cumulent ; dans un champ, les valeurs choisies s'additionnent. Une valeur absente
 * ne correspond jamais : le joueur est écarté et compté, par champ, parmi ceux qui passent les autres
 * critères (« N joueurs sans pied renseigné »), sauf si l'option « inclure les joueurs sans donnée » est
 * cochée pour ce champ (ils sont alors retenus et toujours comptés). Aucune valeur n'est déduite ni inventée.
 */

import { knownNumber } from './playerFilters';
import { nationName } from './nations';

export type Foot = 'Right' | 'Left' | 'Both';
export const FEET: Foot[] = ['Right', 'Left', 'Both'];
export const FOOT_LABELS: Record<Foot, string> = { Right: 'Droit', Left: 'Gauche', Both: 'Les deux' };

/** Champs à couverture incomplète : un compteur « sans donnée » et l'option de les inclure */
export type MissingField = 'nation' | 'foot' | 'height';

export interface ProfileFilters {
  competitions: string[];         // clés Competition
  tiers: number[];                // League tier (1 à 4)
  teams: string[];                // Team ID
  nations: string[];              // Passport country (code FIFA)
  feet: Foot[];
  heightMin: number | null;       // cm
  heightMax: number | null;
  includeMissing: Record<MissingField, boolean>;
}

export const EMPTY_PROFILE: ProfileFilters = {
  competitions: [], tiers: [], teams: [], nations: [], feet: [], heightMin: null, heightMax: null,
  includeMissing: { nation: false, foot: false, height: false },
};

export const HEIGHT_RANGE = { min: 100, max: 250 } as const;

export function isProfileActive(f: ProfileFilters): boolean {
  return f.competitions.length + f.tiers.length + f.teams.length + f.nations.length + f.feet.length > 0 || f.heightMin !== null || f.heightMax !== null;
}

type Row = Record<string, unknown>;
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const footOf = (v: unknown): Foot | null => (v === 'Right' || v === 'Left' || v === 'Both' ? v : null);
const heightOf = (v: unknown): number | null => { const n = knownNumber(v); return n !== null && n > 0 ? n : null; };

export interface ProfileResult<T> { rows: T[]; missing: Record<MissingField, number> }

/**
 * Évaluateur ligne à ligne : null si un critère échoue, sinon la liste des champs incomplets absents
 * (vide : le joueur correspond). Vaut null quand aucun filtre n'est actif. Partagé par
 * applyProfileFilters et le Chasseur de pépites (utils/prospects.ts), qui le combine à ses contraintes.
 */
export function profileCheck(f: ProfileFilters): ((item: unknown) => MissingField[] | null) | null {
  if (!isProfileActive(f)) return null;
  const comps = f.competitions.length ? new Set(f.competitions) : null;
  const tiers = f.tiers.length ? new Set(f.tiers) : null;
  const teams = f.teams.length ? new Set(f.teams) : null;
  const nations = f.nations.length ? new Set(f.nations) : null;
  const feet = f.feet.length ? new Set<Foot>(f.feet) : null;
  const height = f.heightMin !== null || f.heightMax !== null;
  return (item: unknown) => {
    const p = item as Row;
    // Champs toujours renseignés : un échec écarte, une absence aussi (jamais comptée comme correspondance)
    if (comps && !comps.has(text(p.Competition) ?? '')) return null;
    if (tiers && !tiers.has(knownNumber(p['League tier']) ?? -1)) return null;
    if (teams && !teams.has(text(p['Team ID']) ?? '')) return null;
    // Champs incomplets : état « ok », « échec » ou « absent »
    const absent: MissingField[] = [];
    if (nations) {
      const v = text(p['Passport country']);
      if (v === null) absent.push('nation'); else if (!nations.has(v.toUpperCase())) return null;
    }
    if (feet) {
      const v = footOf(p.Foot);
      if (v === null) absent.push('foot'); else if (!feet.has(v)) return null;
    }
    if (height) {
      const v = heightOf(p.Height);
      if (v === null) absent.push('height');
      else if ((f.heightMin !== null && v < f.heightMin) || (f.heightMax !== null && v > f.heightMax)) return null;
    }
    return absent;
  };
}

/** Un joueur sans certaines données passe seulement si l'option inclut chacun de ces champs */
export const retainedDespiteMissing = (absent: MissingField[], include: Record<MissingField, boolean>): boolean =>
  absent.every(k => include[k]);

/** Compteur par champ : joueurs sans cette donnée qui passent tous les autres critères */
export function tallyMissing(missing: Record<MissingField, number>, absent: MissingField[], include: Record<MissingField, boolean>): void {
  for (const k of absent) if (absent.every(o => o === k || include[o])) missing[k]++;
}

/** Joueurs retenus et, par champ, nombre de joueurs écartés faute de donnée */
export function applyProfileFilters<T>(rows: T[], f: ProfileFilters): ProfileResult<T> {
  const missing: Record<MissingField, number> = { nation: 0, foot: 0, height: 0 };
  const check = profileCheck(f);
  if (!check) return { rows, missing };
  const out: T[] = [];
  for (const item of rows) {
    const absent = check(item);
    if (absent === null) continue;
    tallyMissing(missing, absent, f.includeMissing);
    if (retainedDespiteMissing(absent, f.includeMissing)) out.push(item);
  }
  return { rows: out, missing };
}

// ============================================
// PUCES
// ============================================

export interface ProfileChip { key: string; label: string; next: ProfileFilters }

const without = <K extends 'competitions' | 'tiers' | 'teams' | 'nations' | 'feet'>(f: ProfileFilters, k: K, v: ProfileFilters[K][number]): ProfileFilters =>
  ({ ...f, [k]: (f[k] as unknown[]).filter(x => x !== v) });

/** Une puce retirable par valeur choisie, dans l'ordre des champs */
export function profileChips(f: ProfileFilters, names: { competition: (key: string) => string; team: (id: string) => string }): ProfileChip[] {
  const chips: ProfileChip[] = [];
  for (const t of f.tiers) chips.push({ key: `tier-${t}`, label: `Niveau ${t}`, next: without(f, 'tiers', t) });
  for (const c of f.competitions) chips.push({ key: `comp-${c}`, label: names.competition(c), next: without(f, 'competitions', c) });
  for (const t of f.teams) chips.push({ key: `team-${t}`, label: names.team(t), next: without(f, 'teams', t) });
  for (const n of f.nations) chips.push({ key: `nation-${n}`, label: nationName(n), next: without(f, 'nations', n) });
  for (const ft of f.feet) chips.push({ key: `foot-${ft}`, label: ft === 'Both' ? 'Les deux pieds' : `Pied ${FOOT_LABELS[ft].toLowerCase()}`, next: without(f, 'feet', ft) });
  if (f.heightMin !== null || f.heightMax !== null) {
    const fmt = (n: number) => n.toLocaleString('fr-FR');
    const label = f.heightMin !== null && f.heightMax !== null ? `Taille ${fmt(f.heightMin)} – ${fmt(f.heightMax)} cm`
      : f.heightMin !== null ? `Taille ≥ ${fmt(f.heightMin)} cm` : `Taille ≤ ${fmt(f.heightMax as number)} cm`;
    chips.push({ key: 'height', label, next: { ...f, heightMin: null, heightMax: null } });
  }
  return chips;
}

// ============================================
// VALIDATION (filtres enregistrés, liens de partage)
// ============================================

const strList = (v: unknown, re: RegExp, max: number, map: (s: string) => string = s => s): string[] =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string').map(map).filter(x => re.test(x)))].slice(0, max) : [];
const heightBound = (v: unknown): number | null => {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : null;
  return n !== null && n >= HEIGHT_RANGE.min && n <= HEIGHT_RANGE.max ? Math.round(n) : null;
};

/** Filtres qualitatifs validés ; absents ou illisibles : vides (un ancien lien reste valide) */
export function validateProfileFilters(raw: unknown): ProfileFilters {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return EMPTY_PROFILE;
  const r = raw as Record<string, unknown>;
  const inc = typeof r.includeMissing === 'object' && r.includeMissing !== null ? r.includeMissing as Record<string, unknown> : {};
  return {
    competitions: strList(r.competitions, /^[A-Z0-9]{2,10}$/, 100),
    tiers: Array.isArray(r.tiers) ? [...new Set(r.tiers.filter((t): t is number => typeof t === 'number' && Number.isInteger(t) && t >= 1 && t <= 4))] : [],
    teams: strList(r.teams, /^[A-Za-z0-9_-]{1,40}$/, 300),
    nations: strList(r.nations, /^[A-Z]{3}$/, 250, s => s.toUpperCase()),
    feet: Array.isArray(r.feet) ? [...new Set(r.feet.filter((x): x is Foot => FEET.includes(x as Foot)))] : [],
    heightMin: heightBound(r.heightMin),
    heightMax: heightBound(r.heightMax),
    includeMissing: { nation: inc.nation === true, foot: inc.foot === true, height: inc.height === true },
  };
}
