import React, { useState, useMemo, useEffect } from 'react';
import { PlayerData, extractSeason, getSeasonColor, getPlayerSeasonId } from '../types';
import { getAvailableLeagues } from '../utils/scoringUtils';
import { Filter, Gem, Sliders, ChevronRight, Trophy, Coins, TrendingUp, Eye, Minus, Plus, RefreshCw, AlertCircle, Save, Trash2, X, Check, Download, Star } from 'lucide-react';
import { queryService } from '../services/queryService';
import { exportProspects } from '../utils/exportUtils';
import { isInWatchlist, addToWatchlist, removeFromWatchlist } from '../services/storageService';

interface ProspectsProps {
  data: PlayerData[];
  onSelectPlayer: (player: PlayerData) => void;
}

interface RolePreset {
  positions: string[];
  metrics: Record<string, number>;
  custom?: boolean;
  category?: string;
}

// Default Presets - Organized by Position Category
const DEFAULT_ROLE_PRESETS: Record<string, RolePreset> = {
  // ====== 1. GARDIEN DE BUT (Goalkeeper) ======
  'Gardien de Ligne (Shot Stopper)': {
    positions: ['GK'],
    category: '🧤 Gardien de But',
    metrics: {
      'Save rate, %': 74,
      'Prevented goals per 90': 0.10,
      'xG against per 90': 1.2
    }
  },
  'Gardien Libéro (Sweeper Keeper)': {
    positions: ['GK'],
    category: '🧤 Gardien de But',
    metrics: {
      'Exits per 90': 1.5,
      'Accurate passes, %': 85,
      'Accurate long passes, %': 55
    }
  },

  // ====== 2. DÉFENSEUR CENTRAL (Centre Back) ======
  'Relanceur (Ball Playing Defender)': {
    positions: ['CB', 'LCB', 'RCB'],
    category: '🛡️ Défenseur Central',
    metrics: {
      'Forward passes per 90': 20,
      'Progressive passes per 90': 9,
      'Accurate long passes, %': 60,
      'Passes to final third per 90': 7
    }
  },
  'Stoppeur (No-Nonsense Defender)': {
    positions: ['CB', 'LCB', 'RCB'],
    category: '🛡️ Défenseur Central',
    metrics: {
      'Defensive duels won, %': 72,
      'Aerial duels won, %': 65,
      'Successful defensive actions per 90': 10,
      'Shots blocked per 90': 0.7
    }
  },
  'Défenseur d\'Anticipation (Cover Defender)': {
    positions: ['CB', 'LCB', 'RCB'],
    category: '🛡️ Défenseur Central',
    metrics: {
      'PAdj Interceptions': 7.5,
      'Interceptions per 90': 6
    }
  },

  // ====== 3. LATÉRAUX (Full Back / Wing Back) ======
  'Latéral Offensif (Wing Back)': {
    positions: ['RB', 'LB', 'RWB', 'LWB'],
    category: '🏃 Latéraux',
    metrics: {
      'Crosses per 90': 4,
      'Progressive runs per 90': 2.5,
      'Dribbles per 90': 4,
      'Accelerations per 90': 1.5
    }
  },
  'Latéral Défensif': {
    positions: ['RB', 'LB', 'RWB', 'LWB'],
    category: '🏃 Latéraux',
    metrics: {
      'Defensive duels won, %': 68,
      'PAdj Sliding tackles': 2,
      'Successful defensive actions per 90': 9
    }
  },
  'Latéral Intérieur (Inverted)': {
    positions: ['RB', 'LB', 'RWB', 'LWB'],
    category: '🏃 Latéraux',
    metrics: {
      'Passes per 90': 55,
      'Passes to final third per 90': 6,
      'Smart passes per 90': 0.8
    }
  },

  // ====== 4. MILIEU DÉFENSIF (Defensive Midfielder) ======
  'Sentinelle (Anchor Man)': {
    positions: ['DMF', 'LDMF', 'RDMF'],
    category: '⚔️ Milieu Défensif',
    metrics: {
      'PAdj Interceptions': 7,
      'Defensive duels won, %': 65,
      'Aerial duels won, %': 60,
      'Successful defensive actions per 90': 11
    }
  },
  'Regista (Deep-lying Playmaker)': {
    positions: ['DMF', 'LDMF', 'RDMF', 'LCMF', 'RCMF'],
    category: '⚔️ Milieu Défensif',
    metrics: {
      'Passes per 90': 65,
      'Accurate passes, %': 90,
      'Forward passes per 90': 22,
      'Passes to final third per 90': 9
    }
  },

  // ====== 5. MILIEU CENTRAL / RELAYEUR (Central Midfielder) ======
  'Box-to-Box': {
    positions: ['CMF', 'LCMF', 'RCMF', 'DMF'],
    category: '🔄 Milieu Central',
    metrics: {
      'Touches in box per 90': 2.5,
      'Progressive runs per 90': 2,
      'Successful defensive actions per 90': 8,
      'Shots per 90': 1.2
    }
  },
  'Milieu Percuteur (Ball Carrier)': {
    positions: ['CMF', 'LCMF', 'RCMF', 'AMF'],
    category: '🔄 Milieu Central',
    metrics: {
      'Dribbles per 90': 5,
      'Successful dribbles, %': 60,
      'Progressive runs per 90': 3.5,
      'Fouls suffered per 90': 1.8
    }
  },

  // ====== 6. MILIEU OFFENSIF (Attacking Midfielder) ======
  'Meneur de Jeu Avancé (Number 10)': {
    positions: ['AMF', 'LAMF', 'RAMF'],
    category: '🎯 Milieu Offensif',
    metrics: {
      'Smart passes per 90': 1.8,
      'Key passes per 90': 0.9,
      'xA per 90': 0.25,
      'Deep completions per 90': 1.5
    }
  },
  'Neuf et Demi (Shadow Striker)': {
    positions: ['AMF', 'LAMF', 'RAMF', 'CF'],
    category: '🎯 Milieu Offensif',
    metrics: {
      'Goals per 90': 0.35,
      'xG per 90': 0.30,
      'Touches in box per 90': 4.5,
      'Shots per 90': 2.5
    }
  },

  // ====== 7. AILIERS (Wingers) ======
  'Ailier de Débordement (Classic Winger)': {
    positions: ['LW', 'RW', 'LWF', 'RWF', 'LAMF', 'RAMF'],
    category: '⚡ Ailiers',
    metrics: {
      'Crosses per 90': 5,
      'Accurate crosses, %': 35,
      'Dribbles per 90': 6.5,
      'Accelerations per 90': 2
    }
  },
  'Attaquant Intérieur (Inside Forward)': {
    positions: ['LW', 'RW', 'LWF', 'RWF', 'LAMF', 'RAMF'],
    category: '⚡ Ailiers',
    metrics: {
      'Shots per 90': 2.8,
      'Touches in box per 90': 5.5,
      'Non-penalty goals per 90': 0.40
    }
  },
  'Créateur Excentré (Wide Playmaker)': {
    positions: ['LW', 'RW', 'LWF', 'RWF', 'LAMF', 'RAMF'],
    category: '⚡ Ailiers',
    metrics: {
      'Key passes per 90': 0.8,
      'Crosses to goalie box per 90': 0.5,
      'xA per 90': 0.28
    }
  },

  // ====== 8. AVANT-CENTRE (Striker) ======
  'Renard des Surfaces (Poacher)': {
    positions: ['CF'],
    category: '⚽ Avant-Centre',
    metrics: {
      'Goals per 90': 0.55,
      'xG per 90': 0.50,
      'Goal conversion, %': 20,
      'Touches in box per 90': 5
    }
  },
  'Pivot (Target Man)': {
    positions: ['CF'],
    category: '⚽ Avant-Centre',
    metrics: {
      'Aerial duels per 90': 8,
      'Aerial duels won, %': 55,
      'Back passes per 90': 3
    }
  },
  'Faux Neuf (False Nine)': {
    positions: ['CF', 'AMF'],
    category: '⚽ Avant-Centre',
    metrics: {
      'Smart passes per 90': 1.2,
      'Key passes per 90': 0.6,
      'Passes per 90': 25
    }
  },
  'Attaquant de Profondeur (Advanced Forward)': {
    positions: ['CF'],
    category: '⚽ Avant-Centre',
    metrics: {
      'Offensive duels per 90': 12,
      'Progressive runs per 90': 2.5,
      'Accelerations per 90': 1.8
    }
  },

  // ====== 9. SPÉCIALISTES (Bonus) ======
  'Spécialiste Coups de Pied Arrêtés': {
    positions: ['AMF', 'LAMF', 'RAMF', 'CMF', 'LCMF', 'RCMF', 'LW', 'RW', 'CF'],
    category: '🎲 Spécialistes',
    metrics: {
      'Direct free kicks on target, %': 40,
      'Key passes per 90': 0.5
    }
  }
};

