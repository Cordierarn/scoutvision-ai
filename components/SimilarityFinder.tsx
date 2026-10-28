import React, { useState, useMemo, useCallback } from 'react';
import { PlayerData, extractSeason, getSeasonColor, getPlayerSeasonId, getSeasonShortLabel } from '../types';
import { Search, GitCompare, ArrowRight, User, Check, X } from 'lucide-react';
import { ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, Legend } from 'recharts';
import { queryService } from '../services/queryService';
import { 
  getSimilarityMetricsForPosition, 
  getRadarMetricsForPosition, 
  filterAvailableMetrics,
  getPositionCategory,
  getPositionCategoryLabel,
  getTopPerformingMetrics
} from '../utils/positionMetrics';
import { metricLabel, positionLabel } from '../utils/labels';
import { PhotoOverlay, TeamLine, TeamLogo, CompetitionBadge, CountryFlag } from './Media';

interface SimilarityFinderProps {
  data: PlayerData[];
  onSelectPlayer: (player: PlayerData) => void;
}

// Keys to exclude from the mathematical similarity calculation
const EXCLUDED_KEYS = [
  'Player', 'Team', 'Team within selected timeframe', 'Position', 
  'Birth country', 'Passport country', 'Foot', 'On loan', 'League', 
  'Contract expires', 'Main Position', 'Age', 'Market value', 
  'Height', 'Weight', 'Matches played', 'Minutes played'
];

interface SimilarityResult {
  player: PlayerData;
  score: number; // 0 to 100 match percentage
  distance: number;
}

