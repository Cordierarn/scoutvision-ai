/**
 * ScoutVision - IA ancrée, côté serveur : trois tâches sur le même garde-fou que /api/scout-report
 *
 * - compare : synthèse comparative de recrutement (joueurs comparés, ou candidat face au titulaire) ;
 * - opposition : briefing d'opposition à partir des faits d'équipe déjà calculés par ScoutVision ;
 * - hunter : traduction d'une demande en langage naturel vers une configuration du Chasseur de
 *   pépites (JSON strict validé contre le catalogue ; le modèle ne calcule aucun score).
 *
 * Même contrat que le rapport : la clé Gemini ne quitte jamais le serveur, le serveur construit
 * le prompt (jamais un proxy ouvert), les faits sont validés et bornés, le texte est audité
 * (nombres absents des faits, sujets non mesurés, verdicts) puis corrigé ou nettoyé, et la
 * réponse renvoie le modèle réellement utilisé, les faits exacts transmis et la version du prompt.
 */

import { NUMBER, TOPIC_RULES, factNumbers, stripNumbering, supported } from './reportAudit';
import { PlayerRow, ReportFacts, buildCorrectionPrompt, buildReportFacts } from './reportFacts';
import { Generation, HandlerDeps, ReportMeta, generateWithRetry, redact, resolveGeminiModel } from './scoutReport';

export type AiTask = 'compare' | 'opposition' | 'hunter';
export const AI_TASKS: AiTask[] = ['compare', 'opposition', 'hunter'];

/** Versions de prompt, constantes explicites (jamais dérivées d'une date) */
export const AI_PROMPT_VERSIONS: Record<AiTask, string> = { compare: 'ai-compare-v1', opposition: 'ai-opposition-v1', hunter: 'ai-hunter-v1' };

// ============================================
// LIMITES ET NETTOYAGE GÉNÉRIQUE DES FAITS
// ============================================

const MAX_DEPTH = 6, MAX_KEYS = 200, MAX_ITEMS = 300, MAX_STRING = 300, MAX_NODES = 6000, MAX_KEY = 120;
const MAX_PLAYERS = 4, MAX_QUERY = 500;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Valeur JSON bornée (profondeur, tailles, chaînes) ; lève sur dépassement. Ne garde que chaînes, nombres finis, booléens, null */
export function cleanFacts(value: unknown, budget = { nodes: 0 }, depth = 0): unknown {
  if (++budget.nodes > MAX_NODES) throw new Error('faits trop volumineux');
  if (depth > MAX_DEPTH) throw new Error('faits trop profonds');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw new Error('nombre invalide'); return value; }
  if (typeof value === 'string') { if (value.length > MAX_STRING) throw new Error('chaîne trop longue'); return value; }
  if (Array.isArray(value)) { if (value.length > MAX_ITEMS) throw new Error('liste trop longue'); return value.map(v => cleanFacts(v, budget, depth + 1)); }
  if (isObject(value)) {
    const entries = Object.entries(value);
    if (entries.length > MAX_KEYS) throw new Error('objet trop large');
    const out: Record<string, unknown> = {};
    for (const [k, v] of entries) {
      if (!k || k.length > MAX_KEY) throw new Error('clé invalide');
      if (v === undefined) continue;
      out[k] = cleanFacts(v, budget, depth + 1);
    }
    return out;
  }
  throw new Error('valeur non prise en charge');
}

type Validation<T> = { ok: true; value: T } | { ok: false; error: string };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
// Garde de type : le discriminant `ok` suffit, mais TypeScript a besoin de la forme explicite
const failed = <T,>(v: Validation<T>): v is { ok: false; error: string } => !v.ok;

// ============================================
// COMPARE
// ============================================

export interface CompareRequest {
  players: { row: PlayerRow; bestRoles?: { role: string; normalizedScore: number }[] }[];
  framing: 'comparison' | 'candidate_vs_incumbent';   // candidat face au titulaire : le premier joueur est le titulaire
  role?: string;
  seasonInProgress?: boolean;
}

