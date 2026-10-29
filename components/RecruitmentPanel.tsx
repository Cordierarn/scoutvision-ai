/**
 * ScoutVision AI - Recrutement
 * Diagnostic de l'équipe (besoins par poste du onze type, profil de l'effectif) et
 * suggestions de joueurs projetés dans l'équipe la saison suivante : modèle de transfert
 * de scripts/models.py (niveau des championnats, domination de l'équipe, coût
 * d'adaptation) sur les courbes d'âge, calculs dans utils/recruitment.ts.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeftRight, BadgeEuro, ChevronDown, ChevronRight, CircleAlert, CircleCheck, CircleHelp, Clock, ExternalLink, FileClock, Info,
  Microscope, Repeat, Scale, SlidersHorizontal, TrendingDown, TriangleAlert, Users, UserSearch,
} from 'lucide-react';
import { CartesianGrid, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from 'recharts';
import { PlayerData, TeamStats, getPlayerSeason } from '../types';
import { AgeCurves, MarketValues, TeamLineups, TransferModel, dataLoader } from '../services/dataLoader';
import { queryService } from '../services/queryService';
import { DEFAULT_ROLE_PRESETS, RolePreset, presetWeights, presetsForPosition } from '../utils/rolePresets';
import { placeEleven } from '../utils/lineup';
import { formationPositions, isExploitableFormation, orderFormations, recruitmentFormation } from '../utils/teamLineups';
import { teamCohort } from '../utils/teamMetrics';
import { isSeasonInProgress, resolveTeamLeague } from '../utils/teamContext';
import { seasonCapabilities, ESTIMATE_RATIO_MIN } from '../utils/prospects';
import {
  Candidate, CandidateFlag, DEFAULT_FILTERS, LeagueScope, Models, NeedFlag, NeedLevel, RoleForecast, SearchFilters, SlotNeed,
  Target, complementFor, displayIndex, forecastRole, incumbentForecast, leagueLevel, leagueRows, needOrder as orderNeeds,
  projectionCascade, projectionError, searchCandidates, seasonMarket, slotNeeds, slotPartner, squadProfile, teamRank,
  AGE_RANGE, COMPLEMENT_THRESHOLD, CONTEXT_EFFECT_NOTABLE, CONTRACT_MONTHS, FEW_MINUTES,
} from '../utils/recruitment';
import { formatEuro } from '../utils/format';
import { metricLabel, positionLabel, positionName } from '../utils/labels';
import { CompetitionBadge, PlayerAvatar, TeamLine } from './Media';
import { SquadProfilePanel } from './SquadProfile';
import { Delta, EmptyState, InfoTip, Panel, PercentileValue, Skeleton, Stat } from './ui';
import { BRAND, CONTEXT, DIVERGING, INK, STATUS as STATUS_COLORS } from '../theme/charts';

// Couleurs des graphiques (theme/charts) : le candidat en cyan, le titulaire et les autres en gris
// de contexte, paire divergente cyan / rouge autour de la médiane ; palette de statut réservée aux
// niveaux de besoin (toujours avec icône et libellé)
const BLUE = BRAND;
// « À évaluer » n'est pas un statut : icône neutre
const STATUS: Record<NeedLevel, string> = { high: STATUS_COLORS.critical, unknown: STATUS_COLORS.neutral, medium: STATUS_COLORS.warning, low: STATUS_COLORS.good };

const NEED_LABELS: Record<NeedLevel, { label: string; icon: React.ElementType }> = {
  high: { label: 'Prioritaire', icon: TriangleAlert },
  unknown: { label: 'À évaluer', icon: CircleHelp },
  medium: { label: 'À renforcer', icon: CircleAlert },
  low: { label: 'Solide', icon: CircleCheck },
};

const NEED_FLAGS: Record<NeedFlag, { label: string; icon: React.ElementType; title: string }> = {
  noStarter: { label: 'Aucun joueur régulier', icon: CircleAlert, title: 'Aucun joueur de ce poste n\'a 40 % des minutes de l\'équipe' },
  rotation: { label: 'Poste en rotation', icon: Repeat, title: 'Le titulaire le plus fréquent a moins de 40 % des minutes : la référence est le joueur le plus utilisé à ce poste' },
  contract: { label: `Contrat ≤ ${CONTRACT_MONTHS} mois`, icon: FileClock, title: 'Fin de contrat proche (Transfermarkt) : succession à préparer' },
  decline: { label: 'Déclin lié à l\'âge', icon: TrendingDown, title: 'L\'âge seul (hors retour vers la moyenne) fait baisser l\'indice projeté d\'au moins 2 points' },
  depth: { label: 'Pas de doublure', icon: Users, title: 'Aucun autre joueur n\'a débuté 15 % des matchs de la formation à ce poste' },
  outOfPosition: { label: 'Titulaire hors poste', icon: ArrowLeftRight, title: 'Titulaire aligné à deux lignes ou plus de son poste : le poste recherché est celui de la formation. Ses percentiles sont calculés parmi les joueurs de son poste d\'origine, son indice n\'est pas comparable : besoin à évaluer' },
};

const CANDIDATE_FLAGS: Record<CandidateFlag, { label: string; icon: React.ElementType; title: string }> = {
  bigStep: { label: 'Gros saut de niveau', icon: TrendingDown, title: 'Le changement de championnat coûte au moins 5 points d\'indice' },
  rareLeague: { label: 'Championnat peu observé', icon: Microscope, title: 'Moins de 15 transferts observés depuis ou vers ce championnat : traduction moins sûre' },
  fewMinutes: { label: 'Peu de minutes', icon: Clock, title: 'Peu de minutes cette saison : percentiles plus instables' },
  noContext: { label: 'Contexte équipe indisponible', icon: CircleHelp, title: 'Domination territoriale inconnue pour son équipe ou la nôtre : le terme de contexte n\'a pas été appliqué' },
  contextEffect: { label: 'Effet de contexte important', icon: Scale, title: `La projection est sensible à l'écart de domination territoriale entre le club actuel et le club cible (terme de contexte d'au moins ${CONTEXT_EFFECT_NOTABLE} points d'indice)` },
  contract: { label: `Contrat ≤ ${CONTRACT_MONTHS} mois`, icon: FileClock, title: 'Fin de contrat proche : indemnité réduite ou joueur libre' },
  belowEstimate: { label: 'Marché < estimation', icon: BadgeEuro, title: `Valeur marché inférieure à l'estimation statistique (estimation ScoutVision au moins ${String(ESTIMATE_RATIO_MIN).replace('.', ',')} fois la valeur Transfermarkt). L'estimation n'est pas un prix de transfert` },
};

const LEAGUE_SCOPES: { key: LeagueScope; label: string }[] = [
  { key: 'all', label: 'Tous les championnats' },
  { key: 'other', label: 'Autres championnats' },
  { key: 'same', label: 'Notre championnat' },
  { key: 'lower', label: 'Championnats de niveau inférieur' },
];

type SortKey = 'next' | 'efficient' | 'age' | 'value' | 'complement';

const SORTS: { key: SortKey; label: string; market?: boolean; complement?: boolean }[] = [
  { key: 'next', label: 'Projection chez nous' },
  { key: 'efficient', label: 'Efficient valeur-performance', market: true },
  { key: 'age', label: 'Âge' },
  { key: 'value', label: 'Valeur', market: true },
  { key: 'complement', label: 'Complémentarité (tri secondaire)', complement: true },
];

const SCOUTVISION_ESTIMATE_TIP = 'Estimation statistique de valeur. Ce n\'est pas un prix de transfert.';
const EFFICIENT_TIP = 'Frontière valeur / performance : aucun autre candidat n\'a une projection au moins égale pour une valeur Transfermarkt au plus égale (et strictement meilleure sur l\'une des deux). Une lecture, pas un verdict commercial.';

// ============================================
// FORMATS
// ============================================

const round = (v: number) => Math.round(v);

const decimal = (v: number, digits = 1) =>
  v.toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits });

const signed = (v: number) => {
  const r = Math.round(v);
  return r === 0 ? '0' : `${r > 0 ? '+' : '−'}${Math.abs(r)}`;
};

const ordinal = (v: number) => {
  const r = Math.max(1, Math.min(100, Math.round(v)));
  return r === 1 ? '1er' : `${r}e`;
};

const formatEuros = (value: number | undefined) => (value ? formatEuro(value) : '–');

function formatMonth(date: string | undefined): string {
  const m = date?.match(/^(\d{4})-(\d{2})/);
  return m ? `${m[2]}/${m[1]}` : '–';
}

// ============================================
// ÉTAT CONSERVÉ PAR ÉQUIPE
// ============================================

interface PanelMemory {
  formation: string | null;       // formation choisie ; null : formation des besoins (recruitmentFormation)
  slot: number | null;            // numéro de case (LineupSlot.slot)
  manualPosition: string;         // poste choisi sans composition
  role: string | null;
  filters: SearchFilters;
  sort: SortKey;
}

const memory = new Map<string, PanelMemory>();

// Saison en cours : seuil de minutes abaissé, sinon seuls les championnats en année
// civile (déjà presque terminés) passeraient le filtre ; le signal « peu de minutes »
// ne marque alors que les échantillons les plus minces
const IN_PROGRESS_MIN_MINUTES = 450;
const IN_PROGRESS_FEW_MINUTES = 600;

const freshMemory = (inProgress: boolean): PanelMemory => ({
  formation: null, slot: null, manualPosition: 'CB', role: null,
  filters: { ...DEFAULT_FILTERS, ...(inProgress ? { minMinutes: IN_PROGRESS_MIN_MINUTES } : {}) }, sort: 'next',
});


// ============================================
// PETITS COMPOSANTS
// ============================================

const Card: React.FC<{ title: React.ReactNode; subtitle?: React.ReactNode; className?: string; right?: React.ReactNode; children: React.ReactNode }> = ({ title, subtitle, className = '', right, children }) => (
  <Panel title={title} subtitle={subtitle} className={className} right={right}>{children}</Panel>
);

const NeedChip: React.FC<{ level: NeedLevel }> = ({ level }) => {
  const { label, icon: Icon } = NEED_LABELS[level];
  return (
    <span className="inline-flex items-center gap-1 h-5 px-1.5 rounded border border-line-strong bg-raised text-2xs font-semibold text-ink whitespace-nowrap">
      <Icon className="w-3 h-3" style={{ color: STATUS[level] }} aria-hidden />
      {label}
    </span>
  );
};

const FlagChip: React.FC<{ label: string; title: string; icon: React.ElementType; tone?: 'default' | 'pos' }> = ({ label, title, icon: Icon, tone = 'default' }) => (
  <span title={title} className={`inline-flex items-center gap-1 h-5 px-1.5 rounded border text-2xs whitespace-nowrap ${tone === 'pos' ? 'border-accent/40 text-accent' : 'border-line-strong text-ink-2'}`}>
    <Icon className={`w-3 h-3 ${tone === 'pos' ? '' : 'text-ink-3'}`} aria-hidden />
    {label}
  </span>
);

const Avatar: React.FC<{ player?: PlayerData; name: string; size?: 'xs' | 'sm' | 'md' }> = ({ player, name, size = 'md' }) => (
  <PlayerAvatar player={player} name={name} size={size} />
);

// ============================================
// DIAGNOSTIC
// ============================================

const NeedRow: React.FC<{ need: SlotNeed; matches: number; selected: boolean; onSelect: () => void }> = ({ need, matches, selected, onSelect }) => {
  const name = need.starter?.Player ?? need.placed.starter?.name ?? '—';
  const frequent = need.placed.starter;
  return (
    <button
      onClick={onSelect}
      aria-pressed={selected}
      className={`relative w-full text-left grid grid-cols-[6rem_2.25rem_1fr_auto] items-center gap-3 px-3 py-1.5 rounded-md transition-colors ${selected ? 'bg-raised' : 'hover:bg-raised/60'}`}
    >
      {selected && <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r bg-accent" aria-hidden />}
      <NeedChip level={need.level} />
      <span className="sv-tag justify-center">{positionLabel(need.position)}</span>
      <span className="flex items-center gap-2.5 min-w-0">
        <Avatar player={need.starter} name={name} size="sm" />
        <span className="min-w-0">
          <span className="block text-[13px] text-ink font-medium truncate">{name}</span>
          <span className="block text-2xs text-ink-3 truncate">
            {need.presetName ?? positionName(need.position)}
            {need.flags.length > 0 && ' · '}
            {need.flags.map(f => NEED_FLAGS[f].label).join(' · ')}
            {need.flags.includes('outOfPosition') && need.starter && ` · ${positionName(need.starter.Position)} aligné ${positionName(need.position).toLowerCase()}`}
            {!need.forecast && !need.flags.includes('outOfPosition') && frequent && ` · titulaire le plus fréquent : ${frequent.starts} matchs sur ${matches}`}
          </span>
        </span>
      </span>
      <span className="text-right">
        {need.forecast ? (
          <>
            <span className="block text-[13px] text-ink num">
              <span className="text-ink-3">{displayIndex(need.forecast.now)} →</span> <span className="font-semibold">{displayIndex(need.forecast.next)}</span>
            </span>
            <span className="block text-2xs text-ink-3">rang {ordinal(need.rank ?? 50)} pct</span>
          </>
        ) : (
          <span className="text-2xs text-ink-4">non mesurable</span>
        )}
      </span>
    </button>
  );
};

// ============================================
// CANDIDATS
// ============================================

interface ScatterPoint {
  x: number;              // valeur Transfermarkt, M€
  y: number;              // indice projeté
  name: string;
  team: string;
  id: string;
}

const LOG_TICKS = [0.1, 0.25, 0.5, 1, 2.5, 5, 10, 25, 50, 100, 200];

const CandidateScatter: React.FC<{ candidates: Candidate[]; baseline?: number; baselineName?: string; onPick: (id: string) => void }> = ({ candidates, baseline, baselineName, onPick }) => {
  const toPoint = (c: Candidate): ScatterPoint => ({
    x: c.market!.value! / 1e6, y: Math.round(c.forecast.next * 10) / 10,
    name: c.player.Player, team: c.player.Team, id: c.player['Player ID'] ?? '',
  });
  const priced = candidates.filter(c => c.market?.value);
  const frontier = priced.filter(c => c.efficient).map(toPoint).sort((a, b) => a.x - b.x);
  const others = priced.filter(c => !c.efficient).map(toPoint);
  const unpriced = candidates.length - priced.length;
  if (priced.length === 0) return null;
  const xs = priced.map(c => c.market!.value! / 1e6);
  const lo = Math.min(...xs) / 1.3;
  const hi = Math.max(...xs) * 1.3;
  const ticks = LOG_TICKS.filter(t => t >= lo && t <= hi);
  // Indice : axe resserré sur les candidats et le titulaire (pas de barres, l'axe n'a pas à partir de 0)
  const ys = [...priced.map(c => c.forecast.next), ...(baseline !== undefined ? [baseline] : [])];
  const yLo = Math.max(0, Math.floor((Math.min(...ys) - 5) / 10) * 10);
  const yHi = Math.min(100, Math.ceil((Math.max(...ys) + 5) / 10) * 10);
  const yTicks = Array.from({ length: (yHi - yLo) / 10 + 1 }, (_, i) => yLo + 10 * i);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-2xs text-ink-3 mb-2">
        <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: BLUE }} /> Efficient valeur-performance (aucun autre n'est au moins aussi bon pour au plus le même prix) <InfoTip text={EFFICIENT_TIP} /></span>
        <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: CONTEXT }} /> Autres candidats</span>
        {baseline !== undefined && (
          <span className="inline-flex items-center gap-1.5"><span className="w-4 border-t border-dashed border-ink-3" /> {baselineName ?? 'Titulaire'}, projeté</span>
        )}
      </div>
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 10, right: 20, bottom: 24, left: 0 }}>
            <CartesianGrid stroke={INK.grid} />
            <XAxis
              type="number" dataKey="x" scale="log" domain={[lo, hi]} ticks={ticks} allowDataOverflow
              tickFormatter={(v: number) => formatEuro(v * 1e6)}
              stroke={INK.axis} tick={{ fill: INK.muted, fontSize: 11 }}
              label={{ value: 'Valeur Transfermarkt (échelle logarithmique)', position: 'insideBottom', offset: -14, fill: INK.muted, fontSize: 11 }}
            />
            <YAxis
              type="number" dataKey="y" domain={[yLo, yHi]} ticks={yTicks}
              stroke={INK.axis} tick={{ fill: INK.muted, fontSize: 11 }} width={36}
            />
            {baseline !== undefined && <ReferenceLine y={baseline} stroke={INK.muted} strokeDasharray="4 3" strokeWidth={1} />}
            <Tooltip
              cursor={false}
              content={({ payload }) => {
                const p = payload?.[0]?.payload as ScatterPoint | undefined;
                if (!p) return null;
                return (
                  <div className="sv-tooltip">
                    <div className="text-ink font-semibold text-sm num">{displayIndex(p.y)} <span className="text-2xs text-ink-3 font-normal">projection chez nous</span></div>
                    <div className="text-ink-2">{p.name}</div>
                    <div className="text-ink-3">{p.team} · {formatEuros(p.x * 1e6)}</div>
                  </div>
                );
              }}
            />
            <Scatter
              data={others} fill={CONTEXT} stroke={INK.surface} strokeWidth={2} isAnimationActive={false}
              onClick={(d: unknown) => onPick((d as { payload?: ScatterPoint }).payload?.id ?? '')}
              shape={(props: unknown) => <Dot {...(props as DotProps)} color={CONTEXT} />}
            />
            <Scatter
              data={frontier} fill={BLUE} line={{ stroke: BLUE, strokeWidth: 2 }} lineType="joint" isAnimationActive={false}
              onClick={(d: unknown) => onPick((d as { payload?: ScatterPoint }).payload?.id ?? '')}
              shape={(props: unknown) => <Dot {...(props as DotProps)} color={BLUE} />}
            />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      {unpriced > 0 && (
        <p className="text-2xs text-ink-4 mt-1">{unpriced} candidat{unpriced > 1 ? 's' : ''} sans valeur Transfermarkt connue, absent{unpriced > 1 ? 's' : ''} du graphique (présent{unpriced > 1 ? 's' : ''} dans la liste).</p>
      )}
    </div>
  );
};

interface DotProps { cx?: number; cy?: number; color: string }

// Point de 8 px avec anneau de la couleur du fond, zone de survol de 24 px
const Dot: React.FC<DotProps> = ({ cx, cy, color }) => {
  if (cx === undefined || cy === undefined) return null;
  return (
    <g style={{ cursor: 'pointer' }}>
      <circle cx={cx} cy={cy} r={12} fill="transparent" />
      <circle cx={cx} cy={cy} r={5} fill={color} stroke={INK.surface} strokeWidth={2} />
    </g>
  );
};

/**
 * Profil projeté du candidat et du titulaire, métrique par métrique (haltères) :
 * à droite = mieux (les métriques « moins c'est mieux » sont retournées)
 */
