import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Images PitchAPI servies en même origine : le CDN n'envoie pas d'en-tête CORS,
// ce qui empêche html2canvas de les inclure dans l'export PDF.
// Un hébergement de production doit reproduire cette réécriture /cdn/* -> cdn.pitchapi.dev/*.
const cdnProxy = {
  target: 'https://cdn.pitchapi.dev',
  changeOrigin: true,
  rewrite: (p: string) => p.replace(/^\/cdn/, ''),
};

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
        proxy: { '/cdn': cdnProxy },
      },
      preview: {
        proxy: { '/cdn': cdnProxy },
      },
      plugins: [react()],
      publicDir: 'public',
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
