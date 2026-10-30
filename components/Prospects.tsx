/**
 * ScoutVision - Chasseur de pépites
 * Profil recherché → contraintes → entonnoir → résultats → décomposition de l'indice → fiche.
 * Filtrage : utils/prospects.ts ; indice et décomposition : utils/rolePresets.ts (roleIndex,
 * roleIndexBreakdown), le même calcul que la fiche joueur.
 */

import React, { useState, useMemo, useEffect, useLayoutEffect, useRef } from 'react';
import { PlayerData, TeamStats, extractSeason, getPlayerSeasonId, getPlayerSeasonTag, getSeasonLabel } from '../types';
import {
  RolePreset, DEFAULT_ROLE_PRESETS, ROLE_CATEGORIES, MIDFIELD_PROFILE_BONUS, ROLE_CORE_WEIGHT, roleIndex, roleIndexBreakdown,
} from '../utils/rolePresets';
import {
  DEFAULT_CONSTRAINTS, ESTIMATE_RATIO_MIN, ProspectConstraints, filterProspects, seasonCapabilities, effectiveThresholds,
} from '../utils/prospects';
import {
  POSITIONS, THRESHOLD_MAX, loadCustomPresets, parseThreshold, presetNameError, saveCustomPresets,
} from '../utils/customPresets';
import { isSeasonInProgress, roleIndexHelp, PIPELINE_PERCENTILE_HELP } from '../utils/sampleContext';
import {
  Gem, Plus, Minus, RotateCcw, Save, Trash2, X, Download, Star, Eye, ListTree, SlidersHorizontal, ChevronDown, Search, ArrowRight,
} from 'lucide-react';
import { exportProspects } from '../utils/exportUtils';
import { metricLabel, positionLabel, positionName } from '../utils/labels';
import { getWatchlist, addToWatchlist, removeFromWatchlist } from '../services/storageService';
import { dataLoader } from '../services/dataLoader';
import { TeamLine, PlayerAvatar } from './Media';
import { Panel, EmptyState, InfoTip, IndexBar, PercentileValue } from './ui';
import { isRowActivation } from '../utils/rowKeys';
import { formatEuro } from '../utils/format';
import { adaptiveMinutes, progressLabel, seasonProgress } from '../utils/seasonProgress';
import { FilterData, HunterFilters, consumeSharedFilters } from '../utils/savedFilters';
import { SavedFiltersMenu } from './filters/SavedFiltersMenu';
import { HunterAssistant } from './ai/HunterAssistant';
import { HunterCatalogue, HunterConfig } from '../services/groundedAiService';

interface ProspectsProps {
  data: PlayerData[];
  teamStats?: TeamStats[];           // équipes de la saison chargée : avancée de la saison (seuil de minutes)
  onSelectPlayer: (player: PlayerData) => void;
  selectedId?: string;               // dernier joueur consulté, mis en évidence au retour
}

// Recherche retrouvée au retour d'une fiche ou après un changement de saison
const memory = {
  role: '',
  strictness: 1,
  constraints: { ...DEFAULT_CONSTRAINTS } as ProspectConstraints,
  constraintsOpen: false,
  scrollTop: 0,
  pageScrollTop: 0,
  signature: '',
};

const VALUE_OPTIONS = [1, 2, 5, 10, 15, 20, 30, 50, 75, 100].map(m => m * 1_000_000);
const CONTRACT_OPTIONS = [0, 6, 12, 18, 24];
const STRICTNESS_STEP = 0.1;

const fr = (v: number, digits: number) => v.toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits });

const shortMetric = (key: string) => metricLabel(key).replace(/ par 90$/, ' /90').replace(/, %$/, ' %');

// Valeur brute d'une métrique : par 90 et pourcentages avec leur unité, format français
const formatRaw = (key: string, v: unknown) => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '–';
  if (key.endsWith(', %')) return `${fr(v, 1)} %`;
  if (key.endsWith(' per 90')) return `${fr(v, 2)} /90`;
  return fr(v, 2);
};

const contractLabel = (c?: string) => (c ? c.slice(0, 7).split('-').reverse().join('/') : undefined);

// Postes d'un rôle : « DM, CM »
const positionsText = (preset: RolePreset) => preset.positions.map(positionLabel).join(', ');

