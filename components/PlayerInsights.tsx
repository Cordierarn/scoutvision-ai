/**
 * ScoutVision AI - Impact, valeur et développement d'un joueur
 * - RAPM du pipeline (plus-minus régularisé en xG/90) et sa fiabilité par championnat
 * - talent de finition (buts au-dessus de l'xG pour 100 tirs, shrinké)
 * - place dans le réseau de passes
 * - valeur estimée d'après la performance face à Transfermarkt
 * - courbe d'âge du rôle et projection des percentiles à un an
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Activity, Crosshair, Share2, Coins, TrendingUp, TrendingDown, Minus, Sprout } from 'lucide-react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from 'recharts';
import { PlayerData } from '../types';
import { dataLoader, AgeCurves } from '../services/dataLoader';
import { projectPlayer, roleAgeProfile } from '../utils/development';
import { metricLabel, positionName } from '../utils/labels';
import { Panel, PercentileValue } from './ui';
import { BRAND, INK, axisProps, gridProps, tooltipProps } from '../theme/charts';

const signed = (v: number, digits = 2) => `${v > 0 ? '+' : ''}${v.toFixed(digits)}`;

const formatEuro = (v: number) =>
  v >= 1e6 ? `€${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `€${Math.round(v / 1e3)}K` : `€${v}`;

const Card: React.FC<{ icon: React.ReactNode; title: string; children: React.ReactNode }> = ({ icon, title, children }) => (
  <div className="px-4 py-3 flex flex-col gap-1 min-w-0">
    <div className="sv-label flex items-center gap-1.5">{icon}{title}</div>
    {children}
  </div>
);

const Unavailable: React.FC<{ text: string }> = ({ text }) => (
  <p className="text-xs text-ink-4 leading-relaxed">{text}</p>
);

const reliabilityLabel = (r: number) => (r >= 0.6 ? 'bonne' : r >= 0.4 ? 'moyenne' : 'faible');

/**
 * Panneau « Impact & value »
 */
