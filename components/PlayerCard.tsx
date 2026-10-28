
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { PlayerData, ShotEvent, extractSeason, getPlayerSeason, getSeasonShortLabel, getSeasonLabel, getPlayerSeasonTag } from '../types';
import { useShots } from '../hooks/useShots';
import { useAsyncData } from '../hooks/useAsyncData';
import PlayerHeatmap from './PlayerHeatmap';
import { metricLabel, positionName, roleLabel, styleLabel, footLabel } from '../utils/labels';
import { ImpactPanel, DevelopmentPanel, buildReportInsights } from './PlayerInsights';
import { dataLoader } from '../services/dataLoader';
import { ArrowLeft, Sparkles, MapPin, Footprints, Ruler, FileText, Download, Settings2, X, Check, Search, Award, Crosshair, TrendingUp, TrendingDown, Minus, BarChart3 } from 'lucide-react';
import { ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, Tooltip } from 'recharts';
import { generateScoutReport, ScoutReportError } from '../services/scoutReportService';
import { getBestRoles } from '../utils/scoringUtils';
import { getRadarMetricsForPosition, filterAvailableMetrics, getPositionCategory, getPositionCategoryLabel, getMetricKeys, isMetricKey } from '../utils/positionMetrics';
import ReactMarkdown from 'react-markdown';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { getFlagUrl } from '../utils/flags';
import { TeamLogo, CompetitionBadge, CountryFlag, PlayerAvatar } from './Media';
import { Panel, Stat, PercentileRow, PercentileValue, PercentileBar, PercentileLegend, LegendItem, EmptyState, Delta, PolarTick, InfoTip, LoadError, SkeletonBlock } from './ui';
import { groupMetrics } from '../utils/metricCategories';
import { isSeasonInProgress, MIN_NETWORK_MATCHES, MIN_RAPM_MINUTES, PIPELINE_PERCENTILE_HELP, RATING_HELP } from '../utils/sampleContext';
import { BRAND, CONTEXT, INK, polarGridProps } from '../theme/charts';
import ShotPitch, { ShotLegend } from './ShotPitch';

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

/**
 * Tir du joueur (identifiant PitchAPI, repli sur le nom)
 */
const isPlayerShot = (s: ShotEvent, player: PlayerData): boolean =>
  player['Player ID'] ? s.player_id === player['Player ID'] : s.player === player.Player;

const NO_ROWS: PlayerData[] = [];

