/**
 * ScoutVision - Rapports : liste des dossiers (recherche, filtres statut / saison / tag)
 */

import React, { useMemo } from 'react';
import { ClipboardList, MessageSquareText, Sparkles } from 'lucide-react';
import { REPORT_STATUSES, ReportStatus, ScoutReportRecord } from '../../types/scoutReport';
import { byUpdatedDesc } from '../../services/scoutReportStore';
import { positionLabel } from '../../utils/labels';
import { CompetitionBadge, PlayerAvatar } from '../Media';
import { EmptyState } from '../ui';
import { STATUS_META, StatusChip, fmtDate } from './shared';

export interface ListFilters {
  query: string;
  status: ReportStatus | '';
  season: string;
  tag: string;
}

export const EMPTY_FILTERS: ListFilters = { query: '', status: '', season: '', tag: '' };

export function filterRecords(records: ScoutReportRecord[], f: ListFilters): ScoutReportRecord[] {
  const q = f.query.trim().toLocaleLowerCase('fr');
  return records.filter(r =>
    (!q || r.player.name.toLocaleLowerCase('fr').includes(q) || r.player.team.toLocaleLowerCase('fr').includes(q))
    && (!f.status || r.status === f.status)
    && (!f.season || r.player.season === f.season)
    && (!f.tag || r.tags.includes(f.tag))).sort(byUpdatedDesc);
}

const Row: React.FC<{ record: ScoutReportRecord; selected: boolean; onSelect: () => void }> = ({ record: r, selected, onSelect }) => {
  const image = r.player.image ? { Player: r.player.name, Image: r.player.image } : undefined;
  return (
    <li>
      <button type="button" data-report-row onClick={onSelect} aria-current={selected ? 'true' : undefined}
        className={`relative w-full text-left grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-2.5 px-3 py-2 rounded-md transition-colors ${selected ? 'bg-raised' : 'hover:bg-raised/60'}`}>
        {selected && <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r bg-accent" aria-hidden />}
        <PlayerAvatar player={image as never} name={r.player.name} size="sm" />
        <span className="min-w-0">
          <span className="flex items-center gap-1.5 min-w-0">
            <span className="text-[13px] font-medium text-ink truncate" title={r.player.name}>{r.player.name}</span>
            {r.player.position && <span className="sv-tag shrink-0">{positionLabel(r.player.position)}</span>}
          </span>
          {/* Club puis compétition et saison ; sur une liste étroite, la compétition passe à la ligne au lieu de tronquer le club */}
          <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-2xs text-ink-3 min-w-0 leading-tight">
            <span className="truncate max-w-full" title={r.player.team}>{r.player.team}</span>
            <span className="inline-flex items-center gap-1.5 max-w-full min-w-0">
              <CompetitionBadge competition={r.player.competition} className="min-w-0 shrink" />
              <span className="sv-tag shrink-0">{r.player.seasonLabel ?? r.player.season}</span>
            </span>
          </span>
          <span className="block text-2xs text-ink-4 leading-tight mt-0.5 truncate">
            {r.role ?? 'Rôle non précisé'} · modifié le {fmtDate(r.updatedAt)}
          </span>
        </span>
        <span className="flex flex-col items-end gap-1 shrink-0">
          <StatusChip status={r.status} />
          <span className="flex items-center gap-2 text-2xs text-ink-3 num">
            <span className="inline-flex items-center gap-0.5" title={`${r.generatedSummaries.length} synthèse(s) IA`}><Sparkles className="w-3 h-3" aria-hidden />{r.generatedSummaries.length}<span className="sr-only"> synthèses IA</span></span>
            <span className="inline-flex items-center gap-0.5" title={`${r.observations.length} observation(s) humaine(s)`}><MessageSquareText className="w-3 h-3" aria-hidden />{r.observations.length}<span className="sr-only"> observations</span></span>
          </span>
        </span>
      </button>
    </li>
  );
};

export const ReportList: React.FC<{
  records: ScoutReportRecord[];
  filters: ListFilters;
  onFilters: (patch: Partial<ListFilters>) => void;
  selectedId?: string;
  onSelect: (id: string) => void;
  listRef?: React.Ref<HTMLUListElement>;
}> = ({ records, filters, onFilters, selectedId, onSelect, listRef }) => {
  const seasons = useMemo(() => [...new Set(records.map(r => r.player.season))].sort().reverse(), [records]);
  const tags = useMemo(() => [...new Set(records.flatMap(r => r.tags))].sort((a, b) => a.localeCompare(b, 'fr')), [records]);
  const shown = useMemo(() => filterRecords(records, filters), [records, filters]);
  const active = filters.query || filters.status || filters.season || filters.tag;
  return (
    <div>
      <div className="flex flex-wrap items-end gap-x-3 gap-y-2 px-4 pb-3">
        <label className="sv-label min-w-0 flex-1 basis-40">
          Recherche
          <input type="search" value={filters.query} onChange={e => onFilters({ query: e.target.value })} placeholder="Joueur ou club"
            className="sv-input sv-input-sm block mt-1 normal-case tracking-normal font-normal w-full" />
        </label>
        <label className="sv-label">
          Statut
          <select value={filters.status} onChange={e => onFilters({ status: e.target.value as ReportStatus | '' })} className="sv-select sv-select-sm block mt-1 normal-case tracking-normal font-normal">
            <option value="">Tous</option>
            {REPORT_STATUSES.map(s => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
          </select>
        </label>
        <label className="sv-label">
          Saison
          <select value={filters.season} onChange={e => onFilters({ season: e.target.value })} className="sv-select sv-select-sm block mt-1 normal-case tracking-normal font-normal">
            <option value="">Toutes</option>
            {seasons.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        {tags.length > 0 && (
          <label className="sv-label">
            Tag
            <select value={filters.tag} onChange={e => onFilters({ tag: e.target.value })} className="sv-select sv-select-sm block mt-1 normal-case tracking-normal font-normal">
              <option value="">Tous</option>
              {tags.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
        )}
      </div>
      <p className="px-4 pb-2 text-2xs text-ink-4 num" aria-live="polite">{shown.length} dossier{shown.length > 1 ? 's' : ''}{active ? ` sur ${records.length}` : ''}</p>
      {shown.length === 0 ? (
        <EmptyState icon={ClipboardList} title={active ? 'Aucun dossier ne correspond aux filtres.' : 'Aucun dossier.'}>
          {active ? 'Élargissez la recherche ou les filtres.' : 'Cherchez un joueur ci-dessus pour ouvrir son dossier.'}
        </EmptyState>
      ) : (
        <ul ref={listRef} className="px-1.5 pb-2 space-y-px" aria-label="Dossiers de scouting">
          {shown.map(r => <Row key={r.id} record={r} selected={r.id === selectedId} onSelect={() => onSelect(r.id)} />)}
        </ul>
      )}
    </div>
  );
};

export default ReportList;
