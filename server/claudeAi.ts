/**
 * ScoutVision - adaptateur Claude (API Anthropic) pour les fonctions IA du serveur : rédaction (rapports,
 * synthèses ancrées sur les faits), recherche d'actualité (outil serveur de recherche web), lecture
 * d'articles (outil serveur de lecture d'URL) et plan JSON (sorties structurées).
 *
 * Même contrat que l'adaptateur Gemini de server/scoutReportPlugin.ts : la clé ne quitte jamais le serveur
 * (ANTHROPIC_API_KEY), le serveur construit les prompts, les réponses sont auditées par les handlers. Le SDK
 * est chargé à la demande, côté serveur seulement, et le client est injectable pour les tests (sans réseau).
 *
 * Réglages : un seul modèle (CLAUDE_MODEL, défaut claude-opus-5-5), effort « low » (CLAUDE_EFFORT) : les
 * tâches relisent des faits déjà calculés et doivent tenir les délais du serveur (25 s par requête sur
 * Heroku pour les rapports, 100 s pour l'assistant paris). Les relances sur 429 / 502 / 503 / 529 sont
 * faites par les handlers (generateWithRetry, withRetry) : le SDK ne relance pas lui-même.
 */

import type Anthropic from '@anthropic-ai/sdk';
import type { GenerateText, Generation } from './scoutReport';
import type { ArticlesGeneration, GenerateGrounded, GenerateJson, GroundedGeneration, ReadArticles, Source } from './bettingAi';

export const DEFAULT_CLAUDE_MODEL = 'claude-opus-5-5';
export type Effort = NonNullable<Anthropic.OutputConfig['effort']>;
const EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];
export const DEFAULT_EFFORT: Effort = 'low';
const MAX_TOKENS = 8000;
const MAX_SEARCHES = 5;          // recherches web par demande d'actualité (facturées à l'unité)
const MAX_FETCHES = 4;           // articles lus par demande (newsFeed.MAX_ARTICLES)
const MAX_TURNS = 4;             // reprises d'un tour mis en pause par un outil serveur
const CALL_TIMEOUT_MS = 90 * 1000;

/** Modèle configuré (CLAUDE_MODEL), ou le modèle par défaut */
export function resolveClaudeModel(model: string | undefined): string {
  const m = model?.trim();
  return m ? m : DEFAULT_CLAUDE_MODEL;
}

/** Effort configuré (CLAUDE_EFFORT), ou « low » ; une valeur inconnue retombe sur le défaut */
export function resolveEffort(effort: string | undefined): Effort {
  const e = effort?.trim() as Effort | undefined;
  return e && EFFORTS.includes(e) ? e : DEFAULT_EFFORT;
}

/** Sous-ensemble du client Anthropic utilisé ici (injectable dans les tests) */
export interface ClaudeClient {
  messages: { create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> };
}

export interface ClaudeOptions {
  apiKey: string;
  model?: string;
  effort?: string;
  log?: (message: string) => void;
  client?: ClaudeClient;           // tests
}

type Params = Anthropic.MessageCreateParamsNonStreaming;

async function clientOf(options: ClaudeOptions): Promise<ClaudeClient> {
  if (options.client) return options.client;
  const { default: AnthropicSdk } = await import('@anthropic-ai/sdk');
  return new AnthropicSdk({ apiKey: options.apiKey, maxRetries: 0, timeout: CALL_TIMEOUT_MS });
}

/** Refus de sécurité ou sortie coupée : erreur explicite (les handlers répondent 502 avec un message générique) */
function checkStop(response: Anthropic.Message): void {
  if (response.stop_reason === 'refusal') {
    const category = response.stop_details?.category ? ` (${response.stop_details.category})` : '';
    throw new Error(`réponse refusée par le modèle${category}`);
  }
  if (response.stop_reason === 'max_tokens') throw new Error('réponse tronquée : limite de jetons atteinte');
}

/** Texte d'une réponse : blocs `text` concaténés (jamais la réflexion) */
export function responseText(response: Anthropic.Message): string {
  return response.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map(b => b.text).join('').trim();
}

/** Sources d'une réponse avec recherche web : résultats de recherche et citations, dédoublonnés, https seulement */
export function parseWebSources(content: Anthropic.ContentBlock[]): Pick<GroundedGeneration, 'sources' | 'queries'> {
  const seen = new Set<string>();
  const sources: Source[] = [];
  const add = (uri: unknown, title: unknown) => {
    if (typeof uri !== 'string' || !/^https:\/\//.test(uri) || typeof title !== 'string' || !title.trim()) return;
    const key = title.slice(0, 120) + uri;
    if (seen.has(key)) return;
    seen.add(key);
    sources.push({ title: title.slice(0, 120), uri });
  };
  const queries: string[] = [];
  for (const block of content) {
    if (block.type === 'server_tool_use' && block.name === 'web_search') {
      const q = (block.input as { query?: unknown } | null)?.query;
      if (typeof q === 'string' && q.trim()) queries.push(q.trim());
    } else if (block.type === 'text') {
      // citations d'abord : ce sont les pages réellement utilisées par la réponse
      for (const c of block.citations ?? []) if (c.type === 'web_search_result_location') add(c.url, c.title);
    }
  }
  for (const block of content) {
    if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) for (const r of block.content) add(r.url, r.title);
  }
  return { sources: sources.slice(0, 12), queries: queries.slice(0, 8) };
}

