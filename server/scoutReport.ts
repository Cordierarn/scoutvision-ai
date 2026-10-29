/**
 * ScoutVision - rapport de scouting rédigé par Gemini, côté serveur
 *
 * Le navigateur envoie la ligne du joueur et quelques indicateurs déjà calculés ;
 * le serveur valide l'entrée, construit lui-même le prompt (l'endpoint n'est pas un
 * proxy Gemini ouvert) et appelle Gemini avec GEMINI_API_KEY, qui ne quitte jamais
 * le serveur. Ce module ne dépend d'aucun framework : il est branché sur les serveurs
 * Vite (server/scoutReportPlugin.ts) et peut l'être sur n'importe quel serveur Node.
 */

import { auditReport, sanitizeReport } from './reportAudit';
import { PROMPT_VERSION, ReportFacts, buildCorrectionPrompt, buildReportFacts, buildScoutReportPrompt, PlayerRow, ReportOptions } from './reportFacts';

// ============================================
// LIMITES
// ============================================

export const MAX_BODY_BYTES = 128 * 1024;        // une ligne joueur PitchAPI pèse ~20-40 Ko en JSON
const MAX_PLAYER_FIELDS = 1500;
const MAX_KEY_LENGTH = 120;
const MAX_STRING_LENGTH = 300;
const MAX_INSIGHTS = 20;
const MAX_INSIGHT_LENGTH = 600;
const MAX_ROLES = 10;
const MAX_PERCENTILES = 1000;

const LANGUAGES = ['en', 'fr', 'es', 'de'] as const;
const DETAIL_LEVELS = ['brief', 'standard', 'detailed'] as const;
const FOCUS_AREAS = ['attacking', 'defending', 'physical', 'mental'] as const;

// Modèle par défaut si GEMINI_MODEL n'est pas définie dans l'environnement du serveur
export const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash';

/** Modèle configuré côté serveur (GEMINI_MODEL), ou le modèle par défaut */
export function resolveGeminiModel(configured: string | undefined): string {
  const model = configured?.trim();
  return model ? model : DEFAULT_GEMINI_MODEL;
}

// ============================================
// TYPES
// ============================================

export type { PlayerRow, ReportFacts, ReportOptions };
export { PROMPT_VERSION };

export interface ReportRequest {
  player: PlayerRow;
  options: ReportOptions;
}

export type Validation = { ok: true; value: ReportRequest } | { ok: false; error: string };

// ============================================
// VALIDATION
// ============================================

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

const fail = (error: string): Validation => ({ ok: false, error });

/**
 * Valide et nettoie le corps de la requête : seuls les champs attendus sont conservés
 */
