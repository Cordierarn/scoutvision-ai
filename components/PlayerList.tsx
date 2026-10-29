import React, { useState, useMemo, useEffect, useRef, useLayoutEffect, useDeferredValue } from 'react';
import { PlayerData, extractSeason, getPlayerSeasonId, getPlayerSeasonTag, getSeasonLabel } from '../types';
import { Search, ChevronDown, ChevronUp, ChevronsUpDown, Eye, SlidersHorizontal, Plus, X, Download, Star, Columns3, RotateCcw, Users, Check } from 'lucide-react';
import { exportToCSV } from '../utils/exportUtils';
import { getWatchlist, addToWatchlist, removeFromWatchlist } from '../services/storageService';
import { getMetricKeys } from '../utils/positionMetrics';
import { isRowActivation } from '../utils/rowKeys';
import { formatEuro } from '../utils/format';
import { metricLabel, positionLabel, positionName } from '../utils/labels';
import { TeamLine, CountryFlag, PlayerAvatar } from './Media';
import { EmptyState, PercentileValue } from './ui';

interface PlayerListProps {
  data: PlayerData[];
  onSelectPlayer: (player: PlayerData) => void;
  selectedId?: string;               // dernier joueur consulté, mis en évidence au retour
}

type SortField = keyof PlayerData;
type SortOrder = 'asc' | 'desc';

interface FilterCondition {
  id: string;
  key: string;
  min: number | string;
  max: number | string;
}

// Colonnes facultatives : contexte (minutes, contrat) puis métriques des données ; xG et xA toujours visibles.
// Défaut : Joueur | Âge | Poste | Club | Valeur | Min | xG | xA | Note
const LOCKED_STATS = ['xG', 'xA'];
const CONTEXT_COLUMNS = ['Contract expires', 'Minutes played'];
const DEFAULT_COLUMNS = ['Minutes played', 'Rating'];
const MAX_EXTRA_STATS = 8;
// Préférences versionnées : une version précédente ou illisible revient aux colonnes par défaut
const COLUMNS_KEY = 'scoutvision_db_columns';
const COLUMNS_VERSION = 2;

// Recherche, filtres, tri et défilement retrouvés au retour d'une fiche joueur
const memory = {
  searchTerm: '',
  sortField: 'Minutes played' as SortField,
  sortOrder: 'desc' as SortOrder,
  positionFilter: 'All',
  activeFilters: [] as FilterCondition[],
  showAdvancedFilters: false,
  visibleCount: 100,
  scrollTop: 0,
  signature: '',
};

function loadExtraStats(): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(COLUMNS_KEY) ?? 'null');
    if (saved?.version === COLUMNS_VERSION && Array.isArray(saved.columns)) {
      const keys: string[] = saved.columns.filter((k: unknown): k is string => typeof k === 'string' && !LOCKED_STATS.includes(k));
      return Array.from(new Set(keys)).slice(0, MAX_EXTRA_STATS);
    }
  } catch { /* stockage indisponible ou illisible : colonnes par défaut */ }
  return DEFAULT_COLUMNS;
}

function saveExtraStats(keys: string[]) {
  try { localStorage.setItem(COLUMNS_KEY, JSON.stringify({ version: COLUMNS_VERSION, columns: keys })); } catch { /* non bloquant */ }
}

// Infobulles d'en-tête, d'après le pipeline (scripts/prepare_data.py, README) : xG et xA sont des totaux de saison
const HEADER_TIPS: Record<string, string> = {
  xG: 'Expected goals cumulés sur la saison sélectionnée',
  xA: 'Expected assists cumulées sur la saison sélectionnée',
};

// Percentiles PitchAPI (« X pct ») : même rôle, même niveau de compétition, même saison
const PERCENTILE_TIP = 'Percentile de la note (0-100) parmi les joueurs du même rôle (GK, CB, FB, WB, DM, CM, AM, W, ST) et du même niveau de compétition, sur la même saison.\nComparaison par rôle et par niveau, pas par compétition.';

