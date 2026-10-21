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

const signed = (v: number, digits = 2) => `${v > 0 ? '+' : ''}${v.toFixed(digits)}`;

const formatEuro = (v: number) =>
  v >= 1e6 ? `€${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `€${Math.round(v / 1e3)}K` : `€${v}`;

const Card: React.FC<{ icon: React.ReactNode; title: string; children: React.ReactNode }> = ({ icon, title, children }) => (
  <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4 flex flex-col gap-2 min-w-0">
    <div className="text-xs text-slate-500 uppercase font-semibold flex items-center gap-1.5">{icon}{title}</div>
    {children}
  </div>
);

const Unavailable: React.FC<{ text: string }> = ({ text }) => (
  <p className="text-sm text-slate-500">{text}</p>
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
    <div className="bg-slate-950 border border-slate-800 rounded-3xl p-6 shadow-xl break-inside-avoid">
      <h3 className="text-lg font-bold text-white flex items-center gap-2 mb-4">
        <Activity className="w-5 h-5 text-emerald-400" /> Impact et valeur
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">

        <Card icon={<Activity className="w-3.5 h-3.5" />} title="Impact sur le terrain (RAPM)">
          {typeof rapm === 'number' ? (
            <>
              <div className="text-2xl font-bold text-white font-mono">
                {signed(rapm, 3)} <span className="text-xs text-slate-400 font-sans font-normal">différence d'xG / 90</span>
              </div>
              <div className="text-xs text-slate-400">
                Attaque {signed(Number(player['RAPM off']), 3)} · Défense {signed(Number(player['RAPM def']), 3)}
              </div>
              {typeof player['RAPM net pct'] === 'number' && (
                <div className="text-xs text-slate-300">P{player['RAPM net pct']} en {competition?.name ?? player.Competition}</div>
              )}
              {reliability && (
                <div className="text-[11px] text-slate-500">
                  Fiabilité dans cette ligue : {reliabilityLabel(reliability.net)} ({reliability.net.toFixed(2)}), défense {reliability.def.toFixed(2)}
                </div>
              )}
            </>
          ) : <Unavailable text="Indisponible : le RAPM couvre 2025-27 dans les championnats européens." />}
        </Card>

        <Card icon={<Crosshair className="w-3.5 h-3.5" />} title="Talent de finition">
          {typeof finishing === 'number' && shots > 0 ? (
            <>
              <div className="text-2xl font-bold text-white font-mono">
                {signed(finishing, 1)} <span className="text-xs text-slate-400 font-sans font-normal">buts / 100 tirs vs xG</span>
              </div>
              <div className="text-xs text-slate-300">
                {finishing > 0.5 ? 'Finisseur clinique' : finishing < -0.5 ? 'Finit sous son xG' : 'Conforme à l\'xG'}
              </div>
              <div className="text-[11px] text-slate-500">
                Carrière : {shots} tirs, {signed(Number(player['Career goals - xG']), 1)} buts vs xG
                {shots < 50 ? ' · small sample, estimate pulled toward average' : ''}
              </div>
            </>
          ) : <Unavailable text="Aucun tir enregistré." />}
        </Card>

        <Card icon={<Share2 className="w-3.5 h-3.5" />} title="Circulation du ballon">
          {typeof passShare === 'number' ? (
            <>
              <div className="text-2xl font-bold text-white font-mono">
                {passShare.toFixed(1)}% <span className="text-xs text-slate-400 font-sans font-normal">des passes de l'équipe</span>
              </div>
              <div className="text-xs text-slate-300">
                {typeof player['Pass share, % pct'] === 'number' && `P${player['Pass share, % pct']} pour le rôle`}
                {typeof betweennessPct === 'number' && ` · rôle de relais P${betweennessPct}`}
              </div>
              <div className="text-[11px] text-slate-500">
                Réseau de passes jusqu'au premier remplacement, {player['Network matches']} matchs
                {typeof betweennessPct === 'number' && betweennessPct >= 80 ? ' · une plaque tournante de l\'équipe' : ''}
              </div>
            </>
          ) : <Unavailable text="Pas assez de matchs dans le réseau de passes." />}
        </Card>

        <Card icon={<Coins className="w-3.5 h-3.5" />} title="Valeur et performance">
          {ratio !== null ? (
            <>
              <div className="text-2xl font-bold text-white font-mono">
                ×{ratio.toFixed(1)} <span className="text-xs text-slate-400 font-sans font-normal">modèle / marché</span>
              </div>
              <div className="text-xs text-slate-300">
                {ratio >= 1.5 ? 'Sous-coté selon le modèle' : ratio <= 0.67 ? 'Plus cher que sa performance' : 'Valeur cohérente'}
                {' · '}Transfermarkt {formatEuro(market as number)}, modèle {formatEuro(estimate as number)}
              </div>
              {valuation && (
                <div className="text-[11px] text-slate-500">
                  R² hors échantillon {valuation.r2_cv}, erreur typique ×{valuation.median_error_factor} : une indication, pas un prix
                </div>
              )}
            </>
          ) : <Unavailable text="Saison en cours seulement (instantané Transfermarkt)." />}
        </Card>
      </div>
    </div>
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
    <div className="bg-slate-950 border border-slate-800 rounded-3xl p-6 shadow-xl break-inside-avoid">
      <h3 className="text-lg font-bold text-white flex items-center gap-2 mb-1">
        <Sprout className="w-5 h-5 text-emerald-400" /> Développement
      </h3>
      <p className="text-xs text-slate-500 mb-4">
        Évolution moyenne en une saison pour un {positionName(player.Position).toLowerCase()} selon l'âge, sur les métriques clés du rôle (points de percentile, retour vers la moyenne retiré)
      </p>

      <div className="h-44">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={profile} margin={{ top: 20, right: 12, bottom: 0, left: -18 }}>
            <CartesianGrid stroke="#1e293b" vertical={false} />
            <XAxis dataKey="age" tick={{ fill: '#94a3b8', fontSize: 11 }} tickLine={false} axisLine={{ stroke: '#334155' }} />
            <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} tickLine={false} axisLine={false} />
            <ReferenceLine y={0} stroke="#475569" />
            <ReferenceLine x={Math.round(age)} stroke="#64748b" strokeDasharray="3 3"
              label={{ value: `${Math.round(age)} y`, fill: '#cbd5e1', fontSize: 11, position: 'top' }} />
            <Tooltip
              contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }}
              labelStyle={{ color: '#94a3b8' }}
              itemStyle={{ color: '#e2e8f0' }}
              labelFormatter={a => `${a} ans`}
              formatter={(v: number, _n, item) => [`${v > 0 ? '+' : ''}${v} pts (${item.payload.n} players)`, 'Effet de l\'âge']}
            />
            <Line type="monotone" dataKey="effect" stroke="#3987e5" strokeWidth={2} dot={{ r: 3, fill: '#3987e5' }} activeDot={{ r: 5 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {projections.length > 0 && (
        <div className="mt-4">
          <div className="text-[10px] text-slate-500 uppercase font-semibold mb-2">Saison prochaine attendue (percentile du rôle)</div>
          <div className="space-y-1.5">
            {projections.slice(0, 8).map(p => {
              const diff = p.projected - p.current;
              const Icon = diff > 1 ? TrendingUp : diff < -1 ? TrendingDown : Minus;
              return (
                <div key={p.metric} className="flex items-center gap-2 text-xs">
                  <span className="text-slate-400 flex-1 truncate" title={metricLabel(p.metric)}>{metricLabel(p.metric)}</span>
                  <span className="text-slate-300 font-mono w-9 text-right">P{p.current}</span>
                  <Icon className={`w-3.5 h-3.5 ${diff > 1 ? 'text-emerald-400' : diff < -1 ? 'text-rose-400' : 'text-slate-500'}`} />
                  <span className="text-white font-mono font-bold w-9">P{p.projected}</span>
                </div>
              );
            })}
          </div>
          <p className="text-[11px] text-slate-500 mt-3">
            Calculé sur {curves.pairs.toLocaleString()} paires de saisons consécutives. Seuls les joueurs restés au-dessus du seuil de minutes sont observés.
          </p>
        </div>
      )}
    </div>
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