export function validateReportRequest(body: unknown): Validation {
  if (!isObject(body)) return fail('Corps de requête invalide : objet JSON attendu.');
  const { player, options = {} } = body;

  if (!isObject(player)) return fail('Champ « player » manquant ou invalide.');
  const entries = Object.entries(player);
  if (entries.length === 0 || entries.length > MAX_PLAYER_FIELDS) return fail('Nombre de champs du joueur invalide.');
  const cleanPlayer: PlayerRow = {};
  for (const [key, value] of entries) {
    if (key.length === 0 || key.length > MAX_KEY_LENGTH) return fail('Nom de champ du joueur invalide.');
    if (value === null) cleanPlayer[key] = null;
    else if (typeof value === 'boolean' || finite(value)) cleanPlayer[key] = value as boolean | number;
    else if (typeof value === 'string') {
      if (value.length > MAX_STRING_LENGTH) return fail(`Champ « ${key.slice(0, 40)} » trop long.`);
      cleanPlayer[key] = value;
    } else return fail(`Champ « ${key.slice(0, 40)} » : valeur non prise en charge.`);
  }
  if (typeof cleanPlayer.Player !== 'string' || cleanPlayer.Player.trim() === '') return fail('Nom du joueur manquant.');

  if (!isObject(options)) return fail('Champ « options » invalide.');
  const clean: ReportOptions = {};

  if (options.language !== undefined) {
    if (!LANGUAGES.includes(options.language as never)) return fail('Langue non prise en charge.');
    clean.language = options.language as ReportOptions['language'];
  }
  if (options.detailLevel !== undefined) {
    if (!DETAIL_LEVELS.includes(options.detailLevel as never)) return fail('Niveau de détail invalide.');
    clean.detailLevel = options.detailLevel as ReportOptions['detailLevel'];
  }
  if (options.focusAreas !== undefined) {
    if (!Array.isArray(options.focusAreas) || !options.focusAreas.every(a => FOCUS_AREAS.includes(a as never))) {
      return fail('Axes d\'analyse invalides.');
    }
    clean.focusAreas = [...new Set(options.focusAreas)] as ReportOptions['focusAreas'];
  }
  if (options.targetRole !== undefined) {
    if (typeof options.targetRole !== 'string' || options.targetRole.length > 80) return fail('Rôle cible invalide.');
    clean.targetRole = options.targetRole;
  }
  if (options.percentiles !== undefined) {
    if (!isObject(options.percentiles)) return fail('Percentiles invalides.');
    const list = Object.entries(options.percentiles);
    if (list.length > MAX_PERCENTILES) return fail('Trop de percentiles.');
    if (!list.every(([k, v]) => k.length > 0 && k.length <= MAX_KEY_LENGTH && finite(v) && v >= 0 && v <= 100)) {
      return fail('Percentiles invalides : valeurs de 0 à 100 attendues.');
    }
    clean.percentiles = Object.fromEntries(list) as Record<string, number>;
  }
  if (options.bestRoles !== undefined) {
    if (!Array.isArray(options.bestRoles) || options.bestRoles.length > MAX_ROLES
      || !options.bestRoles.every(r => isObject(r) && typeof r.role === 'string' && r.role.length <= 80 && finite(r.normalizedScore))) {
      return fail('Rôles invalides.');
    }
    clean.bestRoles = options.bestRoles.map(r => ({ role: String(r.role), normalizedScore: Number(r.normalizedScore) }));
  }
  if (options.shotStats !== undefined) {
    const s = options.shotStats;
    if (!isObject(s) || !['total', 'goals', 'xG', 'conversion'].every(k => finite(s[k]))) return fail('Statistiques de tir invalides.');
    clean.shotStats = { total: Number(s.total), goals: Number(s.goals), xG: Number(s.xG), conversion: Number(s.conversion) };
  }
  if (options.insights !== undefined) {
    if (!Array.isArray(options.insights) || options.insights.length > MAX_INSIGHTS
      || !options.insights.every(l => typeof l === 'string' && l.length <= MAX_INSIGHT_LENGTH)) {
      return fail('Indicateurs avancés invalides.');
    }
    clean.insights = options.insights as string[];
  }
  if (options.seasonInProgress !== undefined) {
    if (typeof options.seasonInProgress !== 'boolean') return fail('Contexte de saison invalide.');
    clean.seasonInProgress = options.seasonInProgress;
  }

  return { ok: true, value: { player: cleanPlayer, options: clean } };
}

// ============================================
// HANDLER
// ============================================

/** Texte généré et modèle ayant réellement répondu (renvoyé par l'API quand elle le donne) */
export interface Generation { text: string; modelVersion?: string }
export type GenerateText = (prompt: string) => Promise<Generation | string>;

/** Métadonnées renvoyées au navigateur avec le rapport */
export interface ReportMeta {
  model: string;               // modèle qui a réellement rédigé le rapport
  requestedModel: string;      // modèle configuré côté serveur (GEMINI_MODEL)
  generatedAt: string;
}

/**
 * Réponse d'une génération : le texte, le modèle, les faits exacts que le modèle a reçus (le
 * navigateur les conserve avec le rapport) et la version du prompt
 */
export interface ReportResponse {
  content: string;
  meta: ReportMeta;
  facts: ReportFacts;
  promptVersion: string;
}

export interface HandlerResult {
  status: number;
  body: ReportResponse | { error: string };
}

// ============================================
// ERREURS TRANSITOIRES
// ============================================

// Seuls ces statuts sont relancés (surcharge, quota par minute, passerelle) ; jamais 400, 401, 403, 404,
// ni un 429 de quota journalier
const TRANSIENT_STATUSES = new Set([429, 502, 503]);
export const MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = 600;

/** Statut HTTP d'une erreur du SDK Gemini (propriété `status`, ou code cité dans le message) */
export function errorStatus(error: unknown): number | undefined {
  const status = (error as { status?: unknown })?.status;
  if (typeof status === 'number') return status;
  const message = error instanceof Error ? error.message : String(error);
  const code = message.match(/"code"\s*:\s*(\d{3})/) ?? message.match(/^\s*(\d{3})\b/);
  return code ? Number(code[1]) : undefined;
}

/** 429 dû au quota journalier (PerDay) : inutile de relancer avant le lendemain */
function dailyQuota(error: unknown): boolean {
  return /PerDay/.test(error instanceof Error ? error.message : String(error));
}

export interface RetryDeps {
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  log?: (message: string) => void;
}

/**
 * Appel avec au plus MAX_ATTEMPTS tentatives sur 429, 502 et 503 ; délai exponentiel court
 * avec gigue (≈ 0,6-1,2 s puis 1,2-1,8 s). Toute autre erreur est remontée immédiatement.
 */
