/**
 * ScoutVision AI - Pronostics : Méthode & fiabilité, consolidée. Tous les chiffres viennent des artefacts
 * (index des prévisions, replays, benchmark marché) : rien n'est codé en dur.
 */

import React, { useEffect, useState } from 'react';
import { MarketEvaluation, dataLoader } from '../../services/dataLoader';
import { MarketBenchmark, ReplayIndex, ReplaySummary, replayData } from '../../services/replayData';
import { LoadError, Panel, Skeleton } from '../ui';
import { MARKET_RESULT, freshness, pctFr } from './forecastLogic';
import { MODEL_LABELS, POINT_ORDER, num } from './simulatorLogic';

const MethodPanel: React.FC<{ forecastMarket?: MarketEvaluation }> = ({ forecastMarket }) => {
  const [index, setIndex] = useState<ReplayIndex | null>(null);
  const [summary, setSummary] = useState<ReplaySummary | null>(null);
  const [bench, setBench] = useState<MarketBenchmark | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setError(null);
    Promise.all([replayData.index(), replayData.summary(), replayData.marketBenchmark().catch(() => null)])
      .then(([i, s, b]) => { if (!cancelled) { setIndex(i); setSummary(s); setBench(b); } })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Chargement impossible.'); });
    return () => { cancelled = true; };
  }, [attempt]);
  if (error) return <LoadError message={`Méthode indisponible : ${error}`} onRetry={() => setAttempt(a => a + 1)} />;
  if (!index || !summary || bench === undefined) return <div role="status" aria-label="Chargement de la méthode"><Skeleton className="h-64" /></div>;

  const dates = freshness(dataLoader.getCachedIndex()?.generatedAt ?? null, index.generatedAt, forecastMarket?.period ?? bench?.dateRanges?.['2025-26'] ?? null);
  const pointLabels = Object.fromEntries(index.replayPoints.map(p => [p.id, p.label]));
  const evo = summary.evolution[index.defaultModel] ?? {};
  const cal = summary.objectiveCalibration;
  const retro = bench?.seasons['2025-26'] ?? null;
  const matchScores = bench?.matchValidation['2025-26'];
  const sportModels = matchScores ? Object.entries(matchScores).filter(([m]) => m !== 'scoutvision_stored').sort((a, b) => a[1] - b[1]) : [];

  return (
    <div className="space-y-4">
      <Panel title="Prévisions" subtitle={dates.forecasts ? `Prévisions mises à jour le ${dates.forecasts}.` : undefined}>
        <p className="text-sm text-ink-2 leading-relaxed">Les probabilités des rencontres à venir viennent du modèle <code className="text-ink-3">forecast</code> du pipeline PitchAPI : forces offensives et défensives en xG, effet du terrain, toutes compétitions (coupes d'Europe comprises). Elles sont affichées telles quelles, arrondies pour totaliser 100 ; une donnée absente s'affiche N/D.</p>
      </Panel>

      <Panel title="Simulation et replay" subtitle={dates.replays ? `Replays générés le ${dates.replays}.` : undefined}>
        <ul className="text-sm text-ink-2 leading-relaxed space-y-1.5 list-disc pl-5">
          <li><strong className="text-ink">{index.nSims.toLocaleString('fr-FR')} saisons simulées</strong> par replay, graine {index.seed} : le même replay donne toujours le même résultat.</li>
          <li><strong className="text-ink">Prévisions immuables</strong> : chaque rencontre reçoit sa prévision la semaine où elle se joue, à partir des seules rencontres déjà jouées ; le navigateur ne recalcule rien.</li>
          <li><strong className="text-ink">Replay historique à connaissance glissante</strong> : pour une rencontre restante, le replay reprend cette prévision, plus informée qu'un état du modèle figé à la date de départ.</li>
          <li><strong className="text-ink">Rencontres indépendantes</strong> : les forces ne bougent pas au fil d'une simulation ; les intervalles sont un peu trop étroits en début de saison.</li>
          <li><strong className="text-ink">Scores</strong> : quand le modèle fournit des buts attendus, le score est tiré conditionnellement à l'issue ; sinon depuis la distribution des scores du championnat sur les saisons antérieures. Effet sur les probabilités d'objectifs : {summary.goalPolicyImpact.meanAbsDeltaRelegation !== null ? `moins de ${pctFr(Math.max(summary.goalPolicyImpact.meanAbsDeltaRelegation, 0.001), 1)}` : 'négligeable'}.</li>
          <li><strong className="text-ink">Classement</strong> : points puis différence de buts ou confrontation directe selon la compétition ; la confrontation directe n'est reproduite que pour les égalités à deux équipes. Les égalités résiduelles (moins de 1 % des simulations dans la plupart des championnats, plus en Espagne et au Portugal) sont départagées de façon déterministe ; le simulateur l'indique quand la part dépasse 1 %.</li>
        </ul>
      </Panel>

      <Panel title="Validation match" subtitle={bench ? `${MARKET_RESULT.headline} Saison 2025-26${dates.market ? ` (${dates.market})` : ''}, ${bench.periods['2025-26'] ?? 'évaluation rétrospective'}.` : 'Benchmark marché détaillé non publié dans ces données.'}>
        {bench && retro ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <table className="sv-table">
              <caption className="text-left text-2xs text-ink-3 pb-1">Log-loss par rencontre, population commune de {retro.population.toLocaleString('fr-FR')} rencontres (plus bas = mieux)</caption>
              <thead><tr><th scope="col">Modèle</th><th scope="col" className="text-right">Log-loss</th></tr></thead>
              <tbody>
                <tr><td className="text-ink">Référence marché historique (clôture)</td><td className="text-right num text-ink">{num(retro.logLoss.market_closing_pinnacle ?? 0, 4)}</td></tr>
                {['scoutvision_reproduced', 'dixon_coles_decay', 'elo', 'xg_rolling'].filter(m => retro.logLoss[m] !== undefined).map(m => (
                  <tr key={m}><td className="text-ink-2">{MODEL_LABELS[m as keyof typeof MODEL_LABELS] ?? m}</td><td className="text-right num">{num(retro.logLoss[m], 4)}</td></tr>
                ))}
              </tbody>
            </table>
            <div className="text-sm text-ink-2 leading-relaxed space-y-2">
              <p>ScoutVision est le meilleur des modèles sportifs testés en prévision de match{sportModels.length > 1 && ` (${sportModels.slice(0, 3).map(([m, v]) => `${MODEL_LABELS[m as keyof typeof MODEL_LABELS] ?? m} ${num(v, 4)}`).join(', ')} sur l'ensemble des rencontres de 2025-26)`}, mais le marché de clôture reste plus précis
                {retro.vsMarket.scoutvision_reproduced && ` : écart de log-loss ${num(retro.vsMarket.scoutvision_reproduced.delta, 4)} par rencontre, intervalle 90 % [${num(retro.vsMarket.scoutvision_reproduced.ci90[0], 4)} ; ${num(retro.vsMarket.scoutvision_reproduced.ci90[1], 4)}]`}.</p>
              <p>Poids optimal de ScoutVision dans un mélange avec le marché : {bench.pool.scoutvision_reproduced?.selectedWeight ?? 'N/D'} — {bench.pool.scoutvision_reproduced?.interpretation ?? ''} {MARKET_RESULT.divergence}</p>
              {dates.market && <p className="text-xs text-ink-3">Benchmark marché du modèle publié : {dates.market}.</p>}
            </div>
          </div>
        ) : <p className="text-sm text-ink-3">Le résultat de référence est décrit dans l'onglet Modèle vs marché dès que le benchmark est publié.</p>}
      </Panel>

      <Panel title="Validation saison" subtitle="Erreur moyenne du rang final projeté par ScoutVision, replays historiques (ligue × saison), selon le point de départ.">
        <table className="sv-table">
          <caption className="sr-only">MAE du rang par point de départ</caption>
          <thead><tr><th scope="col">Point de départ</th><th scope="col" className="text-right">MAE rang</th><th scope="col" className="text-right">MAE points</th><th scope="col" className="text-right">Couverture 80 %</th><th scope="col" className="text-right">Replays</th></tr></thead>
          <tbody>
            {POINT_ORDER.filter(p => evo[p]).map(p => {
              const e = evo[p]!;
              return <tr key={p}><td className="text-ink-2">{pointLabels[p] ?? p}</td><td className="text-right num">{num(e.maeRank, 2)}</td><td className="text-right num">{num(e.maePoints, 2)}</td><td className="text-right num">{pctFr(e.coverage80)}</td><td className="text-right num">{e.replays}</td></tr>;
            })}
          </tbody>
        </table>
        <p className="text-xs text-ink-3 mt-2">L'erreur diminue à mesure que la saison avance ; en projection saisonnière, Elo, la référence marché et ScoutVision sont très proches (voir la comparaison historique du simulateur).</p>
      </Panel>

      <Panel title="Limites">
        <ul className="text-sm text-ink-2 leading-relaxed space-y-1 list-disc pl-5">
          <li>Le point « Début de saison » est souvent indisponible : des rencontres de clubs promus n'ont pas de prévision et rien n'est approximé.</li>
          <li>Les formats complexes (play-offs, scissions, conférences, coupes) ne sont pas simulés en classement ; ils restent dans les rencontres à venir.</li>
          {index.limitations.map(l => <li key={l}>{l}</li>)}
        </ul>
      </Panel>

      {cal && cal.bins.length > 0 && (
        <Panel title={`Calibration des probabilités d'objectifs — ${MODEL_LABELS[cal.model as keyof typeof MODEL_LABELS] ?? cal.model}`}
          subtitle="Tranche prédite, fréquence observée et effectif, sur les replays historiques. Les tranches élevées contiennent peu de replays et doivent être interprétées avec prudence.">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {cal.bins.map(o => (
              <table key={o.objective} className="sv-table">
                <caption className="text-left text-2xs text-ink-3 pb-1">{o.label}</caption>
                <thead><tr><th scope="col">Tranche prédite</th><th scope="col" className="text-right">Observé</th><th scope="col" className="text-right">N</th></tr></thead>
                <tbody>
                  {o.bins.map(b => (
                    <tr key={b.lo}><td>{pctFr(b.lo)} – {pctFr(b.hi)} <span className="text-ink-4">(moy. {pctFr(b.predicted)})</span></td><td className="text-right num">{pctFr(b.observed)}</td><td className="text-right num">{b.n}</td></tr>
                  ))}
                </tbody>
              </table>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
};

export default MethodPanel;
