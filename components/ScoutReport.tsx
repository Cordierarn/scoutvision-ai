
import React, { useState } from 'react';
import { PlayerData, ShotEvent, extractSeason, getSeasonColor, getPlayerSeasonId } from '../types';
import PlayerCard from './PlayerCard';
import { Search, FileText, ArrowRight, TrendingUp } from 'lucide-react';

interface ScoutReportProps {
  data: PlayerData[];
  shotEvents: ShotEvent[];
}

const ScoutReport: React.FC<ScoutReportProps> = ({ data, shotEvents }) => {
  const [selectedPlayer, setSelectedPlayer] = useState<PlayerData | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  const filteredPlayers = searchTerm 
    ? data.filter(p => {
        const playerName = typeof p.Player === 'string' ? p.Player.toLowerCase() : '';
        const teamName = typeof p.Team === 'string' ? p.Team.toLowerCase() : '';
        const searchLower = searchTerm.toLowerCase();
        return playerName.includes(searchLower) || teamName.includes(searchLower);
      }).slice(0, 10)
    : [];

  if (selectedPlayer) {
    return (
      <PlayerCard 
        player={selectedPlayer} 
        onBack={() => {
            setSelectedPlayer(null);
            setSearchTerm('');
        }} 
        allPlayers={data}
        shotEvents={shotEvents}
      />
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[80%] max-w-4xl mx-auto animate-fade-in">
      <div className="text-center mb-10 space-y-4">
        <div className="w-20 h-20 bg-emerald-500/10 rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-[0_0_50px_-10px_rgba(16,185,129,0.3)] border border-emerald-500/20">
            <FileText className="w-10 h-10 text-emerald-400" />
        </div>
        <h1 className="text-4xl md:text-5xl font-bold text-white tracking-tight">Player Scout Reports</h1>
        <p className="text-slate-400 text-lg max-w-xl mx-auto">
          Access detailed player profiles, visualize performance data with pizza charts, and generate AI-powered scouting analysis.
        </p>
      </div>

      <div className="w-full max-w-2xl relative z-50">
        <div className="relative group">
            <div className="absolute -inset-1 bg-gradient-to-r from-emerald-500 to-teal-500 rounded-2xl opacity-20 group-hover:opacity-40 blur transition duration-500"></div>
            <div className="relative">
                <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-400 w-6 h-6 group-focus-within:text-emerald-400 transition-colors" />
                <input 
                type="text" 
                placeholder="Search by player name or team..."
                className="w-full bg-slate-900 border border-slate-700 text-white pl-14 pr-6 py-5 rounded-xl focus:ring-0 focus:border-emerald-500 focus:outline-none shadow-2xl text-lg placeholder-slate-500 transition-all"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                autoFocus
                />
            </div>
        </div>

        {/* Search Dropdown */}
        {searchTerm && (
          <div className="absolute top-full left-0 right-0 mt-3 bg-slate-900/95 backdrop-blur-xl border border-slate-700 rounded-xl shadow-2xl overflow-hidden animate-fade-in-up">
            <div className="max-h-[400px] overflow-y-auto custom-scrollbar">
                {filteredPlayers.length > 0 ? (
                    filteredPlayers.map((player) => {
                        const pSeason = extractSeason(player.League);
                        const pSeasonColors = getSeasonColor(pSeason);
                        return (
                    <button 
                        key={getPlayerSeasonId(player)}
                        onClick={() => setSelectedPlayer(player)}
                        className="w-full text-left px-5 py-4 hover:bg-slate-800/80 flex items-center justify-between group transition-colors border-b border-slate-800/50 last:border-0"
                    >
                        <div className="flex items-center gap-4">
                            <div className="relative">
                              <div className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center text-sm font-bold text-slate-400 group-hover:text-emerald-400 group-hover:bg-emerald-500/10 border border-slate-700 transition-colors">
                                  {(player.Player || '??').substring(0, 2).toUpperCase()}
                              </div>
                              <div className={`absolute -bottom-1 -right-1 px-1.5 py-0 rounded text-[8px] font-bold ${pSeasonColors.bg} ${pSeasonColors.text} border ${pSeasonColors.border}`}>
                                {pSeason}
                              </div>
                            </div>
                            <div>
                                <div className="font-bold text-slate-200 text-lg">{player.Player || 'Unknown'}</div>
                                <div className="text-sm text-slate-500 flex items-center gap-2">
                                    <span className="text-slate-400">{player.Team || 'Unknown'}</span>
                                    <span className="w-1 h-1 rounded-full bg-slate-600"></span>
                                    <span className="text-emerald-500/80 font-mono">{player.Position}</span>
                                </div>
                            </div>
                        </div>
                        <div className="flex items-center gap-4">
                             <div className="hidden sm:block text-right">
                                <div className="text-xs text-slate-500 uppercase font-bold tracking-wider">Market Value</div>
                                <div className="text-slate-300 font-mono">
                                    €{typeof player["Market value"] === 'number' ? (player["Market value"]/1000000).toFixed(1) + 'M' : '-'}
                                </div>
                             </div>
                             <ArrowRight className="w-5 h-5 text-slate-600 group-hover:text-emerald-400 opacity-0 group-hover:opacity-100 transition-all transform -translate-x-2 group-hover:translate-x-0" />
                        </div>
                    </button>
                        );
                    })
                ) : (
                    <div className="p-8 text-center text-slate-500">
                        No players found matching "{searchTerm}"
                    </div>
                )}
            </div>
            {filteredPlayers.length > 0 && (
                <div className="bg-slate-950 p-2 text-center text-xs text-slate-600 border-t border-slate-800">
                    Showing top {filteredPlayers.length} results
                </div>
            )}
          </div>
        )}
      </div>

      <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-6 w-full max-w-4xl opacity-50 hover:opacity-100 transition-opacity duration-500">
         <div className="bg-slate-900/50 border border-slate-800 p-6 rounded-2xl flex flex-col items-center text-center">
            <div className="w-12 h-12 bg-purple-500/10 rounded-xl flex items-center justify-center mb-4 text-purple-400">
                <FileText className="w-6 h-6" />
            </div>
            <h3 className="text-slate-200 font-semibold mb-2">AI Analysis</h3>
            <p className="text-sm text-slate-500">Get instant automated scouting reports generated by Gemini.</p>
         </div>
         <div className="bg-slate-900/50 border border-slate-800 p-6 rounded-2xl flex flex-col items-center text-center">
            <div className="w-12 h-12 bg-emerald-500/10 rounded-xl flex items-center justify-center mb-4 text-emerald-400">
                <TrendingUp className="w-6 h-6" />
            </div>
            <h3 className="text-slate-200 font-semibold mb-2">Percentile Ranks</h3>
            <p className="text-sm text-slate-500">Compare players against league averages with dynamic pizza charts.</p>
         </div>
         <div className="bg-slate-900/50 border border-slate-800 p-6 rounded-2xl flex flex-col items-center text-center">
             <div className="w-12 h-12 bg-blue-500/10 rounded-xl flex items-center justify-center mb-4 text-blue-400">
                <Search className="w-6 h-6" />
            </div>
            <h3 className="text-slate-200 font-semibold mb-2">Deep Search</h3>
            <p className="text-sm text-slate-500">Instantly access any player from your uploaded dataset.</p>
         </div>
      </div>
    </div>
  );
};

export default ScoutReport;
