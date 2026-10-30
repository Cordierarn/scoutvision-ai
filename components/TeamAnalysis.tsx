/**
 * ScoutVision - Analyse d'équipe
 * Qui joue, comment l'équipe joue, ses forces et sa structure : style et forces, onze et
 * formations, effectif et profondeur, tirs. Le Recrutement (besoins, candidats) est une page
 * à part, ouverte sur la même équipe.
 *
 * Données : team_season (teams/<saison>.json), compositions (lineups/), tirs (shots/, chargés
 * à l'ouverture de l'onglet), percentiles des joueurs du pipeline. Rangs d'équipe : teamRank,
 * profil de l'effectif : squadProfile, profondeur : slotDepth (utils/recruitment.ts), comme le
 * Recrutement.
 */

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Activity, Info, UserSearch } from 'lucide-react';
import { PlayerData, TeamStats, getPlayerSeason, getSeasonLabel, ViewState } from '../types';
import { dataLoader } from '../services/dataLoader';
import { queryService } from '../services/queryService';
import { useAsyncData } from '../hooks/useAsyncData';
import { squadProfile } from '../utils/recruitment';
import { resolveTeamLeague } from '../utils/teamContext';
import { orderFormations } from '../utils/teamLineups';
import { styleReliability, teamMetric, teamMetricRanks, teamValue, STYLE_METRICS } from '../utils/teamMetrics';
import { styleLabel } from '../utils/labels';
import { prepareComparison } from './PlayerComparison';
import { CompetitionBadge, TeamLogo } from './Media';
import { EmptyState, PercentileValue } from './ui';
import TeamSearch from './TeamSearch';
import { openRecruitment } from './RecruitmentPage';
import TeamStyleTab, { formatTeamValue } from './team/TeamStyleTab';
import { GroundedAiPanel } from './ai/GroundedAiPanel';
import { aiOpposition } from '../services/groundedAiService';
import { buildOppositionFacts } from '../utils/oppositionFacts';
import TeamLineupTab from './team/TeamLineupTab';
import TeamNetworkTab from './team/TeamNetworkTab';
import TeamSquadTab from './team/TeamSquadTab';
import TeamShotsTab from './team/TeamShotsTab';
import { TEAM_TABS, TeamTab, teamMemory } from './team/teamMemory';

interface TeamAnalysisProps {
  playerData: PlayerData[];
  teamStats: TeamStats[];
  onSelectPlayer?: (player: PlayerData) => void;
  onNavigate?: (view: string) => void;
}

const HEADER_METRICS = ['xG per 90', 'xGA per 90', 'Possession, %', 'PPDA', 'Field tilt'].map(k => teamMetric(k)!);
const HEADER_LABELS: Record<string, string> = { 'xG per 90': 'xG / 90', 'xGA per 90': 'xGA / 90', 'Possession, %': 'Possession', PPDA: 'PPDA', 'Field tilt': 'Field tilt' };

