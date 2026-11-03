/**
 * ScoutVision - endpoint POST /api/scout-report
 *
 * Middleware Node (signature connect : req, res, next), toujours monté DERRIÈRE le garde
 * d'accès de server/privateServer.ts (production, `vite preview` et `vite dev`) : aucune
 * requête n'atteint Gemini sans session valide et origine vérifiée.
 * GEMINI_API_KEY et GEMINI_MODEL sont lues dans l'environnement du serveur ; la clé n'est jamais
 * envoyée au navigateur, qui ne reçoit que le nom du modèle ayant rédigé le rapport.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { MAX_BODY_BYTES, GenerateText, createRateLimiter, handleScoutReport, resolveGeminiModel } from './scoutReport';
import { AI_TASKS, AiTask, handleGroundedAi } from './groundedAi';
import {
  BETTING_NEWS_PATH, BETTING_PLAN_PATH, GenerateGrounded, GenerateJson, LoadIndex, NewsCache, ReadArticles, handleBettingNews, handleBettingPlan, indexLoader, parseGrounding,
} from './bettingAi';
import { ContextLoader, contextLoader } from './bettingContext';
import { FetchHeadlines, newsFeedFetcher } from './newsFeed';
import { DEFAULT_SEARCH_MODELS, DEFAULT_TEXT_MODELS, EXTRACT_MODELS, ModelPool, modelChain, takesThinkingLevel, withModelFallback } from './geminiModels';

export const SCOUT_REPORT_PATH = '/api/scout-report';
/** Chemins des tâches d'IA ancrée : /api/ai/compare, /api/ai/opposition, /api/ai/hunter */
export const GROUNDED_AI_PREFIX = '/api/ai/';

// 20 rapports par tranche de 10 minutes et par adresse : large pour un usage normal
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const GEMINI_TIMEOUT_MS = 60 * 1000;
// Assistant du Labo paris : jusqu'à 8 recherches d'actualité et un plan par génération
const BETTING_RATE_LIMIT = 40;
// Recherche Google + rédaction : jusqu'à 90 s par appel ; la réponse reste ouverte pendant ce temps (voir keepAlive)
const BETTING_GEMINI_TIMEOUT_MS = 90 * 1000;
const BETTING_DEADLINE_MS = 100 * 1000;
const KEEPALIVE_MS = 5000;

type Next = (err?: unknown) => void;

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

/**
 * Lit le corps en refusant au-delà de `limit` octets (en-tête Content-Length ou flux réel)
 */
export function readBody(req: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > limit) {
      reject(new HttpError(413, 'Requête trop volumineuse.'));
      req.resume();
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    req.on('data', (chunk: Buffer) => {
      if (done) return;
      size += chunk.length;
      if (size > limit) {
        done = true;
        reject(new HttpError(413, 'Requête trop volumineuse.'));
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => { if (!done) { done = true; resolve(Buffer.concat(chunks).toString('utf8')); } });
    req.on('error', () => { if (!done) { done = true; reject(new HttpError(400, 'Lecture de la requête impossible.')); } });
  });
}

/** Course entre un appel et un délai (le minuteur est toujours libéré) */
async function timed<T>(call: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('délai dépassé')), ms); });
  try { return await Promise.race([call, timeout]); } finally { clearTimeout(timer); }
}

/** Niveau de réflexion réduit sur Gemini 3+, refait sans ce réglage si le modèle le refuse (400 qui cite « thinking ») */
async function withLowThinking<T>(model: string, call: (thinkingConfig: Record<string, unknown> | undefined) => Promise<T>): Promise<T> {
  if (!takesThinkingLevel(model)) return call(undefined);
  const { ThinkingLevel } = await import('@google/genai');
  return call({ thinkingLevel: ThinkingLevel.LOW }).catch(error => {
    if (/thinking/i.test(error instanceof Error ? error.message : String(error))) return call(undefined);
    throw error;
  });
}

/**
 * Appel Gemini (SDK chargé à la demande, côté serveur uniquement), borné dans le temps, sur le premier
 * modèle disponible de la chaîne. Renvoie le modèle qui a réellement répondu (modelVersion).
 */
