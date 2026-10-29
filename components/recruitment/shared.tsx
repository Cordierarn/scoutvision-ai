/**
 * ScoutVision - Recrutement : libellés, pastilles et formats partagés par les blocs de la page
 */

import React from 'react';
import {
  ArrowLeftRight, BadgeEuro, CircleAlert, CircleCheck, CircleHelp, Clock, FileClock, Info, Microscope, Repeat, Scale,
  TrendingDown, TriangleAlert, Users,
} from 'lucide-react';
import { CandidateFlag, NeedFlag, NeedLevel, CONTEXT_EFFECT_NOTABLE, CONTRACT_MONTHS, projectionError } from '../../utils/recruitment';
import { ESTIMATE_RATIO_MIN } from '../../utils/prospects';
import { formatEuro } from '../../utils/format';
import { InfoTip } from '../ui';
import { STATUS as STATUS_COLORS } from '../../theme/charts';

// « À évaluer » n'est pas un statut : icône neutre. Palette de statut toujours avec icône et libellé
export const NEED_STATUS: Record<NeedLevel, string> = { high: STATUS_COLORS.critical, unknown: STATUS_COLORS.neutral, medium: STATUS_COLORS.warning, low: STATUS_COLORS.good };

export const NEED_LABELS: Record<NeedLevel, { label: string; icon: React.ElementType }> = {
  high: { label: 'Prioritaire', icon: TriangleAlert },
  unknown: { label: 'À évaluer', icon: CircleHelp },
  medium: { label: 'À renforcer', icon: CircleAlert },
  low: { label: 'Solide', icon: CircleCheck },
};

export const NEED_FLAGS: Record<NeedFlag, { label: string; icon: React.ElementType; title: string }> = {
  noStarter: { label: 'Aucun joueur régulier', icon: CircleAlert, title: 'Aucun joueur de ce poste n\'a 40 % des minutes de l\'équipe' },
  outOfPosition: { label: 'Titulaire hors poste', icon: ArrowLeftRight, title: 'Titulaire aligné à deux lignes ou plus de son poste : le poste recherché est celui de la formation. Ses percentiles sont calculés parmi les joueurs de son poste d\'origine, son indice n\'est pas comparable' },
  rotation: { label: 'Poste en rotation', icon: Repeat, title: 'Le titulaire le plus fréquent a moins de 40 % des minutes : la référence est le joueur le plus utilisé à ce poste' },
  contract: { label: `Contrat ≤ ${CONTRACT_MONTHS} mois`, icon: FileClock, title: 'Fin de contrat proche (Transfermarkt, saison en cours) : succession à préparer' },
  decline: { label: 'Déclin lié à l\'âge', icon: TrendingDown, title: 'L\'âge seul (hors retour vers la moyenne) fait baisser l\'indice projeté d\'au moins 2 points' },
  depth: { label: 'Pas de doublure', icon: Users, title: 'Aucun autre joueur n\'a débuté 15 % des matchs de la formation à ce poste' },
};

export const CANDIDATE_FLAGS: Record<CandidateFlag, { label: string; icon: React.ElementType; title: string }> = {
  fewMinutes: { label: 'Peu de minutes', icon: Clock, title: 'Peu de minutes cette saison : percentiles plus instables' },
  rareLeague: { label: 'Championnat peu observé', icon: Microscope, title: 'Moins de 15 transferts observés depuis ou vers ce championnat : traduction moins sûre' },
  bigStep: { label: 'Gros saut de niveau', icon: TrendingDown, title: 'Le changement de championnat coûte au moins 5 points d\'indice' },
  noContext: { label: 'Contexte équipe indisponible', icon: CircleHelp, title: 'Domination territoriale inconnue pour son équipe ou la nôtre : le terme de contexte n\'a pas été appliqué' },
  contextEffect: { label: 'Effet de contexte important', icon: Scale, title: `La projection est sensible à l'écart de domination territoriale entre le club actuel et le club cible (terme de contexte d'au moins ${CONTEXT_EFFECT_NOTABLE} points d'indice)` },
  contract: { label: `Contrat ≤ ${CONTRACT_MONTHS} mois`, icon: FileClock, title: 'Fin de contrat proche : indemnité réduite ou joueur libre' },
  belowEstimate: { label: 'Marché < estimation', icon: BadgeEuro, title: `Valeur marché inférieure à l'estimation statistique (estimation ScoutVision au moins ${String(ESTIMATE_RATIO_MIN).replace('.', ',')} fois la valeur Transfermarkt). L'estimation n'est pas un prix de transfert` },
};

