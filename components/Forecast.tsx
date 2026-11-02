/**
 * ScoutVision AI - Pronostics
 * Matchs à venir (probabilités 1-N-2 et buts attendus du modèle `forecast` du pipeline PitchAPI),
 * Simulateur de saison (replays précalculés), Modèle vs marché (résultat de référence : le marché de
 * clôture reste plus précis) et Méthode & fiabilité. Aucune probabilité n'est recalculée ici.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { dataLoader, ForecastMatch, ForecastFile, MarketEvaluation, MarketSummary } from '../services/dataLoader';
import { MarketBenchmark, SuggestionProfile, SuggestionsIndex, replayData } from '../services/replayData';
import { TeamLogo, CompetitionBadge } from './Media';
import { EmptyState, InfoTip, LegendItem, LoadError, PageHeader, Panel, Skeleton, Stat, StatStrip } from './ui';
import { SERIES } from '../theme/charts';
import SeasonSimulator from './forecast/SeasonSimulator';
import MethodPanel from './forecast/MethodPanel';
import { SuggestionsBlock, SuggestionsControls } from './forecast/Suggestions';
import { BANKROLL_KEY, DEFAULT_PROFILE, PROFILE_KEY, PROFILE_ORDER, parseBankroll } from './forecast/suggestionsLogic';
import { MARKET_RESULT, formatGoals, freshness, pctFr, poolLabel, roundToHundred } from './forecast/forecastLogic';

// Séries ScoutVision (theme/charts) : domicile, extérieur ; nul en gris neutre
const HOME = SERIES[0];
const AWAY = SERIES[1];
const DRAW = '#4A586B';

const todayIso = () => new Date().toISOString().slice(0, 10);

const formatDate = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

// Impact simulé affiché à partir de 5 points de probabilité
const MIN_IMPACT = 0.05;

const ImpactBadge: React.FC<{ item?: { objective: string; delta: number }; side: string }> = ({ item, side }) => {
  if (!item || !Number.isFinite(item.delta) || item.delta < MIN_IMPACT) return null;
  return (
    <span title="Écart de probabilité d'atteindre l'objectif entre une victoire et une défaite, dans 20 000 saisons simulées ; le nul n'est pas pris en compte">
      Impact simulé {side} · {item.objective} : <span className="text-ink-2 font-semibold">±{Math.round(item.delta * 100)} pts</span>
    </span>
  );
};

const ProbabilityBlock: React.FC<{ match: ForecastMatch; parts: number[] | null }> = ({ match, parts }) => {
  const segments = [
    { key: 'home', label: `Victoire ${match.home}`, value: match.pHome, color: HOME },
    { key: 'draw', label: 'Nul', value: match.pDraw, color: DRAW },
    { key: 'away', label: `Victoire ${match.away}`, value: match.pAway, color: AWAY },
  ];
  return (
    <div>
      <div className="flex h-1.5 rounded-sm overflow-hidden gap-[2px]" aria-hidden>
        {parts && segments.map((s, i) => <div key={s.key} className="h-full" style={{ width: `${parts[i]}%`, background: s.color }} />)}
      </div>
      <div className="flex justify-between text-xs mt-1 num">
        <span className="text-ink font-medium">{parts ? `${parts[0]} %` : 'N/D'}</span>
        <span className="text-ink-3">nul {parts ? `${parts[1]} %` : 'N/D'}</span>
        <span className="text-ink font-medium">{parts ? `${parts[2]} %` : 'N/D'}</span>
      </div>
    </div>
  );
};

const MatchRow: React.FC<{ match: ForecastMatch; showCompetition?: boolean }> = ({ match, showCompetition = false }) => {
  const parts = roundToHundred([match.pHome, match.pDraw, match.pAway]);
  const lev = match.leverage;
  const hasImpact = (lev?.home && lev.home.delta >= MIN_IMPACT) || (lev?.away && lev.away.delta >= MIN_IMPACT);
  const goals = `${formatGoals(match.xgHome)} – ${formatGoals(match.xgAway)}`;
  return (
    <div className="px-4 py-2 border-b border-line/60 hover:bg-raised/40">
      {/* Desktop et tablette : une ligne */}
      <div className={`hidden sm:grid items-center gap-3 ${showCompetition ? 'grid-cols-[7rem_minmax(0,1fr)_minmax(11rem,1.3fr)_minmax(0,1fr)_6.5rem]' : 'grid-cols-[minmax(0,1fr)_minmax(11rem,1.3fr)_minmax(0,1fr)_6.5rem]'}`}>
        {showCompetition && <span className="text-2xs text-ink-3 min-w-0"><CompetitionBadge competition={match.competition} /></span>}
        <div className="flex items-center justify-end gap-2 min-w-0 text-[13px] text-ink">
          <span className="truncate text-right" title={match.home}>{match.home}</span>
          <TeamLogo src={match.homeLogo} name={match.home} size="xs" />
        </div>
        <ProbabilityBlock match={match} parts={parts} />
        <div className="flex items-center gap-2 min-w-0 text-[13px] text-ink">
          <TeamLogo src={match.awayLogo} name={match.away} size="xs" />
          <span className="truncate" title={match.away}>{match.away}</span>
        </div>
        <div className="text-right text-2xs text-ink-3 num" title="Buts attendus par le modèle avant le match (domicile – extérieur)">
          Buts attendus {goals}
        </div>
      </div>
      {/* Téléphone : équipes, puis probabilités, puis buts attendus */}
      <div className="sm:hidden space-y-1.5">
        <div className="flex items-center justify-between gap-2 text-[13px] text-ink min-w-0">
          <span className="flex items-center gap-1.5 min-w-0"><TeamLogo src={match.homeLogo} name={match.home} size="xs" /><span className="truncate" title={match.home}>{match.home}</span></span>
          <span className="text-ink-4 text-2xs shrink-0">{showCompetition ? match.competition : '–'}</span>
          <span className="flex items-center gap-1.5 min-w-0 justify-end"><span className="truncate text-right" title={match.away}>{match.away}</span><TeamLogo src={match.awayLogo} name={match.away} size="xs" /></span>
        </div>
        <ProbabilityBlock match={match} parts={parts} />
        <div className="text-2xs text-ink-3 num">Buts attendus {goals}</div>
      </div>
      {hasImpact && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5 mt-1 text-2xs text-ink-4 num">
          <ImpactBadge item={lev?.home} side={match.home} />
          <ImpactBadge item={lev?.away} side={match.away} />
        </div>
      )}
    </div>
  );
};

