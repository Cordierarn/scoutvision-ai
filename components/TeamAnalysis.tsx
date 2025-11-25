
import React, { useState, useMemo, useCallback } from 'react';
import { PlayerData, TeamStats, ShotEvent, extractSeason, getSeasonColor, getPlayerSeasonId } from '../types';
import { calculateRoleScore, ROLE_DEFINITIONS, ScoredPlayer, getAvailableLeagues, getAvailableTeams } from '../utils/scoringUtils';
import { Filter, Users, Shield, Target, Activity, LayoutTemplate, MapPin, BarChart3, TrendingUp, Trophy, ChevronRight, Search, X } from 'lucide-react';
import { ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid, ReferenceLine, ScatterChart, Scatter, ZAxis, Cell } from 'recharts';
import { queryService } from '../services/queryService';

interface TeamAnalysisProps {
  playerData: PlayerData[];
  teamStats: TeamStats[];
  shotEvents: ShotEvent[];
}

type Tab = 'DEPTH' | 'TACTICS' | 'SHOTMAP' | 'PLAYERS';

// --- Helper Data for Squad Depth - Updated with correct position mappings ---
const FORMATION_4231 = [
  { id: 'GK', name: 'GK', role: 'Shot-Stopping Goalkeeper', validPositions: ['GK'], top: '90%', left: '50%' },
  { id: 'LB', name: 'LB', role: 'Attacking LB', validPositions: ['LB', 'LWB'], top: '75%', left: '15%' },
  { id: 'LCB', name: 'LCB', role: 'Ball-Playing CB', validPositions: ['CB', 'LCB', 'RCB'], top: '80%', left: '35%' },
  { id: 'RCB', name: 'RCB', role: 'Defensive CB', validPositions: ['CB', 'LCB', 'RCB'], top: '80%', left: '65%' },
  { id: 'RB', name: 'RB', role: 'Attacking RB', validPositions: ['RB', 'RWB'], top: '75%', left: '85%' },
  { id: 'LCM', name: 'DM', role: 'Deep-Lying Playmaker', validPositions: ['DMF', 'LDMF', 'RDMF', 'LCMF', 'RCMF'], top: '60%', left: '35%' },
  { id: 'RCM', name: 'CM', role: 'Box-to-Box', validPositions: ['DMF', 'LDMF', 'RDMF', 'LCMF', 'RCMF', 'AMF'], top: '60%', left: '65%' },
  { id: 'LW', name: 'LW', role: 'Inverted Winger', validPositions: ['LW', 'LWF', 'LAMF'], top: '35%', left: '15%' },
  { id: 'CAM', name: 'CAM', role: 'Advanced Playmaker', validPositions: ['AMF', 'LAMF', 'RAMF'], top: '40%', left: '50%' },
  { id: 'RW', name: 'RW', role: 'Inside Forward', validPositions: ['RW', 'RWF', 'RAMF'], top: '35%', left: '85%' },
  { id: 'ST', name: 'ST', role: 'Advanced Striker', validPositions: ['CF'], top: '15%', left: '50%' },
];

