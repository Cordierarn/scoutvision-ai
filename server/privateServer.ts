/**
 * ScoutVision - garde d'accès central (production, `vite preview`, `vite dev`)
 *
 * Un seul middleware (signature connect : req, res, next) décide de tout accès :
 * - publics : /login, les fichiers strictement nécessaires à la page de connexion (lus dans le
 *   manifeste du build), /logo.svg, /healthz, /api/auth/* ;
 * - tout le reste exige une session valide : l'application (/ et ses bundles), /data/* (données
 *   PitchAPI privées, servies hors de dist/), /cdn/* (proxy d'images limité aux photos et logos),
 *   /api/* (rapports Gemini et futurs endpoints privés).
 * Sans session : 302 vers /login pour une navigation, 401 pour tout le reste, jamais le contenu.
 * Mutations (POST) : origine vérifiée en plus du cookie SameSite=Lax.
 * En-têtes de sécurité sur toutes les réponses ; CSP stricte hors développement.
 */

import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createGzip } from 'node:zlib';
import {
  AuthConfig, LoginLimiter, RevocationList, SessionPayload, checkCredentials, clearSessionCookie, createDeviceToken, createSessionToken,
  deviceCookie, deviceCookieName, readCookie, sessionCookie, sessionCookieName, verifyDeviceToken, verifySessionToken,
} from './auth';
import { readBody } from './scoutReportPlugin';

export type ServerMode = 'production' | 'preview' | 'dev';
type Next = (err?: unknown) => void;
export type Middleware = (req: IncomingMessage, res: ServerResponse, next: Next) => unknown;

export interface PrivateServerOptions {
  mode: ServerMode;
  /** null : mode local ouvert (dev / preview sans variables), interdit en production par l'appelant */
  auth: AuthConfig | null;
  /** Dossier du build client (production : fichiers servis ici ; preview / dev : Vite les sert) */
  distDir?: string;
  /** Dossier des données privées (public/data par défaut), hors de dist/ */
  dataDir: string;
  /** Cookie Secure + préfixe __Host- (production en HTTPS) */
  secureCookies: boolean;
  /** Derrière le proxy de l'hébergeur : X-Forwarded-Proto / X-Forwarded-For lus */
  trustProxy: boolean;
  /** Origines publiques acceptées pour les mutations, en plus de l'hôte de la requête */
  allowedOrigins?: string[];
  /** Strict-Transport-Security (seulement quand HTTPS est garanti) */
  hsts: boolean;
  /** Middleware des endpoints privés (rapport Gemini, IA ancrée), placé derrière le garde */
  api?: Middleware;
  /** Proxy /cdn : 'proxy' (serveur de production / preview) ou 'next' (proxy de Vite en dev) */
  cdn: 'proxy' | 'next';
  fetchImpl?: typeof fetch;
  limiter?: LoginLimiter;
  revoked?: RevocationList;
  /** Données prêtes (téléchargement initial terminé) */
  dataReady?: () => boolean;
  log?: (message: string) => void;
}

const JSON_TYPE = 'application/json; charset=utf-8';
const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': JSON_TYPE, '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8', '.wasm': 'application/wasm',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.txt']);

/** Chemins publics toujours accessibles (avec la page de connexion et ses fichiers) */
const PUBLIC_PATHS = new Set(['/logo.svg', '/favicon.ico', '/healthz']);
export const LOGIN_PATH = '/login';
export const CDN_PATTERN = /^\/cdn\/images\/(players|teams)\/[A-Za-z0-9_-]{1,80}\.webp$/;
const CDN_ORIGIN = 'https://cdn.pitchapi.dev';
/** Dossiers du projet que `vite dev` servirait par leur chemin : refusés sans session */
/**
 * `vite dev` sans session : seuls passent à Vite le client de Vite et les sources de la page de
 * connexion (code public du dépôt). Tout autre fichier du projet (données, captures, exports,
 * fichiers locaux non suivis) est refusé : liste blanche, jamais liste noire.
 */
const DEV_PUBLIC_EXACT = new Set(['/@vite/client', '/@vite/env', '/@react-refresh', '/login.tsx', '/types.ts']);
const DEV_PUBLIC_PATTERN = /^\/(?:node_modules\/\.vite\/deps\/[A-Za-z0-9_.@-]+\.(?:js|mjs|css|map)|node_modules\/vite\/dist\/client\/[A-Za-z0-9_.-]+\.m?js|(?:components|services|styles|utils|theme|types|hooks)\/[A-Za-z0-9_\/-]+\.(?:tsx?|jsx?|mjs|css|json))$/;
export const devPublicPath = (p: string) => DEV_PUBLIC_EXACT.has(p) || DEV_PUBLIC_PATTERN.test(p);
const CDN_MAX_BYTES = 2 * 1024 * 1024;

