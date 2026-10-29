/**
 * ScoutVision - composants d'interface partagés
 * Panneaux, en-têtes de page, indicateurs, barres de percentile, états vides.
 * Les primitives simples (boutons, champs, puces, tableaux) sont des classes CSS (styles/index.css).
 */

import React from 'react';
import { AlertCircle, Info, RotateCw } from 'lucide-react';
import { PERCENTILE_TIERS, percentileTier } from '../../theme/percentile';

// ============================================
// STRUCTURE
// ============================================

/**
 * En-tête de page : titre court, description, actions à droite
 */
export const PageHeader: React.FC<{
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ElementType;
  actions?: React.ReactNode;
  meta?: React.ReactNode;
  className?: string;
}> = ({ title, description, icon: Icon, actions, meta, className = '' }) => (
  <div className={`flex flex-wrap items-end justify-between gap-x-6 gap-y-3 ${className}`}>
    <div className="min-w-0">
      <h1 className="flex items-center gap-2 text-lg font-semibold text-ink tracking-tight">
        {Icon && <Icon className="w-[18px] h-[18px] text-accent" aria-hidden />}
        {title}
      </h1>
      {description && <p className="text-xs text-ink-3 mt-1 max-w-3xl leading-relaxed">{description}</p>}
    </div>
    {(actions || meta) && (
      <div className="flex flex-wrap items-center gap-2">
        {meta && <span className="text-2xs text-ink-4">{meta}</span>}
        {actions}
      </div>
    )}
  </div>
);

/**
 * Panneau titré : libellé de section en capitales, sous-titre, actions, contenu
 */
export const Panel: React.FC<{
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: React.ElementType;
  right?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  flush?: boolean;           // contenu sans marge intérieure (tableaux)
  children: React.ReactNode;
}> = ({ title, subtitle, icon: Icon, right, className = '', bodyClassName = '', flush = false, children }) => (
  <section className={`sv-panel min-w-0 ${className}`}>
    {(title || right) && (
      <header className={`flex items-start justify-between gap-4 px-4 pt-3 ${flush ? 'pb-3 border-b border-line' : ''}`}>
        <div className="min-w-0 flex-1">
          {title && (
            <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-ink">
              {Icon && <Icon className="w-3.5 h-3.5 text-ink-3" aria-hidden />}
              {title}
            </h3>
          )}
          {subtitle && <p className="text-xs text-ink-3 mt-1 leading-relaxed">{subtitle}</p>}
        </div>
        {right && <div className="flex items-center gap-2 shrink-0">{right}</div>}
      </header>
    )}
    <div className={`${flush ? '' : 'px-4 pb-4 pt-3'} ${bodyClassName}`}>{children}</div>
  </section>
);

/**
 * Indicateur : libellé, valeur, précision. Pensé pour des bandeaux denses (séparateurs verticaux).
 */
export const Stat: React.FC<{
  label: React.ReactNode;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: 'default' | 'accent' | 'pos' | 'warn' | 'neg';
  title?: string;
  help?: string;             // aide détaillée : icône (i) à côté du libellé
  wrapSub?: boolean;         // précision sur deux lignes au lieu d'être tronquée
  className?: string;
}> = ({ label, value, sub, tone = 'default', title, help, wrapSub = false, className = '' }) => {
  const color = tone === 'accent' ? 'text-accent' : tone === 'pos' ? 'text-pos' : tone === 'warn' ? 'text-warn' : tone === 'neg' ? 'text-neg' : 'text-ink';
  return (
    <div className={`min-w-0 ${className}`} title={title}>
      {/* Sous 1280 px les tuiles sont étroites : libellé et précision passent à la ligne entre les mots au lieu d'être coupés.
          Pas de min-w-0 sur le libellé : dans un bandeau flex la tuile garde la largeur du mot le plus long (pas de « JOUE/URS »),
          break-words ne coupe un mot que s'il dépasse une colonne de grille fixe. */}
      <div className="sv-label flex items-center gap-1 min-w-0"><span className="break-words xl:min-w-0 xl:truncate">{label}</span>{help && <InfoTip text={help} />}</div>
      <div className={`mt-0.5 text-base font-semibold leading-tight num ${color}`}>{value}</div>
      {sub && <div className={`text-2xs text-ink-3 mt-0.5 ${wrapSub ? 'leading-snug' : 'leading-snug break-words xl:truncate'}`}>{sub}</div>}
    </div>
  );
};