const MetricDumbbells: React.FC<{ candidate: Candidate; preset: RolePreset; incumbent?: RoleForecast; incumbentName?: string }> = ({ candidate, preset, incumbent, incumbentName }) => {
  const weights = presetWeights(preset);
  const rows = Object.entries(weights).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  const good = (v: number | undefined, w: number) => (v === undefined ? undefined : w < 0 ? 100 - v : v);
  return (
    <div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-2xs text-ink-3 mb-2">
        <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: BLUE }} /> {candidate.player.Player}, projeté chez nous</span>
        {incumbent && <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: CONTEXT }} /> {incumbentName}, projeté</span>}
      </div>
      <div className="space-y-1.5">
        {rows.map(([metric, w]) => {
          const c = good(candidate.forecast.metrics[metric]?.next, w);
          const i = good(incumbent?.metrics[metric]?.next, w);
          return (
            <div key={metric} className="grid grid-cols-[11rem_1fr_4.5rem] items-center gap-3 text-[11px]">
              <span className="text-ink-2 truncate" title={metric}>
                {metricLabel(metric)}{w < 0 && <span className="text-ink-3"> (inversé)</span>}
              </span>
              <div className="relative h-3">
                <div className="absolute top-1/2 inset-x-0 h-px bg-line-strong" /><div className="absolute top-0 bottom-0 left-1/2 w-px bg-line-strong" />
                {c !== undefined && i !== undefined && (
                  <div className="absolute top-1/2 h-px bg-ink-4" style={{ left: `${Math.min(c, i)}%`, width: `${Math.abs(c - i)}%` }} />
                )}
                {i !== undefined && <span className="absolute top-1/2 w-2.5 h-2.5 -ml-[5px] -mt-[5px] rounded-full ring-2 ring-surface" style={{ left: `${i}%`, backgroundColor: CONTEXT }} />}
                {c !== undefined && <span className="absolute top-1/2 w-2.5 h-2.5 -ml-[5px] -mt-[5px] rounded-full ring-2 ring-surface" style={{ left: `${c}%`, backgroundColor: BLUE }} />}
              </div>
              <span className="text-right text-ink-3 num">
                {c === undefined ? '–' : round(c)}{incumbent && <> / {i === undefined ? '–' : round(i)}</>}
              </span>
            </div>
          );
        })}
      </div>
      <p className="text-2xs text-ink-4 mt-2">Percentiles projetés la saison prochaine dans l'équipe (0-100, à droite = mieux). « Inversé » : moins c'est mieux, l'échelle est retournée.</p>
    </div>
  );
};

