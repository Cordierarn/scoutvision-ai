import { describe, expect, it } from 'vitest';
import {
  AuthConfigError, LoginLimiter, RevocationList, checkCredentials, clearSessionCookie, createDeviceToken, createSessionToken, hashPassword, verifyDeviceToken,
  loadAuthConfig, parsePasswordHash, readCookie, sessionCookie, verifyPassword, verifySessionToken,
} from './auth';
import { hashPassword as cliHash, generatePassword } from '../scripts/auth_secret.mjs';

// Paramètres scrypt réduits pour la vitesse des tests (minimum accepté par le serveur)
const FAST = { N: 2 ** 14, r: 8, p: 1 };
const SECRET = Buffer.alloc(32, 7).toString('base64url');   // secret de test synthétique

async function config(password = 'mot-de-passe-de-test-synthétique') {
  const hash = await hashPassword(password, FAST);
  return loadAuthConfig({ SCOUTVISION_AUTH_USER: 'arnaud', SCOUTVISION_AUTH_PASSWORD_HASH: hash, SCOUTVISION_SESSION_SECRET: SECRET })!;
}

describe('hash du mot de passe', () => {
  it('vérifie le bon mot de passe et refuse les autres', async () => {
    const parsed = parsePasswordHash(await hashPassword('correct horse battery', FAST))!;
    expect(await verifyPassword('correct horse battery', parsed)).toBe(true);
    expect(await verifyPassword('correct horse batterY', parsed)).toBe(false);
    expect(await verifyPassword('', parsed)).toBe(false);
  });

  it('rejette un hash invalide ou trop faible', async () => {
    const good = await hashPassword('x'.repeat(16), FAST);
    expect(parsePasswordHash(good)).not.toBeNull();
    expect(parsePasswordHash(undefined)).toBeNull();
    expect(parsePasswordHash('mot-de-passe-en-clair')).toBeNull();
    expect(parsePasswordHash(good.replace('scrypt:', 'md5:'))).toBeNull();
    expect(parsePasswordHash(good.replace(':16384:', ':1024:'))).toBeNull();     // N trop faible
    expect(parsePasswordHash(good.replace(':16384:', ':20000:'))).toBeNull();    // N non puissance de 2
    expect(parsePasswordHash(good.replace(':8:1:', ':1:1:'))).toBeNull();        // r trop faible
    expect(parsePasswordHash(good.replace(':16384:', ':262144:'))).toBeNull();   // 256 Mio : trop pour l'instance
    expect(parsePasswordHash(good.split(':').slice(0, 5).join(':'))).toBeNull(); // hash absent
    expect(parsePasswordHash(`scrypt:16384:8:1:${Buffer.alloc(4).toString('base64url')}:${Buffer.alloc(32).toString('base64url')}`)).toBeNull(); // sel trop court
  });

  it('le générateur local produit un hash lu par le serveur', async () => {
    const password = generatePassword();
    expect(password).toMatch(/^[A-Za-z2-9]{24}$/);
    const parsed = parsePasswordHash(await cliHash(password, FAST))!;
    expect(parsed).not.toBeNull();
    expect(await verifyPassword(password, parsed)).toBe(true);
  });
});

describe('configuration', () => {
  it('sans aucune variable : null (mode local) ; incomplète ou invalide : erreur sans valeur', async () => {
    expect(loadAuthConfig({})).toBeNull();
    expect(() => loadAuthConfig({ SCOUTVISION_AUTH_USER: 'arnaud' })).toThrow(AuthConfigError);
    const hash = await hashPassword('x'.repeat(16), FAST);
    expect(() => loadAuthConfig({ SCOUTVISION_AUTH_USER: 'arnaud', SCOUTVISION_AUTH_PASSWORD_HASH: hash })).toThrow(/SCOUTVISION_SESSION_SECRET/);
    expect(() => loadAuthConfig({ SCOUTVISION_AUTH_USER: 'arnaud', SCOUTVISION_AUTH_PASSWORD_HASH: 'clair', SCOUTVISION_SESSION_SECRET: SECRET })).toThrow(/SCOUTVISION_AUTH_PASSWORD_HASH invalide/);
    const short = () => loadAuthConfig({ SCOUTVISION_AUTH_USER: 'arnaud', SCOUTVISION_AUTH_PASSWORD_HASH: hash, SCOUTVISION_SESSION_SECRET: 'court' });
    expect(short).toThrow(/trop court/);
    try { short(); } catch (e) { expect(String(e)).not.toContain(hash); }
  });
});

describe('identifiants', () => {
  it('même réponse pour un identifiant ou un mot de passe faux', async () => {
    const c = await config('le-bon-mot-de-passe');
    expect(await checkCredentials(c, 'arnaud', 'le-bon-mot-de-passe')).toBe(true);
    expect(await checkCredentials(c, 'admin', 'le-bon-mot-de-passe')).toBe(false);
    expect(await checkCredentials(c, 'arnaud', 'mauvais')).toBe(false);
    expect(await checkCredentials(c, 'Arnaud', 'le-bon-mot-de-passe')).toBe(false);
  });
});

