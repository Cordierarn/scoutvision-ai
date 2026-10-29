/**
 * ScoutVision - Recrutement : liste dense des candidats (20 d'abord, plus à la demande)
 */

import React, { useState } from 'react';
import { Scale } from 'lucide-react';
import { Candidate, displayIndex } from '../../utils/recruitment';
import { positionLabel } from '../../utils/labels';
import { isRowActivation } from '../../utils/rowKeys';
import { CompetitionBadge, PlayerAvatar, TeamLine } from '../Media';
import { Delta, InfoTip } from '../ui';
import { CANDIDATE_FLAGS, COMPLEMENT_TIP, EFFICIENT_TIP, GAIN_TIP, SCOUTVISION_ESTIMATE_TIP, formatEuros } from './shared';

export const PAGE_SIZE = 20;

export const candidateKey = (c: Candidate) => c.player['Player ID'] ?? c.player.Player;

export interface CandidateTableProps {
  candidates: Candidate[];
  selectedId?: string;
  onSelect: (id: string) => void;
  incumbentNext?: number;
  hasMarket: boolean;
  hasComplements: boolean;
  partnerName?: string;
  fewMinutes: number;
}

const CandidateTable: React.FC<CandidateTableProps> = ({ candidates, selectedId, onSelect, incumbentNext, hasMarket, hasComplements, partnerName, fewMinutes }) => {
  const [shown, setShown] = useState(PAGE_SIZE);
  // Un candidat choisi ailleurs (nuage) reste visible dans la liste
  const selectedRank = selectedId ? candidates.findIndex(c => candidateKey(c) === selectedId) : -1;
  const visible = candidates.slice(0, Math.max(shown, selectedRank + 1));
  const rest = candidates.length - visible.length;

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="sv-table">
          <caption className="sr-only">Candidats, du meilleur au moins bon selon l'ordre choisi ; Entrée ouvre le dossier</caption>
          <thead>
            <tr>
              <th className="pl-2 sm:pl-3">Joueur</th>
              <th className="text-right hidden sm:table-cell">Âge</th>
              <th className="hidden 2xl:table-cell">Club · championnat</th>
              <th className="text-right max-sm:!pr-2">
                <span className="inline-flex items-center gap-1">Proj. <InfoTip align="end" text="Projection : indice du rôle projeté chez nous la saison prochaine (projection centrale), précédé de l'indice actuel ; sur téléphone, le gain vs titulaire est dessous. Erreur historique : voir le dossier." /></span>
              </th>
              <th className="text-right hidden sm:table-cell">
                <span className="inline-flex items-center gap-1">Gain <InfoTip align="end" text={`Gain projeté vs titulaire. ${GAIN_TIP}`} /></span>
              </th>
              {hasMarket && <th className="text-right hidden sm:table-cell"><span className="inline-flex items-center gap-1">Valeur <InfoTip align="end" text="Valeur de marché Transfermarkt au relevé." /></span></th>}
              {hasMarket && (
                <th className="text-right hidden lg:table-cell">
                  <span className="inline-flex items-center gap-1">Estim. <InfoTip text={`Estimation ScoutVision. ${SCOUTVISION_ESTIMATE_TIP}`} align="end" /></span>
                </th>
              )}
              {hasComplements && (
                <th className="text-right hidden sm:table-cell">
                  <span className="inline-flex items-center gap-1">Compl. <InfoTip align="end" text={`Complémentarité indicative : percentile projeté moyen du candidat sur les points faibles de ${partnerName ?? 'son partenaire'}. ${COMPLEMENT_TIP}`} /></span>
                </th>
              )}
              <th className="pr-3 hidden sm:table-cell">Signaux</th>
            </tr>
          </thead>
          <tbody>
            {visible.map(c => {
              const id = candidateKey(c);
              const selected = id === selectedId;
              const gain = incumbentNext !== undefined ? displayIndex(c.forecast.next) - displayIndex(incumbentNext) : undefined;
              return (
                <tr key={id} data-candidate-row tabIndex={0} aria-current={selected ? 'true' : undefined}
                  aria-label={`${c.player.Player}, ${c.player.Age ?? '?'} ans, ${c.player.Team}, projection ${displayIndex(c.forecast.next)} : afficher le dossier`}
                  className={`cursor-pointer ${selected ? '[&>td]:!bg-raised' : ''}`}
                  onClick={() => onSelect(id)}
                  onKeyDown={e => { if (isRowActivation(e)) { e.preventDefault(); onSelect(id); } }}>
                  <td className="pl-2 sm:pl-3 max-sm:!pr-2 relative !py-1">
                    {selected && <span className="absolute left-0 top-1 bottom-1 w-0.5 rounded-r bg-accent" aria-hidden />}
                    <div className="flex items-center gap-2 min-w-[7rem] max-w-[8.5rem] min-[360px]:max-w-[11rem] sm:max-w-[14rem]">
                      <PlayerAvatar player={c.player} name={c.player.Player} size="xs" />
                      <div className="min-w-0">
                        <div className="text-[13px] leading-tight text-ink font-medium truncate" title={c.player.Player}>
                          {c.player.Player} <span className="text-ink-4 font-normal text-2xs">{positionLabel(c.player.Position)}</span>
                        </div>
                        <div className="2xl:hidden flex items-center gap-1 text-2xs leading-tight text-ink-3 min-w-0">
                          <span className="sm:hidden num shrink-0">{c.player.Age ?? '?'} ans{hasMarket ? ` · ${formatEuros(c.market?.value)}` : ''} ·</span>
                          <span className="truncate" title={c.player.Team}>{c.player.Team}</span>
                          <CompetitionBadge competition={c.player.Competition} showName={false} className="shrink-0 opacity-80" />
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="text-right text-ink-2 num hidden sm:table-cell">{c.player.Age ?? '–'}</td>
                  <td className="hidden 2xl:table-cell"><TeamLine player={c.player} className="text-xs text-ink-2 max-w-[9rem]" /></td>
                  <td className="text-right whitespace-nowrap max-sm:!pr-2 max-sm:!pl-1">
                    <span className="text-2xs text-ink-4 num hidden sm:inline">{displayIndex(c.forecast.now)} → </span>
                    <span className="text-[14px] font-semibold text-ink num">{displayIndex(c.forecast.next)}</span>
                    {gain !== undefined && <span className="sm:hidden block text-2xs leading-tight"><Delta value={gain} /></span>}
                  </td>
                  <td className="text-right hidden sm:table-cell">{gain !== undefined ? <Delta value={gain} /> : <span className="text-ink-4">–</span>}</td>
                  {hasMarket && <td className="text-right text-xs text-ink num whitespace-nowrap hidden sm:table-cell">{formatEuros(c.market?.value)}</td>}
                  {hasMarket && <td className="text-right text-xs text-ink-2 num whitespace-nowrap hidden lg:table-cell">{formatEuros(c.market?.estimated)}</td>}
                  {hasComplements && (
                    <td className="text-right text-xs text-ink-2 num hidden sm:table-cell">{c.complement?.mean !== undefined ? displayIndex(c.complement.mean) : '–'}</td>
                  )}
                  <td className="pr-3 hidden sm:table-cell">
                    <span className="flex flex-wrap items-center gap-1 w-[4.5rem]">
                      {c.efficient && (
                        <span className="text-accent" data-tip={`Efficient valeur-performance. ${EFFICIENT_TIP}`} data-tip-pos="left" role="img" aria-label="Efficient valeur-performance">
                          <Scale className="w-3.5 h-3.5" aria-hidden />
                        </span>
                      )}
                      {c.flags.map(f => {
                        const { icon: Icon, label, title } = CANDIDATE_FLAGS[f];
                        const tip = f === 'fewMinutes' ? `Moins de ${fewMinutes.toLocaleString('fr-FR')} minutes cette saison : percentiles plus instables` : title;
                        return (
                          <span key={f} className={f === 'contract' ? 'text-warn' : 'text-ink-3'} data-tip={`${label}. ${tip}`} data-tip-pos="left" role="img" aria-label={label}>
                            <Icon className="w-3.5 h-3.5" aria-hidden />
                          </span>
                        );
                      })}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rest > 0 && (
        <div className="px-3 py-2 border-t border-line">
          <button type="button" className="sv-btn sv-btn-ghost sv-btn-sm" onClick={() => setShown(visible.length + PAGE_SIZE)}>
            Afficher {Math.min(PAGE_SIZE, rest)} de plus <span className="text-ink-4 num">({rest} restant{rest > 1 ? 's' : ''})</span>
          </button>
        </div>
      )}
    </div>
  );
};

export default React.memo(CandidateTable);