/** Libellé court sur téléphone, complet à partir de la largeur sm */
const MobileLabel: React.FC<{ short: string; full: string }> = ({ short, full }) => (
  <><span className="sm:hidden">{short}</span><span className="hidden sm:inline">{full}</span></>
);

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
  const [reportError, setReportError] = useState<string | null>(null);
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
  
  // Rapport propre au joueur affiché
  useEffect(() => {
    setReport(null);
    setReportError(null);
  }, [player]);

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
  // La saison précédente est chargée à la demande (une seule saison est en mémoire) :
  // idle s'il n'y a pas de saison précédente, puis loading, success (éventuellement sans le joueur) ou error
  const previousSeasonId = useMemo(() => {
    const seasons = dataLoader.getCachedIndex()?.seasons.map(s => s.id) ?? [];
    return seasons[seasons.indexOf(getPlayerSeason(player)) - 1];
  }, [player]);
  const previousRequest = useAsyncData(
    previousSeasonId
      ? () => dataLoader.loadSeason(previousSeasonId).then(data => data.players.filter(p => isSamePlayer(p, player)))
      : null,
    [previousSeasonId, player],
  );
  const previousSeasonRows = previousRequest.data ?? NO_ROWS;

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

  // Shot Map Data : chargement, échec et « aucun tir » sont distincts
  const shotsRequest = useShots(getPlayerSeason(player), player.Competition);
  const competitionShots = shotsRequest.shots;
  const shotsReady = shotsRequest.status === 'success';
  const playerShots = useMemo(() => {
    return competitionShots.filter(s => isPlayerShot(s, player));
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
    // Poste absent des données : pas de « postes inconnus » au pluriel
    const role = player.Position ? `${positionName(player.Position).toLowerCase()}s` : 'joueurs sans poste';
    switch (comparisonMode) {
      case 'position':
        return `${count} ${role}, toutes compétitions`;
      case 'league':
        const leagueName = player.League?.split(' ').slice(0, -1).join(' ') || 'la compétition';
        return `${count} joueurs en ${leagueName}`;
      case 'position_league':
        const league = player.League?.split(' ').slice(0, -1).join(' ') || 'la compétition';
        return `${count} ${role} en ${league}`;
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
    setReportError(null);
    try {
      const curves = await dataLoader.loadAgeCurves().catch(() => null);
      // Tirs attendus s'ils sont encore en chargement ; omis du rapport s'ils sont indisponibles (jamais « 0 tir » à tort)
      const reportShots = player.Competition
        ? await dataLoader.loadShots(getPlayerSeason(player), player.Competition)
          .then(all => all.filter(s => isPlayerShot(s, player)))
          .catch(() => null)
        : null;
      const reportGoals = reportShots?.filter(s => s.result === 'Goal').length ?? 0;
      const reportXG = reportShots?.reduce((acc, s) => acc + s.xG, 0) ?? 0;
      const percentiles = Object.fromEntries(
        Object.entries(player)
          .filter(([key, value]) => key.endsWith(' pct') && typeof value === 'number')
          .map(([key, value]) => [key.slice(0, -4), value as number]));
      const text = await generateScoutReport(player, {
        language: 'fr',
        percentileProfile: { player, percentiles, zScores: {}, averages: {} },
        bestRoles,
        shotStats: reportShots ? {
          total: reportShots.length, goals: reportGoals, xG: reportXG, xGDiff: reportGoals - reportXG,
          onTarget: reportShots.filter(s => s.result === 'Goal' || s.result === 'SavedShot').length,
          blocked: reportShots.filter(s => s.result === 'BlockedShot').length,
          conversion: reportShots.length > 0 ? (reportGoals / reportShots.length) * 100 : 0,
          avgXG: reportShots.length > 0 ? reportXG / reportShots.length : 0,
        } : undefined,
        insights: buildReportInsights(player, curves, developmentMetrics),
      });
      setReport(text);
    } catch (error) {
      setReportError(error instanceof ScoutReportError ? error.message : 'Le rapport n\'a pas pu être généré. Réessayez.');
    } finally {
      setLoadingReport(false);
    }
  };

  const handleExportPDF = async () => {
    if (!printRef.current) return;
    setIsExporting(true);

    try {
      const element = printRef.current;
      const canvas = await html2canvas(element, {
        scale: 2, // Higher resolution
        useCORS: true,
        backgroundColor: '#0B111A', // fond de l'application
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

  // Forces et faiblesses : métriques du radar les mieux et les moins bien classées dans le groupe de comparaison
  const strengths = useMemo(() => [...chartData].sort((a, b) => b.A - a.A).filter(m => m.A >= 70).slice(0, 4), [chartData]);
  const weaknesses = useMemo(() => [...chartData].sort((a, b) => a.A - b.A).filter(m => m.A <= 30).slice(0, 4), [chartData]);

  const formatRaw = (v: number) => (Number.isInteger(v) ? v.toLocaleString('fr-FR') : v.toLocaleString('fr-FR', { maximumFractionDigits: 2 }));
  const fixed = (v: number, digits: number) => v.toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const playerSeason = extractSeason(player.League);
  const market = typeof player['Market value'] === 'number' ? player['Market value'] : undefined;
  const estimate = typeof player['Estimated value'] === 'number' ? player['Estimated value'] : undefined;
  const contract = player['Contract expires'] ? String(player['Contract expires']) : undefined;
  const dataIndex = dataLoader.getCachedIndex();
  const loadedSeasons = dataIndex?.seasons ?? [];
  const isCurrentSeason = loadedSeasons[loadedSeasons.length - 1]?.id === playerSeason;
  const contractMonths = contract ? Math.round((new Date(contract).getTime() - Date.now()) / (30.44 * 86400000)) : undefined;
  const valuation = dataIndex?.models?.valuation;

  // Saison pas encore terminée à la date des données : échantillon partiel, signalé dans l'en-tête
  const seasonInProgress = isCurrentSeason && isSeasonInProgress(getPlayerSeason(player), player.Season, dataIndex?.generatedAt);
  const matches = Number(player['Matches played']) || 0;
  const minutes = Number(player['Minutes played']) || 0;
  const coverage = typeof player['Analytics coverage'] === 'number' ? player['Analytics coverage'] : undefined;
  const sampleHelp = [
    `Saison en cours : données arrêtées au ${dataIndex?.generatedAt ? new Date(dataIndex.generatedAt).toLocaleDateString('fr-FR') : '—'}. Échantillon : ${matches} matchs, ${minutes.toLocaleString('fr-FR')} minutes.`,
    'Avec peu de matchs, les valeurs par 90 et les percentiles sont plus instables ; les valeurs par 90 sont ramenées vers la moyenne du rôle quand les minutes sont faibles.',
    `Indicateurs avancés soumis à des seuils : réseau de passes à partir de ${MIN_NETWORK_MATCHES} matchs, percentile RAPM à partir de ${MIN_RAPM_MINUTES} minutes (fenêtre de deux saisons).`,
    ...(coverage !== undefined && coverage < 1 ? [`Statistiques avancées disponibles sur ${Math.round(coverage * 100)} % des minutes du joueur.`] : []),
  ].join('\n');

  // Radar : percentile du joueur et repère de la médiane du groupe (50)
  const radarData = useMemo(() => chartData.map(d => ({ ...d, median: 50 })), [chartData]);

  // Lien radar ↔ percentiles : métrique survolée dans l'un, mise en évidence dans l'autre
  const [focusMetric, setFocusMetric] = useState<string | null>(null);
  const focusBySubject = (subject: string | null) => setFocusMetric(subject ? chartData.find(d => d.subject === subject)?.fullSubject ?? null : null);
  const focusEvents = (key: string) => ({
    onMouseEnter: () => setFocusMetric(key),
    onMouseLeave: () => setFocusMetric(null),
    onFocus: () => setFocusMetric(key),
    onBlur: () => setFocusMetric(null),
    tabIndex: 0,
  });

  // Toutes les métriques : par catégorie, avec recherche locale
  const [metricQuery, setMetricQuery] = useState('');
  useEffect(() => { setMetricQuery(''); }, [player]);
  const allMetricKeys = useMemo(() => Object.entries(player).filter(([key, value]) => isMetricKey(key, value)).map(([key]) => key), [player]);
  const metricGroups = useMemo(() => {
    const norm = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const q = norm(metricQuery.trim());
    const keys = q ? allMetricKeys.filter(k => norm(metricLabel(k)).includes(q) || norm(k).includes(q)) : allMetricKeys;
    return groupMetrics(keys);
  }, [allMetricKeys, metricQuery]);
  const shownMetricCount = metricGroups.reduce((n, g) => n + g.keys.length, 0);
  const metricSearchInput = (
    <div className="relative">
      <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-ink-4" aria-hidden />
      <input type="search" placeholder="Rechercher une métrique…" className="sv-input sv-input-sm pl-7"
        value={metricQuery} onChange={e => setMetricQuery(e.target.value)} aria-label="Rechercher une métrique" />
    </div>
  );

  const hasEvolution = evolutionData !== null && playerSeasons.length >= 2;

  return (
    <div className="p-4 sm:p-5 space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="sv-btn sv-btn-ghost -ml-2">
          <ArrowLeft className="w-3.5 h-3.5" /> Retour
        </button>
        <button onClick={handleExportPDF} disabled={isExporting} className="sv-btn sv-btn-secondary">
          {isExporting
            ? <span className="w-3.5 h-3.5 border-2 border-ink-4 border-t-ink rounded-full animate-spin" />
            : <Download className="w-3.5 h-3.5" />}
          {isExporting ? 'Export en cours…' : 'Exporter en PDF'}
        </button>
      </div>

      {/* Zone exportée en PDF */}
      <div ref={printRef} className="space-y-4 bg-canvas">

      {/* ===== Identité et indicateurs clés ===== */}
      <section className="sv-panel">
        <div className="flex flex-col lg:flex-row lg:items-center gap-4 p-4">
          <div className="flex gap-4 min-w-0 flex-1">
            <PlayerAvatar player={player} size="xl" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <h1 className="text-xl font-semibold text-ink tracking-tight leading-tight">{player.Player}</h1>
                <span className="sv-tag" title="Saison">{getPlayerSeasonTag(player)}</span>
                {seasonInProgress && (
                  <span className="sv-tag !font-normal text-ink-2 cursor-help" tabIndex={0} data-tip={sampleHelp} data-tip-wide="" data-tip-pos="bottom" data-tip-align="start">
                    <span className="w-1.5 h-1.5 rounded-full bg-warn" aria-hidden />
                    Saison en cours · {matches} match{matches > 1 ? 's' : ''}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-[13px] text-ink-2">
                <span className="flex items-center gap-1.5 min-w-0"><TeamLogo src={player['Team logo']} name={player.Team} size="xs" /> <span className="truncate">{player.Team}</span></span>
                <span className="text-ink-4" aria-hidden>·</span>
                <CompetitionBadge competition={player.Competition} />
                {player['Passport country'] && (
                  <>
                    <span className="text-ink-4" aria-hidden>·</span>
                    <span className="flex items-center gap-1.5">{getFlagUrl(player['Passport country']) ? <CountryFlag code={player['Passport country']} /> : <MapPin className="w-3.5 h-3.5 text-ink-4" />} {player['Passport country']}</span>
                  </>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
                {player.Position
                  ? <span className="sv-tag !border-accent/50 !text-accent !bg-accent/10" title={positionCategory}>{positionName(player.Position)}</span>
                  : <span className="sv-tag !font-normal text-ink-3">Poste inconnu</span>}
                {bestRoles[0] && <span className="sv-tag" title="Meilleur rôle (indice de rôle)">{roleLabel(bestRoles[0].role)} · {bestRoles[0].normalizedScore}</span>}
                {player['Team style'] && (
                  <span className="sv-tag" title="Style de jeu de l'équipe cette saison (ACP + k-means sur les indicateurs d'équipe)">Équipe : {styleLabel(player['Team style'])}</span>
                )}
                {typeof player.Height === 'number' && <span className="sv-tag !font-normal"><Ruler className="w-3 h-3 text-ink-4" /> {player.Height} cm</span>}
                {player.Foot && <span className="sv-tag !font-normal"><Footprints className="w-3 h-3 text-ink-4" /> pied {footLabel(player.Foot)}</span>}
              </div>
            </div>
          </div>

          {/* Valeur et contrat : un écart modèle / marché est une piste, pas une alerte */}
          <div className="grid grid-cols-3 lg:w-[26rem] shrink-0 border border-line rounded-md divide-x divide-line">
            <Stat className="px-2.5 sm:px-3 py-2.5" label={<MobileLabel short="Marché" full="Valeur marché" />} value={market !== undefined ? formatCurrency(market) : 'N/D'}
              sub={market !== undefined ? 'Transfermarkt, actuelle' : isCurrentSeason ? 'Hors Transfermarkt' : 'Saison en cours seulement'} />
            <Stat className="px-2.5 sm:px-3 py-2.5" label={<MobileLabel short="Modèle" full="Valeur modèle" />} value={estimate !== undefined ? formatCurrency(estimate) : 'N/D'}
              sub={market && estimate ? `×${fixed(estimate / market, 1)} du marché` : estimate !== undefined ? 'Estimée par la performance' : isCurrentSeason ? 'Sans valeur de marché' : 'Saison en cours seulement'}
              help={`Valeur attendue d'après la performance (modèle ridge du pipeline) : une indication, pas un prix.${valuation ? ` R² hors échantillon ${fixed(valuation.r2_cv, 2)}, erreur typique ×${fixed(valuation.median_error_factor, 2)}.` : ''} Un écart avec le marché est une piste à vérifier.`} />
            <Stat className="px-2.5 sm:px-3 py-2.5" label="Contrat" value={contract ? contract.slice(0, 7).split('-').reverse().join('/') : 'N/D'}
              tone={contractMonths !== undefined && contractMonths <= 12 ? 'warn' : 'default'}
              sub={contractMonths !== undefined ? (contractMonths <= 0 ? 'Échu' : `${contractMonths} mois restants`) : 'Inconnu'} />
          </div>
        </div>

        <div className="grid grid-cols-3 md:grid-cols-6 border-t border-line divide-x divide-line [&>*:nth-child(n+4)]:border-t [&>*:nth-child(n+4)]:border-line md:[&>*:nth-child(n+4)]:border-t-0 [&>*:nth-child(4)]:border-l-0 md:[&>*:nth-child(4)]:border-l">
          <Stat className="px-3 sm:px-4 py-2.5" label="Âge" value={player.Age ?? 'N/D'} sub={player['Birth date'] ? String(player['Birth date']) : undefined} />
          <Stat className="px-3 sm:px-4 py-2.5" label="Minutes" value={minutes.toLocaleString('fr-FR')}
            sub={typeof player['Minutes share'] === 'number' ? `${Math.round(player['Minutes share'] * 100)} % des minutes de l'équipe` : undefined} />
          <Stat className="px-3 sm:px-4 py-2.5" label="Matchs" value={player['Matches played']} sub={`${player.Starts ?? 0} titularisations`} />
          <Stat className="px-3 sm:px-4 py-2.5" label="Buts · xG" value={<>{player.Goals ?? 0} <span className="text-ink-3 font-normal text-sm">· {fixed(Number(player.xG) || 0, 1)}</span></>}
            help="Buts et expected goals cumulés sur la saison sélectionnée"
            sub={typeof player['Goals per 90'] === 'number' ? `${fixed(player['Goals per 90'] as number, 2)} but par 90` : undefined} />
          <Stat className="px-3 sm:px-4 py-2.5" label={<MobileLabel short="PD · xA" full="Passes déc. · xA" />} value={<>{player.Assists ?? 0} <span className="text-ink-3 font-normal text-sm">· {fixed(Number(player.xA) || 0, 1)}</span></>}
            help="Passes décisives et expected assists cumulées sur la saison sélectionnée"
            sub={typeof player['xA per 90'] === 'number' ? `${fixed(player['xA per 90'] as number, 2)} xA par 90` : undefined} />
          <Stat className="px-3 sm:px-4 py-2.5" label="Note" value={typeof player.Rating === 'number' ? fixed(player.Rating, 2) : 'N/D'}
            help={`${RATING_HELP}\n\nPxx : ${PIPELINE_PERCENTILE_HELP}`}
            sub={typeof player['Rating pct'] === 'number' ? <PercentileValue value={player['Rating pct'] as number} className="text-2xs" /> : undefined} />
        </div>
      </section>

      {/* ===== Percentiles : radar, barres, forces et faiblesses, rôles ===== */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <Panel
          className="xl:col-span-4 relative"
          title={<>Profil de performance <InfoTip text={`Percentile = (joueurs du groupe sous la valeur + moitié des égalités) / taille du groupe, calculé ici sur le groupe de comparaison choisi (valeur absente comptée 0). Ces percentiles diffèrent de ceux du pipeline affichés dans « Toutes les métriques ».\nSurvolez une métrique pour la retrouver dans les percentiles.`} /></>}
          subtitle={`Percentiles ${COMPARISON_LABELS[comparisonMode]} · ${cohortDescription}`}
          right={
            <button onClick={() => setShowMetricConfig(!showMetricConfig)} className="sv-icon-btn" data-tip="Choisir les métriques" data-tip-pos="left" aria-label="Choisir les métriques" aria-expanded={showMetricConfig}>
              <Settings2 className="w-3.5 h-3.5" />
            </button>
          }
        >
          {showMetricConfig && (
            <div className="absolute inset-0 z-30 bg-surface rounded-lg border border-line-strong p-4 flex flex-col animate-fade-in">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-xs font-semibold uppercase tracking-[0.08em] text-ink">Choisir les métriques</h4>
                <button onClick={() => setShowMetricConfig(false)} className="sv-icon-btn" aria-label="Fermer"><X className="w-4 h-4" /></button>
              </div>
              <div className="relative mb-2">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-4" />
                <input type="text" placeholder="Rechercher une métrique" className="sv-input sv-input-sm pl-8" value={metricSearch} onChange={(e) => setMetricSearch(e.target.value)} />
              </div>
              <div className="flex-1 overflow-y-auto -mx-1 px-1 space-y-px">
                {availableMetrics
                  .filter(k => k.toLowerCase().includes(metricSearch.toLowerCase()) || metricLabel(k).toLowerCase().includes(metricSearch.toLowerCase()))
                  .map(key => {
                    const on = activeMetrics.includes(key);
                    return (
                      <button key={key} onClick={() => toggleMetric(key)}
                        className={`w-full text-left px-2 h-7 rounded text-xs flex items-center justify-between ${on ? 'bg-accent/10 text-accent' : 'text-ink-3 hover:bg-raised hover:text-ink'}`}>
                        <span className="truncate pr-2">{metricLabel(key)}</span>
                        {on && <Check className="w-3 h-3 shrink-0" />}
                      </button>
                    );
                  })}
              </div>
              <div className="mt-2 pt-2 border-t border-line text-2xs text-ink-4 text-center">{activeMetrics.length} / 12 métriques choisies</div>
            </div>
          )}

          <div className="sv-seg w-full" role="group" aria-label="Groupe de comparaison">
            {(['position', 'position_league', 'league', 'all'] as ComparisonMode[]).map(mode => (
              <button key={mode} onClick={() => setComparisonMode(mode)} title={COMPARISON_LABELS[mode]}
                className={`sv-seg-btn flex-1 ${comparisonMode === mode ? 'sv-seg-on' : ''}`} aria-pressed={comparisonMode === mode}>
                {COMPARISON_SHORT_LABELS[mode]}
              </button>
            ))}
          </div>

          {/* Un radar n'a de sens qu'à partir de trois axes */}
          {radarData.length < 3 ? (
            <EmptyState icon={Settings2} title="Pas assez de métriques pour un radar" className="!py-16">
              {radarData.length === 0 ? 'Aucune métrique disponible pour ce joueur.' : 'Les percentiles disponibles sont listés dans le panneau Percentiles ; ajoutez des métriques avec le bouton de réglage.'}
            </EmptyState>
          ) : (
          <div className="h-[300px] -mx-2 mt-1">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart cx="50%" cy="50%" outerRadius="66%" data={radarData} margin={{ top: 18, right: 30, bottom: 18, left: 30 }}
                onMouseMove={(state: { activeTooltipIndex?: number | string | null }) => {
                  // Hors du disque (libellés) : pas d'axe actif, la mise en évidence vient du libellé survolé
                  const i = state?.activeTooltipIndex;
                  if (i !== undefined && i !== null) setFocusMetric(radarData[Number(i)]?.fullSubject ?? null);
                }}
                onMouseLeave={() => setFocusMetric(null)}>
                <PolarGrid {...polarGridProps} />
                <PolarAngleAxis dataKey="subject" tick={(tickProps: object) => {
                  const props = tickProps as React.ComponentProps<typeof PolarTick>;
                  return <PolarTick {...props} active={!!focusMetric && radarData.find(d => d.fullSubject === focusMetric)?.subject === props.payload?.value} onHover={focusBySubject} />;
                }} />
                <PolarRadiusAxis angle={90} domain={[0, 100]} tickCount={5} tick={false} axisLine={false} />
                <Radar name="Médiane du groupe" dataKey="median" stroke={CONTEXT} strokeDasharray="3 3" strokeWidth={1} fill="none" isAnimationActive={false} />
                <Radar name={player.Player} dataKey="A" stroke={BRAND} strokeWidth={2} fill={BRAND} fillOpacity={0.14}
                  dot={(props: { cx?: number; cy?: number; index?: number }) => {
                    const on = props.index !== undefined && radarData[props.index]?.fullSubject === focusMetric;
                    return <circle key={`dot-${props.index}`} cx={props.cx} cy={props.cy} r={on ? 4.5 : 2.5} fill={BRAND} stroke={on ? INK.surface : 'none'} strokeWidth={on ? 2 : 0} />;
                  }}
                  activeDot={{ r: 4, fill: BRAND, stroke: INK.surface, strokeWidth: 2 }} isAnimationActive={false} />
                <Tooltip
                  cursor={false}
                  content={({ payload }) => {
                    const d = payload?.[0]?.payload as (typeof chartData)[number] | undefined;
                    if (!d) return null;
                    return (
                      <div className="sv-tooltip">
                        <div className="text-ink-3 mb-0.5">{d.subject}</div>
                        <div className="flex items-center gap-2"><PercentileValue value={d.A} /><span className="text-ink-2">valeur {formatRaw(d.rawValue)}</span></div>
                        <div className="text-2xs text-ink-4">rang {d.rank} sur {d.cohortSize}</div>
                      </div>
                    );
                  }}
                />
              </RadarChart>
            </ResponsiveContainer>
          </div>
          )}
          <div className="flex items-center justify-between gap-3">
            <div className="flex gap-3">
              <LegendItem color={BRAND} shape="line">{player.Player.split(' ').pop()}</LegendItem>
              <LegendItem color={CONTEXT} shape="line">Médiane du groupe</LegendItem>
            </div>
            <span className="text-2xs text-ink-3" title="Moyenne des percentiles des métriques du radar">
              Moyenne <PercentileValue value={averagePercentile} className="text-2xs" />
            </span>
          </div>
        </Panel>

        <Panel className="xl:col-span-5" title="Percentiles" subtitle="Valeur brute et rang percentile dans le groupe de comparaison"
          right={<span className="text-2xs text-ink-4 num">{cohort.length.toLocaleString('fr-FR')} joueurs</span>}>
          <div className="space-y-0.5 -mx-1.5">
            {chartData.map(d => (
              <PercentileRow key={d.fullSubject} label={d.subject} value={formatRaw(d.rawValue)} percentile={d.A}
                className="px-1.5 outline-none" active={focusMetric === d.fullSubject} {...focusEvents(d.fullSubject)}
                title={`${metricLabel(d.fullSubject)} : ${formatRaw(d.rawValue)}, rang ${d.rank} sur ${d.cohortSize}`} />
            ))}
          </div>
          <PercentileLegend className="mt-3 pt-3 border-t border-line" />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3 mt-3 pt-3 border-t border-line">
            {[{ title: 'Forces', icon: <TrendingUp className="w-3 h-3 text-accent" />, items: strengths, none: 'Aucune métrique au 70e percentile ou plus.' },
              { title: 'Faiblesses', icon: <TrendingDown className="w-3 h-3 text-neg" />, items: weaknesses, none: 'Aucune métrique au 30e percentile ou moins.' }].map(block => (
              <div key={block.title}>
                <div className="sv-label flex items-center gap-1.5 mb-1.5">
                  {block.icon} {block.title}
                  {block.title === 'Forces' && (
                    <InfoTip text={`Tirées des percentiles ci-dessus (métriques du radar, groupe de comparaison actuel : ${cohortDescription}).\nForce : percentile ≥ 70. Faiblesse : percentile ≤ 30. Quatre au plus chacune, de la plus marquée à la moins marquée.\nElles changent avec le groupe de comparaison et les métriques choisies.`} />
                  )}
                </div>
                {block.items.length > 0 ? block.items.map(m => (
                  <div key={m.fullSubject} className={`flex items-center justify-between gap-2 h-6 -mx-1.5 px-1.5 rounded-sm text-xs outline-none ${focusMetric === m.fullSubject ? 'bg-raised' : ''}`} {...focusEvents(m.fullSubject)}>
                    <span className={`truncate ${focusMetric === m.fullSubject ? 'text-accent' : 'text-ink-2'}`}>{m.subject}</span>
                    <PercentileValue value={m.A} className="text-xs shrink-0" />
                  </div>
                )) : <p className="text-xs text-ink-4">{block.none}</p>}
              </div>
            ))}
          </div>
        </Panel>

        <Panel className="xl:col-span-3" title="Meilleurs rôles" icon={Award}
          subtitle="Indice du rôle : moyenne pondérée des percentiles, parmi les joueurs du même poste et du même niveau.">
          <div className="space-y-2">
            {bestRoles.map((role, idx) => (
              <div key={role.role}>
                <div className="flex items-center justify-between gap-2 text-xs mb-1">
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="w-3 text-ink-4 num">{idx + 1}</span>
                    <span className={`truncate ${idx === 0 ? 'text-ink font-medium' : 'text-ink-2'}`}>{roleLabel(role.role)}</span>
                  </span>
                  <span className="num font-semibold text-ink">{role.normalizedScore}</span>
                </div>
                <PercentileBar value={role.normalizedScore} className="ml-5" />
              </div>
            ))}
            {bestRoles.length === 0 && <p className="text-xs text-ink-4">Aucun rôle évaluable pour ce poste.</p>}
          </div>
        </Panel>
      </div>

      {/* ===== Impact, finition, réseau, valeur ===== */}
      <ImpactPanel player={player} />

      {/* ===== Projection, tirs, zones d'action ===== */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-12 gap-4">
        <div className="xl:col-span-5"><DevelopmentPanel player={player} metrics={developmentMetrics} /></div>

        <Panel className="xl:col-span-4 h-full" title="Carte des tirs de la saison" icon={Crosshair}>
          <div className="grid grid-cols-4 gap-3 mb-3">
            <Stat label="Tirs" value={shotsReady ? shotStats.total : '–'} />
            <Stat label="Buts" value={shotsReady ? shotStats.goals : '–'} />
            <Stat label="xG" value={shotsReady ? fixed(shotStats.xG, 2) : '–'} />
            <Stat label="Buts − xG" value={shotsReady ? <Delta value={shotStats.goals - shotStats.xG} digits={2} /> : '–'} />
          </div>
          <ShotPitch shots={playerShots} loading={shotsRequest.status === 'loading'}
            error={shotsRequest.status === 'error' ? shotsRequest.error : null} onRetry={shotsRequest.retry}
            emptyText={player.Competition ? 'Aucune donnée disponible : aucun tir de ce joueur dans les données de la compétition.' : 'Aucune donnée disponible : compétition inconnue.'} />
          <div className="mt-2"><ShotLegend /></div>
        </Panel>

        <div className="xl:col-span-3 lg:col-span-2"><PlayerHeatmap player={player} /></div>
      </div>

      {/* ===== Évolution et rapport ===== */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
        <Panel className="xl:col-span-5" title="Évolution sur un an" icon={TrendingUp}
          subtitle={hasEvolution
            ? `${getSeasonLabel(extractSeason(playerSeasons[1].League))} → ${getSeasonLabel(extractSeason(playerSeasons[0].League))}, métriques du radar`
            : undefined}
          right={hasEvolution
            ? <span className="text-2xs text-ink-3">En progrès <span className="text-ink font-semibold num">{evolutionData!.filter(e => e.trend === 'up').length}/{evolutionData!.length}</span></span>
            : undefined}>
          {hasEvolution ? (
            <table className="w-full text-xs">
              <thead>
                <tr className="sv-label text-left">
                  <th className="font-semibold pb-1.5">Métrique</th>
                  <th className="font-semibold pb-1.5 text-right">{getSeasonShortLabel(extractSeason(playerSeasons[1].League))}</th>
                  <th className="font-semibold pb-1.5 text-right">{getSeasonShortLabel(extractSeason(playerSeasons[0].League))}</th>
                  <th className="font-semibold pb-1.5 text-right">Écart</th>
                </tr>
              </thead>
              <tbody>
                {evolutionData!.map(item => (
                  <tr key={item.metric} className="border-t border-line/70 h-7">
                    <td className="text-ink-2 truncate max-w-[10rem]" title={item.metric}>{item.shortMetric}</td>
                    <td className="text-right text-ink-3 num">{formatRaw(Number(item.previous.toFixed(2)))}</td>
                    <td className="text-right text-ink num font-medium">{formatRaw(Number(item.current.toFixed(2)))}</td>
                    <td className="text-right w-20">
                      <span className="inline-flex items-center gap-1 justify-end">
                        {item.trend === 'up' ? <TrendingUp className="w-3 h-3 text-pos" /> : item.trend === 'down' ? <TrendingDown className="w-3 h-3 text-neg" /> : <Minus className="w-3 h-3 text-ink-4" />}
                        {/* Écart relatif peu parlant depuis une valeur nulle ou minuscule : écart absolu */}
                        {Math.abs(item.previous) < 0.05 || Math.abs(item.percentChange) > 300
                          ? <Delta value={item.diff} digits={2} className="whitespace-nowrap" />
                          : <Delta value={item.percentChange} suffix=" %" className="whitespace-nowrap" />}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : previousRequest.status === 'loading' ? (
            <div role="status" aria-label="Chargement de la saison précédente" className="space-y-1.5">
              <SkeletonBlock className="h-4 w-2/3" />
              {Array.from({ length: Math.min(8, Math.max(activeMetrics.length, 4)) }, (_, i) => <SkeletonBlock key={i} className="h-5" />)}
            </div>
          ) : previousRequest.status === 'error' ? (
            <LoadError message="La saison précédente n'a pas pu être chargée." onRetry={previousRequest.retry} />
          ) : (
            <p className="text-xs text-ink-3 leading-relaxed">
              Aucune donnée disponible : {previousSeasonId
                ? `${player.Player} n'apparaît pas dans la saison ${getSeasonLabel(previousSeasonId)} (seuls les joueurs ayant joué au moins 40 % des minutes de leur équipe y figurent).`
                : 'pas de saison précédente dans les données.'}
            </p>
          )}
        </Panel>

        {/* Rapport IA : fonctionnalité secondaire, en appui des statistiques ScoutVision */}
        <Panel className="xl:col-span-7" title="Rapport rédigé" icon={FileText}
          subtitle="Synthèse textuelle générée par IA (Gemini) à partir des statistiques de cette fiche. À relire : elle ne remplace pas l'analyse."
          right={!report && (
            <button onClick={handleGenerateReport} disabled={loadingReport} className="sv-btn sv-btn-secondary sv-btn-sm">
              {loadingReport ? <span className="w-3 h-3 border-2 border-ink-4 border-t-ink rounded-full animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              {loadingReport ? 'Rédaction…' : 'Générer'}
            </button>
          )}>
          {report ? (
            <div className="max-h-[520px] overflow-y-auto pr-1 text-[13px]">
              <ReactMarkdown
                components={{
                  h1: ({node, ...props}) => <h1 className="text-base font-semibold text-ink mb-3" {...props} />,
                  h2: ({node, ...props}) => <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-accent mt-5 mb-2" {...props} />,
                  h3: ({node, ...props}) => <div className="sv-label mt-4 mb-2 pb-1 border-b border-line" {...props} />,
                  strong: ({node, ...props}) => <strong className="text-ink font-semibold" {...props} />,
                  ul: ({node, ...props}) => <ul className="space-y-1.5 my-2 pl-4 list-disc marker:text-ink-4" {...props} />,
                  li: ({node, ...props}) => <li className="text-ink-2 leading-relaxed" {...props} />,
                  p: ({node, ...props}) => <p className="leading-relaxed text-ink-2 mb-3" {...props} />
                }}
              >
                {report}
              </ReactMarkdown>
              <div className="mt-4 pt-3 border-t border-line flex items-center justify-between text-2xs text-ink-4">
                <span>Généré par Gemini 2.5 Flash</span>
                <span>{new Date().toLocaleDateString('fr-FR')}</span>
              </div>
            </div>
          ) : loadingReport ? (
            <div role="status" aria-label="Rédaction du rapport" className="space-y-1.5">
              {[100, 92, 96, 70].map(w => <SkeletonBlock key={w} className="h-3.5" />)}
            </div>
          ) : reportError ? (
            <LoadError message={reportError} onRetry={handleGenerateReport} />
          ) : (
            <p className="text-2xs text-ink-4">Contenu : rôle tactique, forces et faiblesses, projection, à partir des percentiles, du RAPM et des courbes d'âge.</p>
          )}
        </Panel>
      </div>

      {/* ===== Toutes les métriques, par catégorie ===== */}
      <Panel title={<>Toutes les métriques <InfoTip text={`Valeurs de la saison. Pxx : ${PIPELINE_PERCENTILE_HELP}\nTotaux de saison et indicateurs de modèle sans percentile quand le pipeline n'en fournit pas.`} /></>} icon={BarChart3}
        subtitle="Valeurs de la saison, regroupées par famille ; percentile du rôle quand le pipeline le fournit."
        right={
          <div className="hidden sm:flex items-center gap-2">
            <span className="text-2xs text-ink-4 num">{shownMetricCount}/{allMetricKeys.length}</span>
            <div className="w-56">{metricSearchInput}</div>
          </div>
        }>
        <div className="sm:hidden mb-3">{metricSearchInput}</div>
        {metricGroups.length > 0 ? (
          <div className="columns-1 md:columns-2 xl:columns-3 2xl:columns-4 gap-x-6">
            {metricGroups.map(({ category, keys }) => (
              <div key={category.id} className="break-inside-avoid mb-4">
                <div className="sv-label flex items-center justify-between pb-1 border-b border-line-strong">
                  <span>{category.label}</span>
                  <span className="num text-ink-4 font-normal">{keys.length}</span>
                </div>
                {keys.map(key => {
                  const value = player[key];
                  const pct = player[`${key} pct`];
                  return (
                    <div key={key} className="flex items-center gap-2 h-7 border-b border-line/60 text-xs min-w-0">
                      <span className="flex-1 text-ink-3 truncate" title={metricLabel(key)}>{metricLabel(key)}</span>
                      <span className="text-ink num font-medium">{typeof value === 'number' ? value.toLocaleString('fr-FR', { maximumFractionDigits: 2 }) : value}</span>
                      <span className="w-10 text-right">{typeof pct === 'number' ? <PercentileValue value={pct} className="text-2xs" /> : null}</span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-ink-3 py-2">Aucune métrique ne correspond à « {metricQuery} ».</p>
        )}
      </Panel>

      </div>
    </div>
  );
};

export default PlayerCard;
