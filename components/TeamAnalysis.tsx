
import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { PlayerData, TeamStats, getPlayerSeasonId, getPlayerSeason, getPlayerSeasonTag, getSeasonLabel } from '../types';
import { useShots } from '../hooks/useShots';
import TeamStyleMap from './TeamStyleMap';
import SquadLineup from './SquadLineup';
import RecruitmentPanel from './RecruitmentPanel';
import { positionLabel } from '../utils/labels';
import { teamMetric, teamMetricRanks, teamTotals, TeamMetricDef } from '../utils/teamMetrics';
import { splitTeamShots, summarizeShots, topScorers } from '../utils/teamShots';
import { formatEuro } from '../utils/format';
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

// Équipe et onglet choisis, retrouvés au retour d'une fiche joueur ; un état par page
// (Analyse d'équipe, Recrutement) : un passage par l'une ne change pas l'onglet de l'autre
type ViewMemory = { team: string; search: string; tab: Tab };
const lastViews: Record<'team' | 'recruit', ViewMemory> = {
  team: { team: '', search: '', tab: 'DEPTH' },
  recruit: { team: '', search: '', tab: 'RECRUIT' },
};

// Profil tactique : métriques de team_season, rang par teamRank (source unique, comme le Recrutement)
const TACTICAL_METRICS: TeamMetricDef[] = ['xG per 90', 'xGA per 90', 'Possession, %', 'Pass accuracy, %', 'PPDA', 'Field tilt']
  .map(k => teamMetric(k)!);
