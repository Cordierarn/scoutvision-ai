/**
 * ScoutVision - Analyse d'équipe, onglet « Style & forces »
 * Les 6 indicateurs du modèle de style (valeur, rang, sens), les résultats de la saison,
 * puis la carte des styles. Le profil de l'effectif est dans « Effectif & profondeur ».
 */

import React, { useMemo } from 'react';
import { Compass, Crosshair } from 'lucide-react';
import { TeamStats } from '../../types';
import { STYLE_METRICS, TEAM_METRICS, TeamMetricRank, teamMetricRanks } from '../../utils/teamMetrics';
import { Panel, PercentileBar, PercentileValue, EmptyState } from '../ui';
import TeamStyleMap from '../TeamStyleMap';

const DEC = [0, 1, 2].map(d => new Intl.NumberFormat('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d }));
export const formatTeamValue = (r: TeamMetricRank) => (r.value === null ? 'N/D' : `${DEC[r.def.decimals].format(r.value)}${r.def.unit === '%' ? ' %' : ''}`);

/** Tableau valeur / rang / sens : une ligne par métrique, N/D quand la donnée manque */
export const TeamMetricTable: React.FC<{ ranks: TeamMetricRank[]; caption: string; leagueName: string }> = ({ ranks, caption, leagueName }) => (
  <table className="sv-table">
    <caption className="sr-only">{caption}</caption>
    <thead>
      <tr>
        <th scope="col" className="pl-4">Indicateur</th>
        <th scope="col" className="text-right">Valeur</th>
        <th scope="col" className="hidden sm:table-cell w-[30%]"><span className="sr-only">Rang en barre</span></th>
        <th scope="col" className="text-right pr-4">Rang</th>
      </tr>
    </thead>
    <tbody>
      {ranks.map(r => (
        <tr key={r.def.key}>
          <th scope="row" className="pl-4 font-normal text-left">
            <span className="block text-[13px] text-ink-2">{r.def.label}</span>
            <span className="block text-2xs text-ink-3 leading-snug">{r.def.sense}</span>
          </th>
          <td className="text-right text-ink num whitespace-nowrap">{formatTeamValue(r)}</td>
          <td className="hidden sm:table-cell">{r.rank !== undefined ? <PercentileBar value={r.rank} /> : <div className="h-1.5 bg-raised rounded-sm" aria-hidden />}</td>
          <td className="text-right pr-4 whitespace-nowrap" title={r.rank !== undefined ? `Rang parmi ${r.teams} équipes de ${leagueName}` : 'Donnée absente : pas de rang'}>
            {r.rank !== undefined ? <PercentileValue value={Math.round(r.rank)} /> : <span className="text-ink-4">N/D</span>}
          </td>
        </tr>
      ))}
    </tbody>
  </table>
);

const OUTCOME_KEYS = ['xG per 90', 'xGA per 90', 'npxG per 90', 'npxGA per 90', 'Shots per 90', 'Shots against per 90', 'Goals per 90', 'Goals against per 90'];

const TeamStyleTab: React.FC<{
  team: TeamStats | null;
  teams: TeamStats[];
  leagueName: string;
  allSeasons: boolean;
}> = ({ team, teams, leagueName, allSeasons }) => {
  const style = useMemo(() => (team ? teamMetricRanks(team, teams, STYLE_METRICS) : []), [team, teams]);
  const outcome = useMemo(() => (team ? teamMetricRanks(team, teams, OUTCOME_KEYS.map(k => TEAM_METRICS.find(m => m.key === k)!)) : []), [team, teams]);

  if (!team) {
    return <div className="p-5"><div className="sv-panel"><EmptyState icon={Compass} title="Aucune statistique d'équipe pour cette compétition.">Le style et les forces viennent des statistiques de saison de l'équipe (team_season).</EmptyState></div></div>;
  }
  const styleMissing = style.every(r => r.value === null);

  return (
    <div className="p-4 sm:p-5 space-y-4">
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <Panel className="xl:col-span-7" title="Style de jeu" icon={Compass} flush
          subtitle={styleMissing
            ? `Pas d'analytics de style pour ${leagueName} cette saison : indicateurs N/D, aucun style calculé.`
            : `Les 6 indicateurs du modèle de style ; rang parmi les équipes de ${leagueName} sur la saison, dans le sens indiqué.`}>
          <TeamMetricTable ranks={style} caption="Indicateurs de style de l'équipe" leagueName={leagueName} />
        </Panel>
        <Panel className="xl:col-span-5" title="Résultats" icon={Crosshair} flush
          subtitle="Occasions, tirs et buts par 90 minutes ; « mieux » = plus créé, moins concédé.">
          <TeamMetricTable ranks={outcome} caption="Résultats de l'équipe" leagueName={leagueName} />
        </Panel>
      </div>

      <TeamStyleMap team={team} teams={teams} allSeasons={allSeasons} />
    </div>
  );
};

export default TeamStyleTab;