export const SCOUTVISION_ESTIMATE_TIP = 'Estimation statistique de valeur. Ce n\'est pas un prix de transfert.';
export const EFFICIENT_TIP = 'Frontière valeur / performance : aucun autre candidat n\'a une projection au moins égale pour une valeur Transfermarkt au plus égale (et strictement meilleure sur l\'une des deux). Une lecture, pas un verdict commercial.';
export const GAIN_TIP = 'Différence entre deux projections (candidat chez nous, titulaire dans le même rôle) ; l\'incertitude de chacune doit être prise en compte.';

// ============================================
// FORMATS
// ============================================

const ONE_DECIMAL = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const TWO_DECIMALS = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const INTEGER = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });

export const decimal = (v: number) => ONE_DECIMAL.format(v);
export const signedDecimal = (v: number) => (Math.round(v * 10) === 0 ? '+0,0' : `${v > 0 ? '+' : '−'}${ONE_DECIMAL.format(Math.abs(v))}`);
export const formatEuros = (value: number | undefined) => (value ? formatEuro(value) : '–');

export function formatMonth(date: string | undefined): string {
  const m = date?.match(/^(\d{4})-(\d{2})/);
  return m ? `${m[2]}/${m[1]}` : '–';
}

export const ordinal = (v: number) => {
  const r = Math.max(1, Math.min(100, Math.round(v)));
  return r === 1 ? '1er' : `${r}e`;
};

// ============================================
// PASTILLES
// ============================================

export const NeedChip: React.FC<{ level: NeedLevel }> = ({ level }) => {
  const { label, icon: Icon } = NEED_LABELS[level];
  return (
    <span className="inline-flex items-center gap-1 h-5 px-1.5 rounded border border-line-strong bg-raised text-2xs font-semibold text-ink whitespace-nowrap">
      <Icon className="w-3 h-3" style={{ color: NEED_STATUS[level] }} aria-hidden />
      {label}
    </span>
  );
};

export const FlagChip: React.FC<{ label: string; title: string; icon: React.ElementType; tone?: 'default' | 'pos' | 'warn' }> = ({ label, title, icon: Icon, tone = 'default' }) => (
  <span title={title} className={`inline-flex items-center gap-1 h-5 px-1.5 rounded border text-2xs whitespace-nowrap ${
    tone === 'pos' ? 'border-accent/40 text-accent' : tone === 'warn' ? 'border-warn/40 text-warn' : 'border-line-strong text-ink-2'}`}>
    <Icon className={`w-3 h-3 ${tone === 'default' ? 'text-ink-3' : ''}`} aria-hidden />
    {label}
  </span>
);

/**
 * Incertitude de la projection : erreur absolue moyenne historique de l'indice (validation
 * hors échantillon), jamais présentée comme un intervalle autour de la projection
 */
export const UncertaintyNote: React.FC<{ error: ReturnType<typeof projectionError>; className?: string }> = ({ error, className = '' }) => {
  if (!error) return <p className={`text-2xs text-ink-4 ${className}`}>Erreur historique indisponible (validation du modèle absente).</p>;
  const kind = error.leagueChange ? 'changements de championnat' : 'changements de club dans un même championnat';
  return (
    <p className={`flex items-center gap-1 text-2xs text-ink-3 num ${className}`}>
      MAE historique ≈ {INTEGER.format(error.mae)} pts · {INTEGER.format(error.moves)} transferts
      <InfoTip align="end" text={`Erreur absolue moyenne historique : ${TWO_DECIMALS.format(error.mae)} points d'indice sur ${INTEGER.format(error.moves)} ${kind} en validation hors échantillon ${error.season}. C'est l'écart moyen observé entre l'indice projeté et l'indice réellement obtenu, pas un intervalle autour de cette projection.`} />
    </p>
  );
};

export const Note: React.FC<{ tone?: 'info' | 'warn'; children: React.ReactNode; className?: string }> = ({ tone = 'info', children, className = '' }) => (
  <p className={`flex items-start gap-2 text-xs ${tone === 'warn' ? 'text-warn' : 'text-ink-3'} ${className}`}>
    {tone === 'warn'
      ? <TriangleAlert className="w-3.5 h-3.5 mt-px shrink-0" aria-hidden />
      : <Info className="w-3.5 h-3.5 mt-px shrink-0 text-ink-4" aria-hidden />}
    <span className="min-w-0">{children}</span>
  </p>
);
