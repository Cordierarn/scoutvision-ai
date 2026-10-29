/**
 * ScoutVision - Rapports : recherche d'une ligne joueur-saison pour ouvrir un dossier
 * (combobox / listbox accessible, sur le modèle de TeamSearch). Une option = une ligne
 * joueur-saison : la compétition et la saison sont visibles, les coupes distinguées, les
 * dossiers existants signalés.
 */

import React, { useId, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { PlayerData, getPlayerSeasonId, getPlayerSeasonTag } from '../../types';
import { isLeagueCompetition } from '../../utils/teamContext';
import { positionLabel } from '../../utils/labels';
import { CompetitionBadge, PlayerAvatar } from '../Media';

const LIMIT = 15;
const INT = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });

export const PlayerPicker: React.FC<{
  data: PlayerData[];
  existing: Set<string>;             // playerSeasonId des dossiers déjà ouverts
  onPick: (player: PlayerData) => void;
  label?: string;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
}> = ({ data, existing, onPick, label = 'Rechercher un joueur ou un club', placeholder = 'Joueur ou club', autoFocus, className = '' }) => {
  const uid = useId();
  const listId = `${uid}-list`;
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  const results = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('fr');
    if (q.length < 2) return [];
    const hits = data.filter(p => String(p.Player ?? '').toLocaleLowerCase('fr').includes(q) || String(p.Team ?? '').toLocaleLowerCase('fr').includes(q));
    // Championnats d'abord, puis coupes ; à nom égal, le plus de minutes
    return hits.sort((a, b) => Number(!isLeagueCompetition(a.Competition ?? '')) - Number(!isLeagueCompetition(b.Competition ?? ''))
      || String(a.Player).localeCompare(String(b.Player), 'fr') || (Number(b['Minutes played']) || 0) - (Number(a['Minutes played']) || 0)).slice(0, LIMIT);
  }, [data, query]);
  const showList = open && query.trim().length >= 2;

  const choose = (i: number) => {
    const p = results[i];
    if (!p) return;
    setQuery(''); setOpen(false); setActive(-1);
    onPick(p);
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive(a => Math.min(a + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setOpen(true); setActive(a => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') { if (showList && results.length) { e.preventDefault(); choose(active >= 0 ? active : 0); } }
    else if (e.key === 'Escape') { e.preventDefault(); setQuery(''); setOpen(false); setActive(-1); }
  };

  return (
    <div className={className} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false); }}>
      <label htmlFor={`${uid}-input`} className="sr-only">{label}</label>
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-4 pointer-events-none" aria-hidden />
        <input id={`${uid}-input`} type="text" autoComplete="off" autoFocus={autoFocus} placeholder={placeholder}
          className="sv-input pl-8" role="combobox" aria-autocomplete="list" aria-expanded={showList} aria-controls={listId}
          aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
          value={query} onKeyDown={onKeyDown} onFocus={() => setOpen(true)}
          onChange={e => { setQuery(e.target.value); setOpen(true); setActive(-1); }} />
        {showList && (
          <ul id={listId} role="listbox" aria-label="Joueurs trouvés" className="sv-menu absolute left-0 right-0 top-full mt-1 z-30 max-h-96 overflow-y-auto py-1">
            {results.map((p, i) => {
              const id = getPlayerSeasonId(p);
              const cup = !isLeagueCompetition(p.Competition ?? '');
              const has = existing.has(id);
              return (
                <li key={id} id={`${listId}-${i}`} role="option" aria-selected={i === active}
                  onMouseDown={e => e.preventDefault()} onMouseEnter={() => setActive(i)} onClick={() => choose(i)}
                  className={`flex items-center gap-2.5 px-3 py-1.5 cursor-pointer ${i === active ? 'bg-line-strong/50' : ''}`}>
                  <PlayerAvatar player={p} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 min-w-0">
                      <span className="text-[13px] text-ink truncate">{p.Player}</span>
                      <span className="sv-tag shrink-0">{positionLabel(p.Position)}</span>
                      {has && <span className="sv-tag !font-normal text-accent shrink-0">Dossier existant</span>}
                    </span>
                    <span className="flex items-center gap-1.5 text-2xs text-ink-3 min-w-0">
                      <span className="truncate">{p.Team}</span>
                      <span aria-hidden>·</span>
                      <CompetitionBadge competition={p.Competition} className="min-w-0" />
                    </span>
                  </span>
                  <span className="flex items-center gap-1 shrink-0 text-2xs text-ink-3 num">
                    {cup && <span className="sv-tag !font-normal">Coupe</span>}
                    <span className="sv-tag">{getPlayerSeasonTag(p)}</span>
                    <span className="hidden sm:inline">{INT.format(Number(p['Minutes played']) || 0)} min</span>
                  </span>
                </li>
              );
            })}
            {results.length === 0 && <li role="presentation" className="px-3 py-2 text-xs text-ink-3">Aucun joueur trouvé dans la saison chargée</li>}
          </ul>
        )}
      </div>
    </div>
  );
};

export default PlayerPicker;