export function geminiGenerator(apiKey: string, pool: ModelPool, log?: (message: string) => void): GenerateText {
  return async prompt => {
    const { GoogleGenAI } = await import('@google/genai');
    const ai = new GoogleGenAI({ apiKey });
    return timed(withModelFallback(pool, async model => {
      const response = await ai.models.generateContent({ model, contents: prompt });
      return { text: response.text ?? '', modelVersion: response.modelVersion || model };
    }, log), GEMINI_TIMEOUT_MS);
  };
}

/** Appel Gemini avec l'outil Google Search : texte, sources, requêtes et bloc de suggestions Google */
export function geminiGroundedGenerator(apiKey: string, pool: ModelPool, log?: (message: string) => void): GenerateGrounded {
  return async prompt => {
    const { GoogleGenAI } = await import('@google/genai');
    const ai = new GoogleGenAI({ apiKey });
    // Réflexion réduite : la recherche d'actualité doit rester rapide
    return timed(withModelFallback(pool, model => withLowThinking(model, async thinkingConfig => {
      const response = await ai.models.generateContent({ model, contents: prompt, config: { tools: [{ googleSearch: {} }], ...(thinkingConfig ? { thinkingConfig } : {}) } });
      return { text: response.text ?? '', modelVersion: response.modelVersion || model, ...parseGrounding(response.candidates?.[0]?.groundingMetadata) };
    }), log), BETTING_GEMINI_TIMEOUT_MS);
  };
}

/** Lecture d'articles par Gemini (outil URL context, disponible au niveau gratuit) : texte et adresses lues */
export function geminiArticlesReader(apiKey: string, pool: ModelPool, log?: (message: string) => void): ReadArticles {
  return async prompt => {
    const { GoogleGenAI } = await import('@google/genai');
    const ai = new GoogleGenAI({ apiKey });
    return timed(withModelFallback(pool, model => withLowThinking(model, async thinkingConfig => {
      const response = await ai.models.generateContent({ model, contents: prompt, config: { tools: [{ urlContext: {} }], ...(thinkingConfig ? { thinkingConfig } : {}) } });
      const read = (response.candidates?.[0]?.urlContextMetadata?.urlMetadata ?? [])
        .filter(u => u.urlRetrievalStatus === 'URL_RETRIEVAL_STATUS_SUCCESS' && typeof u.retrievedUrl === 'string').map(u => u.retrievedUrl as string);
      return { text: response.text ?? '', modelVersion: response.modelVersion || model, read };
    }), log), BETTING_GEMINI_TIMEOUT_MS);
  };
}

/** Appel Gemini en JSON strict (schéma imposé), sans outil */
export function geminiJsonGenerator(apiKey: string, pool: ModelPool, log?: (message: string) => void): GenerateJson {
  return async (prompt, schema) => {
    const { GoogleGenAI } = await import('@google/genai');
    const ai = new GoogleGenAI({ apiKey });
    // Le plan relit des faits déjà calculés : réflexion réduite pour tenir le délai
    return timed(withModelFallback(pool, model => withLowThinking(model, async thinkingConfig => {
      const response = await ai.models.generateContent({
        model, contents: prompt, config: { responseMimeType: 'application/json', responseJsonSchema: schema, ...(thinkingConfig ? { thinkingConfig } : {}) },
      });
      return { text: response.text ?? '', modelVersion: response.modelVersion || model };
    }), log), BETTING_GEMINI_TIMEOUT_MS);
  };
}

/** Échéance d'une requête appliquée à un appel quelconque (temps restant, au moins 1 s) */
function boundedCall<A extends unknown[], R>(call: (...args: A) => Promise<R>, deadline: number | undefined): (...args: A) => Promise<R> {
  if (!deadline) return call;
  return async (...args: A) => {
    const remaining = deadline - Date.now();
    if (remaining < 1000) throw new DeadlineError('délai de la requête dépassé');
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new DeadlineError('délai de la requête dépassé')), remaining); });
    try { return await Promise.race([call(...args), timeout]); } finally { clearTimeout(timer); }
  };
}