export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  // Styles en ligne : attributs style de React et des graphiques ; feuilles Google Fonts
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  // Drapeaux publics (codes pays) : flagcdn.com
  "img-src 'self' data: blob: https://flagcdn.com",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

// ============================================
// OUTILS HTTP
// ============================================

function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', JSON_TYPE);
  res.setHeader('Cache-Control', 'no-store');
  Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
  res.end(JSON.stringify(body));
}

function sendText(res: ServerResponse, status: number, text: string) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(text);
}

function redirect(res: ServerResponse, location: string) {
  res.statusCode = 302;
  res.setHeader('Location', location);
  res.setHeader('Cache-Control', 'no-store');
  res.end();
}

/** Chemin décodé de l'URL ; null s'il est invalide (encodage, octet nul) */
export function requestPath(req: IncomingMessage): string | null {
  const raw = (req.url ?? '/').split('?')[0].split('#')[0] || '/';
  try {
    const decoded = decodeURIComponent(raw);
    if (decoded.includes('\0') || decoded.includes('\\') || !decoded.startsWith('/')) return null;
    // Segments « . » et « .. » refusés (jamais normalisés) : aucun chemin détourné n'est réinterprété
    if (decoded.split('/').some(seg => seg === '.' || seg === '..')) return null;
    return decoded.replace(/\/{2,}/g, '/');
  } catch { return null; }
}

/**
 * Destination de retour après connexion : chemin interne uniquement. Tout caractère de contrôle,
 * espace ou barre oblique inverse est refusé (le navigateur retire tabulations et retours à la
 * ligne d'une URL : « /\t/site » deviendrait « //site ») ; la valeur est résolue et doit rester
 * sur la même origine.
 */
export function safeNext(value: string | null | undefined): string {
  if (!value || value.length > 512 || /[\x00-\x20\x7f\\]/.test(value) || !value.startsWith('/') || value.startsWith('//')) return '/';
  // Segments « . » / « .. », même encodés : « /.//site » deviendrait « //site » une fois normalisé
  let decoded = value;
  try { decoded = decodeURIComponent(value.split('?')[0]); } catch { return '/'; }
  if (/(^|\/)\.{1,2}(\/|$)/.test(decoded) || decoded.startsWith('//')) return '/';
  const base = 'http://scoutvision.invalid';
  let url: URL;
  try { url = new URL(value, base); } catch { return '/'; }
  const p = url.pathname;
  if (url.origin !== base || p.startsWith('//')) return '/';
  if (p === LOGIN_PATH || p.startsWith('/api/') || p.startsWith('/data/') || p.startsWith('/cdn/')) return '/';
  const result = `${p}${url.search}`;
  try { if (new URL(result, base).origin !== base) return '/'; } catch { return '/'; }
  return result;
}

/**
 * Adresse du client. Derrière le proxy de l'hébergeur, l'entrée la plus à droite de
 * X-Forwarded-For est celle que le proxy a ajoutée : les entrées de gauche viennent du client et
 * peuvent être inventées. Sans proxy de confiance : l'adresse de la socket.
 */
export function clientIp(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const hops = String(req.headers['x-forwarded-for'] ?? '').split(',').map(h => h.trim()).filter(Boolean);
    if (hops.length) return hops[hops.length - 1].slice(0, 64);
  }
  return req.socket?.remoteAddress ?? 'inconnu';
}

function requestOrigin(req: IncomingMessage, opts: PrivateServerOptions): string | null {
  const host = String(req.headers.host ?? '');
  if (!/^[A-Za-z0-9.-]+(:\d{1,5})?$/.test(host)) return null;
  const forwarded = opts.trustProxy ? String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim() : '';
  const socketProto = (req.socket as { encrypted?: boolean } | undefined)?.encrypted ? 'https' : 'http';
  const proto = forwarded === 'https' || forwarded === 'http' ? forwarded : socketProto;
  return `${proto}://${host}`;
}

/**
 * Mutation d'origine attendue : Origin (ou à défaut Referer) égal à l'origine du site, et
 * Sec-Fetch-Site différent de cross-site. Sans aucun de ces en-têtes, la requête est refusée.
 */
