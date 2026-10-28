/**
 * ScoutVision AI - Style de jeu d'une équipe
 * Carte des équipes d'une compétition sur les deux axes de l'ACP (scripts/models.py) :
 * axe 1 = contrôle (possession, territoire, ligne haute) contre jeu direct,
 * axe 2 = pressing et verticalité contre construction lente.
 */

import React, { useMemo } from 'react';
import { Compass } from 'lucide-react';
import { ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip, ReferenceLine, LabelList } from 'recharts';
import { TeamStats } from '../types';
import { dataLoader } from '../services/dataLoader';
import { styleLabel } from '../utils/labels';
import { CONTEXT, DIVERGING, INK, SERIES, tooltipProps } from '../theme/charts';

// Palette catégorielle de référence (fond sombre), 2 séries + gris neutre
const SELECTED = SERIES[0];
const SAME_STYLE = SERIES[1];
const OTHER = CONTEXT;

const PROFILE_LABELS: Record<string, string> = {
  possession: 'Possession',
  territory: 'Territoire',
  pressing: 'Pressing',
  line_height: 'Ligne défensive',
  directness: 'Jeu direct',
  build_up: 'Construction patiente',
};

interface Point {
  x: number;
  y: number;
  team: string;
  styleName: string;   // pas « style » : recharts transmet les champs du point au SVG
}

const TeamStyleMap: React.FC<{ team: TeamStats; teams: TeamStats[] }> = ({ team, teams }) => {
  const style = team.Style as string | undefined;
  const profile = dataLoader.getCachedIndex()?.models?.styles?.find(s => s.name === style)?.profile;

  const { selected, same, others } = useMemo(() => {
    const points: Point[] = teams
      .filter(t => t.competition === team.competition && typeof t['Style x'] === 'number')
      .map(t => ({ x: t['Style x'] as number, y: t['Style y'] as number, team: t.team, styleName: String(t.Style) }));
    return {
      selected: points.filter(p => p.team === team.team),
      same: points.filter(p => p.team !== team.team && p.styleName === style),
      others: points.filter(p => p.team !== team.team && p.styleName !== style),
    };
  }, [teams, team, style]);

  if (!style) return null;

  return (
    <div className="sv-panel p-4">
      <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-ink mb-1 flex items-center gap-1.5">
        <Compass className="w-3.5 h-3.5 text-ink-3" /> Style de jeu : {styleLabel(style)}
      </h3>
      <p className="text-xs text-ink-3 mb-4">
        Axe horizontal : contrôle du jeu ; axe vertical : pressing et verticalité. Six styles issus d'un k-means sur la possession, le territoire, le pressing (PPDA), la hauteur de ligne, le jeu direct et la construction, ajusté sur toutes les équipes-saisons de toutes les compétitions.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <div className="flex items-center gap-4 text-2xs text-ink-3 mb-2">
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ background: SELECTED }} />{team.team}</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ background: SAME_STYLE }} />Même style</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ background: OTHER }} />Autres équipes</span>
          </div>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 16, right: 16, bottom: 24, left: 8 }}>
                <CartesianGrid stroke={INK.grid} />
                <XAxis type="number" dataKey="x" tick={false} axisLine={{ stroke: INK.axis }}
                  label={{ value: 'Direct  ←  contrôle du jeu  →  Dominant', fill: INK.muted, fontSize: 11, position: 'bottom' }} />
                <YAxis type="number" dataKey="y" tick={false} axisLine={{ stroke: INK.axis }} width={20}
                  label={{ value: 'Construction ↔ Pressing', fill: INK.muted, fontSize: 11, angle: -90, position: 'insideLeft' }} />
                <ZAxis range={[70, 70]} />
                <ReferenceLine x={0} stroke={INK.axis} />
                <ReferenceLine y={0} stroke={INK.axis} />
                <Tooltip
                  cursor={false}
                  contentStyle={tooltipProps.contentStyle}
                  content={({ payload }) => {
                    const p = payload?.[0]?.payload as Point | undefined;
                    if (!p) return null;
                    return (
                      <div className="sv-tooltip">
                        <div className="text-ink font-bold">{p.team}</div>
                        <div className="text-ink-3">{styleLabel(p.styleName)}</div>
                      </div>
                    );
                  }}
                />
                <Scatter data={others} fill={OTHER} fillOpacity={0.7} />
                <Scatter data={same} fill={SAME_STYLE} stroke={INK.surface} strokeWidth={2} />
                <Scatter data={selected} fill={SELECTED} stroke={INK.surface} strokeWidth={2}>
                  <LabelList dataKey="team" position="top" fill={INK.primary} fontSize={12} fontWeight={600} />
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </div>

        {profile && (
          <div>
            <h4 className="sv-label mb-1">Profil du style</h4>
            <p className="text-xs text-ink-3 mb-3">Moyenne des équipes de ce style, en écarts-types par rapport à toutes les équipes</p>
            <div className="space-y-2.5">
              {Object.entries(profile).map(([key, z]) => (
                <div key={key} className="text-xs">
                  <div className="flex justify-between mb-1">
                    <span className="text-ink-2">{PROFILE_LABELS[key] ?? key}</span>
                    <span className="text-ink-3 font-mono">{z > 0 ? '+' : ''}{z.toFixed(1)}</span>
                  </div>
                  {/* Barre divergente centrée sur 0, bornée à ±2 écarts-types */}
                  <div className="relative h-1.5 bg-raised rounded-sm">
                    <div className="absolute top-0 bottom-0 left-1/2 w-px bg-ink-4" />
                    <div
                      className="absolute top-0 bottom-0 rounded-sm"
                      style={{
                        background: z >= 0 ? DIVERGING.above : DIVERGING.below,
                        left: z >= 0 ? '50%' : `${50 - (Math.min(2, -z) / 2) * 50}%`,
                        width: `${(Math.min(2, Math.abs(z)) / 2) * 50}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default TeamStyleMap;
