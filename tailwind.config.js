/**
 * ScoutVision - design tokens Tailwind
 * Les couleurs pointent vers les variables CSS de styles/index.css (canaux RGB),
 * ce qui garde les modificateurs d'opacité (bg-accent/10, border-line/60...).
 */

const token = name => `rgb(var(--sv-${name}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './login.html',
    './*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './utils/**/*.{ts,tsx}',
    './services/**/*.{ts,tsx}',
    './theme/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Plans : fond de l'application, panneaux, éléments posés sur un panneau
        canvas: token('canvas'),
        surface: token('surface'),
        raised: token('raised'),
        overlay: token('overlay'),
        line: { DEFAULT: token('line'), strong: token('line-strong') },
        // Encre : principal, secondaire, atténué, discret
        ink: { DEFAULT: token('ink'), 2: token('ink-2'), 3: token('ink-3'), 4: token('ink-4') },
        // Accent ScoutVision (cyan du logo) et texte posé sur l'accent
        accent: { DEFAULT: token('accent'), strong: token('accent-strong'), deep: token('accent-deep'), ink: token('accent-ink') },
        // Sens des valeurs
        pos: token('pos'),
        neg: token('neg'),
        warn: token('warn'),
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.625rem', { lineHeight: '0.875rem' }],
      },
      borderRadius: {
        // Formes anguleuses (logo) : rayons courts partout
        sm: '2px',
        DEFAULT: '3px',
        md: '4px',
        lg: '6px',
        xl: '8px',
      },
    },
  },
  plugins: [],
};
