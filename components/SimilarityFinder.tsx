/**
 * ScoutVision - Joueurs similaires
 *
 * Profils les plus proches d'un joueur de référence, sur les percentiles du pipeline des métriques
 * fixes du poste (utils/similarity.ts). Le score, « Pourquoi similaire ? » et le radar lisent les
 * mêmes composantes ; dimensions, rôles et contexte sont des lectures complémentaires, jamais
 * mêlées au score.
 */

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { GitCompare, ArrowLeftRight, Info, RotateCcw, Scale, Radar as RadarIcon, Award, Layers, MapPin } from 'lucide-react';
import { ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, Tooltip } from 'recharts';
import { PlayerData, getPlayerSeason, getPlayerSeasonTag } from '../types';
import { dataLoader } from '../services/dataLoader';
import { positionLabel, positionName } from '../utils/labels';
import { rankPresets, ROLE_CORE_WEIGHT, MIDFIELD_PROFILE_BONUS } from '../utils/rolePresets';
import { roleIndexHelp } from '../utils/sampleContext';
import { formatEuro } from '../utils/format';
import { formatMetricValue, metricValue, radarAxisLabel } from '../utils/metricFormat';
import { LOWER_IS_BETTER } from '../utils/metricDirection';
import { ComparisonEntry, comparisonEntry, resolveSelection } from '../utils/comparison';
import { competitionName, isCup, loadedSeasonInProgress, minutesOf, seasonInProgress } from '../utils/playerContext';
import {
  MIN_COVERAGE, MINUTES_OPTIONS, SimilarityFilters, SimilarityResult, defaultFilters, dimensionPairs, explainSimilarity,
  findSimilar, rolePairs,
} from '../utils/similarity';
import { isRowActivation } from '../utils/rowKeys';
import { PlayerAvatar, TeamLogo, CompetitionBadge, TeamLine } from './Media';
import { PlayerSearch } from './PlayerSearch';
import { prepareComparison } from './PlayerComparison';
import { PageHeader, Panel, EmptyState, PolarTick, LegendItem, IndexBar, InfoTip } from './ui';
import { BRAND, SERIES, polarGridProps } from '../theme/charts';

interface SimilarityFinderProps {
  data: PlayerData[];
  onSelectPlayer: (player: PlayerData) => void;
  onNavigate?: (view: string) => void;
  selectedId?: string;                      // dernière fiche consultée
}

// Référence, filtres, candidat et défilement retrouvés au retour d'une fiche ou d'une autre page
const memory = {
  reference: null as ComparisonEntry | null,
  filters: null as SimilarityFilters | null,
  candidateId: null as string | null,
  scrollTop: 0,
};

const INTEGER = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const ONE_DECIMAL = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const CANDIDATE = SERIES[1];
const RESULT_LIMIT = 20;

const fmtNumber = (v: number | null, digits = 1) => (v === null ? '–' : digits === 0 ? INTEGER.format(v) : ONE_DECIMAL.format(v));

// ============================================
// RÉFÉRENCE
// ============================================

