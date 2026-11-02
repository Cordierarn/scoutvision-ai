/**
 * ScoutVision AI - Pronostics : méthode et fiabilité du simulateur de saison (texte, limites, calibration des objectifs).
 */

import React, { useEffect, useState } from 'react';
import { ReplayIndex, ReplaySummary, replayData } from '../../services/replayData';
import { LoadError, Panel, Skeleton } from '../ui';
import { MODEL_LABELS, pct } from './simulatorLogic';

const MethodPanel: React.FC = () => {
  const [index, setIndex] = useState<ReplayIndex | null>(null);
  const [summary, setSummary] = useState<ReplaySummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setError(null);
    Promise.all([replayData.index(), replayData.summary()])
      .then(([i, s]) => { if (!cancelled) { setIndex(i); setSummary(s); } })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Chargement impossible.'); });
    return () => { cancelled = true; };
  }, [attempt]);
  if (error) return <LoadError message={`Méthode indisponible : ${error}`} onRetry={() => setAttempt(a => a + 1)} />;
  if (!index || !summary) return <Skeleton className="h-64" />;
  const cal = summary.objectiveCalibration;
  return (
    <div className="space-y-4">
      <Panel title="Comment le simulateur de saison est construit">
        <ul className="text-sm text-ink-2 leading-relaxed space-y-1.5 list-disc pl-5">
          <li><strong className="text-ink">{index.nSims.toLocaleString('fr-FR')} saisons simulées</strong> par replay, graine {index.seed} : le même replay donne toujours le même résultat.</li>
          <li><strong className="text-ink">Prévisions immuables</strong> : chaque match reçoit sa prévision la semaine où il se joue, à partir des seuls matchs déjà joués ; le navigateur ne recalcule rien.</li>
          <li><strong className="text-ink">Connaissance glissante</strong> : pour un match restant, le replay reprend cette prévision, plus informée qu'un état du modèle figé à la date de départ.</li>
          <li><strong className="text-ink">Matchs indépendants</strong> : les forces ne bougent pas au fil des simulations ; les intervalles sont trop étroits en début de saison (couverture mesurée de l'intervalle 80 % : voir le simulateur).</li>
          <li><strong className="text-ink">Scores</strong> : quand le modèle fournit des buts attendus, le score est tiré conditionnellement à l'issue (Poisson) ; sinon depuis la distribution des scores du championnat sur les saisons antérieures. L'effet sur les probabilités d'objectifs est inférieur à {cal && summary.goalPolicyImpact.meanAbsDeltaRelegation !== null ? pct(summary.goalPolicyImpact.meanAbsDeltaRelegation, 1) : '1 %'}.</li>
          <li><strong className="text-ink">Règles de classement</strong> : points, puis différence de buts ou confrontation directe selon la compétition ; la confrontation directe n'est reproduite que pour les égalités à deux équipes ; barrages, matchs d'appui et déductions de points ne sont pas modélisés.</li>
          <li><strong className="text-ink">Référence marché historique</strong> : les probabilités de clôture (football-data) simulées de la même façon, comme repère, jamais comme prévision des bookmakers.</li>
        </ul>
      </Panel>
      <Panel title="Limites" subtitle="Ce que le simulateur ne sait pas faire, et le dit.">
        <ul className="text-sm text-ink-2 leading-relaxed space-y-1 list-disc pl-5">
          {index.limitations.map(l => <li key={l}>{l}</li>)}
          <li>Les compétitions à play-offs, scissions ou formats non encore reproduits restent disponibles dans les prévisions match par match, mais pas dans le simulateur de classement.</li>
        </ul>
      </Panel>
      {cal && (
        <Panel title={`Calibration des probabilités d'objectifs — ${MODEL_LABELS[cal.model as keyof typeof MODEL_LABELS] ?? cal.model}`}
          subtitle="Les probabilités d'objectifs sont mesurées sur un nombre limité de replays ; les classes élevées peuvent contenir peu d'observations. L'effectif est toujours affiché.">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {cal.bins.map(o => (
              <table key={o.objective} className="sv-table">
                <caption className="text-left text-2xs text-ink-3 pb-1">{o.label}</caption>
                <thead><tr><th scope="col">Probabilité prévue</th><th scope="col" className="text-right">Fréquence observée</th><th scope="col" className="text-right">Effectif</th></tr></thead>
                <tbody>
                  {o.bins.map(b => (
                    <tr key={b.lo}><td>{pct(b.lo)} – {pct(b.hi)} <span className="text-ink-4">(moy. {pct(b.predicted)})</span></td><td className="text-right num">{pct(b.observed)}</td><td className="text-right num">{b.n}</td></tr>
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