export interface CompareFacts {
  framing: CompareRequest['framing'];
  role?: string;
  players: ReportFacts[];
}

function cleanRow(raw: unknown): PlayerRow | null {
  if (!isObject(raw)) return null;
  const entries = Object.entries(raw);
  if (!entries.length || entries.length > 1500) return null;
  const out: PlayerRow = {};
  for (const [k, v] of entries) {
    if (!k || k.length > MAX_KEY) return null;
    if (v === null || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) out[k] = v as never;
    else if (typeof v === 'string') { if (v.length > MAX_STRING) return null; out[k] = v; }
    else return null;
  }
  if (typeof out.Player !== 'string' || !out.Player.trim()) return null;
  return out;
}

export function validateCompare(body: unknown): Validation<CompareRequest> {
  if (!isObject(body) || !Array.isArray(body.players)) return fail('Champ « players » manquant.');
  if (body.players.length < 2 || body.players.length > MAX_PLAYERS) return fail(`Entre 2 et ${MAX_PLAYERS} joueurs attendus.`);
  const players: CompareRequest['players'] = [];
  for (const p of body.players) {
    if (!isObject(p)) return fail('Joueur invalide.');
    const row = cleanRow(p.row);
    if (!row) return fail('Ligne joueur invalide.');
    const bestRoles = Array.isArray(p.bestRoles)
      ? p.bestRoles.slice(0, 10).flatMap(r => (isObject(r) && typeof r.role === 'string' && r.role.length <= 80 && typeof r.normalizedScore === 'number' && Number.isFinite(r.normalizedScore) ? [{ role: r.role, normalizedScore: r.normalizedScore }] : []))
      : undefined;
    players.push({ row, ...(bestRoles ? { bestRoles } : {}) });
  }
  const framing = body.framing === 'candidate_vs_incumbent' ? 'candidate_vs_incumbent' : 'comparison';
  const role = typeof body.role === 'string' && body.role.length <= 80 ? body.role : undefined;
  const seasonInProgress = typeof body.seasonInProgress === 'boolean' ? body.seasonInProgress : undefined;
  return { ok: true, value: { players, framing, ...(role ? { role } : {}), ...(seasonInProgress !== undefined ? { seasonInProgress } : {}) } };
}

export function buildCompareFacts(req: CompareRequest): CompareFacts {
  return { framing: req.framing, ...(req.role ? { role: req.role } : {}), players: req.players.map(p => buildReportFacts(p.row, { bestRoles: p.bestRoles, seasonInProgress: req.seasonInProgress })) };
}

const COMMON_RULES = `You never create a new analysis, a new metric, a transfer price, an injury or fitness claim, a personality trait, or a recruitment verdict.
Write the entire text in French (headings included), numbers in French format (decimal comma, "M€").
Use only numbers that appear in the JSON facts; never compute, convert, sum, average or round a number.
Percentiles (0-100) rank a volume among players of the same position group, competition level and season; metrics flagged "lessIsPreferable" read the other way (a high percentile is a statistical limit).
Role indices (0-100) are weighted composites of percentiles, not percentiles, not a rating of ability.
"values.marketValueTransfermarkt" is the market value published by Transfermarkt; "values.estimatedValueScoutVision" is a statistical estimate, never a price.
If a fact is absent, say nothing about it (never write that it is missing).
No verdict, no "sign him", no "better player" claim: describe differences and what to verify.`;

export function buildComparePrompt(facts: CompareFacts): string {
  const framing = facts.framing === 'candidate_vs_incumbent'
    ? 'The first player is the current starter (titulaire) of the target team; the others are candidates. Compare each candidate with the starter.'
    : 'Compare the players with each other.';
  return `You are writing the comparative synthesis section of a ScoutVision recruitment dossier.
${framing}${facts.role ? ` The role under study is "${facts.role}".` : ''}
${COMMON_RULES}

**SCOUTVISION FACTS (JSON) — your only source:**
${JSON.stringify(facts, null, 2)}

Write at most 350 words with exactly these four headings:
### 1. Profils en présence
### 2. Principales différences
### 3. Complémentarité et contexte
### 4. Points à vérifier en observation
Each section: 2 to 5 bullet points, each tied to a fact (metric name and percentile, role index, value or sample).`;
}

