/**
 * ScoutVision - assistant IA du Labo paris (onglet Pronostics › Matchs à venir), côté serveur.
 *
 * Deux temps, deux appels distincts :
 * 1. /api/ai/betting-news : actualité d'avant-match d'un match (absences, doutes, rotation, contexte)
 *    par Gemini avec l'outil Google Search ; le serveur renvoie le texte, les sources citées, les requêtes
 *    lancées et le bloc de suggestions Google à afficher. Mis en cache par match (90 min).
 * 2. /api/ai/betting-plan : plan du jour en JSON strict (schéma) à partir des suggestions du moteur et
 *    de l'actualité en cache ; le serveur valide tout (références, verdicts, nombres).
 *
 * Ce que l'IA ne fait jamais : calculer une probabilité, une cote, une espérance ou une mise, ni proposer
 * une sélection absente des suggestions du moteur. Elle garde, nuance ou écarte des suggestions existantes
 * au vu d'une actualité sourcée, que le modèle statistique ignore. Les références de recherche montrent
 * que les modèles de langage ne battent pas le marché sur les probabilités, et que l'actualité récente
 * (compositions, absences) est ce qu'un agent ajoute réellement.
 *
 * Les faits viennent de l'artefact servi par le serveur (forecast/suggestions/index.json), jamais du
 * navigateur, qui n'envoie que des identifiants. La clé Gemini ne quitte jamais le serveur.
 */

import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { NUMBER, factNumbers, supported } from './reportAudit';
import { Generation, errorStatus, redact, resolveGeminiModel } from './scoutReport';

export const BETTING_PROMPT_VERSIONS = { news: 'ai-betting-news-v1', plan: 'ai-betting-plan-v1' } as const;
export const BETTING_NEWS_PATH = '/api/ai/betting-news';
export const BETTING_PLAN_PATH = '/api/ai/betting-plan';
export const MAX_PLAN_MATCHES = 8;
export const MAX_PICKS = 5;
export const NEWS_TTL_MS = 90 * 60 * 1000;
export const NEWS_REFRESH_MIN_MS = 15 * 60 * 1000;   // « Actualiser » : pas plus d'un appel par quart d'heure et par match
const MAX_TEXT = 700;

export type Profile = 'sur' | 'equilibre' | 'grosse_cote';
const PROFILES: Profile[] = ['sur', 'equilibre', 'grosse_cote'];
export type Verdict = 'garder' | 'prudence' | 'eviter';
const VERDICTS: Verdict[] = ['garder', 'prudence', 'eviter'];

// ============================================
// ARTEFACT DES SUGGESTIONS (lu sur le disque du serveur)
// ============================================

interface IndexSuggestion { rank: number; family: string; label: string; odds: number; oddsAt: string; p: number; ev: number; stakeFraction: number; stakeMode: 'kelly' | 'fixed'; reasons?: string[] }
interface IndexMatch {
  matchId: string; competition: string; date: string; home: string; away: string; status: string; kickoff?: string; oddsStale?: boolean; xg?: [number, number];
  profiles?: Partial<Record<Profile, { suggestions: IndexSuggestion[]; combo: unknown }>>;
}
interface FamilyBlock { bets: number; hitRate: number | null; returnFlat: number | null }
export interface SuggestionsIndexFile {
  generatedAt: string; season: string; bookmaker: string; matches: IndexMatch[];
  bilan?: { profiles?: Partial<Record<Profile, { byFamily?: Record<string, FamilyBlock> }>> } | null;
}

export type LoadIndex = () => SuggestionsIndexFile | null;

/** Lecture de l'artefact, relue seulement quand le fichier change (synchronisation des données toutes les 6 h) */
export function indexLoader(dataDir: string): LoadIndex {
  const file = path.join(dataDir, 'forecast', 'suggestions', 'index.json');
  let cached: { mtime: number; value: SuggestionsIndexFile } | null = null;
  return () => {
    try {
      const mtime = statSync(file).mtimeMs;
      if (!cached || cached.mtime !== mtime) cached = { mtime, value: JSON.parse(readFileSync(file, 'utf8')) as SuggestionsIndexFile };
      return cached.value;
    } catch {
      return null;
    }
  };
}