export async function generateWithRetry(generate: GenerateText, prompt: string, deps: RetryDeps = {}): Promise<Generation> {
  const sleep = deps.sleep ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const random = deps.random ?? Math.random;
  for (let attempt = 1; ; attempt++) {
    try {
      const out = await generate(prompt);
      return typeof out === 'string' ? { text: out } : out;
    } catch (error) {
      const status = errorStatus(error);
      if (attempt >= MAX_ATTEMPTS || status === undefined || !TRANSIENT_STATUSES.has(status) || dailyQuota(error)) throw error;
      deps.log?.(`[scout-report] Gemini ${status}, tentative ${attempt + 1}/${MAX_ATTEMPTS}`);
      await sleep(RETRY_BASE_MS * 2 ** (attempt - 1) + random() * RETRY_BASE_MS);
    }
  }
}

// ============================================
// HANDLER
// ============================================

export interface HandlerDeps extends RetryDeps {
  apiKey: string | undefined;
  model?: string;              // GEMINI_MODEL (défaut : DEFAULT_GEMINI_MODEL)
  generate: GenerateText;
  now?: () => Date;
}

/**
 * Traite une requête déjà lue et décodée. `generate` appelle Gemini (injecté : testable sans réseau).
 * Le rapport est contrôlé (reportAudit) : en cas d'écart vérifiable, une passe de correction,
 * puis retrait des phrases encore fautives. Les journaux ne contiennent ni la clé, ni le prompt,
 * ni le texte généré : seulement des statuts et des nombres de problèmes.
 * Les messages d'erreur renvoyés au client sont génériques : ni clé, ni détail de l'API.
 */
export async function handleScoutReport(body: unknown, deps: HandlerDeps): Promise<HandlerResult> {
  if (!deps.apiKey) {
    return { status: 503, body: { error: 'Rapports IA indisponibles : GEMINI_API_KEY n\'est pas configurée sur le serveur.' } };
  }
  const parsed = validateReportRequest(body);
  if ('error' in parsed) return { status: 400, body: { error: parsed.error } };

  const { player, options } = parsed.value;
  const language = options.language ?? 'fr';
  const requestedModel = resolveGeminiModel(deps.model);
  const facts = buildReportFacts(player, options);
  const prompt = buildScoutReportPrompt(facts, options);

  try {
    let generation = await generateWithRetry(deps.generate, prompt, deps);
    if (!generation.text.trim()) return { status: 502, body: { error: 'Le modèle n\'a renvoyé aucun texte. Réessayez.' } };

    let issues = auditReport(generation.text, facts, language);
    if (issues.length > 0) {
      deps.log?.(`[scout-report] passe de correction : ${issues.length} problème(s) (${[...new Set(issues.map(i => i.kind))].join(', ')})`);
      const corrected = await generateWithRetry(deps.generate, buildCorrectionPrompt(prompt, generation.text, issues.map(i => i.rule)), deps);
      if (corrected.text.trim()) {
        generation = corrected;
        issues = auditReport(generation.text, facts, language);
      }
    }
    let report = generation.text;
    if (issues.length > 0) {
      deps.log?.(`[scout-report] phrases retirées après correction : ${issues.length} problème(s) (${[...new Set(issues.map(i => i.kind))].join(', ')})`);
      report = sanitizeReport(report, facts, issues);
    }

    const meta: ReportMeta = {
      model: generation.modelVersion?.trim() || requestedModel,
      requestedModel,
      generatedAt: (deps.now?.() ?? new Date()).toISOString(),
    };
    return { status: 200, body: { content: report, meta, facts, promptVersion: PROMPT_VERSION } };
  } catch (error) {
    deps.log?.(`[scout-report] échec de l'appel Gemini : ${redact(error instanceof Error ? error.message : String(error), deps.apiKey)}`);
    return { status: 502, body: { error: 'Le service de génération est indisponible pour le moment. Réessayez dans quelques instants.' } };
  }
}

/**
 * Retire un secret d'un message (les erreurs du SDK peuvent citer l'URL appelée)
 */
export function redact(message: string, secret: string | undefined): string {
  let out = message.replace(/([?&]key=)[^&\s]+/gi, '$1[masqué]');
  if (secret) out = out.split(secret).join('[masqué]');
  return out.slice(0, 300);
}

// ============================================
// LIMITE DE DÉBIT
// ============================================

/**
 * Limite simple par client (fenêtre glissante, en mémoire) : protège le quota Gemini
 */
export function createRateLimiter(limit: number, windowMs: number, now: () => number = Date.now) {
  const hits = new Map<string, number[]>();
  return (client: string): boolean => {
    const t = now();
    const recent = (hits.get(client) ?? []).filter(h => t - h < windowMs);
    if (recent.length >= limit) {
      hits.set(client, recent);
      return false;
    }
    recent.push(t);
    hits.set(client, recent);
    return true;
  };
}
