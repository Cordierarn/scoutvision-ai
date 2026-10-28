import React, { useState, useMemo, useCallback } from 'react';
import { PlayerData, extractSeason, getPlayerSeasonId, getSeasonShortLabel } from '../types';
import { Search, X, Settings2, Plus, TrendingUp, Percent, Users, Trash2, ArrowLeftRight } from 'lucide-react';
import { ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, Tooltip } from 'recharts';
import { queryService } from '../services/queryService';
import { getMetricKeys } from '../utils/positionMetrics';
import { metricLabel, positionLabel } from '../utils/labels';
import { TeamLine, PlayerAvatar } from './Media';
import { PageHeader, Panel, LegendItem, PercentileValue, EmptyState, PolarTick } from './ui';
import { SERIES, polarGridProps, tooltipProps } from '../theme/charts';

interface PlayerComparisonProps {
  data: PlayerData[];
}

const DEFAULT_METRICS = [
  'Goals', 'xG', 'Assists', 'xA', 'Passes per 90', 
  'Accurate passes, %', 'Duels won, %', 'Successful defensive actions per 90'
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

  const formatRaw = (v: number) => (v % 1 !== 0 ? v.toFixed(2) : String(v));
  const lastName = (p: PlayerData) => (p.Player || 'Inconnu').split(' ').pop();

  return (
    <div className="p-5 space-y-4 animate-fade-in">
      <PageHeader
        title="Comparaison de joueurs"
        icon={ArrowLeftRight}
        description="Jusqu'à 4 joueurs, toutes saisons chargées. Le même joueur peut être ajouté sur deux saisons pour mesurer sa progression."
        actions={selectedPlayers.length > 0 && (
          <>
            <div className="sv-seg" role="group" aria-label="Affichage">
              <button onClick={() => setViewMode('raw')} className={`sv-seg-btn ${viewMode === 'raw' ? 'sv-seg-on' : ''}`} aria-pressed={viewMode === 'raw'}>
                <TrendingUp className="w-3.5 h-3.5" /> Valeurs
              </button>
              <button onClick={() => setViewMode('percentile')} className={`sv-seg-btn ${viewMode === 'percentile' ? 'sv-seg-on' : ''}`} aria-pressed={viewMode === 'percentile'}>
                <Percent className="w-3.5 h-3.5" /> Percentiles
              </button>
            </div>
            <button onClick={() => setShowMetricConfig(!showMetricConfig)} aria-expanded={showMetricConfig}
              className={`sv-btn sv-btn-secondary ${showMetricConfig ? '!border-accent/60 !text-accent' : ''}`}>
              <Settings2 className="w-3.5 h-3.5" /> Métriques ({selectedMetrics.length})
            </button>
          </>
        )}
      />

      {/* Joueurs comparés : couleur fixe par emplacement */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        {selectedPlayers.map((player, idx) => {
          const season = extractSeason(player.League);
          return (
            <div key={getPlayerSeasonId(player)} className="sv-panel relative flex items-center gap-3 pl-4 pr-2 py-2.5 overflow-hidden">
              <span className="absolute left-0 inset-y-0 w-[3px]" style={{ backgroundColor: SERIES[idx] }} aria-hidden />
              <PlayerAvatar player={player} size="md" />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium text-ink truncate">{player.Player || 'Inconnu'}</div>
                <div className="text-2xs text-ink-3 truncate"><TeamLine player={player} /></div>
                <div className="flex items-center gap-1.5 mt-1">
                  <span className="sv-tag">{positionLabel(player.Position)}</span>
                  <span className="sv-tag !font-normal">{player.Age ?? '?'} ans</span>
                  <span className="sv-tag !font-normal">{getSeasonShortLabel(season)}</span>
                </div>
              </div>
              <button onClick={() => removePlayer(idx)} className="sv-icon-btn self-start hover:!text-neg" title="Retirer">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })}

        {selectedPlayers.length < 4 && (
          <div className="relative">
            {!isSearching ? (
              <button onClick={() => setIsSearching(true)}
                className="w-full h-full min-h-[74px] rounded-lg border border-dashed border-line-strong hover:border-accent/60 hover:text-accent text-ink-3 flex items-center justify-center gap-2 text-sm transition-colors">
                <Plus className="w-4 h-4" /> Ajouter un joueur
                <span className="text-2xs text-ink-4">{selectedPlayers.length}/4</span>
              </button>
            ) : (
              <div className="sv-panel !border-accent/60 p-2 min-h-[74px]">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-4" />
                  <input autoFocus type="text" placeholder="Nom du joueur" className="sv-input pl-8 pr-8"
                    value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Escape') setIsSearching(false); }} />
                  <button onClick={() => setIsSearching(false)} className="absolute right-1 top-1/2 -translate-y-1/2 sv-icon-btn !w-6 !h-6" aria-label="Fermer"><X className="w-3.5 h-3.5" /></button>
                </div>
                {(searchResults.length > 0 || searchTerm) && (
                  <div className="sv-menu absolute left-0 right-0 top-full mt-1 z-30 max-h-72 overflow-y-auto">
                    {searchResults.map(p => (
                      <button key={getPlayerSeasonId(p)} onClick={() => addPlayer(p)} className="sv-menu-item flex items-center gap-2">
                        <PlayerAvatar player={p} size="xs" />
                        <span className="min-w-0 flex-1">
                          <span className="block text-xs text-ink truncate">{p.Player || 'Inconnu'}</span>
                          <span className="block text-2xs text-ink-3 truncate"><TeamLine player={p} /></span>
                        </span>
                        <span className="sv-tag">{getSeasonShortLabel(extractSeason(p.League))}</span>
                      </button>
                    ))}
                    {searchTerm && searchResults.length === 0 && <div className="px-3 py-2 text-xs text-ink-4">Aucun résultat</div>}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Choix des métriques */}
      {showMetricConfig && selectedPlayers.length > 0 && (
        <Panel title="Métriques comparées" subtitle="Cliquez pour ajouter ou retirer une métrique."
          right={<button onClick={() => setShowMetricConfig(false)} className="sv-icon-btn" aria-label="Fermer"><X className="w-4 h-4" /></button>}>
          <div className="relative mb-3 max-w-sm">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-4" />
            <input type="text" placeholder="Rechercher une métrique" className="sv-input sv-input-sm pl-8" value={metricSearch} onChange={(e) => setMetricSearch(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-x-4 gap-y-px max-h-56 overflow-y-auto">
            {numericKeys
              .filter(k => k.toLowerCase().includes(metricSearch.toLowerCase()) || metricLabel(k).toLowerCase().includes(metricSearch.toLowerCase()))
              .map(key => {
                const on = selectedMetrics.includes(key);
                return (
                  <label key={key} className="flex items-center gap-2 h-7 text-xs cursor-pointer select-none">
                    <input type="checkbox" checked={on} onChange={() => toggleMetric(key)} />
                    <span className={`truncate ${on ? 'text-ink' : 'text-ink-3'}`}>{metricLabel(key)}</span>
                  </label>
                );
              })}
          </div>
        </Panel>
      )}

      {selectedPlayers.length > 0 ? (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
          <Panel className="xl:col-span-5" title="Radar superposé"
            subtitle="Échelle : valeur rapportée au maximum de la base chargée (0-100) pour chaque métrique.">
            <div className="h-[380px] -mx-2">
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart cx="50%" cy="50%" outerRadius="66%" data={chartData} margin={{ top: 18, right: 30, bottom: 18, left: 30 }}>
                  <PolarGrid {...polarGridProps} />
                  <PolarAngleAxis dataKey="subject" tick={<PolarTick />} />
                  <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
                  {selectedPlayers.map((p, idx) => (
                    <Radar key={getPlayerSeasonId(p)} name={p.Player} dataKey={p.Player}
                      stroke={SERIES[idx]} strokeWidth={2} fill={SERIES[idx]} fillOpacity={idx === 0 ? 0.12 : 0.05} isAnimationActive={false} />
                  ))}
                  <Tooltip {...tooltipProps} />
                </RadarChart>
              </ResponsiveContainer>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {selectedPlayers.map((p, idx) => (
                <LegendItem key={getPlayerSeasonId(p)} color={SERIES[idx]} shape="line">{p.Player} · {getSeasonShortLabel(extractSeason(p.League))}</LegendItem>
              ))}
            </div>
          </Panel>

          <Panel className="xl:col-span-7" flush title={viewMode === 'raw' ? 'Valeurs' : 'Percentiles'}
            subtitle={viewMode === 'raw'
              ? 'Meilleure valeur de chaque ligne en gras, avec la couleur du joueur.'
              : 'Percentile parmi tous les joueurs chargés (toutes positions).'}>
            <div className="overflow-x-auto">
              <table className="sv-table">
                <thead>
                  <tr>
                    <th className="pl-4">Métrique</th>
                    {selectedPlayers.map((p, idx) => (
                      <th key={getPlayerSeasonId(p)} className="text-right" title={p.Player || 'Inconnu'}>
                        <span className="inline-flex items-center gap-1.5 normal-case tracking-normal text-xs text-ink-2">
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: SERIES[idx] }} />{lastName(p)}
                        </span>
                      </th>
                    ))}
                    <th className="w-8 pr-4"><span className="sr-only">Retirer</span></th>
                  </tr>
                </thead>
                <tbody>
                  {selectedMetrics.map(key => {
                    const rowValues = selectedPlayers.map(p => Number(p[key]) || 0);
                    const maxVal = Math.max(...rowValues);
                    return (
                      <tr key={key} className="group">
                        <td className="pl-4 text-ink-2 text-xs" title={key}>{metricLabel(key)}</td>
                        {selectedPlayers.map((p, idx) => {
                          const val = Number(p[key]) || 0;
                          const isBest = val === maxVal && val !== 0 && selectedPlayers.length > 1;
                          return (
                            <td key={`${getPlayerSeasonId(p)}-${key}`} className="text-right text-xs num">
                              {viewMode === 'raw' ? (
                                <span className={`inline-flex items-center gap-1.5 ${isBest ? 'text-ink font-semibold' : 'text-ink-3'}`}>
                                  {isBest && <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: SERIES[idx] }} aria-label="meilleure valeur" />}
                                  {formatRaw(val)}
                                </span>
                              ) : (
                                <PercentileValue value={calculatePercentile(val, key)} />
                              )}
                            </td>
                          );
                        })}
                        <td className="pr-4">
                          <button onClick={() => toggleMetric(key)} className="sv-icon-btn !w-6 !h-6 opacity-0 group-hover:opacity-100 hover:!text-neg" title="Retirer la métrique">
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {selectedMetrics.length === 0 && (
                <EmptyState title="Aucune métrique">Utilisez « Métriques » pour en ajouter.</EmptyState>
              )}
            </div>
          </Panel>
        </div>
      ) : (
        <div className="sv-panel">
          <EmptyState icon={Users} title="Aucun joueur choisi">
            « Ajouter un joueur » pour composer la comparaison (4 joueurs au plus). Le premier joueur sert de référence (cyan).
          </EmptyState>
        </div>
      )}
    </div>
  );
};

export default PlayerComparison;