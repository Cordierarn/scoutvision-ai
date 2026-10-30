/**
 * ScoutVision - client des fonctions d'IA ancrée (/api/ai/compare, /api/ai/opposition, /api/ai/hunter)
 *
 * Le navigateur n'envoie que des faits déjà calculés par ScoutVision (lignes joueur, faits d'équipe,
 * catalogue du Chasseur) et reçoit un texte contrôlé par le serveur, ou une configuration JSON
 * validée. Il n'appelle jamais Gemini et ne connaît aucune clé.
 */

import { PlayerData } from '../types';
import type { HunterCatalogue, HunterConfig } from '../server/groundedAi';
import { ScoutReportError, ScoutReportMeta } from './scoutReportService';

export type { HunterCatalogue, HunterConfig };
export const GROUNDED_AI_ENDPOINT = '/api/ai';

export interface AiTextResult { content: string; meta: ScoutReportMeta | null; facts: unknown; promptVersion: string | null }
export interface AiHunterResult { config: HunterConfig; warnings: string[]; meta: ScoutReportMeta | null; promptVersion: string | null }

interface Wire { content?: unknown; config?: unknown; warnings?: unknown; meta?: Partial<ScoutReportMeta>; facts?: unknown; promptVersion?: unknown; error?: string }

async function post(task: 'compare' | 'opposition' | 'hunter', body: unknown): Promise<Wire> {
  let response: Response;
  try {
    response = await fetch(`${GROUNDED_AI_ENDPOINT}/${task}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new ScoutReportError('Serveur IA injoignable. Vérifiez votre connexion et réessayez.');
  }
  const payload = (await response.json().catch(() => null)) as Wire | null;
  if (!response.ok || !payload) {
    throw new ScoutReportError(payload?.error ?? (response.status === 404
      ? 'Endpoint IA absent : lancez l\'application avec son serveur (npm run dev ou npm run preview).'
      : 'La génération a échoué. Réessayez.'), response.status);
  }
  return payload;
}

const meta = (m: Partial<ScoutReportMeta> | undefined): ScoutReportMeta | null =>
  m && typeof m.model === 'string' && typeof m.generatedAt === 'string' ? { model: m.model, requestedModel: typeof m.requestedModel === 'string' ? m.requestedModel : m.model, generatedAt: m.generatedAt } : null;

export interface ComparePlayer { row: PlayerData; bestRoles?: { role: string; normalizedScore: number }[] }

/** Synthèse comparative : joueurs comparés, ou candidat(s) face au titulaire (premier joueur) */
export async function aiCompare(players: ComparePlayer[], options: { framing?: 'comparison' | 'candidate_vs_incumbent'; role?: string; seasonInProgress?: boolean } = {}): Promise<AiTextResult> {
  const p = await post('compare', { players, framing: options.framing ?? 'comparison', role: options.role, seasonInProgress: options.seasonInProgress });
  if (typeof p.content !== 'string') throw new ScoutReportError('Réponse du serveur incomplète.');
  return { content: p.content, meta: meta(p.meta), facts: p.facts, promptVersion: typeof p.promptVersion === 'string' ? p.promptVersion : null };
}

/** Briefing d'opposition à partir des faits d'équipe calculés par ScoutVision */
export async function aiOpposition(facts: { team: Record<string, unknown> }): Promise<AiTextResult> {
  const p = await post('opposition', facts);
  if (typeof p.content !== 'string') throw new ScoutReportError('Réponse du serveur incomplète.');
  return { content: p.content, meta: meta(p.meta), facts: p.facts, promptVersion: typeof p.promptVersion === 'string' ? p.promptVersion : null };
}

/** Demande en langage naturel → configuration du Chasseur (validée par le serveur contre le catalogue) */
export async function aiHunter(query: string, catalogue: HunterCatalogue): Promise<AiHunterResult> {
  const p = await post('hunter', { query, catalogue });
  const config = p.config as HunterConfig | undefined;
  if (!config || typeof config !== 'object' || !Array.isArray(config.extraCriteria)) throw new ScoutReportError('Réponse du serveur incomplète.');
  return { config, warnings: Array.isArray(p.warnings) ? p.warnings.filter((w): w is string => typeof w === 'string') : [], meta: meta(p.meta), promptVersion: typeof p.promptVersion === 'string' ? p.promptVersion : null };
}