/**
 * Pourquoi cet indice : de l'indice actuel à l'indice projeté chez nous, étape par étape
 * (les parts s'additionnent, hors plafond de 100)
 */
const CASCADE_LABELS: Record<string, [string, string]> = {
  regression: ['Retour vers la moyenne', 'Un percentile extrême redescend en partie la saison suivante, quel que soit l\'âge'],
  age: ['Âge', 'Progression ou déclin moyen à cet âge et à ce poste (courbes d\'âge)'],
  league: ['Niveau du championnat', 'Écart de niveau entre son championnat et le nôtre'],
  context: ['Domination de l\'équipe', 'Domination territoriale (field tilt) de notre équipe par rapport à la sienne'],
  adaptation: ['Adaptation', 'Coût moyen d\'un changement de championnat ou de club'],
  cap: ['Plafond de l\'indice', 'L\'indice est borné à 100'],
};

const ProjectionWaterfall: React.FC<{ candidate: Candidate; noContext: boolean }> = ({ candidate, noContext }) => {
  const cascade = projectionCascade(candidate.forecast);
  let running = cascade.now;
  const rows = cascade.steps.map(step => {
    const from = running;
    running += step.shown;
    const [label, title] = CASCADE_LABELS[step.key];
    return { key: step.key, label, v: step.shown, title, lo: Math.min(from, running), hi: Math.max(from, running) };
  });
  const Row: React.FC<{ label: string; title?: string; children: React.ReactNode; value: React.ReactNode; strong?: boolean }> = ({ label, title, children, value, strong }) => (
    <div className="grid grid-cols-[10.5rem_1fr_3rem] items-center gap-3 h-6 text-xs" title={title}>
      <span className={strong ? 'text-ink font-medium' : 'text-ink-2'}>{label}</span>
      <div className="relative h-3 bg-raised/60 rounded-sm">
        <div className="absolute inset-y-0 left-1/2 w-px bg-line-strong" aria-hidden />
        {children}
      </div>
      <span className="text-right num">{value}</span>
    </div>
  );
  return (
    <div>
      <div className="sv-label mb-1.5">Pourquoi cet indice projeté</div>
      <Row label="Indice actuel" value={<span className="text-ink-2">{decimal(cascade.now)}</span>}>
        <div className="absolute inset-y-0 left-0 rounded-sm" style={{ width: `${cascade.now}%`, backgroundColor: CONTEXT }} />
      </Row>
      {rows.map(r => (
        <Row key={r.key} label={r.label} title={r.key === 'context' && noContext ? 'Domination territoriale inconnue pour son équipe ou la nôtre : le terme de contexte n\'a pas été appliqué' : r.title}
          value={r.key === 'context' && noContext ? <span className="text-2xs text-ink-4">non appliqué</span> : <Delta value={r.v} digits={1} />}>
          <div className="absolute inset-y-0.5 rounded-sm" style={{ left: `${r.lo}%`, width: `${Math.max(r.hi - r.lo, 0.6)}%`, backgroundColor: r.v >= 0 ? DIVERGING.above : DIVERGING.below }} />
        </Row>
      ))}
      <Row label="Indice projeté chez nous" strong value={<span className="text-ink font-semibold">{decimal(cascade.next)}</span>}>
        <div className="absolute inset-y-0 left-0 rounded-sm" style={{ width: `${cascade.next}%`, backgroundColor: BRAND }} />
      </Row>
      <p className="text-2xs text-ink-4 mt-1.5 num">
        {decimal(cascade.now)}{cascade.steps.map(st => ` ${st.shown < 0 ? '−' : '+'}${decimal(Math.abs(st.shown))}`).join('')} = {decimal(cascade.next)} → indice {cascade.rounded}
      </p>
    </div>
  );
};

/**
 * Incertitude de la projection : erreur absolue moyenne historique de l'indice (validation
 * hors échantillon du modèle de transfert), jamais présentée comme un intervalle
 */
const UncertaintyNote: React.FC<{ error: ReturnType<typeof projectionError>; className?: string }> = ({ error, className = '' }) => {
  if (!error) return <div className={`text-2xs text-ink-4 ${className}`}>Erreur historique indisponible (validation du modèle absente)</div>;
  const kind = error.leagueChange ? 'changements de championnat' : 'changements de club dans un même championnat';
  return (
    <div className={`flex items-center gap-1 text-2xs text-ink-3 num ${className}`}>
      MAE historique ≈ {decimal(error.mae, 0)} pts · {error.moves} transferts
      <InfoTip align="end" text={`Erreur absolue moyenne historique : ${decimal(error.mae, 2)} points d'indice sur ${error.moves} ${kind} en validation hors échantillon ${error.season}. C'est l'écart moyen observé entre l'indice projeté et l'indice réellement obtenu, pas un intervalle autour de cette projection.`} />
    </div>
  );
};

/**
 * Chaîne de décision : besoin, titulaire, candidat, projection, complémentarité, valeur
 */