// Libellé court d'en-tête (« Actions défensives réussies par 90 » -> « Actions défensives réussies /90 »)
const SHORT_LABELS: Record<string, string> = { Goals: 'Buts', Assists: 'PD', Rating: 'Note', 'Minutes played': 'Min' };
const shortLabel = (key: string) => SHORT_LABELS[key] ?? metricLabel(key).replace(/ par 90$/, ' /90').replace(/, %$/, ' %');

const formatValue = (val: number) => (val ? formatEuro(val) : '–');

// Nombres au format français, un formateur par nombre de décimales (créer un Intl.NumberFormat
// par cellule coûte cher sur des centaines de lignes)
const FR_FORMATS = new Map<number, Intl.NumberFormat>();
const formatFr = (v: number, digits: number) => {
  let f = FR_FORMATS.get(digits);
  if (!f) { f = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits }); FR_FORMATS.set(digits, f); }
  return f.format(v);
};

// Métriques numériques d'une saison, calculées une fois par jeu de données (et non à chaque
// retour sur la liste)
const METRIC_KEYS = new WeakMap<PlayerData[], string[]>();
const metricKeysOf = (data: PlayerData[]) => {
  let keys = METRIC_KEYS.get(data);
  if (!keys) { keys = getMetricKeys(data); METRIC_KEYS.set(data, keys); }
  return keys;
};

