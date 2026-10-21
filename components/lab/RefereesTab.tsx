/**
 * ScoutVision AI - Laboratoire : arbitres
 * Sévérité (cartons par match, écart à la moyenne du championnat ramené selon sa fiabilité).
 */

import React, { useMemo, useState } from 'react';
import { LabExperiments, labData } from '../../services/labData';
import { frNumber } from '../../utils/lab';
import { CompetitionBadge } from '../Media';
import { DIVERGING, Loading, Missing, Panel, VerdictBadge, useLab } from './common';

const RefereesTab: React.FC<{ lab: LabExperiments }> = ({ lab }) => {
  const data = useLab(labData.referees);
  const [comp, setComp] = useState('');
  const [order, setOrder] = useState<'strict' | 'lenient' | 'matches'>('strict');
  const comps = useMemo(() => [...new Set((data?.rows ?? []).map(r => r.comp))].sort(), [data]);
  const rows = useMemo(() => (data?.rows ?? [])
    .filter(r => !comp || r.comp === comp)
    .sort((a, b) => order === 'matches' ? b.matches - a.matches
      : order === 'strict' ? b.cards_shrunk - a.cards_shrunk : a.cards_shrunk - b.cards_shrunk)
    .slice(0, 60), [data, comp, order]);
  if (data === undefined) return <Loading />;
  if (!data) return <Missing what="des arbitres" />;
  const rel = lab.experiments.referees.reliability;
  const max = Math.max(...rows.map(r => Math.abs(r.cards_shrunk)), 0.5);

  return (
    <Panel
      title="La sévérité des arbitres"
      subtitle={`Cartons par match comparés à la moyenne du championnat la même saison, ramenés vers zéro selon leur fiabilité (r = ${frNumber(rel.cards.r, 2)} entre matchs pairs et impairs, ${rel.cards.referees} arbitres). Les penalties (r = ${frNumber(rel.pens.r, 2)}) et un biais pour l'équipe à domicile (r = ${frNumber(rel.bias.r, 2)}) ne sont pas des traits stables : ils ne sont pas affichés.`}
      right={<VerdictBadge verdict={lab.experiments.referees.verdicts.cards} />}
    >
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <label className="text-[11px] text-slate-500">Championnat
          <select value={comp} onChange={e => setComp(e.target.value)} className="block mt-1 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200">
            <option value="">Tous</option>
            {comps.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="text-[11px] text-slate-500">Ordre
          <select value={order} onChange={e => setOrder(e.target.value as typeof order)} className="block mt-1 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200">
            <option value="strict">Les plus sévères</option>
            <option value="lenient">Les plus cléments</option>
            <option value="matches">Les plus expérimentés</option>
          </select>
        </label>
        <div className="flex gap-4 text-[11px] text-slate-400 pb-1">
          <span className="inline-flex items-center gap-1.5"><span className="w-3 h-2 rounded-sm" style={{ backgroundColor: DIVERGING.above }} /> Plus de cartons que la moyenne</span>
          <span className="inline-flex items-center gap-1.5"><span className="w-3 h-2 rounded-sm" style={{ backgroundColor: DIVERGING.below }} /> Moins</span>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] text-slate-500 uppercase tracking-wider border-b border-slate-800">
              <th className="text-left font-semibold py-2 pr-3">Arbitre</th>
              <th className="text-left font-semibold py-2 px-3">Saisons</th>
              <th className="text-right font-semibold py-2 px-3">Matchs</th>
              <th className="text-right font-semibold py-2 px-3">Cartons / match</th>
              <th className="text-left font-semibold py-2 pl-3 w-72">Écart à la moyenne (fiable)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const above = r.cards_shrunk >= 0;
              return (
                <tr key={r.referee} className="border-b border-slate-800/60">
                  <td className="py-2 pr-3"><span className="inline-flex items-center gap-2 text-white">{r.referee} <CompetitionBadge competition={r.comp} showName={false} /></span></td>
                  <td className="py-2 px-3 text-xs text-slate-400">{r.first === r.last ? r.first : `${r.first} → ${r.last}`}</td>
                  <td className="py-2 px-3 text-right text-xs text-slate-400 tabular-nums">{r.matches}</td>
                  <td className="py-2 px-3 text-right text-xs text-slate-300 tabular-nums">{frNumber(r.cards, 2)}</td>
                  <td className="py-2 pl-3">
                    <div className="flex items-center gap-2">
                      <div className="relative h-2.5 flex-1">
                        <div className="absolute inset-y-0 left-1/2 w-px bg-slate-600" />
                        <div className={`absolute inset-y-0 ${above ? 'left-1/2 rounded-r' : 'right-1/2 rounded-l'}`}
                          style={{ width: `${Math.abs(r.cards_shrunk) / max * 50}%`, backgroundColor: above ? DIVERGING.above : DIVERGING.below }} />
                      </div>
                      <span className="w-12 text-right font-mono text-xs text-slate-300 tabular-nums">{frNumber(r.cards_shrunk, 2, true)}</span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-slate-500 mt-3">Arbitres avec au moins 15 matchs de championnat. Ramener l'écart vers zéro évite qu'un arbitre peu vu paraisse extrême par hasard.</p>
    </Panel>
  );
};

export default RefereesTab;
