import { describe, expect, it } from 'vitest';
import {
  AuthConfigError, LoginLimiter, RevocationList, checkCredentials, clearSessionCookie, createDeviceToken, createSessionToken, hashPassword, verifyDeviceToken,
  loadAuthConfig, parsePasswordHash, readCookie, sessionCookie, verifyPassword, verifySessionToken, authenticate, PRO_SESSION_TTL_MS, SESSION_TTL_MS,
} from './auth';
import { createHmac } from 'node:crypto';
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
  it('signé, propre à l\'utilisateur et au mot de passe courant, distinct d\'un jeton de session', async () => {
    const c = await config();
    const token = createDeviceToken(c);
    expect(verifyDeviceToken(c, token)).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(verifyDeviceToken(c, `${token}x`)).toBeNull();
    expect(verifyDeviceToken(c, createSessionToken(c).token)).toBeNull();          // un jeton de session n'est pas un jeton d'appareil
    expect(verifySessionToken(c, token)).toBeNull();                                // et inversement
    expect(verifyDeviceToken(c, token, Date.now() + 181 * 24 * 3600 * 1000)).toBeNull();
    // nouveau mot de passe (même secret de session) : cookie d'appareil volé sans valeur
    const changed = loadAuthConfig({ SCOUTVISION_AUTH_USER: 'arnaud', SCOUTVISION_AUTH_PASSWORD_HASH: await hashPassword('autre-mot-de-passe-synthétique', FAST), SCOUTVISION_SESSION_SECRET: SECRET })!;
    expect(verifyDeviceToken(changed, token)).toBeNull();
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
    expect(l.reserve('192.0.2.9', 0, 'appareil-1')).toEqual({ ok: true, slow: false, trusted: true });
    l.release('192.0.2.9', true, true, 'appareil-1');
    l.release('192.0.2.1', true);                                  // succès : l'adresse repart à zéro
    expect(l.retryAfter('192.0.2.1', 0)).toBe(0);
  });
});

describe('appareil connu et limite', () => {
  it('3 échecs avec un même cookie d\'appareil : plus de place réservée ; place occupée : file normale', () => {
    const l = new LoginLimiter(50, 60_000, 50, 2);
    for (let i = 0; i < 3; i++) {
      const r = l.reserve('203.0.113.9', 0, 'vole');
      expect(r).toMatchObject({ ok: true, trusted: true });
      l.release('203.0.113.9', false, true, 'vole', 0);
    }
    expect(l.reserve('203.0.113.9', 0, 'vole')).toMatchObject({ ok: true, trusted: false });
    // Place réservée occupée par un autre appareil : le propriétaire passe par la file normale
    const l2 = new LoginLimiter(5, 60_000, 50, 2);
    expect(l2.reserve('1.1.1.1', 0, 'a')).toMatchObject({ ok: true, trusted: true });
    expect(l2.reserve('2.2.2.2', 0, 'b')).toMatchObject({ ok: true, trusted: false });
  });
});

// ============================================
// COMPTE PRO (second compte, sans la page Pronostics)
// ============================================

const PRO_PASSWORD = 'mot-de-passe-pro-synthétique';
async function twoAccounts() {
  return loadAuthConfig({
    SCOUTVISION_AUTH_USER: 'arnaud', SCOUTVISION_AUTH_PASSWORD_HASH: await hashPassword('mot-de-passe-de-test-synthétique', FAST),
    SCOUTVISION_PRO_USER: 'compte-pro-test', SCOUTVISION_PRO_PASSWORD_HASH: await hashPassword(PRO_PASSWORD, FAST),
    SCOUTVISION_SESSION_SECRET: SECRET,
  })!;
}
const forge = (token: string, edit: (p: Record<string, unknown>) => void) => {
  const [body, sig] = token.split('.');
  const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  edit(p);
  return `${Buffer.from(JSON.stringify(p), 'utf8').toString('base64url')}.${sig}`;
};

describe('compte pro : configuration', () => {
  it('facultatif ; incomplet, invalide ou identique au propriétaire : erreur au démarrage', async () => {
    expect((await config()).pro).toBeNull();                                  // variables absentes : comportement inchangé
    const c = await twoAccounts();
    expect(c.pro?.user).toBe('compte-pro-test');
    expect(c.pro?.role).toBe('pro');
    expect(c.pro?.passwordFingerprint).not.toBe(c.passwordFingerprint);
    const base = { SCOUTVISION_AUTH_USER: 'arnaud', SCOUTVISION_AUTH_PASSWORD_HASH: await hashPassword('x'.repeat(16), FAST), SCOUTVISION_SESSION_SECRET: SECRET };
    const proHash = await hashPassword('y'.repeat(16), FAST);
    expect(() => loadAuthConfig({ ...base, SCOUTVISION_PRO_USER: 'compte-pro-test' })).toThrow(/SCOUTVISION_PRO_PASSWORD_HASH/);
    expect(() => loadAuthConfig({ ...base, SCOUTVISION_PRO_PASSWORD_HASH: proHash })).toThrow(/SCOUTVISION_PRO_USER/);
    expect(() => loadAuthConfig({ ...base, SCOUTVISION_PRO_USER: 'compte-pro-test', SCOUTVISION_PRO_PASSWORD_HASH: 'clair' })).toThrow(/SCOUTVISION_PRO_PASSWORD_HASH invalide/);
    expect(() => loadAuthConfig({ ...base, SCOUTVISION_PRO_USER: 'pas valide!', SCOUTVISION_PRO_PASSWORD_HASH: proHash })).toThrow(/SCOUTVISION_PRO_USER invalide/);
    for (const same of ['arnaud', 'Arnaud']) expect(() => loadAuthConfig({ ...base, SCOUTVISION_PRO_USER: same, SCOUTVISION_PRO_PASSWORD_HASH: proHash })).toThrow(/identiques/);
  });
});