const SimilarityFinder: React.FC<SimilarityFinderProps> = ({ data, onSelectPlayer }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [referencePlayer, setReferencePlayer] = useState<PlayerData | null>(null);
  const [samePositionOnly, setSamePositionOnly] = useState(true);
  const [useTopMetrics, setUseTopMetrics] = useState(true); // New: use player's best metrics

  // 1. Get position-specific metrics for the reference player
  const metricKeys = useMemo(() => {
    if (!referencePlayer) return [];
    
    if (useTopMetrics) {
      // Use player's top performing metrics (where they excel)
      const cohort = data.filter(p => samePositionOnly ? p.Position === referencePlayer.Position : true);
      return getTopPerformingMetrics(referencePlayer, cohort, 12);
    } else {
      // Use position-based metrics
      const positionMetrics = getSimilarityMetricsForPosition(referencePlayer.Position);
      return filterAvailableMetrics(positionMetrics, referencePlayer);
    }
  }, [referencePlayer, data, samePositionOnly, useTopMetrics]);

  // Position category label
  const positionCategory = useMemo(() => {
    if (!referencePlayer) return '';
    const cat = getPositionCategory(referencePlayer.Position);
    return getPositionCategoryLabel(cat);
  }, [referencePlayer]);

  // 2. Pre-calculate Min/Max for normalization
  const bounds = useMemo(() => {
    const b: Record<string, { min: number; max: number }> = {};
    metricKeys.forEach(key => {
      let min = Infinity;
      let max = -Infinity;
      data.forEach(p => {
        const val = Number(p[key]) || 0;
        if (val < min) min = val;
        if (val > max) max = val;
      });
      // Avoid division by zero
      if (max === min) max = min + 1;
      b[key] = { min, max };
    });
    return b;
  }, [data, metricKeys]);

  // 3. Find Similar Players
  const similarPlayers = useMemo(() => {
    if (!referencePlayer) return [];

    const normalize = (val: number, key: string) => {
      return (val - bounds[key].min) / (bounds[key].max - bounds[key].min);
    };

    const results: SimilarityResult[] = data
      .filter(p => referencePlayer['Player ID']
        ? p['Player ID'] !== referencePlayer['Player ID']
        : p.Player !== referencePlayer.Player) // Exclude self (all his teams and competitions)
      .filter(p => !samePositionOnly || p.Position === referencePlayer.Position)
      .map(p => {
        let squaredDiffSum = 0;
        let count = 0;

        metricKeys.forEach(key => {
          const valA = normalize(Number(referencePlayer[key]) || 0, key);
          const valB = normalize(Number(p[key]) || 0, key);
          squaredDiffSum += Math.pow(valA - valB, 2);
          count++;
        });

        // Euclidean distance
        const distance = Math.sqrt(squaredDiffSum);
        
        // Convert distance to a "Match Score" (0-100)
        // Max theoretical distance in N dimensions is sqrt(N). 
        // We normalize the score based on that.
        const maxDist = Math.sqrt(count);
        const score = Math.max(0, 100 * (1 - (distance / (maxDist * 0.6)))); // 0.6 factor to spread scores better

        return { player: p, score, distance };
      })
      .sort((a, b) => b.score - a.score) // Sort by highest score
      .slice(0, 5); // Take top 5

    return results;
  }, [referencePlayer, data, metricKeys, bounds, samePositionOnly]);

  // Chart Data Preparation - Uses position-specific metrics
  const getChartData = (target: PlayerData) => {
    if (!referencePlayer) return [];
    
    // Use position-based radar metrics (8 most relevant for this position)
    const radarMetrics = getRadarMetricsForPosition(referencePlayer.Position);
    const availableMetrics = filterAvailableMetrics(radarMetrics, referencePlayer).slice(0, 8);

    // Percentile par rôle (0-100), sinon valeur rapportée au maximum du dataset
    const scale = (p: PlayerData, key: string) => {
      const pct = p[`${key} pct`];
      if (typeof pct === 'number') return pct;
      const max = Math.max(...data.map(d => Number(d[key]) || 0), 1);
      return Math.round(((Number(p[key]) || 0) / max) * 100);
    };

    return availableMetrics.map(key => ({
      subject: metricLabel(key),
      fullSubject: key,
      Reference: scale(referencePlayer, key),
      Target: scale(target, key),
      fullMark: 100
    }));
  };

  const filteredSearch = useMemo(() => {
    if (!searchTerm) return [];
    // Utilisation du queryService pour la recherche rapide
    return queryService.searchPlayers(searchTerm, { limit: 10 });
  }, [searchTerm]);

  return (
    <div className="flex flex-col h-full animate-fade-in gap-6">
      
      {/* Search Header */}
      <div className="w-full max-w-2xl mx-auto text-center mb-4">
        <h1 className="text-3xl font-bold text-ink mb-2">Joueurs similaires</h1>
        <p className="text-ink-3 mb-6">Trouvez les joueurs au profil statistique le plus proche (distance euclidienne sur les métriques de performance).</p>
        
        <div className="relative z-50">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-ink-3 w-5 h-5" />
            <input 
              type="text" 
              placeholder="Rechercher un joueur de référence..."
              className="w-full bg-overlay border border-line-strong text-ink pl-12 pr-4 py-4 rounded-md focus:ring-2 focus:ring-accent focus:outline-none  text-lg"
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                if (!e.target.value) setReferencePlayer(null);
              }}
              onFocus={() => {
                if(referencePlayer) {
                    setSearchTerm('');
                    setReferencePlayer(null);
                }
              }}
            />
          </div>

          {/* Search Results Dropdown */}
          {searchTerm && !referencePlayer && (
            <div className="absolute top-full left-0 right-0 mt-2 bg-overlay border border-line-strong rounded-md  overflow-hidden max-h-80 overflow-y-auto">
              {filteredSearch.map((p, idx) => {
                const pSeason = extractSeason(p.League);
                const pSeasonColors = getSeasonColor(pSeason);
                return (
                <button 
                  key={getPlayerSeasonId(p)}
                  onClick={() => {
                    setReferencePlayer(p);
                    setSearchTerm(p.Player || '');
                  }}
                  className="w-full text-left px-4 py-3 hover:bg-line-strong flex items-center justify-between group transition-colors border-b border-line-strong/50 last:border-0"
                >
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      <div className="relative overflow-hidden w-9 h-9 rounded-full bg-raised flex items-center justify-center text-xs font-bold text-ink-3 group-hover:text-accent group-hover:bg-accent/10 transition-colors">
                          {(p.Player || '??').substring(0, 2).toUpperCase()}
                          <PhotoOverlay src={p.Image} alt={p.Player} />
                      </div>
                      <div className={`absolute -bottom-1 -right-1 px-1.5 py-0 rounded text-[8px] font-bold ${pSeasonColors.bg} ${pSeasonColors.text} border ${pSeasonColors.border}`}>
                        {getSeasonShortLabel(pSeason)}
                      </div>
                    </div>
                    <div>
                        <div className="font-medium text-ink">{p.Player || 'Inconnu'}</div>
                        <div className="text-xs text-ink-3 flex items-center gap-1"><TeamLine player={p} /> • {positionLabel(p.Position) || 'N/A'}</div>
                    </div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-ink-4 group-hover:text-accent opacity-0 group-hover:opacity-100 transition-all transform -translate-x-2 group-hover:translate-x-0" />
                </button>
                );
              })}
              {filteredSearch.length === 0 && (
                  <div className="p-4 text-ink-3 text-center text-sm">Aucun joueur trouvé</div>
              )}
            </div>
          )}
        </div>
      </div>

      {referencePlayer && (
        <div className="flex flex-col lg:flex-row gap-6 flex-1 min-h-0">
            {/* Left: Settings & Reference */}
            <div className="w-full lg:w-80 flex flex-col gap-4">
                <div className="bg-surface border border-line rounded-lg p-6  relative overflow-hidden group">
                    <div className="absolute top-0 right-0 p-24 bg-accent/5 rounded-full  -mr-10 -mt-10 pointer-events-none"></div>
                    <div className="relative z-10">
                        <h2 className="text-xs font-bold text-accent uppercase tracking-widest mb-4">Joueur de référence</h2>
                        {(() => {
                          const refSeason = extractSeason(referencePlayer.League);
                          const refSeasonColors = getSeasonColor(refSeason);
                          return (
                            <div className="relative w-20 h-20 mb-4">
                              <div className="relative overflow-hidden w-20 h-20 bg-overlay rounded-lg flex items-center justify-center text-2xl font-bold text-ink-2 border-2 border-line-strong">
                                {(referencePlayer.Player || '??').substring(0, 2).toUpperCase()}
                                <PhotoOverlay src={referencePlayer.Image} alt={referencePlayer.Player} />
                              </div>
                              <div className={`absolute -bottom-1 -right-1 px-2 py-0.5 rounded text-[10px] font-bold ${refSeasonColors.bg} ${refSeasonColors.text} border ${refSeasonColors.border}`}>
                                {getSeasonShortLabel(refSeason)}
                              </div>
                            </div>
                          );
                        })()}
                        <h3 className="text-2xl font-bold text-ink leading-tight mb-1">{referencePlayer.Player || 'Inconnu'}</h3>
                        <p className="text-ink-3 text-sm mb-4"><TeamLine player={referencePlayer} /></p>
                        
                        <div className="flex items-center gap-2 mb-2">
                             <span className="px-2 py-1 bg-overlay rounded border border-line-strong text-xs text-ink-2 font-mono">{positionLabel(referencePlayer.Position)}</span>
                             <span className="px-2 py-1 bg-overlay rounded border border-line-strong text-xs text-ink-2 font-mono">{referencePlayer.Age ?? '–'} ans</span>
                        </div>
                        <div className="text-accent font-mono font-bold text-lg mt-2">
                             {typeof referencePlayer["Market value"] === 'number' ? `€${referencePlayer["Market value"].toLocaleString()}` : '–'}
                        </div>
                    </div>
                </div>

                <div className="bg-surface border border-line rounded-lg p-5 ">
                     <h3 className="text-sm font-semibold text-ink-2 mb-3">Paramètres</h3>
                     
                     <div className="space-y-3">
                       {/* Position Category Badge */}
                       <div className="flex items-center justify-between text-xs">
                         <span className="text-ink-3">Type de poste</span>
                         <span className="px-2 py-1 bg-accent/10 text-accent rounded font-medium">{positionCategory}</span>
                       </div>
                       
                       {/* Metrics Used Count */}
                       <div className="flex items-center justify-between text-xs">
                         <span className="text-ink-3">Métriques comparées</span>
                         <span className="text-ink-2 font-mono">{metricKeys.length}</span>
                       </div>
                       
                       <div className="h-px bg-overlay my-2"></div>
                       
                       {/* Same Position Filter */}
                       <label className="flex items-center gap-3 cursor-pointer group">
                          <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${samePositionOnly ? 'bg-accent border-accent' : 'bg-raised border-line-strong group-hover:border-ink-4'}`}>
                               {samePositionOnly && <Check className="w-3 h-3 text-accent-ink" />}
                          </div>
                          <input type="checkbox" className="hidden" checked={samePositionOnly} onChange={() => setSamePositionOnly(!samePositionOnly)} />
                          <span className="text-sm text-ink-3 group-hover:text-ink transition-colors">Même poste uniquement</span>
                       </label>
                       
                       {/* Top Metrics Toggle */}
                       <label className="flex items-center gap-3 cursor-pointer group">
                          <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${useTopMetrics ? 'bg-purple-500 border-purple-500' : 'bg-raised border-line-strong group-hover:border-ink-4'}`}>
                               {useTopMetrics && <Check className="w-3 h-3 text-accent-ink" />}
                          </div>
                          <input type="checkbox" className="hidden" checked={useTopMetrics} onChange={() => setUseTopMetrics(!useTopMetrics)} />
                          <span className="text-sm text-ink-3 group-hover:text-ink transition-colors">Utiliser ses meilleures métriques</span>
                       </label>
                     </div>
                     
                     {/* Metrics Preview */}
                     {metricKeys.length > 0 && (
                       <div className="mt-4 pt-3 border-t border-line">
                         <div className="text-[10px] uppercase text-ink-4 font-bold mb-2">Métriques de comparaison</div>
                         <div className="flex flex-wrap gap-1">
                           {metricKeys.slice(0, 6).map(m => (
                             <span key={m} className="px-1.5 py-0.5 bg-raised rounded text-[9px] text-ink-3 truncate max-w-[80px]" title={metricLabel(m)}>
                               {metricLabel(m).replace(' par 90', '')}
                             </span>
                           ))}
                           {metricKeys.length > 6 && (
                             <span className="px-1.5 py-0.5 text-[9px] text-ink-4">+{metricKeys.length - 6}</span>
                           )}
                         </div>
                       </div>
                     )}
                </div>
            </div>

            {/* Right: Results */}
            <div className="flex-1 flex flex-col gap-4 overflow-hidden">
                <h2 className="text-lg font-semibold text-ink flex items-center gap-2">
                    <GitCompare className="w-5 h-5 text-purple-400" />
                    Profils les plus proches
                </h2>
                
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 overflow-y-auto pb-10 pr-2 custom-scrollbar">
                    {similarPlayers.map(({ player, score }, idx) => {
                        const playerSeason = extractSeason(player.League);
                        const playerSeasonColors = getSeasonColor(playerSeason);
                        return (
                        <div key={getPlayerSeasonId(player)} className="bg-surface border border-line rounded-lg p-0 overflow-hidden hover:border-line-strong transition-all flex flex-col">
                            <div className="p-4 border-b border-line/50 flex justify-between items-start bg-raised/30">
                                <div className="flex items-center gap-3">
                                    <div className="relative">
                                      <div className="relative overflow-hidden w-10 h-10 rounded-full bg-overlay flex items-center justify-center text-xs font-bold text-ink-3 border border-line-strong">
                                          {(player.Player || '??').substring(0, 2).toUpperCase()}
                                          <PhotoOverlay src={player.Image} alt={player.Player} />
                                      </div>
                                      <div className={`absolute -bottom-1 -right-1 px-1.5 py-0 rounded text-[8px] font-bold ${playerSeasonColors.bg} ${playerSeasonColors.text} border ${playerSeasonColors.border}`}>
                                        {getSeasonShortLabel(playerSeason)}
                                      </div>
                                    </div>
                                    <div>
                                        <div className="font-bold text-ink text-sm">{player.Player || 'Inconnu'}</div>
                                        <div className="text-xs text-ink-3 truncate max-w-[160px]"><TeamLine player={player} /></div>
                                    </div>
                                </div>
                                <div className="flex flex-col items-end">
                                    <div className={`text-lg font-bold ${score > 85 ? 'text-accent' : score > 70 ? 'text-warn' : 'text-ink-3'}`}>
                                        {score.toFixed(0)}%
                                    </div>
                                    <div className="text-[10px] text-ink-4 uppercase tracking-wider font-bold">Similarité</div>
                                </div>
                            </div>
                            
                            {/* Mini Radar Comparison */}
                            <div className="h-40 w-full relative bg-surface/50">
                                <ResponsiveContainer width="100%" height="100%">
                                    <RadarChart cx="50%" cy="50%" outerRadius="65%" data={getChartData(player)}>
                                        <PolarGrid stroke="#334155" strokeOpacity={0.5} />
                                        <PolarAngleAxis dataKey="subject" tick={{ fill: '#64748b', fontSize: 8 }} />
                                        <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
                                        <Radar name="Référence" dataKey="Reference" stroke="#10b981" strokeWidth={1} fill="#10b981" fillOpacity={0.1} />
                                        <Radar name="Joueur" dataKey="Target" stroke="#8b5cf6" strokeWidth={2} fill="#8b5cf6" fillOpacity={0.3} />
                                    </RadarChart>
                                </ResponsiveContainer>
                                <div className="absolute bottom-2 right-2 flex gap-3 text-[10px]">
                                     <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-accent"></div><span className="text-ink-3">Référence</span></div>
                                     <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-purple-500"></div><span className="text-ink-3">Joueur</span></div>
                                </div>
                            </div>

                            <div className="p-3 bg-raised/50 mt-auto border-t border-line flex items-center justify-between">
                                <div className="text-xs text-ink-3 font-mono">
                                    €{typeof player["Market value"] === 'number' ? (player["Market value"]/1000000).toFixed(1) + 'M' : '-'}
                                </div>
                                <button 
                                   onClick={() => onSelectPlayer(player)}
                                   className="text-xs bg-overlay hover:bg-line-strong text-ink-2 px-3 py-1.5 rounded-md transition-colors border border-line-strong"
                                >
                                    Voir la fiche
                                </button>
                            </div>
                        </div>
                        );
                    })}
                </div>
            </div>
        </div>
      )}
    </div>
  );
};

export default SimilarityFinder;
