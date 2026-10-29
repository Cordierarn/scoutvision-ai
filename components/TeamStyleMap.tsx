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
import { STYLE_MIN_MATCHES, STYLE_PCA_VARIANCE, STYLE_TREND_MATCHES, styleMapPopulation, styleReliability, teamValue } from '../utils/teamMetrics';

const PCT = new Intl.NumberFormat('fr-FR', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 });
const PCT0 = new Intl.NumberFormat('fr-FR', { style: 'percent', maximumFractionDigits: 0 });
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
  season: string;      // saison réelle de l'équipe ("2025-26" ou "2025")
  label: string;       // étiquette sur la carte (équipe, saison si plusieurs saisons)
  styleName: string;   // pas « style » : recharts transmet les champs du point au SVG
}

const seasonTag = (season: string) => season.replace(/^20(\d{2})-(\d{2})$/, '$1-$2');

/**
 * Une équipe-saison = une observation. Saison chargée seule : la population est la compétition
 * de cette saison. « Toutes les saisons » : chaque saison de la compétition est un point distinct,
 * étiqueté avec sa saison (les autres saisons du club sont repérées).
 */
const TeamStyleMap: React.FC<{ team: TeamStats; teams: TeamStats[]; allSeasons?: boolean }> = ({ team, teams, allSeasons = false }) => {
  const style = team.Style as string | undefined;
  const profile = dataLoader.getCachedIndex()?.models?.styles?.find(s => s.name === style)?.profile;
  const matches = teamValue(team, 'Matches');
  const reliability = styleReliability(matches, style);

  const { selected, club, same, others } = useMemo(() => {
    const points = styleMapPopulation(team, teams, allSeasons).map(({ team: t, kind }) => ({ kind, p: {
      x: t['Style x'] as number, y: t['Style y'] as number, team: t.team, season: t.season,
      label: allSeasons ? `${t.team} ${seasonTag(t.season)}` : t.team, styleName: String(t.Style) } as Point }));
    const of = (k: string) => points.filter(x => x.kind === k).map(x => x.p);
    return { selected: of('selected'), club: of('club'), same: of('same'), others: of('other') };
  }, [teams, team, allSeasons]);

  if (!style) return null;
  const title = reliability === 'insufficient' ? 'Carte des styles · style non établi'
    : reliability === 'trend' ? `Carte des styles · tendance : ${styleLabel(style)}` : `Carte des styles · style observé : ${styleLabel(style)}`;

  return (
    <div className="sv-panel p-4">
      <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-ink mb-1 flex items-center gap-1.5">
        <Compass className="w-3.5 h-3.5 text-ink-3" /> {title}
      </h3>
      {reliability !== 'observed' && (
        <p className="text-xs text-warn mb-1">
          {reliability === 'insufficient'
            ? `${matches ?? 0} match${(matches ?? 0) > 1 ? 's' : ''} seulement : le style n'est pas nommé sous ${STYLE_TREND_MATCHES} matchs (sur les saisons passées, style final retrouvé dans 48 % des cas après 3 matchs). Le point situe l'équipe, sans plus.`
            : `${matches} matchs : tendance seulement. Sur les saisons passées, le style des ${STYLE_TREND_MATCHES} à ${STYLE_MIN_MATCHES - 1} premiers matchs était le style final dans 55 à 64 % des cas.`}
        </p>
      )}
      <p className="text-xs text-ink-3 mb-1">
        Axe horizontal : contrôle du jeu (PC1, {PCT.format(STYLE_PCA_VARIANCE.pc1)} de la variance) ; axe vertical : pressing et verticalité (PC2, {PCT.format(STYLE_PCA_VARIANCE.pc2)}) ; total : {PCT0.format(STYLE_PCA_VARIANCE.pc1 + STYLE_PCA_VARIANCE.pc2)}.
      </p>
      <p className="text-xs text-ink-3 mb-4">
        Six styles issus d'un k-means sur la possession, le territoire, le pressing (PPDA), la hauteur de ligne, le jeu direct et la construction, ajusté sur toutes les équipes-saisons de toutes les compétitions. Un style décrit une saison ; il change pour près d'un club sur deux d'une saison à l'autre.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-2xs text-ink-3 mb-2">
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ background: SELECTED }} />{team.team}{allSeasons ? ` ${seasonTag(team.season)}` : ''}</span>
            {club.length > 0 && <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full border-2" style={{ borderColor: SELECTED }} />Autres saisons du club</span>}
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
                        <div className="text-ink-3">{styleLabel(p.styleName)} · saison {p.season.replace('-', '/')}</div>
                      </div>
                    );
                  }}
                />
                <Scatter data={others} fill={OTHER} fillOpacity={0.7} />
                <Scatter data={same} fill={SAME_STYLE} stroke={INK.surface} strokeWidth={2} />
                {club.length > 0 && (
                  <Scatter data={club} fill={INK.surface} stroke={SELECTED} strokeWidth={2}>
                    <LabelList dataKey="label" position="top" fill={INK.secondary} fontSize={10} />
                  </Scatter>
                )}
                <Scatter data={selected} fill={SELECTED} stroke={INK.surface} strokeWidth={2}>
                  <LabelList dataKey="label" position="top" fill={INK.primary} fontSize={12} fontWeight={600} />
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
