/**
 * ScoutVision - endpoint POST /api/scout-report
 *
 * Middleware Node (signature connect : req, res, next) branché sur les serveurs Vite
 * de développement et de prévisualisation, comme le proxy /cdn. Il peut aussi être
 * monté tel quel sur un serveur Node (http, Express, Connect) en production.
 * GEMINI_API_KEY et GEMINI_MODEL sont lues dans l'environnement du serveur ; la clé n'est jamais
 * envoyée au navigateur, qui ne reçoit que le nom du modèle ayant rédigé le rapport.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { MAX_BODY_BYTES, GenerateText, createRateLimiter, handleScoutReport, resolveGeminiModel } from './scoutReport';
import { AI_TASKS, AiTask, handleGroundedAi } from './groundedAi';

export const SCOUT_REPORT_PATH = '/api/scout-report';
/** Chemins des tâches d'IA ancrée : /api/ai/compare, /api/ai/opposition, /api/ai/hunter */
export const GROUNDED_AI_PREFIX = '/api/ai/';

// 20 rapports par tranche de 10 minutes et par adresse : large pour un usage normal
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const GEMINI_TIMEOUT_MS = 60 * 1000;

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

export interface ScoutReportMiddlewareOptions {
  apiKey: string | undefined;
  model?: string;                          // GEMINI_MODEL ; modèle par défaut si absente
  generate?: GenerateText;                 // remplaçable dans les tests
  rateLimit?: { limit: number; windowMs: number };
  log?: (message: string) => void;
}

/**
 * Middleware de l'endpoint ; les autres chemins passent à `next`
 */
export function scoutReportMiddleware(options: ScoutReportMiddlewareOptions) {
  const { apiKey, log = message => console.warn(message) } = options;
  const model = resolveGeminiModel(options.model);
  const generate = options.generate ?? (apiKey ? geminiGenerator(apiKey, model) : async () => '');
  const allow = createRateLimiter(options.rateLimit?.limit ?? RATE_LIMIT, options.rateLimit?.windowMs ?? RATE_WINDOW_MS);

  return async (req: IncomingMessage, res: ServerResponse, next: Next) => {
    const path = (req.url ?? '').split('?')[0];
    const aiTask = path.startsWith(GROUNDED_AI_PREFIX) ? path.slice(GROUNDED_AI_PREFIX.length) : null;
    if (path !== SCOUT_REPORT_PATH && !(aiTask && (AI_TASKS as string[]).includes(aiTask))) return next();

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return sendJson(res, 405, { error: 'Méthode non autorisée : POST attendu.' });
    }
    if (!String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
      return sendJson(res, 415, { error: 'Content-Type application/json attendu.' });
    }
    const client = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || req.socket?.remoteAddress || 'inconnu';
    if (!allow(client)) {
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

    const result = aiTask
      ? await handleGroundedAi(aiTask as AiTask, body, { apiKey, model, generate, log })
      : await handleScoutReport(body, { apiKey, model, generate, log });
    sendJson(res, result.status, result.body);
  };
}

/**
 * Plugin Vite : l'endpoint sur `vite` (développement) et `vite preview` (build de production)
 */
export function scoutReportApi(apiKey: string | undefined, model?: string): Plugin {
  return {
    name: 'scoutvision-scout-report-api',
    configureServer(server) {
      server.middlewares.use(scoutReportMiddleware({ apiKey, model }));
    },
    configurePreviewServer(server) {
      server.middlewares.use(scoutReportMiddleware({ apiKey, model }));
    },
  };
}
