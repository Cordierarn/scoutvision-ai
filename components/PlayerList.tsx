import React, { useState, useMemo, useEffect } from 'react';
import { PlayerData, extractSeason, getSeasonColor, getPlayerSeasonId } from '../types';
import { Search, ChevronDown, ChevronUp, Eye, Filter, SlidersHorizontal, Plus, X, Calendar, Download, Star } from 'lucide-react';
import { exportToCSV } from '../utils/exportUtils';
import { isInWatchlist, addToWatchlist, removeFromWatchlist } from '../services/storageService';

interface PlayerListProps {
  data: PlayerData[];
  onSelectPlayer: (player: PlayerData) => void;
}

type SortField = keyof PlayerData;
type SortOrder = 'asc' | 'desc';

interface FilterCondition {
  id: string;
  key: string;
  min: number | string;
  max: number | string;
}

const PlayerList: React.FC<PlayerListProps> = ({ data, onSelectPlayer }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [sortField, setSortField] = useState<SortField>('Market value');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [positionFilter, setPositionFilter] = useState<string>('All');
  
  // Advanced Filters State
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [activeFilters, setActiveFilters] = useState<FilterCondition[]>([]);

  // Watchlist State
  const [watchlistIds, setWatchlistIds] = useState<Set<string>>(new Set());
  
  // Update watchlist IDs for UI
  useEffect(() => {
    const updateWatchlistIds = () => {
      const ids = new Set<string>();
      data.forEach(p => {
        if (isInWatchlist(p)) {
          ids.add(getPlayerSeasonId(p));
        }
      });
      setWatchlistIds(ids);
    };
    updateWatchlistIds();
  }, [data]);

  const toggleWatchlist = (player: PlayerData, e: React.MouseEvent) => {
    e.stopPropagation();
    const playerId = getPlayerSeasonId(player);
    
    if (watchlistIds.has(playerId)) {
      removeFromWatchlist(player);
      setWatchlistIds(prev => {
        const newSet = new Set(prev);
        newSet.delete(playerId);
        return newSet;
      });
    } else {
      addToWatchlist(player);
      setWatchlistIds(prev => new Set(prev).add(playerId));
    }
  };

  const positions = useMemo(() => {
    const posSet = new Set(data.map(p => p.Position).filter(Boolean));
    return ['All', ...Array.from(posSet)];
  }, [data]);

  const numericKeys = useMemo(() => {
    if (data.length === 0) return [];
    return Object.keys(data[0]).filter(key => 
      typeof data[0][key] === 'number' &&
      !['Age', 'Market value', 'Height', 'Weight', 'Matches played', 'Minutes played'].includes(key)
    ).sort();
  }, [data]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('desc');
    }
  };

  const addFilter = () => {
    if (numericKeys.length === 0) return;
    const newFilter: FilterCondition = {
      id: Math.random().toString(36).substr(2, 9),
      key: numericKeys[0],
      min: '',
      max: ''
    };
    setActiveFilters([...activeFilters, newFilter]);
  };

  const updateFilter = (id: string, field: keyof FilterCondition, value: any) => {
    setActiveFilters(activeFilters.map(f => f.id === id ? { ...f, [field]: value } : f));
  };

  const removeFilter = (id: string) => {
    setActiveFilters(activeFilters.filter(f => f.id !== id));
  };

  const filteredAndSortedData = useMemo(() => {
    let result = [...data];

    // Text Search - avec vérification null et type
    if (searchTerm) {
      const lower = searchTerm.toLowerCase();
      result = result.filter(p => {
        const playerName = typeof p.Player === 'string' ? p.Player.toLowerCase() : '';
        const teamName = typeof p.Team === 'string' ? p.Team.toLowerCase() : '';
        return playerName.includes(lower) || teamName.includes(lower);
      });
    }

    // Position Filter
    if (positionFilter !== 'All') {
      result = result.filter(p => p.Position === positionFilter);
    }

    // Advanced Numeric Filters
    if (activeFilters.length > 0) {
      result = result.filter(p => {
        return activeFilters.every(filter => {
           const val = Number(p[filter.key]) || 0;
           const min = filter.min === '' ? -Infinity : Number(filter.min);
           const max = filter.max === '' ? Infinity : Number(filter.max);
           return val >= min && val <= max;
        });
      });
    }

    // Sort
    result.sort((a, b) => {
      const valA = a[sortField];
      const valB = b[sortField];

      if (valA === undefined || valB === undefined) return 0;

      if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
      if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });

    return result;
  }, [data, searchTerm, positionFilter, sortField, sortOrder, activeFilters]);

  const formatValue = (val: number) => {
    if (val >= 1000000) return `€${(val / 1000000).toFixed(1)}M`;
    if (val >= 1000) return `€${(val / 1000).toFixed(0)}K`;
    return `€${val}`;
  };

  return (
    <div className="bg-slate-950 rounded-2xl border border-slate-800 flex flex-col h-full overflow-hidden shadow-xl">
      {/* Toolbar */}
      <div className="p-4 border-b border-slate-800 flex flex-col gap-4">
         <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
            <div className="relative w-full md:w-96">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input 
                type="text" 
                placeholder="Search player or team..." 
                className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-10 pr-4 py-2 text-sm text-slate-200 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            
            <div className="flex items-center gap-3 w-full md:w-auto overflow-x-auto">
              <button 
                onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors border ${showAdvancedFilters ? 'bg-emerald-500/10 border-emerald-500 text-emerald-400' : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-slate-200'}`}
              >
                <SlidersHorizontal className="w-4 h-4" />
                Advanced Filters
                {activeFilters.length > 0 && (
                   <span className="bg-emerald-500 text-slate-950 text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center">
                     {activeFilters.length}
                   </span>
                )}
              </button>

              <div className="h-6 w-px bg-slate-800 mx-2"></div>

              <div className="flex items-center gap-2 px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-slate-400 whitespace-nowrap">
                <Filter className="w-4 h-4" />
                <select 
                  value={positionFilter} 
                  onChange={(e) => setPositionFilter(e.target.value)}
                  className="bg-transparent border-none focus:ring-0 text-slate-200 cursor-pointer p-0"
                >
                  {positions.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              
              <button
                onClick={() => exportToCSV(filteredAndSortedData.slice(0, 500), 'players')}
                disabled={filteredAndSortedData.length === 0}
                className="flex items-center gap-2 px-3 py-2 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 rounded-lg transition-colors text-sm disabled:opacity-50"
                title="Export first 500 results"
              >
                <Download className="w-4 h-4" />
                Export
              </button>
              
              <div className="px-3 py-2 bg-slate-900 rounded-lg text-sm text-slate-400 whitespace-nowrap">
                {filteredAndSortedData.length} Players found
              </div>
            </div>
         </div>
         
         {/* Advanced Filters Panel */}
         {showAdvancedFilters && (
           <div className="bg-slate-900/50 rounded-xl border border-slate-800 p-4 animate-fade-in-down">
              <div className="flex items-center justify-between mb-4">
                 <h3 className="text-sm font-bold text-white flex items-center gap-2">
                   Active Conditions
                   <span className="text-xs font-normal text-slate-500">(Match All)</span>
                 </h3>
                 <button 
                    onClick={addFilter}
                    className="flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300 font-medium px-2 py-1 bg-emerald-500/10 rounded border border-emerald-500/20"
                 >
                    <Plus className="w-3 h-3" /> Add Condition
                 </button>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                 {activeFilters.map((filter) => (
                    <div key={filter.id} className="flex flex-col gap-2 p-3 bg-slate-950 rounded-lg border border-slate-700 relative group">
                        <button 
                          onClick={() => removeFilter(filter.id)}
                          className="absolute top-2 right-2 text-slate-600 hover:text-rose-500 transition-colors"
                        >
                          <X className="w-4 h-4" />
                        </button>
                        
                        <select 
                           value={filter.key}
                           onChange={(e) => updateFilter(filter.id, 'key', e.target.value)}
                           className="w-full bg-slate-900 border border-slate-700 rounded text-xs text-slate-200 p-1.5 focus:border-emerald-500 focus:ring-0"
                        >
                           {numericKeys.map(k => <option key={k} value={k}>{k}</option>)}
                        </select>
                        
                        <div className="flex items-center gap-2">
                           <div className="flex-1">
                              <input 
                                type="number" 
                                placeholder="Min" 
                                className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white placeholder-slate-600"
                                value={filter.min}
                                onChange={(e) => updateFilter(filter.id, 'min', e.target.value)}
                              />
                           </div>
                           <span className="text-slate-600 text-xs">-</span>
                           <div className="flex-1">
                              <input 
                                type="number" 
                                placeholder="Max" 
                                className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white placeholder-slate-600"
                                value={filter.max}
                                onChange={(e) => updateFilter(filter.id, 'max', e.target.value)}
                              />
                           </div>
                        </div>
                    </div>
                 ))}
                 {activeFilters.length === 0 && (
                    <div className="col-span-full py-4 text-center text-sm text-slate-500 border border-dashed border-slate-800 rounded-lg">
                       No advanced filters active. Click "Add Condition" to filter by specific stats (e.g., xG superieur 0.5).
                    </div>
                 )}
              </div>
           </div>
         )}
      </div>

      {/* Table Header */}
      <div className="grid grid-cols-12 bg-slate-900/80 backdrop-blur-md border-b border-slate-800 text-xs font-bold text-slate-400 uppercase tracking-wider sticky top-0 z-10 shadow-sm">
        <div className="col-span-3 p-4 cursor-pointer hover:text-emerald-400 flex items-center gap-2 transition-colors" onClick={() => handleSort('Player')}>
          Player {sortField === 'Player' && (sortOrder === 'asc' ? <ChevronUp className="w-3 h-3 text-emerald-500" /> : <ChevronDown className="w-3 h-3 text-emerald-500" />)}
        </div>
        <div className="col-span-1 p-4 cursor-pointer hover:text-emerald-400 transition-colors" onClick={() => handleSort('Age')}>Age</div>
        <div className="col-span-1 p-4 cursor-pointer hover:text-emerald-400 transition-colors" onClick={() => handleSort('Position')}>Pos</div>
        <div className="col-span-2 p-4 cursor-pointer hover:text-emerald-400 transition-colors" onClick={() => handleSort('Team')}>Team</div>
        <div className="col-span-2 p-4 cursor-pointer hover:text-emerald-400 text-right transition-colors" onClick={() => handleSort('Market value')}>Value</div>
        <div className="col-span-1 p-4 cursor-pointer hover:text-emerald-400 text-right transition-colors" onClick={() => handleSort('xG')}>xG</div>
        <div className="col-span-1 p-4 cursor-pointer hover:text-emerald-400 text-right transition-colors" onClick={() => handleSort('xA')}>xA</div>
        <div className="col-span-1 p-4 text-center">Action</div>
      </div>

      {/* List Content */}
      <div className="flex-1 overflow-y-auto custom-scrollbar bg-slate-950/50">
        {filteredAndSortedData.length > 0 ? (
          filteredAndSortedData.map((player, idx) => {
            const season = extractSeason(player.League);
            const seasonColors = getSeasonColor(season);
            return (
            <div 
              key={`${player.Player}-${player.Team}-${season}-${idx}`} 
              className="grid grid-cols-12 border-b border-slate-800/50 hover:bg-white/5 transition-all duration-200 group items-center"
            >
              <div className="col-span-3 p-4 flex items-center gap-3">
                <div className="relative">
                  <div className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center text-xs font-bold text-slate-300 border border-slate-700 group-hover:border-emerald-500/50 group-hover:text-emerald-400 transition-colors">
                    {(player.Player || '?').substring(0, 1)}
                  </div>
                  {/* Season Badge */}
                  <div className={`absolute -bottom-1 -right-1 px-1.5 py-0.5 rounded text-[9px] font-bold ${seasonColors.bg} ${seasonColors.text} border ${seasonColors.border}`}>
                    {season}
                  </div>
                </div>
                <div className="min-w-0">
                  <div className="font-bold text-sm text-slate-200 group-hover:text-white truncate">{player.Player}</div>
                  <div className="text-xs text-slate-500 truncate">{player.Birth_country}</div>
                </div>
              </div>
              <div className="col-span-1 p-4 text-sm text-slate-400 font-medium">{player.Age}</div>
              <div className="col-span-1 p-4">
                <span className="px-2 py-1 rounded bg-slate-800 border border-slate-700 text-xs font-bold text-slate-300 group-hover:border-emerald-500/30 group-hover:text-emerald-400 transition-colors">
                  {player.Position}
                </span>
              </div>
              <div className="col-span-2 p-4 text-sm text-slate-400 truncate group-hover:text-slate-300 transition-colors">{player.Team}</div>
              <div className="col-span-2 p-4 text-sm font-mono text-right text-emerald-400 font-bold tracking-tight">
                {formatValue(Number(player['Market value']) || 0)}
              </div>
              <div className="col-span-1 p-4 text-sm font-mono text-right text-slate-300">
                {(Number(player.xG) || 0).toFixed(2)}
              </div>
              <div className="col-span-1 p-4 text-sm font-mono text-right text-slate-300">
                {(Number(player.xA) || 0).toFixed(2)}
              </div>
              <div className="col-span-1 p-4 flex justify-center gap-1">
                <button 
                  onClick={(e) => toggleWatchlist(player, e)}
                  className={`p-2 rounded-lg transition-all ${
                    watchlistIds.has(getPlayerSeasonId(player))
                      ? 'bg-yellow-500/20 text-yellow-400'
                      : 'bg-slate-800 text-slate-500 hover:text-yellow-400 hover:bg-yellow-500/10'
                  }`}
                  title={watchlistIds.has(getPlayerSeasonId(player)) ? 'Remove from Watchlist' : 'Add to Watchlist'}
                >
                  <Star className={`w-4 h-4 ${watchlistIds.has(getPlayerSeasonId(player)) ? 'fill-yellow-400' : ''}`} />
                </button>
                <button 
                  onClick={() => onSelectPlayer(player)}
                  className="p-2 rounded-lg bg-slate-800 text-slate-400 hover:bg-emerald-500 hover:text-white transition-all shadow-sm hover:shadow-emerald-500/20"
                  title="View Profile"
                >
                  <Eye className="w-4 h-4" />
                </button>
              </div>
            </div>
          );
          })
        ) : (
          <div className="flex flex-col items-center justify-center h-64 text-slate-500">
            <Search className="w-12 h-12 mb-4 opacity-20" />
            <p>No players found matching your criteria.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default PlayerList;