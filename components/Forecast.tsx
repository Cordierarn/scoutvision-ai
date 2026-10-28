/**
 * ScoutVision AI - Pronostics des prochains matchs
 * Probabilités 1-N-2 et xG attendus du modèle `forecast` du pipeline PitchAPI
 * (forces d'attaque et de défense en xG, avantage du terrain).
 */

import React, { useEffect, useMemo, useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { dataLoader, ForecastMatch, ForecastFile, ProjectedRow, MarketEvaluation, MarketSummary } from '../services/dataLoader';
import { TeamLogo, CompetitionBadge } from './Media';
import { EmptyState, LegendItem, PageHeader, Panel, Stat } from './ui';
import { SERIES } from '../theme/charts';

// Séries ScoutVision (theme/charts) : domicile, extérieur ; nul en gris neutre
const HOME = SERIES[0];
const AWAY = SERIES[1];
const DRAW = '#4A586B';

const pct = (p: number) => Math.round(p * 100);

const todayIso = () => new Date().toISOString().slice(0, 10);

const formatDate = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

const MatchRow: React.FC<{ match: ForecastMatch; showCompetition?: boolean }> = ({ match, showCompetition = false }) => {
  const segments = [
    { key: 'home', label: `Victoire ${match.home}`, value: match.pHome, color: HOME },
    { key: 'draw', label: 'Nul', value: match.pDraw, color: DRAW },
    { key: 'away', label: `Victoire ${match.away}`, value: match.pAway, color: AWAY },
  ];
  const lev = match.leverage;
  const hasLeverage = (lev?.home && lev.home.delta >= 0.05) || (lev?.away && lev.away.delta >= 0.05);
  return (
    <div className="px-4 py-2 border-b border-line/60 hover:bg-raised/40">
      <div className={`grid items-center gap-3 ${showCompetition ? 'grid-cols-[8.5rem_minmax(0,1fr)_minmax(13rem,1.3fr)_minmax(0,1fr)_6.5rem]' : 'grid-cols-[minmax(0,1fr)_minmax(13rem,1.3fr)_minmax(0,1fr)_6.5rem]'}`}>
        {showCompetition && <span className="text-2xs text-ink-3 min-w-0"><CompetitionBadge competition={match.competition} /></span>}
        <div className="flex items-center justify-end gap-2 min-w-0 text-[13px] text-ink">
          <span className="truncate text-right">{match.home}</span>
          <TeamLogo src={match.homeLogo} name={match.home} size="xs" />
        </div>

        <div>
          <div className="flex h-1.5 rounded-sm overflow-hidden gap-[2px]">
            {segments.map(s => (
              <div key={s.key} title={`${s.label} : ${pct(s.value)} %`} className="h-full" style={{ width: `${s.value * 100}%`, background: s.color }} />
            ))}
          </div>
          <div className="flex justify-between text-xs mt-1 num">
            <span className="text-ink font-medium">{pct(match.pHome)} %</span>
            <span className="text-ink-3">nul {pct(match.pDraw)} %</span>
            <span className="text-ink font-medium">{pct(match.pAway)} %</span>
          </div>
        </div>

        <div className="flex items-center gap-2 min-w-0 text-[13px] text-ink">
          <TeamLogo src={match.awayLogo} name={match.away} size="xs" />
          <span className="truncate">{match.away}</span>
        </div>

        <div className="text-right text-2xs text-ink-3 num" title="xG attendus">
          xG {match.xgHome.toFixed(2)} – {match.xgAway.toFixed(2)}
        </div>
      </div>

      {/* Enjeu de saison (à partir de 5 points) et marché : probabilités sans marge, avantage du modèle */}
      {(hasLeverage || match.market) && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5 mt-1 text-2xs text-ink-4 num">
          <LeverageBadge item={lev?.home} side={match.home} />
          <LeverageBadge item={lev?.away} side={match.away} />
          {match.market && ['Domicile', 'Nul', 'Extérieur'].map((label, i) => {
            const edge = match.market!.edge[i];
            const value = edge !== null && edge > VALUE_EDGE;
            return (
              <span key={label}>
                {label} : marché {pct(match.market!.fair[i])} %
                {match.market!.best[i] !== null && <> · cote {match.market!.best[i]!.toFixed(2)}</>}
                {value && <span className="text-ink font-semibold"> · avantage +{Math.round(edge! * 100)} %</span>}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
};

// Avantage du modèle affiché au-delà de ce seuil (même seuil que l'évaluation)
const VALUE_EDGE = 0.05;

const LeverageBadge: React.FC<{ item?: { objective: string; delta: number }; side: string }> = ({ item, side }) => {
  if (!item || item.delta < 0.05) return null;
  return (
    <span title="Variation de la probabilité d'atteindre l'objectif entre une victoire et une défaite">
      Enjeu {side} · {item.objective} : <span className="text-ink-2 font-semibold">{Math.round(item.delta * 100)} pts</span>
    </span>
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

/**
 * Probabilité en pourcentage, « <1 % » et « – » pour les petites valeurs
 */
const prob = (p?: number) => (p === undefined ? '' : p >= 0.995 ? '>99%' : p < 0.005 ? '–' : p < 0.01 ? '<1%' : `${Math.round(p * 100)}%`);

/**
 * Classement projeté d'une compétition : points actuels + points attendus d'ici la fin,
 * et probabilités de fin de saison (20 000 simulations des matchs restants)
 */
const ProjectedTable: React.FC<{ rows: ProjectedRow[] }> = ({ rows }) => {
  const max = Math.max(...rows.map(r => r.projectedPoints), 1);
  return (
    <div className="sv-panel overflow-hidden">
      <div className="grid grid-cols-12 px-4 h-8 items-center sv-label border-b border-line">
        <div className="col-span-1">#</div>
        <div className="col-span-3">Équipe</div>
        <div className="col-span-1 text-right">J</div>
        <div className="col-span-1 text-right">Pts</div>
        <div className="col-span-1 text-right">Diff</div>
        <div className="col-span-1 text-right" title="Probabilité de finir premier">Titre</div>
        <div className="col-span-1 text-right" title="Probabilité de finir dans les 4 premiers">Top 4</div>
        <div className="col-span-1 text-right" title="Probabilité de finir dans les 3 derniers">3 derniers</div>
        <div className="col-span-2 text-right">Pts projetés</div>
      </div>
      {rows.map(r => (
        <div key={r.team} className="grid grid-cols-12 items-center px-4 h-9 border-b border-line/60 text-[13px] hover:bg-raised/40 num">
          <div className="col-span-1 text-ink-3 num">{r.rank}</div>
          <div className="col-span-3 flex items-center gap-2 min-w-0 text-ink">
            <TeamLogo src={r.logo} name={r.team} size="xs" />
            <span className="truncate">{r.team}</span>
          </div>
          <div className="col-span-1 text-right text-ink-3 num">{r.played}</div>
          <div className="col-span-1 text-right text-ink num">{r.points}</div>
          <div className="col-span-1 text-right text-ink-3 num">{r.goalDiff > 0 ? `+${r.goalDiff}` : r.goalDiff}</div>
          <div className="col-span-1 text-right text-ink num">{prob(r.pTitle)}</div>
          <div className="col-span-1 text-right text-ink num">{prob(r.pTop4)}</div>
          <div className="col-span-1 text-right text-ink num">{prob(r.pBottom3)}</div>
          <div className="col-span-2 flex items-center gap-2 justify-end">
            {/* Barre : points acquis (plein) puis points attendus (clair) */}
            <div className="flex-1 max-w-[110px] h-1.5 rounded-sm bg-raised overflow-hidden flex" title={`${r.points} pts acquis + ${r.expectedPoints} attendus sur ${r.remaining} matchs`}>
              <div style={{ width: `${(r.points / max) * 100}%`, background: HOME }} />
              <div style={{ width: `${(r.expectedPoints / max) * 100}%`, background: HOME, opacity: 0.4 }} />
            </div>
            <span className="text-ink num font-bold w-8 text-right">{Math.round(r.projectedPoints)}</span>
          </div>
        </div>
      ))}
    </div>
  );
};

const signedPct = (v?: number, digits = 1) => (v === undefined ? '–' : `${v > 0 ? '+' : ''}${(v * 100).toFixed(digits)} %`);

// Sous ce poids, la part du modèle dans le mélange avec le marché est du bruit (~200 matchs)
const MIN_POOL_WEIGHT = 0.3;

/**
 * Verdict prudent : un avantage n'est retenu que si le gain contre la clôture est positif
 * à deux erreurs-types près ET que le modèle garde un poids net dans le mélange avec le marché
 */
function verdict(s?: Pick<MarketSummary, 'matches' | 'poolWeight' | 'bets' | 'clv' | 'clvSe'>): { label: string; tone: string } {
  if (!s || !s.matches) return { label: 'Pas de données', tone: 'text-ink-3' };
  const clvSignificant = s.clv !== undefined && s.clvSe !== undefined && s.bets !== undefined && s.bets >= 30 && s.clv - 2 * s.clvSe > 0;
  if (clvSignificant && s.poolWeight >= MIN_POOL_WEIGHT) return { label: 'Avantage possible', tone: 'text-pos' };
  if (s.poolWeight >= MIN_POOL_WEIGHT) return { label: 'Information complémentaire', tone: 'text-ink' };
  return { label: 'Le marché absorbe le modèle', tone: 'text-ink-3' };
}

/**
 * Plus / moins de 2,5 buts : modèle joint (prédictions hors échantillon) contre clôture
 */
const OverUnderSection: React.FC<{ data?: MarketEvaluation['overUnder'] }> = ({ data }) => {
  const o = data?.overall;
  if (!o) return null;
  const v = verdict(o);
  const comps = Object.entries(data?.competitions ?? {})
    .filter(([, s]) => s.matches)
    .sort((a, b) => (dataLoader.getCompetition(a[0])?.tier ?? 9) - (dataLoader.getCompetition(b[0])?.tier ?? 9) || b[1].matches - a[1].matches);
  return (
    <div className="sv-panel overflow-hidden">
      <div className="p-5">
        <div className="flex items-baseline justify-between mb-3">
          <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-ink">Plus / moins de 2,5 buts</h3>
          <span className={`text-sm font-semibold ${v.tone}`}>{v.label}</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div><div className="sv-label">Brier modèle / marché</div><div className="text-ink num">{o.brierModel.toFixed(4)} / {o.brierMarket.toFixed(4)}</div></div>
          <div><div className="sv-label">Poids du modèle</div><div className="text-ink num">{o.poolWeight.toFixed(2)}</div></div>
          <div><div className="sv-label">Gain contre la clôture</div><div className="text-ink num">{signedPct(o.clv)} <span className="text-ink-3 text-xs">± {((o.clvSe ?? 0) * 200).toFixed(1)}</span></div></div>
          <div><div className="sv-label">Rendement simulé</div><div className="text-ink num">{signedPct(o.roi)} <span className="text-ink-3 text-xs">± {((o.roiSe ?? 0) * 200).toFixed(1)}</span></div></div>
        </div>
        <p className="text-xs text-ink-3 mt-4 leading-relaxed">
          {o.matches.toLocaleString('fr-FR')} matchs des 16 championnats européens qui ont ces cotes, du {data?.period?.[0]} au {data?.period?.[1]}.
          Chaque semaine, le modèle joint est réajusté sur les seuls matchs déjà joués, puis il prédit la probabilité de plus de 2,5 buts
          (Poisson avec correction Dixon-Coles). Brier : plus bas = meilleur. {o.bets ?? 0} paris simulés quand l'avantage dépasse 5 % sur la cote moyenne avant match.
          {' '}{Math.round(o.overRate * 100)} % des matchs ont dépassé 2,5 buts.
        </p>
      </div>
      <div className="grid grid-cols-12 px-4 h-8 items-center sv-label border-y border-line">
        <div className="col-span-3">Compétition</div>
        <div className="col-span-1 text-right">Matchs</div>
        <div className="col-span-2 text-right">Brier mod. / marché</div>
        <div className="col-span-1 text-right">Poids</div>
        <div className="col-span-1 text-right">Paris</div>
        <div className="col-span-2 text-right">CLV</div>
        <div className="col-span-2 text-right">Verdict</div>
      </div>
      {comps.map(([c, s]) => {
        const vc = verdict(s);
        return (
          <div key={c} className="grid grid-cols-12 items-center px-4 h-9 border-b border-line/60 text-[13px]">
            <div className="col-span-3 text-ink"><CompetitionBadge competition={c} /></div>
            <div className="col-span-1 text-right text-ink-3 num">{s.matches}</div>
            <div className="col-span-2 text-right num text-ink-2">{s.brierModel.toFixed(3)} / {s.brierMarket.toFixed(3)}</div>
            <div className="col-span-1 text-right num text-ink-2">{s.poolWeight.toFixed(2)}</div>
            <div className="col-span-1 text-right num text-ink-3">{s.bets ?? '–'}</div>
            <div className="col-span-2 text-right num text-ink-2">{signedPct(s.clv)}</div>
            <div className={`col-span-2 text-right text-xs ${vc.tone}`}>{vc.label}</div>
          </div>
        );
      })}
    </div>
  );
};

const MarketPanel: React.FC<{ evaluation?: MarketEvaluation }> = ({ evaluation }) => {
  if (!evaluation?.overall) {
    return <p className="text-sm text-ink-3">Évaluation indisponible : les cotes football-data n'ont pas pu être chargées.</p>;
  }
  const o = evaluation.overall;
  const v = verdict(o);
  const comps = Object.entries(evaluation.competitions ?? {})
    .filter(([, s]) => s.matches)
    .sort((a, b) => (dataLoader.getCompetition(a[0])?.tier ?? 9) - (dataLoader.getCompetition(b[0])?.tier ?? 9) || b[1].matches - a[1].matches);
  return (
    <div className="space-y-5">
      <div className="sv-panel p-4">
        <div className="flex items-baseline justify-between mb-3">
          <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-ink">Le modèle face aux cotes de clôture</h3>
          <span className={`text-sm font-semibold ${v.tone}`}>{v.label}</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div><div className="sv-label">RPS modèle / marché</div><div className="text-ink num">{o.rpsModel.toFixed(4)} / {o.rpsMarket.toFixed(4)}</div></div>
          <div><div className="sv-label">Poids du modèle</div><div className="text-ink num">{o.poolWeight.toFixed(2)}</div></div>
          <div><div className="sv-label">Gain contre la clôture</div><div className="text-ink num">{signedPct(o.clv)} <span className="text-ink-3 text-xs">± {((o.clvSe ?? 0) * 200).toFixed(1)}</span></div></div>
          <div><div className="sv-label">Rendement simulé</div><div className="text-ink num">{signedPct(o.roi)} <span className="text-ink-3 text-xs">± {((o.roiSe ?? 0) * 200).toFixed(1)}</span></div></div>
        </div>
        <p className="text-xs text-ink-3 mt-4 leading-relaxed">
          {o.matches.toLocaleString('fr-FR')} matchs du {evaluation.period?.[0]} au {evaluation.period?.[1]}, prédits avant d'être joués (backtest du pipeline).
          Marché = cote de clôture sans marge (Betfair Exchange, sinon Pinnacle ou moyenne). RPS : plus bas = meilleur.
          Poids du modèle : sa part optimale dans un mélange avec le marché (0 = il n'apporte rien que le marché ne sache déjà).
          Paris simulés : {o.bets ?? 0} paris quand l'avantage du modèle dépasse {Math.round((evaluation.edgeThreshold ?? 0.05) * 100)} % sur la cote moyenne avant match ;
          le gain contre la clôture (CLV) est l'indicateur fiable, le rendement est très bruité (± = deux erreurs-types).
        </p>
      </div>

      <div className="sv-panel overflow-hidden">
        <div className="grid grid-cols-12 px-4 h-8 items-center sv-label border-b border-line">
          <div className="col-span-3">Compétition</div>
          <div className="col-span-1 text-right">Matchs</div>
          <div className="col-span-2 text-right">RPS mod. / marché</div>
          <div className="col-span-1 text-right">Poids</div>
          <div className="col-span-1 text-right">Paris</div>
          <div className="col-span-2 text-right">CLV</div>
          <div className="col-span-2 text-right">Verdict</div>
        </div>
        {comps.map(([c, s]) => {
          const vc = verdict(s);
          return (
            <div key={c} className="grid grid-cols-12 items-center px-4 h-9 border-b border-line/60 text-[13px]">
              <div className="col-span-3 text-ink"><CompetitionBadge competition={c} /></div>
              <div className="col-span-1 text-right text-ink-3 num">{s.matches}</div>
              <div className="col-span-2 text-right num text-ink-2">{s.rpsModel.toFixed(3)} / {s.rpsMarket.toFixed(3)}</div>
              <div className="col-span-1 text-right num text-ink-2">{s.poolWeight.toFixed(2)}</div>
              <div className="col-span-1 text-right num text-ink-3">{s.bets ?? '–'}</div>
              <div className="col-span-2 text-right num text-ink-2">{signedPct(s.clv)}</div>
              <div className={`col-span-2 text-right text-xs ${vc.tone}`}>{vc.label}</div>
            </div>
          );
        })}
      </div>

      <OverUnderSection data={evaluation.overUnder} />

      <p className="text-xs text-ink-3 leading-relaxed">
        Les cotes viennent de football-data.co.uk (27 compétitions ; pas de coupes d'Europe, Croatie, Tchéquie, Serbie, Corée ni Arabie saoudite).
        Un avantage affiché sur un match à venir n'est qu'un écart entre le modèle et le marché : tant que le gain contre la clôture n'est pas
        positif sur des centaines de paris, le marché a probablement raison. Le jeu comporte des risques : ne misez que ce que vous pouvez perdre.
      </p>
    </div>
  );
};

const Forecast: React.FC = () => {
  const [file, setFile] = useState<ForecastFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'matches' | 'tables' | 'market'>('matches');
  const [competition, setCompetition] = useState<string>('');
  const [horizon, setHorizon] = useState<number>(14);
  const [tableComp, setTableComp] = useState<string>('');

  useEffect(() => {
    dataLoader.loadForecast().then(setFile).catch(e => setError(e instanceof Error ? e.message : 'Erreur inconnue'));
  }, []);

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

  const tableKeys = useMemo(() => byLevel(Object.keys(file?.tables ?? {})), [file]);
  const activeTable = tableComp || tableKeys[0] || '';

  return (
    <div className="max-w-7xl mx-auto p-5 space-y-4 animate-fade-in">
      <PageHeader
        title="Pronostics"
        icon={CalendarDays}
        description="Probabilités de victoire, nul et défaite selon les forces offensives et défensives des équipes en xG, avantage du terrain compris (modèle du pipeline PitchAPI, coupes d'Europe comprises). Ce sont des probabilités, pas des certitudes : un favori à 60 % ne gagne pas 4 fois sur 10."
      />

      <div className="sv-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'matches'} onClick={() => setTab('matches')} className={`sv-tab ${tab === 'matches' ? 'sv-tab-on' : ''}`}>Matchs à venir</button>
        <button role="tab" aria-selected={tab === 'tables'} onClick={() => setTab('tables')} className={`sv-tab ${tab === 'tables' ? 'sv-tab-on' : ''}`} disabled={tableKeys.length === 0}>Classements projetés</button>
        <button role="tab" aria-selected={tab === 'market'} onClick={() => setTab('market')} className={`sv-tab ${tab === 'market' ? 'sv-tab-on' : ''}`}>Modèle vs marché</button>
      </div>

      {error && <p className="text-neg text-sm">Pronostics indisponibles : {error}</p>}

      {tab === 'matches' && (
        <>
          <div className="flex items-center gap-2 mb-3">
            <span className="sv-label mr-1">Période</span>
            {HORIZONS.map(h => (
              <button key={h.days} onClick={() => setHorizon(h.days)} className={chip(horizon === h.days)}>{h.label}</button>
            ))}
          </div>

          {matches && upcoming.length === 0 && (
            <div className="sv-panel border-dashed p-10 text-center">
              <p className="text-ink-2">Aucun match à venir sur cette période.</p>
              <p className="text-xs text-ink-3 mt-2">
                Pour rafraîchir les pronostics, lancez dans PitchApi-big-5 <code className="text-ink-3">python -m pitchapi_big5 forecast</code>, puis préparez à nouveau les données.
              </p>
            </div>
          )}

          {upcoming.length > 0 && (
            <>
              {/* Filtre par compétition, une seule ligne */}
              <div className="flex gap-2 overflow-x-auto pb-2 mb-4">
                <button onClick={() => setCompetition('')} className={chip(!competition)}>Toutes ({upcoming.length})</button>
                {competitions.map(c => (
                  <button key={c} onClick={() => setCompetition(c)} className={chip(competition === c)}>
                    <CompetitionBadge competition={c} />
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-4 mb-3">
                <LegendItem color={HOME} shape="bar">Victoire à domicile</LegendItem>
                <LegendItem color={DRAW} shape="bar">Nul</LegendItem>
                <LegendItem color={AWAY} shape="bar">Victoire à l'extérieur</LegendItem>
              </div>

              <div className="space-y-3">
                {byDate.map(([date, list]) => (
                  <div key={date} className="sv-panel overflow-hidden">
                    <div className="px-4 h-8 flex items-center border-b border-line sv-label !text-ink-2 first-letter:uppercase">{formatDate(date)}</div>
                    {list.map(m => <MatchRow key={m.match_id} match={m} showCompetition={!competition} />)}
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {tab === 'market' && <MarketPanel evaluation={file?.market} />}

      {tab === 'tables' && activeTable && (
        <>
          <div className="flex gap-2 overflow-x-auto pb-2 mb-4">
            {tableKeys.map(c => (
              <button key={c} onClick={() => setTableComp(c)} className={chip(activeTable === c)}>
                <CompetitionBadge competition={c} />
              </button>
            ))}
          </div>
          <ProjectedTable rows={file!.tables[activeTable]} />
          <p className="text-2xs text-ink-4 mt-2">
            Points projetés = points acquis + somme des points attendus (3 × P(victoire) + P(nul)) sur les matchs restants. Barre pleine : points acquis ; claire : points attendus.
          </p>
        </>
      )}
    </div>
  );
};

export default Forecast;
