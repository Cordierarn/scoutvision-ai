/**
 * Logique d'affichage des suggestions de paris (onglet Matchs à venir). Le pipeline publie les
 * probabilités, espérances et fractions de mise ; le navigateur ne calcule que la mise en euros à partir de
 * la bankroll saisie, l'âge d'une cote et les libellés.
 */

import type { BilanBlock, BilanProfile, SuggestionProfile } from '../../services/replayData';

export const PROFILE_ORDER: SuggestionProfile[] = ['sur', 'equilibre', 'grosse_cote'];
export const PROFILE_LABELS: Record<SuggestionProfile, string> = { sur: 'Sûr', equilibre: 'Équilibré', grosse_cote: 'Grosse cote' };
export const PROFILE_HINTS: Record<SuggestionProfile, string> = {
  sur: 'Probabilité la plus forte, cote minimale 1,30.',
  equilibre: 'Score = probabilité × (1 + espérance) : la probabilité pondérée par le multiplicateur attendu de la mise.',
  grosse_cote: 'Cote de 3,00 ou plus, meilleure espérance.',
};
export const DEFAULT_PROFILE: SuggestionProfile = 'equilibre';
export const BANKROLL_KEY = 'scoutvision.betting.bankroll';
export const PROFILE_KEY = 'scoutvision.betting.profile';
export const MIN_BANKROLL = 1;
export const MAX_BANKROLL = 1_000_000;
export const STALE_HOURS = 2;

/** Bankroll saisie : nombre entre 1 et 1 000 000 €, sinon null (champ invalide). */
export function parseBankroll(raw: string): number | null {
  const v = Number(String(raw).replace(',', '.').replace(/\s/g, ''));
  if (!Number.isFinite(v) || v < MIN_BANKROLL || v > MAX_BANKROLL) return null;
  return Math.round(v * 100) / 100;
}

/** Mise en euros : fraction publiée × bankroll, arrondie au centime ; 0 si bankroll invalide. */
export function stakeEuros(bankroll: number | null, fraction: number): number {
  if (bankroll === null || !Number.isFinite(fraction) || fraction <= 0) return 0;
  return Math.round(bankroll * fraction * 100) / 100;
}

const euro = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const oddsFmt = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pctFmt = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });

export const formatEuros = (v: number) => euro.format(v);
export const formatOdds = (v: number) => oddsFmt.format(v);
export const formatPct = (v: number) => `${pctFmt.format(v * 100)} %`;
export const formatEv = (v: number) => `${v >= 0 ? '+' : '−'}${pctFmt.format(Math.abs(v) * 100)} %`;

/** Heure du relevé (fr-FR), et « ancienne » au-delà de 2 h par rapport à `now`. */
export function oddsAge(oddsAt: string, now: Date): { time: string; stale: boolean } {
  const d = new Date(oddsAt);
  if (Number.isNaN(d.getTime())) return { time: 'N/D', stale: true };
  const sameDay = d.toDateString() === now.toDateString();
  const time = sameDay
    ? d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  return { time, stale: now.getTime() - d.getTime() > STALE_HOURS * 3600 * 1000 };
}

/** Ligne de bilan d'un type de suggestion (profil × famille) sur la saison, ou null si trop peu de paris. */
export function bilanLine(bilan: BilanProfile | undefined, family: string): string | null {
  const b: BilanBlock | undefined = bilan?.byFamily?.[family];
  if (!b || !b.bets || b.hitRate === null || b.returnFlat === null) return null;
  return `${family} cette saison : ${b.bets} paris, ${formatPct(b.hitRate)} réussis, rendement ${formatEv(b.returnFlat)}`;
}

/** Lecture du mode de mise. */
export function stakeLabel(mode: 'kelly' | 'fixed'): string {
  return mode === 'kelly' ? 'quart de Kelly' : 'mise fixe 2 %, espérance négative';
}
