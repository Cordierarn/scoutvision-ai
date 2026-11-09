#!/usr/bin/env node
/**
 * ScoutVision - vérification d'une instance déployée SANS session (aucun cookie, aucun secret)
 *
 *   npm run verify:private -- https://<app>.herokuapp.com
 *   printf '%s\n%s\n' "$PRO_USER" "$PRO_PASSWORD" | npm run verify:private -- https://<app>.herokuapp.com --pro
 *
 * Avec --pro, l'identifiant et le mot de passe du compte pro sont lus sur l'entrée standard (jamais en
 * argument) : le script se connecte, puis échoue si une ressource de la page Pronostics répond autrement
 * que 403 ou laisse passer du contenu, ou si le reste de l'application ne lui est pas servi.
 *
 * Échoue (code 1) si une ressource privée répond sans authentification : application, données,
 * CDN, API. Vérifie aussi que la page de connexion répond et que les en-têtes de sécurité sont là.
 */

const base = (process.argv.slice(2).find(a => !a.startsWith('--')) ?? '').replace(/\/+$/, '');
const proMode = process.argv.includes('--pro');
if (!/^https?:\/\//.test(base)) {
  console.error('Usage : npm run verify:private -- https://<instance>');
  process.exit(2);
}

const checks = [
  ['GET', '/', r => r.status === 302 && (r.headers.get('location') ?? '').startsWith('/login'), '302 vers /login'],
  ['GET', '/index.html', r => r.status === 302, '302 vers /login'],
  ['GET', '/data/index.json', r => r.status === 401, '401'],
  ['GET', '/data/players/2026-27.json', r => r.status === 401, '401'],
  ['GET', '/data/models/transfer.json', r => r.status === 401, '401'],
  ['GET', '/cdn/images/players/test.webp', r => r.status === 401, '401'],
  ['GET', '/api/auth/session', r => r.status === 200, '200 « authenticated: false »', body => /"authenticated":false/.test(body)],
  ['POST', '/api/scout-report', r => r.status === 401 || r.status === 403, '401 ou 403'],
  ['POST', '/api/ai/compare', r => r.status === 401 || r.status === 403, '401 ou 403'],
  ['GET', '/public/data/index.json', r => r.status === 401 || r.status === 404, '401 ou 404'],
  ['GET', '/.vite/manifest.json', r => r.status === 401 || r.status === 404, '401 ou 404'],
  ['GET', '/login', r => r.status === 200, '200'],
  ['GET', '/healthz', r => r.status === 200, '200'],
];

let failed = 0;
for (const [method, path, ok, expected, bodyOk = () => true] of checks) {
  let res;
  try {
    res = await fetch(`${base}${path}`, {
      method, redirect: 'manual',
      headers: method === 'POST' ? { 'Content-Type': 'application/json', Origin: base } : {},
      body: method === 'POST' ? '{}' : undefined,
    });
  } catch (error) {
    console.log(`ÉCHEC  ${method} ${path} : ${error instanceof Error ? error.message : error}`);
    failed++;
    continue;
  }
  const body = await res.text();
  const leak = /"columns"\s*:|"rows"\s*:|"seasons"\s*:/.test(body);
  const pass = ok(res) && bodyOk(body) && !leak;
  if (!pass) failed++;
  console.log(`${pass ? 'OK   ' : 'ÉCHEC'}  ${method} ${path} → ${res.status} (attendu ${expected})${leak ? ' : CONTENU DE DONNÉES DANS LA RÉPONSE' : ''}`);
}

// HTTPS imposé : la même adresse en HTTP doit rediriger vers HTTPS (sans servir de contenu)
if (base.startsWith('https://')) {
  try {
    const plain = await fetch(`${base.replace(/^https:/, 'http:')}/data/index.json`, { redirect: 'manual' });
    const pass = plain.status === 301 && (plain.headers.get('location') ?? '').startsWith('https://');
    if (!pass) failed++;
    console.log(`${pass ? 'OK   ' : 'ÉCHEC'}  GET http://…/data/index.json → ${plain.status} (attendu 301 vers https)`);
  } catch (error) {
    console.log(`ÉCHEC  GET http://… : ${error instanceof Error ? error.message : error}`);
    failed++;
  }
}

const login = await fetch(`${base}/login`);
const headers = {
  'content-security-policy': v => v?.includes("frame-ancestors 'none'"),
  'x-content-type-options': v => v === 'nosniff',
  'referrer-policy': v => !!v,
  'permissions-policy': v => !!v,
  ...(base.startsWith('https://') ? { 'strict-transport-security': v => !!v } : {}),
};
for (const [name, ok] of Object.entries(headers)) {
  const pass = ok(login.headers.get(name) ?? undefined);
  if (!pass) failed++;
  console.log(`${pass ? 'OK   ' : 'ÉCHEC'}  en-tête ${name}`);
}

// Compte pro : la page Pronostics ne lui répond jamais
if (proMode) {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  const [username = '', password = ''] = Buffer.concat(chunks).toString('utf8').split(/\r?\n/);
  const res = await fetch(`${base}/api/auth/login`, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ username, password }) });
  const body = await res.json().catch(() => ({}));
  const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0];
  const loggedIn = res.status === 200 && body.role === 'pro' && !!cookie;
  if (!loggedIn) failed++;
  console.log(`${loggedIn ? 'OK   ' : 'ÉCHEC'}  connexion du compte pro → ${res.status}${body.role ? ` (rôle ${body.role})` : ''}`);
  if (loggedIn) {
    const denied = [
      ['GET', '/data/forecast.json'], ['GET', '/data/forecast/market_benchmark.json'], ['GET', '/data/forecast/replays/index.json'],
      ['GET', '/data/forecast/replays/summary.json'], ['GET', '/data/forecast/suggestions/index.json'], ['HEAD', '/data/forecast.json'],
      ['GET', '/data//forecast.json'], ['GET', '/data/forecast.json?x=1'], ['GET', '/data/%66orecast.json'],
      ['POST', '/api/ai/betting-news'], ['POST', '/api/ai/betting-plan'],
    ];
    for (const [method, path] of denied) {
      const r = await fetch(`${base}${path}`, { method, redirect: 'manual', headers: { Cookie: cookie, ...(method === 'POST' ? { 'Content-Type': 'application/json', Origin: base } : {}) }, body: method === 'POST' ? '{"matchIds":["m1"]}' : undefined });
      const text = await r.text();
      const pass = r.status === 403 && !/"matches"\s*:|"replays"\s*:|"profiles"\s*:|"summary"\s*:/.test(text);
      if (!pass) failed++;
      console.log(`${pass ? 'OK   ' : 'ÉCHEC'}  [pro] ${method} ${path} → ${r.status} (attendu 403, sans contenu)`);
    }
    for (const path of ['/', '/data/index.json']) {
      const r = await fetch(`${base}${path}`, { redirect: 'manual', headers: { Cookie: cookie } });
      const pass = r.status === 200;
      if (!pass) failed++;
      console.log(`${pass ? 'OK   ' : 'ÉCHEC'}  [pro] GET ${path} → ${r.status} (attendu 200)`);
    }
    await fetch(`${base}/api/auth/logout`, { method: 'POST', headers: { Cookie: cookie, Origin: base } });
  }
}

console.log(failed ? `\n${failed} vérification(s) en échec.` : proMode ? '\nAucune ressource privée sans session, aucune ressource de Pronostics pour le compte pro.' : '\nAucune ressource privée accessible sans session.');
process.exit(failed ? 1 : 0);