const PlayerList: React.FC<PlayerListProps> = ({ data, onSelectPlayer, selectedId }) => {
  const [searchTerm, setSearchTerm] = useState(memory.searchTerm);
  const [sortField, setSortField] = useState<SortField>(memory.sortField);
  const [sortOrder, setSortOrder] = useState<SortOrder>(memory.sortOrder);
  const [positionFilter, setPositionFilter] = useState<string>(memory.positionFilter);

  // Advanced Filters State
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(memory.showAdvancedFilters);
  const [activeFilters, setActiveFilters] = useState<FilterCondition[]>(memory.activeFilters);

  // Colonnes statistiques choisies
  const [extraStats, setExtraStats] = useState<string[]>(loadExtraStats);
  const [showColumns, setShowColumns] = useState(false);
  const [columnSearch, setColumnSearch] = useState('');
  const columnsRef = useRef<HTMLDivElement>(null);
  const columnsButtonRef = useRef<HTMLButtonElement>(null);

  // Watchlist State
  const [watchlistIds, setWatchlistIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    Object.assign(memory, { searchTerm, sortField, sortOrder, positionFilter, activeFilters, showAdvancedFilters });
  }, [searchTerm, sortField, sortOrder, positionFilter, activeFilters, showAdvancedFilters]);

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

  // Saisons chargées : badge de saison seulement quand il y en a plusieurs
  const seasons = useMemo(() => Array.from(new Set(data.map(p => extractSeason(p.League)))), [data]);
  const multiSeason = seasons.length > 1;

  const numericKeys = useMemo(() => {
    if (data.length === 0) return [];
    return metricKeysOf(data);
  }, [data]);

  // Colonnes choisies encore valides : une colonne mémorisée absente des données est ignorée
  const validExtras = useMemo(() => {
    const available = new Set([...CONTEXT_COLUMNS, ...numericKeys]);
    return extraStats.filter(k => available.has(k));
  }, [numericKeys, extraStats]);
  const contextColumns = CONTEXT_COLUMNS.filter(k => validExtras.includes(k));
  const statColumns = useMemo(() => [
    ...LOCKED_STATS.filter(k => numericKeys.includes(k)),
    ...validExtras.filter(k => !CONTEXT_COLUMNS.includes(k)),
  ], [numericKeys, validExtras]);

  // Note : signification et plage observée dans les données chargées (l'échelle n'est pas documentée par la source)
  const ratingTip = useMemo(() => {
    let min = Infinity, max = -Infinity;
    for (const p of data) if (typeof p.Rating === 'number') { min = Math.min(min, p.Rating); max = Math.max(max, p.Rating); }
    const range = min <= max ? `\nÉchelle non précisée par la source ; valeurs observées : ${min.toFixed(2).replace('.', ',')} à ${max.toFixed(2).replace('.', ',')}.` : '';
    return `Note : moyenne des notes de match de la saison (PitchAPI), qui surpondère les actions offensives.${range}\n\nPxx : ${PERCENTILE_TIP}`;
  }, [data]);

  // Entiers (minutes, buts...) affichés sans décimale
  const integerColumns = useMemo(() => {
    const sample = data.slice(0, 400);
    return new Set(statColumns.filter(k => sample.every(p => p[k] === undefined || Number.isInteger(p[k]))));
  }, [data, statColumns]);

  const updateExtraStats = (keys: string[]) => {
    setExtraStats(keys);
    saveExtraStats(keys);
  };

  const toggleExtraStat = (key: string) => {
    if (LOCKED_STATS.includes(key)) return;
    updateExtraStats(validExtras.includes(key)
      ? validExtras.filter(k => k !== key)
      : validExtras.length < MAX_EXTRA_STATS ? [...validExtras, key] : validExtras);
  };

  // Fermer le sélecteur de colonnes au clic extérieur ou sur Échap
  useEffect(() => {
    if (!showColumns) return;
    const onDown = (e: MouseEvent) => { if (!columnsRef.current?.contains(e.target as Node)) setShowColumns(false); };
    // Échap rend le focus au bouton qui a ouvert le menu
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setShowColumns(false); columnsButtonRef.current?.focus(); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [showColumns]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      // Texte : A → Z d'abord ; nombres : du plus grand au plus petit
      setSortOrder(field === 'Player' || field === 'Team' || field === 'Position' ? 'asc' : 'desc');
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
  const [visibleCount, setVisibleCount] = useState(memory.visibleCount);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Recherche différée : le champ se met à jour à chaque frappe, le filtrage et le rendu du tableau
  // suivent en priorité basse (interruptibles) au lieu de bloquer la saisie
  const deferredSearch = useDeferredValue(searchTerm);

  const filteredAndSortedData = useMemo(() => {
    let result = [...data];

    // Text Search - avec vérification null et type
    if (deferredSearch) {
      const lower = deferredSearch.toLowerCase();
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

    // Tri : valeurs absentes toujours en fin de liste, texte selon l'ordre alphabétique français
    const dir = sortOrder === 'asc' ? 1 : -1;
    result.sort((a, b) => {
      const valA = a[sortField];
      const valB = b[sortField];
      const missingA = valA === undefined || valA === null || valA === '';
      const missingB = valB === undefined || valB === null || valB === '';
      if (missingA || missingB) return missingA === missingB ? 0 : missingA ? 1 : -1;
      if (typeof valA === 'string' && typeof valB === 'string') return dir * valA.localeCompare(valB, 'fr');
      if (valA < valB) return -dir;
      if (valA > valB) return dir;
      return 0;
    });

    return result;
  }, [data, deferredSearch, positionFilter, sortField, sortOrder, activeFilters]);

  // Revenir au début de la liste quand la recherche, les filtres, le tri ou la saison changent ;
  // au retour d'une fiche (mêmes critères), la position de lecture est conservée
  const signature = JSON.stringify([deferredSearch, positionFilter, sortField, sortOrder, activeFilters, data.length]);
  useEffect(() => {
    if (memory.signature === signature) return;
    memory.signature = signature;
    memory.scrollTop = 0;
    setVisibleCount(PAGE_SIZE);
    scrollRef.current?.scrollTo({ top: 0 });
  }, [signature]);

  useEffect(() => { memory.visibleCount = visibleCount; }, [visibleCount]);

  useLayoutEffect(() => {
    if (scrollRef.current && memory.scrollTop) scrollRef.current.scrollTop = memory.scrollTop;
  }, []);

  // Afficher la page suivante quand le bas de la liste devient visible
  useEffect(() => {
    const sentinel = loadMoreRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) setVisibleCount(count => count + PAGE_SIZE);
    }, { root: scrollRef.current, rootMargin: '400px' });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [visibleCount, filteredAndSortedData]);

  const formatStat = (key: string, v: unknown) => {
    if (typeof v !== 'number') return <span className="text-ink-4">–</span>;
    const digits = integerColumns.has(key) ? 0 : key.endsWith(', %') ? 1 : 2;
    const text = formatFr(v, digits);
    // Zéro atténué : les valeurs non nulles ressortent à la lecture d'une colonne
    return <span className={v === 0 ? 'text-ink-4' : ''}>{text}</span>;
  };

  // En-tête de colonne triable (aria-sort pour les lecteurs d'écran)
  const SortHeader: React.FC<{ field: SortField; label: string; align?: 'left' | 'right'; title?: string; tip?: string; className?: string }> = ({ field, label, align = 'left', title, tip, className = '' }) => {
    const active = sortField === field;
    const Icon = !active ? ChevronsUpDown : sortOrder === 'asc' ? ChevronUp : ChevronDown;
    return (
      <th
        aria-sort={active ? (sortOrder === 'asc' ? 'ascending' : 'descending') : 'none'}
        className={`${align === 'right' ? 'text-right' : ''} ${active ? '!text-ink' : ''} ${className}`}
        title={tip ? undefined : title ?? label}
      >
        <button
          onClick={() => handleSort(field)}
          data-tip={tip}
          data-tip-pos={tip ? 'bottom' : undefined}
          data-tip-align={tip ? 'end' : undefined}
          data-tip-wide={tip && tip.length > 60 ? '' : undefined}
          className={`group/sort inline-flex items-center gap-1 max-w-[9rem] uppercase tracking-[0.08em] hover:text-ink transition-colors ${align === 'right' ? 'flex-row-reverse' : ''}`}
        >
          <span className="truncate">{label}</span>
          <Icon className={`w-3 h-3 shrink-0 ${active ? 'text-accent' : 'opacity-0 group-hover/sort:opacity-60'}`} aria-hidden />
        </button>
      </th>
    );
  };

  // Colonne triée légèrement teintée : facilite la comparaison verticale
  const sortedCell = (field: string) => (sortField === field ? 'bg-accent/[0.035]' : '');

  const seasonText = seasons.length === 1 ? getSeasonLabel(seasons[0]) : 'Toutes les saisons';
  const filterCount = activeFilters.length + (positionFilter !== 'All' ? 1 : 0) + (searchTerm ? 1 : 0);
  const columnLabel = (k: string) => k === 'Contract expires' ? 'Fin de contrat' : metricLabel(k);
  const pickable = [...CONTEXT_COLUMNS.slice().reverse(), ...numericKeys].filter(k => !LOCKED_STATS.includes(k)
    && (!columnSearch || k.toLowerCase().includes(columnSearch.toLowerCase()) || columnLabel(k).toLowerCase().includes(columnSearch.toLowerCase())));

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Barre d'outils : identification de la page, recherche, filtres, colonnes, export */}
      <div className="px-5 pt-3 pb-3 border-b border-line bg-surface/40 space-y-2.5">
        <div className="sv-toolbar">
          <div className="flex items-baseline gap-2 mr-2 min-w-0">
            <h1 className="flex items-center gap-1.5 text-sm font-semibold text-ink whitespace-nowrap">
              <Users className="w-4 h-4 text-accent self-center" aria-hidden /> Base joueurs
            </h1>
            <span className="text-2xs text-ink-3 whitespace-nowrap">{seasonText}</span>
          </div>

          <div className="relative w-full sm:w-72 order-last sm:order-none">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-4" aria-hidden />
            <input
              type="text"
              placeholder="Rechercher un joueur ou un club"
              className="sv-input pl-8 pr-7"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              aria-label="Rechercher un joueur ou un club"
            />
            {searchTerm && (
              <button onClick={() => setSearchTerm('')} className="absolute right-1 top-1/2 -translate-y-1/2 sv-icon-btn !w-6 !h-6" aria-label="Effacer la recherche">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <select
            value={positionFilter}
            onChange={(e) => setPositionFilter(e.target.value)}
            className={`sv-select ${positionFilter !== 'All' ? '!border-accent/60 !text-accent' : ''}`}
            aria-label="Poste"
          >
            {positions.map(p => <option key={p} value={p}>{p === 'All' ? 'Tous les postes' : positionName(p)}</option>)}
          </select>

          <button
            onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
            aria-expanded={showAdvancedFilters}
            className={`sv-btn sv-btn-secondary ${showAdvancedFilters || activeFilters.length > 0 ? '!border-accent/60 !text-accent' : ''}`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            Filtres
            {activeFilters.length > 0 && (
              <span className="min-w-[18px] h-[18px] px-1 rounded-sm bg-accent text-accent-ink text-2xs font-bold flex items-center justify-center">
                {activeFilters.length}
              </span>
            )}
          </button>

          {/* Sélecteur de colonnes statistiques */}
          <div className="relative" ref={columnsRef}>
            <button
              ref={columnsButtonRef}
              onClick={() => setShowColumns(!showColumns)}
              aria-expanded={showColumns}
              aria-haspopup="dialog"
              className={`sv-btn sv-btn-secondary ${showColumns ? '!border-accent/60 !text-accent' : ''}`}
            >
              <Columns3 className="w-3.5 h-3.5" /> Colonnes
              <span className="text-2xs text-ink-4 num">{statColumns.length + contextColumns.length}</span>
            </button>
            {showColumns && (
              <div role="dialog" aria-label="Colonnes du tableau" className="sv-menu absolute z-40 left-0 sm:left-auto sm:right-0 mt-1 w-72 p-2 animate-fade-in">
                <div className="flex items-center justify-between px-1 pb-2">
                  <span className="sv-label">Colonnes du tableau</span>
                  <button onClick={() => updateExtraStats(DEFAULT_COLUMNS)} className="sv-btn sv-btn-ghost sv-btn-sm !h-6 !px-1.5" data-tip="Colonnes par défaut" data-tip-pos="left">
                    <RotateCcw className="w-3 h-3" /> Réinitialiser
                  </button>
                </div>
                <div className="relative mb-1.5">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-ink-4" aria-hidden />
                  <input autoFocus type="text" placeholder="Rechercher une métrique" className="sv-input sv-input-sm pl-7"
                    value={columnSearch} onChange={e => setColumnSearch(e.target.value)} aria-label="Rechercher une métrique" />
                </div>
                <div className="max-h-72 overflow-y-auto -mx-1 px-1">
                  {!columnSearch && LOCKED_STATS.filter(k => numericKeys.includes(k)).map(k => (
                    <div key={k} className="flex items-center gap-2 h-7 px-1.5 text-xs text-ink-3">
                      <Check className="w-3.5 h-3.5 text-ink-4" aria-hidden /> {metricLabel(k)} <span className="ml-auto text-2xs text-ink-4">toujours affichée</span>
                    </div>
                  ))}
                  {pickable.map(k => {
                    const on = validExtras.includes(k);
                    const full = !on && validExtras.length >= MAX_EXTRA_STATS;
                    return (
                      <label key={k} className={`flex items-center gap-2 h-7 px-1.5 rounded text-xs cursor-pointer hover:bg-line-strong/50 ${on ? 'text-ink' : 'text-ink-2'} ${full ? 'opacity-40 cursor-not-allowed' : ''}`}>
                        <input type="checkbox" checked={on} disabled={full} onChange={() => toggleExtraStat(k)} />
                        <span className="truncate" title={columnLabel(k)}>{columnLabel(k)}</span>
                      </label>
                    );
                  })}
                  {pickable.length === 0 && <p className="px-1.5 py-2 text-xs text-ink-4">Aucune métrique.</p>}
                </div>
                <p className="px-1 pt-2 mt-1 border-t border-line text-2xs text-ink-4">{validExtras.length}/{MAX_EXTRA_STATS} colonnes en plus de xG et xA · choix mémorisé sur cet appareil</p>
              </div>
            )}
          </div>

          <div className="ml-auto flex items-center gap-3">
            <span className="text-xs text-ink-3 whitespace-nowrap" aria-live="polite">
              <span className="text-ink font-semibold num">{filteredAndSortedData.length.toLocaleString('fr-FR')}</span>
              {filterCount > 0 && <span className="text-ink-4"> / {data.length.toLocaleString('fr-FR')}</span>} joueurs
            </span>
            <button
              onClick={() => exportToCSV(filteredAndSortedData.slice(0, 500), 'players')}
              disabled={filteredAndSortedData.length === 0}
              className="sv-btn sv-btn-secondary"
              data-tip="500 premiers résultats, tri actuel"
              data-tip-pos="bottom"
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Exporter CSV</span>
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
                  <button onClick={() => removeFilter(filter.id)} className="sv-icon-btn hover:!text-neg" data-tip="Retirer la condition" data-tip-pos="left" aria-label="Retirer la condition">
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

        {/* Filtres actifs, visibles même panneau fermé */}
        {!showAdvancedFilters && (activeFilters.length > 0 || positionFilter !== 'All') && (
          <div className="flex flex-wrap items-center gap-1.5">
            {positionFilter !== 'All' && (
              <button onClick={() => setPositionFilter('All')} className="sv-chip sv-chip-on !h-6" aria-label={`Retirer le filtre ${positionName(positionFilter)}`}>
                {positionName(positionFilter)} <X className="w-3 h-3" />
              </button>
            )}
            {activeFilters.map(f => (
              <button key={f.id} onClick={() => removeFilter(f.id)} className="sv-chip sv-chip-on !h-6" aria-label={`Retirer la condition ${metricLabel(f.key)}`}>
                {shortLabel(f.key)}
                <span className="num">
                  {f.min !== '' && f.max !== '' ? ` ${f.min} – ${f.max}` : f.min !== '' ? ` ≥ ${f.min}` : f.max !== '' ? ` ≤ ${f.max}` : ' (sans borne)'}
                </span>
                <X className="w-3 h-3" />
              </button>
            ))}
            <button onClick={() => { setActiveFilters([]); setPositionFilter('All'); }} className="sv-btn sv-btn-ghost sv-btn-sm !h-6">Tout effacer</button>
          </div>
        )}
      </div>

      {/* Tableau */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-auto" onScroll={e => { memory.scrollTop = e.currentTarget.scrollTop; }}>
        <table className="sv-table">
          <thead>
            <tr>
              <SortHeader field="Player" label="Joueur" className="!pl-4 sm:!pl-5 sticky left-0 !z-20 min-w-[11rem] sm:min-w-[13.5rem]" />
              <SortHeader field="Age" label="Âge" align="right" />
              <SortHeader field="Position" label="Poste" />
              <SortHeader field="Team" label="Club" />
              <SortHeader field="Market value" label="Valeur" align="right" title="Valeur Transfermarkt" />
              {contextColumns.includes('Contract expires') && <SortHeader field="Contract expires" label="Contrat" align="right" title="Fin de contrat" />}
              {contextColumns.includes('Minutes played') && <SortHeader field="Minutes played" label="Min" align="right" title="Minutes jouées" />}
              {statColumns.map(k => (
                <SortHeader key={k} field={k} label={shortLabel(k)} align="right" title={metricLabel(k)} tip={k === 'Rating' ? ratingTip : HEADER_TIPS[k]} />
              ))}
              <th className="w-[76px] !pr-4 sm:!pr-5"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {filteredAndSortedData.slice(0, visibleCount).map(player => {
              const season = extractSeason(player.League);
              const id = getPlayerSeasonId(player);
              const watched = watchlistIds.has(id);
              const selected = id === selectedId;
              return (
                <tr
                  key={id}
                  className={`group cursor-pointer [&:hover>td]:!bg-raised focus-visible:outline-none [&:focus-visible>td]:!bg-raised ${selected ? 'sv-row-selected' : ''}`}
                  onClick={() => onSelectPlayer(player)}
                  onKeyDown={e => { if (isRowActivation(e)) { e.preventDefault(); onSelectPlayer(player); } }}
                  tabIndex={0}
                  aria-label={`Ouvrir la fiche de ${player.Player}`}
                  aria-current={selected ? 'true' : undefined}
                >
                  <td className="!pl-4 sm:!pl-5 sticky left-0 z-[1] bg-canvas">
                    <div className="flex items-center gap-2.5 min-w-[10rem] sm:min-w-[12rem] max-w-[11rem] sm:max-w-[17rem]">
                      <PlayerAvatar player={player} size="sm" />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="text-[13px] font-medium text-ink truncate group-hover:text-accent transition-colors">{player.Player}</span>
                          {multiSeason && <span className="sv-tag !h-4 !px-1 !text-[9px] !font-medium shrink-0">{getPlayerSeasonTag(player)}</span>}
                        </div>
                        {player['Passport country'] && (
                          <div className="flex items-center gap-1 text-2xs text-ink-4">
                            <CountryFlag code={String(player['Passport country'])} className="w-3 h-2" />
                            {player['Passport country']}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className={`text-right text-ink-2 ${sortedCell('Age')}`}>{typeof player.Age === 'number' ? player.Age : <span className="text-ink-4">–</span>}</td>
                  <td className={sortedCell('Position')}><span className="sv-tag" title={positionName(player.Position)}>{positionLabel(player.Position)}</span></td>
                  <td className={`text-ink-2 ${sortedCell('Team')}`}><TeamLine player={player} className="max-w-[14rem]" /></td>
                  <td className={`text-right whitespace-nowrap ${typeof player['Market value'] === 'number' ? 'text-ink font-medium' : 'text-ink-4'} ${sortedCell('Market value')}`}>
                    {formatValue(Number(player['Market value']) || 0)}
                  </td>
                  {contextColumns.includes('Contract expires') && (
                    <td className={`text-right text-ink-3 text-xs whitespace-nowrap ${sortedCell('Contract expires')}`}>
                      {player['Contract expires'] ? String(player['Contract expires']).slice(0, 7).split('-').reverse().join('/') : <span className="text-ink-4">–</span>}
                    </td>
                  )}
                  {contextColumns.includes('Minutes played') && (
                    <td className={`text-right text-ink-3 whitespace-nowrap ${sortedCell('Minutes played')}`}>
                      {typeof player['Minutes played'] === 'number' ? player['Minutes played'].toLocaleString('fr-FR') : <span className="text-ink-4">–</span>}
                    </td>
                  )}
                  {statColumns.map(k => (
                    <td key={k} className={`text-right whitespace-nowrap ${k === 'xG' || k === 'xA' ? 'text-ink' : 'text-ink-2'} ${sortedCell(k)}`}>
                      {k === 'Rating' && typeof player.Rating === 'number' ? (
                        <span className="inline-flex items-center justify-end gap-2">
                          {formatFr(player.Rating, 2)}
                          {typeof player['Rating pct'] === 'number' && (
                            <PercentileValue value={player['Rating pct'] as number} className="text-2xs w-9 justify-end"
                              tip={`P${Math.round(player['Rating pct'] as number)} · ${PERCENTILE_TIP}`} />
                          )}
                        </span>
                      ) : formatStat(k, player[k])}
                    </td>
                  ))}
                  <td className="!pr-4 sm:!pr-5">
                    <div className="flex justify-end gap-0.5">
                      <button
                        onClick={(e) => toggleWatchlist(player, e)}
                        className={`sv-icon-btn ${watched ? '!text-accent' : 'opacity-50 group-hover:opacity-100 focus-visible:opacity-100'}`}
                        data-tip={watched ? 'Retirer de la liste de suivi' : 'Ajouter à la liste de suivi'}
                        data-tip-pos="left"
                        aria-label={watched ? 'Retirer de la liste de suivi' : 'Ajouter à la liste de suivi'}
                        aria-pressed={watched}
                      >
                        <Star className={`w-3.5 h-3.5 ${watched ? 'fill-accent' : ''}`} />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); onSelectPlayer(player); }}
                        className="sv-icon-btn opacity-50 group-hover:opacity-100 focus-visible:opacity-100"
                        data-tip="Voir la fiche"
                        data-tip-pos="left"
                        aria-label={`Voir la fiche de ${player.Player}`}
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
          <EmptyState icon={Search} title="Aucun joueur ne correspond à ces critères.">
            {filterCount > 0 && 'Élargissez la recherche ou retirez un filtre.'}
          </EmptyState>
        )}
        {visibleCount < filteredAndSortedData.length && (
          <div ref={loadMoreRef} className="p-3 text-center text-2xs text-ink-4">
            {visibleCount.toLocaleString('fr-FR')} sur {filteredAndSortedData.length.toLocaleString('fr-FR')} joueurs affichés…
          </div>
        )}
      </div>
    </div>
  );
};

export default PlayerList;
