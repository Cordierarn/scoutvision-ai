/**
 * ScoutVision - sélection multiple avec recherche (combobox / listbox accessible, sur le modèle de TeamSearch)
 *
 * Clavier : flèches pour parcourir, Entrée pour cocher ou décocher l'option active (la liste reste ouverte),
 * Échap pour fermer (puis vider la recherche), Retour arrière dans un champ vide pour retirer la dernière puce.
 * Les valeurs choisies s'affichent en puces retirables ; après un retrait, le focus va à la puce suivante,
 * sinon au champ.
 */

import React, { useId, useMemo, useRef, useState } from 'react';
import { Check, Search, X } from 'lucide-react';

export interface ComboOption { value: string; label: string; hint?: string }

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export const MultiCombobox: React.FC<{
  label: string;
  options: ComboOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  /** Nombre d'options affichées sans recherche (les choisies d'abord) */
  limit?: number;
  /** Libellé d'une valeur choisie absente des options (ex. club d'une autre saison) */
  missingLabel?: (value: string) => string;
  /** Raccourcis : cochent un ensemble de valeurs (présentes dans les options) */
  shortcuts?: { label: string; values: string[] }[];
  shortcutsNote?: string;
  className?: string;
}> = ({ label, options, selected, onChange, placeholder = 'Rechercher', limit = 60, missingLabel, shortcuts, shortcutsNote, className = '' }) => {
  const uid = useId();
  const listId = `${uid}-list`;
  const inputRef = useRef<HTMLInputElement>(null);
  const chipsRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  const chosen = useMemo(() => new Set(selected), [selected]);
  const byValue = useMemo(() => new Map(options.map(o => [o.value, o])), [options]);
  const results = useMemo(() => {
    const q = fold(query.trim());
    const list = q ? options.filter(o => fold(o.label).includes(q) || (o.hint && fold(o.hint).includes(q))) : options;
    return list.slice(0, q ? 200 : limit);
  }, [options, query, limit]);
  const showList = open;

  const toggle = (value: string) => onChange(chosen.has(value) ? selected.filter(v => v !== value) : [...selected, value]);

  const removeAt = (i: number) => {
    const next = selected.filter((_, k) => k !== i);
    onChange(next);
    // Focus : puce suivante (même rang), sinon précédente, sinon le champ
    requestAnimationFrame(() => {
      const chips = chipsRef.current?.querySelectorAll<HTMLButtonElement>('button[data-chip]');
      const target = chips && chips.length ? chips[Math.min(i, chips.length - 1)] : null;
      (target ?? inputRef.current)?.focus();
    });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive(a => Math.min(a + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setOpen(true); setActive(a => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') {
      if (showList && results.length) { e.preventDefault(); toggle(results[active >= 0 ? active : 0].value); }
    } else if (e.key === 'Escape') {
      if (open) { e.preventDefault(); setOpen(false); setActive(-1); } else if (query) { e.preventDefault(); setQuery(''); }
    } else if (e.key === 'Backspace' && !query && selected.length) {
      onChange(selected.slice(0, -1));
    }
  };

  const nameOf = (v: string) => byValue.get(v)?.label ?? missingLabel?.(v) ?? v;

  return (
    <div className={className} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) { setOpen(false); setActive(-1); } }}>
      <label htmlFor={`${uid}-input`} className="sv-label block mb-1">{label}</label>
      <div className="relative">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-ink-4 pointer-events-none" aria-hidden />
        <input id={`${uid}-input`} ref={inputRef} type="text" autoComplete="off" placeholder={placeholder}
          className="sv-input sv-input-sm pl-7" role="combobox" aria-autocomplete="list" aria-expanded={showList} aria-controls={listId}
          aria-activedescendant={showList && active >= 0 && results[active] ? `${listId}-${active}` : undefined}
          value={query} onKeyDown={onKeyDown} onFocus={() => setOpen(true)} onClick={() => setOpen(true)}
          onChange={e => { setQuery(e.target.value); setOpen(true); setActive(-1); }} />
        {showList && (
          <ul id={listId} role="listbox" aria-multiselectable="true" aria-label={label}
            className="sv-menu absolute left-0 right-0 top-full mt-1 z-30 max-h-64 overflow-y-auto py-1">
            {results.map((o, i) => {
              const on = chosen.has(o.value);
              return (
                <li key={o.value} id={`${listId}-${i}`} role="option" aria-selected={on}
                  onMouseDown={e => e.preventDefault()} onMouseEnter={() => setActive(i)} onClick={() => toggle(o.value)}
                  className={`flex items-center gap-2 px-2.5 py-1 cursor-pointer text-xs ${i === active ? 'bg-line-strong/50' : ''} ${on ? 'text-accent' : 'text-ink-2'}`}>
                  <Check className={`w-3 h-3 shrink-0 ${on ? '' : 'invisible'}`} aria-hidden />
                  <span className="min-w-0 flex-1 truncate" title={o.label}>{o.label}</span>
                  {o.hint && <span className="shrink-0 text-2xs text-ink-4">{o.hint}</span>}
                </li>
              );
            })}
            {results.length === 0 && <li role="presentation" className="px-2.5 py-2 text-xs text-ink-3">Aucun résultat</li>}
          </ul>
        )}
      </div>
      {shortcuts && shortcuts.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 mt-1">
          {shortcuts.map(s => {
            const values = s.values.filter(v => byValue.has(v));
            return (
              <button key={s.label} type="button" className="sv-btn sv-btn-ghost sv-btn-sm !h-6 !px-1.5 !text-2xs"
                onClick={() => onChange([...selected, ...values.filter(v => !chosen.has(v))])}
                aria-label={`Ajouter ${s.label} (${values.length} pays présents dans les données)`}>
                + {s.label}
              </button>
            );
          })}
          {shortcutsNote && <span className="text-2xs text-ink-4">{shortcutsNote}</span>}
        </div>
      )}
      {selected.length > 0 && (
        <div ref={chipsRef} className="flex flex-wrap gap-1 mt-1.5">
          {selected.map((v, i) => (
            <button key={v} type="button" data-chip onClick={() => removeAt(i)} className="sv-chip sv-chip-on !h-6" aria-label={`Retirer ${nameOf(v)}`}>
              <span className="truncate max-w-[12rem]" title={nameOf(v)}>{nameOf(v)}</span> <X className="w-3 h-3 shrink-0" aria-hidden />
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default MultiCombobox;
