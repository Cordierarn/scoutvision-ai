/**
 * ScoutVision AI - Simulateur de saison (V1, mode historique)
 * Sélectionne un replay précalculé (compétition, saison, point de départ, modèle) et le présente :
 * synthèse, classement simulé face au réel, distribution des rangs, détail d'une équipe, évolution de
 * l'erreur avec la saison, comparaison historique des modèles. Aucun calcul statistique dans le navigateur.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Replay, ReplayIndex, ReplayModel, ReplayPoint, ReplaySeasonFile, ReplaySummary, ReplayTeam, replayData } from '../../services/replayData';
import { CONTEXT, INK, SERIES, axisProps, tooltipProps } from '../../theme/charts';
import { EmptyState, InfoTip, LoadError, Panel, Skeleton, Stat, StatStrip } from '../ui';
import RankHeatmap from './RankHeatmap';
import {
  APPROXIMATE_TIEBREAK, MODEL_LABELS, MODEL_ORDER, POINT_ORDER, ROLLING_KNOWLEDGE, ROLLING_KNOWLEDGE_DETAIL, comparison, competitions, defaultSelection,
  findReplay, formatDate, headline, modelOptions, needsApproximateBanner, num, objectiveColumns, pct, pointOptions, seasonsOf, signed,
} from './simulatorLogic';

type Simulated = Extract<Replay, { status: 'simulated' }>;

// Sélection retrouvée au retour sur l'onglet
let remembered: { competition: string; season: string; point: ReplayPoint; model: ReplayModel } | null = null;

const Select: React.FC<{ id: string; label: string; value: string; onChange: (v: string) => void; options: { id: string; label: string; available?: boolean; reason?: string }[]; tip?: string }> =
  ({ id, label, value, onChange, options, tip }) => (
    <label htmlFor={id} className="text-2xs text-ink-3 flex flex-col gap-1 min-w-0">
      <span className="sv-label flex items-center gap-1">{label}{tip && <InfoTip text={tip} />}</span>
      <select id={id} value={value} onChange={e => onChange(e.target.value)} className="bg-raised border border-line-strong rounded px-2 py-1.5 text-xs text-ink min-w-0 w-full">
        {options.map(o => (
          <option key={o.id} value={o.id} disabled={o.available === false} title={o.reason}>{o.label}{o.available === false ? ' — indisponible' : ''}</option>
        ))}
      </select>
      {options.find(o => o.id === value)?.available === false && <span className="text-2xs text-warn">{options.find(o => o.id === value)?.reason}</span>}
    </label>
  );

const SeasonSimulator: React.FC = () => {
  const [index, setIndex] = useState<ReplayIndex | null>(null);
  const [summary, setSummary] = useState<ReplaySummary | null>(null);
  const [indexError, setIndexError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [competition, setCompetition] = useState(remembered?.competition ?? '');
  const [season, setSeason] = useState(remembered?.season ?? '');
  const [point, setPoint] = useState<ReplayPoint>(remembered?.point ?? 'q50');
  const [model, setModel] = useState<ReplayModel>(remembered?.model ?? 'scoutvision_reproduced');
  const [file, setFile] = useState<ReplaySeasonFile | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [fileAttempt, setFileAttempt] = useState(0);
  const [selectedTeam, setSelectedTeam] = useState<string | null>(null);
  const [errorMetric, setErrorMetric] = useState<'maeRank' | 'maePoints'>('maeRank');

  useEffect(() => {
    let cancelled = false;
    setIndexError(null);
    Promise.all([replayData.index(), replayData.summary()]).then(([i, s]) => {
      if (cancelled) return;
      setIndex(i); setSummary(s);
      const comps = competitions(i);
      const comp = comps.some(c => c.key === competition) ? competition : (comps.find(c => c.key === 'ENG')?.key ?? comps[0]?.key ?? '');
      setCompetition(comp);
      const seasons = seasonsOf(i, comp);
      setSeason(seasons.includes(season) ? season : (seasons[0] ?? ''));
      if (!remembered) setModel(i.defaultModel);
    }).catch(e => { if (!cancelled) setIndexError(e instanceof Error ? e.message : 'Chargement impossible.'); });
    return () => { cancelled = true; };
  }, [attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!competition || !season) return;
    let cancelled = false;
    setFile(null); setFileError(null); setSelectedTeam(null);
    replayData.season(competition, season).then(f => {
      if (cancelled) return;
      setFile(f);
      const current = findReplay(f, point, model);
      if (!current || current.status !== 'simulated') {
        const d = defaultSelection(f, model, point);
        if (d) { setPoint(d.point); setModel(d.model); }
      }
    }).catch(e => { if (!cancelled) setFileError(e instanceof Error ? e.message : 'Chargement impossible.'); });
    return () => { cancelled = true; };
  }, [competition, season, fileAttempt]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (competition && season) remembered = { competition, season, point, model }; }, [competition, season, point, model]);

  const replay = useMemo(() => (file ? findReplay(file, point, model) : undefined), [file, point, model]);
  const sim: Simulated | null = replay && replay.status === 'simulated' ? replay : null;
  const columns = useMemo(() => (file ? objectiveColumns(file.rules.objectives) : []), [file]);
  const head = useMemo(() => headline(sim?.teams ?? []), [sim]);
  const evo = summary?.evolution[model]?.[point];
  const pointLabels = useMemo(() => Object.fromEntries((index?.replayPoints ?? []).map(p => [p.id, p.label])), [index]);

  if (indexError) return <LoadError message={`Simulateur indisponible : ${indexError}`} onRetry={() => setAttempt(a => a + 1)} />;
  if (!index || !summary) return <Skeleton className="h-96" />;
  if (index.competitions.length === 0) return <EmptyState title="Aucun replay complet n'est disponible pour cette sélection." />;

  const seasons = seasonsOf(index, competition);
  const selectedTeamData = sim?.teams.find(t => t.id === selectedTeam) ?? null;
  const approx = sim ? needsApproximateBanner(file!.rules.exact, sim.approximateTiebreakShare) : false;

  return (
    <div className="space-y-4">
      {/* Contrôles : ils sélectionnent un replay précalculé, rien n'est simulé ici */}
      <div className="sv-panel p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Select id="sim-competition" label="Compétition" value={competition} onChange={v => { setCompetition(v); const s = seasonsOf(index, v); setSeason(s[0] ?? ''); }}
          options={competitions(index).map(c => ({ id: c.key, label: c.name }))}
          tip="Les compétitions à play-offs, scissions ou formats non encore reproduits restent disponibles dans les prévisions match par match, mais pas dans le simulateur de classement." />
        <Select id="sim-season" label="Saison" value={season} onChange={setSeason} options={seasons.map(s => ({ id: s, label: s }))} />
        {file ? (
          <>
            <Select id="sim-point" label="Point de départ" value={point} onChange={v => setPoint(v as ReplayPoint)} options={pointOptions(file, model, pointLabels)}
              tip="Début, 25 %, 50 % ou 75 % des rencontres de la saison. Le classement à cette date est celui des rencontres terminées ; le reste est simulé." />
            <Select id="sim-model" label="Modèle" value={model} onChange={v => setModel(v as ReplayModel)} options={modelOptions(file, point, index)}
              tip={`Identifiants techniques : ${index.models.map(m => `${m.label} = ${m.technical}`).join(' ; ')}. La référence marché historique est un repère, pas une prévision des bookmakers.`} />
          </>
        ) : <><Skeleton className="h-14" /><Skeleton className="h-14" /></>}
      </div>

      <p className="sr-only" aria-live="polite">
        {sim ? `Replay chargé : ${file!.rules.name} ${season}, ${pointLabels[point] ?? point}, ${MODEL_LABELS[model]}.` : file ? 'Replay indisponible pour cette sélection.' : 'Chargement du replay.'}
      </p>

      <div className="rounded-md border border-line bg-raised/40 px-3 py-2 text-xs text-ink-2 flex items-start gap-2">
        <span className="flex-1">{ROLLING_KNOWLEDGE}</span>
        <InfoTip text={ROLLING_KNOWLEDGE_DETAIL} align="end" />
      </div>

      {fileError && <LoadError message={`Replay indisponible : ${fileError}`} onRetry={() => setFileAttempt(a => a + 1)} />}
      {!fileError && !file && <Skeleton className="h-72" />}
      {file && !sim && (
        <EmptyState title="Aucun replay complet n'est disponible pour cette sélection.">
          {replay && replay.status === 'unavailable' ? `${replay.reason}.` : 'Choisissez un autre point de départ ou un autre modèle.'}
        </EmptyState>
      )}

      {file && sim && (
        <>
          {/* En-tête du replay */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-3">
            <span className="text-ink font-semibold text-sm">{file.rules.name} {season}</span>
            <span>Départ : {formatDate(sim.date)} ({pointLabels[point] ?? point}, {sim.played} rencontres jouées, {sim.remaining} simulées)</span>
            <span>Modèle : {MODEL_LABELS[model]}</span>
            <span>{file.nSims.toLocaleString('fr-FR')} simulations</span>
            <span>Généré le {new Date(file.generatedAt).toLocaleDateString('fr-FR')}</span>
            <span className={`inline-flex items-center rounded border px-1.5 h-5 text-2xs ${approx ? 'border-warn/50 text-ink-2' : 'border-line text-ink-3'}`}>
              {approx ? 'Départage approximatif' : 'Règles reproduites'}
            </span>
          </div>
          {approx && (
            <div className="rounded-md border border-line bg-raised/40 px-3 py-2 text-xs text-ink-2 flex items-start gap-2">
              <span className="flex-1">{APPROXIMATE_TIEBREAK} {sim.approximateTiebreakShare >= 0.01 && `Part des simulations concernées : ${pct(sim.approximateTiebreakShare)}.`}</span>
              <InfoTip align="end" text={`Règles non reproduites : ${file.rules.approximations.join(' ; ')}. Critères appliqués : ${file.rules.tiebreaks.join(', ')}.`} />
            </div>
          )}

          {/* Synthèse */}
          <StatStrip className="sv-panel py-3 grid-cols-2 lg:grid-cols-4">
            <Stat label="Équipe favorite au titre" value={head.favourite?.name ?? '–'} sub="simulation" />
            <Stat label="Probabilité de titre" value={head.pTitle !== null ? pct(head.pTitle) : '–'} sub={head.champion ? `Champion réel : ${head.champion.name}` : undefined} />
            <Stat label="Erreur moyenne du modèle à ce stade" value={evo ? `${num(evo.maeRank, 2)} rang` : 'N/D'} sub={evo ? `${num(evo.maePoints, 1)} pts · ${evo.replays} replays historiques` : 'non mesurée'} />
            <Stat label="Couverture de l'intervalle 80 %" value={evo ? pct(evo.coverage80) : 'N/D'} sub="points finaux réels dans l'intervalle" />
          </StatStrip>

          {/* Classement simulé face au réel */}
          <Panel title="Classement simulé" subtitle="SIMULATION à gauche, RÉSULTAT RÉEL à droite ; la couleur de l'écart décrit l'erreur de projection, pas l'équipe." flush>
            <div className="hidden md:block overflow-x-auto">
              <table className="sv-table">
                <caption className="sr-only">Classement simulé et résultat réel</caption>
                <thead>
                  <tr>
                    <th scope="col" className="text-right">Rang moyen</th><th scope="col">Équipe</th><th scope="col" className="text-right">Pts à la date</th>
                    <th scope="col" className="text-right">Pts projetés</th><th scope="col" className="text-right">Intervalle 80 %</th><th scope="col" className="text-right">Rang P5–P95</th>
                    {columns.map(c => <th key={c.key} scope="col" className="text-right">{c.label}</th>)}
                    <th scope="col" className="text-right border-l border-line">Rang réel</th><th scope="col" className="text-right">Pts réels</th><th scope="col" className="text-right">Écart rang</th>
                  </tr>
                </thead>
                <tbody>
                  {sim.teams.map(t => {
                    const gap = comparison(t);
                    return (
                      <tr key={t.id} onClick={() => setSelectedTeam(t.id)} className={`cursor-pointer ${selectedTeam === t.id ? 'bg-raised/60' : ''}`}>
                        <td className="text-right num">{num(t.rank.mean, 1)}</td>
                        <td><button type="button" onClick={() => setSelectedTeam(t.id)} className="text-left text-ink hover:text-accent focus-visible:text-accent">{t.name}</button></td>
                        <td className="text-right num text-ink-3">{t.current ? Math.round(t.current.points) : '–'}</td>
                        <td className="text-right num">{num(t.points.mean, 1)}</td>
                        <td className="text-right num text-ink-3 whitespace-nowrap">{Math.round(t.points.p10)} – {Math.round(t.points.p90)}</td>
                        <td className="text-right num text-ink-3 whitespace-nowrap">{Math.round(t.rank.p5)} – {Math.round(t.rank.p95)}</td>
                        {columns.map(c => <td key={c.key} className="text-right num whitespace-nowrap">{t.objectives[c.key] !== undefined ? pct(t.objectives[c.key]) : '–'}</td>)}
                        <td className="text-right num border-l border-line">{t.actual.rank ?? '–'}</td>
                        <td className="text-right num">{t.actual.points !== null ? Math.round(t.actual.points) : '–'}</td>
                        <td className={`text-right num ${gap.rankGap !== null && Math.abs(gap.rankGap) >= 3 ? 'text-warn' : 'text-ink-3'}`}>{gap.rankGap !== null ? signed(gap.rankGap, 1) : '–'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {/* Mobile : cartes compactes */}
            <ul className="md:hidden divide-y divide-line">
              {sim.teams.map(t => (
                <li key={t.id}>
                  <button type="button" onClick={() => setSelectedTeam(t.id)} className="w-full text-left px-4 py-2.5 flex items-center gap-3">
                    <span className="num text-ink font-semibold w-8 shrink-0">{num(t.rank.mean, 1)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm text-ink truncate">{t.name}</span>
                      <span className="block text-2xs text-ink-3">{num(t.points.mean, 0)} pts ({Math.round(t.points.p10)}–{Math.round(t.points.p90)}) · rang {Math.round(t.rank.p5)}–{Math.round(t.rank.p95)}
                        {columns[0] && ` · ${columns[0].label} ${pct(t.objectives[columns[0].key] ?? 0)}`}</span>
                    </span>
                    <span className="text-2xs text-ink-3 text-right shrink-0">réel<br /><span className="num text-ink">{t.actual.rank ?? '–'}</span></span>
                  </button>
                </li>
              ))}
            </ul>
          </Panel>

          {selectedTeamData && <TeamDetail team={selectedTeamData} columns={columns} onClose={() => setSelectedTeam(null)} />}

          <Panel title="Distribution des rangs" subtitle="Probabilité de chaque position finale ; les colonnes P5–P95 et objectifs du tableau donnent la même information en chiffres.">
            <RankHeatmap teams={sim.teams} onSelect={setSelectedTeam} selected={selectedTeam} />
          </Panel>

          <details className="text-2xs text-ink-4">
            <summary className="cursor-pointer text-ink-3">Détails techniques</summary>
            <p className="mt-1">Version de simulation {file.simulationVersion} · généré le {new Date(file.generatedAt).toLocaleString('fr-FR')} · modèle {index.models.find(m => m.id === model)?.technical ?? model} v{sim.modelVersion ?? '?'}
              {sim.fittedAt[0] && ` · prévisions ajustées du ${formatDate(sim.fittedAt[0])} au ${formatDate(sim.fittedAt[1] ?? sim.fittedAt[0])}`} · politique de score {sim.goalPolicy} · hash {sim.resultHash} · graine {file.seed}</p>
          </details>
        </>
      )}

      <Panel title="La prévision s'affine au fil de la saison" subtitle="Sur les replays historiques disponibles, l'erreur diminue à mesure que la saison avance. Cette courbe décrit le passé ; elle ne garantit pas la précision de la saison actuelle."
        right={(
          <div className="flex gap-1" role="group" aria-label="Mesure d'erreur">
            {(['maeRank', 'maePoints'] as const).map(k => (
              <button key={k} type="button" onClick={() => setErrorMetric(k)} aria-pressed={errorMetric === k} className={`sv-chip ${errorMetric === k ? 'sv-chip-on' : ''}`}>{k === 'maeRank' ? 'MAE rang' : 'MAE points'}</button>
            ))}
          </div>
        )}>
        <EvolutionChart summary={summary} metric={errorMetric} pointLabels={pointLabels} highlighted={model} />
      </Panel>

      <Panel title="Comparaison historique" subtitle="Modèles comparés sur les mêmes replays. Les écarts sont faibles et ne permettent pas toujours de départager les modèles." flush>
        <div className="overflow-x-auto">
          <table className="sv-table">
            <caption className="sr-only">Comparaison des modèles sur les replays communs</caption>
            <thead><tr><th scope="col">Modèle</th><th scope="col" className="text-right">Replays communs</th><th scope="col" className="text-right">MAE rang</th><th scope="col" className="text-right">MAE points</th><th scope="col" className="text-right">Spearman</th><th scope="col" className="text-right">Top-1</th><th scope="col" className="text-right">Couverture 80 %</th></tr></thead>
            <tbody>
              {MODEL_ORDER.map(m => summary.comparison.find(c => c.model === m)).filter((c): c is ReplaySummary['comparison'][number] => !!c).map(c => (
                <tr key={c.model}>
                  <td className="text-ink">{MODEL_LABELS[c.model as ReplayModel] ?? c.model}{c.model === 'market_closing' && <span className="text-ink-4"> (repère historique)</span>}</td>
                  <td className="text-right num">{c.replays}</td><td className="text-right num">{num(c.maeRank, 2)}</td><td className="text-right num">{num(c.maePoints, 2)}</td>
                  <td className="text-right num">{num(c.spearman, 3)}</td><td className="text-right num">{pct(c.top1)}</td><td className="text-right num">{pct(c.coverage80)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
};

const TeamDetail: React.FC<{ team: ReplayTeam; columns: { key: string; label: string }[]; onClose: () => void }> = ({ team, columns, onClose }) => (
  <Panel title={team.name} right={<button type="button" onClick={onClose} className="sv-btn sv-btn-ghost sv-btn-sm">Fermer</button>}>
    <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-3 text-sm">
      <Stat label="Rang moyen / médian" value={`${num(team.rank.mean, 1)} / ${Math.round(team.rank.median)}`} sub={`P5 ${Math.round(team.rank.p5)} · P95 ${Math.round(team.rank.p95)}`} />
      <Stat label="Points moyens" value={num(team.points.mean, 1)} sub={`P10 ${Math.round(team.points.p10)} · P90 ${Math.round(team.points.p90)}`} />
      <Stat label="Rang réel" value={team.actual.rank !== null ? String(team.actual.rank) : '–'} sub={team.current ? `à la date : ${team.current.rank}e, ${Math.round(team.current.points)} pts` : undefined} />
      <Stat label="Points réels" value={team.actual.points !== null ? String(Math.round(team.actual.points)) : '–'} sub={team.actual.points !== null ? `écart ${signed(team.points.mean - team.actual.points, 1)}` : undefined} />
      {columns.map(c => <Stat key={c.key} label={c.label} value={team.objectives[c.key] !== undefined ? pct(team.objectives[c.key], 1) : '–'} />)}
    </div>
  </Panel>
);

const EvolutionChart: React.FC<{ summary: ReplaySummary; metric: 'maeRank' | 'maePoints'; pointLabels: Record<string, string>; highlighted: ReplayModel }> = ({ summary, metric, pointLabels, highlighted }) => {
  const models = MODEL_ORDER.filter(m => summary.evolution[m]);
  const data = POINT_ORDER.map(p => ({ point: pointLabels[p] ?? p, ...Object.fromEntries(models.map(m => [m, summary.evolution[m]?.[p]?.[metric] ?? null])) }));
  const colour = (m: ReplayModel, i: number) => (m === 'market_closing' ? CONTEXT : SERIES[i % SERIES.length]);
  return (
    <div>
      <div className="h-64" role="img" aria-label={`Erreur moyenne (${metric === 'maeRank' ? 'rang' : 'points'}) par point de départ : ${models.map(m => `${MODEL_LABELS[m]} ${POINT_ORDER.map(p => `${pointLabels[p]} ${num(summary.evolution[m]?.[p]?.[metric] ?? 0, 2)}`).join(', ')}`).join(' ; ')}`}>
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 600, height: 256 }}>
          <LineChart data={data} margin={{ top: 12, right: 16, bottom: 4, left: 0 }}>
            <CartesianGrid stroke={INK.grid} vertical={false} />
            <XAxis dataKey="point" {...axisProps} />
            <YAxis {...axisProps} width={36} domain={[0, 'auto']} />
            <Tooltip {...tooltipProps} formatter={(v: number, name: string) => [num(v, 2), MODEL_LABELS[name as ReplayModel] ?? name]} />
            <Legend formatter={(v: string) => MODEL_LABELS[v as ReplayModel] ?? v} wrapperStyle={{ fontSize: 11 }} />
            {models.map((m, i) => (
              <Line key={m} type="monotone" dataKey={m} stroke={colour(m, i)} strokeWidth={m === highlighted ? 2.5 : 1.25} dot={{ r: 3 }} isAnimationActive={false} connectNulls />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <table className="sv-table mt-2 text-xs">
        <caption className="sr-only">Erreur moyenne par point de départ et par modèle</caption>
        <thead><tr><th scope="col">Modèle</th>{POINT_ORDER.map(p => <th key={p} scope="col" className="text-right">{pointLabels[p] ?? p}</th>)}</tr></thead>
        <tbody>
          {models.map(m => (
            <tr key={m}><td className="text-ink-2">{MODEL_LABELS[m]}</td>{POINT_ORDER.map(p => {
              const e = summary.evolution[m]?.[p];
              return <td key={p} className="text-right num">{e ? `${num(e[metric], 2)} (${e.replays})` : '–'}</td>;
            })}</tr>
          ))}
        </tbody>
      </table>
      <p className="text-2xs text-ink-4 mt-1">Entre parenthèses : nombre de replays historiques (ligue × saison) derrière chaque moyenne ; le point « Début » est rarement disponible en mode strict.</p>
    </div>
  );
};

export default SeasonSimulator;
