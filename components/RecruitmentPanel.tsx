/**
 * ScoutVision AI - Recrutement
 * Diagnostic de l'équipe (besoins par poste du onze type, profil de l'effectif) et
 * suggestions de joueurs projetés dans l'équipe la saison suivante : modèle de transfert
 * de scripts/models.py (niveau des championnats, domination de l'équipe, coût
 * d'adaptation) sur les courbes d'âge, calculs dans utils/recruitment.ts.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  BadgeEuro, ChevronDown, ChevronRight, CircleAlert, CircleCheck, CircleHelp, Clock, ExternalLink, FileClock, Info,
  Microscope, Repeat, Scale, SlidersHorizontal, TrendingDown, TriangleAlert, Users, UserSearch,
} from 'lucide-react';
import { CartesianGrid, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from 'recharts';
import { PlayerData, TeamStats, getPlayerSeason } from '../types';
import { AgeCurves, MarketValues, TeamLineups, TransferModel, dataLoader } from '../services/dataLoader';
import { queryService } from '../services/queryService';
import { DEFAULT_ROLE_PRESETS, RolePreset, presetWeights, presetsForPosition } from '../utils/rolePresets';
import { placeEleven } from '../utils/lineup';
import {
  Candidate, CandidateFlag, DEFAULT_FILTERS, LeagueScope, Models, NeedFlag, NeedLevel, SearchFilters, SlotNeed,
  Target, complementFor, forecastRole, leagueLevel, leagueRows, needOrder as orderNeeds, peerIndices, rankCandidates,
  slotNeeds, slotPartner, squadProfile, teamRank, AGE_RANGE, COMPLEMENT_THRESHOLD, CONTRACT_MONTHS, FEW_MINUTES,
} from '../utils/recruitment';
import { metricLabel, positionLabel, positionName } from '../utils/labels';
import { CompetitionBadge, PhotoOverlay, TeamLine, TeamLogo } from './Media';

// Couleurs des graphiques (référence dataviz, validées sur le fond de l'app) :
// paire divergente bleu / rouge autour de la médiane, gris de contexte pour la forme
// « emphase », palette de statut réservée aux niveaux de besoin (toujours avec icône et libellé)
const BLUE = '#3987e5';
const RED = '#e66767';
const CONTEXT = '#78716c';
// « À évaluer » n'est pas un statut : icône neutre
const STATUS: Record<NeedLevel, string> = { high: '#d03b3b', unknown: '#94a3b8', medium: '#fab219', low: '#0ca30c' };

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
};

const CANDIDATE_FLAGS: Record<CandidateFlag, { label: string; icon: React.ElementType; title: string }> = {
  bigStep: { label: 'Gros saut de niveau', icon: TrendingDown, title: 'Le changement de championnat coûte au moins 5 points d\'indice' },
  rareLeague: { label: 'Championnat peu observé', icon: Microscope, title: 'Moins de 15 transferts observés depuis ou vers ce championnat : traduction moins sûre' },
  fewMinutes: { label: 'Peu de minutes', icon: Clock, title: 'Peu de minutes cette saison : percentiles plus instables' },
  contract: { label: `Contrat ≤ ${CONTRACT_MONTHS} mois`, icon: FileClock, title: 'Fin de contrat proche : indemnité réduite ou joueur libre' },
  undervalued: { label: 'Sous-coté', icon: BadgeEuro, title: 'Valeur estimée par la performance au moins 1,5 fois la valeur Transfermarkt' },
};

const LEAGUE_SCOPES: { key: LeagueScope; label: string }[] = [
  { key: 'all', label: 'Tous les championnats' },
  { key: 'other', label: 'Autres championnats' },
  { key: 'same', label: 'Notre championnat' },
  { key: 'lower', label: 'Championnats de niveau inférieur' },
];

type SortKey = 'next' | 'efficient' | 'age' | 'value';

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'next', label: 'Indice projeté' },
  { key: 'efficient', label: 'Qualité-prix' },
  { key: 'age', label: 'Âge' },
  { key: 'value', label: 'Valeur' },
];

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

function formatEuros(value: number | undefined): string {
  if (!value) return '–';
  if (value >= 1e6) return `€${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `€${Math.round(value / 1e3)}K`;
  return `€${value}`;
}

function formatMonth(date: string | undefined): string {
  const m = date?.match(/^(\d{4})-(\d{2})/);
  return m ? `${m[2]}/${m[1]}` : '–';
}

// ============================================
// ÉTAT CONSERVÉ PAR ÉQUIPE
// ============================================

interface PanelMemory {
  formationIdx: number;
  slot: number | null;            // numéro de case (LineupSlot.slot)
  manualPosition: string;         // poste choisi sans composition
  role: string | null;
  useComplements: boolean;
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
  formationIdx: 0, slot: null, manualPosition: 'CB', role: null, useComplements: true,
  filters: { ...DEFAULT_FILTERS, ...(inProgress ? { minMinutes: IN_PROGRESS_MIN_MINUTES } : {}) }, sort: 'next',
});

/**
 * La saison d'une équipe est-elle la saison en cours (la plus récente des données) ?
 */
function isSeasonInProgress(season: string | undefined): boolean {
  const seasons = dataLoader.getCachedIndex()?.seasons ?? [];
  return season !== undefined && seasons[seasons.length - 1]?.id === season;
}