describe('compte pro : connexion et jeton', () => {
  it('chaque compte se connecte avec son propre mot de passe et reçoit son rôle', async () => {
    const c = await twoAccounts();
    expect((await authenticate(c, 'arnaud', 'mot-de-passe-de-test-synthétique'))?.role).toBe('owner');
    expect((await authenticate(c, 'compte-pro-test', PRO_PASSWORD))?.role).toBe('pro');
    expect(await authenticate(c, 'compte-pro-test', 'mot-de-passe-de-test-synthétique')).toBeNull();   // pas de mot de passe croisé
    expect(await authenticate(c, 'arnaud', PRO_PASSWORD)).toBeNull();
    expect(await authenticate(c, 'inconnu', PRO_PASSWORD)).toBeNull();
  });

  it('rôle signé et revérifié : falsification, rôle échangé ou ancien jeton pro refusés ; ancien jeton propriétaire accepté', async () => {
    const c = await twoAccounts();
    const now = Date.now();
    const pro = createSessionToken(c, now, undefined, c.pro!).token;
    const owner = createSessionToken(c, now).token;
    expect(verifySessionToken(c, pro)?.r).toBe('pro');
    expect(verifySessionToken(c, owner)?.r).toBe('owner');
    expect(verifySessionToken(c, forge(pro, p => { p.r = 'owner'; }))).toBeNull();                 // signature cassée
    expect(verifySessionToken(c, forge(pro, p => { p.u = 'arnaud'; }))).toBeNull();
    // jeton correctement signé mais incohérent : rôle propriétaire pour le compte pro, ou l'inverse
    const sign = (p: Record<string, unknown>) => { const body = Buffer.from(JSON.stringify(p), 'utf8').toString('base64url'); return `${body}.${createHmac('sha256', c.sessionSecret).update(body).digest('base64url')}`; };
    const payload = (u: string, k: string, r?: string) => ({ u, iat: now, exp: now + 3600_000, jti: 'j', k, ...(r ? { r } : {}) });
    expect(verifySessionToken(c, sign(payload('compte-pro-test', c.pro!.passwordFingerprint, 'owner')))).toBeNull();
    expect(verifySessionToken(c, sign(payload('arnaud', c.passwordFingerprint, 'pro')))).toBeNull();
    expect(verifySessionToken(c, sign(payload('compte-pro-test', c.passwordFingerprint, 'pro')))).toBeNull();   // empreinte d'un autre compte
    // ancien jeton sans rôle : propriétaire seulement (identifiant et empreinte du propriétaire)
    expect(verifySessionToken(c, sign(payload('arnaud', c.passwordFingerprint)))?.r).toBe('owner');
    expect(verifySessionToken(c, sign(payload('compte-pro-test', c.pro!.passwordFingerprint)))).toBeNull();
    expect(verifySessionToken(c, sign(payload('arnaud', c.passwordFingerprint, 'admin')))).toBeNull();
  });

  it('session pro d\'un jour, propriétaire de sept jours ; compte pro retiré ou mot de passe changé : ses sessions tombent', async () => {
    const c = await twoAccounts();
    const now = Date.now();
    expect(createSessionToken(c, now, undefined, c.pro!).payload.exp - now).toBe(PRO_SESSION_TTL_MS);
    expect(PRO_SESSION_TTL_MS).toBe(24 * 3600 * 1000);
    expect(createSessionToken(c, now).payload.exp - now).toBe(SESSION_TTL_MS);
    const pro = createSessionToken(c, now, undefined, c.pro!).token;
    expect(verifySessionToken(c, pro, undefined, now + PRO_SESSION_TTL_MS + 1)).toBeNull();
    const withoutPro = loadAuthConfig({ SCOUTVISION_AUTH_USER: 'arnaud', SCOUTVISION_AUTH_PASSWORD_HASH: hashOf(c), SCOUTVISION_SESSION_SECRET: SECRET })!;
    expect(verifySessionToken(withoutPro, pro)).toBeNull();
    const owner = createSessionToken(c, now).token;
    expect(verifySessionToken(withoutPro, owner)?.r).toBe('owner');           // le propriétaire reste connecté
    expect(sessionCookie(pro, true, PRO_SESSION_TTL_MS)).toContain('Max-Age=86400');
  });

  it('cookie d\'appareil du compte pro, lié à son mot de passe', async () => {
    const c = await twoAccounts();
    expect(verifyDeviceToken(c, createDeviceToken(c, Date.now(), c.pro!))).toBeTypeOf('string');
  });
});
