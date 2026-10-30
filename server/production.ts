/**
 * ScoutVision - serveur de production (Node, sans dépendance supplémentaire)
 *
 * Sert dist/ (application et page de connexion), /data/* depuis le dossier de données privé,
 * /cdn/* (photos et logos), /api/auth/* et les endpoints Gemini, le tout derrière le garde
 * d'accès de server/privateServer.ts. Refuse de démarrer sans authentification complète et
 * valide (fail closed). Construit par `npm run build` dans dist-server/, lancé par `npm start`.
 *
 * Variables (serveur uniquement, jamais VITE_) : voir docs/deployment.md.
 */

import { createServer } from 'node:http';
import path from 'node:path';
import { AuthConfigError, loadAuthConfig } from './auth';
import { createPrivateServer } from './privateServer';
import { scoutReportMiddleware } from './scoutReportPlugin';
import { dataInstalled, syncData } from './dataSync';

const env = process.env;
const flag = (name: string, fallback: boolean) => (env[name] === undefined || env[name] === '' ? fallback : /^(1|true|yes)$/i.test(env[name]!));

function fail(message: string): never {
  console.error(`ScoutVision ne démarre pas : ${message}`);
  process.exit(1);
}

let auth;
try {
  auth = loadAuthConfig(env);
} catch (error) {
  fail(error instanceof AuthConfigError ? error.message : 'configuration d\'authentification illisible.');
}
if (!auth) fail('SCOUTVISION_AUTH_USER, SCOUTVISION_AUTH_PASSWORD_HASH et SCOUTVISION_SESSION_SECRET sont obligatoires en production.');

const onRender = !!env.RENDER;
const trustProxy = flag('SCOUTVISION_TRUST_PROXY', onRender);
const secureCookies = flag('SCOUTVISION_COOKIE_SECURE', true);
const hsts = flag('SCOUTVISION_HSTS', secureCookies && trustProxy);
const distDir = path.resolve(env.SCOUTVISION_DIST_DIR || 'dist');
const dataDir = path.resolve(env.SCOUTVISION_DATA_DIR || 'public/data');
const allowedOrigins = [env.RENDER_EXTERNAL_URL, env.SCOUTVISION_PUBLIC_ORIGIN]
  .filter((o): o is string => !!o)
  .map(o => { try { return new URL(o).origin; } catch { return fail(`origine publique invalide : ${o}`); } });
const port = Number(env.PORT) || 10000;

const handler = createPrivateServer({
  mode: 'production',
  auth,
  distDir,
  dataDir,
  secureCookies,
  trustProxy,
  allowedOrigins,
  hsts,
  cdn: 'proxy',
  api: scoutReportMiddleware({ apiKey: env.GEMINI_API_KEY || undefined, model: env.GEMINI_MODEL || undefined }),
  dataReady: () => dataInstalled(dataDir),
});

const server = createServer((req, res) => { void handler(req, res); });
server.headersTimeout = 30_000;
server.requestTimeout = 120_000;
server.listen(port, '0.0.0.0', () => {
  console.log(`ScoutVision en écoute sur le port ${port} (cookies ${secureCookies ? 'sécurisés' : 'non sécurisés'}, proxy ${trustProxy ? 'de confiance' : 'ignoré'}).`);
  if (!env.GEMINI_API_KEY) console.warn('GEMINI_API_KEY absente : les fonctions IA répondront « non configuré ».');
});

// Données privées : téléchargées au démarrage puis vérifiées à intervalle régulier
const token = env.PITCHAPI_DATA_TOKEN?.trim();
if (token) {
  const refresh = async () => {
    const result = await syncData({ token, dataDir, repo: env.SCOUTVISION_DATA_REPO || undefined });
    if (result.status === 'failed') console.error(`Données non mises à jour : ${result.message}${dataInstalled(dataDir) ? ' (les données déjà installées restent servies)' : ''}.`);
    else if (result.status === 'current') console.log(`Données à jour (${result.updatedAt}).`);
  };
  void refresh();
  const hours = Number(env.SCOUTVISION_DATA_REFRESH_HOURS) || 6;
  setInterval(() => { void refresh(); }, hours * 3600_000).unref();
} else if (!dataInstalled(dataDir)) {
  console.warn(`Aucune donnée dans ${dataDir} et PITCHAPI_DATA_TOKEN absente : /data répondra 503.`);
}

const stop = () => server.close(() => process.exit(0));
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
