#!/usr/bin/env node
/**
 * ScoutVision - vérification d'une instance déployée SANS session (aucun cookie, aucun secret)
 *
 *   npm run verify:private -- https://scoutvision-xxxx.onrender.com
 *
 * Échoue (code 1) si une ressource privée répond sans authentification : application, données,
 * CDN, API. Vérifie aussi que la page de connexion répond et que les en-têtes de sécurité sont là.
 */

const base = (process.argv[2] ?? '').replace(/\/+$/, '');
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

console.log(failed ? `\n${failed} vérification(s) en échec.` : '\nAucune ressource privée accessible sans session.');
process.exit(failed ? 1 : 0);
