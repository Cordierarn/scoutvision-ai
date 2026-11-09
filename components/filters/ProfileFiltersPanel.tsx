/**
 * ScoutVision - filtres qualitatifs (compétition, niveau, club, nationalité, pied fort, taille)
 *
 * Partagé par la Base joueurs et le Chasseur de pépites. Les options viennent des joueurs chargés
 * (clubs de la saison chargée, nationalités présentes) ; la logique de filtrage est dans
 * utils/profileFilters.ts. Sous chaque champ incomplet : nombre de joueurs écartés faute de donnée et
 * option pour les inclure.
 */

import React, { useId, useMemo } from 'react';
import type { PlayerData } from '../../types';
import { dataLoader } from '../../services/dataLoader';
import { nationName, NATION_GROUPS, NATION_GROUPS_NOTE } from '../../utils/nations';
import { FEET, FOOT_LABELS, HEIGHT_RANGE, MissingField, ProfileFilters } from '../../utils/profileFilters';
import { ComboOption, MultiCombobox } from '../ui/MultiCombobox';

const nf = new Intl.NumberFormat('fr-FR');

export interface ProfileOptions {
  competitions: ComboOption[];
  tiers: number[];
  teams: ComboOption[];
  nations: ComboOption[];
  competitionName: (key: string) => string;
  teamName: (id: string) => string;
}

/** Options des filtres, tirées des joueurs chargés */
export function useProfileOptions(data: PlayerData[]): ProfileOptions {
  return useMemo(() => {
    const comps = new Map<string, number>();
    const teams = new Map<string, { name: string; comp: string; league: boolean }>();
    const nations = new Set<string>();
    const tiers = new Set<number>();
    for (const p of data) {
      if (p.Competition) comps.set(p.Competition, Number(p['League tier']) || 0);
      const tier = Number(p['League tier']);
      if (Number.isInteger(tier) && tier >= 1) tiers.add(tier);
      const id = p['Team ID'];
      if (id && p.Team) {
        const league = dataLoader.getCompetition(p.Competition)?.type === 'league';
        const prev = teams.get(id);
        if (!prev || (!prev.league && league)) teams.set(id, { name: p.Team, comp: p.Competition ?? '', league });
      }
      const n = p['Passport country'];
      if (typeof n === 'string' && n.trim()) nations.add(n.trim().toUpperCase());
    }
    // Compétitions : nom de l'index ; pays ajouté quand deux compétitions portent le même nom
    const rawName = (k: string) => dataLoader.getCompetition(k)?.name ?? k;
    const counts = new Map<string, number>();
    for (const k of comps.keys()) counts.set(rawName(k), (counts.get(rawName(k)) ?? 0) + 1);
    const competitionName = (k: string) => {
      const info = dataLoader.getCompetition(k);
      const name = rawName(k);
      return (counts.get(name) ?? 0) > 1 && info?.country ? `${name} (${nationName(info.country)})` : name;
    };
    const competitions = [...comps.entries()]
      .sort((a, b) => a[1] - b[1] || competitionName(a[0]).localeCompare(competitionName(b[0]), 'fr'))
      .map(([k, tier]) => ({ value: k, label: competitionName(k), hint: tier ? `niveau ${tier}` : undefined }));
    const teamOptions = [...teams.entries()]
      .map(([id, t]) => ({ value: id, label: t.name, hint: competitionName(t.comp) }))
      .sort((a, b) => a.label.localeCompare(b.label, 'fr'));
    const teamNames = new Map(teamOptions.map(t => [t.value, t.label]));
    const nationOptions = [...nations].map(c => ({ value: c, label: nationName(c) })).sort((a, b) => a.label.localeCompare(b.label, 'fr'));
    return {
      competitions, tiers: [...tiers].sort(), teams: teamOptions, nations: nationOptions, competitionName,
      teamName: (id: string) => teamNames.get(id) ?? 'Club absent de cette saison',
    };
  }, [data]);
}

const MISSING_TEXT: Record<MissingField, string> = { nation: 'sans nationalité renseignée', foot: 'sans pied renseigné', height: 'sans taille renseignée' };

