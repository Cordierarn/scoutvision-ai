import React, { useState, useMemo } from 'react';
import { PlayerData, extractSeason, getSeasonColor, getPlayerSeasonId, getSeasonShortLabel } from '../types';
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
import { PhotoOverlay, TeamLine, TeamLogo, CompetitionBadge, CountryFlag } from './Media';

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
      {/* Header */}
      <div className="p-6 border-b border-line bg-surface/50">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-warn/10 rounded-md flex items-center justify-center">
              <Star className="w-6 h-6 text-warn" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-ink">Ma liste de suivi</h1>
              <p className="text-sm text-ink-3">{watchlist.length} joueurs suivis</p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <button
              onClick={handleExport}
              disabled={watchlist.length === 0}
              className="flex items-center gap-2 px-4 py-2 bg-accent/10 hover:bg-accent/20 text-accent rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Download className="w-4 h-4" />
              <span className="hidden sm:inline">Exporter</span>
            </button>
            <button
              onClick={handleClearAll}
              disabled={watchlist.length === 0}
              className="flex items-center gap-2 px-4 py-2 bg-neg/10 hover:bg-neg/20 text-neg rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Trash2 className="w-4 h-4" />
              <span className="hidden sm:inline">Tout vider</span>
            </button>
          </div>
        </div>

        {/* Search & Filters */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-3" />
            <input
              type="text"
              placeholder="Rechercher dans la liste..."
              className="w-full bg-raised border border-line-strong rounded-md pl-10 pr-4 py-2 text-sm text-ink placeholder-ink-4 focus:outline-none focus:border-accent"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          
          {allTags.length > 0 && (
            <select
              className="bg-raised border border-line-strong rounded-md px-3 py-2 text-sm text-ink focus:outline-none focus:border-accent"
              value={filterTag}
              onChange={(e) => setFilterTag(e.target.value)}
            >
              <option value="">Tous les tags</option>
              {allTags.map(tag => (
                <option key={tag} value={tag}>{tag}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {watchlist.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="w-20 h-20 bg-overlay/50 rounded-full flex items-center justify-center mb-4">
              <Star className="w-10 h-10 text-ink-4" />
            </div>
            <h3 className="text-xl font-bold text-ink mb-2">Aucun joueur suivi</h3>
            <p className="text-ink-3 max-w-md">
              Cliquez sur l'étoile d'un joueur pour l'ajouter à votre liste de suivi.
            </p>
          </div>
        ) : filteredWatchlist.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <Filter className="w-10 h-10 text-ink-4 mb-4" />
            <h3 className="text-lg font-bold text-ink mb-2">Aucun résultat</h3>
            <p className="text-ink-3">Modifiez la recherche ou les filtres.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filteredWatchlist.map((item) => {
              const player = item.player;
              const pSeason = extractSeason(player.League);
              const pSeasonColors = getSeasonColor(pSeason);
              const isEditing = editingNotes === getPlayerSeasonId(player);

              return (
                <div 
                  key={getPlayerSeasonId(player)} 
                  className="bg-surface border border-line rounded-lg overflow-hidden hover:border-line-strong transition-all group"
                >
                  {/* Card Header */}
                  <div className="p-4 border-b border-line/50 bg-raised/30">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className="relative">
                          <div className="relative overflow-hidden w-12 h-12 rounded-full bg-overlay flex items-center justify-center text-sm font-bold text-ink-2 border border-line-strong">
                            {(player.Player || '??').substring(0, 2).toUpperCase()}
                            <PhotoOverlay src={player.Image} alt={player.Player} />
                          </div>
                          <div className={`absolute -bottom-1 -right-1 px-1.5 py-0 rounded text-[8px] font-bold ${pSeasonColors.bg} ${pSeasonColors.text} border ${pSeasonColors.border}`}>
                            {getSeasonShortLabel(pSeason)}
                          </div>
                        </div>
                        <div>
                          <h3 className="font-bold text-ink">{player.Player}</h3>
                          <p className="text-xs text-ink-3"><TeamLine player={player} /></p>
                        </div>
                      </div>
                      <button
                        onClick={() => handleRemove(player)}
                        className="p-1.5 text-ink-3 hover:text-neg hover:bg-neg/10 rounded-md transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Card Body */}
                  <div className="p-4 space-y-3">
                    {/* Stats Row */}
                    <div className="flex items-center gap-2 text-xs">
                      <span className="px-2 py-1 bg-overlay rounded text-ink-2">{positionLabel(player.Position)}</span>
                      <span className="px-2 py-1 bg-overlay rounded text-ink-2">{player.Age ?? '–'} ans</span>
                      <span className="px-2 py-1 bg-accent/10 rounded text-accent font-mono">
                        €{typeof player["Market value"] === 'number' ? (player["Market value"]/1000000).toFixed(1) + 'M' : '-'}
                      </span>
                    </div>

                    {/* Notes */}
                    <div className="bg-raised/50 rounded-md p-3">
                      <div className="flex items-center gap-2 text-xs text-ink-3 mb-2">
                        <MessageSquare className="w-3 h-3" />
                        Notes
                      </div>
                      {isEditing ? (
                        <div className="space-y-2">
                          <textarea
                            className="w-full bg-overlay border border-line-strong rounded p-2 text-sm text-ink resize-none focus:outline-none focus:border-accent"
                            rows={3}
                            value={tempNotes}
                            onChange={(e) => setTempNotes(e.target.value)}
                            placeholder="Ajoutez vos notes..."
                            autoFocus
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleSaveNotes(player)}
                              className="flex-1 py-1.5 bg-accent hover:bg-accent text-accent-ink text-xs font-bold rounded transition-colors"
                            >
                              Enregistrer
                            </button>
                            <button
                              onClick={() => setEditingNotes(null)}
                              className="flex-1 py-1.5 bg-line-strong hover:bg-ink-4 text-ink text-xs rounded transition-colors"
                            >
                              Annuler
                            </button>
                          </div>
                        </div>
                      ) : (
                        <p 
                          className="text-sm text-ink-2 cursor-pointer hover:text-ink transition-colors min-h-[40px]"
                          onClick={() => {
                            setEditingNotes(getPlayerSeasonId(player));
                            setTempNotes(item.notes || '');
                          }}
                        >
                          {item.notes || <span className="text-ink-4 italic">Cliquez pour ajouter des notes...</span>}
                        </p>
                      )}
                    </div>

                    {/* Added Date */}
                    <div className="flex items-center gap-2 text-xs text-ink-3">
                      <Clock className="w-3 h-3" />
                      Ajouté le {formatDate(item.addedAt)}
                    </div>
                  </div>

                  {/* Card Footer */}
                  <div className="p-3 border-t border-line bg-raised/30">
                    <button
                      onClick={() => onSelectPlayer(player)}
                      className="w-full flex items-center justify-center gap-2 py-2 bg-overlay hover:bg-line-strong text-ink text-sm rounded-md transition-colors"
                    >
                      <Eye className="w-4 h-4" />
                      Voir la fiche
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default Watchlist;