const DecisionChain: React.FC<{
  need?: SlotNeed;
  position?: string;
  incumbent?: RoleForecast;
  incumbentName?: string;
  incumbentPlayer?: PlayerData;
  candidate: Candidate;
  roleName?: string;
  partnerName?: string;
  error: ReturnType<typeof projectionError>;
  hasMarket: boolean;
}> = ({ need, position, incumbent, incumbentName, incumbentPlayer, candidate: c, roleName, partnerName, error, hasMarket }) => {
  const Step: React.FC<{ n: number; label: string; children: React.ReactNode; accent?: boolean }> = ({ n, label, children, accent }) => (
    <div className={`relative min-w-0 px-3 py-2.5 ${accent ? 'bg-accent/[0.06]' : ''}`}>
      <div className="sv-label flex items-center gap-1.5 mb-1.5">
        <span className={`w-4 h-4 rounded-sm flex items-center justify-center text-[9px] font-bold ${accent ? 'bg-accent text-accent-ink' : 'bg-overlay text-ink-2'}`}>{n}</span>
        {label}
      </div>
      {children}
    </div>
  );
  const gainShown = incumbent ? displayIndex(c.forecast.next) - displayIndex(incumbent.next) : undefined;
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 2xl:grid-cols-6 border border-line rounded-md divide-x divide-line overflow-hidden [&>*]:border-line max-2xl:[&>*:nth-child(n+4)]:border-t md:max-2xl:[&>*:nth-child(4)]:border-l-0 max-md:[&>*:nth-child(n+3)]:border-t">
      <Step n={1} label="Besoin">
        <div className="flex items-center gap-1.5 flex-wrap">
          {need ? <NeedChip level={need.level} /> : <span className="sv-tag">Poste choisi</span>}
          {position && <span className="text-[13px] text-ink">{positionName(position)}</span>}
        </div>
        <div className="text-2xs text-ink-3 mt-1 truncate">Rôle : {roleName ?? '—'}{need?.rank !== undefined ? ` · titulaire au ${ordinal(need.rank)} pct` : ''}</div>
      </Step>
      <Step n={2} label="Titulaire projeté">
        {incumbent && incumbentName ? (
          <>
            <div className="flex items-center gap-2 min-w-0">
              <Avatar player={incumbentPlayer} name={incumbentName} size="xs" />
              <span className="text-[13px] text-ink truncate">{incumbentName}</span>
            </div>
            <div className="text-2xs text-ink-3 mt-1 num">indice {displayIndex(incumbent.now)} → <span className="text-ink-2 font-semibold">{displayIndex(incumbent.next)}</span> projeté</div>
          </>
        ) : need?.flags.includes('outOfPosition') && need.starter
          ? <div className="text-xs text-ink-3">{need.starter.Player}, hors poste : indice non comparable</div>
          : <div className="text-xs text-ink-4">Aucun titulaire régulier noté</div>}
      </Step>
      <Step n={3} label="Candidat" accent>
        <div className="flex items-center gap-2 min-w-0">
          <Avatar player={c.player} name={c.player.Player} size="xs" />
          <span className="text-[13px] text-ink font-medium truncate">{c.player.Player}</span>
        </div>
        <div className="text-2xs text-ink-3 mt-1 truncate">{c.player.Age ?? '?'} ans · {c.player.Team}</div>
      </Step>
      <Step n={4} label="Projection chez nous">
        <div className="flex items-baseline gap-2">
          <span className="text-lg font-semibold text-ink num leading-none">{displayIndex(c.forecast.next)}</span>
          {gainShown !== undefined && <span className="text-xs"><Delta value={gainShown} /> <span className="text-ink-4">gain projeté</span></span>}
        </div>
        <div className="text-2xs text-ink-3 mt-1 num">actuel {displayIndex(c.forecast.now)}, saison prochaine</div>
        <UncertaintyNote error={error} className="mt-0.5" />
      </Step>
      <Step n={5} label="Complémentarité">
        {c.complement && partnerName ? (
          <>
            <div className="text-[13px] text-ink num">{c.complement.mean === undefined ? '–' : `${displayIndex(c.complement.mean)}`} <span className="text-ink-3 text-2xs">pct projeté moyen</span></div>
            <div className="text-2xs text-ink-3 mt-1 truncate" title={c.complement.metrics.map(m => `${metricLabel(m.metric)} : partenaire ${Math.round(m.partner)}, candidat ${m.candidate === undefined ? '–' : Math.round(m.candidate)}`).join(' · ')}>
              sur les points faibles de {partnerName}
            </div>
          </>
        ) : <div className="text-xs text-ink-4">Sans lecture (pas de point faible marqué du partenaire)</div>}
      </Step>
      <Step n={6} label="Valeur">
        {hasMarket ? (
          <>
            <div className="text-[13px] text-ink font-medium num">{formatEuros(c.market?.value)}</div>
            {c.market?.estimated !== undefined && (
              <div className="flex items-center gap-1 text-2xs text-ink-3 num">Estimation ScoutVision : {formatEuros(c.market.estimated)} <InfoTip align="end" text={SCOUTVISION_ESTIMATE_TIP} /></div>
            )}
            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
              <span className={`text-2xs num ${c.contractMonths !== undefined && c.contractMonths <= CONTRACT_MONTHS ? 'text-warn' : 'text-ink-3'}`}>contrat {formatMonth(c.market?.contract)}</span>
              {c.efficient && <FlagChip label="Efficient valeur-performance" icon={Scale} tone="pos" title={EFFICIENT_TIP} />}
            </div>
          </>
        ) : <div className="text-xs text-ink-4">Saison passée : pas de valeur Transfermarkt</div>}
      </Step>
    </div>
  );
};

// ============================================
// PANNEAU
// ============================================

interface RecruitmentPanelProps {
  teamKey: string;                       // clé « équipe · compétition saison » (queryService)
  playerData: PlayerData[];              // lignes des saisons chargées
  teamStats: TeamStats[];
  onSelectPlayer?: (player: PlayerData) => void;
}

