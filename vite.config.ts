import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { scoutReportApi } from './server/scoutReportPlugin';

// Images PitchAPI servies en même origine : le CDN n'envoie pas d'en-tête CORS
// (photos et logos affichés par l'application sans dépendre d'un autre domaine).
// Un hébergement de production doit reproduire cette réécriture /cdn/* -> cdn.pitchapi.dev/*.
const cdnProxy = {
  target: 'https://cdn.pitchapi.dev',
  changeOrigin: true,
  rewrite: (p: string) => p.replace(/^\/cdn/, ''),
};

export default defineConfig(({ mode }) => {
    // Variables lues par le serveur seulement : aucune n'est injectée dans le bundle.
    // Seules les variables préfixées VITE_ atteignent import.meta.env côté client.
    const env = loadEnv(mode, '.', '');
    const exposed = Object.keys(env).filter(k => k.startsWith('VITE_') && /GEMINI|API_KEY|SECRET|TOKEN/i.test(k));
    if (exposed.length > 0) {
      throw new Error(`Variables secrètes exposées au navigateur par le préfixe VITE_ : ${exposed.join(', ')}. Renommez-les sans VITE_.`);
    }
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
        proxy: { '/cdn': cdnProxy },
      },
      preview: {
        proxy: { '/cdn': cdnProxy },
      },
      // POST /api/scout-report : rapport Gemini, clé et modèle (GEMINI_MODEL) gardés côté serveur (server/)
      plugins: [react(), scoutReportApi(env.GEMINI_API_KEY || undefined, env.GEMINI_MODEL || undefined)],
      publicDir: 'public',
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
