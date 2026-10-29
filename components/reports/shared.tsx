/**
 * ScoutVision - Rapports de scouting : libellés, pastilles et formats partagés
 */

import React from 'react';
import { Archive, CheckCircle2, Eye, FileEdit } from 'lucide-react';
import { ObservationType, ReportStatus } from '../../types/scoutReport';
import { STATUS as STATUS_COLORS } from '../../theme/charts';

export { Note } from '../recruitment/shared';

export const STATUS_META: Record<ReportStatus, { label: string; icon: React.ElementType; color: string; hint: string }> = {
  draft: { label: 'Brouillon', icon: FileEdit, color: STATUS_COLORS.neutral, hint: 'Dossier ouvert, données figées, rien n\'est encore conclu' },
  to_observe: { label: 'À observer', icon: Eye, color: STATUS_COLORS.warning, hint: 'À vérifier en vidéo ou en live avant toute conclusion' },
  finalized: { label: 'Finalisé', icon: CheckCircle2, color: STATUS_COLORS.good, hint: 'Observations faites, dossier prêt à être partagé' },
  archived: { label: 'Archivé', icon: Archive, color: STATUS_COLORS.neutral, hint: 'Conservé pour mémoire, hors des listes de travail' },
};

export const TYPE_LABELS: Record<ObservationType, string> = { video: 'Vidéo', live: 'Live', general: 'Général' };

const DATE = new Intl.DateTimeFormat('fr-FR');
const DATE_TIME = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' });

export const fmtDate = (iso: string | undefined) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : DATE.format(d);
};
export const fmtDateTime = (iso: string | undefined) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : DATE_TIME.format(d);
};
export const today = () => new Date().toISOString().slice(0, 10);

export const StatusChip: React.FC<{ status: ReportStatus; className?: string }> = ({ status, className = '' }) => {
  const { label, icon: Icon, color } = STATUS_META[status];
  return (
    <span className={`inline-flex items-center gap-1 h-5 px-1.5 rounded border border-line-strong bg-raised text-2xs font-semibold text-ink whitespace-nowrap ${className}`}>
      <Icon className="w-3 h-3" style={{ color }} aria-hidden />
      {label}
    </span>
  );
};

export const SectionBlock: React.FC<{ letter: string; title: string; help?: React.ReactNode; right?: React.ReactNode; id?: string; children: React.ReactNode }> = ({ letter, title, help, right, id, children }) => (
  <section id={id} className="px-4 py-3 border-t border-line first:border-t-0" aria-label={title}>
    <div className="flex items-start justify-between gap-3 mb-2">
      <h3 className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-[0.08em] text-ink-2">
        <span className="w-4 h-4 rounded-sm flex items-center justify-center text-[9px] font-bold bg-overlay text-ink-2" aria-hidden>{letter}</span>
        {title}
        {help}
      </h3>
      {right && <div className="flex items-center gap-2 shrink-0">{right}</div>}
    </div>
    {children}
  </section>
);