const ReferenceCard: React.FC<{ player: PlayerData; onOpen: () => void }> = ({ player: p, onOpen }) => {
  const roles = useMemo(() => rankPresets(p, undefined, 2), [p]);
  const minutes = minutesOf(p);
  const market = metricValue(p, 'Market value');
  const age = metricValue(p, 'Age');
  const matches = metricValue(p, 'Matches played');
  const inProgress = seasonInProgress(p);
  return (
    <Panel title="Référence">
      <div className="flex items-start gap-3">
        <PlayerAvatar player={p} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold text-ink leading-tight">{p.Player || 'Inconnu'}</div>
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 mt-1 text-2xs text-ink-3">
            <span className="inline-flex items-center gap-1"><TeamLogo src={p['Team logo'] as string | undefined} name={p.Team} size="xs" />{p.Team}</span>
            <span aria-hidden>·</span>
            <CompetitionBadge competition={p.Competition} />
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1 mt-2.5">
        <span className="sv-tag" title={positionName(p.Position)}>{positionLabel(p.Position)}</span>
        <span className="sv-tag !font-normal">{age !== null ? `${age} ans` : 'Âge inconnu'}</span>
        <span className="sv-tag !font-normal" title="Saison">{getPlayerSeasonTag(p)}</span>
        {isCup(p) && <span className="sv-tag !font-normal">Coupe</span>}
        {inProgress && (
          <span className="sv-tag !font-normal text-ink-2" title="Échantillon limité : la saison n'est pas terminée.">
            <span className="w-1.5 h-1.5 rounded-full bg-ink-3" aria-hidden />Saison en cours{matches !== null ? ` · ${matches} match${matches > 1 ? 's' : ''}` : ''}
          </span>
        )}
      </div>
      <div className="mt-2.5 pt-2 border-t border-line grid grid-cols-[1fr_1fr_auto] items-end gap-x-3 text-2xs">
        <div><div className="sv-label">Minutes</div><div className="text-sm font-semibold text-ink num">{minutes !== null ? INTEGER.format(minutes) : '–'}</div></div>
        <div><div className="sv-label">Valeur</div><div className="text-sm font-semibold text-ink num">{market !== null ? formatEuro(market) : 'N/D'}</div></div>
        <button onClick={onOpen} className="sv-btn sv-btn-secondary sv-btn-sm" aria-label={`Voir la fiche de ${p.Player}`}>Voir la fiche</button>
      </div>
      <div className="mt-2 text-2xs">
        <div className="sv-label">Rôle principal</div>
        {roles[0] ? (
          <>
            <div className="flex items-center justify-between gap-2 mt-0.5 text-xs"><span className="text-ink">{roles[0].name}</span><span className="num font-semibold text-ink">{roles[0].index}</span></div>
            <IndexBar value={roles[0].index} className="mt-1" />
            {roles[1] && <div className="flex items-center justify-between gap-2 mt-1 text-2xs text-ink-3"><span>Puis {roles[1].name}</span><span className="num">{roles[1].index}</span></div>}
          </>
        ) : <div className="text-xs text-ink-3 mt-0.5">{p.Position ? 'Aucun rôle évaluable' : 'Poste inconnu'}</div>}
      </div>
    </Panel>
  );
};

// ============================================
// DÉTAIL DU CANDIDAT
// ============================================

const PairRadar: React.FC<{ result: SimilarityResult; names: [string, string] }> = ({ result, names }) => {
  // Même principe que la fiche et la Comparaison : moins d'axes et libellés plus courts quand c'est étroit
  const [width, setWidth] = useState(0);
  const narrow = width > 0 && width < 340;
  const compact = width > 0 && width < 260;
  const usable = result.components.filter(c => c.delta !== null);
  const axes = usable.slice(0, compact ? 6 : narrow ? 8 : 12);
  if (axes.length < 3) return null;
  const data = axes.map(c => ({ subject: radarAxisLabel(c.label), key: c.key, ref: c.pRef, cand: c.pCandidate }));
  const tooltip = ({ active, payload }: { active?: boolean; payload?: { payload?: { key: string } }[] }) => {
    const key = payload?.[0]?.payload?.key; if (!active || !key) return null;
    const c = result.components.find(x => x.key === key)!;
    return (
      <div className="sv-tooltip min-w-[13rem]">
        <div className="text-2xs text-ink-3 mb-1">{c.label}</div>
        {[[names[0], c.pRef, 0], [names[1], c.pCandidate, 1]].map(([n, p, i]) => (
          <div key={String(n)} className="flex items-center gap-2 py-0.5"><span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: SERIES[i as number] }} aria-hidden /><span className="flex-1 text-ink">{n}</span><span className="num font-semibold text-ink">P{Math.round(p as number)}</span></div>
        ))}
        <div className="text-2xs text-ink-3 mt-1">Écart {Math.round(c.delta as number)} points</div>
      </div>
    );
  };
  return (
    <div>
      <div className="h-[300px] -mx-4 sm:-mx-2">
        <ResponsiveContainer width="100%" height="100%" onResize={w => setWidth(Math.round(w))}>
          <RadarChart cx="50%" cy="50%" outerRadius={compact ? '48%' : narrow ? '52%' : '66%'} data={data} margin={{ top: 18, right: 30, bottom: 18, left: 30 }}>
            <PolarGrid {...polarGridProps} />
            <PolarAngleAxis dataKey="subject" tick={(tp: object) => <PolarTick {...(tp as React.ComponentProps<typeof PolarTick>)} {...(compact ? { maxChars: 11, maxLines: 4 } : narrow ? { maxChars: 12, maxLines: 3 } : { maxLines: 3 })} />} />
            <PolarRadiusAxis angle={90} domain={[0, 100]} tickCount={5} tick={false} axisLine={false} />
            <Radar name={names[0]} dataKey="ref" stroke={BRAND} strokeWidth={2} fill={BRAND} fillOpacity={0.12} dot={{ r: 2, fill: BRAND, strokeWidth: 0 }} isAnimationActive={false} />
            <Radar name={names[1]} dataKey="cand" stroke={CANDIDATE} strokeWidth={2} fill={CANDIDATE} fillOpacity={0.06} dot={{ r: 2, fill: CANDIDATE, strokeWidth: 0 }} isAnimationActive={false} />
            <Tooltip content={tooltip as never} cursor={false} />
          </RadarChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1">
        <LegendItem color={BRAND} shape="line">{names[0]}</LegendItem>
        <LegendItem color={CANDIDATE} shape="line">{names[1]}</LegendItem>
      </div>
      {axes.length < usable.length && <p className="text-2xs text-ink-3 mt-2">Radar limité à {axes.length} axes sur {usable.length} ; toutes les composantes sont dans « Pourquoi similaire ? ».</p>}
    </div>
  );
};

