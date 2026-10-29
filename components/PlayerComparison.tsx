/**
 * ScoutVision - Comparaison de joueurs (2 à 4)
 *
 * Mêmes données que la fiche joueur, le Chasseur et le Recrutement : percentiles du pipeline
 * (« X pct », relatifs au poste, au niveau et à la saison de chaque joueur), rôles via rankPresets.
 * Aucun percentile recalculé, aucune donnée absente lue comme 0, aucun score agrégé.
 */

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeftRight, Search, X, Settings2, Users, Info, Trash2, Radar as RadarIcon, Scale, Table2, RotateCcw } from 'lucide-react';
import { ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, Tooltip } from 'recharts';
import { PlayerData, getPlayerSeasonId, getPlayerSeasonTag } from '../types';
import { getMetricKeys } from '../utils/positionMetrics';
import { metricLabel, positionLabel, positionName } from '../utils/labels';
import { groupMetrics, METRIC_CATEGORIES } from '../utils/metricCategories';
import { rankPresets, ROLE_CORE_WEIGHT, MIDFIELD_PROFILE_BONUS } from '../utils/rolePresets';
import { PIPELINE_PERCENTILE_HELP, roleIndexHelp } from '../utils/sampleContext';
import { formatEuro } from '../utils/format';
import { formatMetricValue, isSeasonTotal, metricValue, percentileOf, radarAxisLabel } from '../utils/metricFormat';
import { LOWER_IS_BETTER, metricDirection } from '../utils/metricDirection';
import {
  ComparisonEntry, MAX_COMPARED, MIN_RADAR_AXES, addEntry, bestValueIndices, comparisonEntry, defaultComparisonMetrics,
  distinctNames, hasDetailedStats, mainDifferences, radarAxes, referenceGroups, resolveSelection,
} from '../utils/comparison';
import { PlayerAvatar, TeamLogo, CompetitionBadge } from './Media';
import { PlayerSearch } from './PlayerSearch';
import { competitionName, isCup, minutesOf, seasonInProgress } from '../utils/playerContext';
import { PageHeader, Panel, EmptyState, PercentileValue, PolarTick, LegendItem, IndexBar, InfoTip } from './ui';
import { GroundedAiPanel } from './ai/GroundedAiPanel';
import { aiCompare } from '../services/groundedAiService';
import { SERIES, polarGridProps } from '../theme/charts';

interface PlayerComparisonProps {
  data: PlayerData[];
  onSelectPlayer?: (player: PlayerData) => void;
  selectedId?: string;                     // dernière fiche consultée depuis la comparaison
}

type ViewMode = 'raw' | 'percentile';

// Sélection, métriques et affichage retrouvés au retour d'une fiche ou d'une autre page (comme la Base et le Chasseur)
const memory = {
  entries: [] as ComparisonEntry[],
  customMetrics: null as string[] | null,   // null : métriques des postes sélectionnés
  viewMode: 'raw' as ViewMode,
  scrollTop: 0,
};

/** Prépare la comparaison depuis une autre page (Joueurs similaires) : remplace la sélection, garde les métriques des postes */
export function prepareComparison(players: PlayerData[]): void {
  memory.entries = players.slice(0, MAX_COMPARED).map(comparisonEntry);
  memory.customMetrics = null;
  memory.scrollTop = 0;
}

const GOALKEEPING = new Set(METRIC_CATEGORIES.find(c => c.id === 'goalkeeping')?.keys ?? []);
const INTEGER = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });

// ============================================
// CARTE JOUEUR
// ============================================

