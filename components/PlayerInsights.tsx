/**
 * ScoutVision AI - Impact, valeur et développement d'un joueur
 * - RAPM du pipeline (plus-minus régularisé en xG/90) et sa fiabilité par championnat
 * - talent de finition (buts au-dessus de l'xG pour 100 tirs, shrinké)
 * - place dans le réseau de passes
 * - valeur estimée d'après la performance face à Transfermarkt
 * - courbe d'âge du rôle et projection des percentiles à un an
 */

import React, { useMemo } from 'react';
import { Activity, Crosshair, Share2, Coins, TrendingUp, TrendingDown, Minus, Sprout } from 'lucide-react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from 'recharts';
import { PlayerData } from '../types';
import { dataLoader, AgeCurves } from '../services/dataLoader';
import { useAsyncData } from '../hooks/useAsyncData';
import { projectPlayer, roleAgeProfile } from '../utils/development';
import { metricLabel, positionName } from '../utils/labels';
import { MIN_NETWORK_MATCHES, MIN_RAPM_MINUTES, SMALL_SHOT_SAMPLE } from '../utils/sampleContext';
import { Panel, PercentileValue, InfoTip, LoadError, SkeletonBlock } from './ui';
import { BRAND, INK, axisProps, gridProps, tooltipProps } from '../theme/charts';

const signed = (v: number, digits = 2) => `${v > 0 ? '+' : ''}${v.toFixed(digits)}`;

// Affichage français (virgule décimale) ; le texte du rapport IA garde le format anglais
const fr = (v: number, digits: number, withSign = false) =>
  `${withSign && v > 0 ? '+' : ''}${v.toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;

const formatEuro = (v: number) =>
  v >= 1e6 ? `€${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `€${Math.round(v / 1e3)}K` : `€${v}`;

/**
 * Carte d'indicateur, toujours lue dans le même ordre :
 * 1. valeur principale  2. interprétation ou percentile  3. contexte  4. fiabilité ou limite
 */
const Card: React.FC<{ icon: React.ReactNode; title: string; help?: string; children: React.ReactNode }> = ({ icon, title, help, children }) => (
  <div className="px-4 py-3 flex flex-col gap-1 min-w-0">
    <div className="sv-label flex items-center gap-1.5">{icon}{title}{help && <InfoTip text={help} />}</div>
    {children}
  </div>
);

const Primary: React.FC<{ value: string; unit: string }> = ({ value, unit }) => (
  <div className="text-lg font-semibold text-ink num leading-tight">
    {value} <span className="text-2xs text-ink-3 font-normal">{unit}</span>
  </div>
);

const Reading: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="text-xs text-ink-2 flex flex-wrap items-center gap-x-1.5">{children}</div>
);

const Context: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="text-2xs text-ink-3 leading-relaxed">{children}</div>
);