const Prospects: React.FC<ProspectsProps> = ({ data, teamStats = [], onSelectPlayer, selectedId }) => {
  // Réglages reçus par un lien de partage : appliqués une fois, avant la mémoire de la page
  const [shared] = useState(() => consumeSharedFilters('hunter'));
  // ---------- Rôles : officiels (rolePresets.json) et personnalisés (navigateur) ----------
  const [customPresets, setCustomPresets] = useState<Record<string, RolePreset>>(() => loadCustomPresets(DEFAULT_ROLE_PRESETS));
  const presets = useMemo(() => ({ ...DEFAULT_ROLE_PRESETS, ...customPresets }), [customPresets]);
  const [roleName, setRoleName] = useState<string>(shared && presets[shared.role] ? shared.role : presets[memory.role] ? memory.role : '');
  const [strictness, setStrictness] = useState<number>(shared?.strictness ?? memory.strictness);
  const preset: RolePreset | undefined = roleName ? presets[roleName] : undefined;

  // ---------- Contraintes ----------
  const caps = useMemo(() => seasonCapabilities(data), [data]);
  const competitions = useMemo(() => {
    const keys = Array.from(new Set(data.map(p => p.Competition).filter((c): c is string => typeof c === 'string' && c !== '')));
    return keys
      .map(key => ({ key, info: dataLoader.getCompetition(key) }))
      .sort((a, b) => (a.info?.tier ?? 9) - (b.info?.tier ?? 9) || (a.info?.name ?? a.key).localeCompare(b.info?.name ?? b.key, 'fr'));
  }, [data]);
  const [constraints, setConstraints] = useState<ProspectConstraints>(() => ({
    ...(shared?.constraints ?? memory.constraints),
    // Compétition absente de la saison chargée : toutes
    competition: competitions.some(c => c.key === (shared?.constraints ?? memory.constraints).competition) ? (shared?.constraints ?? memory.constraints).competition : '',
  }));
  const [constraintsOpen, setConstraintsOpen] = useState(memory.constraintsOpen);
  const [detailsOpen, setDetailsOpen] = useState(false);     // critères du rôle, sur téléphone
  const setConstraint = <K extends keyof ProspectConstraints>(key: K, value: ProspectConstraints[K]) =>
    setConstraints(prev => ({ ...prev, [key]: value }));

  useEffect(() => {
    Object.assign(memory, { role: roleName, strictness, constraints, constraintsOpen });
  }, [roleName, strictness, constraints, constraintsOpen]);

  // ---------- Saison ----------
  const seasons = useMemo(() => Array.from(new Set(data.map(p => extractSeason(p.League)))), [data]);
  const multiSeason = seasons.length > 1;
  const seasonText = seasons.length === 1 ? getSeasonLabel(seasons[0]) : 'Toutes les saisons';
  const dataIndex = dataLoader.getCachedIndex();
  const latestSeason = dataIndex?.seasons[dataIndex.seasons.length - 1]?.id;
  const inProgress = seasons.length === 1 && seasons[0] === latestSeason && isSeasonInProgress(seasons[0], seasons[0], dataIndex?.generatedAt);
  const generatedOn = dataIndex?.generatedAt ? new Date(dataIndex.generatedAt).toLocaleDateString('fr-FR') : '—';

  // ---------- Seuil de minutes adapté à l'avancée de la saison ----------
  const progress = useMemo(() => (inProgress
    ? seasonProgress({ season: seasons[0], seasonLabel: constraints.competition ? String(data.find(p => p.Competition === constraints.competition)?.Season ?? '') || undefined : undefined, generatedAt: dataIndex?.generatedAt, teams: teamStats, competition: constraints.competition || undefined })
    : { progress: 1, basis: 'complete' as const }), [inProgress, seasons, data, dataIndex?.generatedAt, teamStats, constraints.competition]);
  const suggestedMinutes = adaptiveMinutes(DEFAULT_CONSTRAINTS.minutesMin, progress.progress);
  const minutesAdjusted = inProgress && constraints.minutesMin === suggestedMinutes && suggestedMinutes !== DEFAULT_CONSTRAINTS.minutesMin;
  // Première ouverture d'une saison en cours : le seuil de base (500 min) devient le seuil adapté ; un seuil choisi n'est jamais écrasé
  const adjustedFor = useRef<string | null>(null);
  useEffect(() => {
    const key = `${seasons[0] ?? ''}|${inProgress}|${shared ? 'partage' : 'memoire'}`;
    if (adjustedFor.current === key) return;
    adjustedFor.current = key;
    if (inProgress && !shared && constraints.minutesMin === DEFAULT_CONSTRAINTS.minutesMin && suggestedMinutes !== DEFAULT_CONSTRAINTS.minutesMin) setConstraint('minutesMin', suggestedMinutes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seasons, inProgress, suggestedMinutes]);
  const resetConstraints = () => setConstraints({ ...DEFAULT_CONSTRAINTS, minutesMin: inProgress ? suggestedMinutes : DEFAULT_CONSTRAINTS.minutesMin });

  // ---------- Filtres enregistrés et lien de partage ----------
  const currentFilters: FilterData = { page: 'hunter', data: { role: roleName, strictness, constraints } };
  const applySavedFilters = (d: HunterFilters) => {
    if (d.role && presets[d.role]) setRoleName(d.role);
    setStrictness(d.strictness);
    setConstraints({ ...d.constraints, competition: competitions.some(c => c.key === d.constraints.competition) ? d.constraints.competition : '' });
  };

  // ---------- Recherche ----------
  const search = useMemo(
    () => (preset ? filterProspects(data, preset, strictness, constraints, caps) : null),
    [data, preset, strictness, constraints, caps],
  );
  const rows = useMemo(() => (search && preset
    ? search.players.map((player, i) => ({ player, rank: i + 1, index: roleIndex(player, preset), id: getPlayerSeasonId(player) }))
    : []), [search, preset]);
  const thresholdKeys = search ? Object.keys(search.thresholds) : [];

  // ---------- Liste de suivi ----------
  const [watchlistIds, setWatchlistIds] = useState<Set<string>>(new Set());
  useEffect(() => { setWatchlistIds(new Set(getWatchlist().map(w => getPlayerSeasonId(w.player)))); }, [data]);
  const toggleWatchlist = (player: PlayerData, e: React.MouseEvent) => {
    e.stopPropagation();
    const id = getPlayerSeasonId(player);
    if (watchlistIds.has(id)) {
      removeFromWatchlist(player);
      setWatchlistIds(prev => { const next = new Set(prev); next.delete(id); return next; });
    } else {
      addToWatchlist(player);
      setWatchlistIds(prev => new Set(prev).add(id));
    }
  };

  // ---------- Décomposition de l'indice (une ligne ouverte à la fois) ----------
  const [expanded, setExpanded] = useState<string | null>(null);

  // ---------- Défilement : conservé au retour d'une fiche, remis à zéro si la recherche change ----------
  const scrollRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const signature = JSON.stringify([roleName, strictness, constraints, data.length]);
  useEffect(() => {
    if (memory.signature === signature) return;
    memory.signature = signature;
    memory.scrollTop = 0;
    scrollRef.current?.scrollTo({ top: 0 });
    setExpanded(null);
  }, [signature]);
  useLayoutEffect(() => {
    if (scrollRef.current && memory.scrollTop) scrollRef.current.scrollTop = memory.scrollTop;
    if (pageRef.current && memory.pageScrollTop) pageRef.current.scrollTop = memory.pageScrollTop;
  }, []);

  // ---------- Création d'un rôle personnalisé ----------
  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftPositions, setDraftPositions] = useState<string[]>([]);
  const [draftMetrics, setDraftMetrics] = useState<{ key: string; raw: string }[]>([]);
  const [metricSearch, setMetricSearch] = useState('');
  const availableMetrics = useMemo(() => {
    const keys = new Set<string>();
    data.slice(0, 800).forEach(p => Object.keys(p).forEach(k => { if (k.endsWith(' pct')) keys.add(k.slice(0, -4)); }));
    return Array.from(keys).sort((a, b) => metricLabel(a).localeCompare(metricLabel(b), 'fr'));
  }, [data]);
  const nameError = draftName ? presetNameError(draftName, DEFAULT_ROLE_PRESETS, Object.keys(customPresets)) : null;
  const draftValues = draftMetrics.map(m => ({ key: m.key, value: parseThreshold(m.raw) }));
  const draftValid = !!draftName && !nameError && draftPositions.length > 0 && draftValues.length > 0 && draftValues.every(m => m.value !== null);

  const saveDraft = () => {
    if (!draftValid) return;
    const metrics: Record<string, number> = {};
    draftValues.forEach(m => { metrics[m.key] = m.value as number; });
    const name = draftName.trim();
    const next = { ...customPresets, [name]: { positions: draftPositions, metrics, custom: true } };
    setCustomPresets(next);
    saveCustomPresets(next);
    setRoleName(name);
    setStrictness(1);
    setCreating(false);
    setDraftName(''); setDraftPositions([]); setDraftMetrics([]);
  };

  const deleteCustom = (name: string) => {
    const next = { ...customPresets };
    delete next[name];
    setCustomPresets(next);
    saveCustomPresets(next);
    if (roleName === name) setRoleName('');
  };

  const chooseRole = (name: string) => {
    setRoleName(name);
    setStrictness(1);
  };

  // ---------- Contraintes actives (puces) ----------
  const chips: { key: string; label: string; onRemove?: () => void }[] = [
    { key: 'age', label: `≤ ${constraints.ageMax} ans` },
    { key: 'min', label: `≥ ${constraints.minutesMin.toLocaleString('fr-FR')} min${minutesAdjusted ? ' · ajusté à la saison' : ''}` },
    ...(caps.marketValue && constraints.valueMax !== null
      ? [{ key: 'value', label: `Valeur ≤ ${formatEuro(constraints.valueMax)}`, onRemove: () => setConstraint('valueMax', null) }] : []),
    ...(caps.contract && constraints.contractMonths > 0
      ? [{ key: 'contract', label: `Contrat ≤ ${constraints.contractMonths} mois`, onRemove: () => setConstraint('contractMonths', 0) }] : []),
    ...(constraints.competition
      ? [{ key: 'comp', label: dataLoader.getCompetition(constraints.competition)?.name ?? constraints.competition, onRemove: () => setConstraint('competition', '') }] : []),
    ...(caps.estimate && constraints.estimateAboveMarket
      ? [{ key: 'estimate', label: `Estimation ≥ ${fr(ESTIMATE_RATIO_MIN * 100, 0)} % du marché`, onRemove: () => setConstraint('estimateAboveMarket', false) }] : []),
  ];
  const marketHelp = caps.marketValue ? null
    : 'Indisponible pour cette saison : la valeur de marché, le contrat et l\'estimation viennent de l\'instantané Transfermarkt actuel, qui ne couvre que la saison en cours.';

  // ---------- Rendu : profil recherché ----------
  const thresholds = preset ? effectiveThresholds(preset, strictness) : {};
  const breakdownWeights = preset ? Object.entries(preset.weights ?? {}) : [];

  // ---------- Assistant IA : demande en langage naturel → filtres (appliqués seulement sur clic, puis modifiables) ----------
  const hunterCatalogue = useMemo<HunterCatalogue>(() => ({
    positions: [...new Set(Object.values(presets).flatMap(p => p.positions))],
    roles: Object.entries(presets).filter(([, p]) => p.category !== 'sp').map(([name, p]) => ({ name, positions: p.positions, ...(p.category ? { category: p.category } : {}), ...(p.description ? { description: p.description } : {}) })),
    metrics: availableMetrics.map(key => ({ key, label: metricLabel(key) })),
    competitions: competitions.map(c => ({ key: c.key, name: c.info?.name ?? c.key })),
    capabilities: caps,
  }), [presets, availableMetrics, competitions, caps]);
  const applyAiConfig = (config: HunterConfig) => {
    if (config.role && presets[config.role]) chooseRole(config.role);
    setConstraints(prev => ({
      ...prev,
      ...(config.ageMax !== undefined ? { ageMax: config.ageMax } : {}),
      ...(config.minutesMin !== undefined ? { minutesMin: config.minutesMin } : {}),
      ...(config.valueMax !== undefined && caps.marketValue ? { valueMax: config.valueMax } : {}),
      ...(config.contractMonths !== undefined && caps.contract ? { contractMonths: config.contractMonths } : {}),
      ...(config.estimateAboveMarket !== undefined && caps.estimate ? { estimateAboveMarket: config.estimateAboveMarket } : {}),
      ...(config.competition !== undefined ? { competition: config.competition } : {}),
    }));
    // Critères supplémentaires : rôle personnalisé créé à partir du rôle choisi (seuils visibles et modifiables comme les autres)
    if (config.extraCriteria.length) {
      const base = config.role && presets[config.role] ? presets[config.role] : undefined;
      const positions = base?.positions ?? (config.position ? [config.position] : []);
      if (positions.length) {
        const metrics: Record<string, number> = { ...(base?.metrics ?? {}) };
        config.extraCriteria.forEach(c => { metrics[c.metric] = c.minPercentile; });
        const stem = `IA · ${config.role ?? positionLabel(positions[0])}`;
        let name = stem;
        for (let i = 2; presets[name]; i++) name = `${stem} ${i}`;
        const next = { ...customPresets, [name]: { positions, metrics, custom: true, description: 'Rôle proposé par l\'assistant IA, à partir de votre demande.' } };
        setCustomPresets(next);
        saveCustomPresets(next);
        setRoleName(name);
        setStrictness(1);
      }
    }
  };

  const profile = (
    <Panel title="Profil recherché" icon={Gem} className="min-w-0"
      right={!creating && (
        <button onClick={() => setCreating(true)} className="sv-btn sv-btn-ghost sv-btn-sm !h-6 !px-1.5"><Plus className="w-3 h-3" /> Créer un rôle</button>
      )}>
      <div className="mb-2"><HunterAssistant catalogue={hunterCatalogue} onApply={applyAiConfig} /></div>
      <label className="block">
        <span className="sr-only">Rôle recherché</span>
        <select className="sv-select w-full" value={roleName} onChange={e => chooseRole(e.target.value)} aria-label="Rôle recherché">
          <option value="">Choisir un rôle…</option>
          {ROLE_CATEGORIES.map(cat => {
            const names = Object.entries(DEFAULT_ROLE_PRESETS).filter(([, p]) => p.category === cat.key).map(([n]) => n);
            return names.length === 0 ? null : (
              <optgroup key={cat.key} label={cat.label}>
                {names.map(n => <option key={n} value={n}>{n}</option>)}
              </optgroup>
            );
          })}
          {Object.keys(customPresets).length > 0 && (
            <optgroup label="Mes rôles">
              {Object.keys(customPresets).map(n => <option key={n} value={n}>{n}</option>)}
            </optgroup>
          )}
        </select>
      </label>

      {preset && (
        <div className="mt-3 space-y-3">
          <div>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-ink">{roleName}</div>
                <div className="flex flex-wrap items-center gap-1 mt-1">
                  {preset.positions.map(p => <span key={p} className="sv-tag" title={positionName(p)}>{positionLabel(p)}</span>)}
                  {preset.custom && <span className="sv-tag !font-normal text-ink-3">Personnalisé</span>}
                </div>
              </div>
              {preset.custom && (
                <button onClick={() => deleteCustom(roleName)} className="sv-icon-btn hover:!text-neg" data-tip="Supprimer ce rôle" data-tip-pos="left" aria-label="Supprimer ce rôle personnalisé">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            {preset.description && <p className="text-xs text-ink-3 mt-1.5 leading-relaxed">{preset.description}</p>}
          </div>

          {/* Exigence : multiplicateur des seuils, montré par ses effets */}
          <div className="flex items-center justify-between gap-2">
            <span className="sv-label flex items-center gap-1">Exigence
              <InfoTip text={`Multiplie les seuils de base : à 90 %, P70 devient P63 (arrondi, plafonné à P${THRESHOLD_MAX}). Les critères de classement ne changent pas.`} />
            </span>
            <div className="flex items-center gap-1">
              <button onClick={() => setStrictness(s => Math.max(0.1, Number((s - STRICTNESS_STEP).toFixed(1))))} className="sv-icon-btn !w-7 !h-7 border border-line"
                data-tip="Seuils × 0,9" aria-label="Baisser l'exigence de 10 %"><Minus className="w-3 h-3" /></button>
              <span className="w-12 text-center text-xs font-semibold text-ink num" aria-live="polite">{Math.round(strictness * 100)} %</span>
              <button onClick={() => setStrictness(s => Number((s + STRICTNESS_STEP).toFixed(1)))} className="sv-icon-btn !w-7 !h-7 border border-line"
                data-tip="Seuils × 1,1" aria-label="Relever l'exigence de 10 %"><Plus className="w-3 h-3" /></button>
              <button onClick={() => setStrictness(1)} disabled={strictness === 1} className="sv-icon-btn !w-7 !h-7 disabled:opacity-30"
                data-tip="Seuils de base" data-tip-pos="left" aria-label="Revenir aux seuils de base"><RotateCcw className="w-3 h-3" /></button>
            </div>
          </div>

          {/* Critères : toujours visibles sur grand écran, repliables sur téléphone */}
          <button onClick={() => setDetailsOpen(o => !o)} aria-expanded={detailsOpen}
            className="lg:hidden w-full flex items-center justify-between gap-2 min-h-7 py-1 px-2 rounded border border-line text-xs text-ink-2 text-left">
            <span>Critères du rôle · {Object.keys(preset.metrics).length} éliminatoires, {breakdownWeights.length} de classement</span>
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${detailsOpen ? 'rotate-180' : ''}`} />
          </button>
          <div className={`${detailsOpen ? '' : 'hidden'} lg:block space-y-3`}>
          <div>
            <div className="sv-label flex items-center justify-between pb-1 border-b border-line-strong">
              <span className="flex items-center gap-1">Critères éliminatoires
                <InfoTip text={`Percentile minimum (${PIPELINE_PERCENTILE_HELP.split('\n')[0].replace('Percentile (0-100) ', '')}) Un percentile absent rend le joueur non éligible : il est compté à part, en données insuffisantes.`} />
              </span>
              <span className="normal-case tracking-normal font-normal">seuil</span>
            </div>
            {Object.entries(preset.metrics).map(([key, base]) => (
              <div key={key} className="flex items-center justify-between gap-2 h-7 border-b border-line/60 text-xs">
                <span className="text-ink-2 truncate" title={metricLabel(key)}>{metricLabel(key)}</span>
                <span className="num shrink-0">
                  {strictness !== 1 && <span className="text-ink-4">P{fr(base, 0)} → </span>}
                  <span className="text-ink font-semibold">≥ P{thresholds[key]}</span>
                </span>
              </div>
            ))}
          </div>

          {(breakdownWeights.length > 0 || preset.midfieldProfiles) && (
            <div>
              <div className="sv-label flex items-center justify-between pb-1 border-b border-line-strong">
                <span className="flex items-center gap-1">Critères de classement
                  <InfoTip text={roleIndexHelp(ROLE_CORE_WEIGHT, MIDFIELD_PROFILE_BONUS)} />
                </span>
                <span className="normal-case tracking-normal font-normal">poids</span>
              </div>
              {Object.keys(preset.metrics).filter(k => !(k in (preset.weights ?? {}))).length > 0 && (
                <div className="flex items-center justify-between gap-2 h-7 border-b border-line/60 text-xs">
                  <span className="text-ink-3">Critères éliminatoires</span>
                  <span className="text-ink-2 num">×{fr(ROLE_CORE_WEIGHT, 1)}</span>
                </div>
              )}
              {breakdownWeights.map(([key, w]) => (
                <div key={key} className="flex items-center justify-between gap-2 h-7 border-b border-line/60 text-xs">
                  <span className="text-ink-2 truncate" title={metricLabel(key)}>{metricLabel(key)}</span>
                  <span className="text-ink-2 num shrink-0">{w < 0 ? <span data-tip="Moins c'est mieux : compté 100 − percentile" data-tip-pos="left">×{fr(Math.abs(w), 1)} inversé</span> : `×${fr(w, 1)}`}</span>
                </div>
              ))}
              {preset.midfieldProfiles && (
                <div className="flex items-center justify-between gap-2 h-7 text-xs">
                  <span className="text-ink-3 truncate">Bonus profil de milieu : {preset.midfieldProfiles.join(', ')}</span>
                  <span className="text-ink-2 num shrink-0">+{MIDFIELD_PROFILE_BONUS}</span>
                </div>
              )}
            </div>
          )}
          </div>
        </div>
      )}
      {!preset && <p className="text-2xs text-ink-4 mt-2 leading-relaxed">Chaque rôle élimine sur des seuils de percentile, puis classe par indice du rôle.</p>}
    </Panel>
  );

  // ---------- Rendu : création d'un rôle (action secondaire) ----------
  const creator = creating && (
    <Panel title="Nouveau rôle" icon={Plus} right={
      <button onClick={() => setCreating(false)} className="sv-icon-btn" aria-label="Fermer"><X className="w-3.5 h-3.5" /></button>
    }>
      <div className="space-y-3">
        <label className="block">
          <span className="sv-label">Nom</span>
          <input type="text" className="sv-input sv-input-sm mt-1" placeholder="ex. Défenseur relanceur gaucher" maxLength={60}
            value={draftName} onChange={e => setDraftName(e.target.value)} aria-invalid={!!nameError} />
          {nameError && <span className="block text-2xs text-warn mt-1">{nameError}</span>}
        </label>
        <div>
          <span className="sv-label">Postes</span>
          <div className="flex flex-wrap gap-1 mt-1">
            {POSITIONS.map(pos => (
              <button key={pos} onClick={() => setDraftPositions(prev => (prev.includes(pos) ? prev.filter(p => p !== pos) : [...prev, pos]))}
                className={`sv-chip !h-6 !px-2 ${draftPositions.includes(pos) ? 'sv-chip-on' : ''}`} aria-pressed={draftPositions.includes(pos)} title={positionName(pos)}>
                {positionLabel(pos)}
              </button>
            ))}
          </div>
        </div>
        <div>
          <span className="sv-label">Seuils (percentile minimum, 0-{THRESHOLD_MAX})</span>
          <div className="relative mt-1 mb-2">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-ink-4" aria-hidden />
            <input type="text" className="sv-input sv-input-sm pl-7" placeholder="Ajouter une métrique" value={metricSearch} onChange={e => setMetricSearch(e.target.value)} />
            {metricSearch && (
              <div className="sv-menu absolute top-full left-0 right-0 mt-1 max-h-40 overflow-y-auto z-20">
                {availableMetrics
                  .filter(k => !draftMetrics.some(m => m.key === k) && (k.toLowerCase().includes(metricSearch.toLowerCase()) || metricLabel(k).toLowerCase().includes(metricSearch.toLowerCase())))
                  .map(k => (
                    <button key={k} onClick={() => { setDraftMetrics(prev => [...prev, { key: k, raw: '60' }]); setMetricSearch(''); }} className="sv-menu-item !text-xs">{metricLabel(k)}</button>
                  ))}
              </div>
            )}
          </div>
          <div className="space-y-1">
            {draftMetrics.map(m => {
              const invalid = parseThreshold(m.raw) === null;
              return (
                <div key={m.key} className="flex items-center gap-1.5">
                  <button onClick={() => setDraftMetrics(prev => prev.filter(x => x.key !== m.key))} className="sv-icon-btn !w-5 !h-5 hover:!text-neg" aria-label={`Retirer ${metricLabel(m.key)}`}><X className="w-3 h-3" /></button>
                  <span className="text-xs text-ink-2 truncate flex-1" title={metricLabel(m.key)}>{metricLabel(m.key)}</span>
                  <input type="number" min={0} max={THRESHOLD_MAX} step={1} inputMode="numeric" aria-invalid={invalid}
                    className={`sv-input sv-input-sm !w-16 text-right ${invalid ? '!border-warn' : ''}`} value={m.raw}
                    onChange={e => setDraftMetrics(prev => prev.map(x => (x.key === m.key ? { ...x, raw: e.target.value } : x)))}
                    onBlur={() => { const v = parseThreshold(m.raw); if (v !== null) setDraftMetrics(prev => prev.map(x => (x.key === m.key ? { ...x, raw: String(v) } : x))); }}
                    aria-label={`Seuil ${metricLabel(m.key)}`} />
                </div>
              );
            })}
          </div>
        </div>
        <button onClick={saveDraft} disabled={!draftValid} className="sv-btn sv-btn-primary sv-btn-sm w-full">
          <Save className="w-3.5 h-3.5" /> Enregistrer le rôle
        </button>
        <p className="text-2xs text-ink-4 leading-relaxed">Enregistré dans ce navigateur. L'indice d'un rôle personnalisé est la moyenne de ses critères (même calcul que les rôles officiels).</p>
      </div>
    </Panel>
  );

  // ---------- Rendu : contraintes ----------
  const constraintControls = (
    <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
      <label className="flex flex-col gap-1">
        <span className="sv-label">Âge max</span>
        <input type="number" min={16} max={40} className="sv-input sv-input-sm !w-20" value={constraints.ageMax}
          onChange={e => { const v = Number(e.target.value); if (Number.isFinite(v) && v > 0) setConstraint('ageMax', Math.round(v)); }} aria-label="Âge maximum" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="sv-label flex items-center gap-1">Minutes min{inProgress && (
          <InfoTip text={`Saison en cours : ${progressLabel(progress) ?? 'avancée inconnue'}. Le seuil de pleine saison (${DEFAULT_CONSTRAINTS.minutesMin} min) est ramené à ${suggestedMinutes} min pour ne pas exclure les joueurs qui ont joué toutes les journées déjà disputées. Vous pouvez le modifier.`} />
        )}</span>
        <input type="number" min={0} max={5000} step={100} className="sv-input sv-input-sm !w-24" value={constraints.minutesMin}
          onChange={e => { const v = Number(e.target.value); if (Number.isFinite(v) && v >= 0) setConstraint('minutesMin', Math.round(v)); }} aria-label="Minutes minimum" />
        {inProgress && !minutesAdjusted && constraints.minutesMin !== suggestedMinutes && (
          <button type="button" className="sv-btn sv-btn-ghost sv-btn-sm !h-6 !px-1.5" onClick={e => { setConstraint('minutesMin', suggestedMinutes); (e.currentTarget.parentElement?.querySelector('input') as HTMLInputElement | null)?.focus(); }}>Ajuster à la saison ({suggestedMinutes} min)</button>
        )}
      </label>
      <label className="flex flex-col gap-1">
        <span className="sv-label flex items-center gap-1">Valeur max {marketHelp
          ? <InfoTip text={marketHelp} />
          : <InfoTip text="Valeur Transfermarkt actuelle. Avec une limite, un joueur sans valeur connue est exclu (et compté à part) ; « Sans limite » le garde." />}</span>
        <select className="sv-select sv-select-sm" disabled={!caps.marketValue} value={constraints.valueMax ?? ''}
          onChange={e => setConstraint('valueMax', e.target.value === '' ? null : Number(e.target.value))} aria-label="Valeur de marché maximum">
          <option value="">Sans limite</option>
          {VALUE_OPTIONS.map(v => <option key={v} value={v}>≤ {formatEuro(v)}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="sv-label flex items-center gap-1">Contrat {!caps.contract && <InfoTip text={marketHelp ?? 'Indisponible pour cette saison.'} />}</span>
        <select className="sv-select sv-select-sm" disabled={!caps.contract} value={constraints.contractMonths}
          onChange={e => setConstraint('contractMonths', Number(e.target.value))} aria-label="Fin de contrat">
          {CONTRACT_OPTIONS.map(m => <option key={m} value={m}>{m === 0 ? 'Indifférent' : `Fin sous ${m} mois`}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1 min-w-0">
        <span className="sv-label">Compétition</span>
        <select className="sv-select sv-select-sm max-w-[12rem]" value={constraints.competition}
          onChange={e => setConstraint('competition', e.target.value)} aria-label="Compétition">
          <option value="">Toutes</option>
          {competitions.map(c => <option key={c.key} value={c.key}>{c.info?.name ?? c.key}</option>)}
        </select>
      </label>
      <label className={`flex items-center gap-2 h-7 text-xs ${caps.estimate ? 'text-ink-2 cursor-pointer' : 'text-ink-4'}`}>
        <input type="checkbox" disabled={!caps.estimate} checked={caps.estimate && constraints.estimateAboveMarket}
          onChange={e => setConstraint('estimateAboveMarket', e.target.checked)} />
        Estimation ≥ {fr(ESTIMATE_RATIO_MIN * 100, 0)} % du marché
        <InfoTip text={caps.estimate
          ? 'Estimation statistique du pipeline (régression ridge hors échantillon) au moins égale à 1,5 fois la valeur Transfermarkt. Une piste à examiner, pas un verdict sur le prix.'
          : marketHelp ?? 'Indisponible pour cette saison.'} />
      </label>
      <SavedFiltersMenu current={currentFilters} onApply={d => applySavedFilters(d as HunterFilters)} size="sm" />
      <button onClick={resetConstraints} className="sv-btn sv-btn-ghost sv-btn-sm" data-tip={`U23, ≤ €30M, ≥ ${inProgress ? suggestedMinutes : DEFAULT_CONSTRAINTS.minutesMin} min`}>
        <RotateCcw className="w-3 h-3" /> Réinitialiser
      </button>
    </div>
  );

  // ---------- Rendu : entonnoir ----------
  const f = search?.funnel;
  const funnel = f && (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-3" aria-label="Entonnoir de sélection">
      <span><span className="text-ink-2 font-semibold num">{f.total.toLocaleString('fr-FR')}</span> joueurs</span>
      <ArrowRight className="w-3 h-3 text-ink-4" aria-hidden />
      <span><span className="text-ink-2 font-semibold num">{f.position.toLocaleString('fr-FR')}</span> compatibles avec le poste</span>
      <ArrowRight className="w-3 h-3 text-ink-4" aria-hidden />
      <span><span className="text-ink-2 font-semibold num">{f.constraints.toLocaleString('fr-FR')}</span> après contraintes</span>
      <ArrowRight className="w-3 h-3 text-ink-4" aria-hidden />
      <span><span className="text-accent font-semibold num">{f.eligible.toLocaleString('fr-FR')}</span> répondent aux critères du rôle</span>
      {(f.insufficientData > 0 || f.noMarketValue > 0) && <span className="text-ink-4" aria-hidden>·</span>}
      {f.insufficientData > 0 && (
        <span className="inline-flex items-center gap-1 text-ink-3">
          <span className="num">{f.insufficientData.toLocaleString('fr-FR')}</span> données insuffisantes
          <InfoTip text="Joueurs retenus par les contraintes, sans percentile connu sous un seuil, mais auxquels il manque au moins un percentile éliminatoire (statistique non couverte). Non éligibles ; ce n'est pas un P0." />
        </span>
      )}
      {f.noMarketValue > 0 && (
        <span className="inline-flex items-center gap-1 text-ink-3">
          <span className="num">{f.noMarketValue.toLocaleString('fr-FR')}</span> valeur de marché indisponible
          <InfoTip text="Joueurs compatibles qui respectent les autres contraintes mais sans valeur de marché connue : exclus tant qu'une valeur maximum est fixée. « Sans limite » les réintègre." />
        </span>
      )}
    </div>
  );

  // ---------- Rendu : résultats ----------
  const colCount = 9 + thresholdKeys.length;
  const results = !preset ? (
    <EmptyState icon={Gem} title="Choisissez un profil recherché" className="h-full">
      Le rôle fixe les postes et les seuils de percentile ; les contraintes ciblent l'âge, le temps de jeu, la valeur et la compétition.
    </EmptyState>
  ) : rows.length === 0 ? (
    <EmptyState icon={SlidersHorizontal} title="Aucun joueur ne répond aux critères" className="h-full">
      {f && f.constraints === 0
        ? `Les contraintes excluent les ${f.position.toLocaleString('fr-FR')} joueurs compatibles avec le poste : élargissez l'âge, les minutes ou la valeur.`
        : f && `${f.belowThreshold.toLocaleString('fr-FR')} joueurs sous au moins un seuil${f.insufficientData ? `, ${f.insufficientData.toLocaleString('fr-FR')} avec des données insuffisantes` : ''} : baissez l'exigence ou élargissez les contraintes.`}
    </EmptyState>
  ) : (
    <table className="sv-table">
      <thead>
        <tr>
          <th className="!pl-4 sm:!pl-5 sticky left-0 !z-20 min-w-[12rem] sm:min-w-[15rem]"><span className="inline-block w-6 text-right mr-2.5">#</span>Joueur</th>
          <th className="text-right whitespace-nowrap">
            <span className="inline-flex items-center gap-1">Indice du rôle <InfoTip text={roleIndexHelp(ROLE_CORE_WEIGHT, MIDFIELD_PROFILE_BONUS)} align="end" /></span>
          </th>
          <th className="text-right">Âge</th>
          <th>Poste</th>
          <th>Club</th>
          <th className="text-right">Min</th>
          <th className="text-right">Valeur</th>
          <th className="text-right">Contrat</th>
          {thresholdKeys.map(key => (
            <th key={key} className="text-right whitespace-nowrap" title={metricLabel(key)}>
              <div className="max-w-[8rem] truncate ml-auto">{shortMetric(key)}</div>
              <div className="normal-case tracking-normal font-normal text-ink-4">≥ P{search!.thresholds[key]}</div>
            </th>
          ))}
          <th className="w-[100px] !pr-4 sm:!pr-5"><span className="sr-only">Actions</span></th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ player, rank, index, id }) => {
          const watched = watchlistIds.has(id);
          const selected = id === selectedId;
          const open = expanded === id;
          const market = player['Market value'];
          const estimate = player['Estimated value'];
          const breakdown = open ? roleIndexBreakdown(player, preset) : null;
          return (
            <React.Fragment key={id}>
              <tr
                className={`group cursor-pointer [&:hover>td]:!bg-raised focus-visible:outline-none [&:focus-visible>td]:!bg-raised ${selected ? 'sv-row-selected' : ''}`}
                onClick={() => onSelectPlayer(player)}
                onKeyDown={e => { if (isRowActivation(e)) { e.preventDefault(); onSelectPlayer(player); } }}
                tabIndex={0}
                aria-label={`${rank}. ${player.Player}, indice ${index} : ouvrir la fiche`}
                aria-current={selected ? 'true' : undefined}
              >
                <td className="!pl-4 sm:!pl-5 sticky left-0 z-[1] bg-canvas">
                  <div className="flex items-center gap-2.5 min-w-[11rem] sm:min-w-[13rem] max-w-[12.5rem] sm:max-w-[18rem]">
                    <span className="w-6 shrink-0 text-right text-ink-4 text-xs num">{rank}</span>
                    <PlayerAvatar player={player} size="sm" />
                    <div className="min-w-0 flex items-center gap-1.5">
                      <span className="text-[13px] font-medium text-ink truncate group-hover:text-accent transition-colors">{player.Player || 'Inconnu'}</span>
                      {multiSeason && <span className="sv-tag !h-4 !px-1 !text-[9px] !font-medium shrink-0">{getPlayerSeasonTag(player)}</span>}
                    </div>
                  </div>
                </td>
                <td className="text-right">
                  <div className="flex items-center justify-end gap-2">
                    <IndexBar value={index} className="w-12 hidden sm:block" />
                    <span className="text-ink font-semibold num w-7 text-right">{index}</span>
                  </div>
                </td>
                <td className="text-right text-ink-2 num">{typeof player.Age === 'number' ? player.Age : <span className="text-ink-4">–</span>}</td>
                <td><span className="sv-tag" title={positionName(player.Position)}>{positionLabel(player.Position)}</span></td>
                <td className="text-ink-2"><TeamLine player={player} className="max-w-[9.5rem]" /></td>
                <td className="text-right text-ink-3 num whitespace-nowrap">{Number(player['Minutes played']).toLocaleString('fr-FR')}</td>
                <td className="text-right whitespace-nowrap">
                  {typeof market === 'number'
                    ? <>
                        <div className="text-ink font-medium num">{formatEuro(market)}</div>
                        {typeof estimate === 'number' && market > 0 && (
                          <div className="text-2xs text-ink-4 num" data-tip="Estimation statistique / valeur de marché" data-tip-pos="left">estim. {Math.round((estimate / market) * 100)} %</div>
                        )}
                      </>
                    : <span className="text-ink-4" title="Valeur de marché indisponible">–</span>}
                </td>
                <td className="text-right text-xs text-ink-3 num whitespace-nowrap">{contractLabel(player['Contract expires']) ?? <span className="text-ink-4">–</span>}</td>
                {thresholdKeys.map(key => (
                  <td key={key} className="text-right whitespace-nowrap">
                    <PercentileValue value={Number(player[`${key} pct`])} className="text-xs justify-end" />
                    <div className="text-2xs text-ink-4 num">{formatRaw(key, player[key])}</div>
                  </td>
                ))}
                <td className="!pr-4 sm:!pr-5">
                  <div className="flex justify-end gap-0.5">
                    <button onClick={e => { e.stopPropagation(); setExpanded(open ? null : id); }} aria-expanded={open}
                      className={`sv-icon-btn ${open ? '!text-accent' : 'opacity-50 group-hover:opacity-100 focus-visible:opacity-100'}`}
                      data-tip="Pourquoi ce joueur ?" data-tip-pos="left" aria-label={`Décomposition de l'indice de ${player.Player}`}>
                      <ListTree className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={e => toggleWatchlist(player, e)} aria-pressed={watched}
                      className={`sv-icon-btn ${watched ? '!text-accent' : 'opacity-50 group-hover:opacity-100 focus-visible:opacity-100'}`}
                      data-tip={watched ? 'Retirer de la liste de suivi' : 'Ajouter à la liste de suivi'} data-tip-pos="left"
                      aria-label={watched ? 'Retirer de la liste de suivi' : 'Ajouter à la liste de suivi'}>
                      <Star className={`w-3.5 h-3.5 ${watched ? 'fill-accent' : ''}`} />
                    </button>
                    <button onClick={e => { e.stopPropagation(); onSelectPlayer(player); }}
                      className="sv-icon-btn opacity-50 group-hover:opacity-100 focus-visible:opacity-100"
                      data-tip="Voir la fiche" data-tip-pos="left" aria-label={`Voir la fiche de ${player.Player}`}>
                      <Eye className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
              {breakdown && (
                <tr className="!cursor-default">
                  <td colSpan={colCount} className="!p-0 bg-surface">
                    <div className="sticky left-0 w-[min(calc(100vw-5rem),46rem)] px-4 sm:px-5 py-3">
                      <div className="sv-label mb-1.5 flex items-center gap-1">Pourquoi {player.Player} ? Décomposition de l'indice du rôle
                        <InfoTip text={roleIndexHelp(ROLE_CORE_WEIGHT, MIDFIELD_PROFILE_BONUS)} />
                      </div>
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-2xs text-ink-4 text-left [&>th]:whitespace-nowrap">
                            <th className="font-normal py-1">Métrique</th>
                            <th className="font-normal py-1 text-right">Percentile</th>
                            <th className="font-normal py-1 text-right">Poids</th>
                            <th className="font-normal py-1 text-right">Compté</th>
                            <th className="font-normal py-1 text-right">Part</th>
                            <th className="font-normal py-1 text-right">Contribution</th>
                          </tr>
                        </thead>
                        <tbody>
                          {[...breakdown.terms].sort((a, b) => b.contribution - a.contribution).map(t => (
                            <tr key={t.metric} className="border-t border-line/60 h-6">
                              <td className="text-ink-2 pr-2">
                                <span className="truncate">{metricLabel(t.metric)}</span>
                                <span className="text-ink-4 text-2xs ml-1.5">{t.eliminatory ? (t.ranking ? 'éliminatoire · classement' : 'éliminatoire') : 'classement'}</span>
                              </td>
                              <td className="text-right whitespace-nowrap pl-3">{t.percentile === undefined ? <span className="text-ink-4">absent</span> : <PercentileValue value={t.percentile} className="text-xs justify-end" />}</td>
                              <td className="text-right whitespace-nowrap pl-3 text-ink-3 num">×{fr(Math.abs(t.weight), 1)}{t.inverted && <span className="text-ink-4"> inversé</span>}</td>
                              <td className="text-right whitespace-nowrap pl-3 text-ink-3 num">{t.scored === undefined ? '–' : t.inverted ? `100 − ${t.percentile} = ${t.scored}` : t.scored}</td>
                              <td className="text-right whitespace-nowrap pl-3 text-ink-3 num">{fr(t.share * 100, 0)} %</td>
                              <td className="text-right whitespace-nowrap pl-3 text-ink font-medium num">{fr(t.contribution, 1)}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="border-t border-line-strong h-7">
                            <td colSpan={5} className="text-ink-3">
                              Moyenne pondérée {breakdown.weightedScore !== undefined ? fr(breakdown.weightedScore, 1) : '–'}
                              {breakdown.bonus > 0 && <> + bonus profil de milieu {breakdown.bonus}</>}
                              {breakdown.weightedScore !== undefined && breakdown.weightedScore + breakdown.bonus > 100 && ' (plafonné à 100)'}, arrondi
                            </td>
                            <td className="text-right text-accent font-semibold num">{breakdown.total}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </td>
                </tr>
              )}
            </React.Fragment>
          );
        })}
      </tbody>
    </table>
  );

  return (
    <div ref={pageRef} className="flex flex-col h-full min-h-0 overflow-y-auto lg:overflow-hidden"
      onScroll={e => { memory.pageScrollTop = e.currentTarget.scrollTop; }}>
      {/* En-tête compact */}
      <div className="px-4 sm:px-5 py-3 border-b border-line bg-surface/40 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="flex items-center gap-1.5 text-sm font-semibold text-ink whitespace-nowrap">
          <Gem className="w-4 h-4 text-accent" aria-hidden /> Chasseur de pépites
        </h1>
        <span className="text-2xs text-ink-3 whitespace-nowrap">{seasonText}</span>
        {inProgress && (
          <span className="sv-tag !font-normal text-ink-2 cursor-help" tabIndex={0} data-tip-wide="" data-tip-pos="bottom" data-tip-align="start"
            data-tip={`Échantillon limité : saison en cours, données au ${generatedOn}. En début de saison, les percentiles reposent sur peu de matchs et peuvent encore varier ; un petit échantillon n'indique pas une performance moins bonne. Relevez les minutes minimum pour stabiliser la sélection.`}>
            <span className="w-1.5 h-1.5 rounded-full bg-ink-3" aria-hidden /> Saison en cours
          </span>
        )}
        <span className="hidden md:inline text-2xs text-ink-4">Profil recherché → contraintes → joueurs correspondants → pourquoi ils ressortent → fiche</span>
        {rows.length > 0 && (
          <button onClick={() => exportProspects(rows, roleName, thresholdKeys)} className="sv-btn sv-btn-secondary ml-auto"
            data-tip="Rang, rôle et indice du rôle inclus" data-tip-pos="left">
            <Download className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Exporter</span> ({rows.length})
          </button>
        )}
      </div>

      <div className="flex flex-col lg:flex-row lg:flex-1 lg:min-h-0">
        {/* Profil recherché */}
        <aside className="lg:w-[22rem] shrink-0 p-4 sm:px-5 lg:pr-4 lg:border-r border-b lg:border-b-0 border-line space-y-4 lg:overflow-y-auto">
          {profile}
          {creator}
        </aside>

        {/* Contraintes, entonnoir, résultats */}
        <section className="flex-1 min-w-0 flex flex-col lg:min-h-0">
          <div className="px-4 sm:px-5 py-3 border-b border-line space-y-2.5">
            <div className="flex items-center justify-between gap-2 lg:hidden">
              <button onClick={() => setConstraintsOpen(o => !o)} aria-expanded={constraintsOpen} className="sv-btn sv-btn-secondary sv-btn-sm">
                <SlidersHorizontal className="w-3.5 h-3.5" /> Contraintes
                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${constraintsOpen ? 'rotate-180' : ''}`} />
              </button>
            </div>
            <div className={`${constraintsOpen ? '' : 'hidden'} lg:block`}>{constraintControls}</div>
            <div className="flex flex-wrap items-center gap-1.5">
              {chips.map(c => c.onRemove ? (
                <button key={c.key} onClick={c.onRemove} className="sv-chip sv-chip-on !h-6" aria-label={`Retirer : ${c.label}`}>
                  {c.label} <X className="w-3 h-3" />
                </button>
              ) : (
                <span key={c.key} className="sv-chip sv-chip-on !h-6 !cursor-default">{c.label}</span>
              ))}
            </div>
            {funnel}
          </div>

          <div ref={scrollRef} className="overflow-auto max-h-[75vh] lg:max-h-none lg:flex-1 lg:min-h-0"
            onScroll={e => { memory.scrollTop = e.currentTarget.scrollTop; }}>
            {results}
          </div>
        </section>
      </div>
    </div>
  );
};

export default Prospects;