/**
 * Bandeau d'indicateurs séparés par des filets
 */
export const StatStrip: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <div className={`grid divide-x divide-line [&>*]:px-4 [&>*:first-child]:pl-0 ${className}`}>{children}</div>
);

/**
 * État vide ou indisponible, sobre
 */
export const EmptyState: React.FC<{
  icon?: React.ElementType;
  title: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}> = ({ icon: Icon, title, children, className = '' }) => (
  <div className={`flex flex-col items-center justify-center text-center px-6 py-10 ${className}`}>
    {Icon && <Icon className="w-6 h-6 text-ink-4 mb-3" aria-hidden />}
    <p className="text-sm text-ink-2">{title}</p>
    {children && <div className="text-xs text-ink-3 mt-1.5 max-w-md leading-relaxed">{children}</div>}
  </div>
);

export const Skeleton: React.FC<{ className?: string }> = ({ className = 'h-64' }) => (
  <div className={`rounded-lg bg-surface border border-line animate-pulse ${className}`} />
);

/**
 * Bloc de chargement à l'intérieur d'un panneau : occupe la place du contenu final.
 * Décoratif : le conteneur porte role="status" et le libellé du chargement.
 */
export const SkeletonBlock: React.FC<{ className?: string }> = ({ className = 'h-24' }) => (
  <div className={`rounded-md bg-raised/70 animate-pulse ${className}`} aria-hidden />
);

/**
 * Échec de chargement : message discret et bouton « Réessayer »
 */
export const LoadError: React.FC<{ message?: string; onRetry?: () => void; className?: string }> = ({
  message = 'Chargement impossible.', onRetry, className = '',
}) => (
  <div role="alert" className={`flex items-center gap-2 rounded-md border border-line px-3 py-2 text-xs text-ink-3 ${className}`}>
    <AlertCircle className="w-3.5 h-3.5 shrink-0 text-warn" aria-hidden />
    <span className="flex-1 min-w-0">{message}</span>
    {onRetry && (
      <button onClick={onRetry} className="sv-btn sv-btn-ghost sv-btn-sm !h-6 !px-1.5 shrink-0">
        <RotateCw className="w-3 h-3" /> Réessayer
      </button>
    )}
  </div>
);

/**
 * Aide discrète : icône (i) avec infobulle détaillée, accessible au clavier
 */
export const InfoTip: React.FC<{ text: string; align?: 'center' | 'end' | 'start'; position?: 'top' | 'bottom' | 'left'; className?: string }> = ({
  text, align = 'center', position = 'bottom', className = '',
}) => (
  <span
    tabIndex={0}
    role="note"
    aria-label={text}
    data-tip={text}
    data-tip-wide=""
    data-tip-pos={position === 'top' ? undefined : position}
    data-tip-align={align === 'end' ? 'end' : align === 'start' ? 'start' : undefined}
    className={`inline-flex items-center text-ink-4 hover:text-ink-2 focus-visible:text-ink-2 cursor-help normal-case tracking-normal font-normal shrink-0 ${className}`}
  >
    <Info className="w-3 h-3" aria-hidden />
  </span>
);

/**
 * Légende d'une série : pastille + libellé (l'identité n'est jamais portée par la couleur seule)
 */
export const LegendItem: React.FC<{ color: string; shape?: 'dot' | 'line' | 'bar'; children: React.ReactNode }> = ({ color, shape = 'dot', children }) => (
  <span className="inline-flex items-center gap-1.5 text-2xs text-ink-3">
    <span
      className={shape === 'line' ? 'w-3.5 h-0.5' : shape === 'bar' ? 'w-3 h-2 rounded-sm' : 'w-2 h-2 rounded-full'}
      style={{ backgroundColor: color }}
    />
    {children}
  </span>
);

