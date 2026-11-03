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
  BETTING_NEWS_PATH, BETTING_PLAN_PATH, GenerateGrounded, GenerateJson, LoadIndex, NewsCache, handleBettingNews, handleBettingPlan, indexLoader, parseGrounding,
} from './bettingAi';
import { ContextLoader, contextLoader } from './bettingContext';

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

/**
 * Appel Gemini (SDK chargé à la demande, côté serveur uniquement), borné dans le temps.
 * Renvoie aussi le modèle qui a réellement répondu (modelVersion), qui peut différer du modèle demandé.
 */
export function geminiGenerator(apiKey: string, model: string): GenerateText {
  return async prompt => {
    const { GoogleGenAI } = await import('@google/genai');
    const ai = new GoogleGenAI({ apiKey });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('délai dépassé')), GEMINI_TIMEOUT_MS);
    });
    try {
      const response = await Promise.race([ai.models.generateContent({ model, contents: prompt }), timeout]);
      return { text: response.text ?? '', modelVersion: response.modelVersion };
    } finally {
      clearTimeout(timer);
    }
  };
}

/** Appel Gemini avec l'outil Google Search : texte, sources, requêtes et bloc de suggestions Google */
export function geminiGroundedGenerator(apiKey: string, model: string): GenerateGrounded {
  return async prompt => {
    const { GoogleGenAI, ThinkingLevel } = await import('@google/genai');
    const ai = new GoogleGenAI({ apiKey });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('délai dépassé')), BETTING_GEMINI_TIMEOUT_MS); });
    try {
      // Réflexion réduite : la recherche d'actualité n'a pas besoin d'un long raisonnement et doit rester rapide.
      // Si le modèle refuse ce réglage (400 qui cite « thinking »), l'appel est refait sans lui.
      const call = (thinking: boolean) => ai.models.generateContent({
        model, contents: prompt,
        config: { tools: [{ googleSearch: {} }], ...(thinking ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } } : {}) },
      });
      const response = await Promise.race([
        call(true).catch(error => { if (/thinking/i.test(error instanceof Error ? error.message : String(error))) return call(false); throw error; }),
        timeout,
      ]);
      return { text: response.text ?? '', modelVersion: response.modelVersion, ...parseGrounding(response.candidates?.[0]?.groundingMetadata) };
    } finally {
      clearTimeout(timer);
    }
  };
}

/** Appel Gemini en JSON strict (schéma imposé), sans outil */
export function geminiJsonGenerator(apiKey: string, model: string): GenerateJson {
  return async (prompt, schema) => {
    const { GoogleGenAI } = await import('@google/genai');
    const ai = new GoogleGenAI({ apiKey });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('délai dépassé')), GEMINI_TIMEOUT_MS); });
    try {
      const response = await Promise.race([ai.models.generateContent({ model, contents: prompt, config: { responseMimeType: 'application/json', responseJsonSchema: schema } }), timeout]);
      return { text: response.text ?? '', modelVersion: response.modelVersion };
    } finally {
      clearTimeout(timer);
    }
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
  model?: string;                          // GEMINI_MODEL ; modèle par défaut si absente
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
  const generate = options.generate ?? (apiKey ? geminiGenerator(apiKey, model) : async () => '');
  const allow = createRateLimiter(options.rateLimit?.limit ?? RATE_LIMIT, options.rateLimit?.windowMs ?? RATE_WINDOW_MS);
  // Assistant du Labo paris : une recherche d'actualité par match puis un plan ; actualité en cache 90 min
  const allowBetting = createRateLimiter(options.bettingRateLimit?.limit ?? BETTING_RATE_LIMIT, options.bettingRateLimit?.windowMs ?? RATE_WINDOW_MS);
  const loadIndex = options.loadIndex ?? (options.dataDir ? indexLoader(options.dataDir) : () => null);
  const generateGrounded = options.generateGrounded ?? (apiKey ? geminiGroundedGenerator(apiKey, model) : async () => ({ text: '', sources: [], queries: [] }));
  const generateJson = options.generateJson ?? (apiKey ? geminiJsonGenerator(apiKey, model) : async () => ({ text: '' }));
  const news = new NewsCache();
  const loadContext = options.loadContext ?? (options.dataDir ? contextLoader(options.dataDir) : undefined);

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
      const deps = { apiKey, model, loadIndex, loadContext, news, log, generateGrounded: boundedCall(generateGrounded, deadline), generateJson: boundedCall(generateJson, deadline) };
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
