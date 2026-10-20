
import React, { useState, useMemo, useCallback } from 'react';
import { PlayerData, TeamStats, extractSeason, getSeasonColor, getPlayerSeasonId, getPlayerSeason, getSeasonShortLabel } from '../types';
import { useShots } from '../hooks/useShots';
import TeamStyleMap from './TeamStyleMap';
import SquadLineup from './SquadLineup';
import { roleLabel, positionLabel, shotResultLabel, shotTypeLabel, situationLabel } from '../utils/labels';
import { getAvailableTeams } from '../utils/scoringUtils';
import { Filter, Users, Shield, Target, Activity, LayoutTemplate, MapPin, BarChart3, TrendingUp, Trophy, ChevronRight, Search, X } from 'lucide-react';
import { ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid, ReferenceLine, ScatterChart, Scatter, ZAxis, Cell } from 'recharts';
import { queryService } from '../services/queryService';
import { PhotoOverlay, TeamLine, TeamLogo, CompetitionBadge, CountryFlag } from './Media';

interface TeamAnalysisProps {
  playerData: PlayerData[];
  teamStats: TeamStats[];
}

type Tab = 'DEPTH' | 'TACTICS' | 'SHOTMAP' | 'PLAYERS';

/**
 * Équipe dans la liste de recherche : logo, nom et compétition
 */
const TeamOption: React.FC<{ teamKey: string }> = ({ teamKey }) => {
  const info = queryService.getTeamInfo(teamKey);
  return (
    <span className="flex items-center gap-2 min-w-0">
      <TeamLogo src={info.logo} name={info.name} size="xs" />
      <span className="truncate">{info.name}</span>
      <CompetitionBadge competition={info.competition} className="text-[11px] text-slate-500" />
    </span>
  );
};

