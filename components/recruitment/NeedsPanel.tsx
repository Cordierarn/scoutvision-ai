/**
 * ScoutVision - Recrutement, étape 1 : besoins par poste du onze type (liste à choisir)
 */

import React from 'react';
import { Users } from 'lucide-react';
import { SlotNeed, displayIndex } from '../../utils/recruitment';
import { FormationView, isExploitableFormation } from '../../utils/teamLineups';
import { positionLabel, positionName } from '../../utils/labels';
import { PlayerAvatar } from '../Media';
import { InfoTip, Panel } from '../ui';
import { NEED_FLAGS, NeedChip, Note, ordinal } from './shared';

export const MANUAL_POSITIONS = ['GK', 'CB', 'FB', 'DM', 'CM', 'AM', 'W', 'ST'];

const NeedRow: React.FC<{ need: SlotNeed; selected: boolean; onSelect: () => void }> = ({ need, selected, onSelect }) => {
  const name = need.starter?.Player ?? need.placed.starter?.name ?? '—';
  const flags = need.flags.filter(f => f !== 'noStarter');
  return (
    <button
      type="button"
      data-need-row
      onClick={onSelect}
      aria-pressed={selected}
      className={`relative w-full text-left grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[5.75rem_2.25rem_minmax(0,1fr)_auto] items-center gap-2 px-2 py-1 rounded-md transition-colors ${selected ? 'bg-raised' : 'hover:bg-raised/60'}`}
    >
      {selected && <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r bg-accent" aria-hidden />}
      <span className="hidden sm:block"><NeedChip level={need.level} /></span>
      <span className="hidden sm:flex sv-tag justify-center">{positionLabel(need.position)}</span>
      <span className="flex items-center gap-2 min-w-0">
        <PlayerAvatar player={need.starter} name={name} size="xs" />
        <span className="min-w-0">
          <span className="sm:hidden flex items-center gap-1.5 mb-0.5"><NeedChip level={need.level} /><span className="sv-tag">{positionLabel(need.position)}</span></span>
          <span className="block text-[13px] leading-tight text-ink font-medium truncate" title={name}>{name}</span>
          <span className="block text-2xs leading-tight text-ink-3 truncate">
            {need.presetName ?? positionName(need.position)}
            {need.flags.includes('noStarter') && ' · aucun joueur régulier'}
            {flags.length > 0 && ` · ${flags.map(f => NEED_FLAGS[f].label).join(' · ')}`}
          </span>
        </span>
      </span>
      <span className="text-right whitespace-nowrap">
        {need.forecast ? (
          <>
            <span className="block text-[13px] leading-tight text-ink num"><span className="text-ink-3">{displayIndex(need.forecast.now)} →</span> <span className="font-semibold">{displayIndex(need.forecast.next)}</span></span>
            <span className="block text-2xs leading-tight text-ink-3 num">rang {ordinal(need.rank ?? 50)} pct</span>
          </>
        ) : <span className="text-2xs text-ink-4">non mesurable</span>}
      </span>
    </button>
  );
};

export interface NeedsPanelProps {
  needs: SlotNeed[];
  order: number[];
  selectedIndex: number | undefined;
  onSelectNeed: (slot: number) => void;
  formations: FormationView[];
  formation?: FormationView;
  onChooseFormation: (name: string) => void;
  fallbackFrom?: FormationView;
  mislabelledKeepers: number;
  leagueName: string;
  manualPosition: string;
  onManualPosition: (position: string) => void;
}

/**
 * Liste des besoins : niveau (avec icône), poste, titulaire de référence, indice actuel →
 * projeté et rang. Sans composition exploitable : choix manuel du poste.
 */
const NeedsPanel: React.FC<NeedsPanelProps> = ({
  needs, order, selectedIndex, onSelectNeed, formations, formation, onChooseFormation, fallbackFrom, mislabelledKeepers,
  leagueName, manualPosition, onManualPosition,
}) => (
  <Panel
    title={<span className="inline-flex items-center gap-1.5">Besoins par poste <InfoTip text="Prioritaire : titulaire projeté dans les 40 % les plus faibles du championnat. À renforcer : entre 40 et 65 %, ou titulaire plus solide mais en fin de contrat, en déclin lié à l'âge, ou poste en rotation. Solide : au-delà. À évaluer : besoin non mesurable (aucun joueur régulier, ou titulaire aligné hors poste)." /></span>}
    icon={Users}
    subtitle={formation
      ? `Onze type en ${formation.formation} (${formation.matches} matchs) : titulaire dans son meilleur rôle, indice actuel → projeté et rang dans le championnat.`
      : 'Aucune composition disponible pour cette équipe : choisissez le poste à pourvoir.'}
    right={formations.length > 1 && (
      <div className="sv-seg flex-wrap" role="group" aria-label="Formation analysée">
        {formations.map(f => {
          const usable = isExploitableFormation(f);
          const on = f === formation;
          return (
            <button key={f.formation} type="button" onClick={() => onChooseFormation(f.formation)} disabled={!usable} aria-pressed={on}
              title={usable ? `${f.formation} · ${f.matches} matchs` : `Formation insuffisamment renseignée : ${f.slots.length} case${f.slots.length > 1 ? 's' : ''} placée${f.slots.length > 1 ? 's' : ''} sur 11`}
              className={`sv-seg-btn ${on ? 'sv-seg-on' : ''} ${usable ? '' : 'opacity-50 cursor-not-allowed'}`}>
              {f.formation} <span className="text-ink-4 num">{f.matches}</span>
            </button>
          );
        })}
      </div>
    )}
  >
    {(mislabelledKeepers >= 2 || fallbackFrom) && (
      <div className="space-y-1.5 mb-2.5">
        {mislabelledKeepers >= 2 && (
          <Note tone="warn">
            Postes incohérents dans les données : {mislabelledKeepers} titulaires de champ sont enregistrés gardiens dans {leagueName} cette
            saison. Leurs percentiles sont calculés parmi les gardiens : leurs besoins ne sont pas mesurables. Les candidats restent
            cherchés au poste de la formation.
          </Note>
        )}
        {fallbackFrom && formation && (
          <Note>
            <span className="inline-flex items-center gap-1 flex-wrap">
              Formation {fallbackFrom.formation} insuffisamment renseignée. Analyse des besoins basée sur {formation.formation}.
              <InfoTip text={`La formation la plus utilisée (${fallbackFrom.formation}, ${fallbackFrom.matches} matchs) n'a que ${fallbackFrom.slots.length} case${fallbackFrom.slots.length > 1 ? 's' : ''} placée${fallbackFrom.slots.length > 1 ? 's' : ''} sur 11 dans les compositions : aucun besoin n'y est mesurable. Le Recrutement retient la formation la plus utilisée qui donne un onze exploitable.`} />
            </span>
          </Note>
        )}
      </div>
    )}
    {needs.length > 0 ? (
      <div className="-mx-1.5 grid grid-cols-1 xl:grid-cols-2 gap-x-2 gap-y-px">
        {order.map(i => (
          <NeedRow key={needs[i].placed.slot.slot} need={needs[i]} selected={i === selectedIndex} onSelect={() => onSelectNeed(needs[i].placed.slot.slot)} />
        ))}
      </div>
    ) : (
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Poste à pourvoir">
        {MANUAL_POSITIONS.map(pos => (
          <button key={pos} type="button" onClick={() => onManualPosition(pos)} aria-pressed={manualPosition === pos}
            className={`sv-chip ${manualPosition === pos ? 'sv-chip-on' : ''}`}>
            {positionName(pos)}
          </button>
        ))}
      </div>
    )}
  </Panel>
);

export default React.memo(NeedsPanel);
