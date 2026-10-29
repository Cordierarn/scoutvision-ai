/**
 * ScoutVision - snapshot d'un dossier de scouting et lectures dérivées (fonctions pures)
 *
 * - buildSnapshot : les faits (buildReportFacts, les mêmes que ceux transmis à Gemini), les rôles,
 *   les indicateurs structurés et la projection, calculés à partir de la ligne joueur-saison ;
 * - compareSnapshot : les données actuelles ont-elles changé depuis le snapshot ? (lecture neutre) ;
 * - strengthsAndLimits, roleMetrics, summarySections : lectures du snapshot et d'une synthèse.
 * Les percentiles viennent du pipeline, rien n'est recalculé ici.
 */

import { PlayerData, ShotStats, getPlayerSeason, getPlayerSeasonId, getPlayerSeasonTag } from '../types';
import { AgeCurves, CompetitionInfo, DataIndex } from '../services/dataLoader';
import { ReportFacts, buildReportFacts } from '../server/reportFacts';
import { ReportDataSnapshot, ReportPlayerRef, SnapshotIndicators, SnapshotProjection } from '../types/scoutReport';
import { DEFAULT_ROLE_PRESETS, presetWeights, rankPresets } from './rolePresets';
import { projectPlayer } from './development';
import { metricLabel } from './labels';

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

// ============================================
// RÉFÉRENCE JOUEUR
// ============================================

export function playerRef(player: PlayerData, competition?: CompetitionInfo): ReportPlayerRef {
  const out: ReportPlayerRef = {
    playerSeasonId: getPlayerSeasonId(player),
    name: String(player.Player || 'Inconnu'),
    season: getPlayerSeason(player),
    seasonLabel: getPlayerSeasonTag(player),
    team: String(player.Team || '—'),
    competition: String(player.Competition || ''),
  };
  if (player['Player ID']) out.playerId = String(player['Player ID']);
  if (player['Team ID']) out.teamId = String(player['Team ID']);
  if (competition?.name) out.competitionName = competition.name;
  if (player.Position) out.position = String(player.Position);
  if (num(player.Age) !== undefined) out.age = Math.floor(num(player.Age)!);
  if (num(player['Minutes played']) !== undefined) out.minutes = Math.round(num(player['Minutes played'])!);
  if (typeof player.Image === 'string' && player.Image) out.image = player.Image;
  return out;
}

// ============================================
// SNAPSHOT
// ============================================

export function indicatorsFromRow(player: PlayerData, competition?: CompetitionInfo): SnapshotIndicators {
  const out: SnapshotIndicators = {};
  const net = num(player['RAPM net']);
  if (net !== undefined) {
    out.rapm = { net };
    const off = num(player['RAPM off']), def = num(player['RAPM def']), pct = num(player['RAPM net pct']), minutes = num(player['RAPM minutes']);
    if (off !== undefined) out.rapm.off = off;
    if (def !== undefined) out.rapm.def = def;
    if (pct !== undefined) out.rapm.pct = pct;
    if (minutes !== undefined) out.rapm.minutes = minutes;
    if (competition?.rapmReliability) out.rapm.reliability = { net: competition.rapmReliability.net, def: competition.rapmReliability.def };
  }
  const skill = num(player['Finishing skill']), shots = num(player['Career shots']);
  if (skill !== undefined && shots !== undefined && shots > 0) out.finishing = { skill, shots };
  const share = num(player['Pass share, %']);
  if (share !== undefined) {
    out.passShare = { value: share };
    const pct = num(player['Pass share, % pct']), matches = num(player['Network matches']);
    if (pct !== undefined) out.passShare.pct = pct;
    if (matches !== undefined) out.passShare.matches = matches;
  }
  const market = num(player['Market value']), estimate = num(player['Estimated value']);
  if ((market !== undefined && market > 0) || (estimate !== undefined && estimate > 0)) {
    out.valuation = { ...(market && market > 0 ? { market } : {}), ...(estimate && estimate > 0 ? { estimate } : {}) };
  }
  return out;
}

export function projectionFromRow(player: PlayerData, curves: AgeCurves | null, metrics: string[]): SnapshotProjection[] {
  if (!curves) return [];
  return projectPlayer(player, curves, metrics).slice(0, 8).map(p => ({ metric: p.metric, label: metricLabel(p.metric), current: p.current, projected: p.projected }));
}

export interface SnapshotInput {
  curves?: AgeCurves | null;
  developmentMetrics?: string[];
  competition?: CompetitionInfo;
  dataIndex?: DataIndex | null;
  seasonInProgress?: boolean;
  shotStats?: ShotStats;
  insights?: string[];
  facts?: ReportFacts;            // faits renvoyés par le serveur (prioritaires : ce sont ceux lus par le modèle)
}

/**
 * Snapshot d'une ligne joueur-saison : faits du rapport, rôles officiels, indicateurs, projection
 */
export function buildSnapshot(player: PlayerData, input: SnapshotInput = {}): ReportDataSnapshot {
  const roles = rankPresets(player).map(r => ({ role: r.name, index: r.index }));
  const facts = input.facts ?? buildReportFacts(player as never, {
    bestRoles: roles.map(r => ({ role: r.role, normalizedScore: r.index })),
    shotStats: input.shotStats ? { total: input.shotStats.total, goals: input.shotStats.goals, xG: input.shotStats.xG, conversion: input.shotStats.conversion } : undefined,
    insights: input.insights,
    seasonInProgress: input.seasonInProgress,
  });
  const out: ReportDataSnapshot = {
    facts,
    bestRoles: roles,
    indicators: indicatorsFromRow(player, input.competition),
    projection: projectionFromRow(player, input.curves ?? null, input.developmentMetrics ?? []),
  };
  if (input.seasonInProgress !== undefined) out.seasonInProgress = input.seasonInProgress;
  if (input.dataIndex?.generatedAt) out.dataUpdatedAt = input.dataIndex.generatedAt;
  return out;
}