// ============================================
// PETITS COMPOSANTS
// ============================================

const Card: React.FC<{ title: React.ReactNode; subtitle?: React.ReactNode; className?: string; children: React.ReactNode }> = ({ title, subtitle, className = '', children }) => (
  <section className={`bg-surface border border-line rounded-lg p-5 ${className}`}>
    <h3 className="text-sm font-bold text-ink uppercase tracking-wider">{title}</h3>
    {subtitle && <p className="text-xs text-ink-3 mt-1">{subtitle}</p>}
    <div className="mt-4">{children}</div>
  </section>
);

const NeedChip: React.FC<{ level: NeedLevel }> = ({ level }) => {
  const { label, icon: Icon } = NEED_LABELS[level];
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-line-strong bg-raised text-[11px] font-semibold text-ink whitespace-nowrap">
      <Icon className="w-3.5 h-3.5" style={{ color: STATUS[level] }} aria-hidden />
      {label}
    </span>
  );
};

const FlagChip: React.FC<{ label: string; title: string; icon: React.ElementType }> = ({ label, title, icon: Icon }) => (
  <span title={title} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-line-strong/70 text-[10px] text-ink-2 whitespace-nowrap">
    <Icon className="w-3 h-3 text-ink-3" aria-hidden />
    {label}
  </span>
);

const Avatar: React.FC<{ player?: PlayerData; name: string; size?: string }> = ({ player, name, size = 'w-9 h-9' }) => (
  <div className={`relative overflow-hidden ${size} rounded-full bg-overlay flex items-center justify-center text-[10px] font-bold text-ink-3 shrink-0`}>
    {name.substring(0, 2).toUpperCase()}
    <PhotoOverlay src={player?.Image} alt={name} />
  </div>
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
      className={`w-full text-left grid grid-cols-[6.5rem_2.5rem_1fr_auto] items-center gap-3 px-3 py-2.5 rounded-md border transition-colors ${selected ? 'border-accent/50 bg-accent/5' : 'border-transparent hover:bg-raised'}`}
    >
      <NeedChip level={need.level} />
      <span className="text-xs font-bold text-ink-3 text-center">{positionLabel(need.position)}</span>
      <span className="flex items-center gap-2.5 min-w-0">
        <Avatar player={need.starter} name={name} size="w-8 h-8" />
        <span className="min-w-0">
          <span className="block text-sm text-ink font-medium truncate">{name}</span>
          <span className="block text-[11px] text-ink-3 truncate">
            {need.presetName ?? positionName(need.position)}
            {need.flags.length > 0 && ' · '}
            {need.flags.map(f => NEED_FLAGS[f].label).join(' · ')}
            {!need.forecast && frequent && ` · titulaire le plus fréquent : ${frequent.starts} matchs sur ${matches}`}
          </span>
        </span>
      </span>
      <span className="text-right">
        {need.forecast ? (
          <>
            <span className="block text-sm font-mono text-ink tabular-nums">
              {round(need.forecast.now)} <span className="text-ink-3">→</span> {round(need.forecast.next)}
            </span>
            <span className="block text-[11px] text-ink-3">{ordinal(need.rank ?? 50)} percentile</span>
          </>
        ) : (
          <span className="text-[11px] text-ink-3">non mesurable</span>
        )}
      </span>
    </button>
  );
};

const DivergingRow: React.FC<{ label: string; rank: number; detail: string }> = ({ label, rank, detail }) => {
  const above = rank >= 50;
  const width = Math.abs(rank - 50);
  return (
    <div className="grid grid-cols-[7.5rem_1fr_3rem] items-center gap-3" title={detail}>
      <span className="text-xs text-ink-2 truncate">{label}</span>
      <div className="relative h-2.5">
        <div className="absolute inset-y-0 left-1/2 w-px bg-ink-4" />
        <div
          className={`absolute inset-y-0 ${above ? 'left-1/2 rounded-r' : 'right-1/2 rounded-l'}`}
          style={{ width: `${width}%`, backgroundColor: above ? BLUE : RED }}
        />
      </div>
      <span className="text-xs font-mono text-ink-2 text-right tabular-nums">{ordinal(rank)}</span>
    </div>
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
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[11px] text-ink-3 mb-2">
        <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: BLUE }} /> Meilleur rapport qualité-prix (personne n'est meilleur pour moins cher)</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: CONTEXT }} /> Autres candidats</span>
        {baseline !== undefined && (
          <span className="inline-flex items-center gap-1.5"><span className="w-4 h-px bg-ink-3" /> {baselineName ?? 'Titulaire'}, projeté</span>
        )}
      </div>
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 10, right: 20, bottom: 24, left: 0 }}>
            <CartesianGrid stroke="#1e293b" />
            <XAxis
              type="number" dataKey="x" scale="log" domain={[lo, hi]} ticks={ticks} allowDataOverflow
              tickFormatter={(v: number) => `€${v < 1 ? `${Math.round(v * 1000)}K` : `${v}M`}`}
              stroke="#334155" tick={{ fill: '#94a3b8', fontSize: 11 }}
              label={{ value: 'Valeur Transfermarkt (échelle logarithmique)', position: 'insideBottom', offset: -14, fill: '#64748b', fontSize: 11 }}
            />
            <YAxis
              type="number" dataKey="y" domain={[yLo, yHi]} ticks={yTicks}
              stroke="#334155" tick={{ fill: '#94a3b8', fontSize: 11 }} width={36}
            />
            {baseline !== undefined && <ReferenceLine y={baseline} stroke="#94a3b8" strokeWidth={1} />}
            <Tooltip
              cursor={false}
              content={({ payload }) => {
                const p = payload?.[0]?.payload as ScatterPoint | undefined;
                if (!p) return null;
                return (
                  <div className="bg-raised border border-line-strong rounded-md px-3 py-2 text-xs">
                    <div className="text-ink font-bold text-sm">{round(p.y)}</div>
                    <div className="text-ink-2">{p.name}</div>
                    <div className="text-ink-3">{p.team} · {formatEuros(p.x * 1e6)}</div>
                  </div>
                );
              }}
            />
            <Scatter
              data={others} fill={CONTEXT} stroke="#020617" strokeWidth={2} isAnimationActive={false}
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
        <p className="text-[11px] text-ink-3 mt-1">{unpriced} candidat{unpriced > 1 ? 's' : ''} sans valeur Transfermarkt connue, absent{unpriced > 1 ? 's' : ''} du graphique (présent{unpriced > 1 ? 's' : ''} dans la liste).</p>
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
      <circle cx={cx} cy={cy} r={5} fill={color} stroke="#020617" strokeWidth={2} />
    </g>
  );
};

