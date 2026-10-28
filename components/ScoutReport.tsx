
import React, { useState } from 'react';
import { PlayerData, extractSeason, getSeasonColor, getPlayerSeasonId, getSeasonShortLabel } from '../types';
import PlayerCard from './PlayerCard';
import { Search, FileText, ArrowRight, TrendingUp } from 'lucide-react';
import { positionLabel } from '../utils/labels';
import { PhotoOverlay, TeamLine, TeamLogo, CompetitionBadge, CountryFlag } from './Media';

interface ScoutReportProps {
  data: PlayerData[];
}

const ScoutReport: React.FC<ScoutReportProps> = ({ data }) => {
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
      />
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[80%] max-w-4xl mx-auto animate-fade-in">
      <div className="text-center mb-10 space-y-4">
        <div className="w-20 h-20 bg-accent/10 rounded-lg flex items-center justify-center mx-auto mb-6 shadow-[0_0_50px_-10px_rgba(16,185,129,0.3)] border border-accent/20">
            <FileText className="w-10 h-10 text-accent" />
        </div>
        <h1 className="text-4xl md:text-5xl font-bold text-ink tracking-tight">Rapports de scouting</h1>
        <p className="text-ink-3 text-lg max-w-xl mx-auto">
          Ouvrez la fiche détaillée d'un joueur, visualisez ses performances et générez un rapport de scouting par IA.
        </p>
      </div>

      <div className="w-full max-w-2xl relative z-50">
        <div className="relative group">
            <div className="absolute -inset-1    rounded-lg opacity-20 group-hover:opacity-40 blur transition duration-500"></div>
            <div className="relative">
                <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-ink-3 w-6 h-6 group-focus-within:text-accent transition-colors" />
                <input 
                type="text" 
                placeholder="Rechercher un joueur ou un club..."
                className="w-full bg-raised border border-line-strong text-ink pl-14 pr-6 py-5 rounded-md focus:ring-0 focus:border-accent focus:outline-none  text-lg placeholder-ink-4 transition-all"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                autoFocus
                />
            </div>
        </div>

        {/* Search Dropdown */}
        {searchTerm && (
          <div className="absolute top-full left-0 right-0 mt-3 bg-raised/95  border border-line-strong rounded-md  overflow-hidden animate-fade-in-up">
            <div className="max-h-[400px] overflow-y-auto custom-scrollbar">
                {filteredPlayers.length > 0 ? (
                    filteredPlayers.map((player) => {
                        const pSeason = extractSeason(player.League);
                        const pSeasonColors = getSeasonColor(pSeason);
                        return (
                    <button 
                        key={getPlayerSeasonId(player)}
                        onClick={() => setSelectedPlayer(player)}
                        className="w-full text-left px-5 py-4 hover:bg-overlay/80 flex items-center justify-between group transition-colors border-b border-line/50 last:border-0"
                    >
                        <div className="flex items-center gap-4">
                            <div className="relative">
                              <div className="relative overflow-hidden w-10 h-10 rounded-full bg-overlay flex items-center justify-center text-sm font-bold text-ink-3 group-hover:text-accent group-hover:bg-accent/10 border border-line-strong transition-colors">
                                  {(player.Player || '??').substring(0, 2).toUpperCase()}
                                  <PhotoOverlay src={player.Image} alt={player.Player} />
                              </div>
                              <div className={`absolute -bottom-1 -right-1 px-1.5 py-0 rounded text-[8px] font-bold ${pSeasonColors.bg} ${pSeasonColors.text} border ${pSeasonColors.border}`}>
                                {getSeasonShortLabel(pSeason)}
                              </div>
                            </div>
                            <div>
                                <div className="font-bold text-ink text-lg">{player.Player || 'Inconnu'}</div>
                                <div className="text-sm text-ink-3 flex items-center gap-2">
                                    <span className="text-ink-3"><TeamLine player={player} /></span>
                                    <span className="w-1 h-1 rounded-full bg-ink-4"></span>
                                    <span className="text-accent font-mono">{positionLabel(player.Position)}</span>
                                </div>
                            </div>
                        </div>
                        <div className="flex items-center gap-4">
                             <div className="hidden sm:block text-right">
                                <div className="text-xs text-ink-3 uppercase font-bold tracking-wider">Valeur marchande</div>
                                <div className="text-ink-2 font-mono">
                                    €{typeof player["Market value"] === 'number' ? (player["Market value"]/1000000).toFixed(1) + 'M' : '-'}
                                </div>
                             </div>
                             <ArrowRight className="w-5 h-5 text-ink-4 group-hover:text-accent opacity-0 group-hover:opacity-100 transition-all transform -translate-x-2 group-hover:translate-x-0" />
                        </div>
                    </button>
                        );
                    })
                ) : (
                    <div className="p-8 text-center text-ink-3">
                        Aucun joueur ne correspond à « {searchTerm} »
                    </div>
                )}
            </div>
            {filteredPlayers.length > 0 && (
                <div className="bg-surface p-2 text-center text-xs text-ink-4 border-t border-line">
                    Affichage des {filteredPlayers.length} premiers résultats
                </div>
            )}
          </div>
        )}
      </div>

      <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-6 w-full max-w-4xl opacity-50 hover:opacity-100 transition-opacity duration-500">
         <div className="bg-raised/50 border border-line p-6 rounded-lg flex flex-col items-center text-center">
            <div className="w-12 h-12 bg-purple-500/10 rounded-md flex items-center justify-center mb-4 text-purple-400">
                <FileText className="w-6 h-6" />
            </div>
            <h3 className="text-ink font-semibold mb-2">Analyse IA</h3>
            <p className="text-sm text-ink-3">Rapports de scouting générés automatiquement par Gemini.</p>
         </div>
         <div className="bg-raised/50 border border-line p-6 rounded-lg flex flex-col items-center text-center">
            <div className="w-12 h-12 bg-accent/10 rounded-md flex items-center justify-center mb-4 text-accent">
                <TrendingUp className="w-6 h-6" />
            </div>
            <h3 className="text-ink font-semibold mb-2">Percentiles</h3>
            <p className="text-sm text-ink-3">Situez chaque joueur parmi ceux du même poste et du même niveau.</p>
         </div>
         <div className="bg-raised/50 border border-line p-6 rounded-lg flex flex-col items-center text-center">
             <div className="w-12 h-12 bg-blue-500/10 rounded-md flex items-center justify-center mb-4 text-blue-400">
                <Search className="w-6 h-6" />
            </div>
            <h3 className="text-ink font-semibold mb-2">Recherche complète</h3>
            <p className="text-sm text-ink-3">Accédez à n'importe quel joueur des 35 compétitions.</p>
         </div>
      </div>
    </div>
  );
};

export default ScoutReport;
