/**
 * ScoutVision - Recrutement : le besoin choisi (poste, formation, titulaire, rôle), ses
 * mesures (indice, projection, rang) et ses signaux, séparés
 */

import React, { useMemo } from 'react';
import { ArrowRight, Target } from 'lucide-react';
import { RolePreset } from '../../utils/rolePresets';
import { Models, RoleForecast, SlotNeed, displayIndex, forecastRole } from '../../utils/recruitment';
import { positionName } from '../../utils/labels';
import { PlayerAvatar } from '../Media';
import { InfoTip, Panel, Stat } from '../ui';
import { FlagChip, NEED_FLAGS, NeedChip, ordinal } from './shared';

export interface NeedSummaryProps {
  need?: SlotNeed;
  position?: string;
  formationName?: string;
  roleOptions: [string, RolePreset][];
  roleName?: string;
  preset?: RolePreset;
  onRole: (name: string) => void;
  incumbent?: RoleForecast;
  models: Models;
  candidateCount: number;
  onShowCandidates: () => void;
  hasContract: boolean;            // la saison porte les contrats (instantané Transfermarkt)
}

const NeedSummary: React.FC<NeedSummaryProps> = ({
  need, position, formationName, roleOptions, roleName, preset, onRole, incumbent, models, candidateCount, onShowCandidates, hasContract,
}) => {
  // Indice actuel du titulaire dans chaque rôle du poste (même calcul que la projection)
  const roleIndices = useMemo(() => new Map(roleOptions.map(([name, p]) => [
    name, need?.starter && need.forecast ? forecastRole(need.starter, p, models)?.now : undefined,
  ])), [roleOptions, need, models]);
  const starter = need?.starter;
  const outOfPosition = need?.flags.includes('outOfPosition');
  const signals = need?.flags.filter(f => f !== 'noStarter' && f !== 'outOfPosition') ?? [];

  return (
    <Panel
      title={<>Besoin · {position ? positionName(position) : '—'}</>}
      icon={Target}
      right={need && <NeedChip level={need.level} />}
    >
      <dl className="grid grid-cols-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,2fr)] gap-x-4 gap-y-2 text-xs">
        <div className="min-w-0">
          <dt className="sv-label">Poste recherché</dt>
          <dd className="text-ink mt-0.5">{position ? positionName(position) : '—'}</dd>
        </div>
        <div className="min-w-0">
          <dt className="sv-label">Formation</dt>
          <dd className="text-ink mt-0.5">{formationName ?? 'Sans composition'}</dd>
        </div>
        <div className="min-w-0 col-span-2 sm:col-span-1">
          <dt className="sv-label">Titulaire</dt>
          <dd className="mt-0.5 flex items-center gap-2 min-w-0">
            {starter ? (
              <>
                <PlayerAvatar player={starter} size="xs" />
                <span className="text-ink truncate" title={starter.Player}>{starter.Player}</span>
                {outOfPosition && <span className="text-2xs text-ink-3 shrink-0">({positionName(starter.Position).toLowerCase()})</span>}
              </>
            ) : need?.placed.starter
              ? <span className="text-ink-3 min-w-0" title="Titulaire le plus fréquent de la case, sous le seuil de minutes des données">{need.placed.starter.name} <span className="text-ink-4">(sous le seuil de minutes)</span></span>
              : <span className="text-ink-4">{need ? 'Aucun joueur régulier' : '—'}</span>}
          </dd>
        </div>
      </dl>

      {roleOptions.length > 0 && (
        <div className="mt-2.5">
          <div className="sv-label mb-1.5">Rôle recherché{need?.forecast && <span className="normal-case tracking-normal font-normal text-ink-4"> · indice actuel du titulaire</span>}</div>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Rôle recherché">
            {roleOptions.map(([name, p]) => {
              const own = roleIndices.get(name);
              return (
                <button key={name} type="button" data-role-chip onClick={() => onRole(name)} title={p.description}
                  className={`sv-chip ${name === roleName ? 'sv-chip-on' : ''}`} aria-pressed={name === roleName}>
                  {name}{own !== undefined && <span className="text-ink-4 num">{displayIndex(own)}</span>}
                </button>
              );
            })}
          </div>
          {preset?.description && <p className="text-xs text-ink-3 mt-1.5">{preset.description}</p>}
        </div>
      )}

      {/* Mesures (scores) et signaux, séparés */}
      <div className="mt-3 pt-3 border-t border-line grid grid-cols-1 sm:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-x-5 gap-y-3">
        <div className="min-w-0">
          <div className="sv-label mb-1.5">Mesures du titulaire{roleName ? ` · ${roleName}` : ''}</div>
          {incumbent ? (
            <div className="grid grid-cols-3 gap-3">
              <Stat label="Actuel" value={displayIndex(incumbent.now)} sub="indice du rôle" wrapSub />
              <Stat label="Projection" value={displayIndex(incumbent.next)} sub="saison prochaine" wrapSub />
              <Stat label={<span className="inline-flex items-center gap-1">Rang <InfoTip align="end" text="Rang de la projection du titulaire parmi les joueurs du championnat éligibles à son meilleur rôle, projetés de la même façon. Il fixe le niveau du besoin." /></span>}
                value={need?.rank !== undefined && roleName === need.presetName ? `${ordinal(need.rank)} pct` : '–'}
                sub={need?.rank !== undefined && roleName === need.presetName ? 'championnat' : 'meilleur rôle seul.'} wrapSub />
            </div>
          ) : (
            <p className="text-xs text-ink-4">
              {outOfPosition && starter
                ? `${starter.Player} est aligné hors poste : ses percentiles sont calculés parmi les ${positionName(starter.Position).toLowerCase()}s, son indice n'est pas comparable. Candidats cherchés au poste de la formation, sans écart avec lui.`
                : need ? 'Besoin non mesurable : aucun joueur de ce poste n\'a 40 % des minutes. Candidats classés par projection, sans écart avec un titulaire.' : 'Pas de titulaire de référence : candidats classés par projection.'}
            </p>
          )}
        </div>
        <div className="min-w-0">
          <div className="sv-label mb-1.5">Signaux</div>
          {signals.length > 0 || outOfPosition ? (
            <div className="flex flex-wrap gap-1.5">
              {outOfPosition && <FlagChip {...NEED_FLAGS.outOfPosition} />}
              {signals.map(f => <FlagChip key={f} {...NEED_FLAGS[f]} tone={f === 'contract' ? 'warn' : 'default'} />)}
            </div>
          ) : <p className="text-xs text-ink-4">{need ? `Aucun : âge, rotation et doublure sans alerte${hasContract ? ', contrat au-delà de 12 mois ou inconnu' : ' (contrat non disponible pour une saison passée)'}.` : '—'}</p>}
        </div>
      </div>

      <button type="button" onClick={onShowCandidates} className="xl:hidden sv-btn sv-btn-primary sv-btn-sm w-full mt-4 justify-center">
        Voir les candidats ({candidateCount}) <ArrowRight className="w-3.5 h-3.5" aria-hidden />
      </button>
    </Panel>
  );
};

export default React.memo(NeedSummary);
