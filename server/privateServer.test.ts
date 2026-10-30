import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, Server } from 'node:http';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AddressInfo } from 'node:net';
import { AuthConfig, LoginLimiter, createSessionToken, hashPassword, loadAuthConfig } from './auth';
import { createPrivateServer, PrivateServerOptions, safeNext } from './privateServer';

// Tout est synthétique : build factice, données factices (« Attaquant Fixture »), identifiants de test
const PASSWORD = 'mot-de-passe-de-test-synthétique';
const DATA = JSON.stringify({ columns: ['Player'], rows: [['Attaquant Fixture']] });
let root: string;
let auth: AuthConfig;
let server: Server;
let base: string;
let apiCalls = 0;
let cdnCalls: string[] = [];
let limiter: LoginLimiter;

function start(overrides: Partial<PrivateServerOptions> = {}) {
  limiter = new LoginLimiter(5, 15 * 60 * 1000, 50);
  const handler = createPrivateServer({
    mode: 'production', auth, distDir: path.join(root, 'dist'), dataDir: path.join(root, 'data'),
    secureCookies: true, trustProxy: true, hsts: true, cdn: 'proxy', limiter, log: () => {},
    api: (req, res, next) => {
      if ((req.url ?? '').startsWith('/api/scout-report')) { apiCalls++; res.statusCode = 200; res.end('{"report":"ok"}'); return; }
      next();
    },
    fetchImpl: (async (url: string) => {
      cdnCalls.push(String(url));
      return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/webp' } });
    }) as typeof fetch,
    ...overrides,
  });
  return new Promise<void>(resolve => {
    server = createServer((req, res) => { void handler(req, res); });
    server.listen(0, '127.0.0.1', () => { base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`; resolve(); });
  });
}

beforeAll(async () => {
  root = mkdtempSync(path.join(tmpdir(), 'sv-private-'));
  mkdirSync(path.join(root, 'dist/assets'), { recursive: true });
  mkdirSync(path.join(root, 'dist/.vite'), { recursive: true });
  mkdirSync(path.join(root, 'data/players'), { recursive: true });
  writeFileSync(path.join(root, 'dist/index.html'), '<html>APPLICATION PRIVÉE</html>');
  writeFileSync(path.join(root, 'dist/login.html'), '<html>CONNEXION</html>');
  writeFileSync(path.join(root, 'dist/logo.svg'), '<svg/>');
  writeFileSync(path.join(root, 'dist/assets/main-1.js'), 'console.log("app")');
  writeFileSync(path.join(root, 'dist/assets/login-1.js'), 'console.log("login")');
  writeFileSync(path.join(root, 'dist/assets/shared-1.js'), 'console.log("react")');
  writeFileSync(path.join(root, 'dist/assets/style-1.css'), 'body{}');
  writeFileSync(path.join(root, 'dist/.vite/manifest.json'), JSON.stringify({
    'index.html': { file: 'assets/main-1.js', src: 'index.html', isEntry: true, imports: ['_shared'] },
    'login.html': { file: 'assets/login-1.js', src: 'login.html', isEntry: true, imports: ['_shared'] },
    _shared: { file: 'assets/shared-1.js', css: ['assets/style-1.css'] },
  }));
  writeFileSync(path.join(root, 'data/players/2026-27.json'), DATA);
  writeFileSync(path.join(root, 'secret.txt'), 'hors du dossier de données');
  auth = loadAuthConfig({
    SCOUTVISION_AUTH_USER: 'arnaud',
    SCOUTVISION_AUTH_PASSWORD_HASH: await hashPassword(PASSWORD, { N: 2 ** 14, r: 8, p: 1 }),
    SCOUTVISION_SESSION_SECRET: Buffer.alloc(32, 3).toString('base64url'),
  })!;
  await start();
});

afterAll(() => { server?.close(); rmSync(root, { recursive: true, force: true }); });

const origin = () => ({ Origin: base, 'Content-Type': 'application/json' });
const get = (p: string, headers: Record<string, string> = {}) => fetch(`${base}${p}`, { headers, redirect: 'manual' });
const login = (username: string, password: string, headers: Record<string, string> = {}) =>
  fetch(`${base}/api/auth/login`, { method: 'POST', headers: { ...origin(), ...headers }, body: JSON.stringify({ username, password }) });
async function cookie(): Promise<string> {
  const res = await login('arnaud', PASSWORD);
  expect(res.status).toBe(200);
  return res.headers.get('set-cookie')!.split(';')[0];
}

describe('connexion', () => {
  it('login valide : 200, cookie de session, aucune donnée secrète dans la réponse', async () => {
    const res = await login('arnaud', PASSWORD);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(JSON.parse(body)).toEqual({ authenticated: true, user: 'arnaud' });
    expect(body).not.toMatch(/scrypt|hash|secret/i);
    const set = res.headers.get('set-cookie')!;
    expect(set).toMatch(/^__Host-sv_session=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+;/);
    ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/', 'Max-Age=604800'].forEach(f => expect(set).toContain(f));
  });

  it('identifiant ou mot de passe invalide : même 401 « Identifiants incorrects. »', async () => {
    const a = await login('admin', PASSWORD, { 'X-Forwarded-For': '203.0.113.1' });
    const b = await login('arnaud', 'mauvais', { 'X-Forwarded-For': '203.0.113.1' });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(await a.json()).toEqual(await b.json());
    expect(a.headers.get('set-cookie')).toBeNull();
  });

  it('origine étrangère, absente ou cross-site : 403', async () => {
    expect((await login('arnaud', PASSWORD, { Origin: 'https://evil.example' })).status).toBe(403);
    const noOrigin = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    expect(noOrigin.status).toBe(403);
    expect((await login('arnaud', PASSWORD, { 'Sec-Fetch-Site': 'cross-site' })).status).toBe(403);
  });

  it('rate limit : 5 échecs par adresse puis 429 avec Retry-After, autre adresse non bloquée', async () => {
    const ip = { 'X-Forwarded-For': '198.51.100.7' };
    for (let i = 0; i < 5; i++) expect((await login('arnaud', `faux-${i}`, ip)).status).toBe(401);
    const blocked = await login('arnaud', PASSWORD, ip);
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await login('arnaud', PASSWORD, { 'X-Forwarded-For': '198.51.100.8' })).status).toBe(200);
    // Entrées de gauche inventées par le client : même adresse (celle ajoutée par le proxy), toujours bloquée
    expect((await login('arnaud', PASSWORD, { 'X-Forwarded-For': '203.0.113.99, 198.51.100.7' })).status).toBe(429);
  });

  it('rafale simultanée : au plus 5 vérifications pour une adresse, le reste en 429', async () => {
    const ip = { 'X-Forwarded-For': '198.51.100.20' };
    const statuses = await Promise.all(Array.from({ length: 20 }, (_, i) => login('arnaud', `faux-${i}`, ip).then(r => r.status)));
    expect(statuses.filter(s => s === 401).length).toBeLessThanOrEqual(5);
    expect(statuses.filter(s => s === 429).length).toBeGreaterThanOrEqual(15);
  });

  it('requête mal formée : 400 / 415 / 405', async () => {
    expect((await fetch(`${base}/api/auth/login`, { method: 'POST', headers: origin(), body: 'pas du json' })).status).toBe(400);
    expect((await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { Origin: base, 'Content-Type': 'text/plain' }, body: '{}' })).status).toBe(415);
    expect((await get('/api/auth/login')).status).toBe(405);
  });
});

describe('session', () => {
  it('session valide, absente, expirée', async () => {
    const c = await cookie();
    expect(await (await get('/api/auth/session', { Cookie: c })).json()).toEqual({ authenticated: true, user: 'arnaud' });
    expect(await (await get('/api/auth/session')).json()).toEqual({ authenticated: false });
    const expired = createSessionToken(auth, Date.now() - 8 * 24 * 3600 * 1000).token;
    expect(await (await get('/api/auth/session', { Cookie: `__Host-sv_session=${expired}` })).json()).toEqual({ authenticated: false });
    expect((await get('/data/players/2026-27.json', { Cookie: `__Host-sv_session=${expired}` })).status).toBe(401);
  });

  it('logout : cookie effacé et jeton révoqué immédiatement', async () => {
    const c = await cookie();
    const res = await fetch(`${base}/api/auth/logout`, { method: 'POST', headers: { Origin: base, Cookie: c } });
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(await (await get('/api/auth/session', { Cookie: c })).json()).toEqual({ authenticated: false });
    expect((await get('/data/players/2026-27.json', { Cookie: c })).status).toBe(401);
  });
});

describe('garde d\'accès', () => {
  it('route privée sans cookie : redirection vers /login (navigation) ou 401 (fichiers)', async () => {
    const home = await get('/', { Accept: 'text/html' });
    expect(home.status).toBe(302);
    expect(home.headers.get('location')).toBe('/login');
    const deep = await get('/joueurs?saison=2026-27', { Accept: 'text/html' });
    expect(deep.headers.get('location')).toBe(`/login?next=${encodeURIComponent('/joueurs?saison=2026-27')}`);
    const app = await get('/assets/main-1.js');
    expect(app.status).toBe(401);
    expect(await app.text()).not.toContain('console.log("app")');
    expect((await get('/index.html')).status).toBe(302);
  });

  it('page de connexion et ses fichiers publics, rien d\'autre', async () => {
    expect(await (await get('/login')).text()).toContain('CONNEXION');
    for (const p of ['/assets/login-1.js', '/assets/shared-1.js', '/assets/style-1.css', '/logo.svg', '/healthz']) expect((await get(p)).status).toBe(200);
    expect((await get('/.vite/manifest.json')).status).toBe(401);
  });

  it('données JSON sans cookie : 401 sans le contenu ; avec cookie : 200', async () => {
    const anon = await get('/data/players/2026-27.json');
    expect(anon.status).toBe(401);
    expect(await anon.text()).not.toContain('Attaquant Fixture');
    const c = await cookie();
    const ok = await get('/data/players/2026-27.json', { Cookie: c });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('cache-control')).toBe('private, no-cache');
    expect(await ok.text()).toBe(DATA);
    // l'application elle-même, avec cookie
    expect(await (await get('/', { Cookie: c, Accept: 'text/html' })).text()).toContain('APPLICATION PRIVÉE');
  });

  it('chemins détournés : jamais hors du dossier de données ni du build', async () => {
    const c = await cookie();
    for (const p of ['/data/../secret.txt', '/data/%2e%2e/secret.txt', '/data/players/..%2f..%2fsecret.txt', '/data/.release.json', '/%2e%2e/secret.txt', '/data/players/2026-27.json%00']) {
      const res = await get(p, { Cookie: c });
      expect([400, 401, 404]).toContain(res.status);
      expect(await res.text()).not.toContain('hors du dossier');
    }
  });

  it('rapport Gemini sans cookie : 401, l\'endpoint n\'est jamais atteint', async () => {
    apiCalls = 0;
    const res = await fetch(`${base}/api/scout-report`, { method: 'POST', headers: origin(), body: '{}' });
    expect(res.status).toBe(401);
    expect(apiCalls).toBe(0);
    const c = await cookie();
    const cross = await fetch(`${base}/api/scout-report`, { method: 'POST', headers: { ...origin(), Origin: 'https://evil.example', Cookie: c }, body: '{}' });
    expect(cross.status).toBe(403);
    expect(apiCalls).toBe(0);
    const ok = await fetch(`${base}/api/scout-report`, { method: 'POST', headers: { ...origin(), Cookie: c }, body: '{}' });
    expect(ok.status).toBe(200);
    expect(apiCalls).toBe(1);
    expect((await fetch(`${base}/api/futur-endpoint`, { method: 'POST', headers: { ...origin(), Cookie: c }, body: '{}' })).status).toBe(404);
  });

  it('proxy /cdn : session exigée, photos et logos seulement', async () => {
    cdnCalls = [];
    expect((await get('/cdn/images/players/abc123.webp')).status).toBe(401);
    expect(cdnCalls).toHaveLength(0);
    const c = await cookie();
    const ok = await get('/cdn/images/players/abc123.webp', { Cookie: c });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toBe('image/webp');
    expect(cdnCalls).toEqual(['https://cdn.pitchapi.dev/images/players/abc123.webp']);
    for (const p of ['/cdn/images/other/x.webp', '/cdn/images/players/x.json', '/cdn/https://evil.example/x.webp', '/cdn/images/players/a%2F..%2Fb.webp']) {
      expect([400, 404]).toContain((await get(p, { Cookie: c })).status);
    }
    expect(cdnCalls).toHaveLength(1);
  });

  it('en-têtes de sécurité sur toutes les réponses', async () => {
    const res = await get('/login', { 'X-Forwarded-Proto': 'https' });
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(res.headers.get('content-security-policy')).toContain("script-src 'self'");
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBe('same-origin');
    expect(res.headers.get('permissions-policy')).toContain('camera=()');
    expect(res.headers.get('strict-transport-security')).toContain('max-age=31536000');
    expect(res.headers.get('cache-control')).toBe('no-store');
    // HSTS seulement en HTTPS
    expect((await get('/login', { 'X-Forwarded-Proto': 'http' })).headers.get('strict-transport-security')).toBeNull();
  });

  it('connecté : /login renvoie vers la destination interne demandée, jamais vers un autre site', async () => {
    const c = await cookie();
    expect((await get('/login?next=%2Fequipes', { Cookie: c })).headers.get('location')).toBe('/equipes');
    expect((await get('/login?next=%2F%2Fevil.example', { Cookie: c })).headers.get('location')).toBe('/');
    expect(safeNext('https://evil.example')).toBe('/');
    expect(safeNext('/\\evil.example')).toBe('/');
    expect(safeNext('/data/players/2026-27.json')).toBe('/');
    expect(safeNext('/?saison=2026-27')).toBe('/?saison=2026-27');
    // Tabulation, retour à la ligne, espace : le navigateur les retirerait et ferait « //site »
    for (const v of ['/\t/evil.example/x', '/\n/evil.example', '/ /evil.example', '/\x0b/evil.example', '/%09/evil.example'.replace('%09', '\t')]) expect(safeNext(v)).toBe('/');
    expect((await get('/login?next=%2F%09%2Fevil.example%2Fx', { Cookie: c })).headers.get('location')).toBe('/');
  });
});

describe('mode développement', () => {
  it('sans session : aucun dossier privé par les routes de modules de Vite (/@id/, alias, chemin absolu)', async () => {
    server.close();
    await start({ mode: 'dev' });
    for (const p of ['/@id/@/public/data/index.json?import', `/@id/${root}/data/players/2026-27.json?import`, '/@id/@/dist/.vite/manifest.json?import', '/src/x.js?p=/public/data/index.json', '/.env.local']) {
      const res = await get(p, { Accept: '*/*' });
      expect([302, 401]).toContain(res.status);   // 404 signalerait un passage à Vite (next)
    }
    server.close();
    await start();
  });
});

describe('mode local ouvert', () => {
  it('sans authentification configurée, la session est signalée ouverte (dev / preview uniquement)', async () => {
    server.close();
    await start({ auth: null, mode: 'preview' });
    expect(await (await get('/api/auth/session')).json()).toEqual({ authenticated: true, user: null, open: true });
    server.close();
    await start();
  });
});