/** Suggestion telle que le modèle la reçoit : une référence stable `matchId#rang` et les chiffres du moteur */
export interface FactSuggestion { ref: string; label: string; family: string; odds: number; probability: number; expectedValue: number; stakeMode: 'kelly' | 'fixed'; reasons: string[] }
export interface MatchFacts {
  matchId: string; competition: string; kickoff: string; home: string; away: string;
  expectedGoals: [number, number] | null; oddsStale: boolean;
  suggestions: FactSuggestion[];
}
export interface PlanFacts {
  date: string; profile: Profile; bookmaker: string; season: string;
  matches: MatchFacts[];
  familyRecord: Record<string, FamilyBlock>;   // bilan du rejeu de la saison pour les familles présentes
}

const findMatch = (index: SuggestionsIndexFile, matchId: string) => index.matches.find(m => m.matchId === matchId && m.status === 'ok');

export function matchFacts(m: IndexMatch, profile: Profile): MatchFacts {
  const list = m.profiles?.[profile]?.suggestions ?? [];
  return {
    matchId: m.matchId, competition: m.competition, kickoff: m.kickoff ?? m.date, home: m.home, away: m.away,
    expectedGoals: m.xg ?? null, oddsStale: !!m.oddsStale,
    suggestions: list.map(s => ({
      ref: `${m.matchId}#${s.rank}`, label: s.label, family: s.family, odds: s.odds, probability: s.p, expectedValue: s.ev, stakeMode: s.stakeMode,
      reasons: (s.reasons ?? []).slice(0, 4),
    })),
  };
}

export function buildPlanFacts(index: SuggestionsIndexFile, matchIds: string[], profile: Profile, today: string): PlanFacts {
  const matches = matchIds.map(id => findMatch(index, id)).filter((m): m is IndexMatch => !!m).map(m => matchFacts(m, profile));
  const families = new Set(matches.flatMap(m => m.suggestions.map(s => s.family)));
  const byFamily = index.bilan?.profiles?.[profile]?.byFamily ?? {};
  const familyRecord = Object.fromEntries(Object.entries(byFamily).filter(([f]) => families.has(f)));
  return { date: today, profile, bookmaker: index.bookmaker, season: index.season, matches, familyRecord };
}

// ============================================
// APPELS GEMINI (injectés : testables sans réseau)
// ============================================

export interface Source { title: string; uri: string }
export interface GroundedGeneration extends Generation { sources: Source[]; queries: string[]; searchHtml?: string }
export type GenerateGrounded = (prompt: string) => Promise<GroundedGeneration>;
export type GenerateJson = (prompt: string, schema: Record<string, unknown>) => Promise<Generation>;

const TRANSIENT = new Set([429, 502, 503]);
const MAX_ATTEMPTS = 3;

/** Au plus 3 tentatives sur 429 (hors quota journalier), 502 et 503, délai court avec gigue */
export async function withRetry<T>(call: () => Promise<T>, sleep: (ms: number) => Promise<void> = ms => new Promise(r => setTimeout(r, ms))): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await call();
    } catch (error) {
      const status = errorStatus(error);
      const daily = /PerDay/.test(error instanceof Error ? error.message : String(error));
      if (attempt >= MAX_ATTEMPTS || status === undefined || !TRANSIENT.has(status) || daily) throw error;
      await sleep(600 * 2 ** (attempt - 1) + Math.random() * 600);
    }
  }
}

