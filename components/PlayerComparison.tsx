import React, { useState, useMemo, useCallback } from 'react';
import { PlayerData, extractSeason, getSeasonColor, getPlayerSeasonId, getSeasonShortLabel } from '../types';
import { Search, X, Settings2, Plus, TrendingUp, Percent, Check, Users, Trash2, Calendar, ArrowRight } from 'lucide-react';
import { ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, Legend, Tooltip } from 'recharts';
import { queryService } from '../services/queryService';
import { getMetricKeys } from '../utils/positionMetrics';
import { metricLabel, positionLabel } from '../utils/labels';
import { PhotoOverlay, TeamLine, TeamLogo, CompetitionBadge, CountryFlag } from './Media';

interface PlayerComparisonProps {
  data: PlayerData[];
}

const DEFAULT_METRICS = [
  'Goals', 'xG', 'Assists', 'xA', 'Passes per 90', 
  'Accurate passes, %', 'Duels won, %', 'Successful defensive actions per 90'
];

// Distinct colors for up to 4 players
const PLAYER_COLORS = [
  { stroke: '#10b981', fill: '#10b981', name: 'Emerald' }, // Player 1
  { stroke: '#a855f7', fill: '#a855f7', name: 'Purple' },  // Player 2
  { stroke: '#3b82f6', fill: '#3b82f6', name: 'Blue' },    // Player 3
  { stroke: '#f59e0b', fill: '#f59e0b', name: 'Amber' }    // Player 4
];