export const ImpactPanel: React.FC<{ player: PlayerData }> = ({ player }) => {
  const competition = dataLoader.getCompetition(player.Competition);
  const valuation = dataLoader.getCachedIndex()?.models?.valuation;

  const rapm = player['RAPM net'];
  const reliability = competition?.rapmReliability;
  const finishing = player['Finishing skill'];
  const shots = Number(player['Career shots']) || 0;
  const passShare = player['Pass share, %'];
  const betweennessPct = player['Network betweenness pct'];
  const market = player['Market value'];
  const estimate = player['Estimated value'];
  const ratio = typeof market === 'number' && typeof estimate === 'number' && market > 0 ? estimate / market : null;

  return (
    <Panel title="Impact et valeur" icon={Activity} flush className="break-inside-avoid"
      subtitle="Modèles du pipeline : plus-minus régularisé, finition au-delà de l'xG, réseau de passes, valeur estimée par la performance.">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 divide-y sm:divide-y-0 xl:divide-x divide-line">

        <Card icon={<Activity className="w-3.5 h-3.5" />} title="Impact sur le terrain (RAPM)">
          {typeof rapm === 'number' ? (
            <>
              <div className="text-lg font-semibold text-ink num leading-tight">
                {signed(rapm, 3)} <span className="text-2xs text-ink-3 font-normal">différence d'xG / 90</span>
              </div>
              <div className="text-xs text-ink-3">
                Attaque {signed(Number(player['RAPM off']), 3)} · Défense {signed(Number(player['RAPM def']), 3)}
              </div>
              {typeof player['RAPM net pct'] === 'number' && (
                <div className="text-xs text-ink-2 flex items-center gap-1.5"><PercentileValue value={player['RAPM net pct'] as number} className="text-xs" /> en {competition?.name ?? player.Competition}</div>
              )}
              {reliability && (
                <div className="text-2xs text-ink-4 leading-relaxed">
                  Fiabilité dans cette ligue : {reliabilityLabel(reliability.net)} ({reliability.net.toFixed(2)}), défense {reliability.def.toFixed(2)}
                </div>
              )}
            </>
          ) : <Unavailable text="Indisponible pour ce joueur : le RAPM ne couvre que les saisons récentes et les joueurs au temps de jeu suffisant." />}
        </Card>

        <Card icon={<Crosshair className="w-3.5 h-3.5" />} title="Talent de finition">
          {typeof finishing === 'number' && shots > 0 ? (
            <>
              <div className="text-lg font-semibold text-ink num leading-tight">
                {signed(finishing, 1)} <span className="text-2xs text-ink-3 font-normal">buts / 100 tirs vs xG</span>
              </div>
              <div className="text-xs text-ink-2">
                {finishing > 0.5 ? 'Finisseur clinique' : finishing < -0.5 ? 'Finit sous son xG' : 'Conforme à l\'xG'}
              </div>
              <div className="text-2xs text-ink-4 leading-relaxed">
                Carrière : {shots} tirs, {signed(Number(player['Career goals - xG']), 1)} buts vs xG
                {shots < 50 ? ' · small sample, estimate pulled toward average' : ''}
              </div>
            </>
          ) : <Unavailable text="Aucun tir enregistré." />}
        </Card>

        <Card icon={<Share2 className="w-3.5 h-3.5" />} title="Circulation du ballon">
          {typeof passShare === 'number' ? (
            <>
              <div className="text-lg font-semibold text-ink num leading-tight">
                {passShare.toFixed(1)}% <span className="text-2xs text-ink-3 font-normal">des passes de l'équipe</span>
              </div>
              <div className="text-xs text-ink-2">
                {typeof player['Pass share, % pct'] === 'number' && `P${player['Pass share, % pct']} pour le rôle`}
                {typeof betweennessPct === 'number' && ` · rôle de relais P${betweennessPct}`}
              </div>
              <div className="text-2xs text-ink-4 leading-relaxed">
                Réseau de passes jusqu'au premier remplacement, {player['Network matches']} matchs
                {typeof betweennessPct === 'number' && betweennessPct >= 80 ? ' · une plaque tournante de l\'équipe' : ''}
              </div>
            </>
          ) : <Unavailable text="Pas assez de matchs dans le réseau de passes." />}
        </Card>

        <Card icon={<Coins className="w-3.5 h-3.5" />} title="Valeur et performance">
          {ratio !== null ? (
            <>
              <div className="text-lg font-semibold text-ink num leading-tight">
                ×{ratio.toFixed(1)} <span className="text-2xs text-ink-3 font-normal">modèle / marché</span>
              </div>
              <div className="text-xs text-ink-2">
                {ratio >= 1.5 ? 'Sous-coté selon le modèle' : ratio <= 0.67 ? 'Plus cher que sa performance' : 'Valeur cohérente'}
                {' · '}Transfermarkt {formatEuro(market as number)}, modèle {formatEuro(estimate as number)}
              </div>
              {valuation && (
                <div className="text-2xs text-ink-4 leading-relaxed">
                  R² hors échantillon {valuation.r2_cv}, erreur typique ×{valuation.median_error_factor} : une indication, pas un prix
                </div>
              )}
            </>
          ) : <Unavailable text="Saison en cours seulement (instantané Transfermarkt)." />}
        </Card>
      </div>
    </Panel>
  );
};

/**
 * Panneau « Development » : courbe d'âge du rôle et projection à un an
 */
