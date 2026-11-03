/**
 * ScoutVision - chaînes de modèles Gemini : quand un modèle répond « quota atteint » (429) ou
 * « indisponible » (404), l'appel passe au modèle suivant, et le modèle épuisé est mis de côté
 * jusqu'à sa remise à zéro probable.
 *
 * Niveau gratuit de l'API Gemini (relevé du 3 novembre 2026 dans Google AI Studio) : 20 requêtes par
 * jour pour les modèles Flash, 500 pour les Flash Lite récents, et recherche Google (« ancrage de
 * recherche ») à 0 pour Gemini 3 et suivants, 1 500 par jour pour Gemini 2 et 2.5. La recherche
 * d'actualité passe donc par les modèles 2.5, la rédaction par les modèles 3.x.
 * Chaînes remplaçables par GEMINI_SEARCH_MODELS et GEMINI_TEXT_MODELS (listes séparées par des virgules).
 */

import { errorStatus } from './scoutReport';

/** Recherche Google (ancrage) : seuls les modèles 2.5 y ont droit au niveau gratuit */
export const DEFAULT_SEARCH_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite'];
/** Rédaction (rapports, plan du jour) : du plus capable au plus disponible */
export const DEFAULT_TEXT_MODELS = ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'];

/** Liste de modèles lue dans une variable (« a, b ,c »), sinon la liste par défaut ; `first` passe devant */
export function modelChain(configured: string | undefined, defaults: string[], first?: string): string[] {
  const list = configured?.split(',').map(m => m.trim()).filter(Boolean);
  return [...new Set([...(first?.trim() ? [first.trim()] : []), ...(list?.length ? list : defaults)])];
}

export type Unavailability = 'daily' | 'rate' | 'missing';

/**
 * Indisponibilité d'un modèle d'après l'erreur : quota du jour (429 « PerDay » ou « exceeded your
 * current quota »), limite par minute (autre 429), modèle inconnu ou non servi (404). Null sinon :
 * l'erreur est remontée telle quelle (requête invalide, clé refusée, délai…).
 */
export function unavailability(error: unknown): Unavailability | null {
  const status = errorStatus(error);
  const message = error instanceof Error ? error.message : String(error);
  if (status === 429) return /PerDay|per day|exceeded your current quota|RESOURCE_EXHAUSTED.*day/i.test(message) ? 'daily' : 'rate';
  if (status === 404 || /models\/[^ ]+ is not found|is not supported for generateContent/i.test(message)) return 'missing';
  return null;
}

/** Fin probable d'une indisponibilité : quotas du jour remis à zéro à minuit (heure du Pacifique, ~8 h UTC) */
export function unavailableUntil(kind: Unavailability, now: number): number {
  if (kind === 'rate') return now + 60_000;
  if (kind === 'missing') return now + 6 * 3600_000;
  const d = new Date(now);
  const reset = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 8);
  return reset > now ? reset : reset + 24 * 3600_000;
}

/** Modèles d'une chaîne, avec ceux mis de côté (partagé entre les requêtes du processus) */
export class ModelPool {
  private until = new Map<string, number>();
  constructor(public readonly models: string[], private now: () => number = Date.now) {}
  available(): string[] { return this.models.filter(m => (this.until.get(m) ?? 0) <= this.now()); }
  setAside(model: string, kind: Unavailability) { this.until.set(model, unavailableUntil(kind, this.now())); }
}

/** Plus aucun modèle disponible : statut 429, message qui nomme les modèles essayés */
export class NoModelAvailable extends Error {
  status = 429;
  constructor(public readonly tried: string[], public readonly cause?: unknown) {
    super(tried.length
      ? `Quota gratuit atteint ou modèle indisponible sur ${tried.join(', ')}.`
      : 'Tous les modèles de la chaîne sont en pause (quota du jour atteint) jusqu\'à leur remise à zéro.');
    this.name = 'NoModelAvailable';
  }
}

/** Appelle le premier modèle disponible ; sur quota ou modèle absent, met ce modèle de côté et passe au suivant */
export async function withModelFallback<T>(pool: ModelPool, call: (model: string) => Promise<T>, log?: (message: string) => void): Promise<T> {
  const tried: string[] = [];
  let last: unknown;
  for (const model of pool.available()) {
    try {
      return await call(model);
    } catch (error) {
      const kind = unavailability(error);
      if (!kind) throw error;
      pool.setAside(model, kind);
      tried.push(model);
      last = error;
      log?.(`[gemini] ${model} indisponible (${kind === 'daily' ? 'quota du jour' : kind === 'rate' ? 'limite par minute' : 'modèle absent'}), modèle suivant`);
    }
  }
  throw new NoModelAvailable(tried, last);
}

/** Gemini 3 et suivants prennent un niveau de réflexion (`thinkingLevel`) ; 2.x non */
export const takesThinkingLevel = (model: string) => /^gemini-([3-9]|\d{2,})/.test(model);
