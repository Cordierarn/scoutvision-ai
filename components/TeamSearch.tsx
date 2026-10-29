/**
 * ScoutVision - recherche d'une équipe (combobox / listbox accessible, sur le modèle de PlayerSearch)
 * Une option = une équipe dans une compétition et une saison : club, compétition, saison, coupe.
 * Clavier : flèches, Entrée, Échap, Tab.
 */

import React, { useId, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { getPlayerSeasonTag } from '../types';
import { queryService } from '../services/queryService';
import { isLeagueCompetition } from '../utils/teamContext';
import { CompetitionBadge, TeamLogo } from './Media';

const LIMIT = 20;

export const TeamSearch: React.FC<{
  label?: string;
  selected?: string;
  onPick: (teamKey: string) => void;
  className?: string;
}> = ({ label = 'Équipe', selected, onPick, className = '' }) => {
  const uid = useId();
  const listId = `${uid}-list`;
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  // Championnats d'abord, coupes ensuite (ordre d'affichage seulement)
  const results = useMemo(() => {
    const q = query.trim();
    if (!q) return [];
    const isCup = (key: string) => !isLeagueCompetition(queryService.getTeamInfo(key).competition ?? '');
    return [...queryService.searchTeams(q, LIMIT)].sort((a, b) => Number(isCup(a)) - Number(isCup(b)));
  }, [query]);
  const showList = open && query.trim().length > 0;

  const choose = (i: number) => {
    const key = results[i];
    if (!key) return;
    setQuery(''); setOpen(false); setActive(-1);
    onPick(key);
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
        <input id={`${uid}-input`} type="text" autoComplete="off"
          placeholder={selected ? 'Changer d\'équipe' : 'Rechercher une équipe'}
          className="sv-input pl-8" role="combobox" aria-autocomplete="list" aria-expanded={showList} aria-controls={listId}
          aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
          value={query} onKeyDown={onKeyDown} onFocus={() => setOpen(true)}
          onChange={e => { setQuery(e.target.value); setOpen(true); setActive(-1); }} />
        {showList && (
          <ul id={listId} role="listbox" aria-label="Équipes trouvées" className="sv-menu absolute left-0 right-0 top-full mt-1 z-30 max-h-80 overflow-y-auto py-1">
            {results.map((key, i) => {
              const info = queryService.getTeamInfo(key);
              const first = queryService.getTeamPlayers(key)[0];
              const cup = !isLeagueCompetition(info.competition ?? '');
              return (
                <li key={key} id={`${listId}-${i}`} role="option" aria-selected={i === active}
                  onMouseDown={e => e.preventDefault()} onMouseEnter={() => setActive(i)} onClick={() => choose(i)}
                  className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer ${i === active ? 'bg-line-strong/50' : ''} ${key === selected ? 'text-accent' : 'text-ink'}`}>
                  <TeamLogo src={info.logo} name={info.name} size="xs" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs truncate">{info.name}</span>
                    <CompetitionBadge competition={info.competition} className="text-2xs text-ink-3" />
                  </span>
                  <span className="flex items-center gap-1 shrink-0">
                    {cup && <span className="sv-tag !font-normal">Coupe</span>}
                    {first && <span className="sv-tag">{getPlayerSeasonTag(first)}</span>}
                  </span>
                </li>
              );
            })}
            {results.length === 0 && <li role="presentation" className="px-3 py-2 text-xs text-ink-3">Aucune équipe trouvée dans les saisons chargées</li>}
          </ul>
        )}
      </div>
    </div>
  );
};

export default TeamSearch;