// ============================================
// PERCENTILES
// ============================================

/**
 * Barre de percentile : remplissage coloré par palier, repère de la médiane (50)
 */
export const PercentileBar: React.FC<{ value: number; className?: string; height?: string }> = ({ value, className = '', height = 'h-1.5' }) => {
  const v = Math.max(0, Math.min(100, value));
  const tier = PERCENTILE_TIERS[percentileTier(v)];
  return (
    <div className={`relative ${height} bg-raised rounded-sm overflow-hidden ${className}`} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v)} aria-label={`Percentile ${Math.round(v)} (${tier.label})`}>
      <div className="absolute inset-y-0 left-0 rounded-sm" style={{ width: `${Math.max(v, 1.5)}%`, backgroundColor: tier.color }} />
      <div className="absolute inset-y-0 left-1/2 w-px bg-ink-4/70" aria-hidden />
    </div>
  );
};

/**
 * Barre d'un indice 0-100 (indice du rôle) : remplissage neutre, sans paliers ni repère de médiane,
 * pour ne pas le lire comme un percentile
 */
export const IndexBar: React.FC<{ value: number; className?: string }> = ({ value, className = '' }) => {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className={`relative h-1.5 bg-raised rounded-sm overflow-hidden ${className}`} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v)} aria-label={`Indice ${Math.round(v)} sur 100`}>
      <div className="absolute inset-y-0 left-0 rounded-sm bg-accent/60" style={{ width: `${Math.max(v, 1.5)}%` }} />
    </div>
  );
};

/**
 * Valeur de percentile (P92) avec pastille de palier
 */
export const PercentileValue: React.FC<{ value: number | undefined; className?: string; tip?: string }> = ({ value, className = '', tip }) => {
  if (value === undefined || Number.isNaN(value)) return <span className={`text-ink-4 ${className}`}>–</span>;
  const tier = PERCENTILE_TIERS[percentileTier(value)];
  // tip : infobulle d'interface détaillée à la place de l'info-bulle native
  return (
    <span
      className={`inline-flex items-center gap-1 num font-semibold ${tier.text} ${className}`}
      title={tip ? undefined : `${tier.label} (percentile ${Math.round(value)})`}
      data-tip={tip}
      data-tip-pos={tip ? 'left' : undefined}
      data-tip-wide={tip ? '' : undefined}
    >
      <span className="w-1.5 h-1.5 rounded-sm" style={{ backgroundColor: tier.color }} aria-hidden />
      P{Math.round(value)}
    </span>
  );
};

/**
 * Ligne métrique : libellé, valeur brute, barre de percentile, percentile
 */
export const PercentileRow: React.FC<{
  label: React.ReactNode;
  value?: React.ReactNode;
  percentile: number | undefined;   // undefined : donnée absente, affichée « N/D » sans barre
  title?: string;
  active?: boolean;          // ligne mise en évidence (lien avec un graphique)
  className?: string;
} & Pick<React.HTMLAttributes<HTMLDivElement>, 'onMouseEnter' | 'onMouseLeave' | 'onFocus' | 'onBlur' | 'tabIndex'>> = ({ label, value, percentile, title, active = false, className = '', ...events }) => (
  <div className={`grid grid-cols-[minmax(0,1fr)_3rem_2.75rem] sm:grid-cols-[minmax(0,1fr)_3.5rem_minmax(4rem,7rem)_2.75rem] items-center gap-2 sm:gap-2.5 h-6 text-xs rounded-sm ${active ? 'bg-raised' : ''} ${className}`} title={title} {...events}>
    <span className={`truncate ${active ? 'text-accent' : 'text-ink-2'}`}>{label}</span>
    <span className="text-right text-ink-3 num">{value}</span>
    {percentile === undefined
      ? <div className="hidden sm:block h-1.5 bg-raised rounded-sm" aria-hidden />
      : <PercentileBar value={percentile} className="hidden sm:block" />}
    <span className="text-right">{percentile === undefined ? <span className="text-ink-4">N/D</span> : <PercentileValue value={percentile} />}</span>
  </div>
);