/**
 * Profil projeté du candidat et du titulaire, métrique par métrique (haltères) :
 * à droite = mieux (les métriques « moins c'est mieux » sont retournées)
 */
const MetricDumbbells: React.FC<{ candidate: Candidate; preset: RolePreset; extraWeights: Record<string, number>; incumbent?: ReturnType<typeof forecastRole>; incumbentName?: string }> = ({ candidate, preset, extraWeights, incumbent, incumbentName }) => {
  const weights = { ...presetWeights(preset) };
  Object.entries(extraWeights).forEach(([k, w]) => { weights[k] = (weights[k] ?? 0) + w; });
  const rows = Object.entries(weights).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  const good = (v: number | undefined, w: number) => (v === undefined ? undefined : w < 0 ? 100 - v : v);
  return (
    <div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-3 mb-2">
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
                <div className="absolute top-1/2 inset-x-0 h-px bg-overlay" />
                {c !== undefined && i !== undefined && (
                  <div className="absolute top-1/2 h-px bg-ink-4" style={{ left: `${Math.min(c, i)}%`, width: `${Math.abs(c - i)}%` }} />
                )}
                {i !== undefined && <span className="absolute top-1/2 w-2.5 h-2.5 -ml-[5px] -mt-[5px] rounded-full ring-2 ring-surface" style={{ left: `${i}%`, backgroundColor: CONTEXT }} />}
                {c !== undefined && <span className="absolute top-1/2 w-2.5 h-2.5 -ml-[5px] -mt-[5px] rounded-full ring-2 ring-surface" style={{ left: `${c}%`, backgroundColor: BLUE }} />}
              </div>
              <span className="text-right font-mono text-ink-3 tabular-nums">
                {c === undefined ? '–' : round(c)}{incumbent && <> / {i === undefined ? '–' : round(i)}</>}
              </span>
            </div>
          );
        })}
      </div>
      <p className="text-[10px] text-ink-3 mt-2">Percentiles projetés la saison prochaine dans l'équipe (0-100, à droite = mieux). « Inversé » : moins c'est mieux, l'échelle est retournée.</p>
    </div>
  );
};

