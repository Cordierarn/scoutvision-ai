/**
 * ScoutVision - Analyse d'équipe, onglet « Onze & formations »
 * Compositions réellement alignées (table lineup de PitchAPI) : formations de la plus à la
 * moins utilisée, onze le plus fréquent placé sur un terrain aux vraies proportions, et pour
 * chaque poste le titulaire, la doublure et la troisième option.
 */

import React, { useMemo, useState } from 'react';
import { Users } from 'lucide-react';
import { PlayerData } from '../../types';
import { TeamLineups } from '../../services/dataLoader';
import { PlacedSlot, placeEleven } from '../../utils/lineup';
import { FormationView, formationPositions, isOutOfPosition, lineupCoverage, orderFormations } from '../../utils/teamLineups';
import { bestPreset } from '../../utils/rolePresets';
import { positionLabel, positionName } from '../../utils/labels';
import { EmptyState, LoadError, Panel, Skeleton } from '../ui';
import { PlayerAvatar } from '../Media';
import { Pitch, pitchPoint, useElementWidth } from '../Pitch';
import { teamMemory } from './teamMemory';

const RANK_LABELS = ['Titulaire', 'Doublure', '3e option'];

/** Formation choisie (mémoire par équipe), sinon la plus utilisée */
export function useFormation(teamKey: string, lineups: TeamLineups | null | undefined): [FormationView[], FormationView | undefined, (name: string) => void] {
  const formations = useMemo(() => orderFormations(lineups), [lineups]);
  const [name, setName] = useState<string | undefined>(teamMemory.formation[teamKey]);
  const formation = formations.find(f => f.formation === name) ?? formations[0];
  const choose = (n: string) => { teamMemory.formation[teamKey] = n; setName(n); };
  return [formations, formation, choose];
}

/** Bandeau des formations : triées par matchs, incomplètes signalées, couverture des compositions */
export const FormationPicker: React.FC<{ formations: FormationView[]; current?: FormationView; onChoose: (name: string) => void; lineups: TeamLineups; teamMatches: number | null }> = ({ formations, current, onChoose, lineups, teamMatches }) => {
  const coverage = lineupCoverage(lineups, teamMatches);
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Formations utilisées">
        {formations.map(f => (
          <button key={f.formation} onClick={() => onChoose(f.formation)} aria-pressed={f === current}
            className={`sv-chip ${f === current ? 'sv-chip-on' : ''}`}>
            {f.formation} <span className="text-ink-3 num">· {f.matches} match{f.matches > 1 ? 's' : ''}</span>
            {f.status !== 'complete' && <span className="text-warn"> · {f.status === 'irregular' ? 'Irrégulière' : 'Incomplète'}</span>}
          </button>
        ))}
      </div>
      <p className="text-2xs text-ink-3 leading-snug">
        {coverage.complete
          ? `Compositions de ${coverage.matchesWithLineups} matchs.`
          : `${coverage.matchesWithLineups} matchs disposant de données de composition sur ${coverage.teamMatches} matchs de l'équipe.`}
        {coverage.shownMatches < coverage.matchesWithLineups && ` Les ${formations.length} formations les plus utilisées couvrent ${coverage.shownMatches} de ces matchs.`}
      </p>
      {current && (
        <p className="text-xs text-ink-2">
          {current === formations[0] ? 'Formation la plus utilisée' : 'Formation'} · {current.formation} · {current.matches} match{current.matches > 1 ? 's' : ''}
          {current.matches < 3 && <span className="text-ink-3"> · tirée de {current.matches === 1 ? 'un seul match' : `${current.matches} matchs`}, pas une composition type</span>}
          {current.invalidSlots > 0 && <span className="text-warn"> · {current.invalidSlots} case{current.invalidSlots > 1 ? 's' : ''} sans position dans les données, non placée{current.invalidSlots > 1 ? 's' : ''}</span>}
          {current.status === 'irregular' && <span className="text-warn"> · {current.slots.length} postes distincts pour une formation à 11</span>}
        </p>
      )}
    </div>
  );
};

