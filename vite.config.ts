import path from 'path';
import { readFileSync } from 'fs';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { RevocationList, loadAuthConfig, readCookie, sessionCookieName, verifySessionToken } from './server/auth';
import { createPrivateServer, isLoopbackHost, type ServerMode } from './server/privateServer';
import { scoutReportMiddleware } from './server/scoutReportPlugin';

// Images PitchAPI servies en même origine : le CDN n'envoie pas d'en-tête CORS.
// En développement, ce proxy de Vite est placé derrière le garde d'accès ; en preview et en
// production, le garde sert lui-même /cdn, limité aux photos et logos (server/privateServer.ts).
const cdnProxy = {
  target: 'https://cdn.pitchapi.dev',
  changeOrigin: true,
  rewrite: (p: string) => p.replace(/^\/cdn/, ''),
};

/**
 * Garde d'accès sur `vite` et `vite preview` : mêmes règles qu'en production (session, données
 * privées, endpoints Gemini). Sans variables d'authentification : mode local ouvert, signalé.
 */
function privateServer(env: Record<string, string>, auth: ReturnType<typeof loadAuthConfig>): Plugin {
  // Déconnexions partagées entre le garde HTTP et la vérification des WebSocket
  const revoked = new RevocationList();
  const make = (mode: ServerMode) => {
    if (!auth) console.warn('\n  ScoutVision : authentification non configurée, accès local ouvert, limité à cet ordinateur (127.0.0.1). Voir docs/deployment.md.\n');
    return createPrivateServer({
      mode,
      auth,
      distDir: path.resolve(__dirname, 'dist'),
      dataDir: path.resolve(__dirname, env.SCOUTVISION_DATA_DIR || 'public/data'),
      secureCookies: false,
      trustProxy: false,
      hsts: false,
      cdn: mode === 'dev' ? 'next' : 'proxy',
      revoked,
      api: scoutReportMiddleware({ apiKey: env.GEMINI_API_KEY || undefined, model: env.GEMINI_MODEL || undefined }),
    });
  };
  return {
    name: 'scoutvision-private-server',
    configureServer(server) {
      server.middlewares.use(make('dev'));
      // Canal WebSocket de Vite (rechargement à chaud) : hors des middlewares, donc gardé ici.
      // Sans session valide, la connexion est coupée avant Vite ; le client navigateur n'a
      // jamais besoin de demander des modules par ce canal (invocation coupée).
      const http = server.httpServer;
      if (auth && http) {
        const emit = http.emit.bind(http) as (event: string, ...args: unknown[]) => boolean;
        http.emit = ((event: string, ...args: unknown[]) => {
          if (event === 'upgrade') {
            const req = args[0] as { headers: { cookie?: string; host?: string } };
            const socket = args[1] as { destroy: () => void };
            const valid = isLoopbackHost(req.headers.host) && verifySessionToken(auth, readCookie(req.headers.cookie, sessionCookieName(false)), revoked);
            if (!valid) { socket.destroy(); return true; }
          }
          return emit(event, ...args);
        }) as typeof http.emit;
      }
      (server as unknown as { environments?: { client?: { hot?: { setInvokeHandler?: (h: undefined) => void } } } }).environments?.client?.hot?.setInvokeHandler?.(undefined);
    },
    configurePreviewServer(server) { server.middlewares.use(make('preview')); },
  };
}

/**
 * Développement : aucun fichier des dossiers privés ne peut être chargé comme module, quelle que
 * soit l'URL (/@id/, alias @/, chemin absolu, ?import, ?raw). L'application ne fait que fetch()
 * sur /data, servi par le garde ; elle n'importe jamais ces fichiers.
 */
function denyPrivateModules(dataDir: string): Plugin {
  const roots = [dataDir, path.resolve(__dirname, 'public/data'), path.resolve(__dirname, 'dist'), path.resolve(__dirname, 'dist-server'), path.resolve(__dirname, '.cache'), path.resolve(__dirname, 'exports')];
  const isPrivate = (id: string) => {
    const file = path.resolve(id.split('?')[0].replace(/^\/@fs/, ''));
    return roots.some(r => file === r || file.startsWith(r + path.sep)) || /(^|[\\/])\.env(\.|$)/.test(file);
  };
  return {
    name: 'scoutvision-deny-private-modules',
    enforce: 'pre',
    apply: 'serve',
    load(id) {
      if (isPrivate(id)) this.error('Fichier privé : jamais servi comme module.');
    },
  };
}

/** Seul fichier de public/ publié dans dist/ : le logo. Les données restent hors du build. */
function publishLogo(): Plugin {
  return {
    name: 'scoutvision-publish-logo',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'logo.svg', source: readFileSync(path.resolve(__dirname, 'public/logo.svg')) });
    },
  };
}

export default defineConfig(({ mode, isSsrBuild }) => {
    // Variables lues par le serveur seulement : aucune n'est injectée dans le bundle.
    // Seules les variables préfixées VITE_ atteignent import.meta.env côté client.
    const env = loadEnv(mode, '.', '');
    const exposed = Object.keys(env).filter(k => k.startsWith('VITE_') && /GEMINI|API_KEY|SECRET|TOKEN|PASSWORD|HASH|SESSION|AUTH/i.test(k));
    if (exposed.length > 0) {
      throw new Error(`Variables secrètes exposées au navigateur par le préfixe VITE_ : ${exposed.join(', ')}. Renommez-les sans VITE_.`);
    }
    const auth = isSsrBuild ? null : loadAuthConfig(env);    // variables partielles ou invalides : Vite refuse de démarrer
    // `vite dev` et `vite preview` n'écoutent que sur cet ordinateur, avec ou sans authentification :
    // le serveur de développement expose par nature des sources et un canal de modules ; l'accès
    // depuis un autre appareil passe par le serveur de production (npm run build && npm start)
    const host = '127.0.0.1';
    const dataDir = path.resolve(__dirname, env.SCOUTVISION_DATA_DIR || 'public/data');
    return {
      server: {
        port: 3000,
        host,
        proxy: { '/cdn': cdnProxy },
      },
      preview: { host },
      plugins: [react(), ...(isSsrBuild ? [] : [denyPrivateModules(dataDir), privateServer(env, auth), publishLogo()])],
      publicDir: 'public',
      build: isSsrBuild ? { sourcemap: false, copyPublicDir: false } : {
        // public/ contient les données privées (public/data) : rien n'en est copié dans dist/
        copyPublicDir: false,
        // Manifeste : le serveur y lit les fichiers publics de la page de connexion
        manifest: true,
        sourcemap: false,
        rollupOptions: {
          input: {
            main: path.resolve(__dirname, 'index.html'),
            login: path.resolve(__dirname, 'login.html'),
          },
        },
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
