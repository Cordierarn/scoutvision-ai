/**
 * ScoutVision - Recrutement : nuage valeur Transfermarkt / projection, frontière valeur-performance.
 * Visualisation secondaire : la liste porte toutes les informations (valeur, projection,
 * efficient). Le graphique est monté après mesure de sa largeur (pas de rendu à -1 px).
 */

import React from 'react';
import { CartesianGrid, ReferenceLine, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from 'recharts';
import { Candidate, displayIndex } from '../../utils/recruitment';
import { formatEuro } from '../../utils/format';
import { useElementWidth } from '../Pitch';
import { BRAND, CONTEXT, INK } from '../../theme/charts';
import { candidateKey } from './CandidateTable';

const HEIGHT = 300;
const LOG_TICKS = [0.1, 0.25, 0.5, 1, 2.5, 5, 10, 25, 50, 100, 200];

interface Point { x: number; y: number; name: string; team: string; id: string }

interface DotProps { cx?: number; cy?: number; color: string }

// Point de 8 px avec anneau de la couleur du fond, zone de clic de 24 px
const Dot: React.FC<DotProps> = ({ cx, cy, color }) => {
  if (cx === undefined || cy === undefined) return null;
  return (
    <g style={{ cursor: 'pointer' }} data-scatter-point>
      <circle cx={cx} cy={cy} r={12} fill="transparent" />
      <circle cx={cx} cy={cy} r={5} fill={color} stroke={INK.surface} strokeWidth={2} />
    </g>
  );
};

const ValueScatter: React.FC<{
  candidates: Candidate[];
  baseline?: number;
  baselineName?: string;
  onPick: (id: string) => void;
}> = ({ candidates, baseline, baselineName, onPick }) => {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const priced = candidates.filter(c => c.market?.value);
  const toPoint = (c: Candidate): Point => ({
    x: c.market!.value! / 1e6, y: c.forecast.next, name: c.player.Player, team: c.player.Team, id: candidateKey(c),
  });
  const frontier = priced.filter(c => c.efficient).map(toPoint).sort((a, b) => a.x - b.x);
  const others = priced.filter(c => !c.efficient).map(toPoint);
  const unpriced = candidates.length - priced.length;
  if (priced.length === 0) return <p className="text-xs text-ink-4">Aucun candidat de la liste n'a de valeur Transfermarkt connue.</p>;

  const xs = priced.map(c => c.market!.value! / 1e6);
  const lo = Math.min(...xs) / 1.3;
  const hi = Math.max(...xs) * 1.3;
  const ticks = LOG_TICKS.filter(t => t >= lo && t <= hi);
  const ys = [...priced.map(c => c.forecast.next), ...(baseline !== undefined ? [baseline] : [])];
  const yLo = Math.max(0, Math.floor((Math.min(...ys) - 5) / 10) * 10);
  const yHi = Math.min(100, Math.ceil((Math.max(...ys) + 5) / 10) * 10);
  const yTicks = Array.from({ length: (yHi - yLo) / 10 + 1 }, (_, i) => yLo + 10 * i);
  const pick = (d: unknown) => { const id = (d as { payload?: Point }).payload?.id; if (id) onPick(id); };

  return (
    <figure className="m-0">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-2xs text-ink-3 mb-2">
        <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: BRAND }} aria-hidden /> Efficient valeur-performance</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: CONTEXT }} aria-hidden /> Autres candidats</span>
        {baseline !== undefined && (
          <span className="inline-flex items-center gap-1.5"><span className="w-4 border-t border-dashed border-ink-3" aria-hidden /> {baselineName ?? 'Titulaire'}, projeté</span>
        )}
      </div>
      <div ref={ref} style={{ height: HEIGHT }} role="img"
        aria-label={`Nuage de ${priced.length} candidats : valeur Transfermarkt en abscisse (échelle logarithmique), projection en ordonnée ; ${frontier.length} efficients valeur-performance. Les mêmes informations figurent dans la liste.`}>
        {width > 0 && (
          <ScatterChart width={width} height={HEIGHT} margin={{ top: 10, right: 16, bottom: 24, left: 0 }}>
            <CartesianGrid stroke={INK.grid} />
            <XAxis type="number" dataKey="x" scale="log" domain={[lo, hi]} ticks={ticks} allowDataOverflow
              tickFormatter={(v: number) => formatEuro(v * 1e6)} stroke={INK.axis} tick={{ fill: INK.muted, fontSize: 11 }}
              label={{ value: 'Valeur Transfermarkt (échelle logarithmique)', position: 'insideBottom', offset: -14, fill: INK.muted, fontSize: 11 }} />
            <YAxis type="number" dataKey="y" domain={[yLo, yHi]} ticks={yTicks} stroke={INK.axis} tick={{ fill: INK.muted, fontSize: 11 }} width={36} />
            {baseline !== undefined && <ReferenceLine y={baseline} stroke={INK.muted} strokeDasharray="4 3" strokeWidth={1} />}
            <Tooltip cursor={false} content={({ payload }) => {
              const p = payload?.[0]?.payload as Point | undefined;
              if (!p) return null;
              return (
                <div className="sv-tooltip">
                  <div className="text-ink font-semibold text-sm num">{displayIndex(p.y)} <span className="text-2xs text-ink-3 font-normal">projection chez nous</span></div>
                  <div className="text-ink-2">{p.name}</div>
                  <div className="text-ink-3">{p.team} · {formatEuro(p.x * 1e6)}</div>
                </div>
              );
            }} />
            <Scatter data={others} fill={CONTEXT} isAnimationActive={false} onClick={pick} shape={(props: unknown) => <Dot {...(props as DotProps)} color={CONTEXT} />} />
            <Scatter data={frontier} fill={BRAND} line={{ stroke: BRAND, strokeWidth: 2 }} lineType="joint" isAnimationActive={false} onClick={pick}
              shape={(props: unknown) => <Dot {...(props as DotProps)} color={BRAND} />} />
          </ScatterChart>
        )}
      </div>
      <figcaption className="text-2xs text-ink-4 mt-1">
        Visualisation secondaire : cliquez un point pour ouvrir son dossier. La liste porte les mêmes valeurs.
        {unpriced > 0 && ` ${unpriced} candidat${unpriced > 1 ? 's' : ''} sans valeur connue, absent${unpriced > 1 ? 's' : ''} du nuage.`}
      </figcaption>
    </figure>
  );
};

export default React.memo(ValueScatter);