const PartsLine: React.FC<{ candidate: Candidate }> = ({ candidate }) => {
  const { parts } = candidate.forecast;
  const items: [string, number, string][] = [
    ['Retour vers la moyenne', parts.regression, 'Un percentile extrême redescend en partie la saison suivante, quel que soit l\'âge'],
    ['Âge', parts.age, 'Progression ou déclin moyen à cet âge et à ce poste (courbes d\'âge)'],
    ['Niveau du championnat', parts.league, 'Écart de niveau entre son championnat et le nôtre'],
    ['Domination de l\'équipe', parts.context, 'Domination territoriale (field tilt) de notre équipe par rapport à la sienne'],
    ['Adaptation', parts.adaptation, 'Coût moyen d\'un changement de championnat ou de club'],
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-3">
      <span>Indice actuel <span className="font-mono text-ink">{round(candidate.forecast.now)}</span></span>
      {items.map(([label, v, title]) => (
        <span key={label} title={title}>{label} <span className="font-mono text-ink">{signed(v)}</span></span>
      ))}
      <span>= projeté <span className="font-mono text-ink font-bold">{round(candidate.forecast.next)}</span></span>
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
  const team = useMemo(() => {
    const first = queryService.getTeamPlayers(teamKey)[0];
    if (!first?.['Team ID']) return null;
    const season = getPlayerSeason(first);
    const isLeague = (c: string) => (dataLoader.getCompetition(c)?.type ?? 'league') === 'league';
    const seasonRows = playerData.filter(p => getPlayerSeason(p) === season);
    let competition = first.Competition;
    const fromCup = !competition || !isLeague(competition);
    if (fromCup) {
      const minutes = new Map<string, number>();
      seasonRows.forEach(p => {
        if (p['Team ID'] === first['Team ID'] && p.Competition && isLeague(p.Competition)) {
          minutes.set(p.Competition, (minutes.get(p.Competition) ?? 0) + (Number(p['Minutes played']) || 0));
        }
      });
      competition = [...minutes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    }
    if (!competition) return { missingLeague: true as const, name: first.Team, cup: first.Competition };
    const info = dataLoader.getCompetition(competition);
    return {
      missingLeague: false as const,
      teamId: first['Team ID'], name: first.Team, logo: first['Team logo'] as string | undefined,
      season, competition, leagueName: info?.name ?? competition,
      tier: info?.tier ?? (typeof first['League tier'] === 'number' ? first['League tier'] : 2),
      fromCup, cup: first.Competition, seasonRows, isLeague,
      inProgress: isSeasonInProgress(season),
    };
  }, [teamKey, playerData]);

  const ready = team && !team.missingLeague ? team : null;
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

  // Lignes de championnat de la saison : une par joueur (vivier) ; celles du championnat de l'équipe
  const pool = useMemo(() => (ready ? leagueRows(ready.seasonRows, ready.isLeague) : []), [ready]);
  const leaguePool = useMemo(() => pool.filter(p => p.Competition === ready?.competition), [pool, ready]);
  const leagueAll = useMemo(() => (ready ? ready.seasonRows.filter(p => p.Competition === ready.competition) : []), [ready]);
  const teamRows = useMemo(() => leagueAll.filter(p => p['Team ID'] === ready?.teamId), [leagueAll, ready]);

  const target: Target | null = useMemo(() => {
    if (!ready) return null;
    const tilt = teamRows.map(p => p['Team field tilt']).find(v => typeof v === 'number') as number | undefined;
    const stats = teamStats.find(t => t.team_id === ready.teamId && t.competition === ready.competition);
    return {
      teamId: ready.teamId, competition: ready.competition, tier: ready.tier,
      context: { 'Team field tilt': tilt ?? stats?.['Field tilt'] },
    };
  }, [ready, teamRows, teamStats]);

  const formations = lineups?.formations ?? [];
  const formationIdx = Math.min(state.formationIdx, Math.max(0, formations.length - 1));
  const formation = formations[formationIdx];
  const eleven = useMemo(() => (formation ? placeEleven(formation.slots) : []), [formation]);
  const needs = useMemo(
    () => (models ? slotNeeds(eleven, teamRows, leaguePool, models, market ?? null, asOf) : []),
    [eleven, teamRows, leaguePool, models, market, asOf],
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
  const extraWeights = useMemo(
    () => (state.useComplements ? Object.fromEntries(complements.map(c => [c.metric, c.weight])) : {}),
    [complements, state.useComplements],
  );

  const incumbent = useMemo(
    () => (need?.starter && preset && models ? forecastRole(need.starter, preset, models, undefined, extraWeights) : undefined),
    [need, preset, models, extraWeights],
  );
  const peers = useMemo(
    () => (preset && models ? peerIndices(leaguePool, preset, models, extraWeights) : []),
    [leaguePool, preset, models, extraWeights],
  );

  const candidates = useMemo(() => {
    if (!preset || !models || !target) return [];
    return rankCandidates({
      pool, preset, target, models, peers, baseline: incumbent?.next, extraWeights,
      // Sans données de marché, pas de plafond de valeur (il écarterait tout le monde)
      filters: market ? state.filters : { ...state.filters, maxValue: undefined },
      market: market ?? null, asOf, limit: 40, fewMinutes,
    });
  }, [pool, preset, target, models, peers, incumbent, extraWeights, state.filters, market, asOf, fewMinutes]);

  const sorted = useMemo(() => {
    const list = [...candidates];
    const value = (c: Candidate) => c.market?.value ?? Infinity;
    if (state.sort === 'efficient') list.sort((a, b) => Number(b.efficient) - Number(a.efficient) || b.forecast.next - a.forecast.next);
    if (state.sort === 'age') list.sort((a, b) => (Number(a.player.Age) || 99) - (Number(b.player.Age) || 99) || b.forecast.next - a.forecast.next);
    if (state.sort === 'value') list.sort((a, b) => value(a) - value(b) || b.forecast.next - a.forecast.next);
    return list;
  }, [candidates, state.sort]);

  const profile = useMemo(() => (ready ? squadProfile(ready.teamId, leagueAll) : []), [ready, leagueAll]);
  const output = useMemo(() => {
    if (!ready) return [];
    const own = teamStats.find(t => t.team_id === ready.teamId && t.competition === ready.competition);
    if (!own) return [];
    const cohort = teamStats.filter(t => t.competition === ready.competition && t.league === own.league);
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
    return <div className="p-8 text-ink-3">Équipe introuvable dans les données chargées.</div>;
  }
  if (team.missingLeague) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-ink-3 text-center px-6">
        <UserSearch className="w-12 h-12 mb-3 opacity-20" />
        <p>{team.name} n'a pas de championnat couvert cette saison : le recrutement s'appuie sur le championnat de l'équipe.</p>
      </div>
    );
  }
  if (!models || market === undefined || lineups === undefined) {
    return <div className="h-full min-h-[600px] bg-raised animate-pulse" />;
  }

  const levelGap = transfer ? (c: PlayerData) => leagueLevel(transfer, c.Competition, c['League tier']) : null;
  const incumbentName = need?.starter?.Player;
  const fullAge = state.filters.minAge <= AGE_RANGE[0] && state.filters.maxAge >= AGE_RANGE[1];
  const validation = transfer?.validation;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* En-tête */}
      <div className="flex flex-wrap items-center gap-4">
        <TeamLogo src={ready!.logo} name={ready!.name} size="lg" />
        <div className="min-w-0">
          <h2 className="text-2xl font-bold text-ink">Recrutement · {ready!.name}</h2>
          <div className="flex flex-wrap items-center gap-2 text-sm text-ink-3 mt-1">
            <CompetitionBadge competition={ready!.competition} />
            <span>· saison {ready!.season} · projection pour la saison suivante</span>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        {ready!.fromCup && (
          <p className="flex items-start gap-2 text-xs text-ink-3"><Info className="w-4 h-4 shrink-0 text-ink-3" /> Analyse faite sur le championnat de l'équipe ({ready!.leagueName}) : l'entrée choisie est une coupe d'Europe.</p>
        )}
        {ready!.inProgress && (
          <p className="flex items-start gap-2 text-xs text-ink-3"><Info className="w-4 h-4 shrink-0 text-ink-3" /> Saison en cours : les percentiles reposent sur peu de matchs (seuil de minutes abaissé à {IN_PROGRESS_MIN_MINUTES}) et les championnats en année civile ont plus de recul. Recoupez avec la saison précédente (sélecteur de saison en haut) avant de juger un joueur.</p>
        )}
        {!transfer && (
          <p className="flex items-start gap-2 text-xs text-warn"><TriangleAlert className="w-4 h-4 shrink-0" /> Modèle de transfert absent (relancez scripts/prepare_data.py) : les candidats ne sont projetés qu'avec les courbes d'âge, sans tenir compte de leur championnat.</p>
        )}
      </div>

      {/* Diagnostic */}
      <div className="grid grid-cols-1 xl:grid-cols-[1.35fr_1fr] gap-6">
        <Card
          title="Besoins par poste"
          subtitle={formation
            ? `Onze type en ${formation.formation} (${formation.matches} matchs). Indice du meilleur rôle du titulaire, actuel → projeté la saison prochaine, et son rang parmi les joueurs du championnat éligibles à ce rôle.`
            : 'Aucune composition disponible pour cette équipe : choisissez un poste pour chercher des joueurs.'}
        >
          {formations.length > 1 && (
            <div className="flex flex-wrap gap-2 mb-3">
              {formations.map((f, idx) => (
                <button
                  key={f.formation}
                  onClick={() => update({ formationIdx: idx, slot: null, role: null })}
                  className={`px-3 py-1 rounded-full text-xs border ${idx === formationIdx ? 'bg-accent/10 border-accent/40 text-accent font-semibold' : 'border-line-strong text-ink-3 hover:text-ink'}`}
                >
                  {f.formation} <span className="text-ink-3">· {f.matches}</span>
                </button>
              ))}
            </div>
          )}
          {needs.length > 0 ? (
            <div className="space-y-1">
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
            <div className="flex flex-wrap gap-2">
              {['GK', 'CB', 'FB', 'DM', 'CM', 'AM', 'W', 'ST'].map(pos => (
                <button
                  key={pos}
                  onClick={() => update({ manualPosition: pos, role: null })}
                  className={`px-3 py-1.5 rounded-md text-xs border ${state.manualPosition === pos ? 'bg-accent/10 border-accent/40 text-accent font-semibold' : 'border-line-strong text-ink-3 hover:text-ink'}`}
                >
                  {positionName(pos)}
                </button>
              ))}
            </div>
          )}
          {needs.length > 0 && (
            <p className="text-[11px] text-ink-3 mt-3 leading-relaxed">
              Prioritaire : titulaire projeté dans les 40 % les plus faibles du championnat. À évaluer : aucun joueur de ce poste n'a 40 % des minutes de l'équipe, le besoin n'est pas mesurable. À renforcer : entre 40 et 65 %, ou titulaire plus solide mais en fin de contrat, en déclin lié à l'âge, ou poste en rotation. Solide : au-delà.
            </p>
          )}
        </Card>

        <div className="space-y-6">
          <Card
            title="Profil de l'effectif"
            subtitle={`Rang parmi les équipes de ${ready!.leagueName} : moyenne des percentiles des joueurs (chacun comparé aux joueurs de son rôle), pondérée par les minutes.`}
          >
            {profile.length > 0 ? (
              <>
                <div className="flex gap-4 text-[11px] text-ink-3 mb-3">
                  <span className="inline-flex items-center gap-1.5"><span className="w-3 h-2 rounded-sm" style={{ backgroundColor: BLUE }} /> Au-dessus de la médiane</span>
                  <span className="inline-flex items-center gap-1.5"><span className="w-3 h-2 rounded-sm" style={{ backgroundColor: RED }} /> En dessous</span>
                </div>
                <div className="space-y-2.5">
                  {profile.map(d => (
                    <DivergingRow key={d.key} label={d.label} rank={d.rank}
                      detail={`${d.label} : moyenne ${round(d.value)}, rang ${ordinal(d.rank)} percentile sur ${d.teams} équipes`} />
                  ))}
                </div>
              </>
            ) : <p className="text-sm text-ink-3">Pas assez de données de joueurs.</p>}
          </Card>
          {output.length > 0 && (
            <div className="grid grid-cols-2 gap-3">
              {output.map(o => (
                <div key={o.label} className="bg-surface border border-line rounded-md p-3">
                  <div className="text-[11px] text-ink-3">{o.label}</div>
                  <div className="text-lg font-semibold text-ink">{o.value}</div>
                  <div className="text-[11px] text-ink-3">{ordinal(o.rank)} percentile du championnat</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Profil recherché */}
      {preset && position && (
        <Card
          title={<span className="flex items-center gap-2"><UserSearch className="w-4 h-4 text-accent" /> Profil recherché · {positionName(position)}</span>}
          subtitle={need?.starter && incumbent
            ? `Comparé au titulaire, ${need.starter.Player}, projeté dans le même rôle la saison prochaine (indice ${round(incumbent.next)}).`
            : 'Pas de titulaire régulier noté à ce poste : les candidats sont classés par indice projeté.'}
        >
          <div className="space-y-4">
            <div>
              <div className="text-[11px] text-ink-3 uppercase tracking-wider mb-2">Rôle</div>
              <div className="flex flex-wrap gap-2">
                {roleOptions.map(([name, p]) => {
                  const own = need?.starter && models ? forecastRole(need.starter, p, models) : undefined;
                  return (
                    <button
                      key={name}
                      onClick={() => update({ role: name })}
                      title={p.description}
                      className={`px-3 py-1.5 rounded-md text-xs border ${name === roleName ? 'bg-accent/10 border-accent/40 text-accent font-semibold' : 'border-line-strong text-ink-2 hover:text-ink'}`}
                    >
                      {name}{own && <span className="text-ink-3 font-mono"> · {round(own.now)}</span>}
                    </button>
                  );
                })}
              </div>
              {preset.description && <p className="text-xs text-ink-3 mt-2">{preset.description}</p>}
            </div>

            {partner?.starter && (
              <div>
                <div className="flex items-center justify-between gap-3 mb-2">
                  <span className="text-[11px] text-ink-3 uppercase tracking-wider">
                    Complémentarité avec {partner.starter.Player} ({positionName(partner.position)})
                  </span>
                  {complements.length > 0 && (
                    <label className="flex items-center gap-2 text-xs text-ink-2 cursor-pointer">
                      <input type="checkbox" className="accent-accent" checked={state.useComplements}
                        onChange={e => update({ useComplements: e.target.checked })} />
                      En tenir compte
                    </label>
                  )}
                </div>
                {complements.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {complements.map(c => (
                      <span key={c.metric} className={`px-2 py-1 rounded-md border text-xs ${state.useComplements ? 'border-line-strong text-ink' : 'border-line text-ink-3'}`}>
                        {metricLabel(c.metric)} <span className="font-mono text-ink-3">· {ordinal(c.value)} pct</span>
                      </span>
                    ))}
                    <span className="text-[11px] text-ink-3 self-center">Ses points faibles comptent en plus dans l'indice du candidat.</span>
                  </div>
                ) : (
                  <p className="text-xs text-ink-3">Aucun point faible marqué (sous le {COMPLEMENT_THRESHOLD}e percentile) sur les métriques du poste.</p>
                )}
              </div>
            )}

            {/* Filtres : une rangée au-dessus des résultats */}
            <div className="flex flex-wrap items-end gap-3 pt-2 border-t border-line">
              <SlidersHorizontal className="w-4 h-4 text-ink-3 mb-2" aria-hidden />
              <label className="text-[11px] text-ink-3">
                Âge
                <span className="flex items-center gap-1 mt-1">
                  <input type="number" min={AGE_RANGE[0]} max={AGE_RANGE[1]} value={state.filters.minAge}
                    onChange={e => updateFilters({ minAge: Number(e.target.value) || AGE_RANGE[0] })}
                    className="w-14 bg-raised border border-line-strong rounded px-2 py-1 text-xs text-ink" aria-label="Âge minimum" />
                  <span className="text-ink-4">–</span>
                  <input type="number" min={AGE_RANGE[0]} max={AGE_RANGE[1]} value={state.filters.maxAge}
                    onChange={e => updateFilters({ maxAge: Number(e.target.value) || AGE_RANGE[1] })}
                    className="w-14 bg-raised border border-line-strong rounded px-2 py-1 text-xs text-ink" aria-label="Âge maximum" />
                </span>
              </label>
              {market && <label className="text-[11px] text-ink-3">
                Valeur max (M€)
                <input type="number" min={0} step={0.5} placeholder="sans limite"
                  value={state.filters.maxValue === undefined ? '' : state.filters.maxValue / 1e6}
                  onChange={e => updateFilters({ maxValue: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value)) * 1e6 })}
                  className="block mt-1 w-28 bg-raised border border-line-strong rounded px-2 py-1 text-xs text-ink" />
              </label>}
              {market && state.filters.maxValue !== undefined && (
                <label className="flex items-center gap-1.5 text-[11px] text-ink-3 pb-1.5">
                  <input type="checkbox" className="accent-accent" checked={state.filters.includeUnknownValue}
                    onChange={e => updateFilters({ includeUnknownValue: e.target.checked })} />
                  garder les valeurs inconnues
                </label>
              )}
              <label className="text-[11px] text-ink-3">
                Minutes min.
                <select value={state.filters.minMinutes} onChange={e => updateFilters({ minMinutes: Number(e.target.value) })}
                  className="block mt-1 bg-raised border border-line-strong rounded px-2 py-1 text-xs text-ink">
                  {[0, 450, 900, 1350, 1800, 2400].map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </label>
              <label className="text-[11px] text-ink-3">
                Contrat
                <select value={state.filters.contractWithinMonths ?? ''}
                  onChange={e => updateFilters({ contractWithinMonths: e.target.value === '' ? undefined : Number(e.target.value) })}
                  className="block mt-1 bg-raised border border-line-strong rounded px-2 py-1 text-xs text-ink">
                  <option value="">Tous</option>
                  <option value={6}>Fin ≤ 6 mois</option>
                  <option value={12}>Fin ≤ 12 mois</option>
                  <option value={24}>Fin ≤ 24 mois</option>
                </select>
              </label>
              <label className="text-[11px] text-ink-3">
                Championnats
                <select value={state.filters.leagues} onChange={e => updateFilters({ leagues: e.target.value as LeagueScope })}
                  className="block mt-1 bg-raised border border-line-strong rounded px-2 py-1 text-xs text-ink">
                  {LEAGUE_SCOPES.filter(s => s.key !== 'lower' || transfer).map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </label>
              <label className="text-[11px] text-ink-3">
                Trier par
                <select value={state.sort} onChange={e => update({ sort: e.target.value as SortKey })}
                  className="block mt-1 bg-raised border border-line-strong rounded px-2 py-1 text-xs text-ink">
                  {SORTS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </label>
              {!fullAge && <span className="text-[10px] text-ink-3 pb-1.5">Âge inconnu : joueur écarté</span>}
            </div>
          </div>
        </Card>
      )}

      {/* Suggestions */}
      {preset && (
        <Card
          title="Suggestions"
          subtitle={`${candidates.length} joueur${candidates.length > 1 ? 's' : ''} (40 au plus), classés par indice projeté dans l'équipe la saison prochaine${market ? ` · valeurs Transfermarkt au ${market.scrapedAt ?? '—'}` : ' · valeurs Transfermarkt indisponibles'}.`}
        >
          {candidates.length === 0 ? (
            <p className="text-sm text-ink-3">Aucun joueur ne correspond aux filtres.</p>
          ) : (
            <div className="space-y-6">
              <CandidateScatter
                candidates={candidates}
                baseline={incumbent?.next}
                baselineName={incumbentName}
                onPick={id => {
                  setExpanded(id);
                  requestAnimationFrame(() => document.getElementById(`candidate-${id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
                }}
              />

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[11px] text-ink-3 uppercase tracking-wider border-b border-line">
                      <th className="text-left font-semibold py-2 pr-3">Joueur</th>
                      <th className="text-right font-semibold py-2 px-3">Indice projeté</th>
                      <th className="text-right font-semibold py-2 px-3" title={`Rang parmi les joueurs de ${ready!.leagueName} éligibles au rôle`}>Rang</th>
                      <th className="text-right font-semibold py-2 px-3" title="Critères éliminatoires du rôle atteints, en percentiles projetés">Seuils</th>
                      <th className="text-left font-semibold py-2 px-3">Valeur · contrat</th>
                      <th className="text-left font-semibold py-2 px-3">Signaux</th>
                      <th className="py-2 pl-3 w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map(c => {
                      const id = c.player['Player ID'] ?? c.player.Player;
                      const open = expanded === id;
                      return (
                        <React.Fragment key={id}>
                          <tr
                            id={`candidate-${id}`}
                            className={`border-b border-line/60 cursor-pointer ${open ? 'bg-raised/70' : 'hover:bg-raised/40'}`}
                            onClick={() => setExpanded(open ? null : id)}
                          >
                            <td className="py-2.5 pr-3">
                              <div className="flex items-center gap-3 min-w-[15rem]">
                                <Avatar player={c.player} name={c.player.Player} />
                                <div className="min-w-0">
                                  <div className="text-ink font-medium truncate">
                                    {c.player.Player}
                                    <span className="text-ink-3 font-normal text-xs"> · {c.player.Age ?? '?'} ans · {positionLabel(c.player.Position)}</span>
                                  </div>
                                  <TeamLine player={c.player} className="text-xs text-ink-3 max-w-[16rem]" />
                                </div>
                              </div>
                            </td>
                            <td className="py-2.5 px-3 text-right whitespace-nowrap">
                              <span className="text-lg font-semibold text-ink">{round(c.forecast.next)}</span>
                              {c.gain !== undefined && (
                                <span className="block text-[11px] text-ink-3">{signed(c.gain)} vs titulaire</span>
                              )}
                            </td>
                            <td className="py-2.5 px-3 text-right text-xs text-ink-2 whitespace-nowrap tabular-nums">{ordinal(c.rank)}</td>
                            <td className="py-2.5 px-3 text-right text-xs text-ink-3 whitespace-nowrap tabular-nums">{c.thresholds.met}/{c.thresholds.total}</td>
                            <td className="py-2.5 px-3 text-xs whitespace-nowrap">
                              <span className="text-ink">{formatEuros(c.market?.value)}</span>
                              {c.market?.estimated !== undefined && (
                                <span className="text-ink-3" title="Valeur estimée par la performance (modèle, saison actuelle)"> · est. {formatEuros(c.market.estimated)}</span>
                              )}
                              <span className="block text-ink-3">contrat {formatMonth(c.market?.contract)}</span>
                            </td>
                            <td className="py-2.5 px-3">
                              <div className="flex flex-wrap gap-1 min-w-[12rem] max-w-[22rem]">
                                {c.efficient && <FlagChip label="Qualité-prix" icon={Scale} title="Aucun autre candidat n'a un meilleur indice projeté pour une valeur inférieure ou égale" />}
                                {c.flags.map(f => (
                                  <FlagChip key={f} {...CANDIDATE_FLAGS[f]}
                                    title={f === 'fewMinutes' ? `Moins de ${fewMinutes.toLocaleString('fr-FR')} minutes cette saison : percentiles plus instables` : CANDIDATE_FLAGS[f].title} />
                                ))}
                              </div>
                            </td>
                            <td className="py-2.5 pl-3 text-ink-3">
                              {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                            </td>
                          </tr>
                          {open && (
                            <tr className="bg-raised/70 border-b border-line">
                              <td colSpan={7} className="px-4 pb-5 pt-2">
                                <div className="grid grid-cols-1 lg:grid-cols-[1fr_16rem] gap-6">
                                  <div className="space-y-3">
                                    <PartsLine candidate={c} />
                                    <MetricDumbbells candidate={c} preset={preset} extraWeights={extraWeights} incumbent={incumbent} incumbentName={incumbentName} />
                                  </div>
                                  <div className="space-y-2 text-xs text-ink-3">
                                    <div>Minutes : <span className="text-ink">{c.player['Minutes played']}</span> ({c.player['Matches played']} matchs)</div>
                                    {levelGap && c.player.Competition !== ready!.competition && (
                                      <div>
                                        Écart de niveau moyen vers {ready!.leagueName} :{' '}
                                        <span className="text-ink font-mono">{signed(levelGap(c.player) - leagueLevel(transfer!, ready!.competition, ready!.tier))}</span> pts de percentile
                                        {' '}({transfer!.leagues[c.player.Competition ?? '']?.moves ?? 0} transferts observés)
                                      </div>
                                    )}
                                    {c.player['Team style'] && <div>Style de son équipe : <span className="text-ink">{String(c.player['Team style'])}</span></div>}
                                    {onSelectPlayer && (
                                      <button
                                        onClick={e => { e.stopPropagation(); onSelectPlayer(c.player); }}
                                        className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-accent text-accent-ink font-semibold hover:bg-accent-strong"
                                      >
                                        Fiche du joueur <ExternalLink className="w-3.5 h-3.5" />
                                      </button>
                                    )}
                                  </div>
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
          )}
        </Card>
      )}

      {/* Méthode */}
      <section className="bg-surface border border-line rounded-lg">
        <button onClick={() => setShowMethod(v => !v)} className="w-full flex items-center justify-between px-5 py-4 text-left" aria-expanded={showMethod}>
          <span className="text-sm font-bold text-ink uppercase tracking-wider flex items-center gap-2"><Info className="w-4 h-4 text-ink-3" /> Méthode et fiabilité</span>
          {showMethod ? <ChevronDown className="w-4 h-4 text-ink-3" /> : <ChevronRight className="w-4 h-4 text-ink-3" />}
        </button>
        {showMethod && (
          <div className="px-5 pb-5 grid grid-cols-1 lg:grid-cols-2 gap-6 text-xs text-ink-3 leading-relaxed">
            <div className="space-y-3">
              <p>
                <span className="text-ink font-semibold">Projection.</span> Chaque percentile d'un candidat est projeté à la saison
                suivante (retour vers la moyenne et âge, courbes d'âge), puis traduit vers notre équipe : écart de niveau entre les
                championnats, domination territoriale de notre équipe par rapport à la sienne, coût moyen d'adaptation d'un changement
                de championnat ou de club. L'indice du rôle (rôles du Chasseur de pépites) est recalculé sur ces percentiles projetés,
                et comparé à celui du titulaire, projeté de la même façon sans changement de club.
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
                Transfermarkt sont une estimation du marché, pas un prix.
              </p>
              <p>
                <span className="text-ink font-semibold">Recherche</span> (release « recherche ») : transférabilité limitée de la
                performance et contexte d'équipe, recrutement multicritère sous budget (frontière qualité-prix), complémentarité au sein
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
                  <span className="text-[10px] uppercase text-ink-3">Championnat</span>
                  <span className="text-[10px] uppercase text-ink-3 text-right">Écart</span>
                  <span className="text-[10px] uppercase text-ink-3 text-right">Transferts</span>
                  {Object.entries(transfer.leagues).map(([key, l]) => (
                    <React.Fragment key={key}>
                      <span className={key === ready!.competition ? 'text-ink' : ''}><CompetitionBadge competition={key} /></span>
                      <span className="font-mono text-right text-ink tabular-nums">{key === ready!.competition ? '—' : signed(l.level - leagueLevel(transfer, ready!.competition, ready!.tier))}</span>
                      <span className="font-mono text-right tabular-nums">{l.moves}</span>
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
