/**
 * ScoutVision - client de l'assistant IA du Labo paris (/api/ai/betting-news, /api/ai/betting-plan).
 *
 * Le navigateur n'envoie que des identifiants de match et le profil : le serveur lit lui-même les
 * suggestions publiées, cherche l'actualité d'avant-match (Google Search) et renvoie un plan validé.
 * Il n'appelle jamais Gemini et ne connaît aucune clé.
 */

import type { NewsEntry, PlanResponse } from '../server/bettingAi';
import { ScoutReportError, ScoutReportMeta } from './scoutReportService';

export type MatchNews = NewsEntry & { cached: boolean };
export type BettingPlan = PlanResponse & { profile: string; meta: ScoutReportMeta & { suggestionsAt: string }; promptVersion: string };

async function post<T>(path: string, body: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new ScoutReportError('Serveur IA injoignable. Vérifiez votre connexion et réessayez.');
  }
  // Réponse ouverte en production : statut 200 et erreur éventuelle dans le JSON (`error`, `status`)
  const payload = (await response.json().catch(() => null)) as (T & { error?: string; status?: number }) | null;
  if (payload && typeof payload.error === 'string') throw new ScoutReportError(payload.error, typeof payload.status === 'number' ? payload.status : response.status);
  if (!response.ok || !payload) {
    throw new ScoutReportError(payload?.error ?? (response.status === 404
      ? 'Endpoint IA absent : lancez l\'application avec son serveur (npm run dev ou npm run preview).'
      : 'La génération a échoué. Réessayez.'), response.status);
  }
  return payload;
}

/** Actualité d'avant-match d'un match (en cache 90 min côté serveur ; `refresh` relance la recherche) */
export async function fetchMatchNews(matchId: string, refresh = false): Promise<MatchNews> {
  const p = await post<MatchNews>('/api/ai/betting-news', { matchId, refresh });
  if (typeof p.text !== 'string' || !Array.isArray(p.sources)) throw new ScoutReportError('Réponse du serveur incomplète.');
  return p;
}

/** Plan du jour sur les matchs choisis, à partir de l'actualité déjà recherchée */
export async function fetchBettingPlan(matchIds: string[], profile: string): Promise<BettingPlan> {
  const p = await post<BettingPlan>('/api/ai/betting-plan', { matchIds, profile });
  if (!Array.isArray(p.picks) || !Array.isArray(p.matches)) throw new ScoutReportError('Réponse du serveur incomplète.');
  return p;
}