const LS_KEY = 'scoutvision_role_presets';

const Prospects: React.FC<ProspectsProps> = ({ data, onSelectPlayer }) => {
  // --- General Filters ---
  const [ageLimit, setAgeLimit] = useState<number>(23);
  const [marketValueLimit, setMarketValueLimit] = useState<number>(30000000); // 30M default
  const [minMinutesPlayed, setMinMinutesPlayed] = useState<number>(500); // Min 500 minutes
  const [selectedLeague, setSelectedLeague] = useState<string>('');
  
  // --- Watchlist State ---
  const [watchlistIds, setWatchlistIds] = useState<Set<string>>(new Set());
  
  // Update watchlist IDs for UI
  useEffect(() => {
    const updateWatchlistIds = () => {
      const ids = new Set<string>();
      // We check which players are in watchlist
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
  
  // --- Role Engine State ---
  const [presets, setPresets] = useState<Record<string, RolePreset>>(() => {
    try {
        const saved = localStorage.getItem(LS_KEY);
        if (saved) {
            return { ...DEFAULT_ROLE_PRESETS, ...JSON.parse(saved) };
        }
    } catch (e) {
        console.error("Failed to load presets", e);
    }
    return DEFAULT_ROLE_PRESETS;
  });

  const [selectedRole, setSelectedRole] = useState<string>('');
  const [strictnessMultiplier, setStrictnessMultiplier] = useState<number>(1.0); // 1.0 = 100% (Base values)

  // --- Custom Preset Builder State ---
  const [isCreatorMode, setIsCreatorMode] = useState(false);
  const [newPresetName, setNewPresetName] = useState('');
  const [newPresetPositions, setNewPresetPositions] = useState<string[]>([]);
  const [newPresetMetrics, setNewPresetMetrics] = useState<{key: string, value: number}[]>([]);
  const [metricSearch, setMetricSearch] = useState('');

  // Derived Data
  // Utiliser queryService pour les listes pré-calculées
  const leagues = useMemo(() => queryService.getAvailableLeagues(), []);
  const roles = Object.keys(presets);
  
  // Get all available numeric keys for the builder
  const availableMetrics = useMemo(() => {
    if (data.length === 0) return [];
    return Object.keys(data[0]).filter(key => 
      typeof data[0][key] === 'number' && 
      !['Age', 'Market value', 'Height', 'Weight', 'Matches played', 'Minutes played'].includes(key)
    ).sort();
  }, [data]);

  const availablePositions = useMemo(() => {
      return queryService.getAvailablePositions();
  }, []);

  // --- Handlers ---
  const handleRoleChange = (role: string) => {
    setSelectedRole(role);
    setStrictnessMultiplier(1.0); // Reset to base strictness on change
  };

  const adjustStrictness = (delta: number) => {
    setStrictnessMultiplier(prev => {
      const newVal = prev + delta;
      return Math.max(0.1, parseFloat(newVal.toFixed(1))); // Min 10%, round to 1 decimal
    });
  };

  const persistPresets = (currentPresets: Record<string, RolePreset>) => {
      // Extract only custom presets to save
      const customOnly: Record<string, RolePreset> = {};
      Object.entries(currentPresets).forEach(([key, val]) => {
          if (val.custom) customOnly[key] = val;
      });
      localStorage.setItem(LS_KEY, JSON.stringify(customOnly));
  };

  const deletePreset = (roleName: string) => {
      const newPresets = { ...presets };
      delete newPresets[roleName];
      setPresets(newPresets);
      persistPresets(newPresets);
      if (selectedRole === roleName) setSelectedRole('');
  };

  const saveCustomPreset = () => {
      if (!newPresetName || newPresetPositions.length === 0 || newPresetMetrics.length === 0) return;
      
      const metricsObj: Record<string, number> = {};
      newPresetMetrics.forEach(m => metricsObj[m.key] = m.value);

      const newPreset: RolePreset = {
          positions: newPresetPositions,
          metrics: metricsObj,
          custom: true
      };

      const updatedPresets = { ...presets, [newPresetName]: newPreset };
      setPresets(updatedPresets);
      persistPresets(updatedPresets);
      
      setSelectedRole(newPresetName);
      setIsCreatorMode(false);
      // Reset form
      setNewPresetName('');
      setNewPresetPositions([]);
      setNewPresetMetrics([]);
  };

  const togglePosition = (pos: string) => {
      if (newPresetPositions.includes(pos)) {
          setNewPresetPositions(newPresetPositions.filter(p => p !== pos));
      } else {
          setNewPresetPositions([...newPresetPositions, pos]);
      }
  };

  const addMetricToPreset = (key: string) => {
      if (!newPresetMetrics.find(m => m.key === key)) {
          setNewPresetMetrics([...newPresetMetrics, { key, value: 0 }]);
      }
      setMetricSearch('');
  };

  const updateMetricValue = (key: string, val: number) => {
      setNewPresetMetrics(newPresetMetrics.map(m => m.key === key ? { ...m, value: val } : m));
  };
  
  const removeMetric = (key: string) => {
      setNewPresetMetrics(newPresetMetrics.filter(m => m.key !== key));
  };

  // --- Core Filtering Logic ---
  const { filteredPlayers, effectiveThresholds } = useMemo(() => {
    if (!selectedRole || !presets[selectedRole]) return { filteredPlayers: [], effectiveThresholds: {} };

    const preset = presets[selectedRole];
    
    // 1. Calculate Effective Thresholds (Base * Multiplier)
    const currentThresholds: Record<string, number> = {};
    Object.entries(preset.metrics).forEach(([key, baseVal]) => {
      // Round to 2 decimals for display cleanliness
      currentThresholds[key] = parseFloat((baseVal * strictnessMultiplier).toFixed(2));
    });

    // 2. Filter Players
    const players = data.filter(p => {
      // A. General Filters
      if ((Number(p.Age) || 100) > ageLimit) return false;
      if ((Number(p["Market value"]) || 0) > marketValueLimit) return false;
      if ((Number(p["Minutes played"]) || 0) < minMinutesPlayed) return false;
      if (selectedLeague && p.League !== selectedLeague) return false;

      // B. Strict Position Check
      if (!preset.positions.includes(p.Position)) return false;

      // C. Role Metric Check (Strict: Must pass ALL thresholds)
      for (const [key, minVal] of Object.entries(currentThresholds)) {
        const playerVal = Number(p[key]) || 0;
        if (playerVal < minVal) return false;
      }

      return true;
    });

    // 3. Sort by "Performance Score" (Sum of key metrics / thresholds)
    // This sorts "Best" candidates to the top
    players.sort((a, b) => {
      let scoreA = 0;
      let scoreB = 0;
      Object.entries(currentThresholds).forEach(([key, threshold]) => {
         const valA = Number(a[key]) || 0;
         const valB = Number(b[key]) || 0;
         // Avoid div by zero
         const t = threshold === 0 ? 1 : threshold; 
         scoreA += valA / t;
         scoreB += valB / t;
      });
      return scoreB - scoreA;
    });

    return { filteredPlayers: players, effectiveThresholds: currentThresholds };
  }, [data, presets, selectedRole, strictnessMultiplier, ageLimit, marketValueLimit, minMinutesPlayed, selectedLeague]);


  const formatCurrency = (val: number) => {
    if (val >= 1000000) return `€${(val / 1000000).toFixed(1)}M`;
    if (val >= 1000) return `€${(val / 1000).toFixed(0)}K`;
    return `€${val}`;
  };

  return (
    <div className="flex h-full animate-fade-in relative bg-slate-900">
      
      {/* --- Sidebar Filters --- */}
      <div className="w-96 bg-slate-950 border-r border-slate-800 flex flex-col h-full overflow-hidden shrink-0 transition-all">
        <div className="p-6 border-b border-slate-800 bg-slate-950/50">
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
                <Gem className="w-5 h-5 text-emerald-400" /> Gem Hunter
            </h2>
            <p className="text-slate-500 text-xs mt-1">Automated Role-Based Scouting</p>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-8 custom-scrollbar">
            
            {/* 1. Role Selection or Builder Toggle */}
            <div className="space-y-4">
                 <div className="flex items-center justify-between">
                     <h3 className="text-xs font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-2">
                        <Sliders className="w-3 h-3" /> Select Role
                    </h3>
                    <button 
                        onClick={() => setIsCreatorMode(!isCreatorMode)}
                        className={`text-xs px-2 py-1 rounded border transition-colors ${isCreatorMode ? 'bg-emerald-500 text-slate-950 border-emerald-500 font-bold' : 'bg-slate-900 text-slate-400 border-slate-700 hover:text-white'}`}
                    >
                        {isCreatorMode ? 'Cancel' : '+ Create Preset'}
                    </button>
                 </div>

                 {!isCreatorMode ? (
                     <>
                        <select 
                            className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-slate-200 text-sm focus:ring-emerald-500 focus:border-emerald-500 font-medium"
                            value={selectedRole}
                            onChange={(e) => handleRoleChange(e.target.value)}
                        >
                            <option value="">-- Choose Tactical Role --</option>
                            {/* Group by category */}
                            {(() => {
                              const categories = new Map<string, string[]>();
                              roles.forEach(r => {
                                const cat = presets[r].category || '🔧 Custom';
                                if (!categories.has(cat)) categories.set(cat, []);
                                categories.get(cat)!.push(r);
                              });
                              return Array.from(categories.entries()).map(([cat, roleList]) => (
                                <optgroup key={cat} label={cat}>
                                  {roleList.map(r => (
                                    <option key={r} value={r}>{r} {presets[r].custom ? '⭐' : ''}</option>
                                  ))}
                                </optgroup>
                              ));
                            })()}
                        </select>

                        {selectedRole && (
                            <div className="bg-slate-900 rounded-xl p-4 border border-slate-800 animate-fade-in-down">
                                <div className="flex justify-between items-center mb-3">
                                    <span className="text-xs text-slate-400 font-semibold uppercase">Filter Strictness</span>
                                    <div className="flex items-center gap-2">
                                        <span className={`text-sm font-mono font-bold ${strictnessMultiplier > 1 ? 'text-red-400' : strictnessMultiplier < 1 ? 'text-emerald-400' : 'text-white'}`}>
                                            {Math.round(strictnessMultiplier * 100)}%
                                        </span>
                                        {presets[selectedRole].custom && (
                                            <button onClick={() => deletePreset(selectedRole)} className="text-rose-500 hover:text-rose-400 p-1">
                                                <Trash2 className="w-3 h-3" />
                                            </button>
                                        )}
                                    </div>
                                </div>
                                
                                <div className="flex items-center gap-2">
                                    <button 
                                        onClick={() => adjustStrictness(-0.1)}
                                        className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg flex items-center justify-center gap-1 transition-colors border border-slate-700 hover:border-emerald-500/50"
                                        title="Lower thresholds by 10%"
                                    >
                                        <Minus className="w-4 h-4" /> 10%
                                    </button>
                                    <button 
                                        onClick={() => setStrictnessMultiplier(1.0)}
                                        className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white rounded-lg border border-slate-700 transition-colors"
                                        title="Reset to base values"
                                    >
                                        <RefreshCw className="w-4 h-4" />
                                    </button>
                                    <button 
                                        onClick={() => adjustStrictness(0.1)}
                                        className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg flex items-center justify-center gap-1 transition-colors border border-slate-700 hover:border-red-500/50"
                                        title="Increase thresholds by 10%"
                                    >
                                        <Plus className="w-4 h-4" /> 10%
                                    </button>
                                </div>
                            </div>
                        )}
                     </>
                 ) : (
                     <div className="bg-slate-900 rounded-xl p-4 border border-slate-700 space-y-4 animate-fade-in">
                         <h4 className="text-sm font-bold text-white mb-2">Build Custom Preset</h4>
                         
                         <div>
                             <label className="text-xs text-slate-500 uppercase font-bold">Preset Name</label>
                             <input 
                                type="text" 
                                className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-sm text-white mt-1"
                                placeholder="e.g. Ball-Playing Defender"
                                value={newPresetName}
                                onChange={(e) => setNewPresetName(e.target.value)}
                             />
                         </div>

                         <div>
                             <label className="text-xs text-slate-500 uppercase font-bold mb-1 block">Positions</label>
                             <div className="flex flex-wrap gap-2">
                                 {availablePositions.map(pos => (
                                     <button
                                        key={pos}
                                        onClick={() => togglePosition(pos)}
                                        className={`text-xs px-2 py-1 rounded border ${newPresetPositions.includes(pos) ? 'bg-emerald-500 border-emerald-500 text-slate-950 font-bold' : 'bg-slate-950 border-slate-800 text-slate-400'}`}
                                     >
                                         {pos}
                                     </button>
                                 ))}
                             </div>
                         </div>

                         <div>
                             <label className="text-xs text-slate-500 uppercase font-bold mb-1 block">Metrics Thresholds</label>
                             <div className="relative mb-2">
                                <input 
                                    type="text" 
                                    className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-xs text-white"
                                    placeholder="Search metrics to add..."
                                    value={metricSearch}
                                    onChange={(e) => setMetricSearch(e.target.value)}
                                />
                                {metricSearch && (
                                    <div className="absolute top-full left-0 right-0 max-h-40 overflow-y-auto bg-slate-800 border border-slate-700 z-10 rounded shadow-xl">
                                        {availableMetrics.filter(k => k.toLowerCase().includes(metricSearch.toLowerCase())).map(k => (
                                            <button 
                                                key={k} 
                                                onClick={() => addMetricToPreset(k)}
                                                className="block w-full text-left px-2 py-1 text-xs text-slate-300 hover:bg-slate-700"
                                            >
                                                {k}
                                            </button>
                                        ))}
                                    </div>
                                )}
                             </div>

                             <div className="space-y-2 max-h-40 overflow-y-auto custom-scrollbar">
                                 {newPresetMetrics.map(m => (
                                     <div key={m.key} className="flex items-center gap-2">
                                         <button onClick={() => removeMetric(m.key)} className="text-slate-500 hover:text-rose-500"><X className="w-3 h-3"/></button>
                                         <span className="text-xs text-slate-300 truncate flex-1" title={m.key}>{m.key}</span>
                                         <input 
                                            type="number" 
                                            className="w-16 bg-slate-950 border border-slate-800 rounded px-1 py-0.5 text-xs text-right text-emerald-400"
                                            value={m.value}
                                            onChange={(e) => updateMetricValue(m.key, parseFloat(e.target.value))}
                                         />
                                     </div>
                                 ))}
                             </div>
                         </div>

                         <button 
                            onClick={saveCustomPreset}
                            disabled={!newPresetName || newPresetPositions.length === 0 || newPresetMetrics.length === 0}
                            className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-500 text-white rounded-lg py-2 text-sm font-bold flex items-center justify-center gap-2 transition-colors"
                         >
                             <Save className="w-4 h-4" /> Save Preset
                         </button>
                     </div>
                 )}
            </div>

            <div className="h-px bg-slate-800"></div>

            {/* 2. Active Metrics Display */}
            {!isCreatorMode && selectedRole && (
                <div className="space-y-4">
                     <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                        <TrendingUp className="w-3 h-3" /> Active Thresholds
                    </h3>
                    <div className="space-y-2">
                        {Object.entries(effectiveThresholds).map(([key, val]) => (
                            <div key={key} className="flex justify-between items-center text-xs bg-slate-900/50 p-2 rounded border border-slate-800/50">
                                <span className="text-slate-400 truncate max-w-[160px]" title={key}>{key}</span>
                                <span className="text-emerald-400 font-mono font-bold">≥ {val}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* 3. General Constraints */}
            <div className="space-y-4 pt-4 border-t border-slate-800">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                    <Filter className="w-3 h-3" /> Constraints
                </h3>
                
                {/* Age */}
                <div>
                    <div className="flex justify-between text-sm text-slate-300 mb-2">
                        <span>Max Age</span>
                        <span className="text-emerald-400 font-bold">{ageLimit}</span>
                    </div>
                    <input 
                        type="range" min="16" max="30" step="1"
                        value={ageLimit}
                        onChange={(e) => setAgeLimit(Number(e.target.value))}
                        className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                    />
                </div>

                {/* Market Value */}
                <div>
                    <div className="flex justify-between text-sm text-slate-300 mb-2">
                        <span>Max Value</span>
                        <span className="text-emerald-400 font-bold">{formatCurrency(marketValueLimit)}</span>
                    </div>
                    <input 
                        type="range" min="0" max="100000000" step="500000"
                        value={marketValueLimit}
                        onChange={(e) => setMarketValueLimit(Number(e.target.value))}
                        className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                    />
                </div>

                {/* Minutes Played */}
                <div>
                    <div className="flex justify-between text-sm text-slate-300 mb-2">
                        <span>Min Minutes</span>
                        <span className="text-emerald-400 font-bold">{minMinutesPlayed.toLocaleString()}'</span>
                    </div>
                    <input 
                        type="range" min="0" max="3000" step="100"
                        value={minMinutesPlayed}
                        onChange={(e) => setMinMinutesPlayed(Number(e.target.value))}
                        className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                    />
                </div>

                {/* League */}
                <div>
                    <label className="text-sm text-slate-300 mb-2 block">League</label>
                    <select 
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-slate-200 text-sm focus:ring-emerald-500 focus:border-emerald-500"
                        value={selectedLeague}
                        onChange={(e) => setSelectedLeague(e.target.value)}
                    >
                        <option value="">All Leagues</option>
                        {leagues.map(l => <option key={l} value={l}>{l}</option>)}
                    </select>
                </div>
            </div>
        </div>
        
        <div className="p-4 bg-slate-950 border-t border-slate-800">
             <div className="bg-slate-900 rounded-lg p-3 flex items-center justify-between border border-slate-800">
                <div className="text-xs text-slate-500 uppercase tracking-wider font-semibold">Total Matches</div>
                <div className="text-xl font-bold text-emerald-400">{filteredPlayers.length}</div>
             </div>
        </div>
      </div>

      {/* --- Main Content: Results Table --- */}
      <div className="flex-1 flex flex-col h-full overflow-hidden bg-slate-900">
         
         <div className="p-6 pb-2">
            <div className="flex items-center justify-between mb-2">
              <h1 className="text-2xl font-bold text-white">Scouting Results</h1>
              {filteredPlayers.length > 0 && (
                <button
                  onClick={() => exportProspects(filteredPlayers, selectedRole, Object.keys(effectiveThresholds))}
                  className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 rounded-lg transition-colors text-sm"
                >
                  <Download className="w-4 h-4" />
                  Export ({filteredPlayers.length})
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-2 text-sm text-slate-400 items-center">
                {selectedRole ? (
                    <>
                        Searching for <span className="text-emerald-400 font-semibold">{selectedRole.split('(')[0]}</span>
                        <span className="w-1 h-1 rounded-full bg-slate-600"></span>
                        Strictness: <span className="text-white font-mono">{Math.round(strictnessMultiplier * 100)}%</span>
                        <span className="w-1 h-1 rounded-full bg-slate-600"></span>
                        Positions: <span className="text-slate-300 font-mono">[{presets[selectedRole].positions.join(', ')}]</span>
                    </>
                ) : (
                    <span>Please select a tactical role from the sidebar to begin searching.</span>
                )}
            </div>
         </div>

         <div className="flex-1 p-6 pt-2 overflow-hidden flex flex-col">
            {filteredPlayers.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center bg-slate-950/50 rounded-2xl border border-slate-800 border-dashed">
                     <div className="w-20 h-20 bg-slate-800/50 rounded-full flex items-center justify-center mb-4">
                        {selectedRole ? <AlertCircle className="w-10 h-10 text-red-400" /> : <Gem className="w-10 h-10 text-slate-600" />}
                     </div>
                     <h3 className="text-xl font-bold text-white mb-2">
                         {selectedRole ? "No Players Found" : "Select a Role"}
                     </h3>
                     <p className="text-slate-400 max-w-md text-center">
                         {selectedRole 
                            ? "No players match the current strict thresholds. Try clicking the [-] button to relax the criteria or increasing the age/value limits."
                            : "Choose a role from the sidebar to automatically apply professional scouting metrics and find hidden gems."}
                     </p>
                </div>
            ) : (
                <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden flex flex-col shadow-2xl h-full">
                    {/* Table Header */}
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm whitespace-nowrap">
                            <thead className="bg-slate-900 border-b border-slate-800 text-xs uppercase font-semibold text-slate-400">
                                <tr>
                                    <th className="p-4 w-12 sticky left-0 bg-slate-900 z-10">#</th>
                                    <th className="p-4 sticky left-12 bg-slate-900 z-10">Player</th>
                                    <th className="p-4">Age</th>
                                    <th className="p-4">Pos</th>
                                    <th className="p-4 text-right">Minutes</th>
                                    <th className="p-4 text-right">Market Value</th>
                                    {/* Dynamic Metric Headers */}
                                    {Object.keys(effectiveThresholds).map(key => (
                                        <th key={key} className="p-4 text-emerald-500/80 font-bold text-right" title={key}>
                                            {key.replace(' per 90', '').replace(', %', ' %').substring(0, 15)}
                                        </th>
                                    ))}
                                    <th className="p-4 text-center">Action</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800">
                                {filteredPlayers.map((player, idx) => {
                                    const pSeason = extractSeason(player.League);
                                    const pSeasonColors = getSeasonColor(pSeason);
                                    return (
                                    <tr key={getPlayerSeasonId(player)} className="hover:bg-slate-900/50 transition-colors group">
                                        <td className="p-4 text-slate-500 font-mono sticky left-0 bg-slate-950 group-hover:bg-slate-900 transition-colors z-10">
                                            {idx + 1}
                                        </td>
                                        <td className="p-4 sticky left-12 bg-slate-950 group-hover:bg-slate-900 transition-colors z-10">
                                            <div className="flex items-center gap-3">
                                                <div className="relative">
                                                  <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center text-xs font-bold text-slate-400 border border-slate-700">
                                                      {(player.Player || '??').substring(0, 2).toUpperCase()}
                                                  </div>
                                                  <div className={`absolute -bottom-1 -right-1 px-1 py-0 rounded text-[7px] font-bold ${pSeasonColors.bg} ${pSeasonColors.text} border ${pSeasonColors.border}`}>
                                                    {pSeason}
                                                  </div>
                                                </div>
                                                <div>
                                                    <div className="font-bold text-slate-200">{player.Player || 'Unknown'}</div>
                                                    <div className="text-xs text-slate-500">{player.Team || 'Unknown'}</div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="p-4 text-slate-300">{player.Age}</td>
                                        <td className="p-4">
                                            <span className="px-2 py-1 rounded bg-slate-900 border border-slate-800 text-xs text-slate-400 font-mono">
                                                {player.Position}
                                            </span>
                                        </td>
                                        <td className="p-4 text-right font-mono text-slate-400">
                                            {Number(player["Minutes played"]).toLocaleString()}'
                                        </td>
                                        <td className="p-4 text-right font-mono text-slate-300">
                                            {formatCurrency(Number(player["Market value"]))}
                                        </td>
                                        {/* Dynamic Metric Cells */}
                                        {Object.keys(effectiveThresholds).map(key => (
                                            <td key={key} className="p-4 text-right font-mono text-emerald-400 font-medium bg-emerald-500/5">
                                                {Number(player[key]).toFixed(1)}
                                            </td>
                                        ))}
                                        <td className="p-4 text-center">
                                            <div className="flex items-center justify-center gap-1">
                                              <button 
                                                  onClick={(e) => toggleWatchlist(player, e)}
                                                  className={`p-2 rounded-lg transition-all ${
                                                    watchlistIds.has(getPlayerSeasonId(player))
                                                      ? 'bg-yellow-500/20 text-yellow-400'
                                                      : 'hover:bg-yellow-500/10 text-slate-500 hover:text-yellow-400'
                                                  }`}
                                                  title={watchlistIds.has(getPlayerSeasonId(player)) ? 'Remove from Watchlist' : 'Add to Watchlist'}
                                              >
                                                  <Star className={`w-4 h-4 ${watchlistIds.has(getPlayerSeasonId(player)) ? 'fill-yellow-400' : ''}`} />
                                              </button>
                                              <button 
                                                  onClick={() => onSelectPlayer(player)}
                                                  className="p-2 hover:bg-emerald-500/20 rounded-lg text-slate-400 hover:text-emerald-400 transition-all"
                                                  title="View Profile"
                                              >
                                                  <Eye className="w-4 h-4" />
                                              </button>
                                            </div>
                                        </td>
                                    </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
         </div>
      </div>
    </div>
  );
};

export default Prospects;