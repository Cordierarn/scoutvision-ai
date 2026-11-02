/**
 * ScoutVision AI - Simulateur de saison : logique pure (sélection d'un replay précalculé, libellés,
 * colonnes d'objectifs, comparaison au réel). Aucun calcul statistique : tout vient des artefacts.
 */

import { Objective, Replay, ReplayIndex, ReplayModel, ReplayPoint, ReplaySeasonFile, ReplayTeam } from '../../services/replayData';

export const POINT_ORDER: ReplayPoint[] = ['start', 'q25', 'q50', 'q75'];
export const MODEL_ORDER: ReplayModel[] = ['scoutvision_reproduced', 'elo', 'dixon_coles_decay', 'xg_rolling', 'market_closing'];
export const MODEL_LABELS: Record<ReplayModel, string> = {
  scoutvision_reproduced: 'ScoutVision', elo: 'Elo', dixon_coles_decay: 'Dixon-Coles', xg_rolling: 'Modèle xG', market_closing: 'Référence marché historique',
};

export const ROLLING_KNOWLEDGE = 'Replay à connaissance glissante : chaque rencontre restante utilise la prévision produite avant cette rencontre. '
  + 'Le résultat est plus informé qu\'une projection entièrement figée à la date sélectionnée.';
export const ROLLING_KNOWLEDGE_DETAIL = 'Les prévisions sont produites chaque semaine à partir des seuls matchs déjà joués. Pour un match restant, le replay reprend la prévision de la semaine de ce match, '
  + 'donc avec les résultats intervenus entre la date de départ et ce match. Un vrai état du modèle figé à la date de départ serait moins informé. '
  + 'Aucune prévision n\'est recalculée dans le navigateur.';
export const APPROXIMATE_TIEBREAK = 'Certaines égalités utilisent un départage simplifié.';

/** Compétitions du simulateur : celles de l'index (toutes supportées par les règles), triées par nom */
export function competitions(index: ReplayIndex): { key: string; name: string }[] {
  return index.competitions.map(c => ({ key: c.key, name: c.name })).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

export function seasonsOf(index: ReplayIndex, competition: string): string[] {
  return (index.competitions.find(c => c.key === competition)?.seasons ?? []).map(s => s.season).sort((a, b) => b.localeCompare(a));
}

/** Replays simulés (mode strict) uniquement ; les autres ne sont jamais présentés comme résultats */
export function simulated(file: ReplaySeasonFile): Extract<Replay, { status: 'simulated' }>[] {
  return file.replays.filter((r): r is Extract<Replay, { status: 'simulated' }> => r.status === 'simulated');
}

export function findReplay(file: ReplaySeasonFile, point: ReplayPoint, model: ReplayModel): Replay | undefined {
  return file.replays.find(r => r.point === point && r.model === model);
}

/** Options d'un contrôle : disponibilité et raison quand l'option est indisponible */
export interface Option<T extends string> { id: T; label: string; available: boolean; reason?: string }

export function pointOptions(file: ReplaySeasonFile, model: ReplayModel, labels: Record<string, string>): Option<ReplayPoint>[] {
  return POINT_ORDER.filter(p => file.replays.some(r => r.point === p)).map(p => {
    const r = findReplay(file, p, model);
    const date = r ? formatDate(r.date) : '';
    if (r && r.status === 'simulated') return { id: p, label: `${labels[p] ?? p} · ${date}`, available: true };
    return { id: p, label: `${labels[p] ?? p} · ${date}`, available: false, reason: r && r.status === 'unavailable' ? `Indisponible : ${r.reason}.` : 'Indisponible : aucun replay.' };
  });
}

export function modelOptions(file: ReplaySeasonFile, point: ReplayPoint, index: ReplayIndex): Option<ReplayModel>[] {
  const known = new Map(index.models.map(m => [m.id, m.label]));
  return MODEL_ORDER.filter(m => known.has(m) && file.replays.some(r => r.model === m)).map(m => {
    const r = findReplay(file, point, m);
    if (r && r.status === 'simulated') return { id: m, label: known.get(m) ?? MODEL_LABELS[m], available: true };
    return { id: m, label: known.get(m) ?? MODEL_LABELS[m], available: false, reason: r && r.status === 'unavailable' ? `Indisponible : ${r.reason}.` : 'Indisponible : aucun replay.' };
  });
}

/** Choix par défaut : premier point disponible pour le modèle demandé (ou le premier modèle disponible) */
export function defaultSelection(file: ReplaySeasonFile, preferredModel: ReplayModel, preferredPoint: ReplayPoint = 'q50'): { point: ReplayPoint; model: ReplayModel } | null {
  const sims = simulated(file);
  if (sims.length === 0) return null;
  const forModel = sims.filter(r => r.model === preferredModel);
  const pool = forModel.length ? forModel : sims.filter(r => r.model === sims[0].model);
  const exact = pool.find(r => r.point === preferredPoint) ?? pool.sort((a, b) => POINT_ORDER.indexOf(a.point) - POINT_ORDER.indexOf(b.point))[0];
  return { point: exact.point, model: exact.model };
}

/** Colonnes d'objectifs : seulement ceux définis par les règles de la compétition, dans un ordre lisible */
export function objectiveColumns(objectives: Record<string, Objective>): { key: string; label: string; positions: [number, number] }[] {
  const order = ['title', 'continental', 'promotion', 'promotion_playoff', 'relegation_playoff', 'relegation'];
  return Object.entries(objectives)
    .sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
    .map(([key, o]) => ({ key, label: shortObjective(key, o), positions: o.positions }));
}

function shortObjective(key: string, o: Objective): string {
  if (key === 'title') return 'Titre';
  if (key === 'continental') return `Top ${o.positions[1]}`;
  if (key === 'promotion') return 'Montée';
  if (key === 'promotion_playoff') return 'Barrage montée';
  if (key === 'relegation') return 'Relégation';
  if (key === 'relegation_playoff') return 'Barrage maintien';
  return o.label;
}

/** Comparaison au réel pour une équipe : écarts rang et points (positif = le réel est plus bas / meilleur selon le signe donné) */
export function comparison(t: ReplayTeam): { rankGap: number | null; pointsGap: number | null } {
  return {
    rankGap: t.actual.rank === null ? null : t.rank.mean - t.actual.rank,
    pointsGap: t.actual.points === null ? null : t.points.mean - t.actual.points,
  };
}

/** Équipe favorite au titre et champion réel */
export function headline(teams: ReplayTeam[]): { favourite: ReplayTeam | null; pTitle: number | null; champion: ReplayTeam | null } {
  if (!teams.length) return { favourite: null, pTitle: null, champion: null };
  const favourite = teams.reduce((best, t) => ((t.objectives.title ?? 0) > (best.objectives.title ?? 0) ? t : best), teams[0]);
  const champion = teams.find(t => t.actual.rank === 1) ?? null;
  return { favourite, pTitle: favourite.objectives.title ?? null, champion };
}

/** Bandeau de départage approximatif : règle non exacte, ou part non négligeable de simulations en repli */
export function needsApproximateBanner(exact: boolean, approximateShare: number): boolean {
  return !exact || approximateShare >= 0.01;
}

/** Somme d'une distribution de rang (contrôle d'intégrité) */
export function distributionSum(dist: number[]): number {
  return dist.reduce((s, v) => s + v, 0);
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

export const pct = (v: number, digits = 0): string => `${(100 * v).toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits })} %`;
export const num = (v: number, digits = 1): string => v.toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
export const signed = (v: number, digits = 1): string => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v).toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
