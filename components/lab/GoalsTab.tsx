/**
 * ScoutVision AI - Laboratoire : que vaut un but ?
 * Probabilité de victoire minute par minute ; chaque but vaut les points attendus qu'il rapporte.
 */

import React, { useMemo, useState } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { LabExperiments, labData } from '../../services/labData';
import { frNumber, frPercent } from '../../utils/lab';
import { CompetitionBadge } from '../Media';
import { Loading, Missing, Panel, SERIES, VerdictBadge, useLab } from './common';

const STATES: { key: string; label: string }[] = [
  { key: '-1', label: 'Égalisation (mené d\'un but)' },
  { key: '0', label: 'But de l\'avance (à égalité)' },
  { key: '1', label: 'But du break (mène d\'un but)' },
];

type Sort = 'points' | 'goals' | 'perGoal';

const ValueChart: React.FC<{ lab: LabExperiments }> = ({ lab }) => {
  const c = lab.experiments.goalValue.curves;
  const data = c.minutes.map((m, i) => ({ minute: m, ...Object.fromEntries(STATES.map(s => [s.key, c.byScore[s.key][i]])) }));
  const last = data.length - 1;
  const endLabel = (text: string) => (props: { x?: number; y?: number; index?: number }) =>
    props.index === last && props.x !== undefined && props.y !== undefined
      ? <text x={props.x + 6} y={props.y} dy={4} fill="#cbd5e1" fontSize={11}>{text}</text> : null;
  return (
    <div>
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-slate-400 mb-2">
        {STATES.map((s, i) => (
          <span key={s.key} className="inline-flex items-center gap-1.5"><span className="w-4 h-0.5" style={{ backgroundColor: SERIES[i] }} /> {s.label}</span>
        ))}
      </div>
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 800, height: 288 }}>
          <LineChart data={data} margin={{ top: 10, right: 90, bottom: 24, left: 0 }}>
            <CartesianGrid stroke="#1e293b" vertical={false} />
            <XAxis dataKey="minute" type="number" domain={[0, 90]} ticks={[0, 15, 30, 45, 60, 75, 90]} stroke="#334155" tick={{ fill: '#94a3b8', fontSize: 11 }}
              label={{ value: 'Minute du but', position: 'insideBottom', offset: -14, fill: '#64748b', fontSize: 11 }} />
            <YAxis stroke="#334155" tick={{ fill: '#94a3b8', fontSize: 11 }} width={40} domain={[0, 2]} ticks={[0, 0.5, 1, 1.5, 2]}
              tickFormatter={(v: number) => frNumber(v, 1)} />
            <Tooltip
              content={({ payload, label }) => !payload?.length ? null : (
                <div className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs space-y-1">
                  <div className="text-slate-400">But à la {label}e minute</div>
                  {STATES.map((s, i) => (
                    <div key={s.key} className="flex items-center gap-2">
                      <span className="w-3 h-0.5" style={{ backgroundColor: SERIES[i] }} />
                      <span className="text-white font-semibold">{frNumber(Number(payload[0].payload[s.key]), 2)} pt</span>
                      <span className="text-slate-500">{s.label}</span>
                    </div>
                  ))}
                </div>
              )}
            />
            {STATES.map((s, i) => (
              <Line key={s.key} type="monotone" dataKey={s.key} stroke={SERIES[i]} strokeWidth={2} dot={false} isAnimationActive={false}
                label={endLabel(s.key === '-1' ? 'égalisation' : s.key === '0' ? 'avance' : 'break')} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="text-[11px] text-slate-500 mt-1">
        Points attendus gagnés par l'équipe qui marque, entre deux équipes de force moyenne. À la 90e, un but qui donne l'avance vaut
        {' '}{frNumber(c.byScore['0'][last], 1)} point, une égalisation {frNumber(c.byScore['-1'][last], 1)}, un but du break {frNumber(c.byScore['1'][last], 1)}.
      </p>
    </div>
  );
};

const GoalsTab: React.FC<{ lab: LabExperiments }> = ({ lab }) => {
  const rows = useLab(labData.goals);
  const gv = lab.experiments.goalValue;
  const seasons = useMemo(() => [...new Set((rows ?? []).map(r => r.app_season))].sort().reverse(), [rows]);
  const [season, setSeason] = useState<string | null>(null);
  const [comp, setComp] = useState('');
  const [sort, setSort] = useState<Sort>('points');
  const current = season ?? seasons.find(s => s !== lab.current) ?? seasons[0];
  const comps = useMemo(() => [...new Set((rows ?? []).filter(r => r.app_season === current).map(r => r.comp))].sort(), [rows, current]);
  const list = useMemo(() => (rows ?? [])
    .filter(r => r.app_season === current && (!comp || r.comp === comp))
    .sort((a, b) => sort === 'goals' ? b.goals - a.goals || b.points - a.points
      : sort === 'perGoal' ? b.points / b.goals - a.points / a.goals : b.points - a.points)
    .slice(0, 50), [rows, current, comp, sort]);

  if (rows === undefined) return <Loading />;
  const cal = gv.calibration['70'];
  return (
    <div className="space-y-6">
      <Panel
        title="Que vaut vraiment un but ?"
        subtitle={`Probabilité de victoire minute par minute (Poisson sur le temps restant, forces des équipes d'après leurs xG de la saison, distribution réelle des buts dans le match), calibrée sur ${gv.matches.toLocaleString('fr-FR')} matchs et ${gv.goals.toLocaleString('fr-FR')} buts.`}
        right={<VerdictBadge verdict={gv.verdict} />}
      >
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_18rem] gap-6">
          <ValueChart lab={lab} />
          <div className="space-y-3 text-sm text-slate-400 leading-relaxed">
            <p>Un but vaut en moyenne <span className="text-white font-semibold">{frNumber(gv.meanValue, 2)} point</span>, mais <span className="text-white font-semibold">{frNumber(gv.byState['0'], 2)}</span> s'il donne l'avance et <span className="text-white font-semibold">{frNumber(gv.byState['2'], 2)}</span> quand on mène déjà de deux buts.</p>
            <p>Être décisif est en partie un trait du joueur : r = {frNumber(gv.perGoalReliability.r, 2)} d'une saison à l'autre pour les points par but ({gv.perGoalReliability.pairs} joueurs à 6 buts ou plus). Le reste tient au contexte de son équipe.</p>
            {cal && (
              <div>
                <div className="text-[11px] text-slate-500 mb-1">Calibration à la 70e minute : victoires à domicile observées (en haut) et prévues (en bas)</div>
                <div className="grid grid-cols-5 gap-1 text-center">
                  {cal.bins.map((b, i) => (
                    <div key={i} className="whitespace-nowrap"><div className="text-xs text-white tabular-nums">{frPercent(b.observed)}</div><div className="text-[10px] text-slate-500 tabular-nums">{frPercent(b.predicted)}</div></div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </Panel>

      {!rows ? <Missing what="des buts" /> : (
        <Panel title="Les buteurs qui rapportent des points" subtitle="Points apportés = somme, pour chacun de ses buts en championnat, des points attendus gagnés par son équipe. Décisif : but qui égalise ou donne l'avance ; de confort : quand l'équipe mène déjà de deux buts.">
          <div className="flex flex-wrap items-end gap-3 mb-4">
            <label className="text-[11px] text-slate-500">Saison
              <select value={current} onChange={e => setSeason(e.target.value)} className="block mt-1 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200">
                {seasons.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label className="text-[11px] text-slate-500">Championnat
              <select value={comp} onChange={e => setComp(e.target.value)} className="block mt-1 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200">
                <option value="">Tous</option>
                {comps.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label className="text-[11px] text-slate-500">Trier par
              <select value={sort} onChange={e => setSort(e.target.value as Sort)} className="block mt-1 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200">
                <option value="points">Points apportés</option>
                <option value="goals">Buts</option>
                <option value="perGoal">Points par but</option>
              </select>
            </label>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] text-slate-500 uppercase tracking-wider border-b border-slate-800">
                  <th className="text-left font-semibold py-2 pr-3">Joueur</th>
                  <th className="text-left font-semibold py-2 px-3">Club</th>
                  <th className="text-right font-semibold py-2 px-3">Buts</th>
                  <th className="text-right font-semibold py-2 px-3">Points apportés</th>
                  <th className="text-right font-semibold py-2 px-3">Points / but</th>
                  <th className="text-right font-semibold py-2 px-3">Décisifs</th>
                  <th className="text-right font-semibold py-2 px-3" title="Buts décisifs à partir de la 75e minute">Dont 75e+</th>
                  <th className="text-right font-semibold py-2 pl-3">De confort</th>
                </tr>
              </thead>
              <tbody>
                {list.map(r => (
                  <tr key={`${r.player_id}-${r.comp}`} className="border-b border-slate-800/60">
                    <td className="py-2 pr-3 text-white font-medium">{r.name}</td>
                    <td className="py-2 px-3"><span className="inline-flex items-center gap-1.5 text-xs text-slate-300">{r.team ?? '—'} <CompetitionBadge competition={r.comp} showName={false} /></span></td>
                    <td className="py-2 px-3 text-right tabular-nums text-slate-300">{r.goals}</td>
                    <td className="py-2 px-3 text-right tabular-nums text-white font-semibold">{frNumber(r.points, 1)}</td>
                    <td className="py-2 px-3 text-right tabular-nums text-slate-300">{frNumber(r.points / r.goals, 2)}</td>
                    <td className="py-2 px-3 text-right tabular-nums text-slate-300">{r.decisive}</td>
                    <td className="py-2 px-3 text-right tabular-nums text-slate-300">{r.late}</td>
                    <td className="py-2 pl-3 text-right tabular-nums text-slate-400">{r.padding}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );
};

export default GoalsTab;