/** Métadonnées d'ancrage d'une réponse Gemini : sources (titre, lien), requêtes lancées, bloc de suggestions */
export function parseGrounding(metadata: unknown): Omit<GroundedGeneration, 'text' | 'modelVersion'> {
  const md = (metadata ?? {}) as { groundingChunks?: { web?: { uri?: unknown; title?: unknown } }[]; webSearchQueries?: unknown; searchEntryPoint?: { renderedContent?: unknown } };
  const seen = new Set<string>();
  const sources: Source[] = [];
  for (const c of md.groundingChunks ?? []) {
    const uri = typeof c.web?.uri === 'string' ? c.web.uri : '';
    const title = typeof c.web?.title === 'string' ? c.web.title.slice(0, 120) : '';
    if (!/^https:\/\//.test(uri) || !title || seen.has(title + uri)) continue;
    seen.add(title + uri);
    sources.push({ title, uri });
  }
  const queries = Array.isArray(md.webSearchQueries) ? md.webSearchQueries.filter((q): q is string => typeof q === 'string' && !!q.trim()).slice(0, 8) : [];
  const html = typeof md.searchEntryPoint?.renderedContent === 'string' ? md.searchEntryPoint.renderedContent : undefined;
  return { sources: sources.slice(0, 12), queries, ...(html && html.length < 50_000 ? { searchHtml: html } : {}) };
}

// ============================================
// 1. ACTUALITÉ D'AVANT-MATCH (ancrée Google Search)
// ============================================

export function buildNewsPrompt(m: MatchFacts, today: string): string {
  return `Today is ${today}. Football match: ${m.home} vs ${m.away} (${m.competition}), kickoff ${m.kickoff} (UTC).
Search the web for the latest pre-match team news about this exact match, published in the last 4 days:
- confirmed absences (injuries, suspensions) and doubtful players, for both teams;
- probable line-ups or rotation hints (for example a more important match a few days later);
- coach statements about availability, and notable context (weather, pitch, travel, stakes).
Rules: report only facts found in your search results, attributed to the team they concern; never guess a line-up; no prediction, no odds, no betting advice.
If the news found is older than 4 days or concerns another match, ignore it. If nothing reliable is found, write exactly "Aucune information fiable trouvée."
Answer in French with at most 8 short bullet points ("- "), most important first.`;
}

export interface NewsEntry { matchId: string; text: string; sources: Source[]; queries: string[]; searchHtml?: string; fetchedAt: string; model: string }

/** Cache de l'actualité par match (mémoire du processus) */
export class NewsCache {
  private entries = new Map<string, { at: number; value: NewsEntry }>();
  constructor(private ttl = NEWS_TTL_MS, private now: () => number = Date.now) {}
  get(matchId: string): { value: NewsEntry; age: number } | null {
    const e = this.entries.get(matchId);
    if (!e) return null;
    const age = this.now() - e.at;
    if (age > this.ttl) { this.entries.delete(matchId); return null; }
    return { value: e.value, age };
  }
  set(value: NewsEntry) { this.entries.set(value.matchId, { at: this.now(), value }); }
}

const NEWS_BULLETS = 8;
/** Texte de l'actualité : puces seulement, bornées en nombre et en longueur */
export function cleanNews(text: string): string {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.some(l => /^aucune information fiable/i.test(l.replace(/^[-*•]\s*/, '')))) return 'Aucune information fiable trouvée.';
  const bullets = lines.filter(l => /^[-*•]\s+/.test(l)).map(l => `- ${l.replace(/^[-*•]\s+/, '').replace(/\*\*/g, '').slice(0, 300)}`);
  return (bullets.length ? bullets : lines.slice(0, 3).map(l => `- ${l.slice(0, 300)}`)).slice(0, NEWS_BULLETS).join('\n');
}

export interface BettingDeps {
  apiKey: string | undefined;
  model?: string;
  loadIndex: LoadIndex;
  generateGrounded: GenerateGrounded;
  generateJson: GenerateJson;
  news: NewsCache;
  now?: () => Date;
  log?: (message: string) => void;
  sleep?: (ms: number) => Promise<void>;
}

export interface BettingResult { status: number; body: Record<string, unknown> }

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const MATCH_ID = /^[A-Za-z0-9_-]{1,40}$/;
const notConfigured = (): BettingResult => ({ status: 503, body: { error: 'Assistant IA indisponible : GEMINI_API_KEY n\'est pas configurée sur le serveur.' } });
const noIndex = (): BettingResult => ({ status: 503, body: { error: 'Suggestions de paris non publiées sur ce serveur.' } });
const today = (d: Date) => d.toISOString().slice(0, 10);

export async function handleBettingNews(body: unknown, deps: BettingDeps): Promise<BettingResult> {
  if (!deps.apiKey) return notConfigured();
  if (!isObject(body) || typeof body.matchId !== 'string' || !MATCH_ID.test(body.matchId)) return { status: 400, body: { error: 'Identifiant de match invalide.' } };
  const index = deps.loadIndex();
  if (!index) return noIndex();
  const m = findMatch(index, body.matchId);
  if (!m) return { status: 404, body: { error: 'Match absent des suggestions du jour.' } };

  const cached = deps.news.get(m.matchId);
  const refresh = body.refresh === true;
  if (cached && (!refresh || cached.age < NEWS_REFRESH_MIN_MS)) return { status: 200, body: { ...cached.value, cached: true, promptVersion: BETTING_PROMPT_VERSIONS.news } };

  const now = deps.now?.() ?? new Date();
  const facts = matchFacts(m, 'equilibre');
  try {
    const g = await withRetry(() => deps.generateGrounded(buildNewsPrompt(facts, today(now))), deps.sleep);
    if (!g.text.trim()) return { status: 502, body: { error: 'Le modèle n\'a renvoyé aucune actualité. Réessayez.' } };
    const entry: NewsEntry = {
      matchId: m.matchId, text: cleanNews(g.text), sources: g.sources, queries: g.queries, ...(g.searchHtml ? { searchHtml: g.searchHtml } : {}),
      fetchedAt: now.toISOString(), model: g.modelVersion?.trim() || resolveGeminiModel(deps.model),
    };
    deps.news.set(entry);
    deps.log?.(`[betting-news] ${m.matchId} : ${entry.sources.length} source(s), ${entry.queries.length} requête(s)`);
    return { status: 200, body: { ...entry, cached: false, promptVersion: BETTING_PROMPT_VERSIONS.news } };
  } catch (error) {
    deps.log?.(`[betting-news] échec : ${redact(error instanceof Error ? error.message : String(error), deps.apiKey)}`);
    return { status: 502, body: { error: 'Recherche d\'actualité indisponible pour le moment. Réessayez dans quelques instants.' } };
  }
}