const PairValue: React.FC<{ label: string; a: number; b: number; bar?: 'index' }> = ({ label, a, b }) => (
  <div className="py-1.5 border-b border-line last:border-0">
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="text-ink-2">{label}</span>
      <span className="num whitespace-nowrap"><span className="font-semibold text-ink">{a}</span><span className="text-ink-4 mx-1.5">↔</span><span className="font-semibold text-ink">{b}</span></span>
    </div>
    <div className="grid grid-cols-2 gap-1 mt-1">
      <IndexBar value={a} /><IndexBar value={b} />
    </div>
  </div>
);

const ContextRow: React.FC<{ label: string; a: React.ReactNode; b: React.ReactNode }> = ({ label, a, b }) => (
  <tr>
    <th scope="row" className="py-1.5 pr-2 text-left text-2xs font-semibold uppercase tracking-[0.08em] text-ink-3 align-top leading-snug">{label}</th>
    <td className="py-1.5 pr-2 text-xs text-ink align-top break-words leading-snug">{a}</td>
    <td className="py-1.5 text-xs text-ink align-top break-words leading-snug">{b}</td>
  </tr>
);

const CandidateDetail: React.FC<{ reference: PlayerData; result: SimilarityResult; onOpen: () => void; onCompare?: () => void }> = ({ reference, result, onOpen, onCompare }) => {
  const c = result.player;
  const names: [string, string] = useMemo(() => {
    const ln = (p: PlayerData) => String(p.Player || 'Inconnu').split(' ').pop() as string;
    return ln(reference) === ln(c) ? [String(reference.Player), String(c.Player)] : [ln(reference), ln(c)];
  }, [reference, c]);
  const { closest, furthest, missing } = useMemo(() => explainSimilarity(result.components, 4), [result]);
  const dims = useMemo(() => dimensionPairs(reference, c), [reference, c]);
  const roles = useMemo(() => rolePairs(reference, c), [reference, c]);
  const ctx = (p: PlayerData) => ({ age: metricValue(p, 'Age'), minutes: minutesOf(p), poss: metricValue(p, 'Team possession, %'), ppda: metricValue(p, 'Team PPDA'), tilt: metricValue(p, 'Team field tilt'), style: p['Team style'] ? String(p['Team style']) : null, tier: p['League tier'] });
  const A = ctx(reference), B = ctx(c);
  const explain = (list: typeof closest) => (
    <ol className="divide-y divide-line">
      {list.map(x => (
        <li key={x.key} className="py-1.5 flex items-center justify-between gap-3 text-xs">
          <span className="min-w-0">
            <span className="text-ink">{x.label}</span>
            {LOWER_IS_BETTER.has(x.key) && <span className="text-2xs text-ink-3"> · moins = mieux</span>}
            <span className="block text-2xs text-ink-3 num" title="Valeurs brutes">{formatMetricValue(x.key, metricValue(reference, x.key))} ↔ {formatMetricValue(x.key, metricValue(c, x.key))}</span>
          </span>
          <span className="shrink-0 inline-flex items-center gap-1.5 num text-xs font-semibold text-ink"><span className="w-1.5 h-1.5 rounded-sm shrink-0" style={{ backgroundColor: BRAND }} aria-hidden />P{Math.round(x.pRef as number)}<span className="text-ink-4 font-normal">↔</span><span className="w-1.5 h-1.5 rounded-sm shrink-0" style={{ backgroundColor: CANDIDATE }} aria-hidden />P{Math.round(x.pCandidate as number)}<span className="ml-1 text-2xs font-normal text-ink-3 w-8 text-right">Δ{Math.round(x.delta as number)}</span></span>
        </li>
      ))}
    </ol>
  );
  return (
    <div className="space-y-4" aria-label={`Détail de ${c.Player}`}>
      <Panel title={<>Similarité globale <InfoTip align="end" text={`100 − écart moyen de percentile sur les métriques comparables du poste (${MIN_COVERAGE}/${result.total} au minimum).\nLes percentiles restent relatifs au poste, au niveau de compétition et à la saison.`} /></>} icon={Scale}
        right={<div className="flex items-center gap-2">{onCompare && <button onClick={onCompare} className="sv-btn sv-btn-secondary sv-btn-sm"><ArrowLeftRight className="w-3.5 h-3.5" /> Comparer</button>}<button onClick={onOpen} className="sv-btn sv-btn-secondary sv-btn-sm" aria-label={`Voir la fiche de ${c.Player}`}>Voir la fiche</button></div>}>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <div className="flex items-center gap-3 min-w-0">
            <PlayerAvatar player={c} size="md" />
            <div className="min-w-0">
              <div className="text-[13px] font-medium text-ink">{c.Player}</div>
              <div className="text-2xs text-ink-3"><TeamLine player={c} /></div>
            </div>
          </div>
          <div className="flex items-baseline gap-2 ml-auto">
            <span className="text-2xl font-semibold text-ink num leading-none">{fmtNumber(result.score)}</span>
            <span className="text-xs text-ink-3">/ 100 · {result.covered} / {result.total} métriques comparables</span>
          </div>
        </div>
        {(reference.Position !== c.Position || reference['League tier'] !== c['League tier'] || getPlayerSeason(reference) !== getPlayerSeason(c)) && (
          <p className="text-2xs text-ink-3 mt-3 leading-relaxed flex gap-1.5"><Info className="w-3.5 h-3.5 shrink-0 mt-px" aria-hidden />
            Les percentiles sont relatifs au groupe de référence de chaque joueur (poste × niveau × saison) : {[reference.Position !== c.Position && 'postes', reference['League tier'] !== c['League tier'] && 'niveaux', getPlayerSeason(reference) !== getPlayerSeason(c) && 'saisons'].filter(Boolean).join(', ')} différents ici.</p>
        )}
      </Panel>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <Panel className="xl:col-span-7" title="Pourquoi similaire ?" icon={GitCompare} subtitle="Les composantes mêmes du score : écarts de percentile les plus faibles et les plus forts. Les couleurs désignent les joueurs, pas une qualité.">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
            <div><div className="sv-label mb-1">Plus proches</div>{explain(closest)}</div>
            <div><div className="sv-label mb-1">Plus différents</div>{explain(furthest)}</div>
          </div>
          {missing.length > 0 && <p className="text-2xs text-ink-3 mt-3">Hors score (percentile absent chez l'un des deux) : {missing.map(m => m.label).join(', ')}.</p>}
        </Panel>
        <Panel className="xl:col-span-5" title="Profil" icon={RadarIcon} subtitle="Percentiles des composantes du score (0-100).">
          <PairRadar result={result} names={names} />
        </Panel>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <Panel className="xl:col-span-4" title="Lecture par dimensions" icon={Layers} subtitle="Scores de dimension du profil d'effectif (moyenne de percentiles, 0-100), référence ↔ candidat. Ne participent pas au score.">
          {dims.length ? dims.map(d => <PairValue key={d.key} label={d.label} a={d.ref} b={d.candidate} />) : <p className="text-xs text-ink-3">Aucune dimension couverte pour les deux joueurs.</p>}
        </Panel>
        <Panel className="xl:col-span-4" title={<>Profils tactiques <InfoTip align="end" text={roleIndexHelp(ROLE_CORE_WEIGHT, MIDFIELD_PROFILE_BONUS)} /></>} icon={Award} subtitle="Indice des rôles compatibles du poste (même calcul que la fiche et le Chasseur), référence ↔ candidat.">
          {roles.length ? roles.map(r => <PairValue key={r.name} label={r.name} a={r.ref} b={r.candidate} />) : <p className="text-xs text-ink-3">{reference.Position === c.Position ? 'Aucun rôle évaluable pour ce poste.' : 'Postes différents : les indices de rôle ne se comparent pas d\'un poste à l\'autre.'}</p>}
        </Panel>
        <Panel className="xl:col-span-4" title="Contexte" icon={MapPin} subtitle="Lecture factuelle côte à côte ; l'équipe et le championnat façonnent les volumes.">
          <table className="w-full table-fixed">
            <caption className="sr-only">Contexte de {reference.Player} et de {c.Player}</caption>
            <thead><tr><th scope="col" className="w-[28%]"><span className="sr-only">Donnée</span></th><th scope="col" className="pb-1 pr-3 text-left text-2xs font-normal text-ink-3">{names[0]}</th><th scope="col" className="pb-1 text-left text-2xs font-normal text-ink-3">{names[1]}</th></tr></thead>
            <tbody>
              <ContextRow label="Âge" a={A.age ?? '–'} b={B.age ?? '–'} />
              <ContextRow label="Poste" a={positionName(reference.Position)} b={positionName(c.Position)} />
              <ContextRow label="Club" a={reference.Team} b={c.Team} />
              <ContextRow label="Compétition" a={`${competitionName(reference)} · niv. ${A.tier ?? '?'}`} b={`${competitionName(c)} · niv. ${B.tier ?? '?'}`} />
              <ContextRow label="Saison" a={getPlayerSeasonTag(reference)} b={getPlayerSeasonTag(c)} />
              <ContextRow label="Minutes" a={fmtNumber(A.minutes, 0)} b={fmtNumber(B.minutes, 0)} />
              <ContextRow label="Style d'équipe" a={A.style ?? '–'} b={B.style ?? '–'} />
              <ContextRow label="Possession" a={A.poss !== null ? `${fmtNumber(A.poss)} %` : '–'} b={B.poss !== null ? `${fmtNumber(B.poss)} %` : '–'} />
              <ContextRow label="PPDA" a={fmtNumber(A.ppda)} b={fmtNumber(B.ppda)} />
              <ContextRow label="Field tilt" a={A.tilt !== null ? `${fmtNumber(A.tilt)} %` : '–'} b={B.tilt !== null ? `${fmtNumber(B.tilt)} %` : '–'} />
            </tbody>
          </table>
        </Panel>
      </div>
    </div>
  );
};

// ============================================
// PAGE
// ============================================

const SimilarityFinder: React.FC<SimilarityFinderProps> = ({ data, onSelectPlayer, onNavigate, selectedId }) => {
  const inProgress = useMemo(() => loadedSeasonInProgress(data), [data]);
  const seasonsLoaded = useMemo(() => new Set(data.map(getPlayerSeason)).size, [data]);
  const competitions = useMemo(() => {
    const keys = Array.from(new Set(data.map(p => p.Competition).filter((c): c is string => typeof c === 'string' && c !== '')));
    return keys.map(key => ({ key, info: dataLoader.getCompetition(key) }))
      .sort((a, b) => (a.info?.tier ?? 9) - (b.info?.tier ?? 9) || (a.info?.name ?? a.key).localeCompare(b.info?.name ?? b.key, 'fr'));
  }, [data]);
  const tiers = useMemo(() => Array.from(new Set(data.map(p => p['League tier']).filter((t): t is number => typeof t === 'number'))).sort((a, b) => a - b), [data]);

  const [entry, setEntry] = useState<ComparisonEntry | null>(memory.reference);
  const [filters, setFilters] = useState<SimilarityFilters>(() => {
    const f = memory.filters ?? defaultFilters(inProgress);
    return { ...f, competition: competitions.some(c => c.key === f.competition) ? f.competition : '' };
  });
  const [candidateId, setCandidateId] = useState<string | null>(memory.candidateId);
  const [notice, setNotice] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const chipsRef = useRef<HTMLDivElement>(null);
  const filtersHeadingRef = useRef<HTMLInputElement>(null);
  const pendingFocus = useRef<(() => void) | null>(null);
  useEffect(() => { if (pendingFocus.current) { pendingFocus.current(); pendingFocus.current = null; } });

  // Référence retrouvée dans les données chargées ; si elle n'y est plus (autre saison), elle est retirée et signalée
  const { players: resolved, missing } = useMemo(() => resolveSelection(entry ? [entry] : [], data), [entry, data]);
  const reference = resolved[0] ?? null;
  useEffect(() => { if (missing.length) { setEntry(null); setCandidateId(null); setNotice('Référence retirée : absente des données de la saison chargée.'); } }, [missing]);
  useEffect(() => { Object.assign(memory, { reference: entry, filters, candidateId }); }, [entry, filters, candidateId]);

  useLayoutEffect(() => {
    const scroller = rootRef.current?.closest('.overflow-y-auto') as HTMLElement | null;
    if (!scroller) return;
    if (memory.scrollTop) scroller.scrollTop = memory.scrollTop;
    const onScroll = () => { memory.scrollTop = scroller.scrollTop; };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => scroller.removeEventListener('scroll', onScroll);
  }, []);

  const search = useMemo(() => (reference ? findSimilar(reference, data, filters, RESULT_LIMIT) : null), [reference, data, filters]);
  const selected = search?.results.find(r => r.id === candidateId) ?? null;
  const referenceTotal = search ? (reference ? search.results[0]?.total ?? 12 : 12) : 12;
  const referenceInsufficient = !!reference && !!search && search.referenceCovered < MIN_COVERAGE;

  const setFilter = <K extends keyof SimilarityFilters>(key: K, value: SimilarityFilters[K]) => setFilters(f => ({ ...f, [key]: value }));
  const defaults = defaultFilters(inProgress);
  // Retrait d'une puce : focus sur la puce suivante, sinon la case « Même poste » (jamais le corps de la page)
  const removeChip = (index: number, action: () => void) => {
    action();
    pendingFocus.current = () => { const btns = chipsRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? []; (btns[index] ?? btns[btns.length - 1] ?? filtersHeadingRef.current)?.focus(); };
  };
  const chips = [
    ...(filters.samePosition && reference ? [{ key: 'pos', label: `Poste : ${positionLabel(reference.Position)}`, onRemove: () => setFilter('samePosition', false) }] : []),
    ...(filters.ageMax !== null ? [{ key: 'age', label: `≤ ${filters.ageMax} ans`, onRemove: () => setFilter('ageMax', null) }] : []),
    ...(filters.minMinutes > 0 ? [{ key: 'min', label: `≥ ${INTEGER.format(filters.minMinutes)} min`, onRemove: () => setFilter('minMinutes', 0) }] : []),
    ...(filters.competition ? [{ key: 'comp', label: competitions.find(c => c.key === filters.competition)?.info?.name ?? filters.competition, onRemove: () => setFilter('competition', '') }] : []),
    ...(filters.tier !== null ? [{ key: 'tier', label: `Niveau ${filters.tier}`, onRemove: () => setFilter('tier', null) }] : []),
  ];
  const isDefault = JSON.stringify(filters) === JSON.stringify(defaults);

  const pickReference = (p: PlayerData) => { setEntry(comparisonEntry(p)); setCandidateId(null); setNotice(''); };
  const selectCandidate = (r: SimilarityResult) => { setCandidateId(r.id); requestAnimationFrame(() => detailRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })); };
  const compare = (r: SimilarityResult) => { if (!reference || !onNavigate) return; prepareComparison([reference, r.player]); onNavigate('COMPARISON'); };

  return (
    <div ref={rootRef} className="p-5 space-y-4 animate-fade-in">
      <PageHeader title="Joueurs similaires" icon={GitCompare}
        description={`Profils les plus proches d'un joueur de référence : 100 − écart moyen de percentile sur les ${referenceTotal} métriques du poste (percentiles du pipeline, relatifs au poste, au niveau et à la saison de chaque joueur). ${seasonsLoaded > 1 ? 'Toutes les saisons : chaque saison d\'un joueur est un profil distinct ; la référence est exclue pour sa propre saison seulement.' : 'Candidats : les lignes joueur-saison de la saison chargée.'}`} />

      <div className="grid grid-cols-1 lg:grid-cols-[18rem_1fr] gap-4 items-start">
        <div className="space-y-4">
          <div className="sv-panel p-3">
            <PlayerSearch label="Joueur de référence" inputRef={inputRef} onPick={pickReference} pickedMessage={p => `${p.Player} pris comme référence.`} />
          </div>
          {reference && <ReferenceCard player={reference} onOpen={() => onSelectPlayer(reference)} />}
          {reference && (
            <Panel title="Filtres" right={!isDefault && <button onClick={() => setFilters(defaults)} className="sv-btn sv-btn-ghost sv-btn-sm"><RotateCcw className="w-3.5 h-3.5" /> Par défaut</button>}>
              <div className="space-y-2.5 text-xs">
                <label className="flex items-center gap-2 cursor-pointer text-ink-2"><input ref={filtersHeadingRef} type="checkbox" checked={filters.samePosition} onChange={e => setFilter('samePosition', e.target.checked)} />Même poste uniquement</label>
                <label className="flex items-center justify-between gap-2"><span className="sv-label">Âge max</span>
                  <input type="number" min={16} max={45} className="sv-input sv-input-sm !w-20" value={filters.ageMax ?? ''} placeholder="—" aria-label="Âge maximum"
                    onChange={e => { const v = e.target.value === '' ? null : Number(e.target.value); setFilter('ageMax', v !== null && Number.isFinite(v) && v > 0 ? Math.round(v) : null); }} /></label>
                <label className="flex items-center justify-between gap-2"><span className="sv-label">Minutes min</span>
                  <select className="sv-select sv-select-sm !w-24" value={filters.minMinutes} onChange={e => setFilter('minMinutes', Number(e.target.value))} aria-label="Minutes minimum">
                    {MINUTES_OPTIONS.map(m => <option key={m} value={m}>{m === 0 ? 'Toutes' : INTEGER.format(m)}</option>)}
                  </select></label>
                <label className="flex items-center justify-between gap-2 min-w-0"><span className="sv-label">Compétition</span>
                  <select className="sv-select sv-select-sm min-w-0 w-[11rem] max-w-[62%]" value={filters.competition} onChange={e => setFilter('competition', e.target.value)} aria-label="Compétition">
                    <option value="">Toutes</option>{competitions.map(c => <option key={c.key} value={c.key}>{c.info?.name ?? c.key}</option>)}
                  </select></label>
                <label className="flex items-center justify-between gap-2"><span className="sv-label">Niveau</span>
                  <select className="sv-select sv-select-sm !w-24" value={filters.tier ?? ''} onChange={e => setFilter('tier', e.target.value === '' ? null : Number(e.target.value))} aria-label="Niveau de compétition">
                    <option value="">Tous</option>{tiers.map(t => <option key={t} value={t}>Niveau {t}</option>)}
                  </select></label>
                {chips.length > 0 && (
                  <div ref={chipsRef} className="flex flex-wrap gap-1 pt-2 border-t border-line" aria-label="Filtres actifs">
                    {chips.map((c, i) => <button key={c.key} onClick={() => removeChip(i, c.onRemove)} className="sv-chip sv-chip-on !h-6" aria-label={`Retirer : ${c.label}`}>{c.label} <span aria-hidden>×</span></button>)}
                  </div>
                )}
              </div>
            </Panel>
          )}
        </div>

        <div className="space-y-4 min-w-0">
          {notice && <p role="status" className="text-xs text-ink-3">{notice}</p>}
          {!reference ? (
            <div className="sv-panel"><EmptyState icon={GitCompare} title="Choisissez un joueur de référence">
              Recherchez-le par son nom ou son club. Vous obtiendrez les {RESULT_LIMIT} profils les plus proches sur les métriques de son poste, puis pour chaque candidat : pourquoi il est similaire, les dimensions, les rôles et le contexte.
            </EmptyState></div>
          ) : referenceInsufficient ? (
            <div className="sv-panel"><EmptyState icon={Scale} title="Données insuffisantes pour une similarité fiable">
              {search!.referenceCovered} métrique{search!.referenceCovered > 1 ? 's' : ''} du poste sur {referenceTotal} avec un percentile pour cette ligne ; il en faut {MIN_COVERAGE}. {isCup(reference) ? 'Choisissez la ligne de championnat de ce joueur.' : 'Choisissez une autre saison ou un autre joueur.'}
            </EmptyState></div>
          ) : (
            <>
              <Panel flush title="Profils les plus proches" icon={Scale}
                subtitle={<>{search!.candidates.toLocaleString('fr-FR')} candidat{search!.candidates > 1 ? 's' : ''} après filtres{search!.insufficient > 0 ? ` · ${search!.insufficient} sans score (moins de ${MIN_COVERAGE}/${referenceTotal} métriques comparables)` : ''} · {Math.min(RESULT_LIMIT, search!.results.length)} affichés. Cliquez une ligne pour le détail.</>}>
                {search!.results.length === 0 ? (
                  <EmptyState icon={Scale} title="Aucun candidat scoré">{search!.candidates === 0 ? 'Aucun joueur ne passe les filtres : élargissez-les.' : 'Les candidats n\'ont pas assez de métriques comparables avec la référence.'}</EmptyState>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="sv-table">
                      <caption className="sr-only">Joueurs les plus similaires à {reference.Player}, par similarité décroissante</caption>
                      <thead><tr>
                        <th scope="col" className="!pl-4 sticky left-0 !z-20 min-w-[11rem] sm:min-w-[14rem]"><span className="inline-block w-5 text-right mr-2.5">#</span>Joueur</th>
                        <th scope="col">Club · compétition</th>
                        <th scope="col" className="text-right">Âge</th>
                        <th scope="col">Poste</th>
                        <th scope="col" className="text-right">Min</th>
                        <th scope="col" className="text-right">Similarité</th>
                        <th scope="col" className="text-right" title="Métriques comparables sur le total du poste">Couverture</th>
                        <th scope="col" className="w-[120px] !pr-4"><span className="sr-only">Actions</span></th>
                      </tr></thead>
                      <tbody>
                        {search!.results.map((r, i) => {
                          const p = r.player; const isSel = r.id === candidateId; const age = metricValue(p, 'Age'); const min = minutesOf(p);
                          return (
                            <tr key={r.id} tabIndex={0} onClick={() => selectCandidate(r)} onKeyDown={e => { if (isRowActivation(e)) { e.preventDefault(); selectCandidate(r); } }}
                              aria-label={`${i + 1}. ${p.Player}, similarité ${fmtNumber(r.score, 0)} : voir le détail`} aria-current={isSel ? 'true' : undefined}
                              className={`group cursor-pointer [&:hover>td]:!bg-raised [&:hover>th]:!bg-raised focus-visible:outline-none [&:focus-visible>td]:!bg-raised [&:focus-visible>th]:!bg-raised ${isSel ? 'sv-row-selected' : ''} ${r.id === selectedId ? 'ring-1 ring-inset ring-accent/30' : ''}`}>
                              <th scope="row" className="sticky left-0 z-10 bg-surface px-3 !pl-4 py-1.5 border-b border-line/70 text-left font-normal">
                                <div className="flex items-center gap-2.5 min-w-0"><span className="w-5 text-right text-2xs text-ink-4 num shrink-0">{i + 1}</span><PlayerAvatar player={p} size="sm" />
                                  <div className="min-w-0"><div className="text-[13px] font-medium text-ink truncate" title={String(p.Player)}>{p.Player || 'Inconnu'}</div><div className="text-2xs text-ink-3">{getPlayerSeasonTag(p)}{isCup(p) ? ' · Coupe' : ''}</div></div></div>
                              </th>
                              <td className="text-xs text-ink-2 whitespace-nowrap"><TeamLine player={p} className="max-w-[14rem]" /></td>
                              <td className="text-right text-xs text-ink-2 num">{age ?? '–'}</td>
                              <td><span className="sv-tag" title={positionName(p.Position)}>{positionLabel(p.Position)}</span></td>
                              <td className="text-right text-xs text-ink-3 num whitespace-nowrap">{min !== null ? INTEGER.format(min) : '–'}</td>
                              <td className="text-right whitespace-nowrap"><span className="text-sm font-semibold text-ink num">{fmtNumber(r.score, 0)}</span></td>
                              <td className="text-right text-xs text-ink-3 num whitespace-nowrap">{r.covered} / {r.total}</td>
                              <td className="!pr-3 whitespace-nowrap text-right">
                                {onNavigate && <button onClick={e => { e.stopPropagation(); compare(r); }} className="sv-icon-btn" aria-label={`Comparer ${reference.Player} et ${p.Player}`} data-tip="Comparer" data-tip-pos="left"><ArrowLeftRight className="w-3.5 h-3.5" /></button>}
                                <button onClick={e => { e.stopPropagation(); onSelectPlayer(p); }} className="sv-btn sv-btn-ghost sv-btn-sm !text-accent" aria-label={`Voir la fiche de ${p.Player}`}>Fiche</button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </Panel>
              <div ref={detailRef} className="scroll-mt-4">
                {selected ? (
                  <CandidateDetail reference={reference} result={selected} onOpen={() => onSelectPlayer(selected.player)} onCompare={onNavigate ? () => compare(selected) : undefined} />
                ) : search!.results.length > 0 && (
                  <div className="sv-panel"><EmptyState icon={GitCompare} title="Sélectionnez un candidat">Le détail montre pourquoi il est similaire (composantes du score), les dimensions, les rôles compatibles et le contexte.</EmptyState></div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default SimilarityFinder;
