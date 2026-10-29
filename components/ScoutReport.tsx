/**
 * ScoutVision - Rapports de scouting : espace de travail local
 * Joueur → snapshot des données → synthèse ScoutVision (Gemini, versionnée) → observations
 * humaines → statut → export PDF. Dossiers stockés dans le navigateur (localStorage), export et
 * import JSON pour la sauvegarde. Liste à gauche et dossier à droite à partir de 1 280 px ;
 * en dessous, liste puis dossier avec retour.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ClipboardList, Download, Upload } from 'lucide-react';
import { PlayerData, getPlayerSeasonId } from '../types';
import { dataLoader } from '../services/dataLoader';
import { useAsyncData } from '../hooks/useAsyncData';
import { useMediaQuery } from '../hooks/useMediaQuery';
import {
  ObservationInput, ReportStoreError, addObservation, deleteReport, exportFileName, exportReportsJson, importReportsJson, loadReports,
  removeObservation, setRole, setStatus, setTags, subscribeReports, updateObservation, reveal, setBlind,
} from '../services/scoutReportStore';
import { ScoutReportError } from '../services/scoutReportService';
import { ReportStatus, ScoutReportRecord } from '../types/scoutReport';
import { PdfMode, downloadReportPdf } from '../utils/scoutReportPdf';
import { EmptyState, PageHeader } from './ui';
import { createDossier, generateAndStore } from './reports/generateReport';
import { PlayerPicker } from './reports/PlayerPicker';
import { EMPTY_FILTERS, ListFilters, ReportList } from './reports/ReportList';
import { ReportDossier } from './reports/ReportDossier';
import { Note } from './reports/shared';

const WIDE = '(min-width: 1280px)';
type Step = 'list' | 'dossier';
const memory: { selectedId: string | null; filters: ListFilters; step: Step } = { selectedId: null, filters: EMPTY_FILTERS, step: 'list' };

interface Flash { tone: 'info' | 'warn'; text: string }

const ScoutReport: React.FC<{ data: PlayerData[]; onSelectPlayer?: (player: PlayerData) => void }> = ({ data, onSelectPlayer }) => {
  const [loaded, setLoaded] = useState(() => loadReports());
  useEffect(() => subscribeReports(() => setLoaded(loadReports())), []);
  const records = loaded.records;
  const [selectedId, setSelectedId] = useState<string | null>(memory.selectedId);
  const [filters, setFilters] = useState<ListFilters>(memory.filters);
  const [step, setStep] = useState<Step>(memory.step);
  useEffect(() => { memory.selectedId = selectedId; memory.filters = filters; memory.step = step; }, [selectedId, filters, step]);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const wide = useMediaQuery(WIDE);
  const curves = useAsyncData(() => dataLoader.loadAgeCurves(), []);
  const dataIndex = dataLoader.getCachedIndex();

  const selected = records.find(r => r.id === selectedId);
  const byPlayerSeason = useMemo(() => new Map(data.map(p => [getPlayerSeasonId(p), p])), [data]);
  const existing = useMemo(() => new Set(records.map(r => r.player.playerSeasonId)), [records]);
  const livePlayer = selected ? byPlayerSeason.get(selected.player.playerSeasonId) : undefined;

  // Focus : titre du dossier après sélection, liste après retour
  const headingRef = useRef<HTMLHeadingElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const pending = useRef<'dossier' | 'list' | null>(null);
  useEffect(() => {
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    if (p === 'dossier') { headingRef.current?.focus({ preventScroll: wide }); if (!wide) headingRef.current?.closest('article')?.scrollIntoView({ block: 'start' }); }
    if (p === 'list') {
      const row = listRef.current?.querySelector<HTMLButtonElement>('button[aria-current="true"]') ?? listRef.current?.querySelector<HTMLButtonElement>('button');
      (row ?? pickerRef.current?.querySelector<HTMLInputElement>('input'))?.focus();
    }
  });

  const guard = (fn: () => void) => {
    try { fn(); setFlash(null); } catch (e) { setFlash({ tone: 'warn', text: e instanceof ReportStoreError ? e.message : 'Enregistrement impossible.' }); }
  };
  const select = useCallback((id: string) => { setSelectedId(id); setStep('dossier'); setGenerateError(null); setExportError(null); pending.current = 'dossier'; }, []);
  const back = useCallback(() => { setStep('list'); pending.current = 'list'; }, []);

  const onPick = async (player: PlayerData) => {
    try {
      const record = await createDossier(player, curves.data ?? null);
      select(record.id);
      setFlash(existing.has(record.player.playerSeasonId) ? null : { tone: 'info', text: `Dossier ouvert pour ${record.player.name} : données figées à aujourd'hui, sans synthèse IA.` });
    } catch (e) { setFlash({ tone: 'warn', text: e instanceof ReportStoreError ? e.message : 'Le dossier n\'a pas pu être créé.' }); }
  };

  const onGenerate = livePlayer ? async () => {
    setGenerating(true); setGenerateError(null);
    try { await generateAndStore(livePlayer, curves.data ?? null); }
    catch (e) { setGenerateError(e instanceof ScoutReportError || e instanceof ReportStoreError ? e.message : 'Le rapport n\'a pas pu être généré. Réessayez.'); }
    finally { setGenerating(false); }
  } : undefined;

  const onExportPdf = (record: ScoutReportRecord, mode: PdfMode = 'synthese') => {
    setExporting(true); setExportError(null);
    // Laisse le bouton afficher son état avant le calcul du PDF (photo chargée puis document écrit)
    setTimeout(async () => {
      try { await downloadReportPdf(record, { dataGeneratedAt: dataIndex?.generatedAt, mode }); }
      catch { setExportError('L\'export PDF a échoué. Réessayez ; si le problème persiste, exportez les dossiers en JSON.'); }
      finally { setExporting(false); }
    }, 0);
  };

  const exportJson = () => {
    const blob = new Blob([exportReportsJson(records)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = exportFileName(); document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setFlash({ tone: 'info', text: `${records.length} dossier${records.length > 1 ? 's' : ''} exporté${records.length > 1 ? 's' : ''} en JSON (dossiers seulement, aucune clé ni cache).` });
  };
  const fileInput = useRef<HTMLInputElement>(null);
  const importJson = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    try {
      const r = importReportsJson(text);
      setFlash({ tone: r.errors.length && !r.added && !r.updated ? 'warn' : 'info', text: `Import : ${r.added} ajouté${r.added > 1 ? 's' : ''}, ${r.updated} mis à jour, ${r.skipped} ignoré${r.skipped > 1 ? 's' : ''}.${r.errors.length ? ` ${r.errors[0]}` : ''}` });
    } catch (e) { setFlash({ tone: 'warn', text: e instanceof ReportStoreError ? e.message : 'Import impossible.' }); }
    if (fileInput.current) fileInput.current.value = '';
  };

  const showStep = (s: Step) => (step === s ? '' : 'max-xl:hidden');
  const dossierVisible = wide || step === 'dossier';

  return (
    <div className="p-4 sm:p-5 space-y-4 animate-fade-in overflow-x-clip">
      <PageHeader title="Rapports de scouting" icon={ClipboardList}
        description="Dossiers par joueur-saison : données figées, synthèse ScoutVision versionnée, observations humaines, statut et export PDF. Stockés dans ce navigateur ; exportez-les en JSON pour les conserver." />

      {loaded.ignored > 0 && <Note tone="warn">{loaded.ignored} enregistrement{loaded.ignored > 1 ? 's' : ''} illisible{loaded.ignored > 1 ? 's' : ''} dans le stockage local, laissé{loaded.ignored > 1 ? 's' : ''} de côté. Les autres dossiers sont intacts.</Note>}
      {flash && <Note tone={flash.tone}>{flash.text}</Note>}

      <div className="xl:grid xl:grid-cols-[26rem_minmax(0,1fr)] 2xl:grid-cols-[28rem_minmax(0,1fr)] xl:gap-4 xl:items-start">
        <div className={`space-y-3 min-w-0 ${showStep('list')}`}>
          <section className="sv-panel" aria-label="Nouveau dossier">
            <div className="px-4 pt-3 pb-3">
              <p className="sv-label mb-1.5">Nouveau dossier <span className="normal-case tracking-normal font-normal text-ink-4">· joueur-saison de la saison chargée</span></p>
              <div ref={pickerRef}><PlayerPicker data={data} existing={existing} onPick={onPick} autoFocus={records.length === 0} /></div>
            </div>
          </section>
          <section className="sv-panel" aria-labelledby="reports-list-title">
            <div className="flex items-center justify-between gap-3 px-4 pt-3 pb-2">
              <h2 id="reports-list-title" className="text-xs font-semibold uppercase tracking-[0.08em] text-ink">Dossiers</h2>
              <div className="flex items-center gap-1.5">
                <button type="button" className="sv-btn sv-btn-ghost sv-btn-sm" onClick={exportJson} disabled={records.length === 0}><Download className="w-3.5 h-3.5" aria-hidden /> Exporter</button>
                <button type="button" className="sv-btn sv-btn-ghost sv-btn-sm" onClick={() => fileInput.current?.click()}><Upload className="w-3.5 h-3.5" aria-hidden /> Importer</button>
                <input ref={fileInput} type="file" accept="application/json,.json" className="sr-only" aria-label="Importer des dossiers (JSON)" onChange={e => importJson(e.target.files?.[0])} />
              </div>
            </div>
            {records.length === 0 ? (
              <EmptyState icon={ClipboardList} title="Aucun dossier pour l'instant.">Cherchez un joueur ci-dessus : son dossier s'ouvre avec ses données figées, même sans Gemini.</EmptyState>
            ) : (
              <ReportList records={records} filters={filters} onFilters={patch => setFilters(f => ({ ...f, ...patch }))} selectedId={selectedId ?? undefined} onSelect={select} listRef={listRef} />
            )}
          </section>
        </div>

        <aside aria-label="Dossier sélectionné" className={`${showStep('dossier')} min-w-0 xl:sticky xl:top-4 xl:max-h-[calc(100dvh-5rem)] xl:overflow-y-auto xl:overscroll-contain rounded-lg`}>
          <p className="sr-only" aria-live="polite">{selected ? `Dossier affiché : ${selected.player.name}` : ''}</p>
          {selected && dossierVisible ? (
            <ReportDossier key={selected.id} record={selected} livePlayer={livePlayer} curves={curves.data ?? null} dataIndex={dataIndex}
              onStatus={(s: ReportStatus) => guard(() => setStatus(selected.id, s))}
              onTags={tags => guard(() => setTags(selected.id, tags))}
              onRole={role => guard(() => setRole(selected.id, role))}
              onAddObservation={(obs: ObservationInput) => guard(() => addObservation(selected.id, obs))}
              onUpdateObservation={(id, obs) => guard(() => updateObservation(selected.id, id, obs))}
              onRemoveObservation={id => guard(() => removeObservation(selected.id, id))}
              onBlind={blind => guard(() => setBlind(selected.id, blind))}
              onReveal={() => guard(() => reveal(selected.id))}
              onGenerate={onGenerate} generating={generating} generateError={generateError}
              onExportPdf={mode => onExportPdf(selected, mode)} exporting={exporting} exportError={exportError}
              onDelete={() => { guard(() => deleteReport(selected.id)); setSelectedId(null); back(); }}
              onOpenPlayer={livePlayer && onSelectPlayer ? () => onSelectPlayer(livePlayer) : undefined}
              onBack={wide ? undefined : back} headingRef={headingRef} />
          ) : (
            <div className="sv-panel"><EmptyState icon={ClipboardList} title="Aucun dossier sélectionné.">Choisissez un dossier dans la liste, ou cherchez un joueur pour en ouvrir un.</EmptyState></div>
          )}
        </aside>
      </div>
    </div>
  );
};

export default ScoutReport;