/**
 * Légende des paliers de percentile
 */
export const PercentileLegend: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 ${className}`}>
    {(['elite', 'above', 'average', 'below', 'weak'] as const).map(t => (
      <LegendItem key={t} color={PERCENTILE_TIERS[t].color} shape="bar">
        {PERCENTILE_TIERS[t].label}{t === 'elite' ? ' ≥90' : t === 'above' ? ' 70-89' : t === 'average' ? ' 31-69' : t === 'below' ? ' 11-30' : ' ≤10'}
      </LegendItem>
    ))}
  </div>
);

// ============================================
// SIGNES
// ============================================

/** Écart signé au format français (« +0,34 », « −2 », « 0 ») */
export function formatDelta(value: number, digits = 0, suffix = ''): string {
  const r = Number(value.toFixed(digits));
  if (r === 0) return `0${suffix}`;
  const abs = Math.abs(r).toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${r > 0 ? '+' : '−'}${abs}${suffix}`;
}

/**
 * Écart signé coloré selon le sens (progression / recul), avec signe explicite
 */
export const Delta: React.FC<{ value: number; digits?: number; suffix?: string; threshold?: number; className?: string }> = ({ value, digits = 0, suffix = '', threshold = 0, className = '' }) => {
  const r = Number(value.toFixed(digits));
  const tone = r > threshold ? 'text-pos' : r < -threshold ? 'text-neg' : 'text-ink-3';
  return <span className={`num font-medium ${tone} ${className}`}>{formatDelta(value, digits, suffix)}</span>;
};

// ============================================
// GRAPHIQUES
// ============================================

/**
 * Libellé d'axe polaire sur deux lignes au plus (radars) : évite les libellés coupés
 */
export const PolarTick: React.FC<{
  x?: number; y?: number; cx?: number; cy?: number;
  payload?: { value: string };
  maxChars?: number;
  active?: boolean;                       // libellé mis en évidence
  onHover?: (value: string | null) => void;
  format?: (value: string) => string;     // libellé affiché (la valeur d'origine reste celle du survol)
  maxLines?: number;                      // lignes avant ellipse (2 par défaut)
}> = ({ x = 0, y = 0, cx = 0, cy = 0, payload, maxChars = 16, active = false, onHover, format, maxLines = 2 }) => {
  const raw = String(payload?.value ?? '');
  const words = (format ? format(raw) : raw).split(' ');
  const lines: string[] = [];
  words.forEach(w => {
    const last = lines[lines.length - 1];
    if (last !== undefined && (last + ' ' + w).length <= maxChars) lines[lines.length - 1] = `${last} ${w}`;
    else lines.push(w);
  });
  const shown = lines.length > maxLines ? [...lines.slice(0, maxLines - 1), `${lines.slice(maxLines - 1).join(' ').slice(0, maxChars - 1)}…`] : lines;
  const anchor = Math.abs(x - cx) < 4 ? 'middle' : x > cx ? 'start' : 'end';
  const dy = y < cy - 4 ? -(shown.length - 1) * 11 : y > cy + 4 ? 4 : -((shown.length - 1) * 11) / 2;
  return (
    <text x={x} y={y + dy} textAnchor={anchor} fill={active ? '#00E5FF' : '#C4CDD8'} fontSize={10} fontWeight={active ? 600 : 500}
      onMouseEnter={onHover ? () => onHover(String(payload?.value ?? '')) : undefined}
      onMouseLeave={onHover ? () => onHover(null) : undefined}
      style={onHover ? { cursor: 'default' } : undefined}>
      {shown.map((l, i) => <tspan key={i} x={x} dy={i === 0 ? 3 : 11}>{l}</tspan>)}
    </text>
  );
};
