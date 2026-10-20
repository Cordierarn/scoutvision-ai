
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { PlayerData, extractSeason, getSeasonColor, getPlayerSeason, getSeasonShortLabel } from '../types';
import { useShots } from '../hooks/useShots';
import PlayerHeatmap from './PlayerHeatmap';
import { metricLabel, positionName, roleLabel, styleLabel, footLabel, shotResultLabel, shotTypeLabel } from '../utils/labels';
import { ImpactPanel, DevelopmentPanel, buildReportInsights } from './PlayerInsights';
import { dataLoader } from '../services/dataLoader';
import { ArrowLeft, Sparkles, Trophy, Target, Activity, MapPin, Footprints, Ruler, FileText, Download, Share2, Settings2, X, Check, Search, Plus, Award, ChevronRight, Crosshair, TrendingUp, TrendingDown, Minus, BarChart3 } from 'lucide-react';
import { ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, Tooltip, Legend } from 'recharts';
import { generateScoutReport } from '../services/geminiService';
import { getBestRoles } from '../utils/scoringUtils';
import { getRadarMetricsForPosition, filterAvailableMetrics, getPositionCategory, getPositionCategoryLabel, getMetricKeys, isMetricKey } from '../utils/positionMetrics';
import ReactMarkdown from 'react-markdown';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { getFlagUrl } from '../utils/flags';
import { PhotoOverlay, TeamLine, TeamLogo, CompetitionBadge, CountryFlag } from './Media';

interface PlayerCardProps {
  player: PlayerData;
  onBack: () => void;
  allPlayers: PlayerData[];
}

/**
 * Même joueur (identifiant PitchAPI, repli sur le nom)
 */
const isSamePlayer = (a: PlayerData, b: PlayerData): boolean =>
  a['Player ID'] && b['Player ID'] ? a['Player ID'] === b['Player ID'] : a.Player === b.Player;

type ComparisonMode = 'all' | 'position' | 'league' | 'position_league';

// Les métriques par défaut seront maintenant calculées dynamiquement selon la position

// Labels for comparison modes
const COMPARISON_LABELS: Record<ComparisonMode, string> = {
  all: 'vs tous les joueurs',
  position: 'vs même poste',
  league: 'vs même compétition',
  position_league: 'vs même poste et compétition'
};

const COMPARISON_SHORT_LABELS: Record<ComparisonMode, string> = {
  all: 'Tous',
  position: 'Poste',
  league: 'Compét.',
  position_league: 'Poste+compét.'
};