/** Carte d'un titulaire sur le terrain : activable (fiche), focus et survol choisissent le poste */
const SlotCard: React.FC<{
  placed: PlacedSlot; data?: PlayerData; slotPosition?: string; compact: boolean; selected: boolean;
  onFocusSlot: () => void; onOpen?: () => void;
}> = ({ placed, data, slotPosition, compact, selected, onFocusSlot, onOpen }) => {
  const starter = placed.starter!;
  const role = data ? bestPreset(data) : null;
  const out = isOutOfPosition(data?.Position, slotPosition);
  const where = slotPosition ? positionLabel(slotPosition) : data ? positionLabel(data.Position) : '';
  const name = compact ? starter.name.split(' ').slice(-1)[0] : starter.name;
  const label = `${starter.name}, ${slotPosition ? positionName(slotPosition) : 'poste'}, ${starter.starts} titularisations${data?.Age !== undefined ? `, ${data.Age} ans` : ''}${role ? `, meilleur rôle ${role.name} ${role.index}` : ''}${out ? ', hors poste' : ''}${data ? '. Ouvrir la fiche' : '. Sans statistiques détaillées'}`;
  return (
    <button type="button" onClick={onOpen} onFocus={onFocusSlot} onMouseEnter={onFocusSlot} aria-label={label} aria-disabled={!onOpen || undefined} title={label}
      className={`w-full text-left bg-surface border rounded-md transition-colors ${selected ? 'border-accent' : 'border-line-strong hover:border-accent/60'} ${compact ? 'px-1 py-1' : 'px-2 py-1.5'} ${onOpen ? '' : 'cursor-default'}`}>
      <span className={`flex items-center ${compact ? 'flex-col gap-0.5' : 'gap-2'}`}>
        <PlayerAvatar player={data} name={starter.name} size={compact ? 'xs' : 'sm'} />
        <span className="min-w-0 flex-1 w-full">
          <span className={`block text-ink font-medium truncate ${compact ? 'text-[10px] text-center leading-tight' : 'text-[13px]'}`}>{name}</span>
          {!compact && (
            <span className="block text-[10px] text-ink-3 truncate">
              <span className="text-ink-2 font-semibold">{where}</span>{role ? ` · ${role.name} ${role.index}` : ''}
            </span>
          )}
          <span className={`flex items-center gap-1.5 text-[10px] text-ink-3 ${compact ? 'justify-center' : ''}`}>
            <span className="num">{starter.starts} tit.</span>
            {!compact && data?.Age !== undefined && <span className="num">{data.Age} ans</span>}
            {out && <span className="text-warn font-semibold">{compact ? '!' : 'Hors poste'}</span>}
          </span>
        </span>
      </span>
    </button>
  );
};