describe('jeton de session', () => {
  it('valide, expiré, falsifié, révoqué, mot de passe changé', async () => {
    const c = await config();
    const now = Date.now();
    const { token, payload } = createSessionToken(c, now);
    expect(verifySessionToken(c, token, undefined, now + 1000)?.u).toBe('arnaud');
    expect(payload.exp - payload.iat).toBe(7 * 24 * 3600 * 1000);
    // expiré
    expect(verifySessionToken(c, token, undefined, payload.exp + 1)).toBeNull();
    // signature modifiée ou charge utile modifiée
    expect(verifySessionToken(c, `${token}x`)).toBeNull();
    const [body, sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ ...payload, exp: now + 10 * SESSION_YEARS })).toString('base64url');
    expect(verifySessionToken(c, `${forged}.${sig}`)).toBeNull();
    expect(verifySessionToken(c, body)).toBeNull();
    // révoqué
    const revoked = new RevocationList();
    revoked.revoke(payload.jti, payload.exp);
    expect(verifySessionToken(c, token, revoked)).toBeNull();
    // autre secret de session : toutes les sessions tombent
    const other = loadAuthConfig({ SCOUTVISION_AUTH_USER: 'arnaud', SCOUTVISION_AUTH_PASSWORD_HASH: hashOf(c), SCOUTVISION_SESSION_SECRET: Buffer.alloc(32, 9).toString('base64url') })!;
    expect(verifySessionToken(other, token)).toBeNull();
    // nouveau mot de passe : toutes les sessions tombent
    const changed = await config('nouveau-mot-de-passe-synthétique');
    expect(verifySessionToken(changed, token)).toBeNull();
  });
});

const SESSION_YEARS = 365 * 24 * 3600 * 1000;
function hashOf(c: NonNullable<ReturnType<typeof loadAuthConfig>>) {
  return ['scrypt', c.password.N, c.password.r, c.password.p, c.password.salt.toString('base64url'), c.password.hash.toString('base64url')].join(':');
}

describe('cookie', () => {
  it('HttpOnly, Secure, SameSite=Lax, Path=/, 7 jours, préfixe __Host- en HTTPS', () => {
    const c = sessionCookie('abc.def', true);
    expect(c).toMatch(/^__Host-sv_session=abc\.def;/);
    ['Path=/', 'HttpOnly', 'SameSite=Lax', 'Secure', 'Max-Age=604800'].forEach(flag => expect(c).toContain(flag));
    expect(c).not.toMatch(/Domain=/i);
    expect(sessionCookie('abc.def', false)).not.toContain('Secure');
    expect(clearSessionCookie(true)).toContain('Max-Age=0');
    expect(readCookie('a=1; __Host-sv_session=tok; b=2', '__Host-sv_session')).toBe('tok');
    expect(readCookie(undefined, 'x')).toBeUndefined();
  });
});

describe('cookie d\'appareil', () => {
  it('signé, propre à l\'utilisateur, distinct d\'un jeton de session', async () => {
    const c = await config();
    const token = createDeviceToken(c);
    expect(verifyDeviceToken(c, token)).toBe(true);
    expect(verifyDeviceToken(c, `${token}x`)).toBe(false);
    expect(verifyDeviceToken(c, createSessionToken(c).token)).toBe(false);          // un jeton de session n'est pas un jeton d'appareil
    expect(verifySessionToken(c, token)).toBeNull();                                // et inversement
    expect(verifyDeviceToken(c, token, Date.now() + 181 * 24 * 3600 * 1000)).toBe(false);
  });
});

describe('limite des tentatives', () => {
  it('5 échecs par adresse sur 15 minutes, puis 429 ; jamais de blocage définitif', () => {
    const l = new LoginLimiter(5, 15 * 60 * 1000, 50);
    const t = 1_000_000;
    for (let i = 0; i < 5; i++) { expect(l.retryAfter('1.1.1.1', t)).toBe(0); l.fail('1.1.1.1', t); }
    expect(l.retryAfter('1.1.1.1', t)).toBe(900);
    expect(l.retryAfter('2.2.2.2', t)).toBe(0);                    // autre adresse
    expect(l.retryAfter('1.1.1.1', t + 15 * 60 * 1000)).toBe(0);    // fenêtre écoulée
    l.succeed('1.1.1.1');
    expect(l.retryAfter('1.1.1.1', t)).toBe(0);
  });

  it('réservation synchrone : une rafale simultanée ne dépasse pas la limite', () => {
    const l = new LoginLimiter(5, 60_000, 50, 100);
    const results = Array.from({ length: 40 }, () => l.reserve('9.9.9.9', 0));   // aucune ne s'est encore terminée
    expect(results.filter(r => r.ok)).toHaveLength(5);
    expect(results.filter(r => !r.ok).every(r => 'reason' in r && r.reason === 'ip')).toBe(true);
  });

  it('au plus deux vérifications simultanées (mémoire bornée), libérées à la fin', () => {
    const l = new LoginLimiter(5, 60_000, 50, 2);
    expect(l.reserve('a', 0).ok).toBe(true);
    expect(l.reserve('b', 0).ok).toBe(true);
    const third = l.reserve('c', 0);
    expect(third.ok).toBe(false);
    expect('reason' in third && third.reason).toBe('busy');
    l.release('a', false);
    expect(l.reserve('c', 0).ok).toBe(true);
  });

  it('beaucoup d\'échecs toutes adresses confondues : ralentissement, jamais de blocage du propriétaire', () => {
    const l = new LoginLimiter(5, 60_000, 10, 2);
    for (let i = 0; i < 10; i++) l.fail(`10.0.0.${i}`, 0);
    expect(l.underPressure(0)).toBe(true);
    const stranger = l.reserve('192.0.2.1', 0);
    expect(stranger).toEqual({ ok: true, slow: true, trusted: false });
    expect(l.reserve('192.0.2.2', 0).ok).toBe(false);              // une seule vérification à la fois sous pression
    // Appareil connu : sa propre place, sans ralentissement, même quand l'autre place est occupée
    expect(l.reserve('192.0.2.9', 0, true)).toEqual({ ok: true, slow: false, trusted: true });
    l.release('192.0.2.9', true, true);
    l.release('192.0.2.1', true);                                  // succès : l'adresse repart à zéro
    expect(l.retryAfter('192.0.2.1', 0)).toBe(0);
  });
});
