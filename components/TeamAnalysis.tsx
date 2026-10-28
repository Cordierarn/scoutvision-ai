
import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { PlayerData, TeamStats, getPlayerSeasonId, getPlayerSeason, getSeasonLabel } from '../types';
import { useShots } from '../hooks/useShots';
import TeamStyleMap from './TeamStyleMap';
import SquadLineup from './SquadLineup';
import RecruitmentPanel from './RecruitmentPanel';
import { positionLabel } from '../utils/labels';
import { getAvailableTeams } from '../utils/scoringUtils';
import { Users, Shield, Target, Activity, BarChart3, Trophy, ChevronRight, Search, X, UserSearch } from 'lucide-react';
import { ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, Tooltip } from 'recharts';
import { queryService } from '../services/queryService';
import { dataLoader } from '../services/dataLoader';
import { TeamLogo, CompetitionBadge, PlayerAvatar } from './Media';
import ShotPitch, { ShotLegend } from './ShotPitch';
import { EmptyState, LegendItem, Panel, PercentileLegend, PercentileRow, PercentileValue, PolarTick, Stat } from './ui';
import { BRAND, CONTEXT, polarGridProps, tooltipProps } from '../theme/charts';

interface TeamAnalysisProps {
  playerData: PlayerData[];
  teamStats: TeamStats[];
  onSelectPlayer?: (player: PlayerData) => void;
  initialTab?: Tab;                      // ouverture directe sur un onglet (entrée « Recrutement »)
}

type Tab = 'DEPTH' | 'TACTICS' | 'SHOTMAP' | 'PLAYERS' | 'RECRUIT';

// Équipe et onglet choisis, retrouvés au retour d'une fiche joueur
const lastView = { team: '', search: '', tab: 'DEPTH' as Tab };

/**
 * Équipe dans la liste de recherche : logo, nom et compétition
 */
const TeamOption: React.FC<{ teamKey: string }> = ({ teamKey }) => {
  const info = queryService.getTeamInfo(teamKey);
  return (
    <span className="flex items-center gap-2 min-w-0">
      <TeamLogo src={info.logo} name={info.name} size="xs" />
      <span className="truncate">{info.name}</span>
      <CompetitionBadge competition={info.competition} className="text-2xs text-ink-3" />
    </span>
  );
};