const TeamLineupTab: React.FC<{
  teamKey: string;
  lineups: TeamLineups | null | undefined;
  lineupsError: string | null;
  onRetry: () => void;
  players: PlayerData[];
  teamMatches: number | null;
  onSelectPlayer?: (p: PlayerData) => void;
}> = ({ teamKey, lineups, lineupsError, onRetry, players, teamMatches, onSelectPlayer }) => {
  const [formations, formation, chooseFormation] = useFormation(teamKey, lineups);
  const eleven = useMemo(() => (formation ? placeEleven(formation.slots) : []), [formation]);
  const positions = useMemo(() => (formation ? formationPositions(formation) : null), [formation]);
  const byId = useMemo(() => new Map(players.map(p => [p['Player ID'], p])), [players]);
  const [slotNo, setSlotNo] = useState<number | undefined>(teamMemory.slot[teamKey]);
  const selected = eleven.find(e => e.slot.slot === slotNo) ?? eleven.find(e => e.starter) ?? eleven[0];
  const chooseSlot = (n: number) => { teamMemory.slot[teamKey] = n; setSlotNo(n); };
  const [pitchRef, width] = useElementWidth<HTMLDivElement>();
  const orientation = width >= 600 ? 'horizontal' : 'vertical';
  const compact = orientation === 'vertical' ? width < 520 : width < 760;

  if (lineupsError) return <div className="p-5"><LoadError message="Les compositions n'ont pas pu être chargées." onRetry={onRetry} /></div>;
  if (lineups === undefined) return <div className="p-5" role="status" aria-label="Chargement des compositions"><Skeleton className="h-[480px]" /></div>;
  if (!lineups || formations.length === 0) {
    return <div className="p-5"><div className="sv-panel"><EmptyState icon={Users} title="Aucune composition disponible pour cette équipe dans cette compétition." /></div></div>;
  }

  const open = (p?: PlayerData) => (p && onSelectPlayer ? () => onSelectPlayer(p) : undefined);
  const options = selected ? [...(selected.starter ? [selected.starter] : []), ...selected.backups] : [];

  return (
    <div className="p-4 sm:p-5 space-y-4">
      <FormationPicker formations={formations} current={formation} onChoose={chooseFormation} lineups={lineups} teamMatches={teamMatches} />
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
        <div ref={pitchRef} className="xl:col-span-8 min-w-0">
          {width > 0 && (
            <Pitch orientation={orientation} label={`Onze en ${formation?.formation}`} className={orientation === 'vertical' ? 'max-w-[520px] mx-auto' : ''}>
              {eleven.length === 0 && (
                <div className="absolute inset-0 flex items-center justify-center px-8 text-center text-sm text-ink-3">
                  Aucune case de cette formation n'a de position dans les données : rien n'est placé sur le terrain.
                </div>
              )}
              {eleven.map(e => {
                const { left, top } = pitchPoint(e.slot.x, e.slot.y, orientation);
                const data = e.starter ? byId.get(e.starter.id) : undefined;
                return (
                  <div key={e.slot.slot} className="absolute -translate-x-1/2 -translate-y-1/2 focus-within:z-20 hover:z-20"
                    style={{ left: `${left}%`, top: `${top}%`, width: compact ? (orientation === 'vertical' ? '21%' : '14%') : (orientation === 'vertical' ? '30%' : '18.5%') }}>
                    {e.starter ? (
                      <SlotCard placed={e} data={data} slotPosition={positions?.get(e.slot.slot)} compact={compact}
                        selected={e === selected} onFocusSlot={() => chooseSlot(e.slot.slot)} onOpen={open(data)} />
                    ) : (
                      <button type="button" onFocus={() => chooseSlot(e.slot.slot)} onClick={() => chooseSlot(e.slot.slot)}
                        className="mx-auto block w-9 h-9 rounded-full border-2 border-dashed border-line-strong" aria-label="Poste sans titulaire dans les données" />
                    )}
                  </div>
                );
              })}
            </Pitch>
          )}
          <p className="text-2xs text-ink-3 mt-2 leading-relaxed">
            Poste = place dans la formation ; rôle et indice = meilleur rôle du joueur sur la saison (rôles du Chasseur de pépites). « Hors poste » : poste de la fiche à deux lignes ou plus de la place occupée. Activer une carte ouvre la fiche ; le focus ou le survol affiche le poste ci-contre.
          </p>
        </div>

        <Panel className="xl:col-span-4" title="Poste" icon={Users}
          right={
            <label className="flex items-center gap-2 text-2xs text-ink-3">
              <span className="sr-only">Choisir un poste</span>
              <select className="sv-select sv-select-sm max-w-[13rem]" value={selected?.slot.slot ?? ''} onChange={e => chooseSlot(Number(e.target.value))}>
                {eleven.map(e => (
                  <option key={e.slot.slot} value={e.slot.slot}>
                    {positions?.get(e.slot.slot) ? positionLabel(positions.get(e.slot.slot)) : 'Poste'} · {e.starter?.name ?? 'sans titulaire'}
                  </option>
                ))}
              </select>
            </label>
          }>
          {selected ? (
            <div>
              <p className="text-xs text-ink-2 mb-2">
                {positions?.get(selected.slot.slot) ? positionName(positions.get(selected.slot.slot)) : 'Poste'} en {formation?.formation} · {options.reduce((s, o) => s + o.starts, 0)} titularisations
              </p>
              <ol className="space-y-1.5">
                {options.slice(0, 3).map((o, i) => {
                  const p = byId.get(o.id);
                  return (
                    <li key={o.id} className="flex items-center gap-2.5">
                      <span className="w-[4.5rem] shrink-0 text-2xs text-ink-3">{RANK_LABELS[i]}</span>
                      <PlayerAvatar player={p} name={o.name} size="xs" />
                      <span className="min-w-0 flex-1">
                        {p && onSelectPlayer
                          ? <button type="button" onClick={() => onSelectPlayer(p)} className="block text-left text-[13px] text-ink hover:text-accent truncate max-w-full">{o.name}</button>
                          : <span className="block text-[13px] text-ink-2 truncate">{o.name}</span>}
                        <span className="block text-2xs text-ink-3">{p ? `${p.Age ?? '–'} ans · ${positionLabel(p.Position)}${bestPreset(p) ? ` · ${bestPreset(p)!.name} ${bestPreset(p)!.index}` : ''}` : 'Sous le seuil de minutes : pas de statistiques détaillées'}</span>
                        {p && isOutOfPosition(p.Position, positions?.get(selected.slot.slot)) && <span className="block text-2xs text-warn">Hors poste : {positionName(p.Position).toLowerCase()} aligné {positionName(positions?.get(selected.slot.slot)).toLowerCase()}</span>}
                      </span>
                      <span className="text-xs text-ink-2 num shrink-0">{o.starts} tit.</span>
                    </li>
                  );
                })}
              </ol>
              {options.length < 2 && <p className="text-2xs text-ink-3 mt-2">Aucune doublure : personne d'autre n'a débuté à ce poste dans cette formation.</p>}
              {options.length === 2 && <p className="text-2xs text-ink-3 mt-2">Pas de troisième option dans les compositions de cette formation.</p>}
              {options.length > 3 && <p className="text-2xs text-ink-3 mt-2">{options.length - 3} autre{options.length - 3 > 1 ? 's' : ''} titulaire{options.length - 3 > 1 ? 's' : ''} ponctuel{options.length - 3 > 1 ? 's' : ''} à ce poste.</p>}
            </div>
          ) : <p className="text-xs text-ink-3">Aucun poste placé.</p>}
        </Panel>
      </div>
    </div>
  );
};

export default TeamLineupTab;