// Horizons proposés (jours) ; 0 = toute la saison
const HORIZONS = [{ days: 7, label: '7 jours' }, { days: 14, label: '14 jours' }, { days: 30, label: '30 jours' }, { days: 0, label: 'Saison' }];

// Compétitions triées par niveau (Big 5 et Ligue des champions d'abord), puis par nom
const byLevel = (keys: string[]) => [...keys].sort((a, b) => {
  const ca = dataLoader.getCompetition(a), cb = dataLoader.getCompetition(b);
  return (ca?.tier ?? 9) - (cb?.tier ?? 9) || (ca?.name ?? a).localeCompare(cb?.name ?? b);
});

const chip = (active: boolean) => `sv-chip shrink-0 ${active ? 'sv-chip-on' : ''}`;

const fmt4 = (v?: number) => (v === undefined || !Number.isFinite(v) ? 'N/D' : v.toLocaleString('fr-FR', { minimumFractionDigits: 4, maximumFractionDigits: 4 }));

/**
 * Modèle vs marché : résultat de référence (le marché de clôture reste plus précis), évaluation du
 * modèle publié (backtest du pipeline contre la clôture, par compétition) et benchmark historique
 * de l'étape de recherche. Aucune mise, aucun rendement, aucune cote sur un match à venir.
 */