export interface ScoutReportMiddlewareOptions {
  apiKey: string | undefined;
  model?: string;                          // GEMINI_MODEL : placé en tête de la chaîne de rédaction
  textModels?: string;                     // GEMINI_TEXT_MODELS : chaîne de rédaction (virgules)
  searchModels?: string;                   // GEMINI_SEARCH_MODELS : chaîne de recherche Google (virgules)
  generate?: GenerateText;                 // remplaçable dans les tests
  rateLimit?: { limit: number; windowMs: number };
  log?: (message: string) => void;
  /**
   * Délai total d'une requête IA (toutes tentatives et passe de correction comprises). Heroku coupe
   * toute requête sans réponse au bout de 30 s (erreur H12) : le serveur de production y fixe 25 s
   * pour répondre lui-même avant. Absent : seul le délai de 60 s par appel s'applique.
   */
  deadlineMs?: number;
  /** Assistant IA du Labo paris : dossier des données servies (artefact des suggestions) */
  dataDir?: string;
  loadIndex?: LoadIndex;                   // remplaçable dans les tests
  generateGrounded?: GenerateGrounded;     // remplaçable dans les tests
  generateJson?: GenerateJson;             // remplaçable dans les tests
  bettingRateLimit?: { limit: number; windowMs: number };
  loadContext?: ContextLoader;             // remplaçable dans les tests
  fetchHeadlines?: FetchHeadlines;         // secours Google News (remplaçable dans les tests)
  readArticles?: ReadArticles;             // lecture d'articles (remplaçable dans les tests)
  /**
   * Réponse ouverte pour l'assistant : en-têtes et un espace tout de suite, puis un espace toutes les 5 s
   * jusqu'au JSON final (un JSON précédé d'espaces reste valide). Le routeur Heroku coupe une requête
   * sans premier octet au bout de 30 s, puis sans octet pendant 55 s : la recherche peut ainsi durer
   * jusqu'à 100 s. Le statut HTTP vaut alors 200 et une erreur est portée par le JSON (`error`, `status`).
   */
  bettingKeepAlive?: boolean;
}

export class DeadlineError extends Error {}

/** Générateur borné par l'échéance de la requête : chaque appel reçoit au plus le temps restant */
export function withDeadline(generate: GenerateText, deadline: number, now: () => number = Date.now): GenerateText {
  return async prompt => {
    const remaining = deadline - now();
    if (remaining < 1000) throw new DeadlineError('délai de la requête dépassé');
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new DeadlineError('délai de la requête dépassé')), remaining); });
    try { return await Promise.race([generate(prompt), timeout]); } finally { clearTimeout(timer); }
  };
}

/**
 * Middleware de l'endpoint ; les autres chemins passent à `next`
 */
