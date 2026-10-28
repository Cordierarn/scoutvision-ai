import React, { useState, useMemo } from 'react';
import { PlayerData, extractSeason, getPlayerSeasonId, getSeasonShortLabel, getPlayerSeasonTag } from '../types';
import { Star, Trash2, Eye, Download, Search, X, MessageSquare, Tag, Clock, Filter } from 'lucide-react';
import { 
  getWatchlist, 
  removeFromWatchlist, 
  updateWatchlistNotes, 
  clearWatchlist,
  WatchlistPlayer 
} from '../services/storageService';
import { exportToCSV } from '../utils/exportUtils';
import { positionLabel } from '../utils/labels';
import { PlayerAvatar, TeamLine } from './Media';
import { EmptyState, PageHeader, PercentileValue } from './ui';

interface WatchlistProps {
  onSelectPlayer: (player: PlayerData) => void;
}

const Watchlist: React.FC<WatchlistProps> = ({ onSelectPlayer }) => {
  const [watchlist, setWatchlist] = useState<WatchlistPlayer[]>(getWatchlist());
  const [searchTerm, setSearchTerm] = useState('');
  const [editingNotes, setEditingNotes] = useState<string | null>(null);
  const [tempNotes, setTempNotes] = useState('');
  const [filterTag, setFilterTag] = useState<string>('');

  // Refresh watchlist from storage
  const refreshWatchlist = () => {
    setWatchlist(getWatchlist());
  };

  // Get all unique tags
  const allTags = useMemo(() => {
    const tags = new Set<string>();
    watchlist.forEach(w => w.tags?.forEach(t => tags.add(t)));
    return Array.from(tags);
  }, [watchlist]);

  // Filter watchlist
  const filteredWatchlist = useMemo(() => {
    return watchlist.filter(w => {
      const matchesSearch = !searchTerm || 
        (w.player.Player?.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (w.player.Team?.toLowerCase().includes(searchTerm.toLowerCase()));
      
      const matchesTag = !filterTag || w.tags?.includes(filterTag);
      
      return matchesSearch && matchesTag;
    });
  }, [watchlist, searchTerm, filterTag]);

  const handleRemove = (player: PlayerData) => {
    if (window.confirm(`Retirer ${player.Player} de la liste de suivi ?`)) {
      removeFromWatchlist(player);
      refreshWatchlist();
    }
  };

  const handleClearAll = () => {
    if (window.confirm('Vider toute la liste de suivi ?')) {
      clearWatchlist();
      refreshWatchlist();
    }
  };

  const handleSaveNotes = (player: PlayerData) => {
    updateWatchlistNotes(player, tempNotes);
    setEditingNotes(null);
    refreshWatchlist();
  };

  const handleExport = () => {
    const players = filteredWatchlist.map(w => w.player);
    exportToCSV(players, 'watchlist');
  };

  const formatDate = (isoString: string) => {
    return new Date(isoString).toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    });
  };

  return (
    <div className="flex flex-col h-full animate-fade-in">
      <div className="px-5 pt-4 pb-3 border-b border-line space-y-3">
        <PageHeader
          title="Liste de suivi"
          icon={Star}
          description={`${watchlist.length} joueur${watchlist.length > 1 ? 's' : ''} suivi${watchlist.length > 1 ? 's' : ''}, enregistrés dans ce navigateur. Cliquez sur une note pour la modifier.`}
          actions={
            <>
              <button onClick={handleExport} disabled={watchlist.length === 0} className="sv-btn sv-btn-secondary">
                <Download className="w-3.5 h-3.5" /> Exporter
              </button>
              <button onClick={handleClearAll} disabled={watchlist.length === 0} className="sv-btn sv-btn-ghost hover:!text-neg">
                <Trash2 className="w-3.5 h-3.5" /> Tout vider
              </button>
            </>
          }
        />
        {watchlist.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <div className="relative w-full sm:w-80">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-4" />
              <input type="text" placeholder="Rechercher dans la liste" className="sv-input pl-8"
                value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} aria-label="Rechercher dans la liste" />
            </div>
            {allTags.length > 0 && (
              <select className="sv-select" value={filterTag} onChange={(e) => setFilterTag(e.target.value)} aria-label="Tag">
                <option value="">Tous les tags</option>
                {allTags.map(tag => <option key={tag} value={tag}>{tag}</option>)}
              </select>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-auto">
        {watchlist.length === 0 ? (
          <EmptyState icon={Star} className="h-full" title="Aucun joueur suivi">
            Cliquez sur l'étoile d'un joueur (base joueurs, chasseur de pépites) pour l'ajouter à la liste.
          </EmptyState>
        ) : filteredWatchlist.length === 0 ? (
          <EmptyState icon={Filter} title="Aucun résultat">Modifiez la recherche ou les filtres.</EmptyState>
        ) : (
          <table className="sv-table">
            <thead>
              <tr>
                <th className="pl-5">Joueur</th>
                <th>Poste</th>
                <th className="text-right">Âge</th>
                <th className="text-right">Min</th>
                <th className="text-right">Note</th>
                <th className="text-right">Valeur</th>
                <th className="text-right">Contrat</th>
                <th className="w-[32%]">Notes de scouting</th>
                <th className="text-right">Ajouté le</th>
                <th className="pr-5"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {filteredWatchlist.map((item) => {
                const player = item.player;
                const id = getPlayerSeasonId(player);
                const isEditing = editingNotes === id;
                return (
                  <tr key={id} className="group align-top">
                    <td className="pl-5">
                      <button onClick={() => onSelectPlayer(player)} className="flex items-center gap-2.5 text-left">
                        <PlayerAvatar player={player} size="sm" />
                        <span className="min-w-0">
                          <span className="block text-[13px] font-medium text-ink hover:text-accent transition-colors">{player.Player}<span className="sv-tag !h-4 !px-1 !text-[9px] ml-1.5 align-middle !font-medium">{getPlayerSeasonTag(player)}</span></span>
                          <span className="block text-2xs text-ink-3 max-w-[14rem]"><TeamLine player={player} /></span>
                        </span>
                      </button>
                    </td>
                    <td><span className="sv-tag">{positionLabel(player.Position)}</span></td>
                    <td className="text-right text-ink-2">{player.Age ?? '–'}</td>
                    <td className="text-right text-ink-3">{Number(player['Minutes played'] || 0).toLocaleString('fr-FR')}</td>
                    <td className="text-right">{typeof player['Rating pct'] === 'number' ? <PercentileValue value={player['Rating pct'] as number} className="text-xs" /> : <span className="text-ink-4">–</span>}</td>
                    <td className="text-right text-ink font-medium">
                      {typeof player['Market value'] === 'number' ? `€${(player['Market value'] / 1000000).toFixed(1)}M` : '–'}
                    </td>
                    <td className="text-right text-xs text-ink-3">{player['Contract expires'] ? String(player['Contract expires']).slice(0, 7).split('-').reverse().join('/') : '–'}</td>
                    <td>
                      {isEditing ? (
                        <div className="space-y-1.5">
                          <textarea className="sv-input !h-auto py-1.5 resize-none" rows={3} value={tempNotes}
                            onChange={(e) => setTempNotes(e.target.value)} placeholder="Points forts, réserves, matchs à revoir…" autoFocus />
                          <div className="flex gap-1.5">
                            <button onClick={() => handleSaveNotes(player)} className="sv-btn sv-btn-primary sv-btn-sm">Enregistrer</button>
                            <button onClick={() => setEditingNotes(null)} className="sv-btn sv-btn-ghost sv-btn-sm">Annuler</button>
                          </div>
                        </div>
                      ) : (
                        <button className="w-full text-left text-xs text-ink-2 hover:text-ink flex items-start gap-1.5 min-h-[1.5rem]"
                          onClick={() => { setEditingNotes(id); setTempNotes(item.notes || ''); }}>
                          <MessageSquare className="w-3 h-3 mt-0.5 shrink-0 text-ink-4" />
                          {item.notes || <span className="text-ink-4">Ajouter une note</span>}
                        </button>
                      )}
                    </td>
                    <td className="text-right text-2xs text-ink-3 whitespace-nowrap"><Clock className="w-3 h-3 inline mr-1 -mt-px" />{formatDate(item.addedAt)}</td>
                    <td className="pr-5">
                      <div className="flex justify-end gap-0.5">
                        <button onClick={() => onSelectPlayer(player)} className="sv-icon-btn" title="Voir la fiche"><Eye className="w-3.5 h-3.5" /></button>
                        <button onClick={() => handleRemove(player)} className="sv-icon-btn hover:!text-neg" title="Retirer de la liste"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default Watchlist;