const TeamAnalysis: React.FC<TeamAnalysisProps> = ({ playerData, teamStats, onSelectPlayer, initialTab }) => {
  // Une équipe retenue n'est reprise que si elle existe dans les saisons chargées
  const [activeTab, setActiveTab] = useState<Tab>(initialTab ?? lastView.tab);
  const [selectedLeague, setSelectedLeague] = useState<string>('');
  const [selectedTeam, setSelectedTeam] = useState<string>(() => (queryService.getTeamPlayers(lastView.team).length ? lastView.team : ''));
  const [teamSearchTerm, setTeamSearchTerm] = useState<string>(() => (queryService.getTeamPlayers(lastView.team).length ? lastView.search : ''));
  const [showTeamDropdown, setShowTeamDropdown] = useState<boolean>(false);

  // Derived Lists - Utilisation du queryService pour des listes pré-indexées
  const availableTeams = useMemo(() => {
    return queryService.getAvailableTeams();
  }, []);

  // Filtered teams for search
  const filteredTeams = useMemo(() => {
    // Championnat d'abord, coupes ensuite (ordre d'affichage seulement)
    const isCup = (key: string) => (dataLoader.getCompetition(queryService.getTeamInfo(key).competition)?.type ?? 'league') !== 'league';
    return [...queryService.searchTeams(teamSearchTerm, 15)].sort((a, b) => Number(isCup(a)) - Number(isCup(b)));
  }, [teamSearchTerm]);

  useEffect(() => {
    lastView.team = selectedTeam;
    lastView.search = teamSearchTerm;
    lastView.tab = activeTab;
  }, [selectedTeam, teamSearchTerm, activeTab]);

  const handleTeamSelect = (team: string) => {
    setSelectedTeam(team);
    setTeamSearchTerm(team);
    setShowTeamDropdown(false);
  };


  // --- TAB 2: TEAM TACTICS LOGIC (US-10) ---
  const tacticalProfile = useMemo(() => {
    if (!selectedTeam) return null;
    
    // Utilisation du queryService pour des stats d'équipe rapides
    const teamData = queryService.getTeamStats(selectedTeam);
    
    // Si on a des stats d'équipe, les utiliser
    if (teamData) {
      // Cohorte : les équipes de la même compétition et de la même saison
      const cohort = teamStats.filter(t => t.league === teamData.league);
      
      // Métriques team_season PitchAPI (higher: false = moins c'est mieux)
      const metrics = [
        { key: 'xG per 90', label: 'xG créés', higher: true },
        { key: 'xGA per 90', label: 'xG concédés', higher: false },
        { key: 'Possession, %', label: 'Possession', higher: true },
        { key: 'Pass accuracy, %', label: 'Passes réussies', higher: true },
        { key: 'PPDA', label: 'Pressing (PPDA)', higher: false },
        { key: 'Field tilt', label: 'Domination territoriale', higher: true },
      ];

      return metrics.map(m => {
        const val = Number(teamData[m.key]) || 0;
        const values = cohort.map(c => Number(c[m.key]) || 0).filter(v => v > 0).sort((a, b) => a - b);
        const below = values.filter(v => (m.higher ? v < val : v > val)).length;
        const percentile = values.length > 0 ? Math.round((below / values.length) * 100) : 50;
        return { 
          subject: m.label, 
          A: percentile, 
          val: val,
          fullMark: 100 
        };
      });
    }
    
    // Fallback: calculer depuis les données joueurs
    const teamPlayers = queryService.getTeamPlayers(selectedTeam);
    if (teamPlayers.length === 0) return null;
    
    // Calculer des métriques agrégées depuis les joueurs
    const avgMetrics = {
      'Attaque': teamPlayers.reduce((sum, p) => sum + (Number(p['xG per 90']) || 0), 0) / teamPlayers.length,
      'Création': teamPlayers.reduce((sum, p) => sum + (Number(p['xA per 90']) || 0), 0) / teamPlayers.length,
      'Passe': teamPlayers.reduce((sum, p) => sum + (Number(p['Accurate passes, %']) || 0), 0) / teamPlayers.length,
      'Défense': teamPlayers.reduce((sum, p) => sum + (Number(p['Successful defensive actions per 90']) || 0), 0) / teamPlayers.length,
      'Dribble': teamPlayers.reduce((sum, p) => sum + (Number(p['Successful dribbles, %']) || 0), 0) / teamPlayers.length,
      'Jeu aérien': teamPlayers.reduce((sum, p) => sum + (Number(p['Aerial duels won, %']) || 0), 0) / teamPlayers.length,
    };

    // Calculer les percentiles par rapport à toutes les équipes
    const allTeams = queryService.getAvailableTeams();
    
    return Object.entries(avgMetrics).map(([label, val]) => {
      // Calculer la même métrique pour toutes les équipes (utiliser les stats agrégées du cache)
      const allValues = allTeams.map(team => {
        const stats = queryService.getTeamAggregatedStats(team);
        switch(label) {
          case 'Attaque': return stats.avgXGPer90;
          case 'Création': return stats.avgXAPer90;
          case 'Passe': return stats.avgPassAccuracy;
          case 'Défense': return stats.avgDefensiveActions;
          case 'Dribble': return stats.avgDribbleSuccess;
          case 'Jeu aérien': return stats.avgAerialWon;
          default: return 0;
        }
      }).sort((a, b) => a - b);
      
      const rank = allValues.filter(v => v < val).length;
      const percentile = allValues.length > 0 ? Math.round((rank / allValues.length) * 100) : 50;
      
      return {
        subject: label,
        A: percentile,
        val: val,
        fullMark: 100
      };
    });
  }, [teamStats, selectedTeam, selectedLeague]);

  // Stats de saison de l'équipe sélectionnée (style de jeu, carte des styles)
  const selectedTeamStats = useMemo(
    () => (selectedTeam ? queryService.getTeamStats(selectedTeam) : null), [selectedTeam]);

  // --- TAB 3: SHOT MAP LOGIC (US-11) ---
  // L'équipe sélectionnée donne sa compétition et sa saison : tirs chargés à la demande
  const selectedTeamInfo = useMemo(() => {
      const first = selectedTeam ? queryService.getTeamPlayers(selectedTeam)[0] : undefined;
      return first
        ? { name: first.Team, teamId: first['Team ID'], season: getPlayerSeason(first), competition: first.Competition,
            seasonLabel: /^\d{4}$/.test(String(first.Season ?? '')) ? String(first.Season) : getSeasonLabel(getPlayerSeason(first)) }
        : null;
  }, [selectedTeam]);
  const { shots: competitionShots, isLoading: shotsLoading, error: shotsError, retry: retryShots } = useShots(selectedTeamInfo?.season, selectedTeamInfo?.competition);

  const shotMapData = useMemo(() => {
      if (!selectedTeamInfo) return [];
      return competitionShots.filter(s => s.team === selectedTeamInfo.name);
  }, [competitionShots, selectedTeamInfo]);

  // Stats for shot map
  const shotStats = useMemo(() => {
      const total = shotMapData.length;
      const goals = shotMapData.filter(s => s.result === 'Goal').length;
      const xG = shotMapData.reduce((acc, curr) => acc + (curr.xG || 0), 0);
      const onTarget = shotMapData.filter(s => s.result === 'Goal' || s.result === 'SavedShot').length;
      const blocked = shotMapData.filter(s => s.result === 'BlockedShot').length;
      
      // Top scorers
      const scorerMap = new Map<string, { goals: number; xG: number; shots: number }>();
      shotMapData.forEach(s => {
        const player = s.player || 'Unknown';
        if (!scorerMap.has(player)) {
          scorerMap.set(player, { goals: 0, xG: 0, shots: 0 });
        }
        const stats = scorerMap.get(player)!;
        stats.shots++;
        stats.xG += s.xG || 0;
        if (s.result === 'Goal') stats.goals++;
      });
      
      // Photo des buteurs depuis l'effectif (absente pour les joueurs sous le seuil de minutes)
      const photos = new Map(queryService.getTeamPlayers(selectedTeam).map(p => [p.Player, p.Image]));
      const topScorers = Array.from(scorerMap.entries())
        .map(([name, stats]) => ({ name, image: photos.get(name), ...stats }))
        .sort((a, b) => b.goals - a.goals || b.xG - a.xG)
        .slice(0, 5);
      
      return { total, goals, xG, onTarget, blocked, topScorers };
  }, [shotMapData, selectedTeam]);

  // --- TAB 4: TEAM PLAYERS LIST ---
  const teamPlayerStats = useMemo(() => {
    if (!selectedTeam) return [];
    // selectedTeam est une clé « équipe · compétition saison » (queryService.getTeamKey)
    return queryService.getTeamPlayers(selectedTeam)
      .map(p => ({
        ...p,
        goalsContribution: (Number(p.Goals) || 0) + (Number(p.Assists) || 0),
        minutesPlayed: Number(p['Minutes played']) || 0,
      }))
      .sort((a, b) => b.minutesPlayed - a.minutesPlayed);
  }, [selectedTeam]);


  const TABS: { key: Tab; label: string; icon: React.ElementType }[] = [
    { key: 'DEPTH', label: 'Composition type', icon: Users },
    { key: 'TACTICS', label: 'Profil tactique', icon: Shield },
    { key: 'SHOTMAP', label: 'Carte des tirs', icon: Target },
    { key: 'RECRUIT', label: 'Recrutement', icon: UserSearch },
    { key: 'PLAYERS', label: 'Effectif', icon: BarChart3 },
  ];
  const teamInfo = selectedTeam ? queryService.getTeamInfo(selectedTeam) : null;
  const sum = (key: string) => teamPlayerStats.reduce((s, p) => s + (Number(p[key]) || 0), 0);
  const avgAge = teamPlayerStats.length ? sum('Age') / teamPlayerStats.length : 0;

  return (
    <div className="flex flex-col h-full animate-fade-in">

      {/* ===== En-tête : recherche d'équipe, identité, indicateurs, onglets ===== */}
      <div className="bg-surface border-b border-line px-5 pt-3">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-4" />
            <input
              type="text"
              placeholder={`Rechercher une équipe (${availableTeams.length})`}
              className="sv-input pl-8 pr-8"
              value={teamSearchTerm}
              aria-label="Rechercher une équipe"
              onChange={(e) => {
                setTeamSearchTerm(e.target.value);
                setShowTeamDropdown(true);
                if (!e.target.value) setSelectedTeam('');
              }}
              onFocus={() => setShowTeamDropdown(true)}
              onBlur={() => setTimeout(() => setShowTeamDropdown(false), 150)}
            />
            {selectedTeam && (
              <button onClick={() => { setSelectedTeam(''); setTeamSearchTerm(''); }} className="absolute right-1 top-1/2 -translate-y-1/2 sv-icon-btn !w-6 !h-6" aria-label="Effacer">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
            {showTeamDropdown && filteredTeams.length > 0 && (
              <div className="sv-menu absolute z-50 left-0 right-0 mt-1 max-h-72 overflow-y-auto">
                {filteredTeams.map(team => (
                  <button key={team} onMouseDown={(e) => e.preventDefault()} onClick={() => handleTeamSelect(team)}
                    className={`sv-menu-item flex items-center justify-between ${selectedTeam === team ? '!text-accent' : ''}`}>
                    <TeamOption teamKey={team} />
                    {selectedTeam === team && <ChevronRight className="w-3.5 h-3.5" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          {teamInfo && (
            <div className="flex items-center gap-3 min-w-0">
              <TeamLogo src={teamInfo.logo} name={teamInfo.name} size="md" />
              <div className="min-w-0">
                <div className="text-base font-semibold text-ink truncate">{teamInfo.name}</div>
                <div className="text-2xs text-ink-3 flex items-center gap-1.5">
                  <CompetitionBadge competition={teamInfo.competition} />
                  {selectedTeamInfo && <span>· {selectedTeamInfo.seasonLabel}</span>}
                </div>
              </div>
            </div>
          )}

          {selectedTeam && teamPlayerStats.length > 0 && (
            <div className="flex items-center divide-x divide-line ml-auto">
              <Stat className="px-4" label="Joueurs" value={teamPlayerStats.length} />
              <Stat className="px-4" label="Buts" value={sum('Goals')} />
              <Stat className="px-4" label="Passes déc." value={sum('Assists')} />
              <Stat className="px-4" label="Âge moyen" value={avgAge.toFixed(1)} />
              {selectedTeamStats && typeof selectedTeamStats['xG per 90'] === 'number' && (
                <Stat className="px-4" label="xG / xGA par 90" value={`${(selectedTeamStats['xG per 90'] as number).toFixed(2)} / ${(Number(selectedTeamStats['xGA per 90']) || 0).toFixed(2)}`} />
              )}
            </div>
          )}
        </div>

        <div className="sv-tabs mt-3 border-b-0" role="tablist">
          {TABS.map(t => {
            const disabled = (t.key === 'SHOTMAP' || t.key === 'RECRUIT') && !selectedTeam;
            const Icon = t.icon;
            return (
              <button key={t.key} role="tab" aria-selected={activeTab === t.key} disabled={disabled}
                onClick={() => setActiveTab(t.key)} className={`sv-tab ${activeTab === t.key ? 'sv-tab-on' : ''}`}>
                <Icon className="w-3.5 h-3.5" /> {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ===== Contenu ===== */}
      <div className="flex-1 min-h-0 overflow-auto">
        {!selectedTeam ? (
          <EmptyState icon={Activity} className="h-full" title="Choisissez une équipe">
            Recherchez un club dans le champ en haut à gauche : composition type, profil tactique, tirs, recrutement et effectif.
          </EmptyState>
        ) : (
          <>
            {activeTab === 'DEPTH' && (
              <SquadLineup
                teamId={selectedTeamInfo?.teamId}
                season={selectedTeamInfo?.season}
                competition={selectedTeamInfo?.competition}
                players={selectedTeam ? queryService.getTeamPlayers(selectedTeam) : []}
              />
            )}

            {activeTab === 'TACTICS' && (
              <div className="p-5 space-y-4">
                {tacticalProfile ? (
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                    <Panel className="lg:col-span-5" title="Forces relatives" icon={Shield}
                      subtitle="Percentile parmi les équipes de la compétition (sens « mieux » : moins concédé, PPDA bas = plus de pressing).">
                      <div className="h-[300px] -mx-2">
                        <ResponsiveContainer width="100%" height="100%">
                          <RadarChart cx="50%" cy="50%" outerRadius="68%" data={tacticalProfile.map(d => ({ ...d, median: 50 }))}>
                            <PolarGrid {...polarGridProps} />
                            <PolarAngleAxis dataKey="subject" tick={<PolarTick />} />
                            <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
                            <Radar name="Médiane" dataKey="median" stroke={CONTEXT} strokeDasharray="3 3" strokeWidth={1} fill="none" isAnimationActive={false} />
                            <Radar name={teamInfo?.name ?? selectedTeam} dataKey="A" stroke={BRAND} strokeWidth={2} fill={BRAND} fillOpacity={0.14} isAnimationActive={false} />
                            <Tooltip {...tooltipProps} formatter={(v: number, n: string) => [n === 'Médiane' ? '50' : `P${v}`, n]} />
                          </RadarChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="flex gap-3">
                        <LegendItem color={BRAND} shape="line">{teamInfo?.name}</LegendItem>
                        <LegendItem color={CONTEXT} shape="line">Médiane de la compétition</LegendItem>
                      </div>
                    </Panel>
                    <Panel className="lg:col-span-7" title="ADN tactique" subtitle="Valeur de la saison et rang percentile dans la compétition.">
                      <div className="space-y-1">
                        {tacticalProfile.map(stat => (
                          <PercentileRow key={stat.subject} label={stat.subject} value={stat.val.toFixed(stat.val >= 10 ? 1 : 2)} percentile={stat.A} />
                        ))}
                      </div>
                      <PercentileLegend className="mt-3 pt-3 border-t border-line" />
                    </Panel>
                  </div>
                ) : (
                  <div className="sv-panel">
                    <EmptyState icon={Shield} title="Aucune donnée tactique pour cette équipe.">Les statistiques d'équipe manquent pour cette compétition.</EmptyState>
                  </div>
                )}
                {selectedTeamStats && <TeamStyleMap team={selectedTeamStats} teams={teamStats} />}
              </div>
            )}

            {activeTab === 'SHOTMAP' && (
              <div className="p-5">
                <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
                  <Panel className="xl:col-span-8" title="Carte des tirs" icon={Target}
                    right={
                      <div className="flex gap-5">
                        <Stat label="Tirs" value={shotStats.total} />
                        <Stat label="Buts" value={shotStats.goals} />
                        <Stat label="xG" value={shotStats.xG.toFixed(2)} />
                        <Stat label="Cadrés" value={shotStats.onTarget} />
                        <Stat label="Conversion" value={`${shotStats.total > 0 ? ((shotStats.goals / shotStats.total) * 100).toFixed(1) : 0} %`} />
                      </div>
                    }>
                    <ShotPitch shots={shotMapData} showPlayer className="max-w-[420px]" loading={shotsLoading} error={shotsError} onRetry={retryShots}
                      emptyText={`Aucune donnée de tir pour ${teamInfo?.name ?? selectedTeam} : cette compétition n'a pas de tirs pour cette saison.`} />
                    <div className="mt-2"><ShotLegend /></div>
                  </Panel>
                  <Panel className="xl:col-span-4" title="Meilleurs buteurs" icon={Trophy} flush>
                    <table className="sv-table">
                      <thead>
                        <tr><th className="pl-4">#</th><th>Joueur</th><th className="text-right">Buts</th><th className="text-right">xG</th><th className="text-right pr-4">Tirs</th></tr>
                      </thead>
                      <tbody>
                        {shotStats.topScorers.map((scorer, idx) => (
                          <tr key={scorer.name}>
                            <td className="pl-4 text-ink-4 text-xs">{idx + 1}</td>
                            <td>
                              <span className="flex items-center gap-2">
                                <PlayerAvatar player={{ Image: scorer.image } as unknown as PlayerData} name={scorer.name} size="xs" />
                                <span className="text-ink text-[13px] truncate">{scorer.name}</span>
                              </span>
                            </td>
                            <td className="text-right text-ink font-semibold">{scorer.goals}</td>
                            <td className="text-right text-ink-2">{scorer.xG.toFixed(2)}</td>
                            <td className="text-right text-ink-3 pr-4">{scorer.shots}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {shotStats.topScorers.length === 0 && <EmptyState title="Aucun buteur" />}
                  </Panel>
                </div>
              </div>
            )}

            {activeTab === 'RECRUIT' && (
              <RecruitmentPanel
                key={selectedTeam}
                teamKey={selectedTeam}
                playerData={playerData}
                teamStats={teamStats}
                onSelectPlayer={onSelectPlayer}
              />
            )}

            {activeTab === 'PLAYERS' && (
              <table className="sv-table">
                <thead>
                  <tr>
                    <th className="pl-5">Joueur</th>
                    <th className="text-right">Âge</th>
                    <th>Poste</th>
                    <th className="text-right">Min</th>
                    <th className="text-right">Buts</th>
                    <th className="text-right">PD</th>
                    <th className="text-right">xG</th>
                    <th className="text-right">xA</th>
                    <th className="text-right">Note</th>
                    <th className="text-right pr-5">Valeur</th>
                  </tr>
                </thead>
                <tbody>
                  {teamPlayerStats.map(player => (
                    <tr key={getPlayerSeasonId(player)} className={`group ${onSelectPlayer ? 'cursor-pointer' : ''}`} onClick={() => onSelectPlayer?.(player)}>
                      <td className="pl-5">
                        <span className="flex items-center gap-2.5">
                          <PlayerAvatar player={player} size="sm" />
                          <span className="text-[13px] font-medium text-ink truncate group-hover:text-accent transition-colors">{player.Player || 'Inconnu'}</span>
                        </span>
                      </td>
                      <td className="text-right text-ink-2">{player.Age}</td>
                      <td><span className="sv-tag">{positionLabel(player.Position)}</span></td>
                      <td className="text-right text-ink-3">{player.minutesPlayed.toLocaleString('fr-FR')}</td>
                      <td className="text-right text-ink">{player.Goals || 0}</td>
                      <td className="text-right text-ink">{player.Assists || 0}</td>
                      <td className="text-right text-ink-2">{(Number(player.xG) || 0).toFixed(2)}</td>
                      <td className="text-right text-ink-2">{(Number(player.xA) || 0).toFixed(2)}</td>
                      <td className="text-right">
                        {typeof player['Rating pct'] === 'number' ? <PercentileValue value={player['Rating pct'] as number} className="text-xs" /> : <span className="text-ink-4">–</span>}
                      </td>
                      <td className="text-right text-ink font-medium pr-5">
                        {typeof player['Market value'] === 'number' && player['Market value'] > 0
                          ? `€${(player['Market value'] / 1000000).toFixed(1)}M`
                          : '–'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default TeamAnalysis;
