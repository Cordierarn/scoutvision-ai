import React, { useState, useMemo, useEffect } from 'react';
import { PlayerData, extractSeason, getSeasonColor, getPlayerSeasonId, getSeasonShortLabel } from '../types';
import { getAvailableLeagues } from '../utils/scoringUtils';
import { RolePreset, DEFAULT_ROLE_PRESETS, ROLE_CATEGORIES, MIDFIELD_PROFILE_BONUS, roleIndex } from '../utils/rolePresets';
import { Filter, Gem, Sliders, ChevronRight, Trophy, Coins, TrendingUp, Eye, Minus, Plus, RefreshCw, AlertCircle, Save, Trash2, X, Check, Download, Star, Hand, Shield, MoveHorizontal, Anchor, Repeat, Wand2, Zap, Crosshair, Flag, Scale, Wrench } from 'lucide-react';
import { queryService } from '../services/queryService';
import { exportProspects } from '../utils/exportUtils';
import { metricLabel, positionLabel } from '../utils/labels';
import { getWatchlist, addToWatchlist, removeFromWatchlist } from '../services/storageService';
import { PhotoOverlay, TeamLine, TeamLogo, CompetitionBadge, CountryFlag } from './Media';

interface ProspectsProps {
  data: PlayerData[];
  onSelectPlayer: (player: PlayerData) => void;
}

// v2 : seuils en percentiles (les presets v1 étaient en valeurs absolues Wyscout)
// Valeur du modèle au moins égale à ce multiple de la valeur Transfermarkt
const UNDERVALUED_RATIO = 1.5;

const LS_KEY = 'scoutvision_role_presets_v2';

// Icône de chaque catégorie de rôle (utils/rolePresets.ts)
const CATEGORY_ICONS = { Hand, Shield, MoveHorizontal, Anchor, Repeat, Wand2, Zap, Crosshair, Flag };