// ============================================
// OPPOSITION
// ============================================

export interface OppositionFacts {
  team: Record<string, unknown>;
  [key: string]: unknown;
}

export function validateOpposition(body: unknown): Validation<OppositionFacts> {
  if (!isObject(body) || !isObject(body.team) || typeof body.team.name !== 'string') return fail('Champ « team » manquant.');
  try { return { ok: true, value: cleanFacts(body) as OppositionFacts }; } catch (e) { return fail(`Faits d'équipe invalides : ${e instanceof Error ? e.message : 'erreur'}.`); }
}

export function buildOppositionPrompt(facts: OppositionFacts): string {
  return `You are writing an opposition briefing for a ScoutVision coaching staff, about the team described in the facts.
${COMMON_RULES}
Team-level facts describe the team, not individual players; player lines are listed as facts only.
Ranks ("rank" of "of") are positions among the teams of the same competition and season.

**SCOUTVISION FACTS (JSON) — your only source:**
${JSON.stringify(facts, null, 2)}

Write at most 350 words with exactly these four headings:
### 1. Identité et résultats
### 2. Style et tendances
### 3. Forces et vulnérabilités statistiques
### 4. Points à préparer
Each section: 2 to 5 bullet points tied to a fact (metric, value, rank, formation, scorer).`;
}

// ============================================
// HUNTER (langage naturel → configuration du Chasseur)
// ============================================

export interface HunterCatalogue {
  positions: string[];
  roles: { name: string; positions: string[]; category?: string; description?: string }[];
  metrics: { key: string; label: string }[];
  competitions: { key: string; name: string }[];
  capabilities: { marketValue: boolean; contract: boolean; estimate: boolean };
}

export interface HunterRequest { query: string; catalogue: HunterCatalogue }

/** Configuration proposée ; chaque champ est vérifié contre le catalogue, les autres sont écartés */
export interface HunterConfig {
  position?: string;
  role?: string;
  ageMax?: number;
  minutesMin?: number;
  valueMax?: number | null;
  contractMonths?: number;
  estimateAboveMarket?: boolean;
  competition?: string;
  extraCriteria: { metric: string; minPercentile: number }[];
  explanation: string;          // phrase du modèle, affichée telle quelle avec sa provenance
}

export function validateHunter(body: unknown): Validation<HunterRequest> {
  if (!isObject(body) || typeof body.query !== 'string') return fail('Champ « query » manquant.');
  const query = body.query.trim();
  if (!query || query.length > MAX_QUERY) return fail(`Demande vide ou trop longue (${MAX_QUERY} caractères au plus).`);
  const c = body.catalogue;
  if (!isObject(c) || !Array.isArray(c.positions) || !Array.isArray(c.roles) || !Array.isArray(c.metrics) || !Array.isArray(c.competitions) || !isObject(c.capabilities)) return fail('Catalogue invalide.');
  try {
    const catalogue = cleanFacts(c) as unknown as HunterCatalogue;
    if (catalogue.positions.some(p => typeof p !== 'string') || catalogue.roles.some(r => !isObject(r) || typeof r.name !== 'string' || !Array.isArray(r.positions))
      || catalogue.metrics.some(m => !isObject(m) || typeof m.key !== 'string') || catalogue.competitions.some(x => !isObject(x) || typeof x.key !== 'string')) return fail('Catalogue invalide.');
    return { ok: true, value: { query, catalogue } };
  } catch (e) { return fail(`Catalogue invalide : ${e instanceof Error ? e.message : 'erreur'}.`); }
}

