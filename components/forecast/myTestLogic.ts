/**
 * « Mon test » (onglet Pronostics, Labo paris) : la bankroll personnelle de l'utilisateur, partie de 20 €, et les paris
 * qu'il a réellement placés à partir du plan de l'IA. Données gardées dans ce navigateur (localStorage), exportables en
 * JSON. Le règlement est automatique : un pari suivi est rapproché de la même sélection (match, marché, issue) dans
 * l'historique publié par le pipeline, réglée sur le score réel ; sinon l'utilisateur peut le régler à la main.
 */

import type { BetStatus, HistoryDay } from '../../services/replayData';

export const MY_TEST_KEY = 'scoutvision.betting.mytest';
export const MY_TEST_EVENT = 'scoutvision-mytest';
export const DEFAULT_START = 20;
export const MIN_STAKE = 0.1;

export interface MyBet {
  id: string;                  // matchId:marketId:outcomeId
  addedAt: string; kickoff: string; matchId: string; match: string; label: string;
  marketId: number | null; outcomeId: number | null; odds: number; stake: number; profile: string;
  manualStatus?: BetStatus;    // règlement à la main (sélection absente de l'historique publié)
  autoStatus?: BetStatus;      // règlement automatique mémorisé : l'historique publié ne garde que 14 jours
}
export interface MyTest { start: number; startedAt: string; bets: MyBet[] }

export const emptyTest = (now: Date = new Date()): MyTest => ({ start: DEFAULT_START, startedAt: now.toISOString(), bets: [] });

/** Lecture tolérante : stockage indisponible ou contenu illisible → test vide. */
export function loadMyTest(storage: Pick<Storage, 'getItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): MyTest {
  try {
    const raw = storage?.getItem(MY_TEST_KEY);
    return raw ? parseMyTest(raw) ?? emptyTest() : emptyTest();
  } catch {
    return emptyTest();
  }
}

/** Contenu d'un export JSON validé (début, paris aux champs attendus), sinon null. */
export function parseMyTest(raw: string): MyTest | null {
  try {
    const v = JSON.parse(raw);
    if (!v || typeof v !== 'object' || typeof v.start !== 'number' || !(v.start > 0) || !Array.isArray(v.bets)) return null;
    const bets = (v.bets as unknown[]).filter((b): b is MyBet => !!b && typeof b === 'object'
      && typeof (b as MyBet).id === 'string' && typeof (b as MyBet).odds === 'number' && (b as MyBet).odds > 1 && typeof (b as MyBet).stake === 'number' && (b as MyBet).stake > 0);
    return { start: v.start, startedAt: typeof v.startedAt === 'string' ? v.startedAt : new Date().toISOString(), bets };
  } catch {
    return null;
  }
}

// Copie en mémoire : si le stockage du navigateur est indisponible, le test vit le temps de la session
let memoryRaw: string | null = null;

/** Contenu brut du test : stockage du navigateur, sinon copie en mémoire. */
export function readStoredRaw(): string | null {
  try { return localStorage.getItem(MY_TEST_KEY) ?? memoryRaw; } catch { return memoryRaw; }
}

export function saveMyTest(test: MyTest): void {
  memoryRaw = JSON.stringify(test);
  try { localStorage.setItem(MY_TEST_KEY, memoryRaw); } catch { /* stockage indisponible : copie en mémoire */ }
  try { window.dispatchEvent(new Event(MY_TEST_EVENT)); } catch { /* hors navigateur */ }
}

export const betId = (matchId: string, marketId: number | null, outcomeId: number | null, label: string) =>
  marketId !== null && outcomeId !== null ? `${matchId}:${marketId}:${outcomeId}` : `${matchId}:${label}`;

/** Statut publié de chaque sélection de l'historique, en attente comprise, par identifiant match:marché:issue. */
function publishedAll(history: HistoryDay[]): Map<string, BetStatus> {
  const out = new Map<string, BetStatus>();
  for (const d of history) for (const m of d.matches) for (const bets of Object.values(m.profiles)) for (const b of bets ?? []) {
    if (b.marketId === undefined || b.outcomeId === undefined) continue;
    const id = `${m.matchId}:${b.marketId}:${b.outcomeId}`;
    if (b.status !== 'pending' || !out.has(id)) out.set(id, b.status);   // un profil qui l'a réglée l'emporte sur un autre en attente
  }
  return out;
}

/** Statut publié de chaque sélection réglée de l'historique, par identifiant match:marché:issue. */
export function publishedStatus(history: HistoryDay[]): Map<string, BetStatus> {
  return new Map([...publishedAll(history)].filter(([, status]) => status !== 'pending'));
}

/** Règlement automatique d'un pari : le statut publié ; une sélection publiée de nouveau en attente (score corrigé, mi-temps
 * inconnue) efface le statut mémorisé ; absente de l'historique (plus de 14 jours), le statut mémorisé reste. */
