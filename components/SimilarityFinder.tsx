import React, { useState, useMemo, useCallback } from 'react';
import { PlayerData, extractSeason, getPlayerSeasonId, getSeasonShortLabel } from '../types';
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
import { PlayerAvatar, TeamLine } from './Media';
import { EmptyState, LegendItem, PageHeader, Panel, PolarTick } from './ui';
import { BRAND, SERIES, polarGridProps } from '../theme/charts';

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
    <div className="p-5 space-y-4 animate-fade-in">
      <PageHeader
        title="Joueurs similaires"
        icon={GitCompare}
        description="Profils statistiques les plus proches d'un joueur de référence (distance euclidienne sur les métriques de performance du poste)."
      />

      <div className="relative z-40 w-full max-w-xl">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-4" />
        <input
          type="text"
          placeholder="Rechercher un joueur de référence"
          className="sv-input pl-8"
          aria-label="Joueur de référence"
          value={searchTerm}
          onChange={(e) => {
            setSearchTerm(e.target.value);
            if (!e.target.value) setReferencePlayer(null);
          }}
          onFocus={() => {
            if (referencePlayer) {
              setSearchTerm('');
              setReferencePlayer(null);
            }
          }}
        />
        {searchTerm && !referencePlayer && (
          <div className="sv-menu absolute top-full left-0 right-0 mt-1 max-h-80 overflow-y-auto">
            {filteredSearch.map(p => (
              <button key={getPlayerSeasonId(p)} onClick={() => { setReferencePlayer(p); setSearchTerm(p.Player || ''); }}
                className="sv-menu-item flex items-center gap-2.5">
                <PlayerAvatar player={p} size="xs" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] text-ink truncate">{p.Player || 'Inconnu'}</span>
                  <span className="block text-2xs text-ink-3 truncate"><TeamLine player={p} /></span>
                </span>
                <span className="sv-tag">{positionLabel(p.Position) || 'N/D'}</span>
                <span className="sv-tag !font-normal">{getSeasonShortLabel(extractSeason(p.League))}</span>
              </button>
            ))}
            {filteredSearch.length === 0 && <div className="px-3 py-2 text-xs text-ink-4">Aucun joueur trouvé</div>}
          </div>
        )}
      </div>

      {!referencePlayer ? (
        <div className="sv-panel">
          <EmptyState icon={GitCompare} title="Choisissez un joueur de référence">
            Les joueurs les plus proches sont classés par similarité ; le radar superpose la référence (cyan) et chaque joueur.
          </EmptyState>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[17rem_1fr] gap-4 items-start">
          <div className="space-y-4">
            <Panel title="Référence">
              <div className="flex items-center gap-3">
                <PlayerAvatar player={referencePlayer} size="lg" />
                <div className="min-w-0">
                  <div className="text-[15px] font-semibold text-ink leading-tight">{referencePlayer.Player || 'Inconnu'}</div>
                  <div className="text-2xs text-ink-3 mt-0.5"><TeamLine player={referencePlayer} /></div>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 mt-3">
                <span className="sv-tag">{positionLabel(referencePlayer.Position)}</span>
                <span className="sv-tag !font-normal">{referencePlayer.Age ?? '–'} ans</span>
                <span className="sv-tag !font-normal">{getSeasonShortLabel(extractSeason(referencePlayer.League))}</span>
                <span className="sv-tag !font-normal">{typeof referencePlayer['Market value'] === 'number' ? `€${(referencePlayer['Market value'] / 1e6).toFixed(1)}M` : '–'}</span>
              </div>
            </Panel>

            <Panel title="Paramètres">
              <div className="space-y-2 text-xs">
                <div className="flex items-center justify-between"><span className="text-ink-3">Type de poste</span><span className="text-ink">{positionCategory}</span></div>
                <div className="flex items-center justify-between"><span className="text-ink-3">Métriques comparées</span><span className="text-ink num">{metricKeys.length}</span></div>
                <label className="flex items-center gap-2 pt-2 border-t border-line cursor-pointer text-ink-2">
                  <input type="checkbox" checked={samePositionOnly} onChange={() => setSamePositionOnly(!samePositionOnly)} />
                  Même poste uniquement
                </label>
                <label className="flex items-center gap-2 cursor-pointer text-ink-2">
                  <input type="checkbox" checked={useTopMetrics} onChange={() => setUseTopMetrics(!useTopMetrics)} />
                  Utiliser ses meilleures métriques
                </label>
              </div>
              {metricKeys.length > 0 && (
                <div className="mt-3 pt-3 border-t border-line">
                  <div className="sv-label mb-1.5">Métriques de comparaison</div>
                  <div className="flex flex-wrap gap-1">
                    {metricKeys.map(m => (
                      <span key={m} className="sv-tag !font-normal max-w-[15rem] truncate" title={metricLabel(m)}>{metricLabel(m).replace(' par 90', '/90')}</span>
                    ))}
                  </div>
                </div>
              )}
            </Panel>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="sv-label">Profils les plus proches</span>
              <div className="flex gap-3">
                <LegendItem color={BRAND} shape="line">Référence</LegendItem>
                <LegendItem color={SERIES[1]} shape="line">Joueur comparé</LegendItem>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-3">
              {similarPlayers.map(({ player, score }, idx) => (
                <div key={getPlayerSeasonId(player)} className="sv-panel flex flex-col overflow-hidden">
                  <div className="px-3 pt-3 flex justify-between items-start gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="text-2xs text-ink-4 num w-4">{idx + 1}</span>
                      <PlayerAvatar player={player} size="sm" />
                      <div className="min-w-0">
                        <div className="text-[13px] font-medium text-ink truncate">{player.Player || 'Inconnu'}<span className="sv-tag !h-4 !px-1 !text-[9px] ml-1.5 align-middle !font-medium">{getSeasonShortLabel(extractSeason(player.League))}</span></div>
                        <div className="text-2xs text-ink-3 truncate max-w-[12rem]"><TeamLine player={player} /></div>
                      </div>
                    </div>
                    <div className="text-right shrink-0" title="Similarité avec la référence">
                      <div className="text-base font-semibold text-ink num leading-none">{score.toFixed(0)} %</div>
                      <div className="sv-label mt-1">Similarité</div>
                    </div>
                  </div>
                  <div className="h-44 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <RadarChart cx="50%" cy="50%" outerRadius="62%" data={getChartData(player)}>
                        <PolarGrid {...polarGridProps} />
                        <PolarAngleAxis dataKey="subject" tick={<PolarTick maxChars={12} />} />
                        <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
                        <Radar name="Référence" dataKey="Reference" stroke={BRAND} strokeWidth={1.5} fill={BRAND} fillOpacity={0.08} isAnimationActive={false} />
                        <Radar name="Joueur" dataKey="Target" stroke={SERIES[1]} strokeWidth={1.5} fill={SERIES[1]} fillOpacity={0.12} isAnimationActive={false} />
                      </RadarChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="px-3 py-2 mt-auto border-t border-line flex items-center justify-between text-xs">
                    <span className="text-ink-3 num">
                      {positionLabel(player.Position)} · {player.Age ?? '–'} ans · {typeof player['Market value'] === 'number' ? `€${(player['Market value'] / 1e6).toFixed(1)}M` : '–'}
                    </span>
                    <button onClick={() => onSelectPlayer(player)} className="sv-btn sv-btn-ghost sv-btn-sm !text-accent">Fiche</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SimilarityFinder;