const TeamAnalysis: React.FC<TeamAnalysisProps> = ({ playerData, teamStats }) => {
  const [activeTab, setActiveTab] = useState<Tab>('DEPTH');
  const [selectedLeague, setSelectedLeague] = useState<string>('');
  const [selectedTeam, setSelectedTeam] = useState<string>('');
  const [teamSearchTerm, setTeamSearchTerm] = useState<string>('');
  const [showTeamDropdown, setShowTeamDropdown] = useState<boolean>(false);
  const [isSidebarOpen, setSidebarOpen] = useState(true);

  // Derived Lists - Utilisation du queryService pour des listes pré-indexées
  const availableTeams = useMemo(() => {
    return queryService.getAvailableTeams();
  }, []);

  // Filtered teams for search
  const filteredTeams = useMemo(() => {
    return queryService.searchTeams(teamSearchTerm, 15);
  }, [teamSearchTerm]);

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
        ? { name: first.Team, teamId: first['Team ID'], season: getPlayerSeason(first), competition: first.Competition }
        : null;
  }, [selectedTeam]);
  const { shots: competitionShots } = useShots(selectedTeamInfo?.season, selectedTeamInfo?.competition);

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


  return (
    <div className="flex h-full animate-fade-in relative overflow-hidden bg-slate-900">
      
      {/* --- Sidebar Filters --- */}
      <div className={`bg-slate-950 border-r border-slate-800 flex flex-col transition-all duration-300 z-20 absolute lg:relative h-full ${isSidebarOpen ? 'w-80 translate-x-0' : 'w-0 -translate-x-full lg:w-0 lg:translate-x-0 overflow-hidden'}`}>
        <div className="p-5 border-b border-slate-800 flex items-center justify-between">
            <h2 className="font-bold text-white flex items-center gap-2">
                <Filter className="w-5 h-5 text-emerald-400" /> Filtres
            </h2>
            <button onClick={() => setSidebarOpen(false)} className="lg:hidden text-slate-400"><LayoutTemplate /></button>
        </div>

        <div className="p-5 space-y-6">
            <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Rechercher une équipe</label>
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <input
                        type="text"
                        placeholder="Nom du club..."
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-10 pr-4 py-2.5 text-slate-200 text-sm focus:ring-emerald-500 focus:border-emerald-500 focus:outline-none"
                        value={teamSearchTerm}
                        onChange={(e) => {
                            setTeamSearchTerm(e.target.value);
                            setShowTeamDropdown(true);
                            if (!e.target.value) setSelectedTeam('');
                        }}
                        onFocus={() => setShowTeamDropdown(true)}
                    />
                    {selectedTeam && (
                        <button
                            onClick={() => { setSelectedTeam(''); setTeamSearchTerm(''); }}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    )}
                </div>
                
                {/* Team Dropdown */}
                {showTeamDropdown && filteredTeams.length > 0 && (
                    <div className="absolute z-50 w-[calc(100%-2.5rem)] bg-slate-900 border border-slate-700 rounded-lg mt-1 max-h-60 overflow-y-auto shadow-xl">
                        {filteredTeams.map(team => (
                            <button
                                key={team}
                                onClick={() => handleTeamSelect(team)}
                                className={`w-full text-left px-4 py-2.5 text-sm hover:bg-slate-800 transition-colors flex items-center justify-between ${
                                    selectedTeam === team ? 'bg-emerald-500/10 text-emerald-400' : 'text-slate-300'
                                }`}
                            >
                                <TeamOption teamKey={team} />
                                {selectedTeam === team && <ChevronRight className="w-4 h-4 text-emerald-400" />}
                            </button>
                        ))}
                        {teamSearchTerm && filteredTeams.length === 0 && (
                            <div className="px-4 py-3 text-sm text-slate-500 text-center">Aucune équipe trouvée</div>
                        )}
                    </div>
                )}
                
                <div className="text-xs text-slate-600 mt-1">
                    {availableTeams.length} équipes disponibles
                </div>
            </div>

            {/* View Selection Tabs */}
            <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Analyse</label>
                <button 
                    onClick={() => setActiveTab('DEPTH')}
                    className={`w-full flex items-center gap-3 p-3 rounded-lg transition-all ${activeTab === 'DEPTH' ? 'bg-emerald-500 text-slate-900 font-bold' : 'bg-slate-900 text-slate-400 hover:text-white'}`}
                >
                    <Users className="w-4 h-4" /> Composition type
                </button>
                <button 
                    onClick={() => setActiveTab('TACTICS')}
                    className={`w-full flex items-center gap-3 p-3 rounded-lg transition-all ${activeTab === 'TACTICS' ? 'bg-emerald-500 text-slate-900 font-bold' : 'bg-slate-900 text-slate-400 hover:text-white'}`}
                >
                    <Shield className="w-4 h-4" /> Profil tactique
                </button>
                <button 
                    onClick={() => setActiveTab('SHOTMAP')}
                    disabled={!selectedTeam}
                    className={`w-full flex items-center gap-3 p-3 rounded-lg transition-all ${activeTab === 'SHOTMAP' ? 'bg-emerald-500 text-slate-900 font-bold' : 'bg-slate-900 text-slate-400 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed'}`}
                >
                    <Target className="w-4 h-4" /> Carte des tirs
                    {!selectedTeam && <span className="ml-auto text-[10px] opacity-70">Aucune donnée</span>}
                </button>
                <button 
                    onClick={() => setActiveTab('PLAYERS')}
                    className={`w-full flex items-center gap-3 p-3 rounded-lg transition-all ${activeTab === 'PLAYERS' ? 'bg-emerald-500 text-slate-900 font-bold' : 'bg-slate-900 text-slate-400 hover:text-white'}`}
                >
                    <BarChart3 className="w-4 h-4" /> Effectif
                </button>
            </div>
            
            {/* Team Quick Stats */}
            {selectedTeam && teamPlayerStats.length > 0 && (
              <div className="bg-slate-900 rounded-xl p-4 border border-slate-800">
                <h4 className="text-xs font-bold text-slate-500 uppercase mb-3">Résumé</h4>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Joueurs</span>
                    <span className="text-white font-bold">{teamPlayerStats.length}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Buts</span>
                    <span className="text-emerald-400 font-bold">
                      {teamPlayerStats.reduce((s, p) => s + (Number(p.Goals) || 0), 0)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Passes décisives</span>
                    <span className="text-blue-400 font-bold">
                      {teamPlayerStats.reduce((s, p) => s + (Number(p.Assists) || 0), 0)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Âge moyen</span>
                    <span className="text-white font-bold">
                      {(teamPlayerStats.reduce((s, p) => s + (Number(p.Age) || 0), 0) / teamPlayerStats.length).toFixed(1)}
                    </span>
                  </div>
                </div>
              </div>
            )}
        </div>
      </div>

      {/* --- Main Content --- */}
      <div className="flex-1 flex flex-col h-full overflow-hidden relative bg-[#0f172a]">
           <button 
            onClick={() => setSidebarOpen(!isSidebarOpen)} 
            className={`absolute top-4 left-4 z-30 p-2 bg-slate-800 text-white rounded-lg border border-slate-700 hover:bg-slate-700 transition-all ${isSidebarOpen ? 'hidden' : 'block'}`}
          >
             <Filter className="w-4 h-4" />
          </button>

          {!selectedTeam ? (
              <div className="flex-1 flex flex-col items-center justify-center text-slate-500">
                  <Activity className="w-16 h-16 mb-4 opacity-20" />
                  <p>Choisissez une équipe dans le panneau de gauche.</p>
              </div>
          ) : (
            <div className="flex-1 overflow-auto custom-scrollbar">
                
                {/* --- VIEW: SQUAD DEPTH (compositions réelles) --- */}
                {activeTab === 'DEPTH' && (
                    <SquadLineup
                        teamId={selectedTeamInfo?.teamId}
                        season={selectedTeamInfo?.season}
                        competition={selectedTeamInfo?.competition}
                        players={selectedTeam ? queryService.getTeamPlayers(selectedTeam) : []}
                    />
                )}

                {/* --- VIEW: TACTICAL PROFILE (US-10) --- */}
                {activeTab === 'TACTICS' && (
                    <div className="p-8 max-w-5xl mx-auto">
                        {tacticalProfile ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
                             <div className="bg-slate-950 border border-slate-800 rounded-3xl p-6 shadow-xl">
                                <h3 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                                    <Shield className="w-5 h-5 text-emerald-500" /> Forces relatives
                                </h3>
                                <div className="h-[300px] w-full">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <RadarChart cx="50%" cy="50%" outerRadius="70%" data={tacticalProfile}>
                                            <PolarGrid stroke="#334155" />
                                            <PolarAngleAxis dataKey="subject" tick={{ fill: '#94a3b8', fontSize: 12, fontWeight: 600 }} />
                                            <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
                                            <Radar name={selectedTeam} dataKey="A" stroke="#10b981" strokeWidth={3} fill="#10b981" fillOpacity={0.3} />
                                            <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', color: '#fff' }} />
                                        </RadarChart>
                                    </ResponsiveContainer>
                                </div>
                                <p className="text-center text-xs text-slate-500 mt-4">Percentile parmi les équipes de la compétition</p>
                             </div>

                             <div className="space-y-4">
                                <div className="bg-slate-950 border border-slate-800 rounded-2xl p-6">
                                    <h4 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4">ADN tactique</h4>
                                    <div className="space-y-4">
                                        {tacticalProfile.map(stat => (
                                            <div key={stat.subject}>
                                                <div className="flex justify-between text-sm mb-1">
                                                    <span className="text-slate-300">{stat.subject}</span>
                                                    <span className={`font-mono font-bold ${stat.A > 75 ? 'text-emerald-400' : stat.A < 25 ? 'text-rose-400' : 'text-slate-400'}`}>
                                                        {stat.A}e percentile
                                                    </span>
                                                </div>
                                                <div className="h-2 bg-slate-900 rounded-full overflow-hidden">
                                                    <div 
                                                        className={`h-full rounded-full ${stat.A > 75 ? 'bg-emerald-500' : stat.A < 25 ? 'bg-rose-500' : 'bg-blue-500'}`} 
                                                        style={{ width: `${stat.A}%` }}
                                                    ></div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                             </div>
                        </div>
                        ) : (
                          <div className="flex flex-col items-center justify-center h-64 text-slate-500">
                            <Shield className="w-16 h-16 mb-4 opacity-20" />
                            <p>Aucune donnée tactique pour cette équipe.</p>
                            <p className="text-sm mt-2">Les statistiques d'équipe manquent pour cette compétition.</p>
                          </div>
                        )}
                        {selectedTeamStats && <TeamStyleMap team={selectedTeamStats} teams={teamStats} />}
                    </div>
                )}

                {/* --- VIEW: SHOT MAP (US-11) --- */}
                {activeTab === 'SHOTMAP' && (
                    <div className="flex flex-col h-full">
                        {/* Stats Header */}
                        <div className="bg-slate-950 border-b border-slate-800 p-4 grid grid-cols-5 gap-4">
                            <div className="text-center">
                                <div className="text-xs text-slate-500 uppercase">Tirs</div>
                                <div className="text-2xl font-bold text-white">{shotStats.total}</div>
                            </div>
                            <div className="text-center">
                                <div className="text-xs text-slate-500 uppercase">Buts</div>
                                <div className="text-2xl font-bold text-emerald-400">{shotStats.goals}</div>
                            </div>
                            <div className="text-center">
                                <div className="text-xs text-slate-500 uppercase">xG</div>
                                <div className="text-2xl font-bold text-blue-400">{shotStats.xG.toFixed(2)}</div>
                            </div>
                            <div className="text-center">
                                <div className="text-xs text-slate-500 uppercase">Cadrés</div>
                                <div className="text-2xl font-bold text-yellow-400">{shotStats.onTarget}</div>
                            </div>
                            <div className="text-center">
                                <div className="text-xs text-slate-500 uppercase">Conversion</div>
                                <div className="text-2xl font-bold text-purple-400">
                                  {shotStats.total > 0 ? ((shotStats.goals / shotStats.total) * 100).toFixed(1) : 0}%
                                </div>
                            </div>
                        </div>

                        {shotMapData.length > 0 ? (
                          <div className="flex-1 flex">
                            {/* Shot Map */}
                            <div className="flex-1 relative flex items-center justify-center p-4 bg-[#1a2c2c] overflow-hidden">
                              {/* Half Pitch - Attacking half only */}
                              <div className="relative w-[600px] h-[400px] bg-emerald-900/30 border-2 border-white/30 rounded-lg shadow-2xl overflow-hidden">
                                {/* Pitch markings */}
                                <div className="absolute inset-0 bg-gradient-to-r from-emerald-900/20 to-emerald-800/40"></div>
                                
                                {/* Penalty box */}
                                <div className="absolute right-0 top-[15%] bottom-[15%] w-[28%] border-l-2 border-t-2 border-b-2 border-white/30"></div>
                                
                                {/* 6 yard box */}
                                <div className="absolute right-0 top-[35%] bottom-[35%] w-[10%] border-l-2 border-t-2 border-b-2 border-white/30"></div>
                                
                                {/* Goal */}
                                <div className="absolute right-0 top-[42%] bottom-[42%] w-[3%] bg-white/20 border-l-2 border-white/50"></div>
                                
                                {/* Penalty spot */}
                                <div className="absolute right-[18%] top-1/2 w-2 h-2 bg-white/50 rounded-full -translate-y-1/2"></div>
                                
                                {/* Center circle arc */}
                                <div className="absolute left-0 top-1/2 w-24 h-48 border-r-2 border-white/20 rounded-r-full -translate-y-1/2 -translate-x-12"></div>

                                {/* Shots */}
                                {shotMapData.map((shot, i) => {
                                    const isGoal = shot.result === 'Goal';
                                    const isSaved = shot.result === 'SavedShot';
                                    const color = isGoal ? '#10b981' : isSaved ? '#3b82f6' : '#ef4444';
                                    const size = Math.max(10, Math.min(35, (shot.xG || 0.05) * 50));

                                    return (
                                        <div 
                                            key={i}
                                            className="absolute rounded-full border-2 border-black/30 hover:scale-150 transition-transform cursor-pointer shadow-lg z-10 group"
                                            style={{
                                                left: `${(shot.X || 0.5) * 100}%`,
                                                top: `${(shot.Y || 0.5) * 100}%`,
                                                width: `${size}px`,
                                                height: `${size}px`,
                                                backgroundColor: color,
                                                transform: 'translate(-50%, -50%)'
                                            }}
                                        >
                                            {isGoal && <div className="absolute inset-0 border-2 border-white rounded-full animate-ping opacity-50"></div>}
                                            
                                            {/* Tooltip */}
                                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-50 w-48">
                                              <div className="bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs shadow-xl">
                                                <div className="font-bold text-white">{shot.player}</div>
                                                <div className="text-slate-400">xG: {(shot.xG || 0).toFixed(3)}</div>
                                                <div className={`font-medium ${isGoal ? 'text-emerald-400' : isSaved ? 'text-blue-400' : 'text-red-400'}`}>
                                                  {shotResultLabel(shot.result)}
                                                </div>
                                                <div className="text-slate-500">{shotTypeLabel(shot.shotType)} • {situationLabel(shot.situation)}</div>
                                              </div>
                                            </div>
                                        </div>
                                    );
                                })}
                              </div>

                              {/* Legend */}
                              <div className="absolute bottom-4 left-4 bg-slate-950/90 p-3 rounded-xl border border-slate-700 text-xs text-white space-y-1.5">
                                <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-emerald-500"></div> But</div>
                                <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-blue-500"></div> Arrêté</div>
                                <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-red-500"></div> Manqué ou contré</div>
                                <div className="mt-2 pt-2 border-t border-slate-700 text-[10px] text-slate-400">Taille du cercle = xG</div>
                              </div>
                            </div>

                            {/* Top Scorers Panel */}
                            <div className="w-72 bg-slate-950 border-l border-slate-800 p-4 overflow-auto">
                              <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
                                <Trophy className="w-4 h-4 text-yellow-500" /> Meilleurs buteurs
                              </h3>
                              <div className="space-y-3">
                                {shotStats.topScorers.map((scorer, idx) => (
                                  <div key={scorer.name} className="bg-slate-900 rounded-lg p-3 border border-slate-800">
                                    <div className="flex items-center gap-3">
                                      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${idx === 0 ? 'bg-yellow-500 text-black' : idx === 1 ? 'bg-slate-400 text-black' : idx === 2 ? 'bg-amber-700 text-white' : 'bg-slate-700 text-white'}`}>
                                        {idx + 1}
                                      </div>
                                      <div className="relative overflow-hidden w-9 h-9 rounded-full bg-slate-800 flex items-center justify-center text-[10px] font-bold text-slate-400 shrink-0">
                                        {scorer.name.substring(0, 2).toUpperCase()}
                                        <PhotoOverlay src={scorer.image} alt={scorer.name} />
                                      </div>
                                      <div className="flex-1 min-w-0">
                                        <div className="text-white font-medium text-sm truncate">{scorer.name}</div>
                                        <div className="flex gap-3 text-xs mt-1">
                                          <span className="text-emerald-400">{scorer.goals} buts</span>
                                          <span className="text-blue-400">{scorer.xG.toFixed(2)} xG</span>
                                          <span className="text-slate-500">{scorer.shots} tirs</span>
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                ))}
                                {shotStats.topScorers.length === 0 && (
                                  <p className="text-slate-500 text-sm">Aucun buteur</p>
                                )}
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="flex-1 flex flex-col items-center justify-center text-slate-500">
                            <Target className="w-16 h-16 mb-4 opacity-20" />
                            <p>Aucune donnée de tir pour {selectedTeam}.</p>
                            <p className="text-sm mt-2">Cette compétition n'a pas de données de tirs pour cette saison.</p>
                          </div>
                        )}
                    </div>
                )}

                {/* --- VIEW: TEAM PLAYERS --- */}
                {activeTab === 'PLAYERS' && (
                  <div className="p-6">
                    <div className="bg-slate-950 rounded-2xl border border-slate-800 overflow-hidden">
                      <div className="p-4 border-b border-slate-800">
                        <h3 className="text-lg font-bold text-white flex items-center gap-3">
                          <TeamLogo src={queryService.getTeamInfo(selectedTeam).logo} name={selectedTeam} size="md" />
                          Effectif - {selectedTeam}
                        </h3>
                        <p className="text-sm text-slate-500">{teamPlayerStats.length} joueurs</p>
                      </div>
                      
                      {/* Table Header */}
                      <div className="grid grid-cols-12 bg-slate-900 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                        <div className="col-span-3 p-3">Joueur</div>
                        <div className="col-span-1 p-3 text-center">Âge</div>
                        <div className="col-span-1 p-3 text-center">Poste</div>
                        <div className="col-span-1 p-3 text-center">Min</div>
                        <div className="col-span-1 p-3 text-center">Buts</div>
                        <div className="col-span-1 p-3 text-center">PD</div>
                        <div className="col-span-1 p-3 text-center">xG</div>
                        <div className="col-span-1 p-3 text-center">xA</div>
                        <div className="col-span-2 p-3 text-right">Valeur</div>
                      </div>
                      
                      {/* Table Body */}
                      <div className="max-h-[600px] overflow-y-auto">
                        {teamPlayerStats.map((player, idx) => {
                          const pSeason = extractSeason(player.League);
                          const pSeasonColors = getSeasonColor(pSeason);
                          return (
                          <div key={getPlayerSeasonId(player)} className="grid grid-cols-12 border-b border-slate-800/50 hover:bg-slate-900/50 transition-colors text-sm items-center">
                            <div className="col-span-3 p-3 flex items-center gap-2">
                              <div className="relative">
                                <div className="relative overflow-hidden w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center text-xs font-bold text-emerald-400">
                                  {(player.Player || '?').substring(0, 2).toUpperCase()}
                                  <PhotoOverlay src={player.Image} alt={player.Player} />
                                </div>
                                <div className={`absolute -bottom-1 -right-1 px-1 py-0 rounded text-[7px] font-bold ${pSeasonColors.bg} ${pSeasonColors.text} border ${pSeasonColors.border}`}>
                                  {getSeasonShortLabel(pSeason)}
                                </div>
                              </div>
                              <span className="text-white font-medium truncate">{player.Player || 'Unknown'}</span>
                            </div>
                            <div className="col-span-1 p-3 text-center text-slate-400">{player.Age}</div>
                            <div className="col-span-1 p-3 text-center">
                              <span className="px-2 py-0.5 rounded bg-slate-800 text-xs text-slate-300">{positionLabel(player.Position)}</span>
                            </div>
                            <div className="col-span-1 p-3 text-center text-slate-400">{player.minutesPlayed}</div>
                            <div className="col-span-1 p-3 text-center font-bold text-emerald-400">{player.Goals || 0}</div>
                            <div className="col-span-1 p-3 text-center font-bold text-blue-400">{player.Assists || 0}</div>
                            <div className="col-span-1 p-3 text-center text-slate-400">{(Number(player.xG) || 0).toFixed(2)}</div>
                            <div className="col-span-1 p-3 text-center text-slate-400">{(Number(player.xA) || 0).toFixed(2)}</div>
                            <div className="col-span-2 p-3 text-right font-mono text-emerald-400">
                              {typeof player["Market value"] === 'number' && player["Market value"] > 0
                                ? `€${(player["Market value"] / 1000000).toFixed(1)}M`
                                : '-'}
                            </div>
                          </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
            </div>
          )}
      </div>
    </div>
  );
};

export default TeamAnalysis;
