/**
 * ScoutVision AI - Éléments communs du Laboratoire
 */

import React from 'react';
import { CircleAlert, CircleCheck, CircleX, Ruler } from 'lucide-react';
import { Verdict } from '../../services/labData';

// Couleurs des graphiques : palette de référence dataviz validée sur le fond sombre de l'app
export const SERIES = ['#3987e5', '#d95926', '#199e70'];      // bleu, orange, vert d'eau (ordre fixe)
export const CONTEXT = '#78716c';                             // gris de contexte (forme « emphase »)
export const DIVERGING = { above: '#3987e5', below: '#e66767' };
// Palette de statut, réservée aux verdicts (toujours avec icône et libellé)
const VERDICTS: Record<Verdict, { label: string; color: string; icon: React.ElementType; help: string }> = {
  validated: { label: 'Validé', color: '#0ca30c', icon: CircleCheck, help: 'Effet net : intervalle de confiance qui exclut zéro, ou gain hors échantillon' },
  partial: { label: 'Partiel', color: '#fab219', icon: CircleAlert, help: 'Signal réel mais faible, ou limité à une partie de la question' },
  debunked: { label: 'Démenti', color: '#ec835a', icon: CircleX, help: 'Idée reçue démentie : effet nul ou non reproductible' },
  measured: { label: 'Mesure', color: '#94a3b8', icon: Ruler, help: 'Mesure descriptive, sans hypothèse à trancher' },
};

export const VerdictBadge: React.FC<{ verdict: Verdict }> = ({ verdict }) => {
  const v = VERDICTS[verdict];
  const Icon = v.icon;
  return (
    <span title={v.help} className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-slate-700 bg-slate-900 text-[11px] font-semibold text-slate-200 whitespace-nowrap">
      <Icon className="w-3.5 h-3.5" style={{ color: v.color }} aria-hidden />
      {v.label}
    </span>
  );
};

export const Panel: React.FC<{ title: React.ReactNode; subtitle?: React.ReactNode; right?: React.ReactNode; className?: string; children: React.ReactNode }> = ({ title, subtitle, right, className = '', children }) => (
  <section className={`bg-slate-950 border border-slate-800 rounded-2xl p-5 ${className}`}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider">{title}</h3>
        {subtitle && <p className="text-xs text-slate-500 mt-1 leading-relaxed">{subtitle}</p>}
      </div>
      {right}
    </div>
    <div className="mt-4">{children}</div>
  </section>
);

export const Loading: React.FC = () => <div className="h-64 rounded-2xl bg-slate-900 animate-pulse" />;

export const Missing: React.FC<{ what: string }> = ({ what }) => (
  <p className="text-sm text-slate-500">Données {what} absentes : lancez scripts/prepare_lab.py après scripts/prepare_data.py.</p>
);

/**
 * Charge une donnée du labo une fois (undefined : en cours ; null : absente)
 */
export function useLab<T>(load: () => Promise<T | null>): T | null | undefined {
  const [value, setValue] = React.useState<T | null | undefined>(undefined);
  React.useEffect(() => {
    let cancelled = false;
    load().then(v => { if (!cancelled) setValue(v); }).catch(() => { if (!cancelled) setValue(null); });
    return () => { cancelled = true; };
  }, [load]);
  return value;
}