const RecruitmentPanel: React.FC<RecruitmentPanelProps> = ({ teamKey, playerData, teamStats, onSelectPlayer }) => {
  const [state, setState] = useState<PanelMemory>(() => {
    const first = queryService.getTeamPlayers(teamKey)[0];
    return memory.get(teamKey) ?? freshMemory(isSeasonInProgress(first ? getPlayerSeason(first) : undefined));
  });
  const [curves, setCurves] = useState<AgeCurves | null | undefined>(undefined);
  const [transfer, setTransfer] = useState<TransferModel | null | undefined>(undefined);
  const [market, setMarket] = useState<MarketValues | null | undefined>(undefined);
  const [lineups, setLineups] = useState<TeamLineups | null | undefined>(undefined);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showMethod, setShowMethod] = useState(false);

  // Monté avec key={teamKey} : l'état repart de ce qui a été choisi pour cette équipe
  useEffect(() => { memory.set(teamKey, state); }, [teamKey, state]);
  const update = (patch: Partial<PanelMemory>) => setState(s => ({ ...s, ...patch }));
  const updateFilters = (patch: Partial<SearchFilters>) => setState(s => ({ ...s, filters: { ...s.filters, ...patch } }));

  useEffect(() => {
    let cancelled = false;
    dataLoader.loadAgeCurves().then(c => { if (!cancelled) setCurves(c); }).catch(() => { if (!cancelled) setCurves(null); });
    dataLoader.loadTransferModel().then(t => { if (!cancelled) setTransfer(t); }).catch(() => { if (!cancelled) setTransfer(null); });
    dataLoader.loadMarketValues().then(m => { if (!cancelled) setMarket(m); }).catch(() => { if (!cancelled) setMarket(null); });
    return () => { cancelled = true; };
  }, []);

  // Équipe : son championnat (une coupe d'Europe renvoie au championnat de l'équipe)
  const team = useMemo(() => resolveTeamLeague(teamKey, playerData), [teamKey, playerData]);

  const ready = team && team.missingLeague === false ? team : null;
  const fewMinutes = ready?.inProgress ? IN_PROGRESS_FEW_MINUTES : FEW_MINUTES;

  useEffect(() => {
    setLineups(undefined);
    if (!ready) return;
    let cancelled = false;
    dataLoader.loadLineups(ready.season, ready.competition)
      .then(file => { if (!cancelled) setLineups(file?.[ready.teamId] ?? null); })
      .catch(() => { if (!cancelled) setLineups(null); });
    return () => { cancelled = true; };
  }, [ready?.season, ready?.competition, ready?.teamId]);

  const models: Models | null = useMemo(
    () => (curves === undefined || transfer === undefined ? null : { curves, transfer }),
    [curves, transfer],
  );
  const asOf = useMemo(() => (market?.scrapedAt ? new Date(market.scrapedAt) : new Date()), [market]);
  // Marché de la saison analysée : l'instantané Transfermarkt ne vaut que pour la saison qu'il
  // décrit (mêmes capacités que le Chasseur de pépites) ; une saison passée n'a ni valeur, ni
  // contrat, ni estimation, ni signal qui en dépend
  const caps = useMemo(() => (ready ? seasonCapabilities(ready.seasonRows) : null), [ready]);
  const seasonMkt = useMemo(() => (caps ? seasonMarket(market, caps) : null), [market, caps]);

  // Lignes de championnat de la saison : une par joueur (vivier) ; celles du championnat de l'équipe
  const pool = useMemo(() => (ready ? leagueRows(ready.seasonRows, ready.isLeague) : []), [ready]);
  const leaguePool = useMemo(() => pool.filter(p => p.Competition === ready?.competition), [pool, ready]);
  const leagueAll = useMemo(() => (ready ? ready.seasonRows.filter(p => p.Competition === ready.competition) : []), [ready]);
  const teamRows = useMemo(() => leagueAll.filter(p => p['Team ID'] === ready?.teamId), [leagueAll, ready]);

  const target: Target | null = useMemo(() => {
    if (!ready) return null;
    const tilt = teamRows.map(p => p['Team field tilt']).find(v => typeof v === 'number') as number | undefined;
    const stats = teamStats.find(t => t.team_id === ready.teamId && t.competition === ready.competition);
    const fromStats = stats?.['Field tilt'];
    return {
      teamId: ready.teamId, competition: ready.competition, tier: ready.tier,
      context: { 'Team field tilt': tilt ?? (typeof fromStats === 'number' && Number.isFinite(fromStats) ? fromStats : undefined) },
    };
  }, [ready, teamRows, teamStats]);

  // Même lecture des compositions que l'Analyse d'équipe : la plus utilisée d'abord, cases sans
  // position écartées. Les besoins se mesurent sur la plus utilisée qui donne un onze exploitable
  const formations = useMemo(() => orderFormations(lineups), [lineups]);
  const defaultFormation = useMemo(() => recruitmentFormation(formations), [formations]);
  const chosenIdx = formations.findIndex(f => f.formation === state.formation && isExploitableFormation(f));
  const formationIdx = chosenIdx >= 0 ? chosenIdx : defaultFormation?.index ?? 0;
  const formation = formations[formationIdx];
  const fallbackFrom = chosenIdx < 0 ? defaultFormation?.fallbackFrom : undefined;
  const eleven = useMemo(() => (formation ? placeEleven(formation.slots) : []), [formation]);
  const slotPositions = useMemo(() => (formation ? formationPositions(formation) : null), [formation]);
  const needs = useMemo(
    () => (models ? slotNeeds(eleven, teamRows, leaguePool, models, seasonMkt, asOf, slotPositions) : []),
    [eleven, teamRows, leaguePool, models, seasonMkt, asOf, slotPositions],
  );
  const needOrder = useMemo(() => orderNeeds(needs), [needs]);

  // Case choisie (par défaut le besoin le plus fort), poste et rôle recherchés
  const slotIndex = (() => {
    const i = needs.findIndex(n => n.placed.slot.slot === state.slot);
    return i >= 0 ? i : needOrder[0];
  })();
  const need: SlotNeed | undefined = slotIndex !== undefined ? needs[slotIndex] : undefined;
  const position = need?.position ?? (needs.length === 0 ? state.manualPosition : undefined);
  const roleOptions = useMemo(() => presetsForPosition(position), [position]);
  const roleName = (state.role && roleOptions.some(([n]) => n === state.role) ? state.role : undefined)
    ?? (need?.presetName && roleOptions.some(([n]) => n === need.presetName) ? need.presetName : roleOptions[0]?.[0]);
  const preset: RolePreset | undefined = roleName ? DEFAULT_ROLE_PRESETS[roleName] : undefined;

  const partner = slotIndex !== undefined ? slotPartner(needs, slotIndex) : undefined;
  const complements = useMemo(
    () => (partner?.starter && position ? complementFor(partner.starter, position) : []),
    [partner, position],
  );
  // Titulaire : une seule projection (ligne du besoin, chaîne, haltères, écart), sans complémentarité
  const incumbent = useMemo(
    () => (models ? incumbentForecast(need, roleName, preset, models) : undefined),
    [need, roleName, preset, models],
  );

  // Classement : projection sportive seule. La complémentarité est une lecture par candidat
  const search = useMemo(() => {
    if (!preset || !models || !target) return null;
    return searchCandidates({
      pool, preset, target, models, baseline: incumbent?.next, complements, filters: state.filters,
      market: seasonMkt, asOf, limit: 40, fewMinutes,
    });
  }, [pool, preset, target, models, incumbent, complements, state.filters, seasonMkt, asOf, fewMinutes]);
  const candidates = useMemo(() => search?.candidates ?? [], [search]);

  // Tris secondaires : la liste reste les meilleures projections, seul l'ordre change
  const sortKey: SortKey = (!seasonMkt && (state.sort === 'efficient' || state.sort === 'value'))
    || (state.sort === 'complement' && complements.length === 0) ? 'next' : state.sort;
  const sorted = useMemo(() => {
    const list = [...candidates];
    const value = (c: Candidate) => c.market?.value ?? Infinity;
    if (sortKey === 'efficient') list.sort((a, b) => Number(b.efficient) - Number(a.efficient) || b.forecast.next - a.forecast.next);
    if (sortKey === 'age') list.sort((a, b) => (Number(a.player.Age) || 99) - (Number(b.player.Age) || 99) || b.forecast.next - a.forecast.next);
    if (sortKey === 'value') list.sort((a, b) => value(a) - value(b) || b.forecast.next - a.forecast.next);
    if (sortKey === 'complement') list.sort((a, b) => (b.complement?.mean ?? -1) - (a.complement?.mean ?? -1) || b.forecast.next - a.forecast.next);
    return list;
  }, [candidates, sortKey]);

  const profile = useMemo(() => (ready ? squadProfile(ready.teamId, leagueAll) : []), [ready, leagueAll]);
  const output = useMemo(() => {
    if (!ready) return [];
    const own = teamStats.find(t => t.team_id === ready.teamId && t.competition === ready.competition);
    if (!own) return [];
    const cohort = teamCohort(own, teamStats);
    const rows: [string, keyof TeamStats, boolean, (v: number) => string][] = [
      ['xG créés / 90', 'xG per 90', true, v => v.toFixed(2)],
      ['xG concédés / 90', 'xGA per 90', false, v => v.toFixed(2)],
      ['Domination territoriale', 'Field tilt', true, v => `${v.toFixed(0)} %`],
      ['Pressing (PPDA)', 'PPDA', false, v => v.toFixed(1)],
    ];
    return rows.flatMap(([label, key, higher, fmt]) => {
      const rank = teamRank(own, cohort, key, higher);
      const v = own[key];
      return rank === undefined || typeof v !== 'number' ? [] : [{ label, rank, value: fmt(v), teams: cohort.length }];
    });
  }, [ready, teamStats]);

  // ============================================
  // RENDU
  // ============================================

  if (!team) {
    return <EmptyState title="Équipe introuvable dans les données chargées." />;
  }
  if (team.missingLeague) {
    return (
      <EmptyState icon={UserSearch} title={`${team.name} n'a pas de championnat couvert cette saison.`}>
        Le recrutement s'appuie sur le championnat de l'équipe.
      </EmptyState>
    );
  }
  if (!models || market === undefined || lineups === undefined) {
    return <div className="p-5"><Skeleton className="h-[600px]" /></div>;
  }

  const levelGap = transfer ? (c: PlayerData) => leagueLevel(transfer, c.Competition, c['League tier']) : null;
  const incumbentName = need?.starter?.Player;
  const fullAge = state.filters.minAge <= AGE_RANGE[0] && state.filters.maxAge >= AGE_RANGE[1];
  const validation = transfer?.validation;
  const candidateId = (c: Candidate) => c.player['Player ID'] ?? c.player.Player;
  const focus = sorted.find(c => candidateId(c) === expanded) ?? sorted[0];
  const errorOf = (c: Candidate) => projectionError(transfer, c.player.Competition !== ready!.competition);
  const targetTiltMissing = !!transfer && transfer.context.some(col => typeof target?.context[col] !== 'number');
  const partnerName = partner?.starter?.Player;
  const funnel = search?.funnel;
  // Joueurs de champ enregistrés gardiens (défaut de poste des données, SRB) : percentiles calculés parmi les gardiens
  const mislabelledKeepers = needs.filter(n => n.flags.includes('outOfPosition') && n.starter?.Position === 'GK').length;

  return (
    <div className="p-5 space-y-4">
      {/* Contexte et avertissements */}
      {(ready!.fromCup || ready!.inProgress || !transfer || !seasonMkt || targetTiltMissing) && (
        <div className="space-y-1.5">
          {ready!.fromCup && (
            <p className="flex items-start gap-2 text-xs text-ink-3"><Info className="w-3.5 h-3.5 mt-px shrink-0 text-ink-4" /> Analyse faite sur le championnat de l'équipe ({ready!.leagueName}) : l'entrée choisie est une coupe d'Europe.</p>
          )}
          {ready!.inProgress && (
            <p className="flex items-start gap-2 text-xs text-ink-3"><Info className="w-3.5 h-3.5 mt-px shrink-0 text-ink-4" /> Saison en cours : les percentiles reposent sur peu de matchs (seuil de minutes abaissé à {IN_PROGRESS_MIN_MINUTES}) et les championnats en année civile ont plus de recul. Recoupez avec la saison précédente (sélecteur de saison en haut) avant de juger un joueur.</p>
          )}
          {!transfer && (
            <p className="flex items-start gap-2 text-xs text-warn"><TriangleAlert className="w-3.5 h-3.5 mt-px shrink-0" /> Modèle de transfert absent (relancez scripts/prepare_data.py) : les candidats ne sont projetés qu'avec les courbes d'âge, sans tenir compte de leur championnat.</p>
          )}
          {!seasonMkt && (
            <p className="flex items-start gap-2 text-xs text-ink-3"><Info className="w-3.5 h-3.5 mt-px shrink-0 text-ink-4" /> Saison {ready!.season} : pas de valeur Transfermarkt, de contrat ni d'estimation ScoutVision. Le relevé{market?.scrapedAt ? ` du ${market.scrapedAt}` : ''} ne décrit que la saison en cours ; il n'est pas appliqué à une saison passée. Âges et percentiles restent ceux de la saison analysée.</p>
          )}
          {transfer && targetTiltMissing && (
            <p className="flex items-start gap-2 text-xs text-ink-3"><Info className="w-3.5 h-3.5 mt-px shrink-0 text-ink-4" /> Contexte équipe indisponible : la domination territoriale de {ready!.name} n'est pas connue cette saison. Le terme de contexte n'a pas été appliqué aux projections.</p>
          )}
        </div>
      )}

      {/* ===== 1. Diagnostic ===== */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <Card
          className="xl:col-span-7"
          title="Besoins par poste"
          subtitle={formation
            ? `Onze type en ${formation.formation} (${formation.matches} matchs). Indice du meilleur rôle du titulaire, actuel → projeté, et son rang parmi les joueurs du championnat éligibles à ce rôle. Cliquez sur un poste pour chercher.`
            : 'Aucune composition disponible pour cette équipe : choisissez un poste pour chercher des joueurs.'}
          right={formations.length > 1 && (
            <div className="sv-seg">
              {formations.map((f, idx) => {
                const usable = isExploitableFormation(f);
                return (
                  <button key={f.formation} onClick={() => update({ formation: f.formation, slot: null, role: null })} disabled={!usable}
                    title={usable ? undefined : `Formation insuffisamment renseignée : ${f.slots.length} case${f.slots.length > 1 ? 's' : ''} placée${f.slots.length > 1 ? 's' : ''} sur 11`}
                    aria-pressed={idx === formationIdx}
                    className={`sv-seg-btn ${idx === formationIdx ? 'sv-seg-on' : ''} ${usable ? '' : 'opacity-50 cursor-not-allowed'}`}>
                    {f.formation} <span className="text-ink-4 num">{f.matches}</span>
                  </button>
                );
              })}
            </div>
          )}
        >
          {mislabelledKeepers >= 2 && (
            <p className="flex items-start gap-2 text-xs text-warn mb-2">
              <TriangleAlert className="w-3.5 h-3.5 mt-px shrink-0" aria-hidden />
              Postes incohérents dans les données : {mislabelledKeepers} titulaires de champ sont enregistrés gardiens dans {ready!.leagueName} cette saison. Leurs percentiles sont calculés parmi les gardiens : leurs besoins ne sont pas mesurables. Les candidats restent cherchés au poste de la formation.
            </p>
          )}
          {fallbackFrom && formation && (
            <p className="flex items-start gap-2 text-xs text-ink-2 mb-2">
              <Info className="w-3.5 h-3.5 mt-px shrink-0 text-ink-4" aria-hidden />
              Formation {fallbackFrom.formation} insuffisamment renseignée. Analyse des besoins basée sur {formation.formation}.
              <InfoTip text={`La formation la plus utilisée (${fallbackFrom.formation}, ${fallbackFrom.matches} matchs) n'a que ${fallbackFrom.slots.length} case${fallbackFrom.slots.length > 1 ? 's' : ''} placée${fallbackFrom.slots.length > 1 ? 's' : ''} sur 11 dans les compositions : aucun besoin n'y est mesurable. Le Recrutement retient la formation la plus utilisée qui donne un onze exploitable.`} />
            </p>
          )}
          {needs.length > 0 ? (
            <div className="-mx-1 space-y-px">
              {needOrder.map(i => (
                <NeedRow
                  key={needs[i].placed.slot.slot}
                  need={needs[i]}
                  matches={formation?.matches ?? 0}
                  selected={i === slotIndex}
                  onSelect={() => { update({ slot: needs[i].placed.slot.slot, role: null }); setExpanded(null); }}
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {['GK', 'CB', 'FB', 'DM', 'CM', 'AM', 'W', 'ST'].map(pos => (
                <button key={pos} onClick={() => update({ manualPosition: pos, role: null })}
                  className={`sv-chip ${state.manualPosition === pos ? 'sv-chip-on' : ''}`}>
                  {positionName(pos)}
                </button>
              ))}
            </div>
          )}
          {needs.length > 0 && (
            <p className="text-2xs text-ink-4 mt-3 leading-relaxed">
              Prioritaire : titulaire projeté dans les 40 % les plus faibles du championnat. À évaluer : aucun joueur de ce poste n'a 40 % des minutes de l'équipe, ou le titulaire est aligné hors poste (ailier en latéral, par exemple) ; le besoin n'est pas mesurable. À renforcer : entre 40 et 65 %, ou titulaire plus solide mais en fin de contrat, en déclin lié à l'âge, ou poste en rotation. Solide : au-delà.
            </p>
          )}
        </Card>

        <div className="xl:col-span-5 space-y-4">
          <SquadProfilePanel profile={profile} leagueName={ready!.leagueName} />
          {output.length > 0 && (
            <div className="sv-panel grid grid-cols-2 md:grid-cols-4 xl:grid-cols-2 divide-x divide-line [&>*:nth-child(n+3)]:xl:border-t [&>*:nth-child(3)]:xl:border-l-0">
              {output.map(o => (
                <Stat key={o.label} className="px-3 py-2.5 border-line" label={o.label} value={o.value}
                  sub={<span className="inline-flex items-center gap-1.5">rang <PercentileValue value={o.rank} className="text-2xs" /></span>} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ===== 2. Profil recherché ===== */}
      {preset && position && (
        <Card
          title={<span className="flex items-center gap-1.5"><UserSearch className="w-3.5 h-3.5 text-accent" /> Profil recherché · {positionName(position)}</span>}
          subtitle={need?.starter && incumbent
            ? `Comparé au titulaire, ${need.starter.Player}, projeté dans le même rôle (${roleName}) la saison prochaine (indice ${displayIndex(incumbent.next)}).`
            : need?.flags.includes('outOfPosition') && need.starter
              ? `${need.starter.Player} est aligné hors poste : candidats au poste de la formation, sans comparaison d'indice avec lui.`
              : 'Pas de titulaire régulier noté à ce poste : les candidats sont classés par indice projeté.'}
        >
          <div className="space-y-3">
            <div>
              <div className="sv-label mb-1.5">Rôle <span className="normal-case tracking-normal font-normal text-ink-4">· indice actuel du titulaire</span></div>
              <div className="flex flex-wrap gap-1.5">
                {roleOptions.map(([name, p]) => {
                  const own = need?.starter && need.forecast && models ? forecastRole(need.starter, p, models) : undefined;
                  return (
                    <button key={name} onClick={() => update({ role: name })} title={p.description}
                      className={`sv-chip ${name === roleName ? 'sv-chip-on' : ''}`} aria-pressed={name === roleName}>
                      {name}{own && <span className="text-ink-4 num">{displayIndex(own.now)}</span>}
                    </button>
                  );
                })}
              </div>
              {preset.description && <p className="text-xs text-ink-3 mt-1.5">{preset.description}</p>}
            </div>

            {partner?.starter && (
              <div>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <span className="sv-label">Complémentarité avec {partner.starter.Player} ({positionName(partner.position)})</span>
                  <InfoTip text="Lecture séparée : points faibles du partenaire de ligne (sous le 35e percentile, métriques des rôles du poste) et réponse de chaque candidat, en percentile projeté chez nous. Rien n'est ajouté à l'indice projeté ni au classement ; le tri « Complémentarité » réordonne seulement la liste." />
                </div>
                {complements.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {complements.map(c => (
                      <span key={c.metric} className="sv-tag !font-normal">
                        {metricLabel(c.metric)}{c.weight < 0 && <span className="text-ink-4"> (inversé)</span>} <span className="text-ink-4 num">{ordinal(c.value)} pct</span>
                      </span>
                    ))}
                    <span className="text-2xs text-ink-4">Information : n'entre pas dans la projection des candidats.</span>
                  </div>
                ) : (
                  <p className="text-xs text-ink-4">Aucun point faible marqué (sous le {COMPLEMENT_THRESHOLD}e percentile) sur les métriques du poste.</p>
                )}
              </div>
            )}

            {/* Filtres : une rangée au-dessus des résultats */}
            <div className="flex flex-wrap items-end gap-3 pt-3 border-t border-line">
              <SlidersHorizontal className="w-3.5 h-3.5 text-ink-4 mb-2" aria-hidden />
              <label className="sv-label">
                Âge
                <span className="flex items-center gap-1 mt-1">
                  <input type="number" min={AGE_RANGE[0]} max={AGE_RANGE[1]} value={state.filters.minAge}
                    onChange={e => updateFilters({ minAge: Number(e.target.value) || AGE_RANGE[0] })}
                    className="sv-input sv-input-sm !w-14" aria-label="Âge minimum" />
                  <span className="text-ink-4">–</span>
                  <input type="number" min={AGE_RANGE[0]} max={AGE_RANGE[1]} value={state.filters.maxAge}
                    onChange={e => updateFilters({ maxAge: Number(e.target.value) || AGE_RANGE[1] })}
                    className="sv-input sv-input-sm !w-14" aria-label="Âge maximum" />
                </span>
              </label>
              {seasonMkt && caps?.marketValue && <label className="sv-label">
                Valeur max (M€)
                <input type="number" min={0} step={0.5} placeholder="sans limite"
                  value={state.filters.maxValue === undefined ? '' : state.filters.maxValue / 1e6}
                  onChange={e => updateFilters({ maxValue: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value)) * 1e6 })}
                  className="sv-input sv-input-sm !w-28 mt-1 block normal-case tracking-normal font-normal" />
              </label>}
              {seasonMkt && caps?.marketValue && state.filters.maxValue !== undefined && (
                <label className="flex items-center gap-1.5 text-xs text-ink-2 pb-1.5">
                  <input type="checkbox" checked={state.filters.includeUnknownValue}
                    onChange={e => updateFilters({ includeUnknownValue: e.target.checked })} />
                  garder les valeurs inconnues
                </label>
              )}
              <label className="sv-label">
                Minutes min.
                <select value={state.filters.minMinutes} onChange={e => updateFilters({ minMinutes: Number(e.target.value) })}
                  className="sv-select sv-select-sm block mt-1 normal-case tracking-normal font-normal">
                  {[0, 450, 900, 1350, 1800, 2400].map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </label>
              {seasonMkt && caps?.contract && <label className="sv-label">
                Contrat
                <select value={state.filters.contractWithinMonths ?? ''}
                  onChange={e => updateFilters({ contractWithinMonths: e.target.value === '' ? undefined : Number(e.target.value) })}
                  className="sv-select sv-select-sm block mt-1 normal-case tracking-normal font-normal">
                  <option value="">Tous</option>
                  <option value={6}>Fin ≤ 6 mois</option>
                  <option value={12}>Fin ≤ 12 mois</option>
                  <option value={24}>Fin ≤ 24 mois</option>
                </select>
              </label>}
              <label className="sv-label">
                Championnats
                <select value={state.filters.leagues} onChange={e => updateFilters({ leagues: e.target.value as LeagueScope })}
                  className="sv-select sv-select-sm block mt-1 normal-case tracking-normal font-normal">
                  {LEAGUE_SCOPES.filter(s => s.key !== 'lower' || transfer).map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </label>
              <label className="sv-label">
                Trier par
                <select value={sortKey} onChange={e => update({ sort: e.target.value as SortKey })}
                  className="sv-select sv-select-sm block mt-1 normal-case tracking-normal font-normal">
                  {SORTS.filter(o => (!o.market || seasonMkt) && (!o.complement || complements.length > 0))
                    .map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
                </select>
              </label>
              {!fullAge && <span className="text-2xs text-ink-4 pb-1.5">Âge inconnu : joueur écarté</span>}
            </div>
          </div>
        </Card>
      )}

      {/* ===== 3. Décision ===== */}
      {preset && (
        <Card
          title="Suggestions"
          subtitle={`${candidates.length} joueur${candidates.length > 1 ? 's' : ''} (40 au plus), les meilleures projections sportives dans l'équipe la saison prochaine${sortKey === 'complement' ? ` · ordre : complémentarité avec ${partnerName} (tri secondaire, la projection n'est pas modifiée)` : ''}${seasonMkt ? ` · valeurs Transfermarkt au ${market?.scrapedAt ?? '—'}` : market === null ? ' · valeurs Transfermarkt indisponibles' : ' · saison passée : pas de valeur Transfermarkt'}. Sélectionnez un candidat (ligne ou point) : la chaîne de décision et le détail de sa projection se mettent à jour.`}
        >
          {funnel && (
            <p className="text-2xs text-ink-3 mb-3 num">
              {funnel.pool.toLocaleString('fr-FR')} joueurs → {funnel.position.toLocaleString('fr-FR')} au poste → {funnel.minutes.toLocaleString('fr-FR')} minutes → {funnel.age.toLocaleString('fr-FR')} âge → {funnel.leagues.toLocaleString('fr-FR')} championnats
              {seasonMkt && <> → {funnel.budget.toLocaleString('fr-FR')} budget → {funnel.contract.toLocaleString('fr-FR')} contrat</>} → {funnel.projectable.toLocaleString('fr-FR')} projetables
              {[
                funnel.insufficientData > 0 && `${funnel.insufficientData} données insuffisantes`,
                funnel.valueUnknown > 0 && `${funnel.valueUnknown} valeur inconnue`,
                funnel.contractUnknown > 0 && `${funnel.contractUnknown} contrat inconnu`,
                funnel.ageUnknown > 0 && `${funnel.ageUnknown} âge inconnu`,
                funnel.modelUnavailable > 0 && `${funnel.modelUnavailable} modèle indisponible`,
              ].filter(Boolean).map(x => ` · exclus : ${x}`).join('')}
            </p>
          )}
          {candidates.length === 0 ? (
            <EmptyState title="Aucun joueur ne correspond aux filtres." />
          ) : (
            <div className="space-y-4">
              {focus && (
                <DecisionChain
                  need={need} position={position} incumbent={incumbent} incumbentName={incumbentName} incumbentPlayer={need?.starter}
                  candidate={focus} roleName={roleName} partnerName={partnerName} error={errorOf(focus)} hasMarket={!!seasonMkt}
                />
              )}

              <div className="grid grid-cols-1 xl:grid-cols-12 gap-x-6 gap-y-4">
                <div className="xl:col-span-5 space-y-2">
                  <div className="sv-label">Valeur et projection</div>
                  <CandidateScatter
                    candidates={candidates}
                    baseline={incumbent?.next}
                    baselineName={incumbentName}
                    onPick={id => {
                      setExpanded(id);
                      requestAnimationFrame(() => document.getElementById(`candidate-${id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
                    }}
                  />
                </div>
                {focus && (
                  <div className="xl:col-span-7 space-y-4">
                    <ProjectionWaterfall candidate={focus} noContext={focus.flags.includes('noContext')} />
                    <MetricDumbbells candidate={focus} preset={preset} incumbent={incumbent} incumbentName={incumbentName} />
                  </div>
                )}
              </div>

              <div>
                <div className="overflow-x-auto border border-line rounded-md max-h-[640px] overflow-y-auto">
                  <table className="sv-table">
                    <thead>
                      <tr>
                        <th className="pl-3">Candidat</th>
                        <th className="text-right" title="Indice du rôle projeté dans notre équipe la saison prochaine">Projection</th>
                        <th className="text-right" title="Gain projeté : projection du candidat moins celle du titulaire, dans le même rôle. Différence entre deux projections ; l'incertitude de chacune doit être prise en compte">Gain vs titulaire</th>
                        <th className="text-right" title={partnerName ? `Percentile projeté moyen du candidat sur les points faibles de ${partnerName} (lecture séparée, hors projection)` : 'Pas de partenaire de ligne avec un point faible marqué'}>Complémentarité</th>
                        <th className="text-right">{seasonMkt ? 'Valeur · contrat' : 'Valeur'}</th>
                        <th>Signaux</th>
                        <th className="w-6 pr-3" />
                      </tr>
                    </thead>
                    <tbody>
                      {sorted.map(c => {
                        const id = candidateId(c);
                        const open = expanded === id;
                        const isFocus = focus && candidateId(focus) === id;
                        return (
                          <React.Fragment key={id}>
                            <tr id={`candidate-${id}`} className={`cursor-pointer ${isFocus ? '[&>td]:!bg-raised' : ''}`}
                              onClick={() => setExpanded(open ? null : id)} aria-expanded={open}>
                              <td className="pl-3 relative">
                                {isFocus && <span className="absolute left-0 top-1 bottom-1 w-0.5 rounded-r bg-accent" aria-hidden />}
                                <div className="flex items-center gap-2.5 min-w-[13rem]">
                                  <Avatar player={c.player} name={c.player.Player} size="sm" />
                                  <div className="min-w-0">
                                    <div className="text-[13px] text-ink font-medium truncate">
                                      {c.player.Player}
                                      <span className="text-ink-4 font-normal text-2xs"> · {c.player.Age ?? '?'} ans · {positionLabel(c.player.Position)}</span>
                                    </div>
                                    <TeamLine player={c.player} className="text-2xs text-ink-3 max-w-[15rem]" />
                                  </div>
                                </div>
                              </td>
                              <td className="text-right whitespace-nowrap">
                                <div className="flex items-center justify-end gap-2">
                                  <span className="text-2xs text-ink-4 num">{displayIndex(c.forecast.now)} →</span>
                                  <span className="text-[15px] font-semibold text-ink num w-7">{displayIndex(c.forecast.next)}</span>
                                </div>
                              </td>
                              <td className="text-right">{incumbent ? <Delta value={displayIndex(c.forecast.next) - displayIndex(incumbent.next)} /> : <span className="text-ink-4">–</span>}</td>
                              <td className="text-right whitespace-nowrap">
                                {c.complement?.mean !== undefined
                                  ? <span className="text-xs text-ink-2 num" title={c.complement.metrics.map(m => `${metricLabel(m.metric)} : partenaire ${Math.round(m.partner)}, candidat ${m.candidate === undefined ? '–' : Math.round(m.candidate)}`).join(' · ')}>{displayIndex(c.complement.mean)}</span>
                                  : <span className="text-ink-4">–</span>}
                              </td>
                              <td className="text-right whitespace-nowrap">
                                {seasonMkt ? (
                                  <>
                                    <div className="text-xs text-ink num">{formatEuros(c.market?.value)}</div>
                                    {c.market?.estimated !== undefined && <div className="text-2xs text-ink-4 num" title={SCOUTVISION_ESTIMATE_TIP}>Estimation ScoutVision : {formatEuros(c.market.estimated)}</div>}
                                    <div className={`text-2xs num ${c.contractMonths !== undefined && c.contractMonths <= CONTRACT_MONTHS ? 'text-warn' : 'text-ink-4'}`}>contrat {formatMonth(c.market?.contract)}</div>
                                  </>
                                ) : <span className="text-2xs text-ink-4">saison passée</span>}
                              </td>
                              <td>
                                <div className="flex flex-wrap gap-1 min-w-[9rem] max-w-[18rem]">
                                  {c.efficient && <FlagChip label="Efficient valeur-performance" icon={Scale} tone="pos" title={EFFICIENT_TIP} />}
                                  {c.flags.map(f => (
                                    <FlagChip key={f} {...CANDIDATE_FLAGS[f]}
                                      title={f === 'fewMinutes' ? `Moins de ${fewMinutes.toLocaleString('fr-FR')} minutes cette saison : percentiles plus instables` : CANDIDATE_FLAGS[f].title} />
                                  ))}
                                </div>
                              </td>
                              <td className="pr-3 text-ink-4">
                                {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                              </td>
                            </tr>
                            {open && (
                              <tr>
                                <td colSpan={7} className="!bg-raised/40 px-4 py-2.5">
                                  <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-ink-3">
                                    <span>Minutes <span className="text-ink-2 num">{c.player['Minutes played']}</span> ({c.player['Matches played']} matchs)</span>
                                    {levelGap && c.player.Competition !== ready!.competition && (
                                      <span>
                                        Écart de niveau vers {ready!.leagueName} : <Delta value={levelGap(c.player) - leagueLevel(transfer!, ready!.competition, ready!.tier)} /> pts
                                        {' '}({transfer!.leagues[c.player.Competition ?? '']?.moves ?? 0} transferts observés)
                                      </span>
                                    )}
                                    {c.player['Team style'] && <span>Style de son équipe : <span className="text-ink-2">{String(c.player['Team style'])}</span></span>}
                                    {onSelectPlayer && (
                                      <button onClick={e => { e.stopPropagation(); onSelectPlayer(c.player); }} className="sv-btn sv-btn-primary sv-btn-sm ml-auto">
                                        Fiche du joueur <ExternalLink className="w-3 h-3" />
                                      </button>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </Card>
      )}

      {/* ===== Méthode ===== */}
      <section className="sv-panel">
        <button onClick={() => setShowMethod(v => !v)} className="w-full flex items-center justify-between px-4 py-3 text-left" aria-expanded={showMethod}>
          <span className="text-xs font-semibold uppercase tracking-[0.08em] text-ink flex items-center gap-1.5"><Info className="w-3.5 h-3.5 text-ink-3" /> Méthode et fiabilité</span>
          {showMethod ? <ChevronDown className="w-4 h-4 text-ink-3" /> : <ChevronRight className="w-4 h-4 text-ink-3" />}
        </button>
        {showMethod && (
          <div className="px-4 pb-4 grid grid-cols-1 lg:grid-cols-2 gap-6 text-xs text-ink-3 leading-relaxed">
            <div className="space-y-3">
              <p>
                <span className="text-ink font-semibold">Projection.</span> Chaque percentile d'un candidat est projeté à la saison
                suivante (retour vers la moyenne et âge, courbes d'âge), puis traduit vers notre équipe : écart de niveau entre les
                championnats, domination territoriale de notre équipe par rapport à la sienne, coût moyen d'adaptation d'un changement
                de championnat ou de club. L'indice du rôle (rôles du Chasseur de pépites) est recalculé sur ces percentiles projetés,
                et comparé à celui du titulaire, projeté de la même façon sans changement de club. La cascade est affichée au dixième
                (arrondi cumulé) : elle tombe exactement sur la projection, sans modifier le calcul.
              </p>
              <p>
                <span className="text-ink font-semibold">Complémentarité.</span> Points faibles du partenaire de ligne et réponse du
                candidat, en lecture séparée : rien n'est ajouté à la projection ni au classement. Le tri « Complémentarité »
                réordonne seulement les meilleures projections.
              </p>
              <p>
                <span className="text-ink font-semibold">Contexte.</span> Sans domination territoriale connue pour l'une des deux
                équipes, le terme de contexte vaut 0 et le candidat est signalé « Contexte équipe indisponible ». Un terme d'au moins{' '}
                {CONTEXT_EFFECT_NOTABLE} points d'indice (environ le 95e centile des candidats évalués) est signalé « Effet de contexte
                important » ; il n'est pas plafonné.
              </p>
              {transfer && (
                <p>
                  <span className="text-ink font-semibold">Calibrage.</span> {transfer.pairs.toLocaleString('fr-FR')} paires de saisons
                  consécutives au même poste, dont {transfer.movers.toLocaleString('fr-FR')} changements de championnat et{' '}
                  {transfer.clubChanges.toLocaleString('fr-FR')} changements de club dans un même championnat.
                </p>
              )}
              {validation?.index && (
                <p>
                  <span className="text-ink font-semibold">Validation hors échantillon</span> (saison {validation.season}, absente de
                  l'ajustement, {validation.movers} changements de championnat) : erreur moyenne de l'indice de rôle{' '}
                  {decimal(validation.index.movers.model)} points, contre {decimal(validation.index.movers.persistence)} en reprenant
                  l'indice actuel et {decimal(validation.index.movers.development)} avec les seules courbes d'âge ; corrélation de rang avec
                  l'indice réellement obtenu {decimal(validation.index.rankMovers.model, 2)} contre{' '}
                  {decimal(validation.index.rankMovers.persistence, 2)} ; biais des montées de niveau{' '}
                  {decimal(validation.index.biasUp.model)} point contre {decimal(validation.index.biasUp.persistence)} (prévu moins observé).
                </p>
              )}
              <p>
                <span className="text-ink font-semibold">Limites.</span> Un percentile varie beaucoup d'une saison à l'autre : la
                liste est un point de départ pour la vidéo et le scouting, pas un verdict. Les joueurs qui changent de club sont
                sélectionnés (ceux qui ont convaincu), les coéquipiers, le système et la santé ne sont pas modélisés, et les valeurs
                Transfermarkt sont une estimation du marché, pas un prix. Le relevé Transfermarkt (valeur, contrat, estimation
                ScoutVision) ne décrit que la saison en cours : il n'est jamais appliqué à une saison passée.
              </p>
              <p>
                <span className="text-ink font-semibold">Recherche</span> (release « recherche ») : transférabilité limitée de la
                performance et contexte d'équipe, recrutement multicritère sous budget (frontière valeur / performance), complémentarité au sein
                d'une ligne, liste courte et décision humaine.
              </p>
            </div>
            {transfer && (
              <div>
                <div className="text-ink font-semibold mb-1">Traduction vers {ready!.leagueName}</div>
                <p className="mb-3">
                  Écart moyen de percentile attendu pour un joueur qui rejoint {ready!.leagueName} depuis chaque championnat (moyenne des
                  métriques). Les percentiles PitchAPI sont calculés par niveau (1, 2, 3) : c'est une traduction, pas un classement de force.
                </p>
                <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 gap-y-1 max-h-72 overflow-y-auto pr-2">
                  <span className="sv-label">Championnat</span>
                  <span className="sv-label text-right">Écart</span>
                  <span className="sv-label text-right">Transferts</span>
                  {Object.entries(transfer.leagues).map(([key, l]) => (
                    <React.Fragment key={key}>
                      <span className={key === ready!.competition ? 'text-ink' : ''}><CompetitionBadge competition={key} /></span>
                      <span className="text-right num">{key === ready!.competition ? '—' : <Delta value={l.level - leagueLevel(transfer, ready!.competition, ready!.tier)} />}</span>
                      <span className="text-right num">{l.moves}</span>
                    </React.Fragment>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
};

export default RecruitmentPanel;