/** Fiabilité ou limite : toujours visible, en alerte quand elle est faible */
const Limit: React.FC<{ weak?: boolean; children: React.ReactNode }> = ({ weak = false, children }) => (
  <div className={`mt-0.5 pt-1.5 border-t border-line/70 text-2xs leading-relaxed ${weak ? 'text-warn' : 'text-ink-4'}`}>{children}</div>
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
  const rapmPct = player['RAPM net pct'];
  const rapmMinutes = player['RAPM minutes'];
  const reliability = competition?.rapmReliability;
  const finishing = player['Finishing skill'];
  const shots = Number(player['Career shots']) || 0;
  const passShare = player['Pass share, %'];
  const passSharePct = player['Pass share, % pct'];
  const betweennessPct = player['Network betweenness pct'];
  const market = player['Market value'];
  const estimate = player['Estimated value'];
  const ratio = typeof market === 'number' && typeof estimate === 'number' && market > 0 ? estimate / market : null;

  return (
    <Panel title="Impact et valeur" icon={Activity} flush className="break-inside-avoid"
      subtitle="Modèles du pipeline : plus-minus régularisé, finition au-delà de l'xG, réseau de passes, valeur estimée par la performance.">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 divide-y sm:divide-y-0 xl:divide-x divide-line">

        <Card icon={<Activity className="w-3.5 h-3.5" />} title="Impact sur le terrain (RAPM)"
          help={`Plus-minus régularisé (pipeline) : différence d'xG par 90 minutes quand le joueur est sur le terrain, attaque et défense séparées, par championnat, sur une fenêtre de deux saisons. Percentile calculé dans le même championnat entre joueurs d'au moins ${MIN_RAPM_MINUTES} minutes.`}>
          {typeof rapm === 'number' ? (
            <>
              <Primary value={fr(rapm, 3, true)} unit="différence d'xG / 90" />
              <Reading>
                {typeof rapmPct === 'number'
                  ? <><PercentileValue value={rapmPct as number} className="text-xs" /> en {competition?.name ?? player.Competition}</>
                  : <span className="text-ink-3">Pas de percentile : moins de {MIN_RAPM_MINUTES} minutes sur la fenêtre</span>}
              </Reading>
              <Context>
                Attaque {fr(Number(player['RAPM off']), 3, true)} · Défense {fr(Number(player['RAPM def']), 3, true)}
                {typeof rapmMinutes === 'number' && ` · ${rapmMinutes.toLocaleString('fr-FR')} min sur deux saisons`}
              </Context>
              {reliability && (
                <Limit weak={reliability.net < 0.4}>
                  Fiabilité dans cette ligue : nette {reliabilityLabel(reliability.net)} ({fr(reliability.net, 2)}),
                  défense {reliabilityLabel(reliability.def)} ({fr(reliability.def, 2)})
                  {' '}<InfoTip text="Corrélation du RAPM entre les deux moitiés de saison dans ce championnat (0-1) : bonne ≥ 0,6, moyenne ≥ 0,4, faible en dessous." position="top" align="end" />
                </Limit>
              )}
            </>
          ) : <Unavailable text="Indisponible pour ce joueur : le RAPM ne couvre que les saisons récentes et les joueurs au temps de jeu suffisant." />}
        </Card>

        <Card icon={<Crosshair className="w-3.5 h-3.5" />} title="Talent de finition"
          help="Effet joueur estimé par le pipeline sur toute la carrière : buts marqués au-delà de l'xG pour 100 tirs, ramené vers la moyenne quand les tirs sont peu nombreux (plus stable que « buts − xG »).">
          {typeof finishing === 'number' && shots > 0 ? (
            <>
              <Primary value={fr(finishing, 1, true)} unit="buts / 100 tirs vs xG" />
              <Reading>{finishing > 0.5 ? 'Finisseur clinique' : finishing < -0.5 ? 'Finit sous son xG' : 'Conforme à l\'xG'}</Reading>
              <Context>Carrière : {shots.toLocaleString('fr-FR')} tirs, {fr(Number(player['Career goals - xG']), 1, true)} buts vs xG</Context>
              {shots < SMALL_SHOT_SAMPLE && (
                <Limit weak>Petit échantillon (moins de {SMALL_SHOT_SAMPLE} tirs) : estimation tirée vers la moyenne</Limit>
              )}
            </>
          ) : <Unavailable text="Aucun tir enregistré." />}
        </Card>

        <Card icon={<Share2 className="w-3.5 h-3.5" />} title="Circulation du ballon"
          help={`Réseau de passes de l'équipe, jusqu'au premier remplacement de chaque match : part des passes de l'équipe impliquant le joueur et rôle de relais (centralité d'intermédiarité). Percentiles par rôle et par niveau sur la saison ; joueur noté à partir de ${MIN_NETWORK_MATCHES} matchs dans le réseau.`}>
          {typeof passShare === 'number' ? (
            <>
              <Primary value={`${fr(passShare, 1)} %`} unit="des passes de l'équipe" />
              <Reading>
                {typeof passSharePct === 'number' && <><PercentileValue value={passSharePct as number} className="text-xs" /> pour le rôle</>}
                {typeof betweennessPct === 'number' && <><span className="text-ink-4">·</span> relais <PercentileValue value={betweennessPct as number} className="text-xs" /></>}
              </Reading>
              <Context>
                {player['Network matches']} matchs dans le réseau de passes
                {typeof betweennessPct === 'number' && betweennessPct >= 80 ? ' · une plaque tournante de l\'équipe' : ''}
              </Context>
            </>
          ) : <Unavailable text={`Pas assez de matchs dans le réseau de passes (${MIN_NETWORK_MATCHES} au minimum).`} />}
        </Card>

        <Card icon={<Coins className="w-3.5 h-3.5" />} title="Valeur et performance"
          help="Valeur estimée par le modèle statistique du pipeline (régression ridge sur le log de la valeur Transfermarkt : âge, minutes, rôle, compétition, note, percentiles du rôle, RAPM ; prédiction hors échantillon), rapportée à la valeur Transfermarkt actuelle. Un écart est un élément à examiner, pas un verdict sur le prix ou le joueur.">
          {ratio !== null ? (
            <>
              <Primary value={`${Math.round(ratio * 100)} %`} unit="estimation / valeur de marché" />
              <Reading>{ratio >= 1.5 ? 'Estimation statistique supérieure à la valeur marché' : ratio <= 0.67 ? 'Valeur marché supérieure à l\'estimation statistique' : 'Estimation statistique proche de la valeur marché'}</Reading>
              <Context>Valeur marché (Transfermarkt) {formatEuro(market as number)} · estimation {formatEuro(estimate as number)}</Context>
              {valuation && (
                <Limit>
                  R² hors échantillon {fr(valuation.r2_cv, 2)}, erreur typique ×{fr(valuation.median_error_factor, 2)} : une estimation, pas un prix
                </Limit>
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
  // Courbes d'âge chargées une fois (cache du dataLoader) ; échec : erreur et « Réessayer »
  const request = useAsyncData<AgeCurves>(() => dataLoader.loadAgeCurves(), []);
  const curves = request.data ?? null;

  const profile = useMemo(() => (curves ? roleAgeProfile(curves, player.Position, metrics) : []), [curves, player, metrics]);
  const projections = useMemo(() => (curves ? projectPlayer(player, curves, metrics) : []), [curves, player, metrics]);
  const age = Number(player.Age);

  const help = 'Projection = percentile actuel + β × (percentile actuel − 50) + effet de l\'âge du rôle.\n'
    + 'β (négatif) mesure le retour vers la moyenne : un percentile extrême tend à se rapprocher de 50 la saison suivante. '
    + 'L\'effet de l\'âge vient des courbes d\'âge du rôle'
    + (curves ? `, estimées sur ${curves.pairs.toLocaleString('fr-FR')} paires de saisons consécutives.` : '.');

  return (
    <Panel title={<>Projection de développement <InfoTip text={help} /></>} icon={Sprout} className="h-full break-inside-avoid"
      subtitle={`Effet moyen de l'âge en une saison pour un ${positionName(player.Position).toLowerCase()}, métriques clés du rôle (points de percentile, retour vers la moyenne retiré).`}>

      {request.status === 'loading' && (
        <div role="status" aria-label="Chargement des courbes d'âge">
          <SkeletonBlock className="h-44" />
          <div className="mt-4 space-y-1.5">{Array.from({ length: 6 }, (_, i) => <SkeletonBlock key={i} className="h-4" />)}</div>
        </div>
      )}

      {request.status === 'error' && (
        <LoadError message="Les courbes d'âge n'ont pas pu être chargées." onRetry={request.retry} />
      )}

      {request.status === 'success' && (profile.length === 0 || !age) && (
        <p className="text-xs text-ink-3 py-2">
          Aucune donnée disponible : {!age ? 'âge du joueur inconnu.' : 'pas de courbe d\'âge pour ce rôle.'}
        </p>
      )}

      {request.status === 'success' && curves && profile.length > 0 && age > 0 && (
        <>
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
                      <Icon className={`w-3.5 h-3.5 ${diff > 1 ? 'text-accent' : diff < -1 ? 'text-warn' : 'text-ink-4'}`} aria-label={diff > 1 ? 'hausse projetée' : diff < -1 ? 'baisse projetée' : 'variation faible'} />
                      <PercentileValue value={p.projected} className="w-11 text-xs" />
                    </div>
                  );
                })}
              </div>
              <p className="text-2xs text-ink-4 mt-2 leading-relaxed">
                Estimation statistique (retour vers la moyenne et effet de l'âge), pas un verdict sur le joueur : un percentile très élevé tend mécaniquement à baisser.
                Calculé sur {curves.pairs.toLocaleString('fr-FR')} paires de saisons consécutives ; seuls les joueurs restés au-dessus du seuil de minutes sont observés.
              </p>
            </div>
          )}
        </>
      )}
    </Panel>
  );
};

/**
 * Indicateurs avancés formulés pour le rapport IA, avec leurs limites
 * (valeur Transfermarkt, estimation ScoutVision et contrat sont envoyés à part, sans ambiguïté)
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
  // Valeur Transfermarkt, estimation ScoutVision et contrat : champs structurés construits par le serveur
  if (curves) {
    const proj = projectPlayer(player, curves, metrics);
    if (proj.length > 0) {
      lines.push('ScoutVision statistical projection for next season (age curves; role percentile, regression to the mean and age effect included; not a forecast of level): '
        + proj.slice(0, 6).map(p => `${p.metric} P${p.current}→P${p.projected}`).join(', '));
    }
  }
  return lines;
}