export function sameOriginRequest(req: IncomingMessage, opts: PrivateServerOptions): boolean {
  if (String(req.headers['sec-fetch-site'] ?? '') === 'cross-site') return false;
  const expected = new Set([requestOrigin(req, opts), ...(opts.allowedOrigins ?? [])].filter((o): o is string => !!o));
  const origin = req.headers.origin;
  if (typeof origin === 'string' && origin !== 'null') return expected.has(origin);
  const referer = req.headers.referer;
  if (typeof referer === 'string') {
    try { return expected.has(new URL(referer).origin); } catch { return false; }
  }
  return false;
}

function setSecurityHeaders(req: IncomingMessage, res: ServerResponse, opts: PrivateServerOptions) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  // En développement, Vite injecte des scripts en ligne (rechargement à chaud) : CSP hors dev seulement
  if (opts.mode !== 'dev') res.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY);
  const proto = opts.trustProxy ? String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim() : '';
  if (opts.hsts && (proto === 'https' || (!opts.trustProxy && opts.secureCookies))) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
}

/** Fichier sous `root` pour un chemin d'URL ; null s'il sort du dossier ou vise un fichier caché */
export function resolveUnder(root: string, urlPath: string): string | null {
  const segments = urlPath.split('/').filter(Boolean);
  if (segments.some(s => s.startsWith('.') || s === '..')) return null;
  const base = path.resolve(root);
  const file = path.resolve(base, ...segments);
  return file === base || file.startsWith(base + path.sep) ? file : null;
}

/** Envoi d'un fichier avec ETag, 304, HEAD et gzip pour les formats texte */
function serveFile(req: IncomingMessage, res: ServerResponse, file: string, cacheControl: string): boolean {
  let stat;
  try { stat = statSync(file); } catch { return false; }
  if (!stat.isFile()) return false;
  const ext = path.extname(file).toLowerCase();
  const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
  res.setHeader('Content-Type', CONTENT_TYPES[ext] ?? 'application/octet-stream');
  res.setHeader('Cache-Control', cacheControl);
  res.setHeader('ETag', etag);
  res.setHeader('Vary', 'Accept-Encoding, Cookie');
  if (req.headers['if-none-match'] === etag) { res.statusCode = 304; res.end(); return true; }
  const gzip = COMPRESSIBLE.has(ext) && stat.size > 1024 && /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''));
  res.statusCode = 200;
  if (gzip) res.setHeader('Content-Encoding', 'gzip');
  else res.setHeader('Content-Length', String(stat.size));
  if (req.method === 'HEAD') { res.end(); return true; }
  const stream = createReadStream(file);
  stream.on('error', () => res.destroy());
  if (gzip) stream.pipe(createGzip({ level: 6 })).pipe(res);
  else stream.pipe(res);
  return true;
}

/** Fichiers publics de la page de connexion, lus dans le manifeste du build (entrée login.html) */
export function loginAssetsFromManifest(distDir: string): Set<string> {
  const out = new Set<string>();
  const manifestPath = path.join(distDir, '.vite', 'manifest.json');
  if (!existsSync(manifestPath)) return out;
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, { file: string; css?: string[]; assets?: string[]; imports?: string[]; src?: string; isEntry?: boolean }>;
  const visit = (key: string) => {
    const chunk = manifest[key];
    if (!chunk || out.has(`/${chunk.file}`)) return;
    out.add(`/${chunk.file}`);
    chunk.css?.forEach(f => out.add(`/${f}`));
    chunk.assets?.forEach(f => out.add(`/${f}`));
    chunk.imports?.forEach(visit);
  };
  Object.entries(manifest).forEach(([key, chunk]) => { if (chunk.isEntry && (chunk.src === 'login.html' || key === 'login.html')) visit(key); });
  return out;
}

const isNavigation = (req: IncomingMessage, p: string) =>
  (req.method === 'GET' || req.method === 'HEAD')
  && (String(req.headers.accept ?? '').includes('text/html') || p === '/' || p === '/index.html' || path.extname(p) === '');

// ============================================
// MIDDLEWARE
// ============================================