function autoOf(b: MyBet, published: Map<string, BetStatus>): BetStatus | undefined {
  const pub = published.get(b.id);
  return pub === 'pending' ? undefined : pub ?? b.autoStatus;
}

/** Gain net pour 1 € misé selon le statut (règles Winamax des demi-gains et remboursements). */
export function netPerUnit(status: BetStatus, odds: number): number | null {
  switch (status) {
    case 'won': return odds - 1;
    case 'half_won': return (odds - 1) / 2;
    case 'void': return 0;
    case 'half_lost': return -0.5;
    case 'lost': return -1;
    default: return null;
  }
}

export interface SettledBet extends MyBet { status: BetStatus; net: number | null; auto: boolean }

export function settle(test: MyTest, history: HistoryDay[]): SettledBet[] {
  const published = publishedAll(history);
  return test.bets.map(b => {
    const autoStatus = autoOf(b, published);
    const status: BetStatus = b.manualStatus ?? autoStatus ?? 'pending';
    const unit = netPerUnit(status, b.odds);
    return { ...b, status, net: unit === null ? null : Math.round(b.stake * unit * 100) / 100, auto: !b.manualStatus && !!autoStatus };
  });
}

/** Mémorise les règlements automatiques trouvés dans l'historique, et oublie ceux qui y sont repassés en attente ; null si
 * rien n'a changé. */
export function recordAuto(test: MyTest, history: HistoryDay[]): MyTest | null {
  const published = publishedAll(history);
  let changed = false;
  const bets = test.bets.map(b => {
    const auto = autoOf(b, published);
    if (auto === b.autoStatus) return b;
    changed = true;
    if (auto === undefined) { const { autoStatus: _forgotten, ...rest } = b; return rest; }
    return { ...b, autoStatus: auto };
  });
  return changed ? { ...test, bets } : null;
}

/** Ajoute un pari (ignoré s'il est déjà suivi). */
export const addBet = (test: MyTest, bet: MyBet): MyTest => (test.bets.some(b => b.id === bet.id) ? test : { ...test, bets: [...test.bets, bet] });
export const removeBet = (test: MyTest, id: string): MyTest => ({ ...test, bets: test.bets.filter(b => b.id !== id) });
export const updateBet = (test: MyTest, id: string, patch: Partial<Pick<MyBet, 'stake' | 'odds' | 'manualStatus'>>): MyTest =>
  ({ ...test, bets: test.bets.map(b => (b.id === id ? { ...b, ...patch } : b)) });

/** Montant saisi (virgule ou point) : nombre > 0 arrondi au centime, sinon null. */
export function parseAmount(raw: string): number | null {
  const v = Number(raw.replace(',', '.').trim());
  return Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : null;
}

export interface MyTestSummary { bankroll: number; available: number; pending: number; staked: number; net: number; bets: number; settled: number; won: number; roi: number | null }

/** Bankroll = départ + gains nets réglés ; disponible = bankroll − mises en attente ; rendement sur les mises réglées (hors remboursés). */
export function summarise(test: MyTest, settled: SettledBet[]): MyTestSummary {
  let net = 0, staked = 0, pending = 0, done = 0, won = 0;
  for (const b of settled) {
    if (b.net === null) { pending += b.stake; continue; }
    done++;
    net += b.net;
    if (b.status !== 'void') staked += b.stake;
    if (b.net > 0) won++;
  }
  const r = (x: number) => Math.round(x * 100) / 100;
  return { bankroll: r(test.start + net), available: r(test.start + net - pending), pending: r(pending), staked: r(staked), net: r(net), bets: settled.length, settled: done, won,
    roi: staked > 0 ? Math.round((net / staked) * 10000) / 10000 : null };
}

/** Mise proposée pour un pari du plan : fraction du moteur appliquée à la bankroll disponible, au moins la mise minimale, arrondie à 10 centimes. */
export function proposedStake(stakeFraction: number, available: number): number {
  const v = Math.max(MIN_STAKE, Math.round(stakeFraction * available * 10) / 10);
  return Math.min(v, Math.max(MIN_STAKE, Math.floor(available * 10) / 10));
}

/** Paris groupés par soirée (date du coup d'envoi, heure de Paris), la plus récente d'abord. */
export function byEvening(settled: SettledBet[]): { date: string; bets: SettledBet[]; net: number | null }[] {
  const days = new Map<string, SettledBet[]>();
  for (const b of settled) {
    const d = new Date(b.kickoff).toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' });
    days.set(d, [...(days.get(d) ?? []), b]);
  }
  return [...days.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([date, bets]) => ({
    date, bets, net: bets.every(b => b.net !== null) ? Math.round(bets.reduce((s, b) => s + (b.net ?? 0), 0) * 100) / 100 : null,
  }));
}