const PlayerCard: React.FC<PlayerCardProps> = ({ player, onBack, allPlayers }) => {
  const [report, setReport] = useState<string | null>(null);
  const [loadingReport, setLoadingReport] = useState(false);
  const [comparisonMode, setComparisonMode] = useState<ComparisonMode>('position');
  const [isExporting, setIsExporting] = useState(false);
  
  // Get position-based default metrics
  const defaultMetrics = useMemo(() => {
    const positionMetrics = getRadarMetricsForPosition(player.Position);
    return filterAvailableMetrics(positionMetrics, player);
  }, [player]);
  
  // Custom Metric Config State
  const [activeMetrics, setActiveMetrics] = useState<string[]>([]);
  const [showMetricConfig, setShowMetricConfig] = useState(false);
  const [metricSearch, setMetricSearch] = useState('');
  
  // Initialize metrics when player changes
  useEffect(() => {
    const positionMetrics = getRadarMetricsForPosition(player.Position);
    const available = filterAvailableMetrics(positionMetrics, player);
    setActiveMetrics(available.length > 0 ? available : ['xG', 'xA', 'Goals', 'Assists']);
  }, [player]);
  
  const printRef = useRef<HTMLDivElement>(null);

  // Position category for display
  const positionCategory = useMemo(() => {
    const cat = getPositionCategory(player.Position);
    return getPositionCategoryLabel(cat);
  }, [player]);

  // US-05: Find same player in other seasons for evolution tracking
  // La saison précédente est chargée à la demande (une seule saison est en mémoire)
  const [previousSeasonRows, setPreviousSeasonRows] = useState<PlayerData[]>([]);
  useEffect(() => {
    const seasons = dataLoader.getCachedIndex()?.seasons.map(s => s.id) ?? [];
    const previous = seasons[seasons.indexOf(getPlayerSeason(player)) - 1];
    setPreviousSeasonRows([]);
    if (!previous) return;

    let cancelled = false;
    dataLoader.loadSeason(previous)
      .then(data => {
        if (!cancelled) setPreviousSeasonRows(data.players.filter(p => isSamePlayer(p, player)));
      })
      .catch(err => console.warn('Saison précédente indisponible :', err));
    return () => { cancelled = true; };
  }, [player]);

  const playerSeasons = useMemo(() => {
    const currentSeason = getPlayerSeason(player);
    
    // Other seasons of the same player, one row per season (the one with most minutes)
    const bySeason = new Map<string, PlayerData>();
    [...allPlayers.filter(p => isSamePlayer(p, player)), ...previousSeasonRows].forEach(p => {
      const season = getPlayerSeason(p);
      if (season === currentSeason) return;
      const kept = bySeason.get(season);
      if (!kept || (Number(p["Minutes played"]) || 0) > (Number(kept["Minutes played"]) || 0)) {
        bySeason.set(season, p);
      }
    });
    
    // Return sorted by season (most recent first)
    return [player, ...bySeason.values()].sort((a, b) =>
      getPlayerSeason(b).localeCompare(getPlayerSeason(a))
    );
  }, [player, allPlayers, previousSeasonRows]);

  // Calculate evolution data if we have multiple seasons
  const evolutionData = useMemo(() => {
    if (playerSeasons.length < 2) return null;
    
    const currentSeason = playerSeasons[0];
    const previousSeason = playerSeasons[1];
    
    const metrics = activeMetrics.slice(0, 8); // Take first 8 for comparison
    
    return metrics.map(key => {
      const currentVal = Number(currentSeason[key]) || 0;
      const previousVal = Number(previousSeason[key]) || 0;
      const diff = currentVal - previousVal;
      const percentChange = previousVal !== 0 ? ((diff / previousVal) * 100) : (currentVal > 0 ? 100 : 0);
      
      return {
        metric: key,
        shortMetric: metricLabel(key),
        current: currentVal,
        previous: previousVal,
        diff,
        percentChange: Math.round(percentChange),
        trend: diff > 0.01 ? 'up' : diff < -0.01 ? 'down' : 'stable'
      };
    });
  }, [playerSeasons, activeMetrics]);

  // Available Numeric Keys
  const availableMetrics = useMemo(() => {
    if (!player) return [];
    return getMetricKeys([player]);
  }, [player]);

  // Calculate Best Roles (US-09)
  // Métriques clés du rôle pour la projection à un an
  const developmentMetrics = useMemo(() =>
    [...getRadarMetricsForPosition(player.Position), 'Rating'], [player.Position]);

  const bestRoles = useMemo(() => {
    return getBestRoles(player, allPlayers);
  }, [player, allPlayers]);

  // Shot Map Data
  const { shots: competitionShots } = useShots(getPlayerSeason(player), player.Competition);
  const playerShots = useMemo(() => {
    return competitionShots.filter(s => player['Player ID']
      ? s.player_id === player['Player ID']
      : s.player === player.Player);
  }, [competitionShots, player]);

  const shotStats = useMemo(() => {
    const total = playerShots.length;
    const goals = playerShots.filter(s => s.result === 'Goal').length;
    const xG = playerShots.reduce((acc, curr) => acc + curr.xG, 0);
    return { total, goals, xG };
  }, [playerShots]);

  const toggleMetric = (key: string) => {
    if (activeMetrics.includes(key)) {
        setActiveMetrics(activeMetrics.filter(m => m !== key));
    } else {
        if (activeMetrics.length < 12) {
            setActiveMetrics([...activeMetrics, key]);
        }
    }
  };

  // Filter cohort based on selected mode
  const cohort = useMemo(() => {
    return allPlayers.filter(p => {
      if (comparisonMode === 'position') return p.Position === player.Position;
      if (comparisonMode === 'league') return p.League === player.League;
      if (comparisonMode === 'position_league') return p.Position === player.Position && p.League === player.League;
      return true; // 'all'
    });
  }, [allPlayers, player, comparisonMode]);

  // Cohort description for display
  const cohortDescription = useMemo(() => {
    const count = cohort.length;
    switch (comparisonMode) {
      case 'position':
        return `${count} ${positionName(player.Position).toLowerCase()}s, toutes compétitions`;
      case 'league':
        const leagueName = player.League?.split(' ').slice(0, -1).join(' ') || 'la compétition';
        return `${count} joueurs en ${leagueName}`;
      case 'position_league':
        const league = player.League?.split(' ').slice(0, -1).join(' ') || 'la compétition';
        return `${count} ${positionName(player.Position).toLowerCase()}s en ${league}`;
      default:
        return `${count} joueurs au total`;
    }
  }, [cohort, comparisonMode, player]);

  const chartData = useMemo(() => {
    return activeMetrics.map(key => {
      const val = Number(player[key]) || 0;
      
      // Calculate Percentile Rank within Cohort
      const values = cohort.map(p => Number(p[key]) || 0).sort((a, b) => a - b);
      const countBelow = values.filter(v => v < val).length;
      const countEqual = values.filter(v => v === val).length;
      
      // Rank calculation: (Below + 0.5 * Equal) / Total * 100
      let percentile = 50;
      if (values.length > 1) {
          percentile = Math.round(((countBelow + (0.5 * countEqual)) / values.length) * 100);
      } else if (values.length === 1) {
          percentile = 100;
      }

      // Calculate actual rank position
      const rank = values.length - countBelow;

      // Dynamic label creation
      const label = metricLabel(key);

      return {
        subject: label,
        fullSubject: key,
        A: percentile,
        fullMark: 100,
        rawValue: val,
        cohortSize: values.length,
        rank: rank,
        topPercent: Math.max(1, Math.round((rank / values.length) * 100))
      };
    });
  }, [player, cohort, activeMetrics]);

  // Calculate average percentile for summary
  const averagePercentile = useMemo(() => {
    if (chartData.length === 0) return 0;
    return Math.round(chartData.reduce((sum, d) => sum + d.A, 0) / chartData.length);
  }, [chartData]);

  // Get top 3 metrics where player excels
  const topMetrics = useMemo(() => {
    return [...chartData]
      .sort((a, b) => b.A - a.A)
      .slice(0, 3)
      .filter(m => m.A >= 70);
  }, [chartData]);

  const handleGenerateReport = async () => {
    setLoadingReport(true);
    const curves = await dataLoader.loadAgeCurves().catch(() => null);
    const percentiles = Object.fromEntries(
      Object.entries(player)
        .filter(([key, value]) => key.endsWith(' pct') && typeof value === 'number')
        .map(([key, value]) => [key.slice(0, -4), value as number]));
    const text = await generateScoutReport(player, {
      language: 'fr',
      percentileProfile: { player, percentiles, zScores: {}, averages: {} },
      bestRoles,
      shotStats: {
        ...shotStats, xGDiff: shotStats.goals - shotStats.xG,
        onTarget: playerShots.filter(s => s.result === 'Goal' || s.result === 'SavedShot').length,
        blocked: playerShots.filter(s => s.result === 'BlockedShot').length,
        conversion: shotStats.total > 0 ? (shotStats.goals / shotStats.total) * 100 : 0,
        avgXG: shotStats.total > 0 ? shotStats.xG / shotStats.total : 0,
      },
      insights: buildReportInsights(player, curves, developmentMetrics),
    });
    setReport(text);
    setLoadingReport(false);
  };

  const handleExportPDF = async () => {
    if (!printRef.current) return;
    setIsExporting(true);

    try {
      const element = printRef.current;
      const canvas = await html2canvas(element, {
        scale: 2, // Higher resolution
        useCORS: true,
        backgroundColor: '#0f172a', // Match theme background
        logging: false,
      });

      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4',
      });

      const imgWidth = 210; // A4 width in mm
      const pageHeight = 297; // A4 height in mm
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      let heightLeft = imgHeight;
      let position = 0;

      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;

      // Handle multi-page content if the report is long
      while (heightLeft >= 0) {
        position = heightLeft - imgHeight;
        pdf.addPage();
        pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;
      }

      pdf.save(`${player.Player}_ScoutReport.pdf`);
    } catch (error) {
      console.error('Échec de l\'export PDF :', error);
      alert('Échec de l\'export PDF');
    } finally {
      setIsExporting(false);
    }
  };

  const formatCurrency = (val: number) => {
      if (val >= 1000000) return `€${(val / 1000000).toFixed(1)}M`;
      if (val >= 1000) return `€${(val / 1000).toFixed(0)}K`;
      return `€${val}`;
  };

  const getRoleColor = (score: number) => {
      if (score >= 90) return 'bg-emerald-500';
      if (score >= 80) return 'bg-emerald-400';
      if (score >= 70) return 'bg-yellow-400';
      return 'bg-slate-500';
  };

  return (
    <div className="flex flex-col gap-6 animate-fade-in pb-10">
      <div className="flex items-center justify-between">
        <button 
            onClick={onBack}
            className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors"
        >
            <ArrowLeft className="w-4 h-4" /> Retour à la liste
        </button>

        <button
            onClick={handleExportPDF}
            disabled={isExporting}
            className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-white px-4 py-2 rounded-lg transition-all border border-slate-700 hover:border-emerald-500 shadow-lg"
        >
            {isExporting ? (
                <span className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin"></span>
            ) : (
                <Download className="w-4 h-4 text-emerald-400" />
            )}
            <span>{isExporting ? 'Export en cours...' : 'Exporter en PDF'}</span>
        </button>
      </div>

      {/* Printable Area Wrapper */}
      <div ref={printRef} className="flex flex-col gap-6 bg-slate-900 p-4 -m-4 rounded-3xl"> 

      {/* Header Card */}
      <div className="bg-gradient-to-r from-slate-950 to-slate-900 rounded-3xl p-6 lg:p-10 border border-slate-800 relative overflow-hidden shadow-2xl">
         {/* Background Decoration */}
         <div className="absolute top-0 right-0 w-96 h-96 bg-emerald-500/5 rounded-full blur-3xl -mr-20 -mt-20 pointer-events-none"></div>
         
         <div className="flex flex-col md:flex-row gap-8 items-start relative z-10">
            {(() => {
              const playerSeason = extractSeason(player.League);
              const seasonColors = getSeasonColor(playerSeason);
              return (
                <div className="relative">
                  <div className="relative overflow-hidden w-32 h-32 lg:w-40 lg:h-40 bg-slate-800 rounded-2xl flex items-center justify-center shadow-2xl border-2 border-emerald-500/30 text-slate-300">
                     <span className="text-4xl font-bold">{(player.Player || '??').substring(0, 2).toUpperCase()}</span>
                     <PhotoOverlay src={player.Image} alt={player.Player} />
                  </div>
                  <div className={`absolute -bottom-2 -right-2 px-3 py-1 rounded-lg text-sm font-bold ${seasonColors.bg} ${seasonColors.text} border ${seasonColors.border} shadow-lg`}>
                    {getSeasonShortLabel(playerSeason)}
                  </div>
                </div>
              );
            })()}
            
            <div className="flex-1 w-full">
               <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
                  <div>
                    <h1 className="text-4xl lg:text-5xl font-bold text-white tracking-tight mb-2">{player.Player}</h1>
                    <div className="flex items-center gap-4 text-slate-300">
                        <span className="flex items-center gap-2 bg-slate-800/50 px-3 py-1 rounded-full border border-slate-700"><TeamLogo src={player['Team logo']} name={player.Team} size="xs" /> {player.Team}</span>
                        <span className="flex items-center gap-1 bg-slate-800/50 px-3 py-1 rounded-full border border-slate-700 text-sm"><CompetitionBadge competition={player.Competition} /></span>
                        <span className="flex items-center gap-1 bg-slate-800/50 px-3 py-1 rounded-full border border-slate-700">{getFlagUrl(player["Passport country"]) ? <CountryFlag code={player["Passport country"]} /> : <MapPin className="w-3.5 h-3.5 text-emerald-400"/>} {player["Passport country"] || 'Inconnue'}</span>
                        {player["Team style"] && (
                          <span className="flex items-center gap-1 bg-slate-800/50 px-3 py-1 rounded-full border border-slate-700 text-sm" title="Style de jeu de l'équipe cette saison (ACP + k-means sur les indicateurs d'équipe)">
                            {styleLabel(player["Team style"])}
                          </span>
                        )}
                    </div>
                    {/* Profil Transfermarkt : taille, pied, fin de contrat */}
                    {(player.Height || player.Foot || player["Contract expires"]) && (
                      <div className="flex items-center gap-3 mt-3 text-sm text-slate-400">
                        {typeof player.Height === 'number' && (
                          <span className="flex items-center gap-1"><Ruler className="w-3.5 h-3.5 text-slate-500" /> {player.Height} cm</span>
                        )}
                        {player.Foot && (
                          <span className="flex items-center gap-1"><Footprints className="w-3.5 h-3.5 text-slate-500" /> pied {footLabel(player.Foot)}</span>
                        )}
                        {player["Contract expires"] && (
                          <span className="flex items-center gap-1"><FileText className="w-3.5 h-3.5 text-slate-500" /> Contrat jusqu'au {player["Contract expires"]}</span>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="text-right p-4 bg-emerald-500/10 rounded-2xl border border-emerald-500/20 backdrop-blur-sm">
                     <div className="text-xs text-emerald-300 uppercase tracking-wider font-bold mb-1">Valeur marchande</div>
                     <div className="text-3xl font-mono text-white font-bold tracking-tighter">
                        {typeof player["Market value"] === 'number' ? formatCurrency(player["Market value"]) : 'N/A'}
                     </div>
                     <div className="text-[10px] text-slate-500 mt-1">
                        {typeof player["Market value"] === 'number' ? 'Transfermarkt, actuelle' : 'Saison en cours seulement'}
                     </div>
                  </div>
               </div>

               <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-8">
                  <div className="bg-slate-900 p-4 rounded-xl border border-slate-800">
                     <div className="text-xs text-slate-500 mb-1 flex items-center gap-1 uppercase font-semibold"><Ruler className="w-3 h-3"/> Minutes</div>
                     <div className="text-lg font-bold text-slate-200">{player["Minutes played"]} <span className="text-xs text-slate-500 font-normal">{typeof player["Minutes share"] === 'number' ? `${Math.round(player["Minutes share"] * 100)}% de l'équipe` : ''}</span></div>
                  </div>
                   <div className="bg-slate-900 p-4 rounded-xl border border-slate-800">
                     <div className="text-xs text-slate-500 mb-1 flex items-center gap-1 uppercase font-semibold"><Activity className="w-3 h-3"/> Matchs</div>
                     <div className="text-lg font-bold text-slate-200">{player["Matches played"]} <span className="text-xs text-slate-500 font-normal">{player.Starts ?? 0} titularisations</span></div>
                  </div>
                   <div className="bg-slate-900 p-4 rounded-xl border border-slate-800">
                     <div className="text-xs text-slate-500 mb-1 flex items-center gap-1 uppercase font-semibold"><Footprints className="w-3 h-3"/> Note</div>
                     <div className="text-lg font-bold text-slate-200">{typeof player.Rating === 'number' ? player.Rating.toFixed(2) : 'N/A'} <span className="text-xs text-slate-500 font-normal">{typeof player["Rating pct"] === 'number' ? `P${player["Rating pct"]}` : ''}</span></div>
                  </div>
                  <div className="bg-slate-900 p-4 rounded-xl border border-slate-800">
                     <div className="text-xs text-slate-500 mb-1 flex items-center gap-1 uppercase font-semibold"><Target className="w-3 h-3"/> Âge</div>
                     <div className="text-lg font-bold text-slate-200">{player.Age ?? 'N/A'} <span className="text-xs text-slate-500 font-normal">{player.Age !== undefined ? 'ans' : ''}</span></div>
                  </div>
               </div>
            </div>
         </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Column: Charts */}
        <div className="lg:col-span-1 flex flex-col gap-6">
            
            {/* Radar Chart */}
            <div className="bg-slate-950 border border-slate-800 rounded-3xl p-6 shadow-xl flex flex-col relative overflow-hidden group">
                <div className="flex items-center justify-between mb-2 relative z-10">
                    <h3 className="text-lg font-bold text-white flex items-center gap-2">
                        <Activity className="w-5 h-5 text-emerald-500" /> Profil de performance
                    </h3>
                    <div className="flex items-center gap-2">
                        <button 
                            onClick={() => setShowMetricConfig(!showMetricConfig)}
                            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors border border-transparent hover:border-slate-700"
                            title="Choisir les métriques"
                        >
                            <Settings2 className="w-4 h-4" />
                        </button>
                        <div className="text-xs font-medium px-2 py-1 rounded bg-slate-900 text-slate-400 border border-slate-800">
                            {COMPARISON_LABELS[comparisonMode]}
                        </div>
                    </div>
                </div>

                {/* Metric Configuration Overlay */}
                {showMetricConfig && (
                    <div className="absolute inset-0 z-50 bg-slate-950/95 backdrop-blur-sm p-4 flex flex-col animate-fade-in">
                        <div className="flex items-center justify-between mb-4 border-b border-slate-800 pb-2">
                            <h4 className="text-sm font-bold text-white">Choisir les métriques</h4>
                            <button onClick={() => setShowMetricConfig(false)} className="text-slate-400 hover:text-white">
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        
                        <div className="relative mb-3">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                            <input 
                                type="text" 
                                placeholder="Rechercher..." 
                                className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-9 pr-3 py-2 text-xs text-white"
                                value={metricSearch}
                                onChange={(e) => setMetricSearch(e.target.value)}
                            />
                        </div>

                        <div className="flex-1 overflow-y-auto custom-scrollbar space-y-1">
                            {availableMetrics
                                .filter(k => k.toLowerCase().includes(metricSearch.toLowerCase()))
                                .map(key => (
                                    <button
                                        key={key}
                                        onClick={() => toggleMetric(key)}
                                        className={`w-full text-left px-3 py-2 rounded-lg text-xs flex items-center justify-between ${
                                            activeMetrics.includes(key) 
                                            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30' 
                                            : 'hover:bg-slate-900 text-slate-400'
                                        }`}
                                    >
                                        <span className="truncate pr-2">{metricLabel(key)}</span>
                                        {activeMetrics.includes(key) && <Check className="w-3 h-3 shrink-0" />}
                                    </button>
                                ))
                            }
                        </div>
                        
                        <div className="mt-4 pt-2 border-t border-slate-800 text-center">
                            <span className="text-[10px] text-slate-500">{activeMetrics.length} / 12 métriques choisies</span>
                        </div>
                    </div>
                )}

                {/* Comparison Controls */}
                <div className="bg-slate-900 rounded-lg p-1 flex items-center justify-between border border-slate-800 mb-4 relative z-10">
                    {(['all', 'position', 'league', 'position_league'] as ComparisonMode[]).map(mode => (
                        <button
                            key={mode}
                            onClick={() => setComparisonMode(mode)}
                            className={`flex-1 py-1.5 text-[9px] uppercase font-bold tracking-wider rounded-md transition-all ${
                                comparisonMode === mode 
                                ? 'bg-emerald-500 text-slate-950 shadow-sm' 
                                : 'text-slate-500 hover:text-slate-300'
                            }`}
                        >
                            {COMPARISON_SHORT_LABELS[mode]}
                        </button>
                    ))}
                </div>
                
                {/* Cohort Info & Average Percentile */}
                <div className="flex items-center justify-between mb-4 px-1">
                  <div className="text-[10px] text-slate-500">
                    <span className="text-slate-400 font-medium">{cohort.length}</span> {cohortDescription.split(' ').slice(1).join(' ')}
                  </div>
                  <div className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs font-bold ${
                    averagePercentile >= 80 ? 'bg-emerald-500/20 text-emerald-400' :
                    averagePercentile >= 60 ? 'bg-blue-500/20 text-blue-400' :
                    averagePercentile >= 40 ? 'bg-yellow-500/20 text-yellow-400' :
                    'bg-slate-500/20 text-slate-400'
                  }`}>
                    <BarChart3 className="w-3 h-3" />
                    Top {Math.max(1, 100 - averagePercentile)}%
                  </div>
                </div>
                
                {/* Top Metrics Badges */}
                {topMetrics.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-4">
                    {topMetrics.map(m => (
                      <div key={m.fullSubject} className="flex items-center gap-1 px-2 py-1 bg-emerald-500/10 rounded-full text-[10px] text-emerald-400 border border-emerald-500/20">
                        <TrendingUp className="w-3 h-3" />
                        Top {m.topPercent}% {m.subject}
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex-1 min-h-[350px] w-full relative -ml-2">
                    <ResponsiveContainer width="100%" height="100%">
                        <RadarChart cx="50%" cy="50%" outerRadius="75%" data={chartData} margin={{ top: 30, right: 30, bottom: 30, left: 30 }}>
                            <defs>
                                <linearGradient id="radarFill" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.5}/>
                                    <stop offset="95%" stopColor="#10b981" stopOpacity={0.1}/>
                                </linearGradient>
                            </defs>
                            
                            {/* Styled Polar Grid */}
                            <PolarGrid 
                                gridType="polygon" 
                                stroke="#334155" 
                                strokeWidth={1} 
                                strokeDasharray="4 4" 
                            />
                            
                            {/* Enhanced Labels */}
                            <PolarAngleAxis 
                                dataKey="subject" 
                                tick={{ fill: '#f8fafc', fontSize: 11, fontWeight: 600, dy: 3 }} 
                            />
                            
                            {/* Clean Radius Axis */}
                            <PolarRadiusAxis 
                                angle={90} 
                                domain={[0, 100]} 
                                tickCount={6} 
                                tick={false} 
                                axisLine={false} 
                            />

                            {/* The Radar Shape */}
                            <Radar
                                name={player.Player}
                                dataKey="A"
                                stroke="#10b981"
                                strokeWidth={3}
                                fill="url(#radarFill)"
                                fillOpacity={1}
                                activeDot={{ r: 6, strokeWidth: 0, fill: '#fff' }}
                            />
                            
                            <Tooltip 
                                contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '0.5rem', color: '#f8fafc', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.5)' }}
                                itemStyle={{ color: '#10b981', fontWeight: 'bold' }}
                                labelStyle={{ color: '#94a3b8', marginBottom: '0.25rem', fontSize: '12px', textTransform: 'uppercase' }}
                                formatter={(value: number, name: string, props: any) => [`${value} (valeur : ${props.payload.rawValue})`, 'Percentile']}
                            />
                        </RadarChart>
                    </ResponsiveContainer>
                </div>
                
                <div className="mt-2 text-center">
                    <p className="text-[10px] text-slate-500 uppercase tracking-widest">Groupe de comparaison : {cohort.length} joueurs</p>
                </div>
            </div>

            {/* US-05: Season Evolution Comparison */}
            {evolutionData && playerSeasons.length >= 2 && (
              <div className="bg-slate-950 border border-slate-800 rounded-3xl p-6 shadow-xl">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-bold text-white flex items-center gap-2">
                    <TrendingUp className="w-5 h-5 text-blue-400" /> Évolution sur la saison
                  </h3>
                  <div className="flex items-center gap-2">
                    {playerSeasons.slice(0, 2).map((ps, idx) => {
                      const season = extractSeason(ps.League);
                      const colors = getSeasonColor(season);
                      return (
                        <span key={season} className={`px-2 py-1 rounded text-[10px] font-bold ${colors.bg} ${colors.text} border ${colors.border}`}>
                          {getSeasonShortLabel(season)}
                        </span>
                      );
                    })}
                  </div>
                </div>
                
                <div className="space-y-2">
                  {evolutionData.map(item => (
                    <div key={item.metric} className="flex items-center gap-3 p-2 bg-slate-900/50 rounded-lg hover:bg-slate-900 transition-colors">
                      {/* Trend Icon */}
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center ${
                        item.trend === 'up' ? 'bg-emerald-500/20 text-emerald-400' :
                        item.trend === 'down' ? 'bg-red-500/20 text-red-400' :
                        'bg-slate-700/50 text-slate-500'
                      }`}>
                        {item.trend === 'up' ? <TrendingUp className="w-3 h-3" /> :
                         item.trend === 'down' ? <TrendingDown className="w-3 h-3" /> :
                         <Minus className="w-3 h-3" />}
                      </div>
                      
                      {/* Metric Name */}
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-slate-300 font-medium truncate" title={item.metric}>
                          {item.shortMetric}
                        </div>
                      </div>
                      
                      {/* Previous Value */}
                      <div className="text-xs text-slate-500 font-mono w-14 text-right">
                        {item.previous % 1 !== 0 ? item.previous.toFixed(2) : item.previous}
                      </div>
                      
                      {/* Arrow */}
                      <div className="text-slate-600">→</div>
                      
                      {/* Current Value */}
                      <div className="text-xs text-white font-mono font-bold w-14 text-right">
                        {item.current % 1 !== 0 ? item.current.toFixed(2) : item.current}
                      </div>
                      
                      {/* Change Indicator */}
                      <div className={`text-[10px] font-bold px-2 py-0.5 rounded w-16 text-center ${
                        item.trend === 'up' ? 'bg-emerald-500/20 text-emerald-400' :
                        item.trend === 'down' ? 'bg-red-500/20 text-red-400' :
                        'bg-slate-700 text-slate-400'
                      }`}>
                        {item.trend === 'up' ? '+' : ''}{item.percentChange}%
                      </div>
                    </div>
                  ))}
                </div>
                
                {/* Summary */}
                <div className="mt-4 pt-4 border-t border-slate-800 flex items-center justify-between">
                  <div className="text-xs text-slate-500">
                    Comparaison {extractSeason(playerSeasons[1].League)} → {extractSeason(playerSeasons[0].League)}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-slate-500">En progrès :</span>
                    <span className="text-xs font-bold text-emerald-400">
                      {evolutionData.filter(e => e.trend === 'up').length}/{evolutionData.length}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* No Evolution Data Message */}
            {playerSeasons.length < 2 && (
              <div className="bg-slate-950/50 border border-slate-800/50 border-dashed rounded-3xl p-6 text-center">
                <TrendingUp className="w-8 h-8 text-slate-700 mx-auto mb-2" />
                <p className="text-sm text-slate-500">Évolution indisponible</p>
                <p className="text-xs text-slate-600">Une seule saison disponible pour ce joueur</p>
              </div>
            )}

            {/* Heatmap of the season */}
            <PlayerHeatmap player={player} />

            {/* Age curve and one-year projection */}
            <DevelopmentPanel player={player} metrics={developmentMetrics} />

            {/* US-09: Suggested Roles */}
            <div className="bg-slate-950 border border-slate-800 rounded-3xl p-6 shadow-xl break-inside-avoid">
                 <h3 className="text-lg font-bold text-white flex items-center gap-2 mb-4">
                     <Award className="w-5 h-5 text-purple-400" /> Meilleurs rôles
                 </h3>
                 <p className="text-xs text-slate-500 mb-4">
                    Moyenne pondérée des percentiles du rôle, parmi les joueurs du même poste et du même niveau.
                 </p>
                 <div className="space-y-3">
                     {bestRoles.map((role, idx) => (
                         <div key={role.role} className="relative overflow-hidden bg-slate-900 rounded-xl p-3 border border-slate-800">
                             {/* Progress Bar Background */}
                             <div 
                                className={`absolute left-0 top-0 bottom-0 opacity-10 ${getRoleColor(role.normalizedScore)}`} 
                                style={{ width: `${role.normalizedScore}%` }}
                             ></div>
                             
                             <div className="flex justify-between items-center relative z-10">
                                 <div className="flex items-center gap-3">
                                     <div className="text-xs font-bold text-slate-600 w-4">{idx + 1}</div>
                                     <span className="font-semibold text-slate-200 text-sm">{roleLabel(role.role)}</span>
                                 </div>
                                 <div className="flex items-center gap-2">
                                     <div className={`text-sm font-bold px-2 py-0.5 rounded text-slate-950 ${getRoleColor(role.normalizedScore)}`}>
                                         {role.normalizedScore}
                                     </div>
                                 </div>
                             </div>
                         </div>
                     ))}
                 </div>
            </div>
        </div>

        {/* Right Column: AI Scout Report & Shot Map */}
        <div className="lg:col-span-2 flex flex-col gap-6">

            {/* RAPM, finishing, pass network, value vs performance */}
            <ImpactPanel player={player} />
            
            {/* AI Scout Report */}
            <div className="bg-slate-950 border border-slate-800 rounded-3xl p-8 shadow-xl flex flex-col">
                <div className="flex items-center justify-between mb-6 pb-6 border-b border-slate-800">
                    <h3 className="text-xl font-bold text-white flex items-center gap-3">
                        <FileText className="w-6 h-6 text-purple-400" /> 
                        <span>Rapport de scouting IA</span>
                    </h3>
                    {!report && (
                        <button 
                        onClick={handleGenerateReport}
                        disabled={loadingReport}
                        className="px-5 py-2.5 bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white rounded-xl text-sm font-bold transition-all disabled:opacity-50 flex items-center gap-2 shadow-lg shadow-emerald-500/20 hover:shadow-emerald-500/40"
                    >
                        {loadingReport ? (
                            <>
                                <span className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin"></span>
                                Analyse en cours...
                            </>
                        ) : (
                            <>
                                <Sparkles className="w-4 h-4" />
                                Générer le rapport
                            </>
                        )}
                    </button>
                    )}
                </div>

                <div className="flex-1 bg-slate-900/30 rounded-2xl p-2 md:p-6 overflow-y-auto max-h-[600px] min-h-[400px]">
                    {report ? (
                        <div className="prose prose-invert prose-sm md:prose-base max-w-none">
                            <ReactMarkdown 
                                components={{
                                    h1: ({node, ...props}) => <h1 className="text-2xl font-bold text-white mb-4" {...props} />,
                                    h2: ({node, ...props}) => <h2 className="text-xl font-bold text-emerald-400 mt-8 mb-4 flex items-center gap-2" {...props} />,
                                    h3: ({node, ...props}) => <div className="text-sm font-bold text-slate-500 uppercase tracking-widest mt-6 mb-3 border-b border-slate-800 pb-2" {...props} />,
                                    strong: ({node, ...props}) => <strong className="text-white font-bold bg-slate-800/50 px-1 rounded" {...props} />,
                                    ul: ({node, ...props}) => <ul className="space-y-3 my-4 pl-0" {...props} />,
                                    li: ({node, ...props}) => <li className="flex items-start gap-3 text-slate-300 bg-slate-900/50 p-3 rounded-lg border border-slate-800/50 hover:border-slate-700 transition-colors" {...props} />,
                                    p: ({node, ...props}) => <p className="leading-relaxed text-slate-300 mb-4" {...props} />
                                }}
                            >
                                {report}
                            </ReactMarkdown>
                            
                            <div className="mt-8 pt-6 border-t border-slate-800 flex items-center justify-between text-xs text-slate-500">
                                <span>Généré par Gemini 2.5 Flash</span>
                                <span>{new Date().toLocaleDateString()}</span>
                            </div>
                        </div>
                    ) : (
                        <div className="h-full flex flex-col items-center justify-center text-slate-500 gap-8 py-10">
                            <div className="relative group cursor-pointer" onClick={handleGenerateReport}>
                                <div className="absolute inset-0 bg-emerald-500/20 blur-2xl rounded-full group-hover:bg-emerald-500/30 transition-all duration-500"></div>
                                <div className="w-24 h-24 rounded-3xl bg-slate-800 border-2 border-slate-700 group-hover:border-emerald-500 flex items-center justify-center relative z-10 transition-all duration-300 shadow-2xl">
                                    <Sparkles className="w-10 h-10 text-emerald-500 group-hover:scale-110 transition-transform" />
                                </div>
                            </div>
                            <div className="text-center max-w-sm space-y-3">
                                <h4 className="text-white font-bold text-lg">Rapport de scouting détaillé</h4>
                                <p className="text-sm leading-relaxed">
                                    Un modèle de langage traduit les statistiques en langage football.
                                    <br/>Contient : <span className="text-emerald-400">rôle tactique</span>, <span className="text-emerald-400">forces et faiblesses</span> et <span className="text-emerald-400">projection</span>.
                                </p>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* US-11: Player Shot Map Visualization */}
            <div className="bg-slate-950 border border-slate-800 rounded-3xl p-8 shadow-xl flex flex-col">
                <div className="flex items-center justify-between mb-6 pb-6 border-b border-slate-800">
                    <h3 className="text-xl font-bold text-white flex items-center gap-3">
                        <Crosshair className="w-6 h-6 text-red-400" /> 
                        <span>Carte des tirs de la saison</span>
                    </h3>
                    <div className="flex gap-4">
                        <div className="text-center">
                            <div className="text-[10px] uppercase text-slate-500 font-bold">Buts</div>
                            <div className="text-lg font-bold text-emerald-400">{shotStats.goals}</div>
                        </div>
                        <div className="text-center">
                            <div className="text-[10px] uppercase text-slate-500 font-bold">xG</div>
                            <div className="text-lg font-bold text-blue-400">{shotStats.xG.toFixed(2)}</div>
                        </div>
                        <div className="text-center">
                            <div className="text-[10px] uppercase text-slate-500 font-bold">Tirs</div>
                            <div className="text-lg font-bold text-white">{shotStats.total}</div>
                        </div>
                    </div>
                </div>

                <div className="bg-[#1a2c2c] rounded-2xl p-4 border border-slate-800/50 relative min-h-[400px] flex items-center justify-center overflow-hidden">
                     {/* Horizontal Pitch Container */}
                     <div className="relative w-full aspect-[105/68] max-w-[600px] bg-emerald-900/30 border-2 border-white/30 rounded-lg shadow-2xl">
                        {/* Pitch Markings */}
                        <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/grass.png')] opacity-30"></div>
                        <div className="absolute top-1/2 left-0 w-full h-px bg-white/20 -translate-y-1/2"></div> {/* Halfway Line */}
                        <div className="absolute right-0 top-1/4 bottom-1/4 w-px bg-white/20"></div> {/* Penalty Area Line */}
                        <div className="absolute right-0 top-[40%] bottom-[40%] w-[5%] border border-white/20 bg-emerald-800/50"></div> {/* 6 yard box */}
                        <div className="absolute left-0 top-0 bottom-0 w-1 bg-white/50"></div> {/* Goal Line Own */}
                        <div className="absolute right-0 top-0 bottom-0 w-1 bg-white/50"></div> {/* Goal Line Opp */}
                        <div className="absolute left-1/2 top-1/2 w-16 h-16 border border-white/20 rounded-full -translate-x-1/2 -translate-y-1/2"></div>
                        <div className="absolute right-[11%] top-1/2 w-1 h-1 bg-white rounded-full"></div> {/* Penalty Spot */}

                        {/* Plots */}
                        {playerShots.length > 0 ? playerShots.map((shot, i) => {
                            const isGoal = shot.result === 'Goal';
                            const color = isGoal ? '#10b981' : shot.result === 'SavedShot' ? '#3b82f6' : '#ef4444';
                            // Normalize size
                            const size = Math.max(6, Math.min(20, shot.xG * 30));

                            return (
                                <div 
                                    key={i}
                                    className="absolute rounded-full border border-black/20 hover:scale-150 transition-transform cursor-pointer shadow-sm z-10 group"
                                    style={{
                                        left: `${shot.X * 100}%`,
                                        top: `${shot.Y * 100}%`,
                                        width: `${size}px`,
                                        height: `${size}px`,
                                        backgroundColor: color,
                                        opacity: 0.8,
                                        transform: 'translate(-50%, -50%)'
                                    }}
                                >
                                    {isGoal && <div className="absolute inset-0 border border-white rounded-full animate-pulse"></div>}
                                    
                                    {/* Tooltip */}
                                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-32 bg-slate-900/90 text-[10px] text-white p-2 rounded hidden group-hover:block z-50 pointer-events-none">
                                        <div className="font-bold">{shotResultLabel(shot.result)}</div>
                                        <div>xG: {shot.xG.toFixed(2)}</div>
                                        <div>Minute : {shot.minute}'</div>
                                        <div>Surface : {shotTypeLabel(shot.shotType)}</div>
                                    </div>
                                </div>
                            );
                        }) : (
                            <div className="absolute inset-0 flex items-center justify-center">
                                <span className="text-white/30 text-sm font-medium">Aucune donnée de tir pour ce joueur.</span>
                            </div>
                        )}
                    </div>
                </div>
                 {/* Legend */}
                 <div className="mt-4 flex justify-center gap-6">
                    <div className="flex items-center gap-2 text-xs text-slate-400">
                        <div className="w-3 h-3 rounded-full bg-emerald-500"></div> But
                    </div>
                    <div className="flex items-center gap-2 text-xs text-slate-400">
                        <div className="w-3 h-3 rounded-full bg-blue-500"></div> Arrêté
                    </div>
                    <div className="flex items-center gap-2 text-xs text-slate-400">
                        <div className="w-3 h-3 rounded-full bg-red-500"></div> Manqué ou contré
                    </div>
                 </div>
            </div>

        </div>
      </div>
      
      {/* Detailed Stat Grid (Compact for Print) */}
      <div className="bg-slate-950 border border-slate-800 rounded-3xl p-8 shadow-xl break-inside-avoid">
          <h3 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
             <Share2 className="w-5 h-5 text-emerald-500" /> Toutes les métriques
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {Object.entries(player).map(([key, value]) => {
                if (!isMetricKey(key, value)) return null;
                return (
                    <div key={key} className="bg-slate-900/50 p-3 rounded-xl border border-slate-800 hover:border-slate-700 transition-colors">
                        <div className="text-[10px] text-slate-500 uppercase font-semibold truncate mb-1" title={metricLabel(key)}>{metricLabel(key)}</div>
                        <div className="text-sm font-mono text-slate-200 font-bold">
                            {typeof value === 'number' ? value.toLocaleString(undefined, { maximumFractionDigits: 2 }) : value}
                        </div>
                    </div>
                );
            })}
          </div>
      </div>

      </div> {/* End Print Ref */}
    </div>
  );
};

export default PlayerCard;