// ============================================
// FRAÎCHEUR
// ============================================

export interface SnapshotComparison {
  changed: boolean;
  reasons: string[];             // lecture neutre : ce qui diffère entre le snapshot et les données actuelles
}

/**
 * Les données actuelles diffèrent-elles du snapshot ? Compare l'échantillon, les percentiles des
 * métriques communes, les valeurs et le contrat, et la date des données si elle est connue.
 */
export function compareSnapshot(snapshot: ReportDataSnapshot, live: ReportFacts, liveDataUpdatedAt?: string): SnapshotComparison {
  const reasons: string[] = [];
  const a = snapshot.facts;
  if (snapshot.dataUpdatedAt && liveDataUpdatedAt && liveDataUpdatedAt > snapshot.dataUpdatedAt) {
    reasons.push(`données publiées le ${liveDataUpdatedAt.slice(0, 10)} (rapport : ${snapshot.dataUpdatedAt.slice(0, 10)})`);
  }
  if (a.sample.minutes !== live.sample.minutes || a.sample.matches !== live.sample.matches) {
    reasons.push(`échantillon ${a.sample.matches ?? '–'} matchs / ${a.sample.minutes ?? '–'} min → ${live.sample.matches ?? '–'} matchs / ${live.sample.minutes ?? '–'} min`);
  }
  const before = new Map(a.metrics.map(m => [m.metric, m.percentile]));
  let moved = 0;
  let maxDelta = 0;
  live.metrics.forEach(m => {
    const prev = before.get(m.metric);
    if (prev !== undefined && prev !== m.percentile) { moved++; maxDelta = Math.max(maxDelta, Math.abs(prev - m.percentile)); }
  });
  if (moved > 0) reasons.push(`${moved} percentile${moved > 1 ? 's' : ''} sur ${before.size} ont changé (écart maximal ${maxDelta} points)`);
  const added = live.metrics.filter(m => !before.has(m.metric)).length;
  if (added > 0) reasons.push(`${added} métrique${added > 1 ? 's' : ''} nouvelle${added > 1 ? 's' : ''}`);
  if (a.values.marketValueTransfermarkt !== live.values.marketValueTransfermarkt) reasons.push('valeur de marché Transfermarkt différente');
  if (a.values.estimatedValueScoutVision !== live.values.estimatedValueScoutVision) reasons.push('estimation statistique différente');
  if (a.contractUntil !== live.contractUntil) reasons.push('fin de contrat différente');
  return { changed: reasons.length > 0, reasons };
}

// ============================================
// LECTURES DU SNAPSHOT
// ============================================

export type FactMetric = ReportFacts['metrics'][number];

/** Percentile dans le sens « plus c'est haut, mieux c'est » */
export const orientedPercentile = (m: FactMetric) => (m.lessIsPreferable ? 100 - m.percentile : m.percentile);

export const STRENGTH_MIN = 75;
export const LIMIT_MAX = 25;

/** Forces (≥ 75 dans le bon sens) et limites statistiques (≤ 25), 5 au plus chacune */
export function strengthsAndLimits(facts: ReportFacts, max = 5): { strengths: FactMetric[]; limits: FactMetric[] } {
  const scored = facts.metrics.map(m => ({ m, o: orientedPercentile(m) }));
  return {
    strengths: scored.filter(x => x.o >= STRENGTH_MIN).sort((p, q) => q.o - p.o).slice(0, max).map(x => x.m),
    limits: scored.filter(x => x.o <= LIMIT_MAX).sort((p, q) => p.o - q.o).slice(0, max).map(x => x.m),
  };
}

/** Métriques d'un rôle officiel présentes dans les faits (libellés), poids décroissants */
export function roleMetrics(facts: ReportFacts, role: string | undefined, max = 8): FactMetric[] {
  const preset = role ? DEFAULT_ROLE_PRESETS[role] : undefined;
  const byLabel = new Map(facts.metrics.map(m => [m.metric, m]));
  if (!preset) return [...facts.metrics].sort((a, b) => Math.abs(b.percentile - 50) - Math.abs(a.percentile - 50)).slice(0, max);
  return Object.entries(presetWeights(preset))
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .map(([key]) => byLabel.get(metricLabel(key)))
    .filter((m): m is FactMetric => !!m)
    .slice(0, max);
}

// ============================================
// SYNTHÈSE (Markdown, 5 sections)
// ============================================

export interface SummarySection { title: string; lines: string[] }

/** Sections « ### n. Titre » d'une synthèse ; le texte avant le premier titre forme une section sans titre */
export function summarySections(content: string): SummarySection[] {
  const out: SummarySection[] = [];
  let current: SummarySection = { title: '', lines: [] };
  content.split('\n').forEach(raw => {
    const line = raw.replace(/\s+$/, '');
    const h = line.match(/^\s*#{1,6}\s*(.+)$/);
    if (h) {
      if (current.title || current.lines.some(l => l.trim())) out.push(current);
      current = { title: h[1].trim(), lines: [] };
    } else current.lines.push(line);
  });
  if (current.title || current.lines.some(l => l.trim())) out.push(current);
  return out;
}

/** Puces de la section « Priorités d'observation » (dernière section de la synthèse) */
export function observationPriorities(content: string): string[] {
  const sections = summarySections(content);
  const section = sections.find(s => /priorit/i.test(s.title)) ?? sections[sections.length - 1];
  if (!section) return [];
  return section.lines.map(l => l.trim()).filter(l => /^[-*•]\s+/.test(l)).map(l => l.replace(/^[-*•]\s+/, '').replace(/\*\*/g, ''));
}
