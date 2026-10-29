/**
 * ScoutVision - page Recrutement : choix de l'équipe, puis besoins par poste et candidats
 * (RecruitmentPanel). État propre, distinct de l'Analyse d'équipe ; l'Analyse d'équipe l'ouvre
 * sur son équipe par openRecruitment.
 */

import React, { useEffect, useState } from 'react';
import { ArrowLeft, UserSearch } from 'lucide-react';
import { PlayerData, TeamStats, ViewState, getPlayerSeason, getSeasonLabel } from '../types';
import { queryService } from '../services/queryService';
import { CompetitionBadge, TeamLogo } from './Media';
import { EmptyState } from './ui';
import TeamSearch from './TeamSearch';
import RecruitmentPanel from './RecruitmentPanel';
import { openTeamAnalysis } from './team/teamMemory';

const recruitmentMemory = { team: '' };

/** Ouvre le Recrutement sur une équipe (clé « équipe · compétition saison ») */
export function openRecruitment(teamKey: string): void {
  recruitmentMemory.team = teamKey;
}

const RecruitmentPage: React.FC<{
  playerData: PlayerData[];
  teamStats: TeamStats[];
  onSelectPlayer?: (player: PlayerData) => void;
  onNavigate?: (view: string) => void;
}> = ({ playerData, teamStats, onSelectPlayer, onNavigate }) => {
  const [team, setTeam] = useState(() => (queryService.getTeamPlayers(recruitmentMemory.team).length ? recruitmentMemory.team : ''));
  useEffect(() => { recruitmentMemory.team = team; }, [team]);
  const info = team ? queryService.getTeamInfo(team) : null;
  const first = team ? queryService.getTeamPlayers(team)[0] : undefined;
  const seasonLabel = first ? (/^\d{4}$/.test(String(first.Season ?? '')) ? String(first.Season) : getSeasonLabel(getPlayerSeason(first))) : '';

  return (
    <div className="animate-fade-in">
      <div className="bg-surface border-b border-line px-4 sm:px-5 py-3">
        <h1 className="sr-only">Recrutement{info ? ` : ${info.name}` : ''}</h1>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <TeamSearch className="w-full sm:w-72" selected={team} onPick={setTeam} label="Rechercher une équipe" />
          {info && (
            <div className="flex items-center gap-3 min-w-[14rem] flex-1">
              <TeamLogo src={info.logo} name={info.name} size="md" />
              <div className="min-w-0">
                <div className="text-base font-semibold text-ink truncate">{info.name}</div>
                <div className="text-2xs text-ink-3 flex items-center gap-1.5">
                  <CompetitionBadge competition={info.competition} />
                  <span>· {seasonLabel}</span>
                </div>
              </div>
            </div>
          )}
          {info && onNavigate && (
            <button type="button" className="sv-btn sv-btn-ghost sv-btn-sm shrink-0" onClick={() => { openTeamAnalysis(team); onNavigate(ViewState.TEAM_ANALYSIS); }}>
              <ArrowLeft className="w-3.5 h-3.5" aria-hidden /> Analyse de l'équipe
            </button>
          )}
        </div>
      </div>
      {!team ? (
        <EmptyState icon={UserSearch} className="py-20" title="Choisissez une équipe">
          Besoins par poste du onze type, profil de l'effectif et joueurs projetés dans l'équipe la saison prochaine.
        </EmptyState>
      ) : (
        <RecruitmentPanel key={team} teamKey={team} playerData={playerData} teamStats={teamStats} onSelectPlayer={onSelectPlayer} onNavigate={onNavigate} />
      )}
    </div>
  );
};

export default RecruitmentPage;