const TeamAnalysis: React.FC<TeamAnalysisProps> = ({ playerData, teamStats, shotEvents }) => {
  const [activeTab, setActiveTab] = useState<Tab>('DEPTH');
  const [selectedLeague, setSelectedLeague] = useState<string>('');
  const [selectedTeam, setSelectedTeam] = useState<string>('');
  const [teamSearchTerm, setTeamSearchTerm] = useState<string>('');
  const [showTeamDropdown, setShowTeamDropdown] = useState<boolean>(false);
  const [isSidebarOpen, setSidebarOpen] = useState(true);
  const [selectedFormation, setSelectedFormation] = useState<string>('4-2-3-1');

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

  // --- TAB 1: SQUAD DEPTH LOGIC ---
  const depthChart = useMemo(() => {
    if (!selectedTeam) return {};
    
    // Utilisation du queryService pour récupérer les joueurs de l'équipe (O(1))
    const filtered = queryService.getTeamPlayers(selectedTeam);
    
    if (filtered.length === 0) return {};

    // ÉTAPE 1: Calculer tous les scores pour chaque joueur à chaque position
    type PlayerScoreEntry = { player: PlayerData; positionId: string; score: number };
    const allScores: PlayerScoreEntry[] = [];
    
    filtered.forEach(player => {
      if (!player.Position) return;
      
      const playerPositions = player.Position.split(',').map(s => s.trim());
      const mainPos = player['Main Position'] as string;
      if (mainPos) playerPositions.push(mainPos.trim());
      
      FORMATION_4231.forEach(pos => {
        const isValidPosition = playerPositions.some(pp => pos.validPositions.includes(pp));
        if (!isValidPosition) return;
        
        // Calculer le score pour ce joueur à cette position
        let score = 0;
        const roleKey = Object.keys(ROLE_DEFINITIONS).find(r => r === pos.role) || Object.keys(ROLE_DEFINITIONS)[0];
        const roleDef = ROLE_DEFINITIONS[roleKey];
        
        if (roleDef && roleDef.metrics) {
          Object.entries(roleDef.metrics).forEach(([metric, weight]) => {
            const val = Number(player[metric]) || 0;
            score += val * (weight as number) * 10;
          });
        }
        
        allScores.push({
          player,
          positionId: pos.id,
          score: Math.round(Math.min(100, Math.max(0, score)))
        });
      });
    });
    
    // ÉTAPE 2: Trier par score décroissant
    allScores.sort((a, b) => b.score - a.score);
    
    // ÉTAPE 3: Assigner les joueurs - chaque joueur ne peut être qu'à UNE position
    const assignedPlayers = new Set<string>(); // Joueurs déjà assignés à une position
    const chart: Record<string, ScoredPlayer[]> = {};
    
    // Initialiser les positions
    FORMATION_4231.forEach(pos => { chart[pos.id] = []; });
    
    // Premier passage: assigner le meilleur joueur unique à chaque position
    for (const entry of allScores) {
      const { player, positionId, score } = entry;
      const playerName = player.Player;
      
      // Si le joueur est déjà assigné, skip
      if (assignedPlayers.has(playerName)) continue;
      
      // Si cette position a déjà son titulaire (1er), skip
      if (chart[positionId].length >= 1) continue;
      
      // Assigner ce joueur comme titulaire
      chart[positionId].push({ ...player, roleScore: score } as ScoredPlayer);
      assignedPlayers.add(playerName);
    }
    
    // Deuxième passage: ajouter des remplaçants (max 2 par position)
    // Les remplaçants peuvent être des joueurs déjà assignés ailleurs (backup)
    for (const entry of allScores) {
      const { player, positionId, score } = entry;
      
      // Si cette position a déjà 3 joueurs, skip
      if (chart[positionId].length >= 3) continue;
      
      // Vérifier si ce joueur est déjà dans cette position
      const alreadyInPosition = chart[positionId].some(p => p.Player === player.Player);
      if (alreadyInPosition) continue;
      
      // Ajouter comme remplaçant
      chart[positionId].push({ ...player, roleScore: score } as ScoredPlayer);
    }
    
    return chart;
  }, [selectedTeam]);

  // --- TAB 2: TEAM TACTICS LOGIC (US-10) ---
  const tacticalProfile = useMemo(() => {
    if (!selectedTeam) return null;
    
    // Utilisation du queryService pour des stats d'équipe rapides
    const teamData = queryService.getTeamStats(selectedTeam);
    
    // Si on a des stats d'équipe, les utiliser
    if (teamData) {
      const cohort = selectedLeague 
        ? teamStats.filter(t => t.league === selectedLeague) 
        : teamStats;
      
      // Métriques adaptées aux colonnes réelles de ALL_LEAGUES_merged.csv
      const metrics = [
        { key: 'shooting_goals', label: 'Goals Scored', higher: true },
        { key: 'standard_possession', label: 'Possession %', higher: true },
        { key: 'passing_pass_completion_pct', label: 'Pass Accuracy', higher: true },
        { key: 'defense_tackles_won', label: 'Tackles Won', higher: true },
        { key: 'shooting_xg', label: 'Expected Goals', higher: true },
        { key: 'keeper_clean_sheet_pct', label: 'Clean Sheets %', higher: true },
      ];

      return metrics.map(m => {
        const val = Number(teamData[m.key as keyof TeamStats]) || 0;
        const values = cohort.map(c => Number(c[m.key as keyof TeamStats]) || 0).filter(v => v > 0).sort((a, b) => a - b);
        const rank = values.filter(v => v < val).length;
        const percentile = values.length > 0 ? Math.round((rank / values.length) * 100) : 50;
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
      'Attack': teamPlayers.reduce((sum, p) => sum + (Number(p['xG per 90']) || 0), 0) / teamPlayers.length,
      'Creation': teamPlayers.reduce((sum, p) => sum + (Number(p['xA per 90']) || 0), 0) / teamPlayers.length,
      'Passing': teamPlayers.reduce((sum, p) => sum + (Number(p['Accurate passes, %']) || 0), 0) / teamPlayers.length,
      'Defense': teamPlayers.reduce((sum, p) => sum + (Number(p['Successful defensive actions per 90']) || 0), 0) / teamPlayers.length,
      'Dribbling': teamPlayers.reduce((sum, p) => sum + (Number(p['Successful dribbles, %']) || 0), 0) / teamPlayers.length,
      'Aerial': teamPlayers.reduce((sum, p) => sum + (Number(p['Aerial duels won, %']) || 0), 0) / teamPlayers.length,
    };

    // Calculer les percentiles par rapport à toutes les équipes
    const allTeams = queryService.getAvailableTeams();
    
    return Object.entries(avgMetrics).map(([label, val]) => {
      // Calculer la même métrique pour toutes les équipes (utiliser les stats agrégées du cache)
      const allValues = allTeams.map(team => {
        const stats = queryService.getTeamAggregatedStats(team);
        switch(label) {
          case 'Attack': return stats.avgXGPer90;
          case 'Creation': return stats.avgXAPer90;
          case 'Passing': return stats.avgPassAccuracy;
          case 'Defense': return stats.avgDefensiveActions;
          case 'Dribbling': return stats.avgDribbleSuccess;
          case 'Aerial': return stats.avgAerialWon;
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

  // --- TAB 3: SHOT MAP LOGIC (US-11) ---
  const shotMapData = useMemo(() => {
      if (!selectedTeam) return [];
      // Utilisation du queryService pour récupérer les tirs de l'équipe (O(1))
      return queryService.getTeamShots(selectedTeam);
  }, [selectedTeam]);

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
      
      const topScorers = Array.from(scorerMap.entries())
        .map(([name, stats]) => ({ name, ...stats }))
        .sort((a, b) => b.goals - a.goals || b.xG - a.xG)
        .slice(0, 5);
      
      return { total, goals, xG, onTarget, blocked, topScorers };
  }, [shotMapData]);

  // --- TAB 4: TEAM PLAYERS LIST ---
  const teamPlayerStats = useMemo(() => {
    if (!selectedTeam) return [];
    return playerData
      .filter(p => p.Team === selectedTeam)
      .map(p => ({
        ...p,
        goalsContribution: (Number(p.Goals) || 0) + (Number(p.Assists) || 0),
        minutesPlayed: Number(p['Minutes played']) || 0,
      }))
      .sort((a, b) => b.minutesPlayed - a.minutesPlayed);
  }, [playerData, selectedTeam]);


  return (
    <div className="flex h-full animate-fade-in relative overflow-hidden bg-slate-900">
      
      {/* --- Sidebar Filters --- */}
      <div className={`bg-slate-950 border-r border-slate-800 flex flex-col transition-all duration-300 z-20 absolute lg:relative h-full ${isSidebarOpen ? 'w-80 translate-x-0' : 'w-0 -translate-x-full lg:w-0 lg:translate-x-0 overflow-hidden'}`}>
        <div className="p-5 border-b border-slate-800 flex items-center justify-between">
            <h2 className="font-bold text-white flex items-center gap-2">
                <Filter className="w-5 h-5 text-emerald-400" /> Analysis Filters
            </h2>
            <button onClick={() => setSidebarOpen(false)} className="lg:hidden text-slate-400"><LayoutTemplate /></button>
        </div>

        <div className="p-5 space-y-6">
            <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Search Team</label>
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <input
                        type="text"
                        placeholder="Type to search..."
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
                                <span className="truncate">{team}</span>
                                {selectedTeam === team && <ChevronRight className="w-4 h-4 text-emerald-400" />}
                            </button>
                        ))}
                        {teamSearchTerm && filteredTeams.length === 0 && (
                            <div className="px-4 py-3 text-sm text-slate-500 text-center">No teams found</div>
                        )}
                    </div>
                )}
                
                <div className="text-xs text-slate-600 mt-1">
                    {availableTeams.length} teams available
                </div>
            </div>

            {/* View Selection Tabs */}
            <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Analysis Mode</label>
                <button 
                    onClick={() => setActiveTab('DEPTH')}
                    className={`w-full flex items-center gap-3 p-3 rounded-lg transition-all ${activeTab === 'DEPTH' ? 'bg-emerald-500 text-slate-900 font-bold' : 'bg-slate-900 text-slate-400 hover:text-white'}`}
                >
                    <Users className="w-4 h-4" /> Squad Depth
                </button>
                <button 
                    onClick={() => setActiveTab('TACTICS')}
                    className={`w-full flex items-center gap-3 p-3 rounded-lg transition-all ${activeTab === 'TACTICS' ? 'bg-emerald-500 text-slate-900 font-bold' : 'bg-slate-900 text-slate-400 hover:text-white'}`}
                >
                    <Shield className="w-4 h-4" /> Tactical Profile
                </button>
                <button 
                    onClick={() => setActiveTab('SHOTMAP')}
                    disabled={shotEvents.length === 0}
                    className={`w-full flex items-center gap-3 p-3 rounded-lg transition-all ${activeTab === 'SHOTMAP' ? 'bg-emerald-500 text-slate-900 font-bold' : 'bg-slate-900 text-slate-400 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed'}`}
                >
                    <Target className="w-4 h-4" /> Shot Map
                    {shotEvents.length === 0 && <span className="ml-auto text-[10px] opacity-70">No Data</span>}
                </button>
                <button 
                    onClick={() => setActiveTab('PLAYERS')}
                    className={`w-full flex items-center gap-3 p-3 rounded-lg transition-all ${activeTab === 'PLAYERS' ? 'bg-emerald-500 text-slate-900 font-bold' : 'bg-slate-900 text-slate-400 hover:text-white'}`}
                >
                    <BarChart3 className="w-4 h-4" /> Team Players
                </button>
            </div>
            
            {/* Team Quick Stats */}
            {selectedTeam && teamPlayerStats.length > 0 && (
              <div className="bg-slate-900 rounded-xl p-4 border border-slate-800">
                <h4 className="text-xs font-bold text-slate-500 uppercase mb-3">Team Summary</h4>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Players</span>
                    <span className="text-white font-bold">{teamPlayerStats.length}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Total Goals</span>
                    <span className="text-emerald-400 font-bold">
                      {teamPlayerStats.reduce((s, p) => s + (Number(p.Goals) || 0), 0)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Total Assists</span>
                    <span className="text-blue-400 font-bold">
                      {teamPlayerStats.reduce((s, p) => s + (Number(p.Assists) || 0), 0)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Avg Age</span>
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
                  <p>Select a team from the sidebar to begin analysis.</p>
              </div>
          ) : (
            <div className="flex-1 overflow-auto custom-scrollbar">
                
                {/* --- VIEW: SQUAD DEPTH --- */}
                {activeTab === 'DEPTH' && (
                    <div className="relative min-w-[800px] min-h-[700px] h-full w-full bg-[#1a2c2c] overflow-hidden">
                        {/* Pitch Pattern */}
                        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:4rem_4rem] z-0"></div>
                        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(16,185,129,0.15)_0%,transparent_70%)] z-0"></div>
                        
                        {/* Pitch Markings */}
                        <div className="absolute inset-12 border-2 border-white/10 rounded-sm z-0"></div>
                        <div className="absolute top-1/2 left-0 right-0 h-px bg-white/10 z-0"></div>
                        <div className="absolute top-1/2 left-1/2 w-40 h-40 border-2 border-white/10 rounded-full -translate-x-1/2 -translate-y-1/2 z-0"></div>
                        <div className="absolute top-1/2 left-1/2 w-2 h-2 bg-white/30 rounded-full -translate-x-1/2 -translate-y-1/2 z-0"></div>
                        
                        {/* Penalty Areas */}
                        <div className="absolute top-12 left-1/2 w-[40%] h-40 border-2 border-t-0 border-white/10 -translate-x-1/2 z-0"></div>
                        <div className="absolute bottom-12 left-1/2 w-[40%] h-40 border-2 border-b-0 border-white/10 -translate-x-1/2 z-0"></div>

                        {FORMATION_4231.map((pos) => {
                            const topPlayer = depthChart[pos.id]?.[0];
                            return (
                                <div key={pos.id} className="absolute w-52 transform -translate-x-1/2 -translate-y-1/2 flex flex-col items-center z-10" style={{ top: pos.top, left: pos.left }}>
                                    <div className="mb-2 px-3 py-1 bg-black/40 backdrop-blur-md rounded-full border border-white/10 text-[10px] font-bold text-emerald-400 uppercase tracking-wide shadow-lg">
                                        {pos.role}
                                    </div>
                                    {topPlayer ? (
                                        <div className="w-full bg-slate-900/90 backdrop-blur-xl border border-white/10 rounded-xl p-3 shadow-2xl hover:scale-105 hover:border-emerald-500/50 transition-all group relative cursor-pointer">
                                            <div className="flex items-center gap-3">
                                                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white border-2 shadow-inner ${
                                                    topPlayer.roleScore >= 90 ? 'bg-emerald-600 border-emerald-400' :
                                                    topPlayer.roleScore >= 80 ? 'bg-blue-600 border-blue-400' :
                                                    'bg-slate-700 border-slate-500'
                                                }`}>
                                                    {(topPlayer.Player || '?').substring(0, 1)}
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <div className="text-white font-bold truncate text-sm">{topPlayer.Player || 'Unknown'}</div>
                                                    <div className="flex items-center justify-between mt-1">
                                                        <div className={`text-xs font-bold ${topPlayer.roleScore > 80 ? 'text-emerald-400' : 'text-yellow-400'}`}>
                                                            {topPlayer.roleScore} <span className="text-[10px] text-slate-500 font-normal">RATING</span>
                                                        </div>
                                                        <div className="text-[10px] text-slate-400">
                                                            {Number(topPlayer.Age)} yo
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                            {/* Tooltip List */}
                                            <div className="absolute top-full left-0 right-0 mt-1 bg-slate-900 border border-slate-700 rounded-lg overflow-hidden hidden group-hover:block z-50">
                                                {depthChart[pos.id]?.slice(1).map((p, idx) => (
                                                    <div key={idx} className="p-2 border-b border-slate-800 flex justify-between text-[10px] hover:bg-slate-800">
                                                        <span className="text-slate-300 truncate">{p.Player || 'Unknown'}</span>
                                                        <span className="text-emerald-500">{p.roleScore}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="w-10 h-10 rounded-full border-2 border-dashed border-white/20"></div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}

                {/* --- VIEW: TACTICAL PROFILE (US-10) --- */}
                {activeTab === 'TACTICS' && (
                    <div className="p-8 max-w-5xl mx-auto">
                        {tacticalProfile ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
                             <div className="bg-slate-950 border border-slate-800 rounded-3xl p-6 shadow-xl">
                                <h3 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                                    <Shield className="w-5 h-5 text-emerald-500" /> Relative Strength Profile
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
                                <p className="text-center text-xs text-slate-500 mt-4">Percentile Rank vs All Teams</p>
                             </div>

                             <div className="space-y-4">
                                <div className="bg-slate-950 border border-slate-800 rounded-2xl p-6">
                                    <h4 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4">Tactical DNA</h4>
                                    <div className="space-y-4">
                                        {tacticalProfile.map(stat => (
                                            <div key={stat.subject}>
                                                <div className="flex justify-between text-sm mb-1">
                                                    <span className="text-slate-300">{stat.subject}</span>
                                                    <span className={`font-mono font-bold ${stat.A > 75 ? 'text-emerald-400' : stat.A < 25 ? 'text-rose-400' : 'text-slate-400'}`}>
                                                        {stat.A}th Percentile
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
                            <p>No tactical data available for this team.</p>
                            <p className="text-sm mt-2">Make sure player data is loaded.</p>
                          </div>
                        )}
                    </div>
                )}

                {/* --- VIEW: SHOT MAP (US-11) --- */}
                {activeTab === 'SHOTMAP' && (
                    <div className="flex flex-col h-full">
                        {/* Stats Header */}
                        <div className="bg-slate-950 border-b border-slate-800 p-4 grid grid-cols-5 gap-4">
                            <div className="text-center">
                                <div className="text-xs text-slate-500 uppercase">Shots</div>
                                <div className="text-2xl font-bold text-white">{shotStats.total}</div>
                            </div>
                            <div className="text-center">
                                <div className="text-xs text-slate-500 uppercase">Goals</div>
                                <div className="text-2xl font-bold text-emerald-400">{shotStats.goals}</div>
                            </div>
                            <div className="text-center">
                                <div className="text-xs text-slate-500 uppercase">xG</div>
                                <div className="text-2xl font-bold text-blue-400">{shotStats.xG.toFixed(2)}</div>
                            </div>
                            <div className="text-center">
                                <div className="text-xs text-slate-500 uppercase">On Target</div>
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
                                                  {shot.result}
                                                </div>
                                                <div className="text-slate-500">{shot.shotType} • {shot.situation}</div>
                                              </div>
                                            </div>
                                        </div>
                                    );
                                })}
                              </div>

                              {/* Legend */}
                              <div className="absolute bottom-4 left-4 bg-slate-950/90 p-3 rounded-xl border border-slate-700 text-xs text-white space-y-1.5">
                                <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-emerald-500"></div> Goal</div>
                                <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-blue-500"></div> Saved</div>
                                <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-red-500"></div> Missed/Blocked</div>
                                <div className="mt-2 pt-2 border-t border-slate-700 text-[10px] text-slate-400">Circle size = xG value</div>
                              </div>
                            </div>

                            {/* Top Scorers Panel */}
                            <div className="w-72 bg-slate-950 border-l border-slate-800 p-4 overflow-auto">
                              <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
                                <Trophy className="w-4 h-4 text-yellow-500" /> Top Scorers
                              </h3>
                              <div className="space-y-3">
                                {shotStats.topScorers.map((scorer, idx) => (
                                  <div key={scorer.name} className="bg-slate-900 rounded-lg p-3 border border-slate-800">
                                    <div className="flex items-center gap-3">
                                      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${idx === 0 ? 'bg-yellow-500 text-black' : idx === 1 ? 'bg-slate-400 text-black' : idx === 2 ? 'bg-amber-700 text-white' : 'bg-slate-700 text-white'}`}>
                                        {idx + 1}
                                      </div>
                                      <div className="flex-1 min-w-0">
                                        <div className="text-white font-medium text-sm truncate">{scorer.name}</div>
                                        <div className="flex gap-3 text-xs mt-1">
                                          <span className="text-emerald-400">{scorer.goals} goals</span>
                                          <span className="text-blue-400">{scorer.xG.toFixed(2)} xG</span>
                                          <span className="text-slate-500">{scorer.shots} shots</span>
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                ))}
                                {shotStats.topScorers.length === 0 && (
                                  <p className="text-slate-500 text-sm">No scorers data</p>
                                )}
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="flex-1 flex flex-col items-center justify-center text-slate-500">
                            <Target className="w-16 h-16 mb-4 opacity-20" />
                            <p>No shot data available for {selectedTeam}.</p>
                            <p className="text-sm mt-2">Make sure the shot events CSV is loaded.</p>
                          </div>
                        )}
                    </div>
                )}

                {/* --- VIEW: TEAM PLAYERS --- */}
                {activeTab === 'PLAYERS' && (
                  <div className="p-6">
                    <div className="bg-slate-950 rounded-2xl border border-slate-800 overflow-hidden">
                      <div className="p-4 border-b border-slate-800">
                        <h3 className="text-lg font-bold text-white">Squad Overview - {selectedTeam}</h3>
                        <p className="text-sm text-slate-500">{teamPlayerStats.length} players</p>
                      </div>
                      
                      {/* Table Header */}
                      <div className="grid grid-cols-12 bg-slate-900 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                        <div className="col-span-3 p-3">Player</div>
                        <div className="col-span-1 p-3 text-center">Age</div>
                        <div className="col-span-1 p-3 text-center">Pos</div>
                        <div className="col-span-1 p-3 text-center">Mins</div>
                        <div className="col-span-1 p-3 text-center">Goals</div>
                        <div className="col-span-1 p-3 text-center">Assists</div>
                        <div className="col-span-1 p-3 text-center">xG</div>
                        <div className="col-span-1 p-3 text-center">xA</div>
                        <div className="col-span-2 p-3 text-right">Value</div>
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
                                <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center text-xs font-bold text-emerald-400">
                                  {(player.Player || '?').substring(0, 2).toUpperCase()}
                                </div>
                                <div className={`absolute -bottom-1 -right-1 px-1 py-0 rounded text-[7px] font-bold ${pSeasonColors.bg} ${pSeasonColors.text} border ${pSeasonColors.border}`}>
                                  {pSeason}
                                </div>
                              </div>
                              <span className="text-white font-medium truncate">{player.Player || 'Unknown'}</span>
                            </div>
                            <div className="col-span-1 p-3 text-center text-slate-400">{player.Age}</div>
                            <div className="col-span-1 p-3 text-center">
                              <span className="px-2 py-0.5 rounded bg-slate-800 text-xs text-slate-300">{player.Position}</span>
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