const TeamAnalysis: React.FC<TeamAnalysisProps> = ({ playerData, teamStats, onSelectPlayer, onNavigate }) => {
  // Une équipe retenue n'est reprise que si elle existe dans les saisons chargées
  const [team, setTeam] = useState(() => (queryService.getTeamPlayers(teamMemory.team).length ? teamMemory.team : ''));
  const [tab, setTab] = useState<TeamTab>(teamMemory.tab);
  useEffect(() => { teamMemory.team = team; teamMemory.tab = tab; }, [team, tab]);

  const players = useMemo(() => (team ? queryService.getTeamPlayers(team) : []), [team]);
  const stats = useMemo(() => (team ? queryService.getTeamStats(team) : null), [team]);
  const info = team ? queryService.getTeamInfo(team) : null;
  const first = players[0];
  const ctx = useMemo(() => (first ? {
    teamId: first['Team ID'], name: first.Team, season: getPlayerSeason(first), competition: first.Competition,
    seasonLabel: /^\d{4}$/.test(String(first.Season ?? '')) ? String(first.Season) : getSeasonLabel(getPlayerSeason(first)),
  } : null), [first]);
  const allSeasons = useMemo(() => new Set(playerData.map(getPlayerSeason)).size > 1, [playerData]);
  const matches = teamValue(stats, 'Matches');

  // Compositions : partagées par l'en-tête (formation principale), le onze et la profondeur
  const lineupsData = useAsyncData(
    ctx?.teamId && ctx.season && ctx.competition ? () => dataLoader.loadLineups(ctx.season, ctx.competition!) : null,
    [ctx?.teamId, ctx?.season, ctx?.competition],
  );
  const lineups = lineupsData.status === 'success' ? lineupsData.data?.[ctx!.teamId!] ?? null
    : lineupsData.status === 'idle' ? null : undefined;
  const mainFormation = useMemo(() => orderFormations(lineups)[0], [lineups]);

  // Réseau de passes agrégé : chargé seulement quand son onglet est ouvert
  const networksData = useAsyncData(
    tab === 'NETWORK' && ctx?.teamId && ctx.season && ctx.competition ? () => dataLoader.loadNetworks(ctx.season, ctx.competition!) : null,
    [tab === 'NETWORK', ctx?.teamId, ctx?.season, ctx?.competition],
  );
  const network = networksData.status === 'success' ? networksData.data?.[ctx!.teamId!] ?? null
    : networksData.status === 'idle' ? null : undefined;

  // Profil de l'effectif : même championnat de référence et même fonction que le Recrutement
  const league = useMemo(() => (team ? resolveTeamLeague(team, playerData) : null), [team, playerData]);
  const profile = useMemo(() => {
    if (!league || league.missingLeague !== false) return null;
    return squadProfile(league.teamId, league.seasonRows.filter(p => p.Competition === league.competition));
  }, [league]);
  const profileLeague = league && league.missingLeague === false ? league.leagueName : undefined;
  const profileNote = league && league.missingLeague === false && league.fromCup
    ? <p className="text-2xs text-ink-3 mb-2">Calculé sur le championnat de l'équipe ({league.leagueName}) : l'entrée choisie est une coupe d'Europe.</p>
    : undefined;
  const leagueName = dataLoader.getCompetition(ctx?.competition)?.name ?? ctx?.competition ?? '';

  const ranks = useMemo(() => (stats ? teamMetricRanks(stats, teamStats, HEADER_METRICS) : []), [stats, teamStats]);
  const style = stats?.Style as string | undefined;
  const reliability = styleReliability(matches, style);
  const inProgress = league && league.missingLeague === false ? league.inProgress : false;
  const isCup = ctx?.competition ? (dataLoader.getCompetition(ctx.competition)?.type ?? 'league') !== 'league' : false;

  // ===== Défilement : mémorisé par onglet, restauré au retour d'une fiche =====
  const rootRef = useRef<HTMLDivElement>(null);
  const restoring = useRef(true);
  useEffect(() => {
    const scroller = rootRef.current?.closest('.overflow-y-auto') as HTMLElement | null;
    if (!scroller) return;
    const onScroll = () => { if (!restoring.current) teamMemory.scroll[tab] = scroller.scrollTop; };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => scroller.removeEventListener('scroll', onScroll);
  }, [tab]);
  const contentReady = tab === 'SHOTS' || tab === 'STYLE' || (tab === 'NETWORK' ? network !== undefined : lineups !== undefined);
  useLayoutEffect(() => {
    const scroller = rootRef.current?.closest('.overflow-y-auto') as HTMLElement | null;
    const target = teamMemory.scroll[tab] ?? 0;
    if (!scroller || !contentReady) return;
    restoring.current = true;
    let frames = 0;
    let raf = 0;
    // La hauteur finale arrive avec les images et les graphiques : quelques images au plus
    const step = () => {
      scroller.scrollTop = target;
      if (Math.abs(scroller.scrollTop - target) > 2 && frames++ < 30) raf = requestAnimationFrame(step);
      else restoring.current = false;
    };
    step();
    return () => { cancelAnimationFrame(raf); restoring.current = false; };
  }, [tab, contentReady, team]);

  const pickTeam = (key: string) => {
    if (key !== team) teamMemory.scroll = {};
    setTeam(key);
  };

  // ===== Onglets (ARIA : flèches, Début, Fin ; activation automatique) =====
  const tabRefs = useRef(new Map<TeamTab, HTMLButtonElement>());
  const onTabKey = (e: React.KeyboardEvent, index: number) => {
    const last = TEAM_TABS.length - 1;
    const next = e.key === 'ArrowRight' ? (index === last ? 0 : index + 1) : e.key === 'ArrowLeft' ? (index === 0 ? last : index - 1)
      : e.key === 'Home' ? 0 : e.key === 'End' ? last : null;
    if (next === null) return;
    e.preventDefault();
    const key = TEAM_TABS[next].key;
    setTab(key);
    tabRefs.current.get(key)?.focus();
  };

  const compare = onNavigate ? (p: PlayerData) => { prepareComparison([p]); onNavigate(ViewState.COMPARISON); } : undefined;

  return (
    <div ref={rootRef} className="animate-fade-in">
      {/* ===== En-tête : recherche, identité, contexte ===== */}
      <div className="bg-surface border-b border-line px-4 sm:px-5 pt-3">
        <h1 className="sr-only">Analyse d'équipe{info ? ` : ${info.name}` : ''}</h1>
        <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
          <TeamSearch className="w-full sm:w-72" selected={team} onPick={pickTeam} label="Rechercher une équipe" />
          {info && ctx && (
            <div className="flex items-center gap-3 min-w-[14rem] flex-1">
              <TeamLogo src={info.logo} name={info.name} size="md" />
              <div className="min-w-0">
                <div className="text-base font-semibold text-ink truncate">{info.name}</div>
                <div className="text-2xs text-ink-3 flex flex-wrap items-center gap-x-1.5">
                  <CompetitionBadge competition={info.competition} />
                  <span>· {ctx.seasonLabel}</span>
                  <span>· {matches === null ? 'matchs N/D' : `${matches} match${matches > 1 ? 's' : ''}`}</span>
                </div>
              </div>
            </div>
          )}
          {info && onNavigate && (
            <button type="button" className="sv-btn sv-btn-secondary sv-btn-sm w-full sm:w-auto justify-center shrink-0" onClick={() => { openRecruitment(team); onNavigate(ViewState.RECRUITMENT); }}>
              <UserSearch className="w-3.5 h-3.5" aria-hidden /> Voir les besoins de recrutement
            </button>
          )}
        </div>

        {info && (
          <>
            <dl className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-x-4 gap-y-3 mt-3">
              <div className="min-w-0 col-span-2 sm:col-span-1">
                <dt className="sv-label">Formation principale</dt>
                <dd className="mt-0.5 text-sm font-semibold text-ink num">
                  {lineups === undefined ? '…' : mainFormation
                    ? <>{mainFormation.formation} <span className="text-ink-3 font-normal">· {mainFormation.matches} / {matches ?? lineups?.matches ?? '?'} matchs</span></>
                    : 'N/D'}
                </dd>
              </div>
              <div className="min-w-0 col-span-2 sm:col-span-1">
                <dt className="sv-label">Style observé</dt>
                <dd className="mt-0.5 text-sm font-semibold text-ink">
                  {!style ? <span className="text-ink-3 font-normal">N/D</span>
                    : reliability === 'insufficient' ? <span className="text-ink-3 font-normal">Non établi ({matches ?? 0} match{(matches ?? 0) > 1 ? 's' : ''})</span>
                      : reliability === 'trend' ? <>{styleLabel(style)} <span className="text-warn font-normal text-2xs">tendance · {matches} matchs</span></>
                        : styleLabel(style)}
                </dd>
              </div>
              {ranks.map(r => (
                <div key={r.def.key} className="min-w-0" title={`${r.def.sense} · rang parmi ${r.teams} équipes de ${leagueName}`}>
                  <dt className="sv-label">{HEADER_LABELS[r.def.key]}</dt>
                  <dd className="mt-0.5 flex items-baseline gap-1.5 text-sm font-semibold text-ink num">
                    {formatTeamValue(r)}
                    {r.rank !== undefined ? <PercentileValue value={Math.round(r.rank)} className="text-2xs" /> : <span className="text-2xs text-ink-4 font-normal">sans rang</span>}
                  </dd>
                </div>
              ))}
            </dl>
            {(inProgress || isCup) && (
              <p className="flex items-start gap-1.5 text-2xs text-ink-3 mt-2">
                <Info className="w-3 h-3 mt-px shrink-0" aria-hidden />
                {isCup ? `Coupe d'Europe : ${matches ?? 0} match${(matches ?? 0) > 1 ? 's' : ''} dans les données ; rangs parmi les équipes de la compétition, à lire avec prudence.`
                  : 'Saison en cours : rangs et style reposent sur peu de matchs ; recoupez avec la saison précédente.'}
                {' '}Rang = percentile parmi les équipes de la compétition et de la saison.
              </p>
            )}
          </>
        )}

        <div role="tablist" aria-label="Sections de l'analyse d'équipe" className="grid grid-cols-2 sm:flex sm:items-end sm:gap-1 mt-3">
          {TEAM_TABS.map((t, i) => (
            <button key={t.key} ref={el => { if (el) tabRefs.current.set(t.key, el); }} type="button" role="tab" id={`team-tab-${t.key}`}
              aria-selected={tab === t.key} aria-controls={`team-panel-${t.key}`} tabIndex={tab === t.key ? 0 : -1}
              disabled={!team} onClick={() => setTab(t.key)} onKeyDown={e => onTabKey(e, i)}
              className={`sv-tab justify-center text-center !whitespace-normal !h-auto min-h-9 py-1.5 leading-tight sm:justify-start sm:!whitespace-nowrap ${tab === t.key ? 'sv-tab-on' : ''}`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* ===== Contenu ===== */}
      <div role="tabpanel" id={`team-panel-${tab}`} aria-labelledby={`team-tab-${tab}`} tabIndex={-1}>
        {!team || !ctx ? (
          <EmptyState icon={Activity} className="py-20" title="Choisissez une équipe">
            Recherchez un club : style et forces, onze et formations, réseau de passes, effectif et profondeur, tirs.
          </EmptyState>
        ) : (
          <>
            {tab === 'STYLE' && (
              <>
                <TeamStyleTab team={stats} teams={teamStats} leagueName={leagueName} allSeasons={allSeasons} />
                {/* Briefing d'opposition IA ancré : faits déjà affichés (statistiques, rangs, formation, effectif), résultat non enregistré */}
                <div className="px-5 pb-5">
                  <GroundedAiPanel title="Briefing d'opposition" resetKey={team}
                    help="Gemini rédige un briefing à partir des seuls faits d'équipe ScoutVision (statistiques de saison et leur rang dans la compétition, formation principale et titulaires, profil de l'effectif, joueurs les plus utilisés avec leur rôle). Le serveur rejette tout nombre absent des faits, tout sujet non mesuré et toute prédiction. Aucune donnée individuelle brute n'est transmise."
                    description="Quatre sections : identité et résultats, style et tendances, forces et vulnérabilités statistiques, points à préparer."
                    disabled={!stats} disabledReason="Aucune statistique d'équipe pour cette compétition : le briefing n'a pas de faits."
                    request={() => aiOpposition(buildOppositionFacts({
                      name: ctx.name, competition: leagueName, season: ctx.seasonLabel, stats, isCup,
                      ranks: stats ? teamMetricRanks(stats, teamStats, [...HEADER_METRICS, ...STYLE_METRICS.filter(m => !HEADER_METRICS.includes(m))]) : [],
                      mainFormation, profile, players, seasonInProgress: inProgress,
                    }))} />
                </div>
              </>
            )}
            {tab === 'LINEUP' && (
              <TeamLineupTab key={team} teamKey={team} lineups={lineups} lineupsError={lineupsData.error} onRetry={lineupsData.retry}
                players={players} teamMatches={matches} onSelectPlayer={onSelectPlayer} />
            )}
            {tab === 'NETWORK' && (
              <TeamNetworkTab key={team} teamKey={team} network={network} networkError={networksData.error} onRetry={networksData.retry}
                players={players} teamMatches={matches} onSelectPlayer={onSelectPlayer} />
            )}
            {tab === 'SQUAD' && (
              <TeamSquadTab key={team} teamKey={team} lineups={lineups} lineupsError={lineupsData.error} onRetryLineups={lineupsData.retry}
                players={players} teamMatches={matches} profile={profile} profileLeague={profileLeague} profileNote={profileNote}
                onSelectPlayer={onSelectPlayer} onCompare={compare} />
            )}
            {tab === 'SHOTS' && (
              <TeamShotsTab key={team} teamName={ctx.name} season={ctx.season} competition={ctx.competition} teamMatches={matches} players={players} />
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default TeamAnalysis;
