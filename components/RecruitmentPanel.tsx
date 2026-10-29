/**
 * ScoutVision AI - Recrutement
 * BESOIN → CANDIDATS → PROJECTION → EXPLICATION → COMPLÉMENTARITÉ → VALEUR → INCERTITUDE.
 * Besoins par poste du onze type, contraintes et préférences, liste des candidats projetés
 * dans l'équipe la saison suivante, dossier du candidat choisi. Calculs : utils/recruitment.ts
 * (modèle de transfert de scripts/models.py sur les courbes d'âge).
 *
 * Mise en page : maître / détail à partir de 1 280 px (liste à gauche, dossier collant à
 * droite) ; en dessous, trois étapes (besoins, candidats, dossier) en pleine largeur.
 * Un clic sur un candidat ne recalcule rien : seuls la liste (sélection) et le dossier changent.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, List, ScatterChart as ScatterIcon, UserSearch } from 'lucide-react';
import { PlayerData, TeamStats, ViewState, getPlayerSeason } from '../types';
import { dataLoader } from '../services/dataLoader';
import { queryService } from '../services/queryService';
import { useAsyncData } from '../hooks/useAsyncData';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { DEFAULT_ROLE_PRESETS, RolePreset, presetsForPosition } from '../utils/rolePresets';
import { placeEleven } from '../utils/lineup';
import { formationPositions, isExploitableFormation, orderFormations, recruitmentFormation } from '../utils/teamLineups';
import { teamCohort } from '../utils/teamMetrics';
import { isSeasonInProgress, resolveTeamLeague } from '../utils/teamContext';
import { seasonCapabilities } from '../utils/prospects';
import {
  Candidate, DEFAULT_FILTERS, Models, SearchFilters, SlotNeed, Target, candidateView, complementFor, incumbentForecast, leagueRows,
  needOrder as orderNeeds, searchCandidates, seasonMarket, slotNeeds, slotPartner, squadProfile, teamRank, FEW_MINUTES,
} from '../utils/recruitment';
import { prepareComparison } from './PlayerComparison';
import { SquadProfilePanel } from './SquadProfile';
import { EmptyState, LoadError, PercentileValue, Skeleton, Stat } from './ui';
import NeedsPanel from './recruitment/NeedsPanel';
import NeedSummary from './recruitment/NeedSummary';
import SearchControls, { SortKey } from './recruitment/SearchControls';
import FunnelLine from './recruitment/FunnelLine';
import CandidateTable, { candidateKey } from './recruitment/CandidateTable';
import ValueScatter from './recruitment/ValueScatter';
import CandidateDossier from './recruitment/CandidateDossier';
import MethodNote from './recruitment/MethodNote';
import { Note } from './recruitment/shared';

// ============================================
// ÉTAT CONSERVÉ PAR ÉQUIPE
// ============================================

type Step = 'needs' | 'candidates' | 'dossier';
type ListView = 'list' | 'scatter';

interface PanelMemory {
  formation: string | null;       // formation choisie ; null : formation des besoins (recruitmentFormation)
  slot: number | null;            // numéro de case (LineupSlot.slot)
  manualPosition: string;         // poste choisi sans composition
  role: string | null;
  filters: SearchFilters;
  sort: SortKey;
  preferComplement: boolean;      // préférence : ordre par complémentarité (désactivée par défaut)
  candidate: string | null;       // candidat ouvert
  step: Step;                     // étape affichée sous 1 280 px
  view: ListView;
}

const memory = new Map<string, PanelMemory>();

// Saison en cours : seuil de minutes abaissé, sinon seuls les championnats en année civile
// (déjà presque terminés) passeraient le filtre ; le signal « peu de minutes » ne marque alors
// que les échantillons les plus minces
const IN_PROGRESS_MIN_MINUTES = 450;
const IN_PROGRESS_FEW_MINUTES = 600;
// Candidats retenus (meilleures projections) ; la liste en montre 20 puis plus à la demande
const SEARCH_LIMIT = 100;
const WIDE = '(min-width: 1280px)';

const freshMemory = (inProgress: boolean): PanelMemory => ({
  formation: null, slot: null, manualPosition: 'CB', role: null,
  filters: { ...DEFAULT_FILTERS, ...(inProgress ? { minMinutes: IN_PROGRESS_MIN_MINUTES } : {}) },
  sort: 'next', preferComplement: false, candidate: null, step: 'needs', view: 'list',
});

const STEPS: { key: Step; label: string }[] = [
  { key: 'needs', label: 'Besoins' },
  { key: 'candidates', label: 'Candidats' },
  { key: 'dossier', label: 'Dossier' },
];

const D1 = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const D2 = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Contexte de l'équipe (profil de l'effectif, production), replié : il éclaire les besoins
const TeamContext: React.FC<{ profile: ReturnType<typeof squadProfile>; leagueName: string; output: { label: string; rank: number; value: string }[] }> = ({ profile, leagueName, output }) => {
  const [open, setOpen] = useState(false);
  return (
    <section className="sv-panel">
      <button type="button" onClick={() => setOpen(v => !v)} aria-expanded={open} aria-controls="recruitment-team-context"
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left">
        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-ink">Contexte de l'équipe <span className="normal-case tracking-normal font-normal text-ink-3">· profil de l'effectif, production</span></span>
        {open ? <ChevronDown className="w-4 h-4 text-ink-3 shrink-0" aria-hidden /> : <ChevronRight className="w-4 h-4 text-ink-3 shrink-0" aria-hidden />}
      </button>
      {open && (
        <div id="recruitment-team-context" className="px-4 pb-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
          <SquadProfilePanel profile={profile} leagueName={leagueName} />
          {output.length > 0 && (
            <div className="grid grid-cols-2 gap-3 content-start">
              {output.map(o => (
                <Stat key={o.label} label={o.label} value={o.value}
                  sub={<span className="inline-flex items-center gap-1.5">rang <PercentileValue value={o.rank} className="text-2xs" /></span>} />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
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
  onNavigate?: (view: string) => void;
}

const RecruitmentPanel: React.FC<RecruitmentPanelProps> = ({ teamKey, playerData, teamStats, onSelectPlayer, onNavigate }) => {
  const [state, setState] = useState<PanelMemory>(() => {
    const first = queryService.getTeamPlayers(teamKey)[0];
    return memory.get(teamKey) ?? freshMemory(isSeasonInProgress(first ? getPlayerSeason(first) : undefined));
  });
  // Monté avec key={teamKey} : l'état repart de ce qui a été choisi pour cette équipe
  useEffect(() => { memory.set(teamKey, state); }, [teamKey, state]);
  const update = useCallback((patch: Partial<PanelMemory>) => setState(s => ({ ...s, ...patch })), []);
  const wide = useMediaQuery(WIDE);

  const curves = useAsyncData(() => dataLoader.loadAgeCurves(), []);
  const transferData = useAsyncData(() => dataLoader.loadTransferModel(), []);
  const marketData = useAsyncData(() => dataLoader.loadMarketValues(), []);
  const transfer = transferData.data ?? null;
  const market = marketData.data ?? null;

  // Équipe : son championnat (une coupe d'Europe renvoie au championnat de l'équipe)
  const team = useMemo(() => resolveTeamLeague(teamKey, playerData), [teamKey, playerData]);
  const ready = team && team.missingLeague === false ? team : null;
  const fewMinutes = ready?.inProgress ? IN_PROGRESS_FEW_MINUTES : FEW_MINUTES;

  const lineupsData = useAsyncData(
    ready ? () => dataLoader.loadLineups(ready.season, ready.competition) : null,
    [ready?.season, ready?.competition],
  );
  const lineups = lineupsData.status === 'success' ? lineupsData.data?.[ready!.teamId] ?? null : null;

  const modelsReady = curves.status !== 'loading' && transferData.status !== 'loading';
  const models: Models | null = useMemo(
    () => (modelsReady ? { curves: curves.data ?? null, transfer: transferData.data ?? null } : null),
    [modelsReady, curves.data, transferData.data],
  );
  const asOf = useMemo(() => (market?.scrapedAt ? new Date(market.scrapedAt) : new Date()), [market]);
  // Marché de la saison analysée (instantané Transfermarkt : saison en cours seulement)
  const caps = useMemo(() => (ready ? seasonCapabilities(ready.seasonRows) : null), [ready]);
  const seasonMkt = useMemo(() => (caps ? seasonMarket(market, caps) : null), [market, caps]);
  const hasValue = !!seasonMkt && !!caps?.marketValue;
  const hasContract = !!seasonMkt && !!caps?.contract;

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

  // Formations : même lecture que l'Analyse d'équipe ; besoins sur la plus utilisée exploitable
  const formations = useMemo(() => orderFormations(lineups), [lineups]);
  const defaultFormation = useMemo(() => recruitmentFormation(formations), [formations]);
  const chosenIdx = formations.findIndex(f => f.formation === state.formation && isExploitableFormation(f));
  const formation = formations[chosenIdx >= 0 ? chosenIdx : defaultFormation?.index ?? 0];
  const fallbackFrom = chosenIdx < 0 ? defaultFormation?.fallbackFrom : undefined;
  const eleven = useMemo(() => (formation ? placeEleven(formation.slots) : []), [formation]);
  const slotPositions = useMemo(() => (formation ? formationPositions(formation) : null), [formation]);
  const needs = useMemo(
    () => (models ? slotNeeds(eleven, teamRows, leaguePool, models, seasonMkt, asOf, slotPositions) : []),
    [eleven, teamRows, leaguePool, models, seasonMkt, asOf, slotPositions],
  );
  const needOrder = useMemo(() => orderNeeds(needs), [needs]);
  const mislabelledKeepers = useMemo(() => needs.filter(n => n.flags.includes('outOfPosition') && n.starter?.Position === 'GK').length, [needs]);

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

  // Titulaire : une seule projection (ligne du besoin, dossier, écart), sans complémentarité
  const incumbent = useMemo(
    () => (models ? incumbentForecast(need, roleName, preset, models) : undefined),
    [need, roleName, preset, models],
  );

  // Classement : projection sportive seule ; la complémentarité est une lecture par candidat
  const search = useMemo(() => {
    if (!preset || !models || !target) return null;
    return searchCandidates({
      pool, preset, target, models, baseline: incumbent?.next, complements, filters: state.filters,
      market: seasonMkt, asOf, limit: SEARCH_LIMIT, fewMinutes,
    });
  }, [pool, preset, target, models, incumbent, complements, state.filters, seasonMkt, asOf, fewMinutes]);
  const candidates = useMemo(() => search?.candidates ?? [], [search]);

  // Préférences : changent l'ordre, jamais la sélection ni les projections
  const byComplement = state.preferComplement && complements.length > 0;
  const sortKey: SortKey = !hasValue && (state.sort === 'efficient' || state.sort === 'value') ? 'next' : state.sort;
  const sorted = useMemo(() => {
    const list = [...candidates];
    const value = (c: Candidate) => c.market?.value ?? Infinity;
    if (byComplement) list.sort((a, b) => (b.complement?.mean ?? -1) - (a.complement?.mean ?? -1) || b.forecast.next - a.forecast.next);
    else if (sortKey === 'efficient') list.sort((a, b) => Number(b.efficient) - Number(a.efficient) || b.forecast.next - a.forecast.next);
    else if (sortKey === 'age') list.sort((a, b) => (Number(a.player.Age) || 99) - (Number(b.player.Age) || 99) || b.forecast.next - a.forecast.next);
    else if (sortKey === 'value') list.sort((a, b) => value(a) - value(b) || b.forecast.next - a.forecast.next);
    return list;
  }, [candidates, sortKey, byComplement]);

  const profile = useMemo(() => (ready ? squadProfile(ready.teamId, leagueAll) : []), [ready, leagueAll]);
  const output = useMemo(() => {
    if (!ready) return [];
    const own = teamStats.find(t => t.team_id === ready.teamId && t.competition === ready.competition);
    if (!own) return [];
    const cohort = teamCohort(own, teamStats);
    const rows: [string, keyof TeamStats, boolean, (v: number) => string][] = [
      ['xG créés / 90', 'xG per 90', true, v => D2.format(v)],
      ['xG concédés / 90', 'xGA per 90', false, v => D2.format(v)],
      ['Domination territoriale', 'Field tilt', true, v => `${Math.round(v)} %`],
      ['Pressing (PPDA)', 'PPDA', false, v => D1.format(v)],
    ];
    return rows.flatMap(([label, key, higher, fmt]) => {
      const rank = teamRank(own, cohort, key, higher);
      const v = own[key];
      return rank === undefined || typeof v !== 'number' ? [] : [{ label, rank, value: fmt(v) }];
    });
  }, [ready, teamStats]);

  // Candidat ouvert : celui choisi s'il est dans la liste, sinon le premier
  const focus = sorted.find(c => candidateKey(c) === state.candidate) ?? sorted[0];
  const focusId = focus ? candidateKey(focus) : undefined;
  const view = useMemo(
    () => (focus && ready ? candidateView(focus, { incumbent, targetCompetition: ready.competition, transfer, hasMarket: !!seasonMkt }) : undefined),
    [focus, incumbent, ready, transfer, seasonMkt],
  );

  // ============================================
  // ACTIONS (stables : les blocs mémorisés ne se redessinent pas au choix d'un candidat)
  // ============================================

  const dossierHeading = useRef<HTMLHeadingElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const stepsRef = useRef<HTMLElement>(null);
  const pendingFocus = useRef<'dossier' | 'summary' | 'steps' | null>(null);
  const isWide = () => window.matchMedia(WIDE).matches;
  const selectNeed = useCallback((slot: number) => {
    update({ slot, role: null, candidate: null });
    if (!isWide()) pendingFocus.current = 'summary';
  }, [update]);
  const chooseFormation = useCallback((name: string) => update({ formation: name, slot: null, role: null, candidate: null }), [update]);
  const chooseManual = useCallback((pos: string) => update({ manualPosition: pos, role: null, candidate: null }), [update]);
  const chooseRole = useCallback((name: string) => update({ role: name, candidate: null }), [update]);
  const setFilters = useCallback((patch: Partial<SearchFilters>) => setState(s => ({ ...s, filters: { ...s.filters, ...patch } })), []);
  const setSort = useCallback((sort: SortKey) => update({ sort }), [update]);
  const setPreferComplement = useCallback((on: boolean) => update({ preferComplement: on }), [update]);
  const selectCandidate = useCallback((id: string) => {
    // Sous 1 280 px le dossier est une étape : on y va et le focus suit
    if (isWide()) update({ candidate: id });
    else { update({ candidate: id, step: 'dossier' }); pendingFocus.current = 'dossier'; }
  }, [update]);
  // Changement d'étape : on revient en haut de l'étape
  const goStep = useCallback((step: Step) => { update({ step }); pendingFocus.current = 'steps'; }, [update]);
  const showCandidates = useCallback(() => goStep('candidates'), [goStep]);
  const backToList = useCallback(() => goStep('candidates'), [goStep]);
  const compare = useMemo(() => (onNavigate ? (players: PlayerData[]) => { prepareComparison(players); onNavigate(ViewState.COMPARISON); } : undefined), [onNavigate]);

  useEffect(() => {
    const pending = pendingFocus.current;
    if (!pending) return;
    pendingFocus.current = null;
    if (pending === 'dossier') {
      dossierHeading.current?.closest('article')?.scrollIntoView({ block: 'start' });
      dossierHeading.current?.focus({ preventScroll: true });
    }
    if (pending === 'summary') summaryRef.current?.scrollIntoView({ block: 'start' });
    if (pending === 'steps') stepsRef.current?.scrollIntoView({ block: 'start' });
  });

  // ============================================
  // RENDU
  // ============================================

  if (!team) return <EmptyState title="Équipe introuvable dans les données chargées." />;
  if (team.missingLeague) {
    return (
      <EmptyState icon={UserSearch} title={`${team.name} n'a pas de championnat couvert cette saison.`}>
        Le recrutement s'appuie sur le championnat de l'équipe.
      </EmptyState>
    );
  }
  if (!models || marketData.status === 'loading' || lineupsData.status === 'loading') {
    return <div className="p-4 sm:p-5" role="status" aria-label="Chargement du recrutement"><Skeleton className="h-[600px]" /></div>;
  }

  const step: Step = state.step === 'dossier' && !focus ? 'candidates' : state.step;
  const targetTiltMissing = !!transfer && transfer.context.some(col => typeof target?.context[col] !== 'number');
  const showStep = (s: Step) => (step === s ? '' : 'max-xl:hidden');
  const listView: ListView = hasValue ? state.view : 'list';
  const partnerName = partner?.starter?.Player;

  return (
    <div className="p-4 sm:p-5 space-y-4 overflow-x-clip">
      {/* Contexte et avertissements */}
      {(ready!.fromCup || ready!.inProgress || (!seasonMkt && marketData.status === 'success') || (transfer && targetTiltMissing) || (transferData.status === 'success' && !transfer)) && (
        <div className="space-y-1.5">
          {ready!.fromCup && <Note>Analyse faite sur le championnat de l'équipe ({ready!.leagueName}) : l'entrée choisie est une coupe d'Europe.</Note>}
          {ready!.inProgress && <Note>Saison en cours : percentiles sur peu de matchs (seuil abaissé à {IN_PROGRESS_MIN_MINUTES} minutes), championnats en année civile plus avancés. Recoupez avec la saison précédente.</Note>}
          {!seasonMkt && marketData.status === 'success' && (
            <Note>Saison {ready!.season} : pas de valeur Transfermarkt, de contrat ni d'estimation ScoutVision. Le relevé{market?.scrapedAt ? ` du ${market.scrapedAt}` : ''} ne décrit que la saison en cours ; il n'est pas appliqué à une saison passée. Âges et percentiles restent ceux de la saison analysée.</Note>
          )}
          {transfer && targetTiltMissing && (
            <Note>Contexte équipe indisponible : la domination territoriale de {ready!.name} n'est pas connue cette saison. Le terme de contexte n'a pas été appliqué aux projections.</Note>
          )}
          {transferData.status === 'success' && !transfer && (
            <Note tone="warn">Modèle de transfert absent (relancez scripts/prepare_data.py) : projections avec les seules courbes d'âge, sans tenir compte du championnat.</Note>
          )}
        </div>
      )}
      {transferData.status === 'error' && <LoadError message="Le modèle de transfert n'a pas pu être chargé : projections avec les seules courbes d'âge." onRetry={transferData.retry} />}
      {curves.status === 'error' && <LoadError message="Les courbes d'âge n'ont pas pu être chargées : ni retour vers la moyenne ni effet de l'âge." onRetry={curves.retry} />}
      {marketData.status === 'error' && <LoadError message="Les valeurs Transfermarkt n'ont pas pu être chargées." onRetry={marketData.retry} />}

      {/* Étapes (sous 1 280 px) */}
      <nav ref={stepsRef} aria-label="Étapes du recrutement" className="xl:hidden scroll-mt-4">
        <ol className="sv-seg w-full">
          {STEPS.map((s, i) => (
            <li key={s.key} className="flex-1 flex min-w-0">
              <button type="button" onClick={() => goStep(s.key)} aria-current={step === s.key ? 'step' : undefined} disabled={s.key === 'dossier' && !focus}
                className={`sv-seg-btn flex-1 min-w-0 justify-center !px-1.5 ${step === s.key ? 'sv-seg-on' : ''} disabled:opacity-50`}>
                <span className="num text-ink-4">{i + 1}</span> {s.label}
              </button>
            </li>
          ))}
        </ol>
      </nav>

      <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_26rem] 2xl:grid-cols-[minmax(0,1fr)_28rem] xl:gap-4 xl:items-start">
        <div className="space-y-4 min-w-0">
          {/* 1. Besoins */}
          <div className={`space-y-4 ${showStep('needs')}`}>
            {lineupsData.status === 'error'
              ? <LoadError message="Les compositions n'ont pas pu être chargées : besoins par poste indisponibles." onRetry={lineupsData.retry} />
              : (
                <NeedsPanel needs={needs} order={needOrder} selectedIndex={slotIndex} onSelectNeed={selectNeed}
                  formations={formations} formation={formation} onChooseFormation={chooseFormation} fallbackFrom={fallbackFrom}
                  mislabelledKeepers={mislabelledKeepers} leagueName={ready!.leagueName}
                  manualPosition={state.manualPosition} onManualPosition={chooseManual} />
              )}
            <div ref={summaryRef} className="scroll-mt-4">
              <NeedSummary need={need} position={position} formationName={formation?.formation} roleOptions={roleOptions}
                roleName={roleName} preset={preset} onRole={chooseRole} incumbent={incumbent} models={models}
                candidateCount={candidates.length} onShowCandidates={showCandidates} hasContract={hasContract} />
            </div>
            <TeamContext profile={profile} leagueName={ready!.leagueName} output={output} />
          </div>

          {/* 2. Candidats */}
          {preset && (
            <div className={`space-y-3 ${showStep('candidates')}`}>
              <SearchControls filters={state.filters} onFilters={setFilters} sort={sortKey} onSort={setSort}
                preferComplement={byComplement} onPreferComplement={setPreferComplement}
                partnerName={partnerName} hasComplements={complements.length > 0}
                hasValue={hasValue} hasContract={hasContract} hasTransferModel={!!transfer} />
              <section className="sv-panel min-w-0" aria-labelledby="recruitment-candidates-title">
                <header className="px-4 pt-3 pb-2 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                  <div className="min-w-0">
                    <h3 id="recruitment-candidates-title" className="text-xs font-semibold uppercase tracking-[0.08em] text-ink">
                      Candidats <span className="normal-case tracking-normal font-normal text-ink-3">· {roleName}</span>
                    </h3>
                    <p className="text-xs text-ink-3 mt-1">
                      Les {candidates.length} meilleures projections sportives chez nous la saison prochaine
                      {hasValue ? ` · valeurs Transfermarkt au ${market?.scrapedAt ?? '—'}` : ''}.
                    </p>
                  </div>
                  {hasValue && (
                    <div className="sv-seg" role="group" aria-label="Affichage des candidats">
                      <button type="button" className={`sv-seg-btn ${listView === 'list' ? 'sv-seg-on' : ''}`} aria-pressed={listView === 'list'} onClick={() => update({ view: 'list' })}>
                        <List className="w-3.5 h-3.5" aria-hidden /> Liste
                      </button>
                      <button type="button" className={`sv-seg-btn ${listView === 'scatter' ? 'sv-seg-on' : ''}`} aria-pressed={listView === 'scatter'} onClick={() => update({ view: 'scatter' })}
                        aria-label="Valeur / performance">
                        <ScatterIcon className="w-3.5 h-3.5" aria-hidden /> <span className="hidden sm:inline">Valeur / performance</span><span className="sm:hidden" aria-hidden>Nuage</span>
                      </button>
                    </div>
                  )}
                </header>
                {search && <FunnelLine funnel={search.funnel} hasMarket={!!seasonMkt} className="px-4 pb-2" />}
                {byComplement && (
                  <Note className="px-4 pb-2">
                    Ordre : complémentarité avec {partnerName} (préférence activée). La liste reste les {candidates.length} meilleures
                    projections ; aucune projection n'est modifiée.
                  </Note>
                )}
                <div className="border-t border-line">
                  {candidates.length === 0 ? (
                    <EmptyState title="Aucun joueur ne répond aux contraintes.">Élargissez l'âge, les minutes, le budget ou les championnats.</EmptyState>
                  ) : listView === 'list' ? (
                    <CandidateTable key={`${slotIndex}-${roleName}`} candidates={sorted} selectedId={focusId} onSelect={selectCandidate}
                      incumbentNext={incumbent?.next} hasMarket={hasValue} hasComplements={complements.length > 0}
                      partnerName={partnerName} fewMinutes={fewMinutes} />
                  ) : (
                    <div className="p-4">
                      <ValueScatter candidates={candidates} baseline={incumbent?.next} baselineName={need?.starter?.Player} onPick={selectCandidate} />
                    </div>
                  )}
                </div>
              </section>
            </div>
          )}
        </div>

        {/* 3. Dossier : collant à droite à partir de 1 280 px */}
        <aside aria-label="Dossier du candidat"
          className={`${showStep('dossier')} xl:sticky xl:top-4 xl:max-h-[calc(100dvh-5rem)] xl:overflow-y-auto xl:overscroll-contain rounded-lg`}>
          <p className="sr-only" aria-live="polite">{focus ? `Dossier affiché : ${focus.player.Player}` : ''}</p>
          {focus && view && preset && roleName ? (
            <CandidateDossier key={focusId} candidate={focus} view={view} preset={preset} roleName={roleName}
              incumbent={incumbent} incumbentPlayer={incumbent ? need?.starter : undefined}
              partner={partner?.starter} partnerPosition={partner?.position}
              leagueName={ready!.leagueName} targetCompetition={ready!.competition} targetTier={ready!.tier} transfer={transfer}
              fewMinutes={fewMinutes} onOpenPlayer={onSelectPlayer} onCompare={compare}
              onBack={wide ? undefined : backToList} headingRef={dossierHeading} />
          ) : (
            <div className="sv-panel"><EmptyState title="Aucun candidat sélectionné.">Choisissez un poste puis un candidat dans la liste.</EmptyState></div>
          )}
        </aside>
      </div>

      <MethodNote transfer={transfer} competition={ready!.competition} tier={ready!.tier} leagueName={ready!.leagueName} />
    </div>
  );
};

export default RecruitmentPanel;