const MarketPanel: React.FC<{ evaluation?: MarketEvaluation }> = ({ evaluation }) => {
  const [bench, setBench] = useState<MarketBenchmark | null | undefined>(undefined);
  useEffect(() => { replayData.marketBenchmark().then(setBench).catch(() => setBench(null)); }, []);
  const o = evaluation?.overall;
  const comps = Object.entries(evaluation?.competitions ?? {})
    .filter(([, s]) => s.matches)
    .sort((a, b) => (dataLoader.getCompetition(a[0])?.tier ?? 9) - (dataLoader.getCompetition(b[0])?.tier ?? 9) || b[1].matches - a[1].matches);
  const retro = bench?.seasons['2025-26'] ?? null;
  const vs = retro?.vsMarket.scoutvision_reproduced;
  const bucket = bench?.divergenceBuckets['2025-26']?.find(b => b.bucket === '15+') ?? null;
  const dates = freshness(null, null, evaluation?.period ?? null);
  const benchPeriod = freshness(null, null, bench?.dateRanges?.['2025-26'] ?? null).market;
  return (
    <div className="space-y-4">
      <Panel title="Résultat de référence" subtitle={MARKET_RESULT.headline}>
        <p className="text-sm text-ink-2 leading-relaxed">
          Sur les saisons testées, ScoutVision est le meilleur des modèles sportifs comparés en prévision de match, mais la cote de clôture sans marge reste plus précise, et un mélange
          des deux n'améliore pas le marché seul. {MARKET_RESULT.divergence} Ce constat vaut pour les périodes et compétitions mesurées ; il n'est pas une loi générale.
        </p>
        {bench === undefined && <Skeleton className="h-20 mt-3" />}
        {bench && retro && vs && (
          <StatStrip className="mt-4 grid-cols-2 lg:grid-cols-4">
            <Stat label="ScoutVision vs marché" value={`${vs.delta > 0 ? '+' : ''}${fmt4(vs.delta)}`} sub="écart de log-loss par match (positif = marché plus précis)" />
            <Stat label="Intervalle 90 %" value={`${fmt4(vs.ci90[0])} ; ${fmt4(vs.ci90[1])}`} sub={`P(ScoutVision plus précis) ${pctFr(vs.pModelBetter)}`} />
            <Stat label="Période" value={benchPeriod ?? '2025-26'} sub={`saison 2025-26, ${bench.periods['2025-26'] ?? 'évaluation rétrospective'}`} />
            <Stat label="Population commune" value={retro.population.toLocaleString('fr-FR')} sub={`poids optimal du modèle dans le mélange : ${bench.pool.scoutvision_reproduced?.selectedWeight ?? 'N/D'}`} />
          </StatStrip>
        )}
        {bucket && bucket.modelHigher.meanModel !== null && (
          <p className="text-xs text-ink-3 mt-3 leading-relaxed">
            Quand ScoutVision donnait à une issue au moins 15 points de plus que le marché ({bucket.modelHigher.outcomes.toLocaleString('fr-FR')} cas en 2025-26), il annonçait en moyenne {pctFr(bucket.modelHigher.meanModel)} contre {pctFr(bucket.modelHigher.meanMarket ?? 0)} pour le marché ;
            l'issue s'est produite dans {pctFr(bucket.modelHigher.observedFrequency ?? 0)} des cas.
          </p>
        )}
        {bench === null && <p className="text-xs text-ink-4 mt-3">Le benchmark historique détaillé n'est pas publié dans ces données ; l'évaluation du modèle publié ci-dessous reste disponible.</p>}
      </Panel>

      {!o ? (
        <EmptyState title="Évaluation du modèle publié indisponible dans ces données." />
      ) : (
        <Panel title="Le modèle publié face à la cote de clôture" subtitle={`${o.matches.toLocaleString('fr-FR')} rencontres prévues avant d'être jouées (backtest du pipeline), ${dates.market ?? ''}. Marché = cote de clôture sans marge (Betfair Exchange, sinon Pinnacle ou moyenne). RPS et log-loss : plus bas = mieux. Poids du modèle : sa part optimale dans un mélange avec le marché (0 = rien que le marché ne sache déjà).`} flush>
          <StatStrip className="px-4 py-3 grid-cols-2 lg:grid-cols-4">
            <Stat label="RPS modèle / marché" value={`${fmt4(o.rpsModel)} / ${fmt4(o.rpsMarket)}`} />
            <Stat label="Log-loss modèle / marché" value={`${fmt4(o.llModel)} / ${fmt4(o.llMarket)}`} />
            <Stat label="Poids du modèle" value={o.poolWeight.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} sub={poolLabel(o.poolWeight)} />
            <Stat label="Période" value={evaluation?.period ? `${evaluation.period[0]} → ${evaluation.period[1]}` : 'N/D'} sub="benchmark marché" />
          </StatStrip>
          <div className="overflow-x-auto">
            <table className="sv-table">
              <caption className="sr-only">Évaluation par compétition</caption>
              <thead><tr><th scope="col">Compétition</th><th scope="col" className="text-right">Rencontres</th><th scope="col" className="text-right">RPS modèle / marché</th><th scope="col" className="text-right">Log-loss modèle / marché</th><th scope="col" className="text-right">Poids</th><th scope="col">Lecture</th></tr></thead>
              <tbody>
                {comps.map(([c, s]: [string, MarketSummary]) => (
                  <tr key={c}>
                    <td className="text-ink"><CompetitionBadge competition={c} /></td>
                    <td className="text-right num text-ink-3">{s.matches}</td>
                    <td className="text-right num text-ink-2 whitespace-nowrap">{s.rpsModel.toFixed(3)} / {s.rpsMarket.toFixed(3)}</td>
                    <td className="text-right num text-ink-2 whitespace-nowrap">{s.llModel.toFixed(3)} / {s.llMarket.toFixed(3)}</td>
                    <td className="text-right num text-ink-2">{s.poolWeight.toFixed(2)}</td>
                    <td className="text-xs text-ink-3">{poolLabel(s.poolWeight)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {evaluation?.overUnder?.overall && (
            <p className="text-xs text-ink-3 px-4 py-3 leading-relaxed border-t border-line">
              Plus / moins de 2,5 buts (modèle joint, prévisions hors échantillon, {evaluation.overUnder.overall.matches.toLocaleString('fr-FR')} rencontres des championnats qui ont ces cotes) :
              Brier {evaluation.overUnder.overall.brierModel.toFixed(4)} contre {evaluation.overUnder.overall.brierMarket.toFixed(4)} pour la clôture, poids du modèle {evaluation.overUnder.overall.poolWeight.toFixed(2)} — {poolLabel(evaluation.overUnder.overall.poolWeight).toLowerCase()}.
            </p>
          )}
        </Panel>
      )}

      <p className="text-xs text-ink-3 leading-relaxed">
        Cotes football-data.co.uk (27 compétitions ; pas de coupes d'Europe, Croatie, Tchéquie, Serbie, Corée ni Arabie saoudite). Cette page mesure la qualité des probabilités face au marché ; elle ne recommande rien.
      </p>
    </div>
  );
};

// Onglet retrouvé au retour sur la page
let lastTab: 'matches' | 'simulator' | 'market' | 'method' = 'matches';

const Forecast: React.FC = () => {
  const [file, setFile] = useState<ForecastFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [tab, setTabState] = useState<'matches' | 'simulator' | 'market' | 'method'>(lastTab);
  const setTab = (t: typeof tab) => { lastTab = t; setTabState(t); };
  const [competition, setCompetition] = useState<string>('');
  const [horizon, setHorizon] = useState<number>(14);
  // Suggestions de paris (Labo paris) : artefact optionnel, profil et bankroll mémorisés dans ce navigateur
  const [suggestions, setSuggestions] = useState<SuggestionsIndex | null | undefined>(undefined);
  const [profile, setProfileState] = useState<SuggestionProfile>(() => {
    try { const v = localStorage.getItem(PROFILE_KEY) as SuggestionProfile | null; return v && PROFILE_ORDER.includes(v) ? v : DEFAULT_PROFILE; } catch { return DEFAULT_PROFILE; }
  });
  const [bankrollInput, setBankrollInput] = useState<string>(() => { try { return localStorage.getItem(BANKROLL_KEY) ?? '300'; } catch { return '300'; } });
  const bankroll = parseBankroll(bankrollInput);
  const setProfile = (p: SuggestionProfile) => { setProfileState(p); try { localStorage.setItem(PROFILE_KEY, p); } catch { /* stockage indisponible */ } };
  const setBankroll = (raw: string) => { setBankrollInput(raw); try { localStorage.setItem(BANKROLL_KEY, raw); } catch { /* stockage indisponible */ } };
  useEffect(() => { replayData.suggestions().then(setSuggestions).catch(() => setSuggestions(null)); }, [attempt]);
  const suggestionByMatch = useMemo(() => new Map((suggestions?.matches ?? []).map(m => [m.matchId, m])), [suggestions]);
  const now = useMemo(() => new Date(), [suggestions]);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    dataLoader.loadForecast().then(f => { if (!cancelled) setFile(f); }).catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Erreur inconnue'); });
    return () => { cancelled = true; };
  }, [attempt]);

  const matches = file?.matches ?? null;
  const upcoming = useMemo(() => {
    const today = todayIso();
    const limit = horizon > 0 ? new Date(Date.now() + horizon * 86400000).toISOString().slice(0, 10) : '9999';
    return (matches ?? []).filter(m => m.date >= today && m.date <= limit);
  }, [matches, horizon]);
  const competitions = useMemo(() => byLevel(Array.from(new Set(upcoming.map(m => m.competition)))), [upcoming]);

  const byDate = useMemo(() => {
    const groups = new Map<string, ForecastMatch[]>();
    upcoming
      .filter(m => !competition || m.competition === competition)
      .forEach(m => groups.set(m.date, [...(groups.get(m.date) ?? []), m]));
    return Array.from(groups.entries());
  }, [upcoming, competition]);

  const dates = freshness(dataLoader.getCachedIndex()?.generatedAt ?? null, null, null);
  const firstMatchId = byDate[0]?.[1][0]?.match_id;

  return (
    <div className="max-w-7xl mx-auto p-5 space-y-4 animate-fade-in">
      <PageHeader
        title="Pronostics"
        icon={CalendarDays}
        description="Probabilités de victoire, nul et défaite des prochaines rencontres, d'après les forces offensives et défensives des équipes en xG, effet du terrain compris (modèle du pipeline PitchAPI, coupes d'Europe comprises). Ce sont des probabilités, pas des certitudes."
        meta={dates.forecasts ? `Prévisions mises à jour le ${dates.forecasts}` : undefined}
      />

      <div className="sv-tabs" role="tablist" aria-label="Sections des pronostics">
        <button role="tab" aria-selected={tab === 'matches'} onClick={() => setTab('matches')} className={`sv-tab ${tab === 'matches' ? 'sv-tab-on' : ''}`}>Matchs à venir</button>
        <button role="tab" aria-selected={tab === 'simulator'} onClick={() => setTab('simulator')} className={`sv-tab ${tab === 'simulator' ? 'sv-tab-on' : ''}`}>Simulateur de saison</button>
        <button role="tab" aria-selected={tab === 'market'} onClick={() => setTab('market')} className={`sv-tab ${tab === 'market' ? 'sv-tab-on' : ''}`}>Modèle vs marché</button>
        <button role="tab" aria-selected={tab === 'method'} onClick={() => setTab('method')} className={`sv-tab ${tab === 'method' ? 'sv-tab-on' : ''}`}>Méthode &amp; fiabilité</button>
      </div>

      {tab === 'matches' && (
        <>
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <span className="sv-label mr-1">Période</span>
            {HORIZONS.map(h => (
              <button key={h.days} onClick={() => setHorizon(h.days)} aria-pressed={horizon === h.days} className={chip(horizon === h.days)}>{h.label}</button>
            ))}
            <InfoTip text="Les rencontres datées d'aujourd'hui restent affichées toute la journée : les prévisions ne portent ni heure ni résultat." align="start" />
          </div>

          {error && <LoadError message={`Prévisions indisponibles : ${error}`} onRetry={() => setAttempt(a => a + 1)} />}
          {!error && !file && <div role="status" aria-label="Chargement des prévisions"><Skeleton className="h-64" /></div>}

          {matches && upcoming.length === 0 && (
            <EmptyState title="Aucune rencontre à venir sur cette période.">Les prévisions couvrent les rencontres connues du pipeline jusqu'à la fin de saison ; élargissez la période.</EmptyState>
          )}

          {upcoming.length > 0 && (
            <>
              <div className="flex gap-2 overflow-x-auto pb-2 mb-4">
                <button onClick={() => setCompetition('')} aria-pressed={!competition} className={chip(!competition)}>Toutes ({upcoming.length})</button>
                {competitions.map(c => (
                  <button key={c} onClick={() => setCompetition(c)} aria-pressed={competition === c} className={chip(competition === c)}>
                    <CompetitionBadge competition={c} />
                  </button>
                ))}
              </div>

              {suggestions && (
                <div className="mb-4">
                  <SuggestionsControls index={suggestions} profile={profile} onProfile={setProfile} bankrollInput={bankrollInput} bankroll={bankroll} onBankroll={setBankroll} />
                </div>
              )}
              <div className="flex items-center gap-4 mb-3 flex-wrap">
                <LegendItem color={HOME} shape="bar">Victoire à domicile</LegendItem>
                <LegendItem color={DRAW} shape="bar">Nul</LegendItem>
                <LegendItem color={AWAY} shape="bar">Victoire à l'extérieur</LegendItem>
              </div>

              <div className="space-y-3">
                {byDate.map(([date, list]) => (
                  <div key={date} className="sv-panel overflow-hidden">
                    <div className="px-4 h-8 flex items-center border-b border-line sv-label !text-ink-2 first-letter:uppercase">{formatDate(date)}</div>
                    {list.map((m, i) => (
                      <React.Fragment key={m.match_id}>
                        <MatchRow match={m} showCompetition={!competition} />
                        {suggestions && (
                          <SuggestionsBlock match={suggestionByMatch.get(m.match_id)} profile={profile} bankroll={bankroll}
                            bilan={suggestions.bilan?.profiles?.[profile]} open={firstMatchId === m.match_id} now={now} />
                        )}
                      </React.Fragment>
                    ))}
                  </div>
                ))}
              </div>
              <p className="text-2xs text-ink-4">Pourcentages arrondis pour totaliser 100 ; « Impact simulé » : écart de probabilité d'un objectif de saison entre victoire et défaite dans 20 000 saisons simulées, affiché à partir de 5 points, pour les rencontres des deux prochaines semaines.</p>
            </>
          )}
        </>
      )}

      {tab === 'simulator' && <SeasonSimulator />}

      {tab === 'market' && <MarketPanel evaluation={file?.market} />}

      {tab === 'method' && <MethodPanel forecastMarket={file?.market} />}
    </div>
  );
};

export default Forecast;