export function buildHunterPrompt(req: HunterRequest): string {
  const { catalogue } = req;
  return `You translate a scout's request, written in natural language, into a configuration of the ScoutVision "Chasseur de pépites" (player filter).
You do not evaluate players and you compute nothing: you only choose filter values from the catalogue below.
Answer with a single JSON object and nothing else (no prose, no code fence), with this exact shape:
{"position": string|null, "role": string|null, "ageMax": number|null, "minutesMin": number|null, "valueMax": number|null, "contractMonths": number|null, "estimateAboveMarket": boolean|null, "competition": string|null, "extraCriteria": [{"metric": string, "minPercentile": number}], "explanation": string}
Rules:
- "position" must be one of the catalogue positions, "role" one of the catalogue roles compatible with that position; null when the request does not say.
- "ageMax" is an age in years, "minutesMin" minutes played, "valueMax" a market value in euros (e.g. 15000000 for 15 M€), "contractMonths" months left on the contract (0 = any), "competition" a catalogue competition key.
- "estimateAboveMarket": true only if the request asks for undervalued players (statistical estimate above the market value).
- "extraCriteria": metrics from the catalogue (use the "key") with a minimum percentile 0-100, only when the request names a quality that a listed metric measures. Never invent metrics.
- Market value, contract and estimate filters are available only if the capabilities say so; otherwise leave them null.
- "explanation": one French sentence (max 200 characters) saying how the request was translated, mentioning what could not be translated.

Catalogue:
${JSON.stringify(catalogue)}

Request: ${JSON.stringify(req.query)}`;
}

/** Extrait l'objet JSON d'une réponse (tolère une clôture de code) ; null si illisible */
export function extractJson(text: string): Record<string, unknown> | null {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const start = trimmed.indexOf('{'), end = trimmed.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { const v = JSON.parse(trimmed.slice(start, end + 1)); return isObject(v) ? v : null; } catch { return null; }
}

/** Configuration validée contre le catalogue : tout champ hors catalogue ou hors plage est écarté et signalé */
export function validateHunterConfig(raw: Record<string, unknown>, catalogue: HunterCatalogue): { config: HunterConfig; warnings: string[] } {
  const warnings: string[] = [];
  const config: HunterConfig = { extraCriteria: [], explanation: '' };
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  if (typeof raw.position === 'string') {
    if (catalogue.positions.includes(raw.position)) config.position = raw.position; else warnings.push(`poste inconnu « ${raw.position.slice(0, 20)} »`);
  }
  if (typeof raw.role === 'string') {
    const role = catalogue.roles.find(r => r.name === raw.role);
    if (!role) warnings.push(`rôle inconnu « ${raw.role.slice(0, 40)} »`);
    else if (config.position && !role.positions.includes(config.position)) warnings.push(`rôle « ${role.name} » incompatible avec le poste ${config.position}`);
    else { config.role = role.name; if (!config.position) config.position = role.positions[0]; }
  }
  const age = num(raw.ageMax); if (age !== undefined) { if (age >= 15 && age <= 45) config.ageMax = Math.round(age); else warnings.push('âge maximum hors plage'); }
  const minutes = num(raw.minutesMin); if (minutes !== undefined) { if (minutes >= 0 && minutes <= 5000) config.minutesMin = Math.round(minutes); else warnings.push('minutes hors plage'); }
  const value = raw.valueMax === null ? null : num(raw.valueMax);
  if (value !== undefined) {
    if (!catalogue.capabilities.marketValue) warnings.push('valeur de marché indisponible dans la saison chargée');
    else if (value === null || (value >= 0 && value <= 500_000_000)) config.valueMax = value; else warnings.push('valeur maximale hors plage');
  }
  const months = num(raw.contractMonths); if (months !== undefined) { if (!catalogue.capabilities.contract) warnings.push('fin de contrat indisponible dans la saison chargée'); else if (months >= 0 && months <= 60) config.contractMonths = Math.round(months); else warnings.push('fin de contrat hors plage'); }
  if (typeof raw.estimateAboveMarket === 'boolean') { if (catalogue.capabilities.estimate) config.estimateAboveMarket = raw.estimateAboveMarket; else if (raw.estimateAboveMarket) warnings.push('estimation statistique indisponible dans la saison chargée'); }
  if (typeof raw.competition === 'string') { if (catalogue.competitions.some(c => c.key === raw.competition)) config.competition = raw.competition; else warnings.push(`compétition inconnue « ${raw.competition.slice(0, 20)} »`); }
  if (Array.isArray(raw.extraCriteria)) {
    for (const c of raw.extraCriteria.slice(0, 8)) {
      if (!isObject(c) || typeof c.metric !== 'string') continue;
      const p = num(c.minPercentile);
      if (!catalogue.metrics.some(m => m.key === c.metric)) { warnings.push(`métrique inconnue « ${c.metric.slice(0, 40)} »`); continue; }
      if (p === undefined || p < 0 || p > 100) { warnings.push(`percentile invalide pour ${c.metric}`); continue; }
      config.extraCriteria.push({ metric: c.metric, minPercentile: Math.round(p) });
    }
  }
  config.explanation = typeof raw.explanation === 'string' ? raw.explanation.slice(0, 200) : '';
  return { config, warnings };
}