// ============================================
// 2. PLAN DU JOUR (JSON strict, validé)
// ============================================

/** Schéma JSON imposé à la réponse (responseJsonSchema) */
export const PLAN_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'Synthèse du jour en 3 phrases au plus, en français.' },
    matches: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          matchId: { type: 'string' },
          verdicts: {
            type: 'array',
            items: {
              type: 'object',
              properties: { ref: { type: 'string' }, verdict: { type: 'string', enum: VERDICTS }, reason: { type: 'string' } },
              required: ['ref', 'verdict', 'reason'],
            },
          },
        },
        required: ['matchId', 'verdicts'],
      },
    },
    picks: { type: 'array', items: { type: 'object', properties: { ref: { type: 'string' }, why: { type: 'string' } }, required: ['ref', 'why'] } },
    combo: { type: 'object', properties: { refs: { type: 'array', items: { type: 'string' } }, why: { type: 'string' } }, required: ['refs', 'why'] },
    avoid: { type: 'array', items: { type: 'object', properties: { matchId: { type: 'string' }, why: { type: 'string' } }, required: ['matchId', 'why'] } },
    discipline: { type: 'string', description: 'Une phrase de discipline de mise, en français.' },
  },
  required: ['summary', 'matches', 'picks', 'combo', 'avoid', 'discipline'],
};

export function buildPlanPrompt(facts: PlanFacts, news: Record<string, string>): string {
  return `You are the decision assistant of the ScoutVision betting lab. Write every text field in French.
The statistical engine already computed, for each match, a few bet suggestions (profile "${facts.profile}") with its own probability, the bookmaker odds (${facts.bookmaker}) and the expected value. The engine knows team strength in expected goals, recent form at home/away and head-to-head; it does NOT know team news (absences, doubts, rotation).
Your job: confront each suggestion with the pre-match news below, then build a short plan for the day.

Hard rules:
- Only use suggestions listed in the facts, referenced by their "ref". Never invent a bet, a market, a line or a match.
- Never compute, estimate or change a probability, odds, expected value or stake. Write only numbers that appear in the facts or in the news.
- Verdict per suggestion: "garder" when nothing in the news contradicts it; "prudence" when the news adds an uncertainty the engine cannot see (key absence that concerns this market, probable rotation, unclear line-up, news missing); "eviter" when the news directly undermines the selection. Each reason is one sentence that cites the news item (or says that no news was found).
- Be humble: over the season the bookmaker odds were better calibrated than the engine in every bet family, and "familyRecord" gives the replayed record of each family; a large expected value is more often an engine error than a bargain. Prefer fewer, safer picks.
- "picks": at most ${MAX_PICKS} refs among suggestions you kept ("garder" or "prudence"), best first, one sentence each. "combo": 2 or 3 refs from different matches, all "garder", or an empty refs list. "avoid": matches to skip today, with the reason.
- "discipline": one sentence on stake discipline (stakes stay those of the engine, never chase losses).

**FACTS (JSON) — engine output:**
${JSON.stringify(facts, null, 1)}

**PRE-MATCH NEWS (web search, per matchId):**
${facts.matches.map(m => `[${m.matchId}] ${m.home} – ${m.away}\n${news[m.matchId] ?? 'Actualité non recherchée.'}`).join('\n\n')}`;
}

