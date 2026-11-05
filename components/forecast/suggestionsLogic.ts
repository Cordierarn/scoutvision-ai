/**
 * Logique d'affichage des suggestions de paris (onglet Matchs à venir). Le pipeline publie les
 * probabilités, espérances et fractions de mise ; le navigateur ne calcule que la mise en euros à partir de
 * la bankroll saisie, l'âge d'une cote et les libellés.
 */

import type { BetStatus, BilanBlock, BilanProfile, HistoryBet, HistoryDay, StakeMode, SuggestionProfile } from '../../services/replayData';

export const PROFILE_ORDER: SuggestionProfile[] = ['sur', 'equilibre', 'grosse_cote'];
export const PROFILE_LABELS: Record<SuggestionProfile, string> = { sur: 'Sûr', equilibre: 'Équilibré', grosse_cote: 'Grosse cote' };
export const PROFILE_HINTS: Record<SuggestionProfile, string> = {
  sur: 'Probabilité de référence la plus forte, cote minimale 1,30.',
  equilibre: 'Score = probabilité de référence × (1 + espérance) : la probabilité pondérée par le multiplicateur attendu de la mise.',
  grosse_cote: 'Cote de 3,00 ou plus, meilleure espérance face au marché sharp.',
};
/** Formulation partagée du principe du coupe-circuit (Matchs à venir, Suivi des paris). */
export const CIRCUIT_NOTE = 'Référence : Pinnacle ou Betfair Exchange sans marge (méthode de Shin). Une sélection n\'apparaît que si sa cote Winamax dépasse cette référence d\'au moins 2,5 à 4 % d\'espérance ; sinon, pas de pari.';
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
export function stakeLabel(mode: StakeMode): string {
  if (mode === 'shrink_kelly') return 'Kelly rétréci (κ = 0,15), plafond 2,5 % de la bankroll';
  return mode === 'kelly' ? 'Kelly rétréci sur la probabilité du moteur' : 'mise fixe 2 %, espérance négative';
}

/** CLV en texte signé : « +3 % », « −1 % » ; null quand la clôture n'est pas connue. */
export const formatClv = (v: number | null | undefined) => (v === null || v === undefined ? null : formatEv(v));

/** Référence sharp d'une suggestion, pour une infobulle ou une ligne de détail. */
export function sharpLabel(s: { pSharp?: number | null; sharpBookmaker?: string | null; poolW?: number | null; pRef?: number }): string | null {
  if (s.pSharp === null || s.pSharp === undefined) return null;
  const bk = s.sharpBookmaker === 'pinnacle' ? 'Pinnacle' : s.sharpBookmaker === 'betfair-ex' ? 'Betfair Exchange' : 'marché sharp';
  const pooled = s.poolW && s.pRef !== undefined ? ` ; référence ${formatPct(s.pRef)} (pool, poids modèle ${s.poolW})` : '';
  return `${bk} sans marge : ${formatPct(s.pSharp)}${pooled}`;
}

// ----- Suivi des paris : suggestions publiées et réglées -----

export const STATUS_LABELS: Record<BetStatus, string> = {
  won: 'Gagné', lost: 'Perdu', void: 'Remboursé', half_won: 'Moitié gagnée', half_lost: 'Moitié perdue', pending: 'En attente',
};

/** Couleur du statut : vert pour un gain, rouge pour une perte, encre neutre sinon. */
export function statusClass(status: BetStatus): string {
  if (status === 'won' || status === 'half_won') return 'text-pos';
  if (status === 'lost' || status === 'half_lost') return 'text-neg';
  return 'text-ink-3';
}

/** Montant signé : « +6,58 € », « −12,00 € », « 0,00 € ». */
export function formatSignedEuros(v: number): string {
  if (Math.abs(v) < 0.005) return formatEuros(0);
  return `${v > 0 ? '+' : '−'}${formatEuros(Math.abs(v))}`;
}

/** Gain net d'une suggestion réglée sur la bankroll saisie (mise × rendement pour 1 €), null si en attente. */
export function betNet(bankroll: number | null, bet: Pick<HistoryBet, 'stakeFraction' | 'realised' | 'status'>): number | null {
  if (bet.status === 'pending' || bet.realised === null || bankroll === null) return null;
  return Math.round(stakeEuros(bankroll, bet.stakeFraction) * bet.realised * 100) / 100;
}

export interface HistorySummary {
  bets: number; settled: number; won: number; hitRate: number | null; staked: number; net: number;
  clvBets: number; meanClv: number | null; clvBeatRate: number | null;
}

/** Bilan d'un profil sur l'historique : réussite hors remboursements (demi-gains comptés), mises et net des paris
 * réglés, et CLV (cote prise contre clôture sharp juste) sur les paris où la clôture est connue. */
export function historySummary(days: HistoryDay[], profile: SuggestionProfile, bankroll: number | null): HistorySummary {
  let bets = 0, settled = 0, won = 0, decided = 0, staked = 0, net = 0, clvBets = 0, clvSum = 0, clvBeat = 0;
  for (const d of days) for (const m of d.matches) for (const b of m.profiles[profile] ?? []) {
    bets += 1;
    if (typeof b.clv === 'number') { clvBets += 1; clvSum += b.clv; if (b.clv > 0) clvBeat += 1; }
    if (b.status === 'pending') continue;
    settled += 1;
    if (b.status !== 'void') decided += 1;
    if (b.status === 'won' || b.status === 'half_won') won += 1;
    staked += stakeEuros(bankroll, b.stakeFraction);
    net += betNet(bankroll, b) ?? 0;
  }
  return {
    bets, settled, won, hitRate: decided ? won / decided : null, staked: Math.round(staked * 100) / 100, net: Math.round(net * 100) / 100,
    clvBets, meanClv: clvBets ? clvSum / clvBets : null, clvBeatRate: clvBets ? clvBeat / clvBets : null,
  };
}
