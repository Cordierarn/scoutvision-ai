/**
 * ScoutVision - génération d'une synthèse et enregistrement dans le dossier de scouting
 *
 * Partagé par la fiche joueur et la page Rapports : mêmes options envoyées au serveur, même
 * snapshot. Une génération réussie crée le dossier de la ligne joueur-saison s'il n'existe pas,
 * puis ajoute la synthèse à l'historique (jamais à la place de la précédente) avec les faits
 * exacts que le modèle a reçus. Sans clé Gemini, l'erreur remonte et le dossier reste intact.
 */

import { PlayerData, ShotEvent, getPlayerSeason, getPlayerSeasonId, ShotStats } from '../../types';
import { AgeCurves, dataLoader } from '../../services/dataLoader';
import { ScoutReportError, generateScoutReport } from '../../services/scoutReportService';
import { addSummary, createReport, findReportForPlayer } from '../../services/scoutReportStore';
import { GeneratedSummary, SCOUT_REPORT_SCHEMA_VERSION, ScoutReportRecord } from '../../types/scoutReport';
import { rankPresets } from '../../utils/rolePresets';
import { getRadarMetricsForPosition } from '../../utils/positionMetrics';
import { isSeasonInProgress } from '../../utils/sampleContext';
import { buildSnapshot, playerRef } from '../../utils/scoutReportSnapshot';
import { buildReportInsights } from '../PlayerInsights';

// Tir du joueur : par identifiant, sinon par nom (même règle que la fiche)
const isPlayerShot = (s: ShotEvent, player: PlayerData): boolean =>
  player['Player ID'] ? s.player_id === player['Player ID'] : s.player === player.Player;

/** Métriques clés du rôle pour la projection à un an (celles de la fiche) */
export const developmentMetricsFor = (position: string | undefined) => [...getRadarMetricsForPosition(position ?? ''), 'Rating'];

/** Saison en cours à la date des données, pour la dernière saison chargée seulement */
export function seasonInProgressFor(player: PlayerData): boolean {
  const index = dataLoader.getCachedIndex();
  const seasons = index?.seasons ?? [];
  const season = getPlayerSeason(player);
  return seasons[seasons.length - 1]?.id === season && isSeasonInProgress(season, player.Season, index?.generatedAt);
}

async function shotStatsFor(player: PlayerData): Promise<ShotStats | undefined> {
  if (!player.Competition) return undefined;
  const shots = await dataLoader.loadShots(getPlayerSeason(player), player.Competition).then(all => all.filter(s => isPlayerShot(s, player))).catch(() => null);
  if (!shots) return undefined;
  const goals = shots.filter(s => s.result === 'Goal').length;
  const xG = shots.reduce((acc, s) => acc + s.xG, 0);
  return {
    total: shots.length, goals, xG, xGDiff: goals - xG,
    onTarget: shots.filter(s => s.result === 'Goal' || s.result === 'SavedShot').length,
    blocked: shots.filter(s => s.result === 'BlockedShot').length,
    conversion: shots.length > 0 ? (goals / shots.length) * 100 : 0,
    avgXG: shots.length > 0 ? xG / shots.length : 0,
  };
}

/** Dossier non enregistré d'une ligne joueur-saison : snapshot des données seulement (export PDF sans dossier) */
export async function draftDossier(player: PlayerData, curves: AgeCurves | null): Promise<ScoutReportRecord> {
  const seasonInProgress = seasonInProgressFor(player);
  const metrics = developmentMetricsFor(player.Position);
  const shotStats = await shotStatsFor(player);
  const snapshot = buildSnapshot(player, {
    curves, developmentMetrics: metrics, competition: dataLoader.getCompetition(player.Competition), dataIndex: dataLoader.getCachedIndex(),
    seasonInProgress, shotStats, insights: buildReportInsights(player, curves, metrics),
  });
  const now = new Date().toISOString();
  return {
    id: 'brouillon', schemaVersion: SCOUT_REPORT_SCHEMA_VERSION, player: playerRef(player, dataLoader.getCompetition(player.Competition)),
    createdAt: now, updatedAt: now, status: 'draft', ...(snapshot.bestRoles[0] ? { role: snapshot.bestRoles[0].role } : {}), tags: [],
    dataSnapshot: snapshot, generatedSummaries: [], observations: [],
  };
}

/** Dossier d'une ligne joueur-saison sans synthèse IA : existant, sinon créé avec le snapshot des données */
export async function createDossier(player: PlayerData, curves: AgeCurves | null): Promise<ScoutReportRecord> {
  const existing = findReportForPlayer(getPlayerSeasonId(player));
  if (existing) return existing;
  const draft = await draftDossier(player, curves);
  return createReport({ player: draft.player, dataSnapshot: draft.dataSnapshot, role: draft.role });
}

export interface GenerationOutcome {
  record: ScoutReportRecord;
  summary: GeneratedSummary;
}

/**
 * Génère la synthèse (serveur), puis l'enregistre comme nouvelle version du dossier avec les
 * faits renvoyés. Lève ScoutReportError si la génération échoue ; rien n'est alors écrit.
 */
export async function generateAndStore(player: PlayerData, curves: AgeCurves | null): Promise<GenerationOutcome> {
  const seasonInProgress = seasonInProgressFor(player);
  const metrics = developmentMetricsFor(player.Position);
  const bestRoles = rankPresets(player);
  const shotStats = await shotStatsFor(player);
  const percentiles = Object.fromEntries(Object.entries(player)
    .filter(([key, value]) => key.endsWith(' pct') && typeof value === 'number')
    .map(([key, value]) => [key.slice(0, -4), value as number]));
  // Nouvelle version d'un dossier déjà rédigé : on interroge le serveur, jamais le cache client
  const existingBefore = findReportForPlayer(getPlayerSeasonId(player));
  const result = await generateScoutReport(player, {
    language: 'fr',
    percentileProfile: { player, percentiles, zScores: {}, averages: {} },
    bestRoles: bestRoles.map(r => ({ role: r.name, normalizedScore: r.index })),
    shotStats,
    insights: buildReportInsights(player, curves, metrics),
    seasonInProgress,
  }, { skipCache: (existingBefore?.generatedSummaries.length ?? 0) > 0 });
  if (!result.meta) throw new ScoutReportError('Réponse du serveur incomplète : modèle inconnu, synthèse non enregistrée.');

  const snapshot = buildSnapshot(player, {
    curves, developmentMetrics: metrics, competition: dataLoader.getCompetition(player.Competition), dataIndex: dataLoader.getCachedIndex(),
    seasonInProgress, shotStats, facts: result.facts ?? undefined, insights: buildReportInsights(player, curves, metrics),
  });
  const existing = findReportForPlayer(getPlayerSeasonId(player));
  const record = existing ?? createReport({ player: playerRef(player, dataLoader.getCompetition(player.Competition)), dataSnapshot: snapshot, role: snapshot.bestRoles[0]?.role });
  const updated = addSummary(record.id, {
    model: result.meta.model, requestedModel: result.meta.requestedModel, promptVersion: result.promptVersion ?? 'inconnue',
    generatedAt: result.meta.generatedAt, content: result.content,
  }, snapshot);
  return { record: updated, summary: updated.generatedSummaries[updated.generatedSummaries.length - 1] };
}