const PlayerComparison: React.FC<PlayerComparisonProps> = ({ data }) => {
  const [selectedPlayers, setSelectedPlayers] = useState<PlayerData[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  
  const [selectedMetrics, setSelectedMetrics] = useState<string[]>(DEFAULT_METRICS);
  const [showMetricConfig, setShowMetricConfig] = useState(false);
  const [metricSearch, setMetricSearch] = useState('');
  const [viewMode, setViewMode] = useState<'raw' | 'percentile'>('raw');

  // Filter numeric keys
  const numericKeys = useMemo(() => {
    if (data.length === 0) return [];
    return getMetricKeys(data);
  }, [data]);

  const searchResults = useMemo(() => {
    if (!searchTerm) return [];
    // Utilisation du queryService pour la recherche rapide
    // Retourne jusqu'à 12 résultats pour voir les versions de saisons différentes
    return queryService.searchPlayers(searchTerm, { limit: 12 });
  }, [searchTerm]);

  const addPlayer = (player: PlayerData) => {
    // Permettre d'ajouter le même joueur sur différentes saisons
    const playerId = getPlayerSeasonId(player);
    const alreadyExists = selectedPlayers.some(p => getPlayerSeasonId(p) === playerId);
    
    if (selectedPlayers.length < 4 && !alreadyExists) {
      setSelectedPlayers([...selectedPlayers, player]);
      setIsSearching(false);
      setSearchTerm('');
    }
  };

  const removePlayer = (index: number) => {
    const newPlayers = [...selectedPlayers];
    newPlayers.splice(index, 1);
    setSelectedPlayers(newPlayers);
  };

  const toggleMetric = (key: string) => {
    if (selectedMetrics.includes(key)) {
      setSelectedMetrics(prev => prev.filter(k => k !== key));
    } else {
      setSelectedMetrics(prev => [...prev, key]);
    }
  };

  const calculatePercentile = (val: number, key: string) => {
    const values = data.map(p => Number(p[key]) || 0).sort((a, b) => a - b);
    const rank = values.findIndex(v => v >= val);
    return Math.round(((rank + 1) / values.length) * 100);
  };

  // Prepare chart data
  const chartData = useMemo(() => {
    if (selectedPlayers.length === 0) return [];

    return selectedMetrics.map(key => {
        const item: any = {
            subject: metricLabel(key),
            fullSubject: key,
            fullMark: 100
        };

        // Normalize each player's value relative to the max in the entire dataset for that metric
        const max = Math.max(...data.map(d => Number(d[key]) || 0)) || 1;

        selectedPlayers.forEach(p => {
             const val = Number(p[key]) || 0;
             // Store normalized value (0-100) for the Radar Chart
             item[p.Player] = Math.round((val / max) * 100);
        });

        return item;
    });
  }, [selectedPlayers, selectedMetrics, data]);

  return (
    <div className="flex flex-col h-full animate-fade-in gap-6 max-w-7xl mx-auto pb-10">
      
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
           <h1 className="text-3xl font-bold text-ink mb-1">Comparaison de joueurs</h1>
           <p className="text-ink-3">Comparez jusqu'à 4 joueurs ({selectedPlayers.length}/4 choisis).</p>
        </div>
        
        {selectedPlayers.length > 0 && (
           <div className="flex bg-raised p-1 rounded-md border border-line">
                <button 
                  onClick={() => setViewMode('raw')}
                  className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${viewMode === 'raw' ? 'bg-overlay text-ink ' : 'text-ink-3 hover:text-ink'}`}
                >
                  <TrendingUp className="w-4 h-4" />
                  Valeurs
                </button>
                <button 
                  onClick={() => setViewMode('percentile')}
                  className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${viewMode === 'percentile' ? 'bg-overlay text-ink ' : 'text-ink-3 hover:text-ink'}`}
                >
                  <Percent className="w-4 h-4" />
                  Percentiles
                </button>
           </div>
        )}
      </div>

      {/* Player Selection Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
         {/* Render Selected Players */}
         {selectedPlayers.map((player, idx) => {
            const season = extractSeason(player.League);
            const seasonColors = getSeasonColor(season);
            return (
            <div 
               key={getPlayerSeasonId(player)} 
               className="relative bg-raised border border-line rounded-lg p-4 flex flex-col gap-3 group hover:border-line-strong transition-all"
               style={{ borderTop: `4px solid ${PLAYER_COLORS[idx].stroke}` }}
            >
               <button 
                  onClick={() => removePlayer(idx)}
                  className="absolute top-2 right-2 p-1.5 text-ink-3 hover:text-neg hover:bg-overlay rounded-md transition-colors"
               >
                  <X className="w-4 h-4" />
               </button>

               <div className="flex items-center gap-3">
                  <div className="relative">
                    <div className="relative overflow-hidden w-12 h-12 rounded-md bg-surface border border-line flex items-center justify-center text-lg font-bold text-ink-3">
                       {(player.Player || '??').substring(0, 2).toUpperCase()}
                       <PhotoOverlay src={player.Image} alt={player.Player} />
                    </div>
                    {/* Season Badge */}
                    <div className={`absolute -bottom-1 -right-1 px-1.5 py-0.5 rounded text-[9px] font-bold ${seasonColors.bg} ${seasonColors.text} border ${seasonColors.border}`}>
                      {getSeasonShortLabel(season)}
                    </div>
                  </div>
                  <div className="min-w-0">
                     <h3 className="font-bold text-ink truncate pr-4">{player.Player || 'Inconnu'}</h3>
                     <p className="text-xs text-ink-3 truncate"><TeamLine player={player} /></p>
                  </div>
               </div>

               <div className="grid grid-cols-2 gap-2 mt-auto">
                   <div className="px-2 py-1.5 bg-surface rounded text-center">
                      <div className="text-[10px] text-ink-3 uppercase font-bold">Âge</div>
                      <div className="text-sm font-mono text-ink-2">{player.Age}</div>
                   </div>
                   <div className="px-2 py-1.5 bg-surface rounded text-center">
                      <div className="text-[10px] text-ink-3 uppercase font-bold">Poste</div>
                      <div className="text-sm font-mono text-ink-2">{positionLabel(player.Position)}</div>
                   </div>
               </div>
            </div>
         );
         })}

         {/* Add Player Button / Search Input */}
         {selectedPlayers.length < 4 && (
            <div className="relative h-full min-h-[140px]">
               {!isSearching ? (
                  <button 
                     onClick={() => setIsSearching(true)}
                     className="w-full h-full border-2 border-dashed border-line hover:border-accent/50 hover:bg-accent/5 rounded-lg flex flex-col items-center justify-center gap-2 text-ink-3 hover:text-accent transition-all group"
                  >
                     <div className="w-12 h-12 rounded-full bg-raised flex items-center justify-center group-hover:scale-110 transition-transform">
                        <Plus className="w-6 h-6" />
                     </div>
                     <span className="font-medium">Ajouter un joueur</span>
                  </button>
               ) : (
                  <div className="w-full h-full bg-raised border border-accent rounded-lg p-4 flex flex-col ">
                      <div className="flex items-center gap-2 border-b border-line pb-2 mb-2">
                         <Search className="w-4 h-4 text-accent" />
                         <input 
                           autoFocus
                           type="text" 
                           placeholder="Nom du joueur..." 
                           className="bg-transparent border-none p-0 text-sm text-ink w-full focus:ring-0 placeholder-ink-4"
                           value={searchTerm}
                           onChange={(e) => setSearchTerm(e.target.value)}
                         />
                         <button onClick={() => setIsSearching(false)} className="text-ink-3 hover:text-ink"><X className="w-4 h-4" /></button>
                      </div>
                      <div className="flex-1 overflow-y-auto custom-scrollbar -mr-2 pr-2">
                         {searchResults.map(p => {
                            const pSeason = extractSeason(p.League);
                            const pSeasonColors = getSeasonColor(pSeason);
                            return (
                            <button 
                               key={getPlayerSeasonId(p)}
                               onClick={() => addPlayer(p)}
                               className="w-full text-left py-2 px-2 hover:bg-overlay rounded flex items-center gap-2 group"
                            >
                                <div className="relative">
                                  <div className="relative overflow-hidden w-7 h-7 rounded bg-surface flex items-center justify-center text-[10px] text-ink-3 group-hover:text-accent">
                                     {(p.Player || '?').substring(0,1)}
                                     <PhotoOverlay src={p.Image} alt={p.Player} />
                                  </div>
                                  <div className={`absolute -bottom-0.5 -right-0.5 px-1 py-0 rounded text-[7px] font-bold ${pSeasonColors.bg} ${pSeasonColors.text}`}>
                                    {getSeasonShortLabel(pSeason)}
                                  </div>
                                </div>
                                <div className="min-w-0 flex-1">
                                   <div className="text-xs font-bold text-ink-2 truncate">{p.Player || 'Inconnu'}</div>
                                   <div className="text-[10px] text-ink-4 truncate"><TeamLine player={p} /></div>
                                </div>
                            </button>
                            );
                         })}
                         {searchTerm && searchResults.length === 0 && (
                            <div className="text-center text-xs text-ink-3 py-4">Aucun résultat</div>
                         )}
                      </div>
                  </div>
               )}
            </div>
         )}
      </div>

      {/* Comparison Area */}
      {selectedPlayers.length > 0 && (
        <>
            <div className="flex justify-end">
                <button 
                onClick={() => setShowMetricConfig(!showMetricConfig)}
                className={`flex items-center gap-2 px-4 py-2 rounded-md border transition-all text-sm ${showMetricConfig ? 'bg-accent/10 border-accent text-accent' : 'bg-raised border-line-strong text-ink-2 hover:bg-overlay'}`}
                >
                    <Settings2 className="w-4 h-4" />
                    Choisir les métriques ({selectedMetrics.length})
                </button>
            </div>

            {/* Metric Configuration Panel */}
            {showMetricConfig && (
            <div className="bg-raised border border-line rounded-lg p-6 animate-fade-in-down">
                <div className="flex items-center gap-4 mb-4">
                    <Search className="w-5 h-5 text-ink-3" />
                    <input 
                        type="text" 
                        placeholder="Rechercher une métrique..." 
                        className="bg-transparent border-none focus:ring-0 text-ink placeholder-ink-4 w-full"
                        value={metricSearch}
                        onChange={(e) => setMetricSearch(e.target.value)}
                    />
                </div>
                <div className="h-px bg-overlay mb-4"></div>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 max-h-60 overflow-y-auto custom-scrollbar">
                    {numericKeys
                        .filter(k => k.toLowerCase().includes(metricSearch.toLowerCase()))
                        .map(key => (
                        <div 
                            key={key} 
                            onClick={() => toggleMetric(key)}
                            className="flex items-center gap-3 p-2 rounded-md hover:bg-overlay cursor-pointer group transition-colors select-none"
                        >
                            <div className={`w-5 h-5 rounded border flex items-center justify-center transition-all ${selectedMetrics.includes(key) ? 'bg-accent border-accent' : 'bg-surface border-line-strong group-hover:border-ink-4'}`}>
                                {selectedMetrics.includes(key) && <Check className="w-3 h-3 text-accent-ink" />}
                            </div>
                            <span className={`text-sm ${selectedMetrics.includes(key) ? 'text-ink' : 'text-ink-3'}`}>{metricLabel(key)}</span>
                        </div>
                    ))}
                </div>
            </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                
                {/* Radar Chart */}
                <div className="bg-surface border border-line rounded-lg p-6 relative overflow-hidden flex flex-col items-center justify-center min-h-[450px]">
                    <div className="absolute top-4 left-4 z-10">
                        <h3 className="text-lg font-bold text-ink-2 flex items-center gap-2">
                             <TrendingUp className="w-5 h-5 text-accent" /> Radar superposé
                        </h3>
                    </div>
                    
                    <div className="w-full h-[400px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <RadarChart cx="50%" cy="50%" outerRadius="70%" data={chartData}>
                                <PolarGrid gridType="polygon" stroke="#334155" strokeWidth={1} strokeDasharray="4 4" />
                                <PolarAngleAxis dataKey="subject" tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 600 }} />
                                <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
                                
                                {selectedPlayers.map((p, idx) => (
                                    <Radar
                                        key={p.Player}
                                        name={p.Player}
                                        dataKey={p.Player}
                                        stroke={PLAYER_COLORS[idx].stroke}
                                        strokeWidth={2}
                                        fill={PLAYER_COLORS[idx].fill}
                                        fillOpacity={0.15}
                                    />
                                ))}
                                
                                <Legend wrapperStyle={{ paddingTop: '20px', fontSize: '12px' }} />
                                <Tooltip 
                                    contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', color: '#f1f5f9', borderRadius: '8px' }}
                                    itemStyle={{ fontSize: '12px', fontWeight: 'bold' }}
                                />
                            </RadarChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Data Table */}
                <div className="lg:col-span-2 bg-surface border border-line rounded-lg overflow-hidden flex flex-col">
                    <div className="flex bg-raised border-b border-line text-xs font-bold uppercase tracking-wider text-ink-3 sticky top-0 z-10">
                        <div className="flex-1 p-4">Métrique</div>
                        {selectedPlayers.map((p, idx) => (
                            <div 
                                key={p.Player || idx} 
                                className="w-24 md:w-32 p-4 text-right truncate" 
                                style={{ color: PLAYER_COLORS[idx].stroke }}
                                title={p.Player || 'Inconnu'}
                            >
                                {(p.Player || 'Inconnu').split(' ').pop()}
                            </div>
                        ))}
                    </div>
                    
                    <div className="overflow-y-auto flex-1 custom-scrollbar p-0">
                        {selectedMetrics.map((key, rowIdx) => {
                            // Determine max value for highlighting
                            const rowValues = selectedPlayers.map(p => Number(p[key]) || 0);
                            const maxVal = Math.max(...rowValues);

                            return (
                                <div key={key} className={`flex items-center hover:bg-raised/40 transition-colors border-b border-line/50 py-3 ${rowIdx % 2 === 0 ? 'bg-raised/10' : ''}`}>
                                    <div className="flex-1 px-4 text-sm text-ink-2 font-medium truncate flex items-center gap-2">
                                        <button 
                                            onClick={() => toggleMetric(key)} 
                                            className="text-ink-4 hover:text-neg opacity-0 group-hover:opacity-100 transition-opacity"
                                            title="Retirer la métrique"
                                        >
                                            <Trash2 className="w-3 h-3" />
                                        </button>
                                        <span title={metricLabel(key)}>{metricLabel(key)}</span>
                                    </div>
                                    
                                    {selectedPlayers.map((p, idx) => {
                                        const val = Number(p[key]) || 0;
                                        const perc = calculatePercentile(val, key);
                                        const isBest = val === maxVal && val !== 0;

                                        return (
                                            <div key={`${p.Player}-${key}`} className="w-24 md:w-32 px-4 text-right">
                                                <div className={`font-mono text-sm ${isBest ? 'font-bold scale-110' : 'text-ink-3'}`} style={{ color: isBest ? PLAYER_COLORS[idx].stroke : undefined }}>
                                                    {viewMode === 'raw' 
                                                        ? (val % 1 !== 0 ? val.toFixed(2) : val) 
                                                        : `${perc}%`
                                                    }
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            );
                        })}
                        {selectedMetrics.length === 0 && (
                             <div className="p-8 text-center text-ink-3 text-sm">
                                Aucune métrique. Utilisez « Choisir les métriques » pour en ajouter.
                             </div>
                        )}
                    </div>
                </div>

            </div>
        </>
      )}

      {selectedPlayers.length === 0 && (
          <div className="flex-1 flex flex-col items-center justify-center text-center opacity-50 p-10">
              <div className="w-24 h-24 bg-raised rounded-full flex items-center justify-center mb-6 border border-line">
                  <Users className="w-10 h-10 text-ink-4" />
              </div>
              <h3 className="text-xl font-bold text-ink mb-2">Aucun joueur choisi</h3>
              <p className="text-ink-3 max-w-sm">Utilisez « Ajouter un joueur » pour composer votre comparaison (4 joueurs au plus).</p>
          </div>
      )}
    </div>
  );
};

export default PlayerComparison;