const Prospects: React.FC<ProspectsProps> = ({ data, onSelectPlayer }) => {
  // --- General Filters ---
  const [ageLimit, setAgeLimit] = useState<number>(23);
  const [marketValueLimit, setMarketValueLimit] = useState<number>(30000000); // 30M default
  const [contractMonths, setContractMonths] = useState<number>(0);       // 0 = any contract end
  const [undervaluedOnly, setUndervaluedOnly] = useState<boolean>(false); // model value >= 1.5x market
  const [minMinutesPlayed, setMinMinutesPlayed] = useState<number>(500); // Min 500 minutes
  const [selectedLeague, setSelectedLeague] = useState<string>('');
  
  // --- Watchlist State ---
  const [watchlistIds, setWatchlistIds] = useState<Set<string>>(new Set());
  
  // Update watchlist IDs for UI
  useEffect(() => {
    const updateWatchlistIds = () => {
      // Une seule lecture du localStorage, au lieu d'une par joueur
      setWatchlistIds(new Set(getWatchlist().map(w => getPlayerSeasonId(w.player))));
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
        console.error("Échec du chargement des presets", e);
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
    // Métriques ayant un percentile par rôle : le seuil d'un preset est un percentile
    return Object.keys(data[0])
      .filter(key => key.endsWith(' pct'))
      .map(key => key.slice(0, -4))
      .sort();
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

  // Fin de contrat au plus tard dans `contractMonths` mois
  const contractDeadline = useMemo(() => {
    const d = new Date();
    d.setMonth(d.getMonth() + contractMonths);
    return d;
  }, [contractMonths]);

  // --- Core Filtering Logic ---
  const { filteredPlayers, effectiveThresholds } = useMemo(() => {
    if (!selectedRole || !presets[selectedRole]) return { filteredPlayers: [], effectiveThresholds: {} };

    const preset = presets[selectedRole];
    
    // 1. Calculate Effective Thresholds (Base * Multiplier)
    const currentThresholds: Record<string, number> = {};
    Object.entries(preset.metrics).forEach(([key, baseVal]) => {
      // Percentile minimum, plafonné à 99
      currentThresholds[key] = Math.min(99, Math.round(baseVal * strictnessMultiplier));
    });

    // 2. Filter Players
    const players = data.filter(p => {
      // A. General Filters
      if ((Number(p.Age) || 100) > ageLimit) return false;
      if ((Number(p["Market value"]) || 0) > marketValueLimit) return false;
      if (contractMonths > 0) {
        const end = p["Contract expires"] ? new Date(p["Contract expires"]) : null;
        if (!end || end > contractDeadline) return false;
      }
      if (undervaluedOnly) {
        const market = Number(p["Market value"]);
        const estimate = Number(p["Estimated value"]);
        if (!market || !estimate || estimate / market < UNDERVALUED_RATIO) return false;
      }
      if ((Number(p["Minutes played"]) || 0) < minMinutesPlayed) return false;
      if (selectedLeague && p.League !== selectedLeague) return false;

      // B. Strict Position Check
      if (!preset.positions.includes(p.Position)) return false;

      // C. Role Metric Check (Strict: Must pass ALL percentile thresholds)
      for (const [key, minPct] of Object.entries(currentThresholds)) {
        const playerPct = Number(p[`${key} pct`]) || 0;
        if (playerPct < minPct) return false;
      }

      return true;
    });

    // 3. Sort by "Performance Score" (mean percentile on the role metrics)
    // This sorts "Best" candidates to the top
    players.sort((a, b) => roleIndex(b, preset) - roleIndex(a, preset));

    return { filteredPlayers: players, effectiveThresholds: currentThresholds };
  }, [data, presets, selectedRole, strictnessMultiplier, ageLimit, marketValueLimit, minMinutesPlayed, selectedLeague,
      contractMonths, undervaluedOnly, contractDeadline]);


  const formatCurrency = (val: number) => {
    if (!val) return '–';
    if (val >= 1000000) return `€${(val / 1000000).toFixed(1)}M`;
    if (val >= 1000) return `€${(val / 1000).toFixed(0)}K`;
    return `€${val}`;
  };

  return (
    <div className="flex h-full animate-fade-in relative bg-raised">
      
      {/* --- Sidebar Filters --- */}
      <div className="w-96 bg-surface border-r border-line flex flex-col h-full overflow-hidden shrink-0 transition-all">
        <div className="p-6 border-b border-line bg-surface/50">
            <h2 className="text-xl font-bold text-ink flex items-center gap-2">
                <Gem className="w-5 h-5 text-accent" /> Chasseur de pépites
            </h2>
            <p className="text-ink-3 text-xs mt-1">Scouting automatique par rôle</p>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-8 custom-scrollbar">
            
            {/* 1. Role Selection or Builder Toggle */}
            <div className="space-y-4">
                 <div className="flex items-center justify-between">
                     <h3 className="text-xs font-bold text-accent uppercase tracking-wider flex items-center gap-2">
                        <Sliders className="w-3 h-3" /> Choisir un rôle
                    </h3>
                    <button 
                        onClick={() => setIsCreatorMode(!isCreatorMode)}
                        className={`text-xs px-2 py-1 rounded border transition-colors ${isCreatorMode ? 'bg-accent text-accent-ink border-accent font-bold' : 'bg-raised text-ink-3 border-line-strong hover:text-ink'}`}
                    >
                        {isCreatorMode ? 'Annuler' : '+ Créer un preset'}
                    </button>
                 </div>

                 {!isCreatorMode ? (
                     <>
                        <div className="space-y-3">
                            {[...ROLE_CATEGORIES, { key: 'custom', label: 'Mes presets', icon: 'Wrench' as const }].map(cat => {
                                const list = roles.filter(r => (presets[r].custom ? 'custom' : presets[r].category) === cat.key);
                                if (list.length === 0) return null;
                                const Icon = cat.key === 'custom' ? Wrench : CATEGORY_ICONS[cat.icon as keyof typeof CATEGORY_ICONS];
                                return (
                                    <div key={cat.key}>
                                        <div className="flex items-center gap-1.5 text-[11px] text-ink-3 uppercase font-semibold mb-1.5">
                                            <Icon className="w-3.5 h-3.5" /> {cat.label}
                                        </div>
                                        <div className="flex flex-wrap gap-1.5">
                                            {list.map(r => (
                                                <button
                                                    key={r}
                                                    onClick={() => handleRoleChange(r)}
                                                    title={presets[r].description}
                                                    className={`px-2.5 py-1 rounded-md text-xs border transition-colors ${selectedRole === r ? 'bg-accent border-accent text-accent-ink font-semibold' : 'bg-raised border-line-strong text-ink-2 hover:border-accent/50 hover:text-ink'}`}
                                                >
                                                    {r}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        {selectedRole && (
                            <div className="bg-raised rounded-md p-4 border border-line animate-fade-in-down">
                                <div className="flex justify-between items-center mb-3">
                                    <span className="text-xs text-ink-3 font-semibold uppercase">Exigence des filtres</span>
                                    <div className="flex items-center gap-2">
                                        <span className={`text-sm font-mono font-bold ${strictnessMultiplier > 1 ? 'text-neg' : strictnessMultiplier < 1 ? 'text-accent' : 'text-ink'}`}>
                                            {Math.round(strictnessMultiplier * 100)}%
                                        </span>
                                        {presets[selectedRole].custom && (
                                            <button onClick={() => deletePreset(selectedRole)} className="text-neg hover:text-neg p-1">
                                                <Trash2 className="w-3 h-3" />
                                            </button>
                                        )}
                                    </div>
                                </div>
                                
                                <div className="flex items-center gap-2">
                                    <button 
                                        onClick={() => adjustStrictness(-0.1)}
                                        className="flex-1 py-2 bg-overlay hover:bg-line-strong text-ink-2 rounded-md flex items-center justify-center gap-1 transition-colors border border-line-strong hover:border-accent/50"
                                        title="Baisser les seuils de 10 %"
                                    >
                                        <Minus className="w-4 h-4" /> 10%
                                    </button>
                                    <button 
                                        onClick={() => setStrictnessMultiplier(1.0)}
                                        className="p-2 bg-overlay hover:bg-line-strong text-ink-3 hover:text-ink rounded-md border border-line-strong transition-colors"
                                        title="Revenir aux seuils de base"
                                    >
                                        <RefreshCw className="w-4 h-4" />
                                    </button>
                                    <button 
                                        onClick={() => adjustStrictness(0.1)}
                                        className="flex-1 py-2 bg-overlay hover:bg-line-strong text-ink-2 rounded-md flex items-center justify-center gap-1 transition-colors border border-line-strong hover:border-neg/50"
                                        title="Relever les seuils de 10 %"
                                    >
                                        <Plus className="w-4 h-4" /> 10%
                                    </button>
                                </div>
                            </div>
                        )}
                     </>
                 ) : (
                     <div className="bg-raised rounded-md p-4 border border-line-strong space-y-4 animate-fade-in">
                         <h4 className="text-sm font-bold text-ink mb-2">Créer un preset</h4>
                         
                         <div>
                             <label className="text-xs text-ink-3 uppercase font-bold">Nom du preset</label>
                             <input 
                                type="text" 
                                className="w-full bg-surface border border-line rounded p-2 text-sm text-ink mt-1"
                                placeholder="e.g. Ball-Playing Defender"
                                value={newPresetName}
                                onChange={(e) => setNewPresetName(e.target.value)}
                             />
                         </div>

                         <div>
                             <label className="text-xs text-ink-3 uppercase font-bold mb-1 block">Postes</label>
                             <div className="flex flex-wrap gap-2">
                                 {availablePositions.map(pos => (
                                     <button
                                        key={pos}
                                        onClick={() => togglePosition(pos)}
                                        className={`text-xs px-2 py-1 rounded border ${newPresetPositions.includes(pos) ? 'bg-accent border-accent text-accent-ink font-bold' : 'bg-surface border-line text-ink-3'}`}
                                     >
                                         {positionLabel(pos)}
                                     </button>
                                 ))}
                             </div>
                         </div>

                         <div>
                             <label className="text-xs text-ink-3 uppercase font-bold mb-1 block">Seuils par métrique</label>
                             <div className="relative mb-2">
                                <input 
                                    type="text" 
                                    className="w-full bg-surface border border-line rounded p-2 text-xs text-ink"
                                    placeholder="Rechercher une métrique..."
                                    value={metricSearch}
                                    onChange={(e) => setMetricSearch(e.target.value)}
                                />
                                {metricSearch && (
                                    <div className="absolute top-full left-0 right-0 max-h-40 overflow-y-auto bg-overlay border border-line-strong z-10 rounded ">
                                        {availableMetrics.filter(k => k.toLowerCase().includes(metricSearch.toLowerCase())).map(k => (
                                            <button 
                                                key={k} 
                                                onClick={() => addMetricToPreset(k)}
                                                className="block w-full text-left px-2 py-1 text-xs text-ink-2 hover:bg-line-strong"
                                            >
                                                {metricLabel(k)}
                                            </button>
                                        ))}
                                    </div>
                                )}
                             </div>

                             <div className="space-y-2 max-h-40 overflow-y-auto custom-scrollbar">
                                 {newPresetMetrics.map(m => (
                                     <div key={m.key} className="flex items-center gap-2">
                                         <button onClick={() => removeMetric(m.key)} className="text-ink-3 hover:text-neg"><X className="w-3 h-3"/></button>
                                         <span className="text-xs text-ink-2 truncate flex-1" title={m.key}>{metricLabel(m.key)}</span>
                                         <input 
                                            type="number" 
                                            min={0}
                                            max={99}
                                            title="Percentile minimum (0-99) parmi le même rôle et le même niveau"
                                            className="w-16 bg-surface border border-line rounded px-1 py-0.5 text-xs text-right text-accent"
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
                            className="w-full bg-accent hover:bg-accent disabled:bg-overlay disabled:text-ink-3 text-ink rounded-md py-2 text-sm font-bold flex items-center justify-center gap-2 transition-colors"
                         >
                             <Save className="w-4 h-4" /> Enregistrer le preset
                         </button>
                     </div>
                 )}
            </div>

            <div className="h-px bg-overlay"></div>

            {/* 2. Active Metrics Display */}
            {!isCreatorMode && selectedRole && (
                <div className="space-y-4">
                    {presets[selectedRole].description && (
                        <p className="text-sm text-ink-2">{presets[selectedRole].description}</p>
                    )}
                     <h3 className="text-xs font-bold text-ink-3 uppercase tracking-wider flex items-center gap-2">
                        <TrendingUp className="w-3 h-3" /> Critères éliminatoires
                    </h3>
                    <div className="space-y-2">
                        {Object.entries(effectiveThresholds).map(([key, val]) => (
                            <div key={key} className="flex justify-between items-center text-xs bg-raised/50 p-2 rounded border border-line/50">
                                <span className="text-ink-3 truncate max-w-[160px]" title={key}>{metricLabel(key)}</span>
                                <span className="text-accent font-mono font-bold">≥ P{val}</span>
                            </div>
                        ))}
                    </div>
                    {presets[selectedRole].weights && (
                        <>
                            <h3 className="text-xs font-bold text-ink-3 uppercase tracking-wider flex items-center gap-2 pt-2">
                                <Scale className="w-3 h-3" /> Critères de classement
                            </h3>
                            <div className="space-y-1.5">
                                {Object.entries(presets[selectedRole].weights!).map(([key, w]) => (
                                    <div key={key} className="flex justify-between items-center text-xs px-2">
                                        <span className="text-ink-3 truncate max-w-[180px]" title={metricLabel(key)}>{metricLabel(key)}</span>
                                        <span className="text-ink-3 font-mono">{w < 0 ? 'moins = mieux' : `×${w}`}</span>
                                    </div>
                                ))}
                                {presets[selectedRole].midfieldProfiles && (
                                    <div className="flex justify-between items-center text-xs px-2">
                                        <span className="text-ink-3">Profil de milieu : {presets[selectedRole].midfieldProfiles!.join(', ')}</span>
                                        <span className="text-ink-3 font-mono">+{MIDFIELD_PROFILE_BONUS}</span>
                                    </div>
                                )}
                            </div>
                            <p className="text-[11px] text-ink-3">L'indice du rôle (0-100) est la moyenne pondérée des percentiles de tous ces critères ; il ordonne les résultats.</p>
                        </>
                    )}
                </div>
            )}

            {/* 3. General Constraints */}
            <div className="space-y-4 pt-4 border-t border-line">
                <h3 className="text-xs font-bold text-ink-3 uppercase tracking-wider flex items-center gap-2">
                    <Filter className="w-3 h-3" /> Contraintes
                </h3>
                
                {/* Age */}
                <div>
                    <div className="flex justify-between text-sm text-ink-2 mb-2">
                        <span>Âge max</span>
                        <span className="text-accent font-bold">{ageLimit}</span>
                    </div>
                    <input 
                        type="range" min="16" max="30" step="1"
                        value={ageLimit}
                        onChange={(e) => setAgeLimit(Number(e.target.value))}
                        className="w-full h-2 bg-overlay rounded-md appearance-none cursor-pointer accent-accent"
                    />
                </div>

                {/* Market Value */}
                <div>
                    <div className="flex justify-between text-sm text-ink-2 mb-2">
                        <span>Valeur max</span>
                        <span className="text-accent font-bold">{formatCurrency(marketValueLimit)}</span>
                    </div>
                    <input 
                        type="range" min="0" max="100000000" step="500000"
                        value={marketValueLimit}
                        onChange={(e) => setMarketValueLimit(Number(e.target.value))}
                        className="w-full h-2 bg-overlay rounded-md appearance-none cursor-pointer accent-accent"
                    />
                </div>

                {/* Minutes Played */}
                <div>
                    <div className="flex justify-between text-sm text-ink-2 mb-2">
                        <span>Minutes min</span>
                        <span className="text-accent font-bold">{minMinutesPlayed.toLocaleString()}'</span>
                    </div>
                    <input 
                        type="range" min="0" max="3000" step="100"
                        value={minMinutesPlayed}
                        onChange={(e) => setMinMinutesPlayed(Number(e.target.value))}
                        className="w-full h-2 bg-overlay rounded-md appearance-none cursor-pointer accent-accent"
                    />
                </div>

                {/* Contract end (Transfermarkt, current season) */}
                <div>
                    <label className="text-sm text-ink-2 mb-2 block">Fin de contrat sous</label>
                    <select
                        className="w-full bg-raised border border-line-strong rounded-md p-2 text-ink text-sm focus:ring-accent focus:border-accent"
                        value={contractMonths}
                        onChange={(e) => setContractMonths(Number(e.target.value))}
                    >
                        <option value={0}>Indifférent</option>
                        <option value={6}>6 mois</option>
                        <option value={12}>12 mois</option>
                        <option value={18}>18 mois</option>
                        <option value={24}>24 mois</option>
                    </select>
                </div>

                {/* Value vs performance model */}
                <label className="flex items-center gap-2 text-sm text-ink-2 cursor-pointer">
                    <input
                        type="checkbox"
                        checked={undervaluedOnly}
                        onChange={(e) => setUndervaluedOnly(e.target.checked)}
                        className="accent-accent"
                    />
                    Sous-coté par le modèle (≥ ×{UNDERVALUED_RATIO})
                </label>

                {/* Shortcut: young players whose contract is ending */}
                <button
                    onClick={() => { setAgeLimit(23); setContractMonths(12); }}
                    className="w-full text-xs px-3 py-2 rounded-md border border-line-strong text-ink-2 hover:border-accent/50 hover:text-accent transition-colors"
                >
                    U23 · contrat finissant sous 12 mois
                </button>
                <p className="text-[11px] text-ink-3 -mt-2">Les filtres de contrat et de valeur utilisent l'instantané Transfermarkt actuel : ils ne concernent que la saison en cours.</p>

                {/* League */}
                <div>
                    <label className="text-sm text-ink-2 mb-2 block">Compétition</label>
                    <select 
                        className="w-full bg-raised border border-line-strong rounded-md p-2 text-ink text-sm focus:ring-accent focus:border-accent"
                        value={selectedLeague}
                        onChange={(e) => setSelectedLeague(e.target.value)}
                    >
                        <option value="">Toutes les compétitions</option>
                        {leagues.map(l => <option key={l} value={l}>{l}</option>)}
                    </select>
                </div>
            </div>
        </div>
        
        <div className="p-4 bg-surface border-t border-line">
             <div className="bg-raised rounded-md p-3 flex items-center justify-between border border-line">
                <div className="text-xs text-ink-3 uppercase tracking-wider font-semibold">Joueurs trouvés</div>
                <div className="text-xl font-bold text-accent">{filteredPlayers.length}</div>
             </div>
        </div>
      </div>

      {/* --- Main Content: Results Table --- */}
      <div className="flex-1 flex flex-col h-full overflow-hidden bg-raised">
         
         <div className="p-6 pb-2">
            <div className="flex items-center justify-between mb-2">
              <h1 className="text-2xl font-bold text-ink">Résultats</h1>
              {filteredPlayers.length > 0 && (
                <button
                  onClick={() => exportProspects(filteredPlayers, selectedRole, Object.keys(effectiveThresholds))}
                  className="flex items-center gap-2 px-3 py-1.5 bg-accent/10 hover:bg-accent/20 text-accent rounded-md transition-colors text-sm"
                >
                  <Download className="w-4 h-4" />
                  Exporter ({filteredPlayers.length})
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-2 text-sm text-ink-3 items-center">
                {selectedRole ? (
                    <>
                        Recherche : <span className="text-accent font-semibold">{selectedRole}</span>
                        <span className="w-1 h-1 rounded-full bg-ink-4"></span>
                        Exigence : <span className="text-ink font-mono">{Math.round(strictnessMultiplier * 100)}%</span>
                        <span className="w-1 h-1 rounded-full bg-ink-4"></span>
                        Postes : <span className="text-ink-2 font-mono">[{presets[selectedRole].positions.map(positionLabel).join(', ')}]</span>
                    </>
                ) : (
                    <span>Choisissez un rôle tactique dans le panneau de gauche pour lancer la recherche.</span>
                )}
            </div>
         </div>

         <div className="flex-1 p-6 pt-2 overflow-hidden flex flex-col">
            {filteredPlayers.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center bg-surface/50 rounded-lg border border-line border-dashed">
                     <div className="w-20 h-20 bg-overlay/50 rounded-full flex items-center justify-center mb-4">
                        {selectedRole ? <AlertCircle className="w-10 h-10 text-neg" /> : <Gem className="w-10 h-10 text-ink-4" />}
                     </div>
                     <h3 className="text-xl font-bold text-ink mb-2">
                         {selectedRole ? "Aucun joueur trouvé" : "Choisissez un rôle"}
                     </h3>
                     <p className="text-ink-3 max-w-md text-center">
                         {selectedRole 
                            ? "Aucun joueur ne passe les seuils actuels. Baissez l'exigence avec le bouton [-] ou élargissez l'âge et la valeur."
                            : "Choisissez un rôle pour appliquer ses seuils et trouver des pépites."}
                     </p>
                </div>
            ) : (
                <div className="bg-surface border border-line rounded-md overflow-hidden flex flex-col  h-full">
                    {/* Table Header */}
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm whitespace-nowrap">
                            <thead className="bg-raised border-b border-line text-xs uppercase font-semibold text-ink-3">
                                <tr>
                                    <th className="p-4 w-12 sticky left-0 bg-raised z-10">#</th>
                                    <th className="p-4 sticky left-12 bg-raised z-10">Joueur</th>
                                    <th className="p-4 text-right" title="Indice du rôle : moyenne pondérée des percentiles des critères">Indice</th>
                                    <th className="p-4">Âge</th>
                                    <th className="p-4">Poste</th>
                                    <th className="p-4 text-right">Minutes</th>
                                    <th className="p-4 text-right">Valeur</th>
                                    {/* Dynamic Metric Headers */}
                                    {Object.keys(effectiveThresholds).map(key => (
                                        <th key={key} className="p-4 text-accent font-bold text-right" title={metricLabel(key)}>
                                            {metricLabel(key).replace(' par 90', '')}
                                        </th>
                                    ))}
                                    <th className="p-4 text-center">Action</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-line">
                                {filteredPlayers.map((player, idx) => {
                                    const pSeason = extractSeason(player.League);
                                    const pSeasonColors = getSeasonColor(pSeason);
                                    return (
                                    <tr key={getPlayerSeasonId(player)} className="hover:bg-raised/50 transition-colors group">
                                        <td className="p-4 text-ink-3 font-mono sticky left-0 bg-surface group-hover:bg-raised transition-colors z-10">
                                            {idx + 1}
                                        </td>
                                        <td className="p-4 sticky left-12 bg-surface group-hover:bg-raised transition-colors z-10">
                                            <div className="flex items-center gap-3">
                                                <div className="relative">
                                                  <div className="relative overflow-hidden w-8 h-8 rounded-full bg-overlay flex items-center justify-center text-xs font-bold text-ink-3 border border-line-strong">
                                                      {(player.Player || '??').substring(0, 2).toUpperCase()}
                                                      <PhotoOverlay src={player.Image} alt={player.Player} />
                                                  </div>
                                                  <div className={`absolute -bottom-1 -right-1 px-1 py-0 rounded text-[7px] font-bold ${pSeasonColors.bg} ${pSeasonColors.text} border ${pSeasonColors.border}`}>
                                                    {getSeasonShortLabel(pSeason)}
                                                  </div>
                                                </div>
                                                <div>
                                                    <div className="font-bold text-ink">{player.Player || 'Inconnu'}</div>
                                                    <div className="text-xs text-ink-3"><TeamLine player={player} /></div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="p-4 text-right">
                                            <span className="font-mono font-bold text-ink">{roleIndex(player, presets[selectedRole])}</span>
                                        </td>
                                        <td className="p-4 text-ink-2">{player.Age}</td>
                                        <td className="p-4">
                                            <span className="px-2 py-1 rounded bg-raised border border-line text-xs text-ink-3 font-mono">
                                                {positionLabel(player.Position)}
                                            </span>
                                        </td>
                                        <td className="p-4 text-right font-mono text-ink-3">
                                            {Number(player["Minutes played"]).toLocaleString()}'
                                        </td>
                                        <td className="p-4 text-right font-mono text-ink-2">
                                            {formatCurrency(Number(player["Market value"]))}
                                            {typeof player["Estimated value"] === 'number' && Number(player["Market value"]) > 0 && (
                                              <div className="text-[10px] text-ink-3 font-normal">
                                                modèle {formatCurrency(player["Estimated value"])} (×{(player["Estimated value"] / Number(player["Market value"])).toFixed(1)})
                                              </div>
                                            )}
                                            {player["Contract expires"] && (
                                              <div className="text-[10px] text-ink-3 font-normal">jusqu'à {String(player["Contract expires"]).slice(0, 7)}</div>
                                            )}
                                        </td>
                                        {/* Dynamic Metric Cells */}
                                        {Object.keys(effectiveThresholds).map(key => (
                                            <td key={key} className="p-4 text-right font-mono text-accent font-medium bg-accent/5">
                                                {Number(player[key]).toFixed(2)}
                                                <span className="ml-1 text-[10px] text-ink-3">P{player[`${key} pct`] ?? '–'}</span>
                                            </td>
                                        ))}
                                        <td className="p-4 text-center">
                                            <div className="flex items-center justify-center gap-1">
                                              <button 
                                                  onClick={(e) => toggleWatchlist(player, e)}
                                                  className={`p-2 rounded-md transition-all ${
                                                    watchlistIds.has(getPlayerSeasonId(player))
                                                      ? 'bg-warn/20 text-warn'
                                                      : 'hover:bg-warn/10 text-ink-3 hover:text-warn'
                                                  }`}
                                                  title={watchlistIds.has(getPlayerSeasonId(player)) ? 'Retirer de la liste de suivi' : 'Ajouter à la liste de suivi'}
                                              >
                                                  <Star className={`w-4 h-4 ${watchlistIds.has(getPlayerSeasonId(player)) ? 'fill-warn' : ''}`} />
                                              </button>
                                              <button 
                                                  onClick={() => onSelectPlayer(player)}
                                                  className="p-2 hover:bg-accent/20 rounded-md text-ink-3 hover:text-accent transition-all"
                                                  title="Voir la fiche"
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