/**
 * ScoutVision - filtres enregistrés et lien de partage (menu partagé par Base joueurs, Chasseur, Similaires)
 *
 * Un bouton ouvre un petit panneau : enregistrer les réglages courants sous un nom, appliquer ou
 * supprimer un filtre enregistré, copier un lien qui rouvre la page avec ces réglages. Rien n'est
 * appliqué sans un clic ; le focus revient au bouton à la fermeture.
 */

import React, { useEffect, useId, useRef, useState } from 'react';
import { Bookmark, Link2, Trash2, X } from 'lucide-react';
import { FilterData, SavedFilter, loadSavedFilters, removeSavedFilter, saveFilter, shareUrl } from '../../utils/savedFilters';

const DATE = new Intl.DateTimeFormat('fr-FR');

export const SavedFiltersMenu: React.FC<{
  current: FilterData;                    // réglages courants de la page
  onApply: (data: FilterData['data']) => void;
  className?: string;
  size?: 'sm' | 'md';
}> = ({ current, onApply, className = '', size = 'md' }) => {
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState<SavedFilter[]>(() => loadSavedFilters(current.page));
  const [name, setName] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const refresh = () => setSaved(loadSavedFilters(current.page));
  const btn = size === 'sm' ? 'sv-btn sv-btn-secondary sv-btn-sm' : 'sv-btn sv-btn-secondary';

  const close = () => { setOpen(false); setStatus(null); setFallbackUrl(null); requestAnimationFrame(() => buttonRef.current?.focus()); };
  useEffect(() => {
    if (!open) return;
    refresh();
    requestAnimationFrame(() => nameRef.current?.focus());
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
    const onDown = (e: MouseEvent) => { if (panelRef.current && !panelRef.current.contains(e.target as Node) && e.target !== buttonRef.current) close(); };
    document.addEventListener('keydown', onKey); document.addEventListener('mousedown', onDown);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const save = () => {
    try { const f = saveFilter(name, current); setName(''); refresh(); setStatus(`« ${f.name} » enregistré.`); }
    catch (e) { setStatus(e instanceof Error ? e.message : 'Enregistrement impossible.'); }
  };
  const copyLink = async () => {
    const url = shareUrl(current);
    try { await navigator.clipboard.writeText(url); setStatus('Lien copié : il rouvre cette page avec ces réglages.'); setFallbackUrl(null); }
    catch { setFallbackUrl(url); setStatus('Copie automatique impossible : sélectionnez le lien ci-dessous.'); }
  };

  return (
    <div className={`relative ${className}`}>
      <button ref={buttonRef} type="button" className={btn} onClick={() => (open ? close() : setOpen(true))} aria-expanded={open} aria-haspopup="dialog" aria-controls={`${uid}-panel`}>
        <Bookmark className="w-3.5 h-3.5" aria-hidden /> Enregistrés{saved.length ? <span className="text-2xs text-ink-4 num">{saved.length}</span> : null}
      </button>
      {open && (
        <div ref={panelRef} id={`${uid}-panel`} role="dialog" aria-label="Filtres enregistrés et partage" className="sv-menu absolute left-0 top-full mt-1 z-30 w-[22rem] max-w-[calc(100vw-2rem)] p-3 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <p className="sv-label">Filtres enregistrés</p>
            <button type="button" className="sv-icon-btn" aria-label="Fermer" onClick={close}><X className="w-3.5 h-3.5" aria-hidden /></button>
          </div>
          <form className="flex items-end gap-2" onSubmit={e => { e.preventDefault(); save(); }}>
            <label className="sv-label flex-1 min-w-0">
              Enregistrer les réglages actuels
              <input ref={nameRef} value={name} onChange={e => setName(e.target.value)} maxLength={60} placeholder="Nom du filtre" className="sv-input sv-input-sm block mt-1 w-full normal-case tracking-normal font-normal" />
            </label>
            <button type="submit" className="sv-btn sv-btn-primary sv-btn-sm" disabled={!name.trim()}>Enregistrer</button>
          </form>
          {saved.length ? (
            <ul className="max-h-56 overflow-y-auto space-y-px" aria-label="Filtres enregistrés pour cette page">
              {saved.map(f => (
                <li key={f.id} className="flex items-center gap-1.5">
                  <button type="button" className="flex-1 min-w-0 text-left px-2 py-1.5 rounded-md hover:bg-raised text-xs text-ink" onClick={() => { onApply(f.data); setStatus(`« ${f.name} » appliqué.`); }}>
                    <span className="block truncate">{f.name}</span>
                    <span className="block text-2xs text-ink-4">{DATE.format(new Date(f.createdAt))}</span>
                  </button>
                  <button type="button" className="sv-icon-btn" aria-label={`Supprimer le filtre ${f.name}`} onClick={() => { removeSavedFilter(f.id); refresh(); setStatus(`« ${f.name} » supprimé.`); }}><Trash2 className="w-3.5 h-3.5" aria-hidden /></button>
                </li>
              ))}
            </ul>
          ) : <p className="text-xs text-ink-4">Aucun filtre enregistré pour cette page. Les filtres sont conservés dans ce navigateur.</p>}
          <div className="border-t border-line pt-2.5">
            <button type="button" className="sv-btn sv-btn-ghost sv-btn-sm" onClick={copyLink}><Link2 className="w-3.5 h-3.5" aria-hidden /> Copier le lien de ces réglages</button>
            {fallbackUrl && <input readOnly value={fallbackUrl} onFocus={e => e.currentTarget.select()} aria-label="Lien de partage" className="sv-input sv-input-sm mt-1.5 w-full normal-case tracking-normal font-normal" />}
          </div>
          <p role="status" aria-live="polite" className="text-2xs text-ink-3 min-h-[1rem]">{status ?? ''}</p>
        </div>
      )}
    </div>
  );
};

export default SavedFiltersMenu;