const PlayerSnapshot: React.FC<{
  player: PlayerData;
  color: string;
  viewed: boolean;
  onRemove: () => void;
  onOpen?: () => void;
  removeRef: (el: HTMLButtonElement | null) => void;
  openRef: (el: HTMLButtonElement | null) => void;
}> = ({ player: p, color, viewed, onRemove, onOpen, removeRef, openRef }) => {
  const roles = useMemo(() => rankPresets(p, undefined, 2), [p]);
  const minutes = minutesOf(p);
  const matches = metricValue(p, 'Matches played');
  const market = metricValue(p, 'Market value');
  const age = metricValue(p, 'Age');
  const inProgress = seasonInProgress(p);
  const detailed = hasDetailedStats(p);
  return (
    <article className={`sv-panel relative pl-4 pr-2 py-2.5 flex flex-col ${viewed ? 'ring-1 ring-accent/40' : ''}`} aria-label={`${p.Player}, ${p.Team}, ${getPlayerSeasonTag(p)}`}>
      <span className="absolute left-0 inset-y-0 w-[3px] rounded-l-lg" style={{ backgroundColor: color }} aria-hidden />
      <div className="flex items-start gap-3">
        <PlayerAvatar player={p} size="md" />
        <div className="min-w-0 flex-1">
          <h2 className="text-[13px] font-medium text-ink leading-snug">{p.Player || 'Inconnu'}</h2>
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 mt-0.5 text-2xs text-ink-3">
            <span className="inline-flex items-center gap-1 min-w-0"><TeamLogo src={p['Team logo'] as string | undefined} name={p.Team} size="xs" /><span>{p.Team}</span></span>
            <span aria-hidden>·</span>
            <CompetitionBadge competition={p.Competition} className="max-w-full" />
          </div>
          <div className="flex flex-wrap items-center gap-1 mt-1.5">
            <span className="sv-tag" title={positionName(p.Position)}>{positionLabel(p.Position)}</span>
            <span className="sv-tag !font-normal">{age !== null ? `${age} ans` : 'Âge inconnu'}</span>
            <span className="sv-tag !font-normal" title="Saison">{getPlayerSeasonTag(p)}</span>
            {isCup(p) && <span className="sv-tag !font-normal">Coupe</span>}
            {inProgress && (
              <span className="sv-tag !font-normal text-ink-2" title="Échantillon limité : la saison n'est pas terminée. Ce n'est pas une performance inférieure.">
                <span className="w-1.5 h-1.5 rounded-full bg-ink-3" aria-hidden />
                Saison en cours{matches !== null ? ` · ${matches} match${matches > 1 ? 's' : ''}` : ''}
              </span>
            )}
          </div>
        </div>
        <button ref={removeRef} onClick={onRemove} className="sv-icon-btn hover:!text-neg -mt-0.5 shrink-0" aria-label={`Retirer ${p.Player} de la comparaison`}>
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="mt-2.5 pt-2 border-t border-line grid grid-cols-[1fr_1fr_auto] items-end gap-x-3 gap-y-2 text-2xs">
        <div>
          <div className="sv-label">Minutes</div>
          <div className="text-sm font-semibold text-ink num">{minutes !== null ? INTEGER.format(minutes) : '–'}</div>
        </div>
        <div>
          <div className="sv-label">Valeur</div>
          <div className="text-sm font-semibold text-ink num">{market !== null ? formatEuro(market) : 'N/D'}</div>
        </div>
        {onOpen ? (
          <button ref={openRef} onClick={onOpen} className="sv-btn sv-btn-secondary sv-btn-sm" aria-label={`Voir la fiche de ${p.Player}`}>
            Voir la fiche
          </button>
        ) : <span />}
        <div className="col-span-3">
          <div className="sv-label">Rôle principal</div>
          {roles[0] ? (
            <>
              <div className="flex items-center justify-between gap-2 mt-0.5 text-xs">
                <span className="text-ink">{roles[0].name}</span>
                <span className="num font-semibold text-ink">{roles[0].index}</span>
              </div>
              <IndexBar value={roles[0].index} className="mt-1" />
              {roles[1] && (
                <div className="hidden sm:flex items-center justify-between gap-2 mt-1 text-2xs text-ink-3">
                  <span>Puis {roles[1].name}</span><span className="num">{roles[1].index}</span>
                </div>
              )}
            </>
          ) : <div className="text-xs text-ink-3 mt-0.5">{p.Position ? 'Aucun rôle évaluable' : 'Poste inconnu'}</div>}
        </div>
      </div>

      {!detailed && <p className="text-2xs text-ink-2 mt-2 leading-snug">Aucune statistique détaillée sur cette ligne : les métriques s'affichent « – ».</p>}
      {viewed && <span className="sr-only">Dernière fiche consultée</span>}
    </article>
  );
};

// ============================================
// NOTE MÉTHODOLOGIQUE
// ============================================

/** « niveau 1 (Ligue 1 : A, B ; Premier League : C) · niveau 3 (K League 1 : D) » */
function byTier(players: PlayerData[], names: string[]): string {
  const tiers = new Map<string, Map<string, string[]>>();
  players.forEach((p, i) => {
    const tier = String(p['League tier'] ?? '?');
    if (!tiers.has(tier)) tiers.set(tier, new Map());
    const comps = tiers.get(tier)!;
    comps.set(competitionName(p), [...(comps.get(competitionName(p)) ?? []), names[i]]);
  });
  return [...tiers].map(([tier, comps]) => `niveau ${tier} (${[...comps].map(([c, who]) => `${c} : ${who.join(', ')}`).join(' ; ')})`).join(' · ');
}

/** Dimensions du groupe de référence qui diffèrent entre les joueurs (postes, niveaux, saisons) */
function differingDimensions(players: PlayerData[]): string[] {
  const g = referenceGroups(players);
  return [!g.samePosition && 'postes', !g.sameTier && 'niveaux', !g.sameSeason && 'saisons'].filter(Boolean) as string[];
}

const MethodNote: React.FC<{ players: PlayerData[]; names: string[]; hasTotals: boolean }> = ({ players, names, hasTotals }) => {
  const g = referenceGroups(players);
  const same = g.samePosition && g.sameTier && g.sameSeason && g.unknownPosition.length === 0;
  const byValue = (f: (p: PlayerData) => string) => {
    const groups = new Map<string, string[]>();
    players.forEach((p, i) => { const k = f(p); groups.set(k, [...(groups.get(k) ?? []), names[i]]); });
    return [...groups].map(([k, who]) => `${k} (${who.join(', ')})`).join(' · ');
  };
  const first = players[0];
  const tierText = (p: PlayerData) => `niveau ${p['League tier'] ?? '?'}`;
  const inProgress = players.map((p, i) => (seasonInProgress(p) ? names[i] : null)).filter(Boolean);
  return (
    <section aria-label="Groupes de référence des percentiles" className="sv-panel px-4 py-3 flex gap-2.5 text-xs text-ink-2 leading-relaxed">
      <Info className="w-3.5 h-3.5 text-ink-3 mt-0.5 shrink-0" aria-hidden />
      <div className="space-y-1 min-w-0">
        <p>
          {players.length === 1
            ? `Percentiles relatifs au groupe de référence du joueur : ${positionName(first.Position)} · ${tierText(first)} · ${getPlayerSeasonTag(first)}.`
            : same
              ? `Percentiles calculés dans le même groupe de référence : ${positionName(first.Position)} · ${tierText(first)} · ${getPlayerSeasonTag(first)}.`
              : 'Les percentiles sont relatifs au groupe de référence de chaque joueur (poste × niveau × saison). Deux percentiles identiques dans des groupes différents ne représentent pas nécessairement le même niveau absolu.'}
          {' '}<InfoTip text={PIPELINE_PERCENTILE_HELP} align="end" />
        </p>
        {players.length > 1 && !same && (
          <ul className="text-ink-3 space-y-0.5">
            {!g.samePosition && <li>Postes différents : {byValue(p => positionName(p.Position))}.</li>}
            {!g.sameTier && <li>Niveaux différents : {byTier(players, names)}.</li>}
            {!g.sameSeason && <li>Saisons différentes : {byValue(p => getPlayerSeasonTag(p))}.</li>}
          </ul>
        )}
        {g.unknownPosition.length > 0 && (
          <p className="text-ink-3">Poste inconnu pour {g.unknownPosition.map(i => names[i]).join(', ')} : ni métriques de poste ni rôle.</p>
        )}
        {inProgress.length > 0 && (
          <p className="text-ink-3">Saison en cours pour {inProgress.join(', ')} : échantillon limité, pas une performance inférieure.</p>
        )}
        <p className="text-ink-3">
          Rôle principal : indice du rôle (0-100) calculé comme dans la fiche et le Chasseur, propre au poste de chaque joueur ; il décrit un profil et ne se compare pas d'un poste à l'autre.
          {' '}<InfoTip text={roleIndexHelp(ROLE_CORE_WEIGHT, MIDFIELD_PROFILE_BONUS)} align="end" />
        </p>
        {hasTotals && <p className="text-ink-3">Totaux de saison : sans percentile dans le pipeline, à lire avec les minutes jouées.</p>}
      </div>
    </section>
  );
};

// ============================================
// RADAR (percentiles du pipeline)
// ============================================

const ComparisonRadar: React.FC<{ players: PlayerData[]; names: string[]; metrics: string[] }> = ({ players, names, metrics }) => {
  // Même principe que la fiche : rayon réduit sous 340 px, lignes de libellé plus courtes (coupées entre les mots) et moins d'axes quand c'est étroit
  const [width, setWidth] = useState(0);
  const narrow = width > 0 && width < 340;
  const compact = width > 0 && width < 260;
  const { keys, available } = radarAxes(players, metrics, compact ? 6 : narrow ? 8 : 10);

  const data = keys.map(key => {
    const row: Record<string, string | number | null> = { subject: radarAxisLabel(metricLabel(key)), key };
    players.forEach((p, i) => { row[`p${i}`] = percentileOf(p, key); });
    return row;
  });

  const renderTooltip = ({ active, payload }: { active?: boolean; payload?: { payload?: Record<string, unknown> }[] }) => {
    const row = payload?.[0]?.payload;
    if (!active || !row) return null;
    const key = String(row.key);
    return (
      <div className="sv-tooltip min-w-[12rem]">
        <div className="text-2xs text-ink-3 mb-1">{metricLabel(key)}</div>
        {players.map((p, i) => (
          <div key={getPlayerSeasonId(p)} className="flex items-center gap-2 py-0.5">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: SERIES[i] }} aria-hidden />
            <span className="flex-1 min-w-0 text-ink">{p.Player}</span>
            <span className="num font-semibold text-ink">P{Math.round(percentileOf(p, key) as number)}</span>
            <span className="num text-ink-3">{formatMetricValue(key, metricValue(p, key))}</span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <Panel className="xl:col-span-5" icon={RadarIcon} title="Profil"
      subtitle="Percentiles du pipeline (0-100) sur les métriques des postes sélectionnés.">
      {keys.length < MIN_RADAR_AXES ? (
        <EmptyState icon={RadarIcon} title="Pas assez de métriques communes pour un radar" className="!py-14">
          {available} métrique{available > 1 ? 's' : ''} avec un percentile pour chaque joueur ; il en faut {MIN_RADAR_AXES}. Le détail reste dans le tableau.
        </EmptyState>
      ) : (
        <>
          <div className="h-[340px] -mx-4 sm:-mx-2">
            <ResponsiveContainer width="100%" height="100%" onResize={w => setWidth(Math.round(w))}>
              <RadarChart cx="50%" cy="50%" outerRadius={compact ? '48%' : narrow ? '52%' : '66%'} data={data} margin={{ top: 18, right: 30, bottom: 18, left: 30 }}>
                <PolarGrid {...polarGridProps} />
                <PolarAngleAxis dataKey="subject" tick={(tickProps: object) => (
                  <PolarTick {...(tickProps as React.ComponentProps<typeof PolarTick>)} {...(compact ? { maxChars: 11, maxLines: 4 } : narrow ? { maxChars: 12, maxLines: 3 } : { maxLines: 3 })} />
                )} />
                <PolarRadiusAxis angle={90} domain={[0, 100]} tickCount={5} tick={false} axisLine={false} />
                {players.map((p, i) => (
                  <Radar key={getPlayerSeasonId(p)} name={names[i]} dataKey={`p${i}`} stroke={SERIES[i]} strokeWidth={2}
                    fill={SERIES[i]} fillOpacity={i === 0 ? 0.12 : 0.05} dot={{ r: 2, fill: SERIES[i], strokeWidth: 0 }} isAnimationActive={false} />
                ))}
                <Tooltip content={renderTooltip as never} cursor={false} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1">
            {players.map((p, i) => <LegendItem key={getPlayerSeasonId(p)} color={SERIES[i]} shape="line">{names[i]}</LegendItem>)}
          </div>
          {available > keys.length && (
            <p className="text-2xs text-ink-3 mt-2">Radar limité à {keys.length} axes sur {available} ; toutes les métriques sont dans le tableau.</p>
          )}
        </>
      )}
    </Panel>
  );
};

// ============================================
// PRINCIPALES DIFFÉRENCES
// ============================================

const Differences: React.FC<{ players: PlayerData[]; names: string[]; metrics: string[] }> = ({ players, names, metrics }) => {
  const { rows, notComparable } = useMemo(() => mainDifferences(players, metrics, 5), [players, metrics]);
  return (
    <Panel className="xl:col-span-7" icon={Scale} title="Principales différences"
      subtitle={players.length > 2
        ? 'Métriques où les percentiles s\'écartent le plus (écart entre le plus haut et le plus bas), percentiles du pipeline uniquement.'
        : 'Métriques où les percentiles s\'écartent le plus, percentiles du pipeline uniquement.'}>
      {players.length >= 2 && differingDimensions(players).length > 0 && (
        <p className="text-2xs text-ink-3 mb-3 leading-relaxed">
          {`${differingDimensions(players).join(', ').replace(/^./, c => c.toUpperCase())} différents : un écart compare des rangs dans des groupes de référence différents, pas des niveaux absolus.`}
        </p>
      )}
      {players.length < 2 ? (
        <EmptyState icon={Scale} title="Ajoutez au moins un deuxième joueur" className="!py-12">Les écarts de percentile apparaissent dès deux joueurs.</EmptyState>
      ) : rows.length === 0 ? (
        <EmptyState icon={Scale} title="Aucune métrique comparable" className="!py-12">Aucune métrique choisie n'a de percentile pour tous les joueurs.</EmptyState>
      ) : (
        <ol className="divide-y divide-line">
          {rows.map(row => (
            <li key={row.key} className="py-2.5 first:pt-0">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <span className="text-xs text-ink">
                  {metricLabel(row.key)}
                  {LOWER_IS_BETTER.has(row.key) && <span className="text-2xs text-ink-3"> · moins = mieux</span>}
                </span>
                <span className="text-2xs text-ink-3">
                  Écart{players.length > 2 ? ' max − min' : ''} : <span className="num font-semibold text-ink text-xs">{Math.round(row.spread)}</span> points de percentile
                </span>
              </div>
              <div className="relative h-1.5 mt-2 bg-raised rounded-sm" role="img"
                aria-label={players.map((p, i) => `${names[i]} P${Math.round(row.percentiles[i])}`).join(', ')}>
                {row.percentiles.map((v, i) => (
                  <span key={i} className="absolute top-1/2 w-2.5 h-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-surface"
                    style={{ left: `${Math.max(0, Math.min(100, v))}%`, backgroundColor: SERIES[i] }} aria-hidden />
                ))}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
                {players.map((p, i) => (
                  <span key={getPlayerSeasonId(p)} className="inline-flex items-center gap-1.5 text-2xs text-ink-2">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: SERIES[i] }} aria-hidden />
                    {names[i]} <PercentileValue value={row.percentiles[i]} />
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ol>
      )}
      {players.length >= 2 && notComparable.length > 0 && (
        <p className="text-2xs text-ink-3 mt-3 leading-relaxed">
          Non comparables (percentile absent pour au moins un joueur) : {notComparable.map(k => metricLabel(k)).join(', ')}.
        </p>
      )}
    </Panel>
  );
};

// ============================================
// PAGE
// ============================================

const PlayerComparison: React.FC<PlayerComparisonProps> = ({ data, onSelectPlayer, selectedId }) => {
  const [entries, setEntries] = useState<ComparisonEntry[]>(memory.entries);
  const [customMetrics, setCustomMetrics] = useState<string[] | null>(memory.customMetrics);
  const [viewMode, setViewMode] = useState<ViewMode>(memory.viewMode);
  const [showMetricConfig, setShowMetricConfig] = useState(false);
  const [metricSearch, setMetricSearch] = useState('');
  const [notice, setNotice] = useState('');

  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const metricsButtonRef = useRef<HTMLButtonElement>(null);
  const removeRefs = useRef(new Map<string, HTMLButtonElement>());
  const openRefs = useRef(new Map<string, HTMLButtonElement>());
  const tableRef = useRef<HTMLTableElement>(null);
  const pendingFocus = useRef<(() => void) | null>(null);

  // Lignes retrouvées dans la saison chargée ; une entrée absente est retirée et signalée
  const { players, missing } = useMemo(() => resolveSelection(entries, data), [entries, data]);
  useEffect(() => {
    if (missing.length === 0) return;
    setEntries(prev => prev.filter(e => !missing.some(m => m.id === e.id)));
    setNotice(`${missing.length} joueur${missing.length > 1 ? 's retirés' : ' retiré'} : absent${missing.length > 1 ? 's' : ''} des données de la saison chargée.`);
  }, [missing]);

  useEffect(() => { Object.assign(memory, { entries, customMetrics, viewMode }); }, [entries, customMetrics, viewMode]);

  // Défilement retrouvé au retour (conteneur défilant de la mise en page)
  useLayoutEffect(() => {
    const scroller = rootRef.current?.closest('.overflow-y-auto') as HTMLElement | null;
    if (!scroller) return;
    if (memory.scrollTop) scroller.scrollTop = memory.scrollTop;
    const onScroll = () => { memory.scrollTop = scroller.scrollTop; };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => scroller.removeEventListener('scroll', onScroll);
  }, []);

  // Focus rendu après un ajout ou un retrait (jamais sur le corps de la page)
  useEffect(() => { if (pendingFocus.current) { pendingFocus.current(); pendingFocus.current = null; } });

  const autoMetrics = useMemo(() => defaultComparisonMetrics(players), [players]);
  const metrics = customMetrics ?? autoMetrics;
  const names = useMemo(() => distinctNames(players, competitionName), [players]);
  const selectedIds = useMemo(() => new Set(entries.map(e => e.id)), [entries]);
  const hasTotals = metrics.some(isSeasonTotal);

  const addPlayer = (p: PlayerData) => {
    const { entries: next, status } = addEntry(entries, comparisonEntry(p));
    if (status !== 'added') return;
    setEntries(next);
    setNotice('');
    const id = getPlayerSeasonId(p);
    pendingFocus.current = () => (next.length < MAX_COMPARED ? inputRef.current?.focus() : (openRefs.current.get(id) ?? removeRefs.current.get(id))?.focus());
  };

  const removePlayer = (index: number) => {
    const next = entries.filter((_, i) => i !== index);
    setEntries(next);
    // Focus : carte suivante, sinon précédente, sinon recherche
    const target = next[index] ?? next[index - 1];
    pendingFocus.current = () => (target ? removeRefs.current.get(target.id)?.focus() : inputRef.current?.focus());
  };

  const toggleMetric = (key: string) => {
    setCustomMetrics(metrics.includes(key) ? metrics.filter(k => k !== key) : [...metrics, key]);
  };

  const removeMetric = (key: string) => {
    const remaining = metrics.filter(k => k !== key);
    const pos = metrics.indexOf(key);
    const nextKey = remaining[pos] ?? remaining[pos - 1];
    setCustomMetrics(remaining);
    pendingFocus.current = () => {
      const btn = nextKey ? tableRef.current?.querySelector<HTMLButtonElement>(`button[data-metric="${CSS.escape(nextKey)}"]`) : null;
      (btn ?? metricsButtonRef.current)?.focus();
    };
  };

  const closeMetricConfig = () => { setShowMetricConfig(false); metricsButtonRef.current?.focus(); };

  // Métriques proposées : présentes chez au moins un joueur choisi ; métriques gardien seulement avec un gardien
  const candidateMetrics = useMemo(() => {
    if (!showMetricConfig) return [];
    const hasGoalkeeper = players.some(p => p.Position === 'GK');
    const keys = new Set([...getMetricKeys(players), ...metrics]);
    return [...keys].filter(k => hasGoalkeeper || !GOALKEEPING.has(k) || metrics.includes(k));
  }, [showMetricConfig, players, metrics]);

  const modeSwitch = (
    <div className="sv-seg" role="group" aria-label="Affichage du tableau">
      <button onClick={() => setViewMode('raw')} className={`sv-seg-btn ${viewMode === 'raw' ? 'sv-seg-on' : ''}`} aria-pressed={viewMode === 'raw'}>Valeurs</button>
      <button onClick={() => setViewMode('percentile')} className={`sv-seg-btn ${viewMode === 'percentile' ? 'sv-seg-on' : ''}`} aria-pressed={viewMode === 'percentile'}>Percentiles</button>
    </div>
  );

  const search = metricSearch.trim().toLowerCase();
  const visibleCandidates = candidateMetrics.filter(k => !search || k.toLowerCase().includes(search) || metricLabel(k).toLowerCase().includes(search));

  return (
    <div ref={rootRef} className="p-5 space-y-4 animate-fade-in">
      <PageHeader
        title="Comparaison de joueurs"
        icon={ArrowLeftRight}
        description="Jusqu'à 4 joueurs de la saison chargée, sur les percentiles du pipeline : profil, principales différences et détail par métrique."
        actions={players.length > 0 && (
          <button ref={metricsButtonRef} onClick={() => setShowMetricConfig(v => !v)} aria-expanded={showMetricConfig} aria-controls="comparison-metrics"
            className={`sv-btn sv-btn-secondary ${showMetricConfig ? '!border-accent/60 !text-accent' : ''}`}>
            <Settings2 className="w-3.5 h-3.5" /> Métriques ({metrics.length})
          </button>
        )}
      />

      {/* Joueurs comparés : couleur fixe par emplacement */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        {players.map((p, idx) => {
          const id = getPlayerSeasonId(p);
          return (
            <PlayerSnapshot key={id} player={p} color={SERIES[idx]} viewed={id === selectedId}
              onRemove={() => removePlayer(idx)} onOpen={onSelectPlayer ? () => onSelectPlayer(p) : undefined}
              removeRef={el => { if (el) removeRefs.current.set(id, el); else removeRefs.current.delete(id); }}
              openRef={el => { if (el) openRefs.current.set(id, el); else openRefs.current.delete(id); }} />
          );
        })}
        {players.length < MAX_COMPARED && (
          <PlayerSearch framed inputRef={inputRef} selectedIds={selectedIds} onPick={addPlayer}
            label="Ajouter un joueur" labelRight={<span className="num normal-case tracking-normal font-normal text-ink-4">{players.length}/{MAX_COMPARED}</span>}
            duplicateMessage={p => `${p.Player} (${p.Team}, ${getPlayerSeasonTag(p)}) est déjà dans la comparaison.`}
            pickedMessage={p => `${p.Player} ajouté (${players.length + 1}/${MAX_COMPARED}).`} />
        )}
      </div>
      {notice && <p role="status" className="text-xs text-ink-3">{notice}</p>}

      {/* Choix des métriques, groupées par famille */}
      {showMetricConfig && players.length > 0 && (
        <div id="comparison-metrics" onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); closeMetricConfig(); } }}>
          <Panel title="Métriques comparées" subtitle="Cochez les métriques du profil, des différences et du tableau. Échap pour fermer."
            right={
              <>
                {customMetrics && (
                  <button onClick={() => setCustomMetrics(null)} className="sv-btn sv-btn-ghost sv-btn-sm">
                    <RotateCcw className="w-3.5 h-3.5" /> Métriques des postes
                  </button>
                )}
                <button onClick={closeMetricConfig} className="sv-icon-btn" aria-label="Fermer le choix des métriques"><X className="w-4 h-4" /></button>
              </>
            }>
            <div className="relative mb-3 max-w-sm">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-4 pointer-events-none" aria-hidden />
              <input type="text" autoFocus aria-label="Rechercher une métrique" placeholder="Rechercher une métrique" className="sv-input sv-input-sm pl-8"
                value={metricSearch} onChange={e => setMetricSearch(e.target.value)} />
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-x-6 gap-y-4 max-h-[24rem] overflow-y-auto pr-1">
              {groupMetrics(visibleCandidates).map(group => (
                <fieldset key={group.category.id} className="min-w-0">
                  <legend className="sv-label mb-1">{group.category.label}</legend>
                  {group.keys.map(key => (
                    <label key={key} className="flex items-start gap-2 py-1 text-xs cursor-pointer select-none">
                      <input type="checkbox" className="mt-0.5 shrink-0" checked={metrics.includes(key)} onChange={() => toggleMetric(key)} />
                      <span className={`leading-snug ${metrics.includes(key) ? 'text-ink' : 'text-ink-3'}`}>
                        {metricLabel(key)}
                        {isSeasonTotal(key) && <span className="text-ink-4"> · total</span>}
                        {LOWER_IS_BETTER.has(key) && <span className="text-ink-4"> · moins = mieux</span>}
                      </span>
                    </label>
                  ))}
                </fieldset>
              ))}
              {visibleCandidates.length === 0 && <p className="text-xs text-ink-3">Aucune métrique ne correspond.</p>}
            </div>
          </Panel>
        </div>
      )}

      {players.length === 0 ? (
        <div className="sv-panel">
          <EmptyState icon={Users} title="Choisissez 2 à 4 joueurs à comparer">
            Recherchez un joueur par son nom ou son club dans « Ajouter un joueur ». Vous obtiendrez son profil sur les métriques du poste,
            les principales différences de percentile et le détail métrique par métrique. Le même joueur peut figurer deux fois (autre club, compétition ou saison).
          </EmptyState>
        </div>
      ) : (
        <>
          <MethodNote players={players} names={names} hasTotals={hasTotals} />

          <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
            <ComparisonRadar players={players} names={names} metrics={metrics} />
            <Differences players={players} names={names} metrics={metrics} />
          </div>
          {/* Synthèse comparative IA ancrée : demande explicite, résultat non enregistré */}
          <GroundedAiPanel title="Synthèse comparative" resetKey={players.map(getPlayerSeasonId).join('|')}
            help="Gemini résume les différences entre les joueurs comparés à partir des seuls faits ScoutVision envoyés (percentiles, indices de rôle, valeurs, échantillon). Le serveur rejette tout nombre absent des faits, tout sujet non mesuré et tout verdict. Aucun score n'est calculé par le modèle."
            description="Quatre sections : profils, principales différences, complémentarité et contexte, points à vérifier en observation."
            disabled={players.length < 2} disabledReason="Ajoutez au moins deux joueurs pour obtenir une synthèse comparative."
            request={() => aiCompare(players.map(p => ({ row: p, bestRoles: rankPresets(p).map(r => ({ role: r.name, normalizedScore: r.index })) })), { framing: 'comparison', seasonInProgress: players.some(seasonInProgress) })} />

          <Panel flush icon={Table2} title="Détail des métriques"
            subtitle={viewMode === 'raw'
              ? 'Valeurs de la saison. Meilleure valeur en gras quand le sens de la métrique est connu ; « – » : donnée absente.'
              : 'Percentiles du pipeline, relatifs au groupe de chaque joueur (poste × niveau × saison) ; « – » : pas de percentile.'}
            right={<div className="hidden sm:block">{modeSwitch}</div>}>
            <div className="sm:hidden px-3 pt-3">{modeSwitch}</div>
            <div className="overflow-x-auto">
              <table ref={tableRef} className="sv-table">
                <caption className="sr-only">
                  Comparaison métrique par métrique ({viewMode === 'raw' ? 'valeurs' : 'percentiles du pipeline'}) de {players.map(p => p.Player).join(', ')}
                </caption>
                <thead>
                  <tr>
                    <th scope="col" className="sticky left-0 !z-20 !pl-3 sm:!pl-4 w-[7.25rem] min-w-[7.25rem] sm:w-auto sm:min-w-[14rem]">Métrique</th>
                    {players.map((p, i) => (
                      <th key={getPlayerSeasonId(p)} scope="col" className="text-right !h-auto py-2 align-bottom !px-2 sm:!px-3 min-w-[4.75rem] sm:min-w-[8.5rem] !whitespace-normal">
                        <span className="inline-flex items-start justify-end gap-1.5 normal-case tracking-normal text-xs font-medium text-ink">
                          <span className="w-2 h-2 rounded-full mt-1 shrink-0" style={{ backgroundColor: SERIES[i] }} aria-hidden />
                          <span className="sm:hidden">{names[i]}</span><span className="hidden sm:inline">{p.Player}</span>
                        </span>
                        <span className="block normal-case tracking-normal font-normal text-2xs text-ink-3 leading-snug">{p.Team} · {getPlayerSeasonTag(p)}</span>
                      </th>
                    ))}
                    <th scope="col" className="w-8 !pr-4"><span className="sr-only">Retirer une métrique</span></th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="group">
                    <th scope="row" className="sticky left-0 z-10 bg-surface group-hover:bg-raised px-2 !pl-3 sm:px-3 sm:!pl-4 py-1.5 border-b border-line/70 text-left text-xs font-normal text-ink-2">Minutes jouées</th>
                    {players.map(p => { const m = minutesOf(p); return <td key={getPlayerSeasonId(p)} className="text-right text-xs num text-ink-2 !px-2 sm:!px-3">{m !== null ? INTEGER.format(m) : '–'}</td>; })}
                    <td />
                  </tr>
                </tbody>
                {groupMetrics(metrics).map(group => (
                  <tbody key={group.category.id}>
                    <tr>
                      <th scope="rowgroup" colSpan={players.length + 2} className="px-3 !pl-4 pt-3 pb-1 text-left sv-label border-b border-line/70">
                        <span className="sticky left-4">{group.category.label}</span>
                      </th>
                    </tr>
                    {group.keys.map(key => {
                      const values = players.map(p => metricValue(p, key));
                      const best = viewMode === 'raw' ? bestValueIndices(values, metricDirection(key)) : [];
                      const total = isSeasonTotal(key);
                      return (
                        <tr key={key} className="group">
                          <th scope="row" className="sticky left-0 z-10 bg-surface group-hover:bg-raised px-2 !pl-3 sm:px-3 sm:!pl-4 py-1.5 border-b border-line/70 text-left text-xs font-normal text-ink-2 leading-snug">
                            {metricLabel(key)}
                            {total && <span className="text-2xs text-ink-3"> · total saison</span>}
                            {LOWER_IS_BETTER.has(key) && <span className="text-2xs text-ink-3"> · moins = mieux</span>}
                          </th>
                          {players.map((p, i) => {
                            const value = values[i];
                            const pct = percentileOf(p, key);
                            return (
                              <td key={getPlayerSeasonId(p)} className="text-right text-xs num whitespace-nowrap !px-2 sm:!px-3">
                                {viewMode === 'raw' ? (
                                  value === null ? <span className="text-ink-4" title="Donnée absente">–</span>
                                    : best.includes(i) ? (
                                      <span className="inline-flex items-center gap-1.5 font-semibold text-ink">
                                        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: SERIES[i] }} aria-hidden />
                                        {formatMetricValue(key, value)}<span className="sr-only"> (meilleure valeur)</span>
                                      </span>
                                    ) : <span className="text-ink-2">{formatMetricValue(key, value)}</span>
                                ) : pct === null
                                  ? <span className="text-ink-4" title={total ? 'Total de saison : pas de percentile dans le pipeline' : 'Pas de percentile pour ce joueur'}>–</span>
                                  : <PercentileValue value={pct} />}
                              </td>
                            );
                          })}
                          <td className="!pr-3">
                            <button data-metric={key} onClick={() => removeMetric(key)} aria-label={`Retirer la métrique ${metricLabel(key)}`}
                              className="sv-icon-btn !w-6 !h-6 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:!text-neg">
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                ))}
              </table>
              {metrics.length === 0 && (
                <EmptyState title="Aucune métrique choisie">
                  {players.some(p => p.Position) ? 'Utilisez « Métriques » pour en ajouter.' : 'Poste inconnu : choisissez les métriques avec « Métriques ».'}
                </EmptyState>
              )}
            </div>
          </Panel>
        </>
      )}
    </div>
  );
};

export default PlayerComparison;
