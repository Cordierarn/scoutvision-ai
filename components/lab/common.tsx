/**
 * ScoutVision AI - Éléments communs du Laboratoire
 */

import React from 'react';
import { CircleAlert, CircleCheck, CircleX, Ruler } from 'lucide-react';
import { Verdict } from '../../services/labData';
import { Panel as UIPanel, Skeleton } from '../ui';

// Couleurs des graphiques : identité ScoutVision (theme/charts), séries en ordre fixe,
// gris de contexte pour la forme « emphase », paire divergente autour de la référence
export { SERIES, CONTEXT, DIVERGING } from '../../theme/charts';
// Palette de statut, réservée aux verdicts (toujours avec icône et libellé)
const VERDICTS: Record<Verdict, { label: string; color: string; icon: React.ElementType; help: string }> = {
  validated: { label: 'Validé', color: '#0ca30c', icon: CircleCheck, help: 'Effet net : intervalle de confiance qui exclut zéro, ou gain hors échantillon' },
  partial: { label: 'Partiel', color: '#fab219', icon: CircleAlert, help: 'Signal réel mais faible, ou limité à une partie de la question' },
  debunked: { label: 'Démenti', color: '#ec835a', icon: CircleX, help: 'Idée reçue démentie : effet nul ou non reproductible' },
  measured: { label: 'Mesure', color: '#94a3b8', icon: Ruler, help: 'Mesure descriptive, sans hypothèse à trancher' },
};

export const VERDICT_ORDER: Verdict[] = ['validated', 'partial', 'debunked', 'measured'];
export const verdictInfo = (v: Verdict) => VERDICTS[v];

export const VerdictBadge: React.FC<{ verdict: Verdict; size?: 'sm' | 'md' }> = ({ verdict, size = 'sm' }) => {
  const v = VERDICTS[verdict];
  const Icon = v.icon;
  return (
    <span title={v.help}
      className={`inline-flex items-center gap-1 rounded border whitespace-nowrap font-semibold text-ink ${size === 'md' ? 'h-6 px-2 text-xs' : 'h-5 px-1.5 text-2xs'}`}
      style={{ borderColor: `${v.color}66`, backgroundColor: `${v.color}14` }}>
      <Icon className={size === 'md' ? 'w-3.5 h-3.5' : 'w-3 h-3'} style={{ color: v.color }} aria-hidden />
      {v.label}
    </span>
  );
};

export const Panel: React.FC<{ title: React.ReactNode; subtitle?: React.ReactNode; right?: React.ReactNode; className?: string; children: React.ReactNode }> = ({ title, subtitle, right, className = '', children }) => (
  <UIPanel title={title} subtitle={subtitle} right={right} className={className}>{children}</UIPanel>
);

export const Loading: React.FC = () => <Skeleton className="h-64" />;

export const Missing: React.FC<{ what: string }> = ({ what }) => (
  <div className="sv-panel border-dashed px-4 py-3 text-xs text-ink-3">
    Données {what} absentes : lancez <code className="text-ink-2">scripts/prepare_lab.py</code> après <code className="text-ink-2">scripts/prepare_data.py</code>.
  </div>
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