export function createPrivateServer(opts: PrivateServerOptions) {
  const limiter = opts.limiter ?? new LoginLimiter();
  const revoked = opts.revoked ?? new RevocationList();
  const log = opts.log ?? (m => console.warn(m));
  const fetchImpl = opts.fetchImpl ?? fetch;
  const loginAssets = opts.distDir && opts.mode !== 'dev' ? loginAssetsFromManifest(opts.distDir) : new Set<string>();
  const cookieName = sessionCookieName(opts.secureCookies);

  const session = (req: IncomingMessage): SessionPayload | null =>
    opts.auth ? verifySessionToken(opts.auth, readCookie(req.headers.cookie, cookieName), revoked) : null;

  // ----- /api/auth/* -----
  async function authRoute(req: IncomingMessage, res: ServerResponse, p: string) {
    if (p === '/api/auth/session') {
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.setHeader('Allow', 'GET'); return sendJson(res, 405, { error: 'Méthode non autorisée.' }); }
      if (!opts.auth) return sendJson(res, 200, { authenticated: true, user: null, open: true });
      const s = session(req);
      // Sans session : 200 { authenticated: false } (état, pas une erreur ; aucune information de plus)
      return sendJson(res, 200, s ? { authenticated: true, user: s.u } : { authenticated: false });
    }
    if (p === '/api/auth/login' || p === '/api/auth/logout') {
      if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return sendJson(res, 405, { error: 'Méthode non autorisée.' }); }
      if (!sameOriginRequest(req, opts)) return sendJson(res, 403, { error: 'Origine de la requête refusée.' });
      if (p === '/api/auth/logout') {
        const s = session(req);
        if (s) revoked.revoke(s.jti, s.exp);
        res.setHeader('Set-Cookie', clearSessionCookie(opts.secureCookies));
        return sendJson(res, 200, { authenticated: false });
      }
      if (!opts.auth) return sendJson(res, 404, { error: 'Authentification non configurée.' });
      if (!String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) return sendJson(res, 415, { error: 'Content-Type application/json attendu.' });
      let body: unknown;
      try { body = JSON.parse(await readBody(req, 4096)); } catch { return sendJson(res, 400, { error: 'Requête invalide.' }); }
      const { username, password } = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
      if (typeof username !== 'string' || typeof password !== 'string' || username.length > 128 || password.length > 1024) {
        return sendJson(res, 400, { error: 'Requête invalide.' });
      }
      // Tentative réservée de façon synchrone, avant le calcul du hash (pas de contournement par rafale)
      const ip = clientIp(req, opts.trustProxy);
      const trusted = verifyDeviceToken(opts.auth, readCookie(req.headers.cookie, deviceCookieName(opts.secureCookies)));
      const slot = limiter.reserve(ip, Date.now(), trusted);
      if ('retryAfter' in slot) return sendJson(res, 429, { error: 'Trop de tentatives. Réessayez plus tard.', retryAfter: slot.retryAfter }, { 'Retry-After': String(slot.retryAfter) });
      let ok = false;
      try {
        if (slot.ok && slot.slow) await new Promise(resolve => setTimeout(resolve, 1000));
        ok = await checkCredentials(opts.auth, username, password);
      } finally {
        limiter.release(ip, ok, slot.ok && slot.trusted);
      }
      if (!ok) return sendJson(res, 401, { error: 'Identifiants incorrects.' });
      const { token, payload } = createSessionToken(opts.auth);
      res.setHeader('Set-Cookie', [sessionCookie(token, opts.secureCookies), deviceCookie(createDeviceToken(opts.auth), opts.secureCookies)]);
      return sendJson(res, 200, { authenticated: true, user: payload.u });
    }
    return sendJson(res, 404, { error: 'Introuvable.' });
  }

  // ----- /cdn/* : proxy restreint aux photos et logos PitchAPI -----
  async function cdnProxy(req: IncomingMessage, res: ServerResponse, p: string) {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.setHeader('Allow', 'GET'); return sendText(res, 405, 'Méthode non autorisée.'); }
    if (!CDN_PATTERN.test(p)) return sendText(res, 404, 'Introuvable.');
    let upstream: Response;
    try {
      upstream = await fetchImpl(`${CDN_ORIGIN}${p.slice('/cdn'.length)}`, { redirect: 'error', signal: AbortSignal.timeout(10_000) });
    } catch { return sendText(res, 502, 'Image indisponible.'); }
    const type = upstream.headers.get('content-type') ?? '';
    if (!upstream.ok || !type.startsWith('image/')) return sendText(res, upstream.status === 404 ? 404 : 502, 'Image indisponible.');
    const buf = Buffer.from(await upstream.arrayBuffer());
    if (buf.length > CDN_MAX_BYTES) return sendText(res, 502, 'Image indisponible.');
    res.statusCode = 200;
    res.setHeader('Content-Type', type);
    res.setHeader('Content-Length', String(buf.length));
    res.setHeader('Cache-Control', 'private, max-age=604800');
    res.end(req.method === 'HEAD' ? undefined : buf);
  }

  // ----- /data/* : fichiers JSON du dossier de données privé -----
  function dataFile(req: IncomingMessage, res: ServerResponse, p: string) {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.setHeader('Allow', 'GET'); return sendText(res, 405, 'Méthode non autorisée.'); }
    if (opts.dataReady && !opts.dataReady()) return sendJson(res, 503, { error: 'Données en cours de chargement. Réessayez dans un instant.' }, { 'Retry-After': '10' });
    const file = path.extname(p) === '.json' ? resolveUnder(opts.dataDir, p.slice('/data'.length)) : null;
    if (!file || !serveFile(req, res, file, 'private, no-cache')) sendJson(res, 404, { error: 'Introuvable.' });
  }

  function distFile(req: IncomingMessage, res: ServerResponse, p: string): boolean {
    if (!opts.distDir) return false;
    const file = resolveUnder(opts.distDir, p);
    if (!file) return false;
    const cache = p.startsWith('/assets/') ? 'private, max-age=31536000, immutable' : path.extname(p) === '.html' ? 'no-store' : 'private, max-age=3600';
    return serveFile(req, res, file, cache);
  }

  async function handle(req: IncomingMessage, res: ServerResponse, next: Next) {
    setSecurityHeaders(req, res, opts);
    const p = requestPath(req);
    if (p === null) return sendText(res, 400, 'Requête invalide.');
    if (p === '/healthz') return sendText(res, 200, 'ok');
    if (p.startsWith('/api/auth/')) return authRoute(req, res, p);

    const s = session(req);
    const authed = !opts.auth || !!s;

    // Page de connexion (déjà connecté : retour à l'application)
    if (p === LOGIN_PATH || p === '/login.html') {
      if (opts.auth && s) {
        const next = new URL(req.url ?? '/', 'http://x').searchParams.get('next');
        return redirect(res, safeNext(next));
      }
      res.setHeader('Cache-Control', 'no-store');
      if (opts.mode === 'production') return distFile(req, res, '/login.html') || sendText(res, 500, 'Page de connexion absente du build.');
      req.url = `/login.html${(req.url ?? '').includes('?') ? `?${(req.url ?? '').split('?')[1]}` : ''}`;
      return next();
    }

    if (PUBLIC_PATHS.has(p) || loginAssets.has(p)) {
      return opts.mode === 'production' ? (distFile(req, res, p) || sendText(res, 404, 'Introuvable.')) : next();
    }

    const isApi = p.startsWith('/api/');
    const isData = p === '/data' || p.startsWith('/data/');
    const isCdn = p.startsWith('/cdn/');

    if (!authed) {
      if (isApi || isData || isCdn) return sendJson(res, 401, { error: 'Authentification requise.' });
      // Développement : client de Vite et sources de la page de connexion, avant la détection des navigations
      // (/@vite/client n'a pas d'extension) ; le paramètre de requête ne peut viser un autre fichier
      if (opts.mode === 'dev' && devPublicPath(p) && !String(req.headers.accept ?? '').includes('text/html')) return next();
      if (isNavigation(req, p)) {
        const target = safeNext(req.url ?? '/');
        return redirect(res, target === '/' ? LOGIN_PATH : `${LOGIN_PATH}?next=${encodeURIComponent(target)}`);
      }
      return sendText(res, 401, 'Authentification requise.');
    }

    if (isApi) {
      if (req.method !== 'GET' && req.method !== 'HEAD' && !sameOriginRequest(req, opts)) return sendJson(res, 403, { error: 'Origine de la requête refusée.' });
      if (opts.api) {
        let passed = false;
        await opts.api(req, res, () => { passed = true; });
        if (!passed) return;
      }
      return sendJson(res, 404, { error: 'Introuvable.' });
    }
    if (isData) return dataFile(req, res, p);
    if (isCdn) return opts.cdn === 'proxy' ? cdnProxy(req, res, p) : next();

    if (opts.mode !== 'production') {
      if (isNavigation(req, p)) res.setHeader('Cache-Control', 'no-store');
      return next();
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.setHeader('Allow', 'GET'); return sendText(res, 405, 'Méthode non autorisée.'); }
    if (p !== '/' && p !== '/index.html' && distFile(req, res, p)) return;
    // Application à page unique : toute navigation interne rend index.html, jamais mis en cache
    if (isNavigation(req, p)) return distFile(req, res, '/index.html') || sendText(res, 500, 'Application absente du build.');
    return sendText(res, 404, 'Introuvable.');
  }

  return async (req: IncomingMessage, res: ServerResponse, next: Next = () => sendText(res, 404, 'Introuvable.')) => {
    try {
      await handle(req, res, next);
    } catch (error) {
      log(`Erreur serveur : ${error instanceof Error ? error.message : 'inconnue'}`);
      if (!res.headersSent) sendJson(res, 500, { error: 'Erreur serveur.' });
      else res.destroy();
    }
  };
}
