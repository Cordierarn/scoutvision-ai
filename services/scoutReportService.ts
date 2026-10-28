/**
 * ScoutVision AI - rapport de scouting rédigé par IA
 * Le navigateur n'appelle jamais Gemini : il envoie la ligne du joueur et les indicateurs
 * calculés à l'endpoint serveur POST /api/scout-report (server/), qui détient la clé.
 */

import { PlayerData, PlayerPercentileProfile, ShotStats } from '../types';

export const SCOUT_REPORT_ENDPOINT = '/api/scout-report';

/**
 * Options pour la génération de rapport
 */
export interface ScoutReportOptions {
  language?: 'en' | 'fr' | 'es' | 'de';
  detailLevel?: 'brief' | 'standard' | 'detailed';
  focusAreas?: ('attacking' | 'defending' | 'physical' | 'mental')[];
  targetRole?: string;
  percentileProfile?: PlayerPercentileProfile;
  bestRoles?: { role: string; normalizedScore: number }[];   // rôles officiels (rolePresets) et indice
  shotStats?: ShotStats;
  insights?: string[];          // indicateurs avancés déjà formulés (RAPM, finition, projection...)
  seasonInProgress?: boolean;   // saison non terminée à la date des données (échantillon partiel)
}

/**
 * Métadonnées de génération renvoyées par le serveur
 */
export interface ScoutReportMeta {
  model: string;                // modèle qui a réellement rédigé le rapport
  requestedModel: string;       // modèle configuré côté serveur (GEMINI_MODEL)
  generatedAt: string;
}

export interface ScoutReportResult {
  report: string;
  meta: ScoutReportMeta | null;
}

/**
 * Pied du rapport : le modèle réellement utilisé, tel que renvoyé par le serveur
 */
export function reportFooterLabel(meta: ScoutReportMeta | null): string {
  return meta?.model ? `Généré par ${meta.model}` : 'Généré par IA';
}

/**
 * Échec de génération, avec un message lisible par l'utilisateur
 */
export class ScoutReportError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = 'ScoutReportError';
  }
}

/**
 * Cache pour les rapports générés
 */
const reportCache = new Map<string, { result: ScoutReportResult; timestamp: number }>();
const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes

const getCacheKey = (player: PlayerData): string => `${player.Player}_${player.Team}_${player.League}`;

/**
 * Corps envoyé au serveur : seulement ce que le prompt utilise
 */
export function buildReportRequest(player: PlayerData, options: ScoutReportOptions = {}) {
  return {
    player,
    options: {
      language: options.language,
      detailLevel: options.detailLevel,
      focusAreas: options.focusAreas,
      targetRole: options.targetRole,
      percentiles: options.percentileProfile?.percentiles,
      bestRoles: options.bestRoles?.map(r => ({ role: r.role, normalizedScore: r.normalizedScore })),
      shotStats: options.shotStats && {
        total: options.shotStats.total,
        goals: options.shotStats.goals,
        xG: options.shotStats.xG,
        conversion: options.shotStats.conversion,
      },
      insights: options.insights,
      seasonInProgress: options.seasonInProgress,
    },
  };
}

/**
 * Génère un rapport de scouting via le serveur ; lève ScoutReportError en cas d'échec
 */
export async function generateScoutReport(player: PlayerData, options?: ScoutReportOptions): Promise<ScoutReportResult> {
  const cacheKey = getCacheKey(player);
  const cached = reportCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return cached.result;
  }

  let response: Response;
  try {
    response = await fetch(SCOUT_REPORT_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildReportRequest(player, options)),
    });
  } catch {
    throw new ScoutReportError('Serveur de rapports injoignable. Vérifiez votre connexion et réessayez.');
  }

  const payload = await response.json().catch(() => null) as { report?: string; meta?: Partial<ScoutReportMeta>; error?: string } | null;
  if (!response.ok || typeof payload?.report !== 'string') {
    throw new ScoutReportError(
      payload?.error ?? (response.status === 404
        ? 'Endpoint de rapport absent : lancez l\'application avec son serveur (npm run dev ou npm run preview).'
        : 'Le rapport n\'a pas pu être généré. Réessayez.'),
      response.status,
    );
  }

  const m = payload.meta;
  const meta = m && typeof m.model === 'string' && m.model
    ? { model: m.model, requestedModel: typeof m.requestedModel === 'string' ? m.requestedModel : m.model, generatedAt: typeof m.generatedAt === 'string' ? m.generatedAt : new Date().toISOString() }
    : null;
  const result = { report: payload.report, meta };
  reportCache.set(cacheKey, { result, timestamp: Date.now() });
  return result;
}
