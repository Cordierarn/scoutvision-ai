/**
 * ScoutVision AI - Laboratoire : effectifs
 * Horloge de l'effectif (vieillissement) et dépendance aux coups de pied arrêtés, par équipe.
 */

import React, { useMemo, useState } from 'react';
import { LabExperiments, labData } from '../../services/labData';
import { frNumber, frPercent } from '../../utils/lab';
import { DIVERGING, Loading, Missing, Panel, SERIES, VerdictBadge, useLab } from './common';

const SquadsTab: React.FC<{ lab: LabExperiments }> = ({ lab }) => {
  const data = useLab(labData.teams);
  const seasons = useMemo(() => [...new Set((data?.rows ?? []).map(r => r._app_season))].sort().reverse(), [data]);
  const [season, setSeason] = useState<string | null>(null);
  const [comp, setComp] = useState('FRA');
  const current = season ?? seasons[0];
  const comps = useMemo(() => [...new Set((data?.rows ?? []).map(r => r.Competition))].sort(), [data]);
  const rows = useMemo(() => (data?.rows ?? []).filter(r => r._app_season === current && r.Competition === comp), [data, current, comp]);
  if (data === undefined) return <Loading />;
  if (!data) return <Missing what="des effectifs" />;
  // Écart à un effectif d'âge moyen (toutes compétitions, même saison) : seul l'écart compte, le niveau
  // des courbes d'âge porte le biais des joueurs restés dans les données
  const seasonClocks = (data?.rows ?? []).filter(r => r._app_season === current && r.clock !== null).map(r => Number(r.clock));
  const meanClock = seasonClocks.reduce((s, v) => s + v, 0) / Math.max(seasonClocks.length, 1);
  const clock = rows.filter(r => r.clock !== null).map(r => ({ ...r, effect: data.coef * (Number(r.clock) - meanClock) }))
    .sort((a, b) => b.effect - a.effect);
  const maxEffect = Math.max(...clock.map(r => Math.abs(r.effect)), 0.05);
  const sp = rows.filter(r => r.set_pieces !== null).sort((a, b) => Number(b.set_pieces) - Number(a.set_pieces));
  const maxSp = Math.max(...sp.map(r => Number(r.set_pieces)), 0.1);
  const ex = lab.experiments;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-2xs text-ink-3">Saison
          <select value={current} onChange={e => setSeason(e.target.value)} className="block mt-1 bg-raised border border-line-strong rounded px-2 py-1 text-xs text-ink">
            {seasons.map(s => <option key={s} value={s}>{s}{s === lab.current ? ' (en cours)' : ''}</option>)}
          </select>
        </label>
        <label className="text-2xs text-ink-3">Championnat
          <select value={comp} onChange={e => setComp(e.target.value)} className="block mt-1 bg-raised border border-line-strong rounded px-2 py-1 text-xs text-ink">
            {comps.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Panel
          title="L'horloge de l'effectif"
          subtitle={`Effet attendu du seul vieillissement sur l'xGD par match de la saison suivante, par rapport à un effectif d'âge moyen : âge de chaque joueur (courbes d'âge de la note globale), pondéré par ses minutes ; ${frNumber(data.coef, 3, true)} xGD par point d'effet d'âge (IC 95 % [${frNumber(data.ci[0], 3, true)} ; ${frNumber(data.ci[1], 3, true)}]), à niveau égal.`}
          right={<VerdictBadge verdict={ex.clock.verdict} />}
        >
          <div className="flex gap-4 text-2xs text-ink-3 mb-3">
            <span className="inline-flex items-center gap-1.5"><span className="w-3 h-2 rounded-sm" style={{ backgroundColor: DIVERGING.above }} /> À l'âge où l'on progresse</span>
            <span className="inline-flex items-center gap-1.5"><span className="w-3 h-2 rounded-sm" style={{ backgroundColor: DIVERGING.below }} /> Vieillissant</span>
          </div>
          <div className="space-y-1.5">
            {clock.map(r => {
              const above = r.effect >= 0;
              return (
                <div key={r['Team ID']} className="grid grid-cols-[10rem_1fr_9rem] items-center gap-3 text-xs">
                  <span className="text-ink-2 truncate">{r.team}</span>
                  <div className="relative h-2.5">
                    <div className="absolute inset-y-0 left-1/2 w-px bg-ink-4" />
                    <div className={`absolute inset-y-0 ${above ? 'left-1/2 rounded-r' : 'right-1/2 rounded-l'}`}
                      style={{ width: `${Math.abs(r.effect) / maxEffect * 50}%`, backgroundColor: above ? DIVERGING.above : DIVERGING.below }} />
                  </div>
                  <span className="text-right font-mono text-ink-2 tabular-nums whitespace-nowrap">{frNumber(r.effect, 3, true)} · {frNumber(Number(r.age), 1)} ans</span>
                </div>
              );
            })}
          </div>
          {clock.length === 0 && <p className="text-sm text-ink-3">Pas de données pour cette sélection.</p>}
        </Panel>
        <Panel
          title="Dépendance aux coups de pied arrêtés"
          subtitle={`Part de l'xG obtenue sur corners, coups francs et touches longues (hors penalties). Trait stable d'une saison à l'autre (r = ${frNumber(ex.setPieces.r, 2)}) ; moyenne ${frPercent(ex.setPieces.mean)}.`}
          right={<VerdictBadge verdict={ex.setPieces.verdict} />}
        >
          <div className="space-y-1.5">
            {sp.map(r => (
              <div key={r['Team ID']} className="grid grid-cols-[10rem_1fr_3.5rem] items-center gap-3 text-xs">
                <span className="text-ink-2 truncate">{r.team}</span>
                <div className="h-2.5 bg-raised rounded-r">
                  <div className="h-full rounded-r" style={{ width: `${Number(r.set_pieces) / maxSp * 100}%`, backgroundColor: SERIES[0] }} />
                </div>
                <span className="text-right font-mono text-ink-2 tabular-nums">{frPercent(Number(r.set_pieces))}</span>
              </div>
            ))}
          </div>
          {sp.length === 0 && <p className="text-sm text-ink-3">Pas de données pour cette sélection.</p>}
        </Panel>
      </div>
    </div>
  );
};

export default SquadsTab;