/** Adresses effectivement lues par l'outil de lecture d'URL */
export function parseFetchedUrls(content: Anthropic.ContentBlock[]): string[] {
  const read: string[] = [];
  for (const block of content) {
    if (block.type === 'web_fetch_tool_result' && block.content.type === 'web_fetch_result' && typeof block.content.url === 'string') read.push(block.content.url);
  }
  return [...new Set(read)];
}

/**
 * Schéma JSON accepté par les sorties structurées : `additionalProperties: false` sur chaque objet, contraintes
 * numériques et de longueur retirées (le handler valide ensuite le contenu lui-même), `description` conservée.
 */
export function strictSchema(schema: unknown): Record<string, unknown> {
  const DROP = new Set(['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minLength', 'maxLength', 'pattern', 'minItems', 'maxItems', 'uniqueItems', 'minProperties', 'maxProperties', 'default']);
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== 'object') return node;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (DROP.has(k)) continue;
      if (k === 'properties' && v && typeof v === 'object') out[k] = Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([p, s]) => [p, walk(s)]));
      else if (k === 'enum' || k === 'required' || k === 'type' || k === 'description' || k === 'const' || k === 'format' || k === 'title') out[k] = v;
      else out[k] = walk(v);
    }
    if (out.type === 'object' || out.properties) out.additionalProperties = false;
    return out;
  };
  return walk(schema) as Record<string, unknown>;
}

/** Appel, avec reprise des tours mis en pause par un outil serveur (le contenu reçu est renvoyé tel quel) */
async function converse(client: ClaudeClient, params: Params, log?: (message: string) => void): Promise<{ response: Anthropic.Message; content: Anthropic.ContentBlock[] }> {
  const messages = [...params.messages];
  const content: Anthropic.ContentBlock[] = [];
  for (let turn = 1; ; turn++) {
    const response = await client.messages.create({ ...params, messages });
    content.push(...response.content);
    if (response.stop_reason !== 'pause_turn' || turn >= MAX_TURNS) {
      if (response.stop_reason === 'pause_turn') log?.(`[claude] tour encore en pause après ${turn} reprises : réponse partielle conservée`);
      return { response, content };
    }
    messages.push({ role: 'assistant', content: response.content });
  }
}

function base(options: ClaudeOptions, prompt: string): Params {
  return {
    model: resolveClaudeModel(options.model),
    max_tokens: MAX_TOKENS,
    output_config: { effort: resolveEffort(options.effort) },
    messages: [{ role: 'user', content: prompt }],
  };
}

/** Rédaction sans outil (rapports, comparaison, briefing, filtres du Chasseur, extraction de titres) */
export function claudeGenerator(options: ClaudeOptions): GenerateText {
  return async prompt => {
    const client = await clientOf(options);
    const response = await client.messages.create(base(options, prompt));
    checkStop(response);
    return { text: responseText(response), modelVersion: response.model } satisfies Generation;
  };
}

/** Recherche d'actualité avec l'outil serveur de recherche web : texte, sources, requêtes lancées */
export function claudeGroundedGenerator(options: ClaudeOptions): GenerateGrounded {
  return async prompt => {
    const client = await clientOf(options);
    const { response, content } = await converse(client, { ...base(options, prompt), tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: MAX_SEARCHES }] }, options.log);
    checkStop(response);
    return { text: responseText({ ...response, content }), modelVersion: response.model, ...parseWebSources(content) };
  };
}

/** Lecture d'articles (adresses présentes dans le prompt) avec l'outil serveur de lecture d'URL : texte et adresses lues */
export function claudeArticlesReader(options: ClaudeOptions): ReadArticles {
  return async prompt => {
    const client = await clientOf(options);
    const { response, content } = await converse(client, { ...base(options, prompt), tools: [{ type: 'web_fetch_20260209', name: 'web_fetch', max_uses: MAX_FETCHES }] }, options.log);
    checkStop(response);
    return { text: responseText({ ...response, content }), modelVersion: response.model, read: parseFetchedUrls(content) } satisfies ArticlesGeneration;
  };
}

/** JSON strict (sorties structurées, schéma imposé), sans outil */
export function claudeJsonGenerator(options: ClaudeOptions): GenerateJson {
  return async (prompt, schema) => {
    const client = await clientOf(options);
    const params = base(options, prompt);
    const response = await client.messages.create({ ...params, output_config: { ...params.output_config, format: { type: 'json_schema', schema: strictSchema(schema) } } });
    checkStop(response);
    return { text: responseText(response), modelVersion: response.model } satisfies Generation;
  };
}

/**
 * Secours : si l'appel principal échoue (hors délai de la requête, qui ne laisse pas le temps d'un second appel),
 * l'appel de secours prend le relais et l'échec est journalisé. Sert à garder Gemini derrière Claude.
 */
export function withFallback<A extends unknown[], R>(primary: (...args: A) => Promise<R>, fallback: (...args: A) => Promise<R>, isFinal: (error: unknown) => boolean, log?: (message: string) => void): (...args: A) => Promise<R> {
  return async (...args: A) => {
    try {
      return await primary(...args);
    } catch (error) {
      if (isFinal(error)) throw error;
      const why = (error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' ').slice(0, 200);
      log?.(`[claude] appel en échec, secours Gemini : ${why}`);
      return fallback(...args);
    }
  };
}
