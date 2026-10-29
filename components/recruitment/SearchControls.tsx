/**
 * ScoutVision - Recrutement : contraintes dures (filtres) et préférences (ordre de la liste)
 */

import React from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { LeagueScope, SearchFilters, AGE_RANGE } from '../../utils/recruitment';
import { InfoTip } from '../ui';

export type SortKey = 'next' | 'efficient' | 'age' | 'value';

const SORTS: { key: SortKey; label: string; market?: boolean }[] = [
  { key: 'next', label: 'Projection chez nous' },
  { key: 'age', label: 'Âge' },
  { key: 'value', label: 'Valeur Transfermarkt', market: true },
  { key: 'efficient', label: 'Efficients valeur-performance d\'abord', market: true },
];

const LEAGUE_SCOPES: { key: LeagueScope; label: string; model?: boolean }[] = [
  { key: 'all', label: 'Tous les championnats' },
  { key: 'other', label: 'Autres championnats' },
  { key: 'same', label: 'Notre championnat' },
  { key: 'lower', label: 'Championnats de niveau inférieur', model: true },
];

export const MINUTES_OPTIONS = [0, 450, 900, 1350, 1800, 2400];

export interface SearchControlsProps {
  filters: SearchFilters;
  onFilters: (patch: Partial<SearchFilters>) => void;
  sort: SortKey;
  onSort: (sort: SortKey) => void;
  preferComplement: boolean;
  onPreferComplement: (on: boolean) => void;
  partnerName?: string;
  hasComplements: boolean;
  hasValue: boolean;               // valeurs Transfermarkt pour la saison
  hasContract: boolean;            // contrats pour la saison
  hasTransferModel: boolean;
}

const label = 'sv-label';
const control = 'block mt-1 normal-case tracking-normal font-normal';

const SearchControls: React.FC<SearchControlsProps> = ({
  filters, onFilters, sort, onSort, preferComplement, onPreferComplement, partnerName, hasComplements, hasValue, hasContract, hasTransferModel,
}) => {
  const fullAge = filters.minAge <= AGE_RANGE[0] && filters.maxAge >= AGE_RANGE[1];
  return (
    <section className="sv-panel px-4 py-3 space-y-3" aria-label="Contraintes et préférences">
      <div>
        <div className="flex items-center gap-1.5 mb-1.5">
          <SlidersHorizontal className="w-3.5 h-3.5 text-ink-3" aria-hidden />
          <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-ink">Contraintes</h3>
          <InfoTip text="Filtres éliminatoires, appliqués dans l'ordre de l'entonnoir : poste, minutes, âge, championnats, budget, contrat. Un joueur sans donnée (âge, valeur, contrat) est compté à part." />
        </div>
        <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
          <fieldset className={label}>
            <legend>Âge</legend>
            <span className="flex items-center gap-1 mt-1">
              <input type="number" min={AGE_RANGE[0]} max={AGE_RANGE[1]} value={filters.minAge} name="minAge"
                onChange={e => onFilters({ minAge: Number(e.target.value) || AGE_RANGE[0] })}
                className="sv-input sv-input-sm !w-14" aria-label="Âge minimum" />
              <span className="text-ink-4" aria-hidden>–</span>
              <input type="number" min={AGE_RANGE[0]} max={AGE_RANGE[1]} value={filters.maxAge} name="maxAge"
                onChange={e => onFilters({ maxAge: Number(e.target.value) || AGE_RANGE[1] })}
                className="sv-input sv-input-sm !w-14" aria-label="Âge maximum" />
            </span>
          </fieldset>
          <label className={label}>
            Minutes min.
            <select name="minMinutes" value={filters.minMinutes} onChange={e => onFilters({ minMinutes: Number(e.target.value) })}
              className={`sv-select sv-select-sm ${control}`}>
              {MINUTES_OPTIONS.map(m => <option key={m} value={m}>{m.toLocaleString('fr-FR')}</option>)}
            </select>
          </label>
          <label className={`${label} min-w-0 max-w-full`}>
            Championnats
            <select name="leagues" value={filters.leagues} onChange={e => onFilters({ leagues: e.target.value as LeagueScope })}
              className={`sv-select sv-select-sm ${control} max-w-full`}>
              {LEAGUE_SCOPES.filter(s => !s.model || hasTransferModel).map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </label>
          {hasValue && (
            <label className={label}>
              Budget max (M€)
              <input type="number" min={0} step={0.5} placeholder="sans limite" name="maxValue"
                value={filters.maxValue === undefined ? '' : filters.maxValue / 1e6}
                onChange={e => onFilters({ maxValue: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value)) * 1e6 })}
                className={`sv-input sv-input-sm !w-28 ${control}`} />
            </label>
          )}
          {hasValue && filters.maxValue !== undefined && (
            <label className="flex items-center gap-1.5 text-xs text-ink-2 pb-1.5">
              <input type="checkbox" checked={filters.includeUnknownValue} onChange={e => onFilters({ includeUnknownValue: e.target.checked })} />
              garder les valeurs inconnues
            </label>
          )}
          {hasContract && (
            <label className={label}>
              Contrat
              <select name="contract" value={filters.contractWithinMonths ?? ''}
                onChange={e => onFilters({ contractWithinMonths: e.target.value === '' ? undefined : Number(e.target.value) })}
                className={`sv-select sv-select-sm ${control}`}>
                <option value="">Toutes échéances</option>
                <option value={6}>Fin ≤ 6 mois</option>
                <option value={12}>Fin ≤ 12 mois</option>
                <option value={24}>Fin ≤ 24 mois</option>
              </select>
            </label>
          )}
        </div>
        {(!fullAge || !hasValue) && (
          <p className="text-2xs text-ink-4 mt-1.5">
            {!fullAge && 'Tranche d\'âge restreinte : joueur sans âge connu écarté. '}
            {!hasValue && 'Saison passée : ni budget ni contrat (le relevé Transfermarkt ne décrit que la saison en cours).'}
          </p>
        )}
      </div>

      <div className="pt-3 border-t border-line">
        <div className="flex items-center gap-1.5 mb-1.5">
          <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-ink">Préférences</h3>
          <InfoTip text="Les préférences changent seulement l'ordre de la liste : la sélection reste les meilleures projections sportives, et aucune projection n'est modifiée. La complémentarité est indicative : elle n'entre pas dans la projection sportive et n'est pas couverte par la validation historique du modèle de transfert." />
        </div>
        <div className="flex flex-wrap items-end gap-x-5 gap-y-2">
          <label className={`${label} min-w-0 max-w-full`}>
            Ordre
            <select name="sort" value={sort} onChange={e => onSort(e.target.value as SortKey)} disabled={preferComplement}
              className={`sv-select sv-select-sm ${control} max-w-full disabled:opacity-50`}>
              {SORTS.filter(o => !o.market || hasValue).map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
          </label>
          <label className={`flex items-center gap-2 text-xs pb-1.5 ${hasComplements ? 'text-ink-2 cursor-pointer' : 'text-ink-4'}`}>
            <input type="checkbox" name="preferComplement" checked={preferComplement && hasComplements} disabled={!hasComplements}
              onChange={e => onPreferComplement(e.target.checked)} />
            {hasComplements && partnerName
              ? <>Complémentarité indicative avec {partnerName} : ordonner par elle</>
              : <>Complémentarité indicative : pas de point faible marqué du partenaire de ligne</>}
          </label>
        </div>
      </div>
    </section>
  );
};

export default React.memo(SearchControls);