// ============================================
// AUDIT GÉNÉRIQUE D'UN TEXTE ANCRÉ
// ============================================

export interface TextIssue { kind: 'topic' | 'number' | 'heading'; rule: string }

/** Problèmes vérifiables d'un texte au regard des faits : sujets non mesurés, nombres absents, titres manquants */
export function auditGroundedText(text: string, facts: unknown, headings: string[]): TextIssue[] {
  const issues: TextIssue[] = [];
  const names = JSON.stringify(facts);
  for (const t of TOPIC_RULES) {
    if (t.unlessMetric && t.unlessMetric.test(names)) continue;
    if (t.pattern.test(text)) issues.push({ kind: 'topic', rule: t.rule });
  }
  const allowed = factNumbers(facts);
  const unsupported = new Set<string>();
  for (const line of text.split('\n')) for (const m of stripNumbering(line).match(NUMBER) ?? []) if (!supported(m, allowed)) unsupported.add(m.trim());
  if (unsupported.size) issues.push({ kind: 'number', rule: `numbers absent from the data (do not compute or invent numbers): ${[...unsupported].join(', ')}` });
  const missing = headings.filter(h => !text.toLocaleLowerCase('fr').includes(h.toLocaleLowerCase('fr')));
  if (missing.length) issues.push({ kind: 'heading', rule: `missing headings: ${missing.join(', ')}` });
  return issues;
}

