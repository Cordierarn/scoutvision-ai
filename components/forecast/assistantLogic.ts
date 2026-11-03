/**
 * Logique de l'assistant IA du Labo paris : matchs proposés par défaut, exécution bornée en parallèle,
 * libellés des avis, mises en euros (fractions du moteur × bankroll, jamais calculées par l'IA).
 */

import type { SuggestionMatch } from '../../services/replayData';
import { stakeEuros } from './suggestionsLogic';

export const MAX_ASSISTANT_MATCHES = 8;
export const DEFAULT_ASSISTANT_MATCHES = 6;
export const NEWS_CONCURRENCY = 3;

export type AssistantVerdict = 'garder' | 'prudence' | 'eviter' | 'non_evalue';
export const VERDICT_LABELS: Record<AssistantVerdict, string> = { garder: 'À garder', prudence: 'Prudence', eviter: 'À éviter', non_evalue: 'Non évalué' };
/** Garder en vert, éviter en rouge, prudence en orange (avertissement), non évalué en encre neutre */
export function verdictClass(v: AssistantVerdict): string {
  return v === 'garder' ? 'text-pos' : v === 'eviter' ? 'text-neg' : v === 'prudence' ? 'text-warn' : 'text-ink-3';
}

const kickoffOf = (m: SuggestionMatch) => new Date(m.kickoff ?? `${m.date}T12:00:00Z`).getTime();

/** Matchs analysables : cotes disponibles et coup d'envoi à venir, du plus proche au plus lointain */
export function candidateMatches(matches: SuggestionMatch[], now: Date): SuggestionMatch[] {
  return matches.filter(m => m.status === 'ok' && kickoffOf(m) > now.getTime()).sort((a, b) => kickoffOf(a) - kickoffOf(b));
}

/** Sélection par défaut : les matchs des prochaines 24 h (au plus 6), sinon les 6 prochains */
export function defaultSelection(matches: SuggestionMatch[], now: Date): string[] {
  const all = candidateMatches(matches, now);
  const soon = all.filter(m => kickoffOf(m) - now.getTime() <= 24 * 3600 * 1000);
  return (soon.length ? soon : all).slice(0, DEFAULT_ASSISTANT_MATCHES).map(m => m.matchId);
}

/** Exécute `fn` sur chaque élément, `limit` à la fois ; chaque résultat ou erreur est rendu dans l'ordre */
export async function mapLimited<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>, onDone?: (done: number) => void): Promise<PromiseSettledResult<R>[]> {
  const out: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0, done = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try { out[i] = { status: 'fulfilled', value: await fn(items[i]) }; } catch (reason) { out[i] = { status: 'rejected', reason }; }
      onDone?.(++done);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** Total misé du plan sur la bankroll saisie (fractions publiées par le moteur) */
export function planStake(picks: { stakeFraction: number }[], bankroll: number | null): number {
  return Math.round(picks.reduce((n, p) => n + stakeEuros(bankroll, p.stakeFraction), 0) * 100) / 100;
}

/** Lien de recherche Google d'une requête lancée par le modèle (affichée comme suggestion de recherche) */
export const googleSearchUrl = (query: string) => `https://www.google.com/search?q=${encodeURIComponent(query)}`;

export const RESPONSIBLE_GAMBLING = 'Interdit aux moins de 18 ans. Jouer comporte des risques : endettement, isolement, dépendance. Pour être aidé, appelez le 09 74 75 13 13 (appel non surtaxé).';