export const DevelopmentPanel: React.FC<{ player: PlayerData; metrics: string[] }> = ({ player, metrics }) => {
  const [curves, setCurves] = useState<AgeCurves | null>(null);
  useEffect(() => {
    dataLoader.loadAgeCurves().then(setCurves).catch(() => setCurves(null));
  }, []);

  const profile = useMemo(() => (curves ? roleAgeProfile(curves, player.Position, metrics) : []), [curves, player, metrics]);
  const projections = useMemo(() => (curves ? projectPlayer(player, curves, metrics) : []), [curves, player, metrics]);
  const age = Number(player.Age);

  if (!curves || profile.length === 0 || !age) return null;

  return (
    <Panel title="Projection de développement" icon={Sprout} className="h-full break-inside-avoid"
      subtitle={`Effet moyen de l'âge en une saison pour un ${positionName(player.Position).toLowerCase()}, métriques clés du rôle (points de percentile, retour vers la moyenne retiré).`}>

      <div className="h-44">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={profile} margin={{ top: 18, right: 12, bottom: 0, left: -18 }}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="age" {...axisProps} />
            <YAxis {...axisProps} axisLine={false} allowDecimals={false} />
            <ReferenceLine y={0} stroke={INK.axis} />
            <ReferenceLine x={Math.round(age)} stroke={INK.muted} strokeDasharray="3 3"
              label={{ value: `${Math.round(age)} ans`, fill: INK.secondary, fontSize: 11, position: 'top' }} />
            <Tooltip
              {...tooltipProps}
              labelFormatter={a => `${a} ans`}
              formatter={(v: number, _n, item) => [`${v > 0 ? '+' : ''}${v} pts (${item.payload.n} joueurs)`, 'Effet de l\'âge']}
            />
            <Line type="monotone" dataKey="effect" stroke={BRAND} strokeWidth={2} dot={{ r: 2.5, fill: BRAND, strokeWidth: 0 }} activeDot={{ r: 4, stroke: INK.surface, strokeWidth: 2 }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {projections.length > 0 && (
        <div className="mt-4">
          <div className="sv-label mb-1.5 flex justify-between"><span>Saison prochaine attendue</span><span>actuel → projeté</span></div>
          <div className="space-y-0.5">
            {projections.slice(0, 8).map(p => {
              const diff = p.projected - p.current;
              const Icon = diff > 1 ? TrendingUp : diff < -1 ? TrendingDown : Minus;
              return (
                <div key={p.metric} className="flex items-center gap-2 h-6 text-xs">
                  <span className="text-ink-2 flex-1 truncate" title={metricLabel(p.metric)}>{metricLabel(p.metric)}</span>
                  <span className="text-ink-3 num w-9 text-right">P{p.current}</span>
                  <Icon className={`w-3.5 h-3.5 ${diff > 1 ? 'text-pos' : diff < -1 ? 'text-neg' : 'text-ink-4'}`} />
                  <PercentileValue value={p.projected} className="w-11 text-xs" />
                </div>
              );
            })}
          </div>
          <p className="text-2xs text-ink-4 mt-2 leading-relaxed">
            Calculé sur {curves.pairs.toLocaleString()} paires de saisons consécutives. Seuls les joueurs restés au-dessus du seuil de minutes sont observés.
          </p>
        </div>
      )}
    </Panel>
  );
};

/**
 * Indicateurs avancés formulés pour le rapport IA, avec leurs limites
 */
export function buildReportInsights(player: PlayerData, curves: AgeCurves | null, metrics: string[]): string[] {
  const lines: string[] = [];
  const competition = dataLoader.getCompetition(player.Competition);

  if (typeof player['RAPM net'] === 'number') {
    const rel = competition?.rapmReliability;
    lines.push(`Regularized plus-minus (RAPM, 2 seasons): net ${signed(player['RAPM net'], 3)} xG/90 `
      + `(attack ${signed(Number(player['RAPM off']), 3)}, defence ${signed(Number(player['RAPM def']), 3)})`
      + (typeof player['RAPM net pct'] === 'number' ? `, P${player['RAPM net pct']} in the league` : '')
      + (rel ? `; league reliability ${reliabilityLabel(rel.net)} (${rel.net.toFixed(2)})` : ''));
  }
  const shots = Number(player['Career shots']) || 0;
  if (typeof player['Finishing skill'] === 'number' && shots > 0) {
    lines.push(`Finishing skill (career, shrunk): ${signed(player['Finishing skill'], 1)} goals per 100 shots above xG on ${shots} shots`
      + (shots < 50 ? ' (small sample)' : ''));
  }
  if (typeof player['Pass share, %'] === 'number') {
    lines.push(`Involved in ${player['Pass share, %'].toFixed(1)}% of the team's passes`
      + (typeof player['Pass share, % pct'] === 'number' ? ` (P${player['Pass share, % pct']} for the role)` : ''));
  }
  if (player['Team style']) {
    lines.push(`Team playing style this season: ${player['Team style']} (the player's numbers are produced in this context)`);
  }
  const market = player['Market value'];
  const estimate = player['Estimated value'];
  if (typeof market === 'number' && typeof estimate === 'number' && market > 0) {
    lines.push(`Transfermarkt value ${formatEuro(market)}; performance-based model estimate ${formatEuro(estimate)} `
      + `(×${(estimate / market).toFixed(1)}; the model has a typical error of ×1.7)`);
  }
  if (player['Contract expires']) {
    lines.push(`Contract until ${player['Contract expires']}`);
  }
  if (curves) {
    const proj = projectPlayer(player, curves, metrics);
    if (proj.length > 0) {
      lines.push('Expected next season (role percentile, regression to the mean and age effect included): '
        + proj.slice(0, 6).map(p => `${p.metric} P${p.current}→P${p.projected}`).join(', '));
    }
  }
  return lines;
}