export interface PlanPick { ref: string; matchId: string; match: string; label: string; family: string; odds: number; probability: number; expectedValue: number; stakeFraction: number; stakeMode: 'kelly' | 'fixed'; verdict: Verdict; why: string }
export interface PlanResponse {
  summary: string;
  matches: { matchId: string; match: string; kickoff: string; news: NewsEntry | null; verdicts: { ref: string; label: string; verdict: Verdict | 'non_evalue'; reason: string }[] }[];
  picks: PlanPick[];
  combo: { refs: string[]; labels: string[]; why: string } | null;
  avoid: { matchId: string; match: string; why: string }[];
  discipline: string;
  warnings: string[];
}

/** Retire d'un texte les phrases qui citent un nombre absent des faits et de l'actualité */
export function auditText(text: unknown, allowed: number[]): { text: string; removed: number } {
  if (typeof text !== 'string') return { text: '', removed: 0 };
  const sentences = text.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT).split(/(?<=[.!?])\s+/);
  const kept = sentences.filter(s => (s.match(NUMBER) ?? []).every(n => supported(n, allowed)));
  return { text: kept.join(' ').trim(), removed: sentences.length - kept.length };
}

/** Valide la réponse du modèle contre les faits : références, verdicts, contraintes du plan, nombres */
export function validatePlan(raw: unknown, facts: PlanFacts, news: Record<string, NewsEntry | undefined>, index: SuggestionsIndexFile): PlanResponse {
  const warnings: string[] = [];
  const allowed = [...factNumbers(facts), ...factNumbers(Object.values(news).map(n => n?.text ?? '')), ...factNumbers(facts.date)];
  let removed = 0;
  const say = (t: unknown) => { const r = auditText(t, allowed); removed += r.removed; return r.text; };
  const plan = isObject(raw) ? raw : {};
  const byRef = new Map<string, { s: FactSuggestion; m: MatchFacts }>();
  facts.matches.forEach(m => m.suggestions.forEach(s => byRef.set(s.ref, { s, m })));
  const matchName = (m: MatchFacts) => `${m.home} – ${m.away}`;

  // Verdicts : un par suggestion ; une suggestion sans verdict valide reste « non évaluée »
  const verdictOf = new Map<string, { verdict: Verdict; reason: string }>();
  for (const pm of Array.isArray(plan.matches) ? plan.matches : []) {
    if (!isObject(pm) || !Array.isArray(pm.verdicts)) continue;
    for (const v of pm.verdicts) {
      if (!isObject(v) || typeof v.ref !== 'string' || !byRef.has(v.ref) || verdictOf.has(v.ref)) continue;
      if (!VERDICTS.includes(v.verdict as Verdict)) continue;
      verdictOf.set(v.ref, { verdict: v.verdict as Verdict, reason: say(v.reason) });
    }
  }
  const missing = [...byRef.keys()].filter(r => !verdictOf.has(r)).length;
  if (missing) warnings.push(`${missing} suggestion(s) sans avis de l'IA.`);

  // Sélection : suggestions gardées ou à prendre avec prudence, sans doublon, bornée
  const fractionOf = (ref: string) => {
    const { m } = byRef.get(ref)!;
    const rank = Number(ref.split('#')[1]);
    return index.matches.find(x => x.matchId === m.matchId)?.profiles?.[facts.profile]?.suggestions.find(s => s.rank === rank)?.stakeFraction ?? 0;
  };
  const picks: PlanPick[] = [];
  for (const p of Array.isArray(plan.picks) ? plan.picks : []) {
    if (picks.length >= MAX_PICKS || !isObject(p) || typeof p.ref !== 'string' || !byRef.has(p.ref) || picks.some(x => x.ref === p.ref)) continue;
    const v = verdictOf.get(p.ref);
    if (!v || v.verdict === 'eviter') continue;
    const { s, m } = byRef.get(p.ref)!;
    picks.push({ ref: s.ref, matchId: m.matchId, match: matchName(m), label: s.label, family: s.family, odds: s.odds, probability: s.probability, expectedValue: s.expectedValue,
      stakeFraction: fractionOf(s.ref), stakeMode: s.stakeMode, verdict: v.verdict, why: say(p.why) });
  }

  // Combiné : 2 ou 3 suggestions « garder » de matchs différents, sinon aucun
  let combo: PlanResponse['combo'] = null;
  if (isObject(plan.combo) && Array.isArray(plan.combo.refs)) {
    const refs = [...new Set(plan.combo.refs.filter((r): r is string => typeof r === 'string'))];
    const matches = new Set(refs.map(r => byRef.get(r)?.m.matchId));
    const ok = refs.length >= 2 && refs.length <= 3 && refs.every(r => byRef.has(r) && verdictOf.get(r)?.verdict === 'garder') && matches.size === refs.length;
    if (ok) combo = { refs, labels: refs.map(r => `${matchName(byRef.get(r)!.m)} : ${byRef.get(r)!.s.label}`), why: say(plan.combo.why) };
    else if (refs.length) warnings.push('Combiné proposé écarté (sélections non gardées, en double ou d\'un même match).');
  }

  const known = new Map(facts.matches.map(m => [m.matchId, m]));
  const avoid = (Array.isArray(plan.avoid) ? plan.avoid : [])
    .filter((a): a is Record<string, unknown> => isObject(a) && typeof a.matchId === 'string' && known.has(a.matchId))
    .filter((a, i, all) => all.findIndex(b => b.matchId === a.matchId) === i)
    .map(a => ({ matchId: a.matchId as string, match: matchName(known.get(a.matchId as string)!), why: say(a.why) }));

  const response: PlanResponse = {
    summary: say(plan.summary),
    matches: facts.matches.map(m => ({
      matchId: m.matchId, match: matchName(m), kickoff: m.kickoff, news: news[m.matchId] ?? null,
      verdicts: m.suggestions.map(s => ({ ref: s.ref, label: s.label, verdict: verdictOf.get(s.ref)?.verdict ?? 'non_evalue', reason: verdictOf.get(s.ref)?.reason ?? '' })),
    })),
    picks, combo, avoid,
    discipline: say(plan.discipline),
    warnings,
  };
  if (removed) warnings.push(`${removed} phrase(s) retirée(s) : nombre absent des données du moteur et de l'actualité.`);
  return response;
}