/** Retire les phrases encore fautives (sujets, nombres) ; les titres ne sont pas réécrits */
export function sanitizeGroundedText(text: string, facts: unknown, issues: TextIssue[]): string {
  const names = JSON.stringify(facts);
  const rules = TOPIC_RULES.filter(t => !(t.unlessMetric && t.unlessMetric.test(names)) && issues.some(i => i.rule === t.rule));
  const allowed = factNumbers(facts);
  const checkNumbers = issues.some(i => i.kind === 'number');
  const bad = (s: string) => rules.some(t => t.pattern.test(s)) || (checkNumbers && (stripNumbering(s).match(NUMBER) ?? []).some(m => !supported(m, allowed)));
  return text.split('\n').flatMap(line => {
    if (/^\s*#/.test(line) || !bad(line)) return [line];
    const prefix = line.match(/^\s*(?:[-*]\s+)?(?:\*\*[^*]+\*\*\s*:?\s*)?/)?.[0] ?? '';
    const kept = line.slice(prefix.length).split(/(?<=[.!?])\s+/).filter(x => !bad(x)).join(' ').trim();
    return kept ? [`${prefix}${kept}`] : [];
  }).join('\n');
}

// ============================================
// HANDLER
// ============================================

export interface AiTextResponse { content: string; meta: ReportMeta; facts: unknown; promptVersion: string }
export interface AiHunterResponse { config: HunterConfig; warnings: string[]; meta: ReportMeta; facts: unknown; promptVersion: string }
export interface AiResult { status: number; body: AiTextResponse | AiHunterResponse | { error: string } }

const COMPARE_HEADINGS = ['Profils en présence', 'Principales différences', 'Complémentarité et contexte', 'Points à vérifier en observation'];
const OPPOSITION_HEADINGS = ['Identité et résultats', 'Style et tendances', 'Forces et vulnérabilités statistiques', 'Points à préparer'];

export async function handleGroundedAi(task: AiTask, body: unknown, deps: HandlerDeps): Promise<AiResult> {
  if (!deps.apiKey) return { status: 503, body: { error: 'Fonctions IA indisponibles : GEMINI_API_KEY n\'est pas configurée sur le serveur.' } };
  if (!AI_TASKS.includes(task)) return { status: 404, body: { error: 'Tâche IA inconnue.' } };
  const requestedModel = resolveGeminiModel(deps.model);
  const meta = (g: Generation): ReportMeta => ({ model: g.modelVersion?.trim() || requestedModel, requestedModel, generatedAt: (deps.now?.() ?? new Date()).toISOString() });
  const log = (m: string) => deps.log?.(`[ai-${task}] ${m}`);

  try {
    if (task === 'hunter') {
      const parsed = validateHunter(body);
      if (failed(parsed)) return { status: 400, body: { error: parsed.error } };
      const prompt = buildHunterPrompt(parsed.value);
      let generation = await generateWithRetry(deps.generate, prompt, deps);
      let raw = extractJson(generation.text);
      if (!raw) {
        log('réponse non JSON : nouvelle tentative');
        generation = await generateWithRetry(deps.generate, `${prompt}\n\nYour previous answer was not a single JSON object. Answer again with the JSON object only.`, deps);
        raw = extractJson(generation.text);
        if (!raw) return { status: 502, body: { error: 'Le modèle n\'a pas renvoyé une configuration lisible. Réessayez ou reformulez.' } };
      }
      const { config, warnings } = validateHunterConfig(raw, parsed.value.catalogue);
      // La phrase d'explication ne doit citer que des nombres de la demande ou de la configuration
      const explanationIssues = auditGroundedText(config.explanation, { query: parsed.value.query, config }, []).filter(i => i.kind === 'number');
      if (explanationIssues.length) config.explanation = sanitizeGroundedText(config.explanation, { query: parsed.value.query, config }, explanationIssues);
      return { status: 200, body: { config, warnings, meta: meta(generation), facts: { query: parsed.value.query }, promptVersion: AI_PROMPT_VERSIONS.hunter } };
    }

    let facts: unknown, prompt: string, headings: string[];
    if (task === 'compare') {
      const parsed = validateCompare(body);
      if (failed(parsed)) return { status: 400, body: { error: parsed.error } };
      const f = buildCompareFacts(parsed.value); facts = f; prompt = buildComparePrompt(f); headings = COMPARE_HEADINGS;
    } else {
      const parsed = validateOpposition(body);
      if (failed(parsed)) return { status: 400, body: { error: parsed.error } };
      facts = parsed.value; prompt = buildOppositionPrompt(parsed.value); headings = OPPOSITION_HEADINGS;
    }
    let generation = await generateWithRetry(deps.generate, prompt, deps);
    if (!generation.text.trim()) return { status: 502, body: { error: 'Le modèle n\'a renvoyé aucun texte. Réessayez.' } };
    let issues = auditGroundedText(generation.text, facts, headings);
    if (issues.length) {
      log(`passe de correction : ${issues.length} problème(s) (${[...new Set(issues.map(i => i.kind))].join(', ')})`);
      const corrected = await generateWithRetry(deps.generate, buildCorrectionPrompt(prompt, generation.text, issues.map(i => i.rule)), deps);
      if (corrected.text.trim()) { generation = corrected; issues = auditGroundedText(generation.text, facts, headings); }
    }
    let content = generation.text;
    if (issues.length) { log(`phrases retirées après correction : ${issues.length} problème(s)`); content = sanitizeGroundedText(content, facts, issues); }
    return { status: 200, body: { content, meta: meta(generation), facts, promptVersion: AI_PROMPT_VERSIONS[task] } };
  } catch (error) {
    log(`échec de l'appel Gemini : ${redact(error instanceof Error ? error.message : String(error), deps.apiKey)}`);
    return { status: 502, body: { error: 'Le service de génération est indisponible pour le moment. Réessayez dans quelques instants.' } };
  }
}
