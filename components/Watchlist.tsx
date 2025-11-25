import React, { useState, useMemo } from 'react';
import { PlayerData, extractSeason, getSeasonColor, getPlayerSeasonId } from '../types';
import { Star, Trash2, Eye, Download, Search, X, MessageSquare, Tag, Clock, Filter } from 'lucide-react';
import { 
  getWatchlist, 
  removeFromWatchlist, 
  updateWatchlistNotes, 
  clearWatchlist,
  WatchlistPlayer 
} from '../services/storageService';
import { exportToCSV } from '../utils/exportUtils';

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
    if (window.confirm(`Remove ${player.Player} from watchlist?`)) {
      removeFromWatchlist(player);
      refreshWatchlist();
    }
  };

  const handleClearAll = () => {
    if (window.confirm('Are you sure you want to clear the entire watchlist?')) {
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
      <div className="p-6 border-b border-slate-800 bg-slate-950/50">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-yellow-500/10 rounded-xl flex items-center justify-center">
              <Star className="w-6 h-6 text-yellow-400" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">My Watchlist</h1>
              <p className="text-sm text-slate-400">{watchlist.length} players saved</p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <button
              onClick={handleExport}
              disabled={watchlist.length === 0}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Download className="w-4 h-4" />
              <span className="hidden sm:inline">Export</span>
            </button>
            <button
              onClick={handleClearAll}
              disabled={watchlist.length === 0}
              className="flex items-center gap-2 px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Trash2 className="w-4 h-4" />
              <span className="hidden sm:inline">Clear All</span>
            </button>
          </div>
        </div>

        {/* Search & Filters */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              type="text"
              placeholder="Search watchlist..."
              className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-10 pr-4 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          
          {allTags.length > 0 && (
            <select
              className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500"
              value={filterTag}
              onChange={(e) => setFilterTag(e.target.value)}
            >
              <option value="">All Tags</option>
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
            <div className="w-20 h-20 bg-slate-800/50 rounded-full flex items-center justify-center mb-4">
              <Star className="w-10 h-10 text-slate-600" />
            </div>
            <h3 className="text-xl font-bold text-white mb-2">No players in watchlist</h3>
            <p className="text-slate-400 max-w-md">
              Click the star icon on any player card to add them to your watchlist for easy tracking.
            </p>
          </div>
        ) : filteredWatchlist.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <Filter className="w-10 h-10 text-slate-600 mb-4" />
            <h3 className="text-lg font-bold text-white mb-2">No matches found</h3>
            <p className="text-slate-400">Try adjusting your search or filters.</p>
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
                  className="bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden hover:border-slate-700 transition-all group"
                >
                  {/* Card Header */}
                  <div className="p-4 border-b border-slate-800/50 bg-slate-900/30">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className="relative">
                          <div className="w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center text-sm font-bold text-slate-300 border border-slate-700">
                            {(player.Player || '??').substring(0, 2).toUpperCase()}
                          </div>
                          <div className={`absolute -bottom-1 -right-1 px-1.5 py-0 rounded text-[8px] font-bold ${pSeasonColors.bg} ${pSeasonColors.text} border ${pSeasonColors.border}`}>
                            {pSeason}
                          </div>
                        </div>
                        <div>
                          <h3 className="font-bold text-white">{player.Player}</h3>
                          <p className="text-xs text-slate-400">{player.Team}</p>
                        </div>
                      </div>
                      <button
                        onClick={() => handleRemove(player)}
                        className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Card Body */}
                  <div className="p-4 space-y-3">
                    {/* Stats Row */}
                    <div className="flex items-center gap-2 text-xs">
                      <span className="px-2 py-1 bg-slate-800 rounded text-slate-300">{player.Position}</span>
                      <span className="px-2 py-1 bg-slate-800 rounded text-slate-300">{player.Age} yo</span>
                      <span className="px-2 py-1 bg-emerald-500/10 rounded text-emerald-400 font-mono">
                        €{typeof player["Market value"] === 'number' ? (player["Market value"]/1000000).toFixed(1) + 'M' : '-'}
                      </span>
                    </div>

                    {/* Notes */}
                    <div className="bg-slate-900/50 rounded-lg p-3">
                      <div className="flex items-center gap-2 text-xs text-slate-500 mb-2">
                        <MessageSquare className="w-3 h-3" />
                        Notes
                      </div>
                      {isEditing ? (
                        <div className="space-y-2">
                          <textarea
                            className="w-full bg-slate-800 border border-slate-700 rounded p-2 text-sm text-white resize-none focus:outline-none focus:border-emerald-500"
                            rows={3}
                            value={tempNotes}
                            onChange={(e) => setTempNotes(e.target.value)}
                            placeholder="Add your notes..."
                            autoFocus
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleSaveNotes(player)}
                              className="flex-1 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-slate-950 text-xs font-bold rounded transition-colors"
                            >
                              Save
                            </button>
                            <button
                              onClick={() => setEditingNotes(null)}
                              className="flex-1 py-1.5 bg-slate-700 hover:bg-slate-600 text-white text-xs rounded transition-colors"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <p 
                          className="text-sm text-slate-300 cursor-pointer hover:text-white transition-colors min-h-[40px]"
                          onClick={() => {
                            setEditingNotes(getPlayerSeasonId(player));
                            setTempNotes(item.notes || '');
                          }}
                        >
                          {item.notes || <span className="text-slate-600 italic">Click to add notes...</span>}
                        </p>
                      )}
                    </div>

                    {/* Added Date */}
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      <Clock className="w-3 h-3" />
                      Added {formatDate(item.addedAt)}
                    </div>
                  </div>

                  {/* Card Footer */}
                  <div className="p-3 border-t border-slate-800 bg-slate-900/30">
                    <button
                      onClick={() => onSelectPlayer(player)}
                      className="w-full flex items-center justify-center gap-2 py-2 bg-slate-800 hover:bg-slate-700 text-white text-sm rounded-lg transition-colors"
                    >
                      <Eye className="w-4 h-4" />
                      View Profile
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