export async function handleBettingPlan(body: unknown, deps: BettingDeps): Promise<BettingResult> {
  if (!deps.apiKey) return notConfigured();
  if (!isObject(body) || !Array.isArray(body.matchIds)) return { status: 400, body: { error: 'Champ « matchIds » manquant.' } };
  const ids = [...new Set(body.matchIds)].filter((id): id is string => typeof id === 'string' && MATCH_ID.test(id));
  if (!ids.length || ids.length > MAX_PLAN_MATCHES) return { status: 400, body: { error: `Entre 1 et ${MAX_PLAN_MATCHES} matchs attendus.` } };
  const profile: Profile = PROFILES.includes(body.profile as Profile) ? body.profile as Profile : 'equilibre';
  const index = deps.loadIndex();
  if (!index) return noIndex();

  const now = deps.now?.() ?? new Date();
  const facts = buildPlanFacts(index, ids, profile, today(now));
  if (!facts.matches.length) return { status: 404, body: { error: 'Aucun de ces matchs n\'a de suggestions publiées.' } };
  if (!facts.matches.some(m => m.suggestions.length)) return { status: 422, body: { error: 'Aucune suggestion admissible pour ce profil sur ces matchs.' } };
  const news: Record<string, NewsEntry | undefined> = Object.fromEntries(facts.matches.map(m => [m.matchId, deps.news.get(m.matchId)?.value]));
  const newsText = Object.fromEntries(Object.entries(news).filter(([, n]) => n).map(([id, n]) => [id, n!.text]));

  try {
    const g = await withRetry(() => deps.generateJson(buildPlanPrompt(facts, newsText), PLAN_SCHEMA), deps.sleep);
    let raw: unknown;
    try { raw = JSON.parse(g.text); } catch { return { status: 502, body: { error: 'Réponse du modèle illisible. Réessayez.' } }; }
    const plan = validatePlan(raw, facts, news, index);
    const withoutNews = facts.matches.filter(m => !news[m.matchId]).length;
    if (withoutNews) plan.warnings.unshift(`${withoutNews} match(s) sans actualité recherchée : avis fondé sur les seules données du moteur.`);
    deps.log?.(`[betting-plan] ${facts.matches.length} match(s), ${plan.picks.length} sélection(s), ${plan.warnings.length} avertissement(s)`);
    return {
      status: 200,
      body: {
        ...plan, profile,
        meta: { model: g.modelVersion?.trim() || resolveGeminiModel(deps.model), requestedModel: resolveGeminiModel(deps.model), generatedAt: now.toISOString(), suggestionsAt: index.generatedAt },
        promptVersion: BETTING_PROMPT_VERSIONS.plan,
      },
    };
  } catch (error) {
    deps.log?.(`[betting-plan] échec : ${redact(error instanceof Error ? error.message : String(error), deps.apiKey)}`);
    return { status: 502, body: { error: 'Le service de génération est indisponible pour le moment. Réessayez dans quelques instants.' } };
  }
}
