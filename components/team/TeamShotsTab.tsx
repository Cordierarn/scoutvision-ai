/**
 * ScoutVision - Analyse d'équipe, onglet « Tirs »
 * Tirs pour (vers le but adverse) ou contre (tirs adverses), filtres sur les données existantes
 * (situation, hors penalty, résultat). Les buts contre son camp sont crédités à l'équipe qui en
 * bénéficie et listés à part : jamais dans les xG, les tirs cadrés, la conversion ni la carte.
 * Les tirs ne sont chargés qu'à l'ouverture de l'onglet.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Target, Trophy } from 'lucide-react';
import { PlayerData } from '../../types';
import { useShots } from '../../hooks/useShots';
import {
  DEFAULT_SHOT_FILTERS, ResultFilter, ShotFilters, ShotSide, SituationFilter, filterShots, splitTeamShots, summarizeShots, topScorers,
} from '../../utils/teamShots';
import { situationLabel } from '../../utils/labels';
import { Panel, Stat } from '../ui';
import { PlayerAvatar } from '../Media';
import ShotPitch, { ShotLegend } from '../ShotPitch';
import { teamMemory } from './teamMemory';

const D1 = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const D2 = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const SITUATIONS: SituationFilter[] = ['all', 'OpenPlay', 'FromCorner', 'SetPiece', 'DirectFreekick', 'Penalty'];
const RESULTS: { key: ResultFilter; label: string }[] = [
  { key: 'all', label: 'Tous les résultats' }, { key: 'goal', label: 'Buts' }, { key: 'onTarget', label: 'Cadrés' }, { key: 'offTarget', label: 'Non cadrés ou contrés' },
];

const TeamShotsTab: React.FC<{
  teamName: string;
  season?: string;
  competition?: string;
  teamMatches: number | null;
  players: PlayerData[];
}> = ({ teamName, season, competition, teamMatches, players }) => {
  const { shots, isLoading, error, retry } = useShots(season, competition);
  const [side, setSide] = useState<ShotSide>(teamMemory.shotSide);
  const [filters, setFilters] = useState<ShotFilters>(teamMemory.shotFilters);
  useEffect(() => { teamMemory.shotSide = side; teamMemory.shotFilters = filters; }, [side, filters]);
  const update = (patch: Partial<ShotFilters>) => setFilters(f => ({ ...f, ...patch }));

  const split = useMemo(() => splitTeamShots(shots, teamName), [shots, teamName]);
  const sideShots = side === 'for' ? split.for : split.against;
  const ownGoals = side === 'for' ? split.ownGoalsFor : split.ownGoalsAgainst;
  const shown = useMemo(() => filterShots(sideShots, filters), [sideShots, filters]);
  const summary = useMemo(() => summarizeShots(shown), [shown]);
  const scorers = useMemo(() => topScorers(shown, 8), [shown]);
  const photos = useMemo(() => new Map(players.map(p => [p['Player ID'], p])), [players]);
  const teamOf = useMemo(() => new Map(sideShots.map(s => [s.player_id || s.player, s.team])), [sideShots]);
  const filtered = filters.situation !== 'all' || filters.nonPenalty || filters.result !== 'all';

  return (
    <div className="p-4 sm:p-5 space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="sv-seg" role="group" aria-label="Tirs de l'équipe ou de ses adversaires">
          {(['for', 'against'] as ShotSide[]).map(s => (
            <button key={s} type="button" aria-pressed={side === s} onClick={() => setSide(s)} className={`sv-seg-btn ${side === s ? 'sv-seg-on' : ''}`}>
              {s === 'for' ? 'Pour' : 'Contre'}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-xs text-ink-2">
          <span>Situation</span>
          <select className="sv-select sv-select-sm" value={filters.situation} onChange={e => update({ situation: e.target.value as SituationFilter })}>
            {SITUATIONS.map(s => <option key={s} value={s}>{s === 'all' ? 'Toutes' : situationLabel(s)}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs text-ink-2">
          <span>Résultat</span>
          <select className="sv-select sv-select-sm" value={filters.result} onChange={e => update({ result: e.target.value as ResultFilter })}>
            {RESULTS.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs text-ink-2">
          <input type="checkbox" className="accent-accent" checked={filters.nonPenalty} onChange={e => update({ nonPenalty: e.target.checked })} />
          Hors penalties
        </label>
        {filtered && <button type="button" className="sv-btn sv-btn-ghost sv-btn-sm" onClick={() => setFilters(DEFAULT_SHOT_FILTERS)}>Réinitialiser</button>}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
        <Panel className="xl:col-span-8" title={side === 'for' ? `Tirs de ${teamName}` : `Tirs adverses contre ${teamName}`} icon={Target}
          subtitle={!isLoading && !error && teamMatches !== null && split.matches > 0 && split.matches < teamMatches
            ? `${split.matches} matchs de l'équipe présents dans les données de tirs sur ${teamMatches}.` : undefined}>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-x-3 gap-y-3 mb-4">
            <Stat label="Tirs" value={isLoading ? '…' : summary.shots} />
            <Stat label="xG" value={isLoading ? '…' : D2.format(summary.xG)} />
            <Stat label="npxG" value={isLoading ? '…' : D2.format(summary.npxG)} />
            <Stat label="Buts" value={isLoading ? '…' : summary.goals} />
            <Stat label="Cadrés" value={isLoading ? '…' : summary.onTarget} />
            <Stat label="Conversion" value={isLoading ? '…' : summary.conversion === null ? 'N/D' : `${D1.format(summary.conversion)} %`} />
          </div>
          <p className="text-2xs text-ink-3 -mt-2 mb-3">npxG : xG hors penalties. Buts et conversion : buts sur tirs (buts / tirs), hors buts contre son camp.</p>
          <ShotPitch shots={shown} showPlayer className="max-w-[440px]" loading={isLoading} error={error} onRetry={retry}
            label={side === 'for' ? `Tirs de ${teamName}` : `Tirs adverses contre ${teamName}`}
            emptyText={sideShots.length === 0 ? `Aucune donnée de tir pour ${teamName} dans cette compétition cette saison.` : 'Aucun tir ne correspond aux filtres.'} />
          <div className="mt-2"><ShotLegend /></div>
          {!isLoading && !error && (
            <p className="text-xs text-ink-3 mt-3">
              {ownGoals.length === 0
                ? `Aucun but contre son camp ${side === 'for' ? 'en faveur de l\'équipe' : 'concédé par un joueur de l\'équipe'}.`
                : <>
                  {ownGoals.length} but{ownGoals.length > 1 ? 's' : ''} contre son camp {side === 'for' ? 'en faveur de l\'équipe' : 'concédé' + (ownGoals.length > 1 ? 's' : '') + ' par des joueurs de l\'équipe'}, hors carte et hors statistiques de tir :{' '}
                  {ownGoals.map(o => `${o.player} (${o.team}, ${o.minute}e)`).join(' ; ')}.
                </>}
              {' '}Score {side === 'for' ? 'pour' : 'contre'} : {split[side === 'for' ? 'for' : 'against'].filter(s => s.result === 'Goal').length + ownGoals.length} buts.
            </p>
          )}
        </Panel>

        <Panel className="xl:col-span-4" title={side === 'for' ? 'Meilleurs buteurs' : 'Tireurs adverses'} icon={Trophy} flush>
          <table className="sv-table table-fixed">
            <caption className="sr-only">{side === 'for' ? 'Meilleurs buteurs de l\'équipe' : 'Joueurs adverses ayant tiré contre l\'équipe'}, tirs filtrés</caption>
            <thead>
              <tr><th scope="col" className="pl-4">Joueur</th><th scope="col" className="text-right w-14">Buts</th><th scope="col" className="text-right w-14">xG</th><th scope="col" className="text-right pr-4 w-16">Tirs</th></tr>
            </thead>
            <tbody>
              {scorers.map(s => (
                <tr key={s.id}>
                  <td className="pl-4">
                    <span className="flex items-center gap-2 min-w-0">
                      <PlayerAvatar player={photos.get(s.id)} name={s.name} size="xs" />
                      <span className="min-w-0">
                        <span className="block text-ink text-[13px] truncate">{s.name}</span>
                        {side === 'against' && <span className="block text-2xs text-ink-3 truncate">{teamOf.get(s.id)}</span>}
                      </span>
                    </span>
                  </td>
                  <td className="text-right text-ink font-semibold num">{s.goals}</td>
                  <td className="text-right text-ink-2 num">{D2.format(s.xG)}</td>
                  <td className="text-right text-ink-3 pr-4 num">{s.shots}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!isLoading && scorers.length === 0 && <p className="px-4 py-6 text-center text-xs text-ink-3">Aucun tir.</p>}
        </Panel>
      </div>
    </div>
  );
};

export default TeamShotsTab;
