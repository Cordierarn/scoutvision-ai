import React, { useState, useMemo, useEffect, useRef } from 'react';
import { PlayerData, extractSeason, getPlayerSeasonId, getSeasonShortLabel } from '../types';
import { Search, ChevronDown, ChevronUp, Eye, SlidersHorizontal, Plus, X, Download, Star } from 'lucide-react';
import { exportToCSV } from '../utils/exportUtils';
import { getWatchlist, addToWatchlist, removeFromWatchlist } from '../services/storageService';
import { getMetricKeys } from '../utils/positionMetrics';
import { metricLabel, positionLabel, positionName } from '../utils/labels';
import { TeamLine, CountryFlag, PlayerAvatar } from './Media';
import { EmptyState, PercentileValue } from './ui';

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
  const [sortField, setSortField] = useState<SortField>('Minutes played');
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

  const positions = useMemo(() => {
    const posSet = new Set(data.map(p => p.Position).filter(Boolean));
    return ['All', ...Array.from(posSet)];
  }, [data]);

  // Badge de saison seulement quand plusieurs saisons sont chargées
  const multiSeason = useMemo(() => new Set(data.map(p => extractSeason(p.League))).size > 1, [data]);

  const numericKeys = useMemo(() => {
    if (data.length === 0) return [];
    return getMetricKeys(data);
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

  // Rendu progressif : une saison compte plus de 6 000 joueurs
  const PAGE_SIZE = 100;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const loadMoreRef = useRef<HTMLDivElement>(null);

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

  // Revenir au début de la liste quand la recherche, les filtres ou le tri changent
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [filteredAndSortedData]);

  // Afficher la page suivante quand le bas de la liste devient visible
  useEffect(() => {
    const sentinel = loadMoreRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) setVisibleCount(count => count + PAGE_SIZE);
    }, { rootMargin: '400px' });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [visibleCount, filteredAndSortedData]);

  const formatValue = (val: number) => {
    if (!val) return '–';
    if (val >= 1000000) return `€${(val / 1000000).toFixed(1)}M`;
    if (val >= 1000) return `€${(val / 1000).toFixed(0)}K`;
    return `€${val}`;
  };

  // En-tête de colonne triable (aria-sort pour les lecteurs d'écran)
  const SortHeader: React.FC<{ field: SortField; label: string; align?: 'left' | 'right'; title?: string; className?: string }> = ({ field, label, align = 'left', title, className = '' }) => {
    const active = sortField === field;
    return (
      <th
        aria-sort={active ? (sortOrder === 'asc' ? 'ascending' : 'descending') : 'none'}
        className={`${align === 'right' ? 'text-right' : ''} ${className}`}
        title={title}
      >
        <button
          onClick={() => handleSort(field)}
          className={`inline-flex items-center gap-1 uppercase tracking-[0.08em] hover:text-ink transition-colors ${active ? 'text-ink' : ''} ${align === 'right' ? 'flex-row-reverse' : ''}`}
        >
          {label}
          {active ? (sortOrder === 'asc' ? <ChevronUp className="w-3 h-3 text-accent" /> : <ChevronDown className="w-3 h-3 text-accent" />) : <span className="w-3" />}
        </button>
      </th>
    );
  };

  const num = (v: unknown, digits = 0) => (typeof v === 'number' ? v.toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '–');

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Barre d'outils : recherche, poste, filtres, export */}
      <div className="px-5 pt-4 pb-3 border-b border-line space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-80">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-4" />
            <input
              type="text"
              placeholder="Rechercher un joueur ou un club"
              className="sv-input pl-8"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              aria-label="Rechercher un joueur ou un club"
            />
          </div>

          <select
            value={positionFilter}
            onChange={(e) => setPositionFilter(e.target.value)}
            className="sv-select"
            aria-label="Poste"
          >
            {positions.map(p => <option key={p} value={p}>{p === 'All' ? 'Tous les postes' : positionName(p)}</option>)}
          </select>

          <button
            onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
            aria-expanded={showAdvancedFilters}
            className={`sv-btn sv-btn-secondary ${showAdvancedFilters ? '!border-accent/60 !text-accent' : ''}`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            Filtres statistiques
            {activeFilters.length > 0 && (
              <span className="min-w-[18px] h-[18px] px-1 rounded-sm bg-accent text-accent-ink text-2xs font-bold flex items-center justify-center">
                {activeFilters.length}
              </span>
            )}
          </button>

          <div className="ml-auto flex items-center gap-3">
            <span className="text-xs text-ink-3"><span className="text-ink font-semibold num">{filteredAndSortedData.length.toLocaleString('fr-FR')}</span> joueurs</span>
            <button
              onClick={() => exportToCSV(filteredAndSortedData.slice(0, 500), 'players')}
              disabled={filteredAndSortedData.length === 0}
              className="sv-btn sv-btn-secondary"
              title="Exporter les 500 premiers résultats"
            >
              <Download className="w-3.5 h-3.5" />
              Exporter CSV
            </button>
          </div>
        </div>

        {/* Filtres statistiques : toutes les conditions sont requises */}
        {showAdvancedFilters && (
          <div className="sv-panel p-3 animate-fade-in-down">
            <div className="flex items-center justify-between mb-2">
              <span className="sv-label">Conditions <span className="normal-case tracking-normal font-normal text-ink-4">(toutes requises)</span></span>
              <button onClick={addFilter} className="sv-btn sv-btn-ghost sv-btn-sm !text-accent">
                <Plus className="w-3.5 h-3.5" /> Ajouter une condition
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
              {activeFilters.map((filter) => (
                <div key={filter.id} className="flex items-center gap-1.5">
                  <select
                    value={filter.key}
                    onChange={(e) => updateFilter(filter.id, 'key', e.target.value)}
                    className="sv-select sv-select-sm flex-1 min-w-0"
                    aria-label="Métrique"
                  >
                    {numericKeys.map(k => <option key={k} value={k}>{metricLabel(k)}</option>)}
                  </select>
                  <input
                    type="number"
                    placeholder="Min"
                    className="sv-input sv-input-sm !w-20"
                    value={filter.min}
                    onChange={(e) => updateFilter(filter.id, 'min', e.target.value)}
                    aria-label="Minimum"
                  />
                  <span className="text-ink-4 text-xs">–</span>
                  <input
                    type="number"
                    placeholder="Max"
                    className="sv-input sv-input-sm !w-20"
                    value={filter.max}
                    onChange={(e) => updateFilter(filter.id, 'max', e.target.value)}
                    aria-label="Maximum"
                  />
                  <button onClick={() => removeFilter(filter.id)} className="sv-icon-btn hover:!text-neg" title="Retirer la condition">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              {activeFilters.length === 0 && (
                <p className="col-span-full text-xs text-ink-3 py-1">
                  Aucune condition. « Ajouter une condition » filtre sur une statistique (par exemple xG supérieur à 0,5).
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Tableau */}
      <div className="flex-1 min-h-0 overflow-auto">
        <table className="sv-table">
          <thead>
            <tr>
              <SortHeader field="Player" label="Joueur" className="pl-5" />
              <SortHeader field="Age" label="Âge" align="right" />
              <SortHeader field="Position" label="Poste" />
              <SortHeader field="Team" label="Club" />
              <SortHeader field="Minutes played" label="Min" align="right" title="Minutes jouées" />
              <SortHeader field="Goals" label="Buts" align="right" />
              <SortHeader field="Assists" label="PD" align="right" title="Passes décisives" />
              <SortHeader field="xG" label="xG" align="right" />
              <SortHeader field="xA" label="xA" align="right" />
              <SortHeader field="Rating" label="Note" align="right" title="Note moyenne et percentile du rôle" />
              <SortHeader field="Market value" label="Valeur" align="right" title="Valeur Transfermarkt" />
              <SortHeader field="Contract expires" label="Contrat" align="right" />
              <th className="w-[72px] pr-5"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {filteredAndSortedData.slice(0, visibleCount).map((player, idx) => {
              const season = extractSeason(player.League);
              const id = getPlayerSeasonId(player);
              const watched = watchlistIds.has(id);
              return (
                <tr
                  key={`${player.Player}-${player.Team}-${season}-${idx}`}
                  className="group cursor-pointer"
                  onClick={() => onSelectPlayer(player)}
                >
                  <td className="pl-5">
                    <div className="flex items-center gap-2.5 min-w-[13rem]">
                      <PlayerAvatar player={player} size="sm" />
                      <div className="min-w-0">
                        <div className="text-[13px] font-medium text-ink truncate group-hover:text-accent transition-colors">{player.Player}{multiSeason && <span className="sv-tag !h-4 !px-1 !text-[9px] ml-1.5 align-middle !font-medium">{getSeasonShortLabel(season)}</span>}</div>
                        {player['Passport country'] && (
                          <div className="flex items-center gap-1 text-2xs text-ink-4">
                            <CountryFlag code={String(player['Passport country'])} className="w-3 h-2" />
                            {player['Passport country']}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="text-right text-ink-2">{player.Age ?? '–'}</td>
                  <td><span className="sv-tag" title={positionName(player.Position)}>{positionLabel(player.Position)}</span></td>
                  <td className="text-ink-2 max-w-[15rem]"><TeamLine player={player} className="max-w-full" /></td>
                  <td className="text-right text-ink-3">{num(player['Minutes played'])}</td>
                  <td className="text-right text-ink">{num(player.Goals)}</td>
                  <td className="text-right text-ink">{num(player.Assists)}</td>
                  <td className="text-right text-ink-2">{num(Number(player.xG) || 0, 2)}</td>
                  <td className="text-right text-ink-2">{num(Number(player.xA) || 0, 2)}</td>
                  <td className="text-right whitespace-nowrap">
                    <span className="text-ink-2">{typeof player.Rating === 'number' ? player.Rating.toFixed(2) : '–'}</span>
                    {typeof player['Rating pct'] === 'number' && <PercentileValue value={player['Rating pct'] as number} className="ml-2 text-2xs w-9 justify-end" />}
                  </td>
                  <td className="text-right text-ink font-medium">{formatValue(Number(player['Market value']) || 0)}</td>
                  <td className="text-right text-ink-3 text-xs">{player['Contract expires'] ? String(player['Contract expires']).slice(0, 7).split('-').reverse().join('/') : '–'}</td>
                  <td className="pr-5">
                    <div className="flex justify-end gap-0.5">
                      <button
                        onClick={(e) => toggleWatchlist(player, e)}
                        className={`sv-icon-btn ${watched ? '!text-warn' : 'opacity-60 group-hover:opacity-100'}`}
                        title={watched ? 'Retirer de la liste de suivi' : 'Ajouter à la liste de suivi'}
                        aria-pressed={watched}
                      >
                        <Star className={`w-3.5 h-3.5 ${watched ? 'fill-warn' : ''}`} />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); onSelectPlayer(player); }}
                        className="sv-icon-btn opacity-60 group-hover:opacity-100"
                        title="Voir la fiche"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filteredAndSortedData.length === 0 && (
          <EmptyState icon={Search} title="Aucun joueur ne correspond à ces critères." />
        )}
        {visibleCount < filteredAndSortedData.length && (
          <div ref={loadMoreRef} className="p-3 text-center text-2xs text-ink-4">
            {visibleCount} sur {filteredAndSortedData.length} joueurs affichés…
          </div>
        )}
      </div>
    </div>
  );
};

export default PlayerList;