const MissingNote: React.FC<{ field: MissingField; count: number; value: ProfileFilters; onChange: (v: ProfileFilters) => void }> = ({ field, count, value, onChange }) => {
  if (count === 0 && !value.includeMissing[field]) return null;
  return (
    <label className="flex items-center gap-1.5 mt-1 text-2xs text-ink-3 cursor-pointer">
      <input type="checkbox" checked={value.includeMissing[field]}
        onChange={e => onChange({ ...value, includeMissing: { ...value.includeMissing, [field]: e.target.checked } })} />
      <span><span className="num text-ink-2">{nf.format(count)}</span> joueur{count > 1 ? 's' : ''} {MISSING_TEXT[field]} : {value.includeMissing[field] ? 'inclus' : 'inclure'}</span>
    </label>
  );
};

export const ProfileFiltersPanel: React.FC<{
  value: ProfileFilters;
  onChange: (v: ProfileFilters) => void;
  options: ProfileOptions;
  missing: Record<MissingField, number>;
}> = ({ value, onChange, options, missing }) => {
  const uid = useId();
  const bound = (s: string): number | null => {
    if (s.trim() === '') return null;
    const n = Number(s);
    return Number.isFinite(n) && n >= HEIGHT_RANGE.min && n <= HEIGHT_RANGE.max ? Math.round(n) : null;
  };
  const toggleIn = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter(x => x !== v) : [...list, v]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-x-4 gap-y-3">
      <MultiCombobox label="Compétitions" placeholder="Rechercher une compétition" options={options.competitions}
        selected={value.competitions} onChange={competitions => onChange({ ...value, competitions })} missingLabel={k => k} />

      <fieldset>
        <legend className="sv-label mb-1">Niveau</legend>
        <div className="flex flex-wrap gap-1">
          {options.tiers.map(t => (
            <button key={t} type="button" aria-pressed={value.tiers.includes(t)} onClick={() => onChange({ ...value, tiers: toggleIn(value.tiers, t) })}
              className={`sv-chip !h-7 ${value.tiers.includes(t) ? 'sv-chip-on' : ''}`}>Niveau {t}</button>
          ))}
        </div>
      </fieldset>

      <MultiCombobox label="Clubs (saison chargée)" placeholder="Rechercher un club" options={options.teams}
        selected={value.teams} onChange={teams => onChange({ ...value, teams })} missingLabel={() => 'Club absent de cette saison'} />

      <div>
        <MultiCombobox label="Nationalités" placeholder="Rechercher un pays" options={options.nations}
          selected={value.nations} onChange={nations => onChange({ ...value, nations })}
          shortcuts={NATION_GROUPS.map(g => ({ label: g.label, values: g.codes }))} shortcutsNote={NATION_GROUPS_NOTE} />
        {value.nations.length > 0 && <MissingNote field="nation" count={missing.nation} value={value} onChange={onChange} />}
      </div>

      <fieldset>
        <legend className="sv-label mb-1">Pied fort</legend>
        <div className="flex flex-wrap gap-1">
          {FEET.map(ft => (
            <button key={ft} type="button" aria-pressed={value.feet.includes(ft)} onClick={() => onChange({ ...value, feet: toggleIn(value.feet, ft) })}
              className={`sv-chip !h-7 ${value.feet.includes(ft) ? 'sv-chip-on' : ''}`}>{FOOT_LABELS[ft]}</button>
          ))}
        </div>
        {value.feet.length > 0 && <MissingNote field="foot" count={missing.foot} value={value} onChange={onChange} />}
      </fieldset>

      <fieldset>
        <legend className="sv-label mb-1">Taille (cm)</legend>
        <div className="flex items-center gap-1.5">
          <label htmlFor={`${uid}-hmin`} className="sr-only">Taille minimum en centimètres</label>
          <input id={`${uid}-hmin`} type="number" inputMode="numeric" min={HEIGHT_RANGE.min} max={HEIGHT_RANGE.max} placeholder="Min"
            className="sv-input sv-input-sm !w-20" value={value.heightMin ?? ''} onChange={e => onChange({ ...value, heightMin: bound(e.target.value) })} />
          <span className="text-ink-4 text-xs" aria-hidden>–</span>
          <label htmlFor={`${uid}-hmax`} className="sr-only">Taille maximum en centimètres</label>
          <input id={`${uid}-hmax`} type="number" inputMode="numeric" min={HEIGHT_RANGE.min} max={HEIGHT_RANGE.max} placeholder="Max"
            className="sv-input sv-input-sm !w-20" value={value.heightMax ?? ''} onChange={e => onChange({ ...value, heightMax: bound(e.target.value) })} />
        </div>
        {(value.heightMin !== null || value.heightMax !== null) && <MissingNote field="height" count={missing.height} value={value} onChange={onChange} />}
      </fieldset>
    </div>
  );
};

export default ProfileFiltersPanel;
