import React, { useState, useMemo, useEffect } from 'react';
import { PlayerData, extractSeason, getPlayerSeasonId, getSeasonShortLabel } from '../types';
import { getAvailableLeagues } from '../utils/scoringUtils';
import { RolePreset, DEFAULT_ROLE_PRESETS, ROLE_CATEGORIES, MIDFIELD_PROFILE_BONUS, roleIndex } from '../utils/rolePresets';
import { Filter, Gem, Sliders, ChevronRight, Trophy, Coins, TrendingUp, Eye, Minus, Plus, RefreshCw, AlertCircle, Save, Trash2, X, Check, Download, Star, Hand, Shield, MoveHorizontal, Anchor, Repeat, Wand2, Zap, Crosshair, Flag, Scale, Wrench } from 'lucide-react';
import { queryService } from '../services/queryService';
import { exportProspects } from '../utils/exportUtils';
import { metricLabel, positionLabel } from '../utils/labels';
import { getWatchlist, addToWatchlist, removeFromWatchlist } from '../services/storageService';
import { TeamLine, PlayerAvatar } from './Media';
import { EmptyState, PercentileBar, PercentileValue } from './ui';

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

  const preset = selectedRole ? presets[selectedRole] : undefined;
  const thresholdKeys = Object.keys(effectiveThresholds);
  const multiSeason = new Set(data.map(p => extractSeason(p.League))).size > 1;

  // Contrainte de la barre latérale : libellé, valeur courante, contrôle
  const Constraint: React.FC<{ label: string; value: React.ReactNode; children: React.ReactNode }> = ({ label, value, children }) => (
    <div>
      <div className="flex justify-between items-baseline mb-1">
        <span className="text-xs text-ink-2">{label}</span>
        <span className="text-xs font-semibold text-ink num">{value}</span>
      </div>
      {children}
    </div>
  );

  return (
    <div className="flex h-full animate-fade-in">

      {/* ===== Barre de critères ===== */}
      <aside className="w-80 shrink-0 bg-surface border-r border-line flex flex-col h-full">
        <div className="px-4 py-3 border-b border-line">
          <h2 className="text-sm font-semibold text-ink flex items-center gap-2"><Gem className="w-4 h-4 text-accent" /> Chasseur de pépites</h2>
          <p className="text-2xs text-ink-3 mt-0.5">Filtre par rôle : seuils de percentile, puis classement par indice du rôle.</p>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-5">
          {/* 1. Rôle */}
          <section className="space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="sv-label flex items-center gap-1.5"><Sliders className="w-3 h-3" /> Rôle</span>
              <button onClick={() => setIsCreatorMode(!isCreatorMode)} className={`sv-btn sv-btn-sm ${isCreatorMode ? 'sv-btn-secondary' : 'sv-btn-ghost'}`}>
                {isCreatorMode ? 'Annuler' : <><Plus className="w-3 h-3" /> Créer un rôle</>}
              </button>
            </div>

            {!isCreatorMode ? (
              <>
                <div className="space-y-2.5">
                  {[...ROLE_CATEGORIES, { key: 'custom', label: 'Mes presets', icon: 'Wrench' as const }].map(cat => {
                    const list = roles.filter(r => (presets[r].custom ? 'custom' : presets[r].category) === cat.key);
                    if (list.length === 0) return null;
                    const Icon = cat.key === 'custom' ? Wrench : CATEGORY_ICONS[cat.icon as keyof typeof CATEGORY_ICONS];
                    return (
                      <div key={cat.key}>
                        <div className="flex items-center gap-1.5 text-2xs text-ink-4 mb-1"><Icon className="w-3 h-3" /> {cat.label}</div>
                        <div className="flex flex-wrap gap-1">
                          {list.map(r => (
                            <button key={r} onClick={() => handleRoleChange(r)} title={presets[r].description}
                              className={`sv-chip !h-6 !px-2 ${selectedRole === r ? 'sv-chip-on' : ''}`} aria-pressed={selectedRole === r}>
                              {r}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {preset && (
                  <div className="sv-panel !bg-raised/50 p-3 space-y-2 animate-fade-in-down">
                    <div className="flex justify-between items-center">
                      <span className="sv-label">Exigence des seuils</span>
                      <span className="flex items-center gap-1.5">
                        <span className={`text-xs font-semibold num ${strictnessMultiplier > 1 ? 'text-warn' : strictnessMultiplier < 1 ? 'text-ink-2' : 'text-ink'}`}>
                          {Math.round(strictnessMultiplier * 100)} %
                        </span>
                        {preset.custom && (
                          <button onClick={() => deletePreset(selectedRole)} className="sv-icon-btn !w-6 !h-6 hover:!text-neg" title="Supprimer ce preset">
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button onClick={() => adjustStrictness(-0.1)} className="sv-btn sv-btn-secondary sv-btn-sm flex-1" title="Baisser les seuils de 10 %"><Minus className="w-3 h-3" /> 10 %</button>
                      <button onClick={() => setStrictnessMultiplier(1.0)} className="sv-icon-btn" title="Revenir aux seuils de base"><RefreshCw className="w-3.5 h-3.5" /></button>
                      <button onClick={() => adjustStrictness(0.1)} className="sv-btn sv-btn-secondary sv-btn-sm flex-1" title="Relever les seuils de 10 %"><Plus className="w-3 h-3" /> 10 %</button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="sv-panel !bg-raised/50 p-3 space-y-3 animate-fade-in">
                <label className="block">
                  <span className="sv-label">Nom du preset</span>
                  <input type="text" className="sv-input sv-input-sm mt-1" placeholder="ex. Défenseur relanceur" value={newPresetName} onChange={(e) => setNewPresetName(e.target.value)} />
                </label>
                <div>
                  <span className="sv-label">Postes</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {availablePositions.map(pos => (
                      <button key={pos} onClick={() => togglePosition(pos)} className={`sv-chip !h-6 !px-2 ${newPresetPositions.includes(pos) ? 'sv-chip-on' : ''}`}>{positionLabel(pos)}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <span className="sv-label">Seuils par métrique (percentile minimum)</span>
                  <div className="relative mt-1 mb-2">
                    <input type="text" className="sv-input sv-input-sm" placeholder="Rechercher une métrique" value={metricSearch} onChange={(e) => setMetricSearch(e.target.value)} />
                    {metricSearch && (
                      <div className="sv-menu absolute top-full left-0 right-0 mt-1 max-h-40 overflow-y-auto z-20">
                        {availableMetrics.filter(k => k.toLowerCase().includes(metricSearch.toLowerCase()) || metricLabel(k).toLowerCase().includes(metricSearch.toLowerCase())).map(k => (
                          <button key={k} onClick={() => addMetricToPreset(k)} className="sv-menu-item !text-xs">{metricLabel(k)}</button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {newPresetMetrics.map(m => (
                      <div key={m.key} className="flex items-center gap-1.5">
                        <button onClick={() => removeMetric(m.key)} className="sv-icon-btn !w-5 !h-5 hover:!text-neg"><X className="w-3 h-3" /></button>
                        <span className="text-xs text-ink-2 truncate flex-1" title={m.key}>{metricLabel(m.key)}</span>
                        <input type="number" min={0} max={99} title="Percentile minimum (0-99) parmi le même rôle et le même niveau"
                          className="sv-input sv-input-sm !w-14 text-right" value={m.value} onChange={(e) => updateMetricValue(m.key, parseFloat(e.target.value))} />
                      </div>
                    ))}
                  </div>
                </div>
                <button onClick={saveCustomPreset} disabled={!newPresetName || newPresetPositions.length === 0 || newPresetMetrics.length === 0}
                  className="sv-btn sv-btn-primary sv-btn-sm w-full">
                  <Save className="w-3.5 h-3.5" /> Enregistrer le preset
                </button>
              </div>
            )}
          </section>

          {/* 2. Critères du rôle */}
          {!isCreatorMode && preset && (
            <section className="space-y-2 pt-4 border-t border-line">
              {preset.description && <p className="text-xs text-ink-2 leading-relaxed">{preset.description}</p>}
              <div className="sv-label flex items-center gap-1.5 pt-1"><TrendingUp className="w-3 h-3" /> Critères éliminatoires</div>
              <div>
                {Object.entries(effectiveThresholds).map(([key, val]) => (
                  <div key={key} className="flex justify-between items-center h-6 text-xs border-b border-line/60">
                    <span className="text-ink-2 truncate max-w-[190px]" title={key}>{metricLabel(key)}</span>
                    <span className="text-ink num font-semibold">≥ P{val}</span>
                  </div>
                ))}
              </div>
              {preset.weights && (
                <>
                  <div className="sv-label flex items-center gap-1.5 pt-2"><Scale className="w-3 h-3" /> Critères de classement</div>
                  <div>
                    {Object.entries(preset.weights).map(([key, w]) => (
                      <div key={key} className="flex justify-between items-center h-6 text-xs">
                        <span className="text-ink-3 truncate max-w-[190px]" title={metricLabel(key)}>{metricLabel(key)}</span>
                        <span className="text-ink-4 num">{w < 0 ? 'moins = mieux' : `×${w}`}</span>
                      </div>
                    ))}
                    {preset.midfieldProfiles && (
                      <div className="flex justify-between items-center h-6 text-xs">
                        <span className="text-ink-3">Profil de milieu : {preset.midfieldProfiles.join(', ')}</span>
                        <span className="text-ink-4 num">+{MIDFIELD_PROFILE_BONUS}</span>
                      </div>
                    )}
                  </div>
                  <p className="text-2xs text-ink-4 leading-relaxed">L'indice du rôle (0-100) est la moyenne pondérée des percentiles de tous ces critères ; il ordonne les résultats.</p>
                </>
              )}
            </section>
          )}

          {/* 3. Contraintes */}
          <section className="space-y-3 pt-4 border-t border-line">
            <div className="sv-label flex items-center gap-1.5"><Filter className="w-3 h-3" /> Contraintes</div>
            <Constraint label="Âge max" value={`${ageLimit} ans`}>
              <input type="range" min="16" max="30" step="1" value={ageLimit} onChange={(e) => setAgeLimit(Number(e.target.value))} className="w-full h-1" />
            </Constraint>
            <Constraint label="Valeur max" value={formatCurrency(marketValueLimit)}>
              <input type="range" min="0" max="100000000" step="500000" value={marketValueLimit} onChange={(e) => setMarketValueLimit(Number(e.target.value))} className="w-full h-1" />
            </Constraint>
            <Constraint label="Minutes min" value={`${minMinutesPlayed.toLocaleString('fr-FR')}'`}>
              <input type="range" min="0" max="3000" step="100" value={minMinutesPlayed} onChange={(e) => setMinMinutesPlayed(Number(e.target.value))} className="w-full h-1" />
            </Constraint>
            <label className="block">
              <span className="text-xs text-ink-2">Fin de contrat sous</span>
              <select className="sv-select sv-select-sm w-full mt-1" value={contractMonths} onChange={(e) => setContractMonths(Number(e.target.value))}>
                <option value={0}>Indifférent</option>
                <option value={6}>6 mois</option>
                <option value={12}>12 mois</option>
                <option value={18}>18 mois</option>
                <option value={24}>24 mois</option>
              </select>
            </label>
            <label className="block">
              <span className="text-xs text-ink-2">Compétition</span>
              <select className="sv-select sv-select-sm w-full mt-1" value={selectedLeague} onChange={(e) => setSelectedLeague(e.target.value)}>
                <option value="">Toutes les compétitions</option>
                {leagues.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-2 text-xs text-ink-2 cursor-pointer">
              <input type="checkbox" checked={undervaluedOnly} onChange={(e) => setUndervaluedOnly(e.target.checked)} />
              Sous-coté par le modèle (≥ ×{UNDERVALUED_RATIO})
            </label>
            <button onClick={() => { setAgeLimit(23); setContractMonths(12); }} className="sv-btn sv-btn-secondary sv-btn-sm w-full">
              U23 · contrat finissant sous 12 mois
            </button>
            <p className="text-2xs text-ink-4 leading-relaxed">Les filtres de contrat et de valeur utilisent l'instantané Transfermarkt actuel : ils ne concernent que la saison en cours.</p>
          </section>
        </div>
      </aside>

      {/* ===== Résultats ===== */}
      <div className="flex-1 min-w-0 flex flex-col h-full">
        <div className="px-5 py-3 border-b border-line flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-baseline gap-2">
              <h1 className="text-base font-semibold text-ink">{selectedRole || 'Résultats'}</h1>
              {preset && <span className="text-xs text-ink-3"><span className="text-ink font-semibold num">{filteredPlayers.length}</span> joueurs</span>}
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-ink-3 mt-0.5">
              {preset ? (
                <>
                  <span>Exigence <span className="text-ink-2 num">{Math.round(strictnessMultiplier * 100)} %</span></span>
                  <span>Postes <span className="text-ink-2">{preset.positions.map(positionLabel).join(', ')}</span></span>
                  <span>≤ {ageLimit} ans · ≤ {formatCurrency(marketValueLimit)} · ≥ {minMinutesPlayed.toLocaleString('fr-FR')} min</span>
                </>
              ) : <span>Choisissez un rôle à gauche pour lancer la recherche.</span>}
            </div>
          </div>
          {filteredPlayers.length > 0 && (
            <button onClick={() => exportProspects(filteredPlayers, selectedRole, thresholdKeys)} className="sv-btn sv-btn-secondary">
              <Download className="w-3.5 h-3.5" /> Exporter ({filteredPlayers.length})
            </button>
          )}
        </div>

        <div className="flex-1 min-h-0 overflow-auto">
          {filteredPlayers.length === 0 ? (
            <EmptyState icon={selectedRole ? AlertCircle : Gem} className="h-full"
              title={selectedRole ? 'Aucun joueur ne passe les seuils actuels' : 'Choisissez un rôle'}>
              {selectedRole
                ? 'Baissez l\'exigence (−10 %) ou élargissez l\'âge, la valeur et les minutes.'
                : 'Chaque rôle applique ses seuils de percentile, puis classe les joueurs par indice du rôle.'}
            </EmptyState>
          ) : (
            <table className="sv-table whitespace-nowrap">
              <thead>
                <tr>
                  <th className="pl-5 w-10 sticky left-0 z-20">#</th>
                  <th className="sticky left-10 z-20">Joueur</th>
                  <th className="text-right" title="Indice du rôle : moyenne pondérée des percentiles des critères">Indice</th>
                  <th className="text-right">Âge</th>
                  <th>Poste</th>
                  <th className="text-right">Min</th>
                  <th className="text-right">Valeur</th>
                  <th className="text-right">Contrat</th>
                  {thresholdKeys.map(key => (
                    <th key={key} className="text-right !normal-case !tracking-normal !text-2xs" title={metricLabel(key)}>
                      <span className="inline-block max-w-[7.5rem] truncate align-bottom">{metricLabel(key).replace(' par 90', '/90')}</span>
                    </th>
                  ))}
                  <th className="pr-5"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {filteredPlayers.map((player, idx) => {
                  const index = roleIndex(player, preset!);
                  const id = getPlayerSeasonId(player);
                  const watched = watchlistIds.has(id);
                  const market = Number(player['Market value']);
                  return (
                    <tr key={id} className="group cursor-pointer" onClick={() => onSelectPlayer(player)}>
                      <td className="pl-5 text-ink-4 text-xs sticky left-0 bg-surface group-hover:bg-raised">{idx + 1}</td>
                      <td className="sticky left-10 bg-surface group-hover:bg-raised">
                        <div className="flex items-center gap-2.5">
                          <PlayerAvatar player={player} size="sm" season={multiSeason ? getSeasonShortLabel(extractSeason(player.League)) : undefined} />
                          <div className="min-w-0">
                            <div className="text-[13px] font-medium text-ink group-hover:text-accent transition-colors">{player.Player || 'Inconnu'}</div>
                            <div className="text-2xs text-ink-3 max-w-[14rem]"><TeamLine player={player} /></div>
                          </div>
                        </div>
                      </td>
                      <td className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <PercentileBar value={index} className="w-12" />
                          <span className="text-ink font-semibold num w-6 text-right">{index}</span>
                        </div>
                      </td>
                      <td className="text-right text-ink-2">{player.Age}</td>
                      <td><span className="sv-tag">{positionLabel(player.Position)}</span></td>
                      <td className="text-right text-ink-3">{Number(player['Minutes played']).toLocaleString('fr-FR')}</td>
                      <td className="text-right">
                        <div className="text-ink font-medium">{formatCurrency(market)}</div>
                        {typeof player['Estimated value'] === 'number' && market > 0 && (
                          <div className={`text-2xs ${player['Estimated value'] / market >= UNDERVALUED_RATIO ? 'text-pos' : 'text-ink-4'}`} title="Valeur estimée par la performance (modèle)">
                            modèle ×{(player['Estimated value'] / market).toFixed(1)}
                          </div>
                        )}
                      </td>
                      <td className="text-right text-xs text-ink-3">{player['Contract expires'] ? String(player['Contract expires']).slice(0, 7).split('-').reverse().join('/') : '–'}</td>
                      {thresholdKeys.map(key => (
                        <td key={key} className="text-right">
                          <div className="text-xs text-ink-2 num">{Number(player[key]).toFixed(2)}</div>
                          <PercentileValue value={Number(player[`${key} pct`])} className="text-2xs" />
                        </td>
                      ))}
                      <td className="pr-5">
                        <div className="flex items-center justify-end gap-0.5">
                          <button onClick={(e) => toggleWatchlist(player, e)} className={`sv-icon-btn ${watched ? '!text-warn' : 'opacity-60 group-hover:opacity-100'}`}
                            title={watched ? 'Retirer de la liste de suivi' : 'Ajouter à la liste de suivi'} aria-pressed={watched}>
                            <Star className={`w-3.5 h-3.5 ${watched ? 'fill-warn' : ''}`} />
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); onSelectPlayer(player); }} className="sv-icon-btn opacity-60 group-hover:opacity-100" title="Voir la fiche">
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};

export default Prospects;