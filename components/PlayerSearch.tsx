/**
 * ScoutVision - recherche d'un joueur (combobox / listbox accessible)
 * Même comportement partout : saisie, flèches, Entrée, Échap, Tab ; résultats avec club,
 * compétition, poste, minutes, saison, coupe, et signalement des lignes sans statistiques.
 */

import React, { useId, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { PlayerData, getPlayerSeasonId, getPlayerSeasonTag } from '../types';
import { queryService } from '../services/queryService';
import { positionLabel } from '../utils/labels';
import { hasDetailedStats } from '../utils/comparison';
import { competitionName, isCup, minutesOf } from '../utils/playerContext';
import { PlayerAvatar } from './Media';

const INTEGER = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });

export const PlayerSearch: React.FC<{
  label: React.ReactNode;
  labelRight?: React.ReactNode;
  placeholder?: string;
  selectedIds?: Set<string>;                  // entrées déjà choisies : signalées, non sélectionnables
  duplicateMessage?: (p: PlayerData) => string;
  pickedMessage?: (p: PlayerData) => string;
  onPick: (p: PlayerData) => void;
  inputRef?: React.RefObject<HTMLInputElement>;
  framed?: boolean;                           // cadre en pointillés (emplacement libre de la Comparaison)
  className?: string;
}> = ({ label, labelRight, placeholder = 'Nom du joueur ou du club', selectedIds, duplicateMessage, pickedMessage, onPick, inputRef, framed = false, className = '' }) => {
  const uid = useId();
  const listId = `${uid}-list`;
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [feedback, setFeedback] = useState('');

  const results = useMemo(() => (query.trim() ? queryService.searchPlayers(query.trim(), { limit: 12 }) : []), [query]);
  const showList = open && query.trim().length > 0;

  const choose = (i: number) => {
    const p = results[i];
    if (!p) return;
    if (selectedIds?.has(getPlayerSeasonId(p))) { setFeedback(duplicateMessage?.(p) ?? `${p.Player} est déjà sélectionné.`); setActive(i); return; }
    setQuery(''); setOpen(false); setActive(-1);
    setFeedback(pickedMessage?.(p) ?? '');
    onPick(p);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive(a => Math.min(a + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setOpen(true); setActive(a => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') { if (showList && results.length) { e.preventDefault(); choose(active >= 0 ? active : 0); } }
    else if (e.key === 'Escape') { e.preventDefault(); setQuery(''); setOpen(false); setActive(-1); setFeedback(''); }
  };

  return (
    <div className={`${framed ? 'rounded-lg border border-dashed border-line-strong p-2.5 flex flex-col justify-center' : ''} ${className}`}
      onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false); }}>
      <label htmlFor={`${uid}-input`} className="sv-label mb-1.5 flex items-center justify-between">
        {label}{labelRight}
      </label>
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-4 pointer-events-none" aria-hidden />
        <input ref={inputRef} id={`${uid}-input`} type="text" autoComplete="off" placeholder={placeholder}
          className="sv-input pl-8" role="combobox" aria-autocomplete="list" aria-expanded={showList} aria-controls={listId}
          aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
          value={query} onKeyDown={onKeyDown} onFocus={() => setOpen(true)}
          onChange={e => { setQuery(e.target.value); setOpen(true); setActive(-1); setFeedback(''); }} />
        {showList && (
          <ul id={listId} role="listbox" aria-label="Joueurs trouvés" className="sv-menu absolute left-0 right-0 top-full mt-1 z-30 max-h-80 overflow-y-auto py-1">
            {results.map((p, i) => {
              const id = getPlayerSeasonId(p);
              const duplicate = !!selectedIds?.has(id);
              const detailed = hasDetailedStats(p);
              const minutes = minutesOf(p);
              return (
                <li key={id} id={`${listId}-${i}`} role="option" aria-selected={i === active} aria-disabled={duplicate || undefined}
                  onMouseDown={e => e.preventDefault()} onMouseEnter={() => setActive(i)} onClick={() => choose(i)}
                  className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer ${i === active ? 'bg-line-strong/50' : ''}`}>
                  <PlayerAvatar player={p} size="xs" />
                  <span className="min-w-0 flex-1">
                    <span className={`block text-xs ${duplicate ? 'text-ink-3' : 'text-ink'}`}>{p.Player || 'Inconnu'}</span>
                    <span className="block text-2xs text-ink-3 leading-snug">
                      {p.Team} · {competitionName(p)} · {positionLabel(p.Position)} · {minutes !== null ? `${INTEGER.format(minutes)} min` : 'minutes inconnues'}
                    </span>
                    {(duplicate || !detailed) && (
                      <span className="block text-2xs text-ink-2 mt-0.5">
                        {duplicate ? 'Déjà sélectionné' : 'Sans statistiques détaillées sur cette ligne'}
                      </span>
                    )}
                  </span>
                  <span className="flex flex-col items-end gap-0.5 shrink-0">
                    <span className="sv-tag">{getPlayerSeasonTag(p)}</span>
                    {isCup(p) && <span className="sv-tag !font-normal">Coupe</span>}
                  </span>
                </li>
              );
            })}
            {results.length === 0 && <li role="presentation" className="px-3 py-2 text-xs text-ink-3">Aucun joueur trouvé dans la saison chargée</li>}
          </ul>
        )}
      </div>
      <p role="status" aria-live="polite" className="text-2xs text-ink-3 mt-1.5 min-h-[1rem] leading-snug">{feedback}</p>
    </div>
  );
};
