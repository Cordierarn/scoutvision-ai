/**
 * ScoutVision - authentification privée mono-utilisateur (serveur uniquement)
 *
 * - Mot de passe : jamais stocké en clair. SCOUTVISION_AUTH_PASSWORD_HASH contient un hash scrypt
 *   (node:crypto, primitive reconnue, paramètres dans le hash) au format
 *   `scrypt:<N>:<r>:<p>:<sel base64url>:<hash base64url>` (sans « $ », que dotenv développerait).
 * - Session : jeton signé HMAC-SHA256 avec SCOUTVISION_SESSION_SECRET, dans un cookie HttpOnly.
 *   Le jeton porte l'utilisateur, l'expiration (7 jours), un identifiant (révocation à la
 *   déconnexion) et une empreinte du hash du mot de passe : changer le mot de passe invalide
 *   toutes les sessions ; changer le secret de session aussi.
 * - Comparaisons à temps constant ; le hash est calculé même quand l'identifiant est faux, pour ne
 *   pas révéler lequel des deux est incorrect.
 * Ce module n'est jamais importé par le code du navigateur.
 */

import { createHash, createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';

// ============================================
// HASH DU MOT DE PASSE (scrypt)
// ============================================

export interface ScryptParams { N: number; r: number; p: number }

/**
 * Paramètres par défaut : N = 2^16, r = 8, p = 2 (l'une des combinaisons recommandées par l'OWASP,
 * même coût de calcul que N = 2^17, p = 1, mais 64 Mio de mémoire par vérification au lieu de 128 :
 * adapté à une instance de 512 Mo, avec au plus deux vérifications simultanées).
 */
export const DEFAULT_SCRYPT: ScryptParams = { N: 2 ** 16, r: 8, p: 2 };
/** Mémoire maximale acceptée pour un hash (128 × N × r), bornée pour la petite instance */
const MAX_SCRYPT_MEMORY = 128 * 1024 * 1024;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;

export interface PasswordHash extends ScryptParams { salt: Buffer; hash: Buffer }

const b64u = (buf: Buffer) => buf.toString('base64url');
const fromB64u = (s: string) => Buffer.from(s, 'base64url');

function scrypt(password: string, salt: Buffer, params: ScryptParams, keyLength: number): Promise<Buffer> {
  // Mémoire nécessaire : 128 × N × r octets ; marge pour le tampon de travail
  const maxmem = 256 * params.N * params.r + 16 * 1024 * 1024;
  return new Promise((resolve, reject) => {
    scryptCb(password.normalize('NFKC'), salt, keyLength, { N: params.N, r: params.r, p: params.p, maxmem }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

/** Hash d'un mot de passe, au format stocké dans SCOUTVISION_AUTH_PASSWORD_HASH */
export async function hashPassword(password: string, params: ScryptParams = DEFAULT_SCRYPT): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const hash = await scrypt(password, salt, params, KEY_LENGTH);
  return ['scrypt', params.N, params.r, params.p, b64u(salt), b64u(hash)].join(':');
}

/** Lecture stricte du hash ; null si le format ou les paramètres ne sont pas acceptables */
export function parsePasswordHash(value: string | undefined): PasswordHash | null {
  if (!value) return null;
  const parts = value.trim().split(':');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null;
  const [N, r, p] = parts.slice(1, 4).map(Number);
  if (![N, r, p].every(Number.isInteger)) return null;
  // N puissance de 2 entre 2^14 et 2^20 ; r et p bornés (pas de paramètre faible ni de déni de service)
  if (N < 2 ** 14 || N > 2 ** 20 || (N & (N - 1)) !== 0 || r < 8 || r > 32 || p < 1 || p > 4) return null;
  if (128 * N * r > MAX_SCRYPT_MEMORY) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(parts[4]) || !/^[A-Za-z0-9_-]+$/.test(parts[5])) return null;
  const salt = fromB64u(parts[4]);
  const hash = fromB64u(parts[5]);
  if (salt.length < 16 || hash.length < 32 || hash.length > 64) return null;
  return { N, r, p, salt, hash };
}

/** Vérification à temps constant */
export async function verifyPassword(password: string, stored: PasswordHash): Promise<boolean> {
  const candidate = await scrypt(password, stored.salt, stored, stored.hash.length);
  return candidate.length === stored.hash.length && timingSafeEqual(candidate, stored.hash);
}

// ============================================
// CONFIGURATION
// ============================================

export interface AuthConfig {
  user: string;
  password: PasswordHash;
  sessionSecret: Buffer;
  /** Empreinte du hash : liée aux sessions, un nouveau mot de passe les invalide toutes */
  passwordFingerprint: string;
}

export class AuthConfigError extends Error {}

export const AUTH_ENV = ['SCOUTVISION_AUTH_USER', 'SCOUTVISION_AUTH_PASSWORD_HASH', 'SCOUTVISION_SESSION_SECRET'] as const;
const MIN_SECRET_BYTES = 32;

/**
 * Configuration d'authentification lue dans l'environnement du serveur.
 * - Les trois variables absentes : null (mode local ouvert, refusé en production par l'appelant).
 * - Variables partielles, hash invalide ou secret trop court : AuthConfigError (jamais de démarrage
 *   à moitié protégé). Le message nomme la variable, jamais sa valeur.
 */
export function loadAuthConfig(env: Record<string, string | undefined>): AuthConfig | null {
  const present = AUTH_ENV.filter(k => (env[k] ?? '').trim() !== '');
  if (present.length === 0) return null;
  const missing = AUTH_ENV.filter(k => !present.includes(k));
  if (missing.length) throw new AuthConfigError(`Authentification incomplète : variable(s) manquante(s) ${missing.join(', ')}.`);
  const user = env.SCOUTVISION_AUTH_USER!.trim();
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(user)) throw new AuthConfigError('SCOUTVISION_AUTH_USER invalide (lettres, chiffres, . _ -).');
  const password = parsePasswordHash(env.SCOUTVISION_AUTH_PASSWORD_HASH);
  if (!password) throw new AuthConfigError('SCOUTVISION_AUTH_PASSWORD_HASH invalide : générez-le avec npm run auth:secret.');
  const rawSecret = env.SCOUTVISION_SESSION_SECRET!.trim();
  const sessionSecret = /^[A-Za-z0-9_-]+$/.test(rawSecret) ? fromB64u(rawSecret) : Buffer.from(rawSecret, 'utf8');
  if (sessionSecret.length < MIN_SECRET_BYTES) throw new AuthConfigError(`SCOUTVISION_SESSION_SECRET trop court (${MIN_SECRET_BYTES} octets aléatoires au minimum).`);
  const passwordFingerprint = b64u(createHmac('sha256', sessionSecret).update('password:').update(password.hash).digest().subarray(0, 12));
  return { user, password, sessionSecret, passwordFingerprint };
}

// ============================================
// CONNEXION
// ============================================

const digest = (s: string) => createHash('sha256').update(s, 'utf8').digest();

/**
 * Identifiants valides ? Le hash du mot de passe est toujours calculé (même identifiant faux) et
 * l'identifiant comparé à temps constant : la réponse et sa durée ne disent pas lequel est faux.
 */
export async function checkCredentials(config: AuthConfig, username: string, password: string): Promise<boolean> {
  const userOk = timingSafeEqual(digest(username), digest(config.user));
  const passwordOk = await verifyPassword(password, config.password);
  return userOk && passwordOk;
}

// ============================================
// SESSION (jeton signé)
// ============================================

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface SessionPayload {
  u: string;      // utilisateur
  iat: number;    // émission (ms)
  exp: number;    // expiration (ms)
  jti: string;    // identifiant de session (révocation)
  k: string;      // empreinte du hash du mot de passe
}

const sign = (secret: Buffer, data: string) => createHmac('sha256', secret).update(data).digest();

export function createSessionToken(config: AuthConfig, now = Date.now(), ttlMs = SESSION_TTL_MS): { token: string; payload: SessionPayload } {
  const payload: SessionPayload = { u: config.user, iat: now, exp: now + ttlMs, jti: b64u(randomBytes(16)), k: config.passwordFingerprint };
  const body = b64u(Buffer.from(JSON.stringify(payload), 'utf8'));
  return { token: `${body}.${b64u(sign(config.sessionSecret, body))}`, payload };
}

/** Sessions déconnectées avant leur expiration (en mémoire du processus) */
export class RevocationList {
  private revoked = new Map<string, number>();
  revoke(jti: string, exp: number) { this.purge(); this.revoked.set(jti, exp); }
  has(jti: string) { return this.revoked.has(jti); }
  private purge(now = Date.now()) { this.revoked.forEach((exp, jti) => { if (exp <= now) this.revoked.delete(jti); }); }
}

/** Jeton valide (signature, expiration, utilisateur, mot de passe courant, non révoqué) ; null sinon */
export function verifySessionToken(config: AuthConfig, token: string | undefined, revoked?: RevocationList, now = Date.now()): SessionPayload | null {
  if (!token || token.length > 1024) return null;
  const dot = token.indexOf('.');
  if (dot <= 0 || dot !== token.lastIndexOf('.')) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!/^[A-Za-z0-9_-]+$/.test(body) || !/^[A-Za-z0-9_-]+$/.test(sig)) return null;
  const expected = sign(config.sessionSecret, body);
  const given = fromB64u(sig);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let payload: SessionPayload;
  try { payload = JSON.parse(fromB64u(body).toString('utf8')); } catch { return null; }
  if (!payload || typeof payload !== 'object') return null;
  if (typeof payload.exp !== 'number' || payload.exp <= now) return null;
  if (typeof payload.iat !== 'number' || payload.iat > now + 60_000) return null;
  if (payload.u !== config.user || payload.k !== config.passwordFingerprint) return null;
  if (typeof payload.jti !== 'string' || (revoked && revoked.has(payload.jti))) return null;
  return payload;
}

// ============================================
// APPAREIL CONNU (cookie d'appareil, modèle OWASP « device cookies »)
// ============================================

export const DEVICE_TTL_MS = 180 * 24 * 60 * 60 * 1000;

/**
 * Jeton d'appareil posé après une connexion réussie et conservé après la déconnexion. Il ne
 * donne aucun accès : il permet seulement à ce navigateur de garder une place de vérification
 * réservée quand des tiers saturent la connexion. Signé avec le secret de session, préfixe distinct
 * des jetons de session (jamais interchangeables).
 */
export function createDeviceToken(config: AuthConfig, now = Date.now()): string {
  const body = b64u(Buffer.from(JSON.stringify({ t: 'device', u: config.user, exp: now + DEVICE_TTL_MS, d: b64u(randomBytes(12)) }), 'utf8'));
  return `${body}.${b64u(sign(config.sessionSecret, `device.${body}`))}`;
}

export function verifyDeviceToken(config: AuthConfig, token: string | undefined, now = Date.now()): boolean {
  if (!token || token.length > 512) return false;
  const [body, sig, extra] = token.split('.');
  if (!body || !sig || extra !== undefined || !/^[A-Za-z0-9_-]+$/.test(body) || !/^[A-Za-z0-9_-]+$/.test(sig)) return false;
  const expected = sign(config.sessionSecret, `device.${body}`);
  const given = fromB64u(sig);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return false;
  try {
    const payload = JSON.parse(fromB64u(body).toString('utf8'));
    return payload?.t === 'device' && payload.u === config.user && typeof payload.exp === 'number' && payload.exp > now;
  } catch { return false; }
}

export const deviceCookieName = (secure: boolean) => (secure ? '__Host-sv_device' : 'sv_device');

export function deviceCookie(token: string, secure: boolean): string {
  return [`${deviceCookieName(secure)}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${Math.floor(DEVICE_TTL_MS / 1000)}`, ...(secure ? ['Secure'] : [])].join('; ');
}

// ============================================
// COOKIE
// ============================================

/** Préfixe __Host- en HTTPS : cookie limité à l'hôte exact, Secure et Path=/ imposés par le navigateur */
export const sessionCookieName = (secure: boolean) => (secure ? '__Host-sv_session' : 'sv_session');

export function sessionCookie(token: string, secure: boolean, maxAgeMs = SESSION_TTL_MS): string {
  return [`${sessionCookieName(secure)}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${Math.floor(maxAgeMs / 1000)}`, ...(secure ? ['Secure'] : [])].join('; ');
}

export function clearSessionCookie(secure: boolean): string {
  return [`${sessionCookieName(secure)}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0', ...(secure ? ['Secure'] : [])].join('; ');
}

/** Valeur d'un cookie de l'en-tête Cookie ; la première occurrence l'emporte */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

// ============================================
// LIMITE DES TENTATIVES
// ============================================

export type Reservation = { ok: true; slow: boolean; trusted: boolean } | { ok: false; retryAfter: number; reason: 'ip' | 'busy' };

/**
 * Tentatives de connexion :
 * - par adresse : au plus `limit` échecs par fenêtre de 15 minutes, puis 429 jusqu'à la fin de la
 *   fenêtre ; une connexion réussie remet le compteur de l'adresse à zéro ;
 * - la tentative est comptée AVANT le calcul du hash (réservation synchrone) : une rafale de
 *   requêtes simultanées ne contourne pas la limite ;
 * - au plus `maxConcurrent` vérifications scrypt en même temps (mémoire bornée), les autres
 *   reçoivent 429 tout de suite ;
 * - au-delà de `globalSoftLimit` échecs toutes adresses confondues, les vérifications passent une
 *   à une et sont ralenties ;
 * - un navigateur porteur d'un cookie d'appareil connu (connexion réussie auparavant) garde sa
 *   propre place de vérification, hors ralentissement : des tiers qui saturent la connexion ne
 *   peuvent pas en exclure le propriétaire. La limite par adresse s'applique toujours.
 */
export class LoginLimiter {
  private byIp = new Map<string, { count: number; reset: number }>();
  private global = { count: 0, reset: 0 };
  private inFlight = 0;
  private trustedInFlight = 0;
  constructor(private limit = 5, private windowMs = 15 * 60 * 1000, private globalSoftLimit = 50, private maxConcurrent = 2) {}

  /** Secondes avant une nouvelle tentative pour cette adresse ; 0 si autorisée */
  retryAfter(ip: string, now = Date.now()): number {
    const e = this.byIp.get(ip);
    return e && e.reset > now && e.count >= this.limit ? Math.ceil((e.reset - now) / 1000) : 0;
  }

  /** Échecs nombreux toutes adresses confondues : vérifications une à une et ralenties */
  underPressure(now = Date.now()): boolean {
    return this.global.reset > now && this.global.count >= this.globalSoftLimit;
  }

  /** Réserve une tentative (comptée comme un échec jusqu'à preuve du contraire) */
  reserve(ip: string, now = Date.now(), trusted = false): Reservation {
    const wait = this.retryAfter(ip, now);
    if (wait > 0) return { ok: false, retryAfter: wait, reason: 'ip' };
    if (trusted) {
      if (this.trustedInFlight >= 1) return { ok: false, retryAfter: 1, reason: 'busy' };
      this.fail(ip, now);
      this.trustedInFlight++;
      return { ok: true, slow: false, trusted: true };
    }
    const slow = this.underPressure(now);
    if (this.inFlight >= (slow ? 1 : this.maxConcurrent)) return { ok: false, retryAfter: 2, reason: 'busy' };
    this.fail(ip, now);
    this.inFlight++;
    return { ok: true, slow, trusted: false };
  }

  /** Fin de la vérification : un succès efface les échecs de l'adresse et rend sa part du compteur global */
  release(ip: string, success: boolean, trusted = false) {
    if (trusted) this.trustedInFlight = Math.max(0, this.trustedInFlight - 1);
    else this.inFlight = Math.max(0, this.inFlight - 1);
    if (success) {
      this.byIp.delete(ip);
      if (this.global.count > 0) this.global.count--;
    }
  }

  fail(ip: string, now = Date.now()) {
    if (this.byIp.size > 10_000) this.byIp.forEach((v, k) => { if (v.reset <= now) this.byIp.delete(k); });
    const e = this.byIp.get(ip);
    if (!e || e.reset <= now) this.byIp.set(ip, { count: 1, reset: now + this.windowMs });
    else e.count++;
    if (this.global.reset <= now) this.global = { count: 1, reset: now + this.windowMs };
    else this.global.count++;
  }

  succeed(ip: string) { this.byIp.delete(ip); }
}
