/**
 * ScoutVision - Rapports : dossier d'un joueur-saison, en blocs séparés
 * A identité · B contexte data · C snapshot statistique · D impact et valeur · E projection ·
 * F synthèse ScoutVision (versions) · G priorités d'observation · H observations humaines.
 * Tout ce qui est chiffré vient du snapshot figé du dossier ; les observations sont humaines.
 */

import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { ArrowLeft, Download, ExternalLink, Pencil, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { PolarAngleAxis, PolarGrid, Radar, RadarChart } from 'recharts';
import { PlayerData } from '../../types';
import { AgeCurves, DataIndex } from '../../services/dataLoader';
import { ObservationInput } from '../../services/scoutReportStore';
import { REPORT_STATUSES, ReportStatus, ScoutObservation, ScoutReportRecord } from '../../types/scoutReport';
import { presetsForPosition } from '../../utils/rolePresets';
import { buildSnapshot, compareSnapshot, observationPriorities, orientedPercentile, roleMetrics, strengthsAndLimits } from '../../utils/scoutReportSnapshot';
import { formatEuro } from '../../utils/format';
import { positionName } from '../../utils/labels';
import { CompetitionBadge, PlayerAvatar } from '../Media';
import { Delta, EmptyState, InfoTip, LoadError, PercentileRow, PercentileValue, PolarTick, Stat } from '../ui';
import { useElementWidth } from '../Pitch';
import { BRAND, INK } from '../../theme/charts';
import { ObservationForm } from './ObservationForm';
import { Note, STATUS_META, SectionBlock, StatusChip, TYPE_LABELS, fmtDate, fmtDateTime } from './shared';
import { PdfMode } from '../../utils/scoutReportPdf';

const INT = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const D1 = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const D2 = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const D3 = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const signed = (v: number, f: Intl.NumberFormat) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${f.format(Math.abs(v))}`;

type MdProps = { node?: unknown; children?: React.ReactNode };
const MD = {
  h1: ({ node: _n, ...props }: MdProps) => <h1 className="text-base font-semibold text-ink mb-3" {...props} />,
  h2: ({ node: _n, ...props }: MdProps) => <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-accent mt-5 mb-2" {...props} />,
  h3: ({ node: _n, ...props }: MdProps) => <div className="sv-label mt-4 mb-2 pb-1 border-b border-line" {...props} />,
  strong: ({ node: _n, ...props }: MdProps) => <strong className="text-ink font-semibold" {...props} />,
  ul: ({ node: _n, ...props }: MdProps) => <ul className="space-y-1.5 my-2 pl-4 list-disc marker:text-ink-4" {...props} />,
  li: ({ node: _n, ...props }: MdProps) => <li className="text-ink-2 leading-relaxed" {...props} />,
  p: ({ node: _n, ...props }: MdProps) => <p className="leading-relaxed text-ink-2 mb-3" {...props} />,
};

const TagsEditor: React.FC<{ tags: string[]; onChange: (tags: string[]) => void }> = ({ tags, onChange }) => {
  const [draft, setDraft] = useState('');
  const uid = useId();
  const add = () => { const t = draft.trim(); if (t && !tags.includes(t)) onChange([...tags, t]); setDraft(''); };
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {tags.map(t => (
        <span key={t} className="sv-tag !font-normal inline-flex items-center gap-1">
          {t}
          <button type="button" className="text-ink-4 hover:text-ink" onClick={() => { onChange(tags.filter(x => x !== t)); document.getElementById(`${uid}-tag`)?.focus(); }} aria-label={`Retirer le tag ${t}`}><X className="w-3 h-3" aria-hidden /></button>
        </span>
      ))}
      <label htmlFor={`${uid}-tag`} className="sr-only">Nouveau tag</label>
      <input id={`${uid}-tag`} value={draft} onChange={e => setDraft(e.target.value)} placeholder="Ajouter un tag" className="sv-input sv-input-sm !w-32"
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
      <button type="button" className="sv-btn sv-btn-ghost sv-btn-sm" onClick={() => { add(); document.getElementById(`${uid}-tag`)?.focus(); }} disabled={!draft.trim()}><Plus className="w-3 h-3" aria-hidden /> Tag</button>
    </div>
  );
};

// Libellé d'axe du radar : « par 90 » abrégé en « /90 », comme sur la fiche, et coupé entre les mots (PolarTick)
const radarAxisLabel = (label: string) => label.replace(/ par 90$/, ' /90');

const SnapshotRadar: React.FC<{ data: { label: string; value: number }[] }> = ({ data }) => {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const compact = width > 0 && width < 260;
  return (
    <div ref={ref} className="h-60" role="img" aria-label={`Radar des percentiles du rôle : ${data.map(d => `${d.label} ${d.value}`).join(', ')}`}>
      {width > 0 && data.length >= 3 && (
        <RadarChart width={width} height={240} data={data} cx="50%" cy="50%" outerRadius={compact ? '48%' : width < 340 ? '52%' : '62%'} margin={{ top: 18, right: 30, bottom: 18, left: 30 }}>
          <PolarGrid stroke={INK.grid} />
          <PolarAngleAxis dataKey="label" tick={(tickProps: object) => <PolarTick {...(tickProps as React.ComponentProps<typeof PolarTick>)} format={radarAxisLabel} {...(compact ? { maxChars: 11, maxLines: 3 } : {})} />} />
          <Radar dataKey="value" stroke={BRAND} fill={BRAND} fillOpacity={0.2} isAnimationActive={false} />
        </RadarChart>
      )}
    </div>
  );
};

export interface ReportDossierProps {
  record: ScoutReportRecord;
  livePlayer?: PlayerData;            // ligne joueur-saison dans les données chargées, si présente
  curves: AgeCurves | null;
  dataIndex: DataIndex | null;
  onStatus: (status: ReportStatus) => void;
  onTags: (tags: string[]) => void;
  onRole: (role: string | undefined) => void;
  onAddObservation: (obs: ObservationInput) => void;
  onUpdateObservation: (id: string, obs: ObservationInput) => void;
  onRemoveObservation: (id: string) => void;
  onGenerate?: () => void;
  generating: boolean;
  generateError: string | null;
  onExportPdf: (mode: PdfMode) => void;   // synthèse (4 pages) ou complet (annexe : historique, toutes les métriques)
  exporting: boolean;
  exportError: string | null;
  onDelete: () => void;
  onOpenPlayer?: () => void;
  onBack?: () => void;
  headingRef?: React.Ref<HTMLHeadingElement>;
}

/** Rend le focus au bouton quand une action qui l'avait désactivé se termine (sinon il retombe sur le document) */
function useRefocus(busy: boolean, ref: React.RefObject<HTMLButtonElement | null> | (() => HTMLButtonElement | null)) {
  const was = useRef(false);
  useEffect(() => {
    const target = typeof ref === 'function' ? ref() : ref.current;
    if (was.current && !busy && document.activeElement === document.body) target?.focus();
    was.current = busy;
  }, [busy, ref]);
}

export const ReportDossier: React.FC<ReportDossierProps> = ({
  record: r, livePlayer, curves, dataIndex, onStatus, onTags, onRole, onAddObservation, onUpdateObservation, onRemoveObservation,
  onGenerate, generating, generateError, onExportPdf, exporting, exportError, onDelete, onOpenPlayer, onBack, headingRef,
}) => {
  const uid = useId();
  const snap = r.dataSnapshot;
  const facts = snap.facts;
  const [summaryId, setSummaryId] = useState<string | null>(null);
  const summaries = r.generatedSummaries;
  const summary = summaries.find(s => s.id === summaryId) ?? summaries[summaries.length - 1];
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const role = r.role ?? snap.bestRoles[0]?.role;
  const roleIndex = snap.bestRoles.find(b => b.role === role)?.index;
  const roleOptions = useMemo(() => presetsForPosition(r.player.position).map(([name]) => name), [r.player.position]);

  const freshness = useMemo(() => {
    if (!livePlayer) return null;
    const live = buildSnapshot(livePlayer, { curves, dataIndex }).facts;
    return compareSnapshot(snap, live, dataIndex?.generatedAt ?? undefined);
  }, [livePlayer, snap, curves, dataIndex]);

  // Le focus ne retombe jamais sur le document : un bouton désactivé le temps d'une action le reprend
  // ensuite, et la fin du formulaire d'observation rend le focus au bouton « Observation »
  const generateRef = useRef<HTMLButtonElement>(null);
  const exportRef = useRef<HTMLButtonElement>(null);
  const exportFullRef = useRef<HTMLButtonElement>(null);
  const lastExport = useRef<PdfMode>('synthese');
  const addRef = useRef<HTMLButtonElement>(null);
  useRefocus(generating, generateRef);
  // Les deux boutons d'export sont désactivés pendant l'export : le focus revient sur celui qui a été utilisé
  useRefocus(exporting, () => (lastExport.current === 'complet' ? exportFullRef.current : exportRef.current));
  const exportPdf = (mode: PdfMode) => { lastExport.current = mode; onExportPdf(mode); };
  const closeForm = () => { setAdding(false); requestAnimationFrame(() => addRef.current?.focus()); };

  const radarMetrics = useMemo(() => roleMetrics(facts, role, 8), [facts, role]);
  const { strengths, limits } = useMemo(() => strengthsAndLimits(facts), [facts]);
  const priorities = summary ? observationPriorities(summary.content) : [];
  const ind = snap.indicators ?? {};
  const image = r.player.image ? ({ Player: r.player.name, Image: r.player.image } as PlayerData) : undefined;

  return (
    <article className="sv-panel min-w-0" aria-labelledby={`${uid}-title`}>
      {onBack && (
        <div className="px-4 pt-3">
          <button type="button" onClick={onBack} className="sv-btn sv-btn-ghost sv-btn-sm"><ArrowLeft className="w-3.5 h-3.5" aria-hidden /> Liste des dossiers</button>
        </div>
      )}

      {/* A. Identité */}
      <SectionBlock letter="A" title="Identité">
        <div className="flex items-start gap-3">
          <PlayerAvatar player={image} name={r.player.name} size="md" />
          <div className="min-w-0 flex-1">
            <h2 id={`${uid}-title`} ref={headingRef} tabIndex={-1} className="text-base font-semibold text-ink leading-tight focus:outline-none">{r.player.name}</h2>
            <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-ink-3 mt-0.5">
              <span>{r.player.team}</span><span aria-hidden>·</span>
              <CompetitionBadge competition={r.player.competition} />
              <span className="sv-tag">{r.player.seasonLabel ?? r.player.season}</span>
            </p>
            <p className="text-2xs text-ink-3 mt-1 num">
              {r.player.position ? positionName(r.player.position) : 'Poste inconnu'}
              {r.player.age !== undefined && ` · ${r.player.age} ans`}
              {facts.sample.minutes !== undefined && ` · ${INT.format(Number(facts.sample.minutes))} min`}
              {facts.sample.matches !== undefined && ` (${facts.sample.matches} matchs)`}
              {' · '}créé le {fmtDate(r.createdAt)} · modifié le {fmtDateTime(r.updatedAt)}
            </p>
          </div>
          <StatusChip status={r.status} className="hidden sm:inline-flex" />
        </div>
        <div className="flex flex-wrap items-end gap-x-3 gap-y-2 mt-3">
          <label className="sv-label">
            Statut
            <select value={r.status} onChange={e => onStatus(e.target.value as ReportStatus)} className="sv-select sv-select-sm block mt-1 normal-case tracking-normal font-normal" title={STATUS_META[r.status].hint}>
              {REPORT_STATUSES.map(s => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
            </select>
          </label>
          {roleOptions.length > 0 && (
            <label className="sv-label">
              Rôle analysé
              <select value={role ?? ''} onChange={e => onRole(e.target.value || undefined)} className="sv-select sv-select-sm block mt-1 normal-case tracking-normal font-normal">
                {roleOptions.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
          )}
          <div className="flex flex-wrap gap-1.5 ml-auto">
            {onOpenPlayer && <button type="button" className="sv-btn sv-btn-ghost sv-btn-sm" onClick={onOpenPlayer}><ExternalLink className="w-3.5 h-3.5" aria-hidden /> Fiche</button>}
            <button ref={exportRef} type="button" className="sv-btn sv-btn-secondary sv-btn-sm" onClick={() => exportPdf('synthese')} disabled={exporting} title="Rapport synthèse : quatre pages, dernière synthèse"><Download className="w-3.5 h-3.5" aria-hidden /> {exporting ? 'Export…' : 'PDF'}</button>
            <button ref={exportFullRef} type="button" className="sv-btn sv-btn-ghost sv-btn-sm" onClick={() => exportPdf('complet')} disabled={exporting} title="Rapport complet : annexe avec l'historique des synthèses et toutes les métriques">PDF complet</button>
            {!confirmDelete
              ? <button type="button" className="sv-btn sv-btn-ghost sv-btn-sm" onClick={() => setConfirmDelete(true)}><Trash2 className="w-3.5 h-3.5" aria-hidden /> Supprimer</button>
              : (
                <span className="inline-flex items-center gap-1.5 text-xs text-ink-2" role="group" aria-label="Confirmer la suppression">
                  Supprimer ce dossier ?
                  <button type="button" className="sv-btn sv-btn-secondary sv-btn-sm !text-neg" onClick={onDelete}>Oui, supprimer</button>
                  <button type="button" className="sv-btn sv-btn-ghost sv-btn-sm" onClick={() => setConfirmDelete(false)} autoFocus>Annuler</button>
                </span>
              )}
          </div>
        </div>
        {exportError && <div className="mt-2"><LoadError message={exportError} onRetry={() => exportPdf('synthese')} /></div>}
        <div className="mt-2.5"><TagsEditor tags={r.tags} onChange={onTags} /></div>
      </SectionBlock>

      {/* B. Contexte data */}
      <SectionBlock letter="B" title="Contexte data" help={<InfoTip text="Données figées au moment de la création du dossier ou de la dernière synthèse (snapshot). Elles ne sont pas remplacées quand les données de l'application changent." />}>
        {freshness?.changed && (
          <Note className="mb-2.5">
            Les données actuelles sont plus récentes que ce rapport ({freshness.reasons.join(' ; ')}). Le dossier garde son snapshot ; une nouvelle synthèse l'actualisera.
          </Note>
        )}
        {!livePlayer && <Note className="mb-2.5">Ligne joueur-saison absente de la saison chargée : lecture du snapshot du dossier seulement.</Note>}
        {snap.seasonInProgress && <p className="text-2xs text-ink-3 mb-2">Saison en cours au moment du snapshot : échantillon partiel.</p>}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Stat label="Rôle principal" value={role ?? '—'} sub={roleIndex !== undefined ? `indice ${roleIndex}` : snap.bestRoles.length ? undefined : 'aucun rôle évaluable'} wrapSub />
          <Stat label="Échantillon" value={facts.sample.minutes !== undefined ? `${INT.format(Number(facts.sample.minutes))} min` : '—'}
            sub={facts.sample.matches !== undefined ? `${facts.sample.matches} matchs${facts.sample.shareOfTeamMinutesPct !== undefined ? ` · ${facts.sample.shareOfTeamMinutesPct} % des minutes` : ''}` : undefined} wrapSub />
          <Stat label="Valeur de marché Transfermarkt" value={facts.values.marketValueTransfermarkt ?? 'N/D'} wrapSub />
          <Stat label="Estimation statistique ScoutVision" value={facts.values.estimatedValueScoutVision ?? 'N/D'} sub={facts.values.estimatedValueTypicalError ? `erreur typique ${facts.values.estimatedValueTypicalError} · pas un prix` : undefined} wrapSub />
          <Stat label="Contrat" value={facts.contractUntil ? fmtDate(facts.contractUntil) : 'N/D'} wrapSub />
          <Stat label="Contexte équipe" value={facts.teamContext.style ? String(facts.teamContext.style) : '—'}
            sub={[facts.teamContext.possessionPct !== undefined && `possession ${facts.teamContext.possessionPct} %`, facts.teamContext.ppda !== undefined && `PPDA ${facts.teamContext.ppda}`, facts.teamContext.fieldTiltPct !== undefined && `domination ${facts.teamContext.fieldTiltPct} %`].filter(Boolean).join(' · ') || undefined} wrapSub />
        </div>
        {snap.bestRoles.length > 1 && (
          <p className="text-2xs text-ink-3 mt-2">Autres rôles : {snap.bestRoles.filter(b => b.role !== role).map(b => `${b.role} ${b.index}`).join(' · ')}</p>
        )}
      </SectionBlock>

      {/* C. Snapshot statistique */}
      <SectionBlock letter="C" title="Snapshot statistique" help={<InfoTip text="Percentiles du pipeline (même groupe de poste, même niveau de compétition, même saison), tels qu'ils étaient au snapshot. « inv. » : moins c'est mieux, lu dans l'autre sens." />}>
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-4">
          <div>
            <p className="sv-label mb-1">Radar du rôle{role ? ` · ${role}` : ''}</p>
            {radarMetrics.length >= 3 ? <SnapshotRadar data={radarMetrics.map(m => ({ label: m.metric, value: orientedPercentile(m) }))} /> : <p className="text-xs text-ink-4">Pas assez de métriques pour un radar.</p>}
          </div>
          <div>
            <p className="sv-label mb-1">Principaux percentiles</p>
            <div className="space-y-0.5">
              {radarMetrics.map(m => <PercentileRow key={m.metric} label={<>{m.metric}{m.lessIsPreferable && <span className="text-ink-4"> (inv.)</span>}</>} value={String(m.value).replace('.', ',')} percentile={m.percentile} />)}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-3 pt-3 border-t border-line">
          <div>
            <p className="sv-label text-accent mb-1">Forces statistiques</p>
            {strengths.length ? strengths.map(m => <PercentileRow key={m.metric} label={<>{m.metric}{m.lessIsPreferable && <span className="text-ink-4"> (inv.)</span>}</>} value={String(m.value).replace('.', ',')} percentile={m.percentile} />)
              : <p className="text-xs text-ink-4">Aucune métrique au 75e percentile ou plus.</p>}
          </div>
          <div>
            <p className="sv-label text-neg mb-1">Limites statistiques</p>
            {limits.length ? limits.map(m => <PercentileRow key={m.metric} label={<>{m.metric}{m.lessIsPreferable && <span className="text-ink-4"> (inv.)</span>}</>} value={String(m.value).replace('.', ',')} percentile={m.percentile} />)
              : <p className="text-xs text-ink-4">Aucune métrique au 25e percentile ou moins.</p>}
          </div>
        </div>
      </SectionBlock>

      {/* D. Impact & valeur */}
      <SectionBlock letter="D" title="Impact et valeur" help={<InfoTip text="Modèles du pipeline : plus-minus régularisé (deux saisons), finition au-delà de l'xG resserrée vers la moyenne, part des passes du réseau d'équipe, valeur estimée par la performance (une estimation statistique, pas un prix)." />}>
        {ind.rapm || ind.finishing || ind.passShare || ind.valuation ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat label="Impact (RAPM)" value={ind.rapm ? `${signed(ind.rapm.net, D3)} xG/90` : 'N/D'}
              sub={ind.rapm ? <span className="inline-flex items-center gap-1 flex-wrap">{ind.rapm.pct !== undefined && <PercentileValue value={ind.rapm.pct} className="text-2xs" />}{ind.rapm.reliability ? `fiabilité nette ${D2.format(ind.rapm.reliability.net)}` : ''}</span> : undefined} wrapSub />
            <Stat label="Finition" value={ind.finishing ? `${signed(ind.finishing.skill, D1)} / 100 tirs` : 'N/D'} sub={ind.finishing ? `${ind.finishing.shots} tirs en carrière${ind.finishing.shots < 50 ? ' · petit échantillon' : ''}` : undefined} wrapSub />
            <Stat label="Circulation" value={ind.passShare ? `${D1.format(ind.passShare.value)} %` : 'N/D'} sub={ind.passShare ? <span className="inline-flex items-center gap-1">des passes de l'équipe {ind.passShare.pct !== undefined && <PercentileValue value={ind.passShare.pct} className="text-2xs" />}</span> : undefined} wrapSub />
            <Stat label="Valeur et performance" value={ind.valuation?.market && ind.valuation.estimate ? `${Math.round((ind.valuation.estimate / ind.valuation.market) * 100)} %` : ind.valuation?.estimate ? formatEuro(ind.valuation.estimate) : 'N/D'}
              sub={ind.valuation?.market && ind.valuation.estimate ? `estimation ${formatEuro(ind.valuation.estimate)} / marché ${formatEuro(ind.valuation.market)}` : ind.valuation?.estimate ? 'estimation statistique' : undefined} wrapSub />
          </div>
        ) : <p className="text-xs text-ink-4">Aucun indicateur de modèle dans le snapshot.</p>}
      </SectionBlock>

      {/* E. Projection */}
      <SectionBlock letter="E" title="Projection" help={<InfoTip text="Percentile actuel → percentile attendu la saison prochaine, courbes d'âge du rôle (effet de l'âge et retour vers la moyenne). Une tendance statistique, pas un verdict." />}>
        {snap.projection && snap.projection.length ? (
          <ul className="space-y-1">
            {snap.projection.map(p => (
              <li key={p.metric} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 text-xs">
                <span className="text-ink-2 truncate" title={p.label}>{p.label}</span>
                <span className="num text-ink">P{p.current} → P{p.projected}</span>
                <Delta value={p.projected - p.current} />
              </li>
            ))}
          </ul>
        ) : <p className="text-xs text-ink-4">Projection indisponible (courbes d'âge absentes pour ce rôle ou âge inconnu).</p>}
      </SectionBlock>

      {/* F. Synthèse ScoutVision */}
      <SectionBlock letter="F" title="Synthèse ScoutVision"
        help={<InfoTip text="Texte rédigé par Gemini à partir des seuls faits du snapshot, contrôlé puis conservé tel quel. Chaque génération ajoute une version ; l'ancienne reste consultable avec sa date, son modèle et sa version de prompt." />}
        right={<>
          {summaries.length > 1 && (
            <label className="sv-label">
              <span className="sr-only">Version de la synthèse</span>
              <select value={summary?.id ?? ''} onChange={e => setSummaryId(e.target.value)} className="sv-select sv-select-sm normal-case tracking-normal font-normal" aria-label="Version de la synthèse">
                {summaries.map((s, i) => <option key={s.id} value={s.id}>v{i + 1} · {fmtDate(s.generatedAt)} · {s.model}</option>)}
              </select>
            </label>
          )}
          {onGenerate && (
            <button ref={generateRef} type="button" className="sv-btn sv-btn-secondary sv-btn-sm" onClick={onGenerate} disabled={generating}>
              {generating ? <span className="w-3 h-3 border-2 border-ink-4 border-t-ink rounded-full animate-spin" aria-hidden /> : <Sparkles className="w-3.5 h-3.5" aria-hidden />}
              {generating ? 'Rédaction…' : summaries.length ? 'Nouvelle version' : 'Générer'}
            </button>
          )}
        </>}>
        {generateError && <div className="mb-2"><LoadError message={generateError} onRetry={onGenerate} /></div>}
        {generating && <p role="status" className="text-xs text-ink-3 mb-2">Rédaction en cours (10 à 60 s)…</p>}
        {summary ? (
          <>
            <p className="text-2xs text-ink-3 mb-2 num">
              Version {summaries.indexOf(summary) + 1} / {summaries.length} · {fmtDateTime(summary.generatedAt)} · {summary.model}
              {summary.requestedModel && summary.requestedModel !== summary.model && ` (demandé : ${summary.requestedModel})`} · prompt {summary.promptVersion}
            </p>
            <div className="text-[13px]"><ReactMarkdown components={MD as never}>{summary.content}</ReactMarkdown></div>
            {summaries.length > 1 && (
              <details className="mt-3 text-2xs text-ink-3">
                <summary className="cursor-pointer text-ink-2">Historique des versions</summary>
                <ul className="mt-1.5 space-y-0.5 num">
                  {summaries.map((s, i) => <li key={s.id}>v{i + 1} · {fmtDateTime(s.generatedAt)} · {s.model} · {s.promptVersion}{s.id === summary.id ? ' · affichée' : ''}</li>)}
                </ul>
              </details>
            )}
          </>
        ) : (
          <p className="text-xs text-ink-4">Aucune synthèse IA. {onGenerate ? 'Générez-en une depuis ce dossier ou depuis la fiche.' : 'Elle se génère depuis la fiche du joueur, avec la saison du dossier chargée.'} Le dossier reste utilisable sans elle.</p>
        )}
      </SectionBlock>

      {/* G. Priorités d'observation */}
      <SectionBlock letter="G" title="Priorités d'observation" help={<InfoTip text="Points à vérifier en vidéo ou en live, issus de la section 5 de la synthèse ScoutVision : chacun est lié à une donnée, aucun n'est une conclusion." />}>
        {priorities.length ? (
          <ul className="space-y-1 pl-4 list-disc marker:text-ink-4 text-xs text-ink-2">{priorities.map((p, i) => <li key={i}>{p}</li>)}</ul>
        ) : <p className="text-xs text-ink-4">{summary ? 'La synthèse ne contient pas de section de priorités.' : 'Sans synthèse : partez des forces et limites statistiques (bloc C).'}</p>}
      </SectionBlock>

      {/* H. Observations humaines */}
      <SectionBlock letter="H" title="Observations humaines" help={<InfoTip text="Notes de l'observateur (vidéo, live, général). Jamais générées ni complétées par un modèle ; elles ne modifient aucun chiffre et ne produisent aucun score." />}
        right={<button ref={addRef} type="button" className="sv-btn sv-btn-primary sv-btn-sm" onClick={() => { setAdding(true); setEditing(null); }} disabled={adding} aria-expanded={adding}><Plus className="w-3.5 h-3.5" aria-hidden /> Observation</button>}>
        {adding && <div className="mb-3"><ObservationForm onSubmit={obs => { onAddObservation(obs); closeForm(); }} onCancel={closeForm} /></div>}
        {r.observations.length === 0 && !adding ? (
          <EmptyState title="Aucune observation.">Ajoutez ce que vous avez vu en vidéo ou en live : ces notes restent séparées des chiffres.</EmptyState>
        ) : (
          <ul className="space-y-2">
            {[...r.observations].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)).map((o: ScoutObservation) => (
              <li key={o.id} className="rounded-md border border-line p-3">
                {editing === o.id ? (
                  <ObservationForm initial={o} submitLabel="Enregistrer les modifications" onSubmit={obs => { onUpdateObservation(o.id, obs); setEditing(null); requestAnimationFrame(() => addRef.current?.focus()); }} onCancel={() => { setEditing(null); requestAnimationFrame(() => addRef.current?.focus()); }} />
                ) : (
                  <>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-2xs font-semibold text-accent">{TYPE_LABELS[o.type]} · {fmtDate(o.date)}</span>
                      <span className="flex items-center gap-0.5">
                        <button type="button" className="sv-icon-btn" aria-label="Modifier l'observation" onClick={() => { setEditing(o.id); setAdding(false); }}><Pencil className="w-3.5 h-3.5" aria-hidden /></button>
                        <button type="button" className="sv-icon-btn" aria-label="Supprimer l'observation" onClick={() => { onRemoveObservation(o.id); requestAnimationFrame(() => addRef.current?.focus()); }}><Trash2 className="w-3.5 h-3.5" aria-hidden /></button>
                      </span>
                    </div>
                    <p className="text-[13px] text-ink-2 whitespace-pre-wrap leading-relaxed mt-1">{o.text}</p>
                    {(o.strengths || o.toReview || o.conclusion) && (
                      <dl className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-2 text-xs">
                        {o.strengths && <div><dt className="sv-label">Forces observées</dt><dd className="text-ink-2 whitespace-pre-wrap">{o.strengths}</dd></div>}
                        {o.toReview && <div><dt className="sv-label">À revoir</dt><dd className="text-ink-2 whitespace-pre-wrap">{o.toReview}</dd></div>}
                        {o.conclusion && <div><dt className="sv-label">Conclusion</dt><dd className="text-ink whitespace-pre-wrap">{o.conclusion}</dd></div>}
                      </dl>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </SectionBlock>
    </article>
  );
};

export default ReportDossier;