const TACTICAL_LABELS: Record<string, string> = {
  'xG per 90': 'xG créés', 'xGA per 90': 'xG concédés', 'Possession, %': 'Possession', 'Pass accuracy, %': 'Passes réussies',
  PPDA: 'Pressing (PPDA)', 'Field tilt': 'Domination territoriale',
};
const DECIMAL = (digits: number) => new Intl.NumberFormat('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const D1 = DECIMAL(1);
const D2 = DECIMAL(2);
const formatDecimals = (v: number, digits: number) => (digits === 2 ? D2 : D1).format(v);

/**
 * Équipe dans la liste de recherche : logo, nom et compétition
 */
const TeamOption: React.FC<{ teamKey: string }> = ({ teamKey }) => {
  const info = queryService.getTeamInfo(teamKey);
  const first = queryService.getTeamPlayers(teamKey)[0];
  return (
    <span className="flex items-center gap-2 min-w-0">
      <TeamLogo src={info.logo} name={info.name} size="xs" />
      <span className="truncate">{info.name}</span>
      <CompetitionBadge competition={info.competition} className="text-2xs text-ink-3" />
      {first && <span className="sv-tag shrink-0">{getPlayerSeasonTag(first)}</span>}
    </span>
  );
};

const TeamAnalysis: React.FC<TeamAnalysisProps> = ({ playerData, teamStats, onSelectPlayer, initialTab }) => {
  // Une équipe retenue n'est reprise que si elle existe dans les saisons chargées
  const lastView = lastViews[initialTab === 'RECRUIT' ? 'recruit' : 'team'];
  const [activeTab, setActiveTab] = useState<Tab>(lastView.tab ?? initialTab);
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


  // --- Profil tactique : valeurs de team_season, rang dans la compétition-saison (teamRank) ---
  // Une valeur absente reste absente (N/D) : ni 0, ni P50
  const tacticalProfile = useMemo(() => {
    const own = selectedTeam ? queryService.getTeamStats(selectedTeam) : null;
    return own ? teamMetricRanks(own, teamStats, TACTICAL_METRICS) : null;
  }, [teamStats, selectedTeam]);

  // « Toutes les saisons » : plusieurs saisons d'application chargées
  const allSeasons = useMemo(() => new Set(playerData.map(getPlayerSeason)).size > 1, [playerData]);

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

  // Tirs pour de l'équipe : les buts contre son camp sont crédités à l'adversaire et comptés à part
  const teamShots = useMemo(
    () => (selectedTeamInfo ? splitTeamShots(competitionShots, selectedTeamInfo.name) : null), [competitionShots, selectedTeamInfo]);
  const shotMapData = teamShots?.for ?? [];

  const shotStats = useMemo(() => {
    const summary = summarizeShots(teamShots?.for ?? [], teamShots?.ownGoalsFor ?? []);
    // Photo des buteurs depuis l'effectif (absente pour les joueurs sous le seuil de minutes)
    const photos = new Map(queryService.getTeamPlayers(selectedTeam).map(p => [p['Player ID'], p.Image]));
    const topScorersList = topScorers(teamShots?.for ?? []).map(s => ({ ...s, image: photos.get(s.id) }));
    return { ...summary, topScorers: topScorersList };
  }, [teamShots, selectedTeam]);

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
  // Totaux de l'équipe (team_season), jamais la somme des joueurs suivis, filtrés par temps de jeu
  const totals = teamTotals(selectedTeamStats);
  const nd = (v: number | null) => (v === null ? 'N/D' : v);
  const xg = selectedTeamStats ? [selectedTeamStats['xG per 90'], selectedTeamStats['xGA per 90']] : [];

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

          {selectedTeam && (
            <div className="flex items-center divide-x divide-line ml-auto">
              <Stat className="px-4" label="Matchs" value={nd(totals.matches)} />
              <Stat className="px-4" label="Buts" value={nd(totals.goalsFor)} title="Buts de l'équipe sur la saison (statistiques d'équipe)" />
              <Stat className="px-4" label="Encaissés" value={nd(totals.goalsAgainst)} />
              <Stat className="px-4" label="xG / xGA par 90" value={xg.map(v => (typeof v === 'number' && Number.isFinite(v) ? D2.format(v) : 'N/D')).join(' / ') || 'N/D'} />
              <Stat className="px-4" label="Joueurs suivis" value={teamPlayerStats.length}
                title="Joueurs au-dessus du seuil de minutes du pipeline : pas l'effectif complet" />
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
                teamMatches={totals.matches}
              />
            )}

            {activeTab === 'TACTICS' && (
              <div className="p-5 space-y-4">
                {tacticalProfile ? (() => {
                  const ranked = tacticalProfile.filter(m => m.rank !== undefined);
                  const radar = ranked.map(m => ({ subject: TACTICAL_LABELS[m.def.key], A: Math.round(m.rank as number), median: 50 }));
                  const missing = tacticalProfile.length - ranked.length;
                  return (
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                    <Panel className="lg:col-span-5" title="Forces relatives" icon={Shield}
                      subtitle="Rang parmi les équipes de la compétition sur la saison (sens « mieux » : moins concédé, PPDA bas = plus de pressing).">
                      {radar.length >= 3 ? (
                      <div className="h-[300px] -mx-2">
                        <ResponsiveContainer width="100%" height="100%">
                          <RadarChart cx="50%" cy="50%" outerRadius="68%" data={radar}>
                            <PolarGrid {...polarGridProps} />
                            <PolarAngleAxis dataKey="subject" tick={<PolarTick />} />
                            <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
                            <Radar name="Médiane" dataKey="median" stroke={CONTEXT} strokeDasharray="3 3" strokeWidth={1} fill="none" isAnimationActive={false} />
                            <Radar name={teamInfo?.name ?? selectedTeam} dataKey="A" stroke={BRAND} strokeWidth={2} fill={BRAND} fillOpacity={0.14} isAnimationActive={false} />
                            <Tooltip {...tooltipProps} formatter={(v: number, n: string) => [n === 'Médiane' ? '50' : `P${v}`, n]} />
                          </RadarChart>
                        </ResponsiveContainer>
                      </div>
                      ) : (
                        <EmptyState title="Pas assez de métriques renseignées pour un radar." />
                      )}
                      <div className="flex gap-3">
                        <LegendItem color={BRAND} shape="line">{teamInfo?.name}</LegendItem>
                        <LegendItem color={CONTEXT} shape="line">Médiane de la compétition</LegendItem>
                      </div>
                      {missing > 0 && <p className="text-2xs text-ink-3 mt-2">{missing} métrique{missing > 1 ? 's' : ''} absente{missing > 1 ? 's' : ''} des données de la compétition (N/D) : hors du radar, sans rang.</p>}
                    </Panel>
                    <Panel className="lg:col-span-7" title="ADN tactique" subtitle="Valeur de la saison et rang percentile dans la compétition.">
                      <div className="space-y-1">
                        {tacticalProfile.map(m => (
                          <PercentileRow key={m.def.key} label={TACTICAL_LABELS[m.def.key]} title={`${m.def.sense} · rang sur ${m.teams} équipes`}
                            value={m.value === null ? 'N/D' : formatDecimals(m.value, m.def.decimals)} percentile={m.rank === undefined ? undefined : Math.round(m.rank)} />
                        ))}
                      </div>
                      <PercentileLegend className="mt-3 pt-3 border-t border-line" />
                    </Panel>
                  </div>
                  );
                })() : (
                  <div className="sv-panel">
                    <EmptyState icon={Shield} title="Aucune donnée tactique pour cette équipe.">Les statistiques d'équipe manquent pour cette compétition.</EmptyState>
                  </div>
                )}
                {selectedTeamStats && <TeamStyleMap team={selectedTeamStats} teams={teamStats} allSeasons={allSeasons} />}
              </div>
            )}

            {activeTab === 'SHOTMAP' && (
              <div className="p-5">
                <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
                  <Panel className="xl:col-span-8" title="Carte des tirs" icon={Target}
                    right={
                      <div className="flex gap-5">
                        <Stat label="Tirs" value={shotStats.shots} />
                        <Stat label="Buts" value={shotStats.totalGoals}
                          sub={shotStats.ownGoals > 0 ? `dont ${shotStats.ownGoals} c.s.c.` : undefined}
                          title="Buts sur tirs, plus les buts contre son camp adverses (crédités à l'équipe)" />
                        <Stat label="xG" value={D2.format(shotStats.xG)} />
                        <Stat label="Cadrés" value={shotStats.onTarget} />
                        <Stat label="Conversion" value={shotStats.conversion === null ? 'N/D' : `${D1.format(shotStats.conversion)} %`}
                          title="Buts sur tirs / tirs, hors buts contre son camp" />
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
                          <tr key={scorer.id}>
                            <td className="pl-4 text-ink-4 text-xs">{idx + 1}</td>
                            <td>
                              <span className="flex items-center gap-2">
                                <PlayerAvatar player={{ Image: scorer.image } as unknown as PlayerData} name={scorer.name} size="xs" />
                                <span className="text-ink text-[13px] truncate">{scorer.name}</span>
                              </span>
                            </td>
                            <td className="text-right text-ink font-semibold">{scorer.goals}</td>
                            <td className="text-right text-ink-2">{D2.format(scorer.xG)}</td>
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
                      <td className="text-right text-ink-2">{typeof player.xG === 'number' ? D2.format(player.xG) : '–'}</td>
                      <td className="text-right text-ink-2">{typeof player.xA === 'number' ? D2.format(player.xA) : '–'}</td>
                      <td className="text-right">
                        {typeof player['Rating pct'] === 'number' ? <PercentileValue value={player['Rating pct'] as number} className="text-xs" /> : <span className="text-ink-4">–</span>}
                      </td>
                      <td className="text-right text-ink font-medium pr-5">
                        {typeof player['Market value'] === 'number' && player['Market value'] > 0 ? formatEuro(player['Market value']) : '–'}
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