export function scoutReportMiddleware(options: ScoutReportMiddlewareOptions) {
  const { apiKey, log = message => console.warn(message) } = options;
  const model = resolveGeminiModel(options.model);
  // Chaînes de modèles partagées par toutes les requêtes : un modèle au quota épuisé est mis de côté
  const textPool = new ModelPool(modelChain(options.textModels, DEFAULT_TEXT_MODELS, options.model));
  const searchPool = new ModelPool(modelChain(options.searchModels, DEFAULT_SEARCH_MODELS));
  // Extraction de l'actualité à partir des titres (tâche simple) : Flash Lite d'abord (500 requêtes par jour, moins saturés)
  const extractPool = new ModelPool([...new Set([...EXTRACT_MODELS, ...textPool.models])]);
  const generate = options.generate ?? (apiKey ? geminiGenerator(apiKey, textPool, log) : async () => '');
  const allow = createRateLimiter(options.rateLimit?.limit ?? RATE_LIMIT, options.rateLimit?.windowMs ?? RATE_WINDOW_MS);
  // Assistant du Labo paris : une recherche d'actualité par match puis un plan ; actualité en cache 90 min
  const allowBetting = createRateLimiter(options.bettingRateLimit?.limit ?? BETTING_RATE_LIMIT, options.bettingRateLimit?.windowMs ?? RATE_WINDOW_MS);
  const loadIndex = options.loadIndex ?? (options.dataDir ? indexLoader(options.dataDir) : () => null);
  const generateGrounded = options.generateGrounded ?? (apiKey ? geminiGroundedGenerator(apiKey, searchPool, log) : async () => ({ text: '', sources: [], queries: [] }));
  const generateJson = options.generateJson ?? (apiKey ? geminiJsonGenerator(apiKey, textPool, log) : async () => ({ text: '' }));
  const news = new NewsCache();
  const loadContext = options.loadContext ?? (options.dataDir ? contextLoader(options.dataDir) : undefined);
  const fetchHeadlines = options.fetchHeadlines ?? newsFeedFetcher();
  const readArticles = options.readArticles ?? (apiKey ? geminiArticlesReader(apiKey, extractPool, log) : undefined);
  const extractText = options.generate ?? (apiKey ? geminiGenerator(apiKey, extractPool, log) : async () => '');

  return async (req: IncomingMessage, res: ServerResponse, next: Next) => {
    const path = (req.url ?? '').split('?')[0];
    const betting = path === BETTING_NEWS_PATH || path === BETTING_PLAN_PATH;
    const aiTask = !betting && path.startsWith(GROUNDED_AI_PREFIX) ? path.slice(GROUNDED_AI_PREFIX.length) : null;
    if (!betting && path !== SCOUT_REPORT_PATH && !(aiTask && (AI_TASKS as string[]).includes(aiTask))) return next();

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return sendJson(res, 405, { error: 'Méthode non autorisée : POST attendu.' });
    }
    if (!String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
      return sendJson(res, 415, { error: 'Content-Type application/json attendu.' });
    }
    // Entrée de droite de X-Forwarded-For (ajoutée par le proxy de l'hébergeur), comme le garde
    const client = String(req.headers['x-forwarded-for'] ?? '').split(',').map(h => h.trim()).filter(Boolean).pop() || req.socket?.remoteAddress || 'inconnu';
    if (betting ? !allowBetting(client) : !allow(client)) {
      res.setHeader('Retry-After', String(Math.ceil((options.rateLimit?.windowMs ?? RATE_WINDOW_MS) / 1000)));
      return sendJson(res, 429, { error: 'Trop de rapports demandés. Réessayez dans quelques minutes.' });
    }

    let body: unknown;
    try {
      const raw = await readBody(req, MAX_BODY_BYTES);
      body = JSON.parse(raw);
    } catch (error) {
      if (error instanceof HttpError) return sendJson(res, error.status, { error: error.message });
      return sendJson(res, 400, { error: 'JSON invalide.' });
    }

    if (betting) {
      const keepAlive = !!options.bettingKeepAlive;
      const deadline = keepAlive ? Date.now() + BETTING_DEADLINE_MS : options.deadlineMs ? Date.now() + options.deadlineMs : undefined;
      const deps = { apiKey, model, loadIndex, loadContext, news, log, fetchHeadlines, generateText: boundedCall(extractText, deadline),
        readArticles: readArticles ? boundedCall(readArticles, deadline) : undefined,
        generateGrounded: boundedCall(generateGrounded, deadline), generateJson: boundedCall(generateJson, deadline) };
      let beat: ReturnType<typeof setInterval> | undefined;
      if (keepAlive) {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.flushHeaders();
        res.write(' ');
        beat = setInterval(() => res.write(' '), KEEPALIVE_MS);
      }
      try {
        const out = path === BETTING_NEWS_PATH ? await handleBettingNews(body, deps) : await handleBettingPlan(body, deps);
        if (!keepAlive) return sendJson(res, out.status, out.body);
        res.end(JSON.stringify(out.status >= 400 ? { ...out.body, status: out.status } : out.body));
      } finally {
        clearInterval(beat);
      }
      return;
    }

    const bounded = options.deadlineMs ? withDeadline(generate, Date.now() + options.deadlineMs) : generate;
    const result = aiTask
      ? await handleGroundedAi(aiTask as AiTask, body, { apiKey, model, generate: bounded, log })
      : await handleScoutReport(body, { apiKey, model, generate: bounded, log });
    sendJson(res, result.status, result.body);
  };
}
