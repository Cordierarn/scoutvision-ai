
import React, { useState } from 'react';
import { PlayerData, extractSeason, getPlayerSeasonId, getSeasonShortLabel, getPlayerSeasonTag } from '../types';
import PlayerCard from './PlayerCard';
import { Search, FileText, ArrowRight, TrendingUp, ClipboardList } from 'lucide-react';
import { positionLabel } from '../utils/labels';
import { PlayerAvatar, TeamLine } from './Media';
import { EmptyState, PageHeader } from './ui';

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
    <div className="p-5 space-y-4 max-w-5xl animate-fade-in">
      <PageHeader
        title="Rapports de scouting"
        icon={ClipboardList}
        description="Choisissez un joueur : sa fiche complète s'ouvre (percentiles, radar, RAPM, projection, tirs). Le rapport rédigé par IA s'y génère en complément des données, et la fiche s'exporte en PDF."
      />

      <div className="relative w-full max-w-xl">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-4" />
        <input type="text" placeholder="Rechercher un joueur ou un club" className="sv-input pl-8" aria-label="Rechercher un joueur ou un club"
          value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} autoFocus />
      </div>

      {searchTerm ? (
        filteredPlayers.length > 0 ? (
          <div className="sv-panel overflow-hidden">
            <table className="sv-table">
              <thead>
                <tr>
                  <th className="pl-4">Joueur</th>
                  <th>Poste</th>
                  <th className="text-right">Âge</th>
                  <th className="text-right">Min</th>
                  <th className="text-right">Valeur</th>
                  <th className="pr-4"><span className="sr-only">Ouvrir</span></th>
                </tr>
              </thead>
              <tbody>
                {filteredPlayers.map(player => (
                  <tr key={getPlayerSeasonId(player)} className="group cursor-pointer" onClick={() => setSelectedPlayer(player)}>
                    <td className="pl-4">
                      <span className="flex items-center gap-2.5">
                        <PlayerAvatar player={player} size="sm" />
                        <span className="min-w-0">
                          <span className="block text-[13px] font-medium text-ink group-hover:text-accent transition-colors">{player.Player || 'Inconnu'}<span className="sv-tag !h-4 !px-1 !text-[9px] ml-1.5 align-middle !font-medium">{getPlayerSeasonTag(player)}</span></span>
                          <span className="block text-2xs text-ink-3"><TeamLine player={player} /></span>
                        </span>
                      </span>
                    </td>
                    <td><span className="sv-tag">{positionLabel(player.Position)}</span></td>
                    <td className="text-right text-ink-2">{player.Age ?? '–'}</td>
                    <td className="text-right text-ink-3">{Number(player['Minutes played'] || 0).toLocaleString('fr-FR')}</td>
                    <td className="text-right text-ink font-medium">{typeof player['Market value'] === 'number' ? `€${(player['Market value'] / 1000000).toFixed(1)}M` : '–'}</td>
                    <td className="pr-4 text-right"><ArrowRight className="w-3.5 h-3.5 inline text-ink-4 group-hover:text-accent" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-4 py-1.5 text-2xs text-ink-4 border-t border-line">Les {filteredPlayers.length} premiers résultats</div>
          </div>
        ) : (
          <div className="sv-panel"><EmptyState icon={Search} title={`Aucun joueur ne correspond à « ${searchTerm} »`} /></div>
        )
      ) : (
        <div className="sv-panel grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-line">
          {[
            { icon: TrendingUp, title: 'Données d\'abord', text: 'Percentiles par poste et par niveau, radar, forces et faiblesses, RAPM et finition.' },
            { icon: FileText, title: 'Rapport rédigé', text: 'Synthèse en langage football générée par Gemini à partir des chiffres de la fiche : à relire, pas à croire sur parole.' },
            { icon: Search, title: '35 compétitions', text: 'Tous les joueurs des saisons chargées, export PDF de la fiche.' },
          ].map(f => (
            <div key={f.title} className="px-4 py-3">
              <div className="sv-label flex items-center gap-1.5"><f.icon className="w-3 h-3" /> {f.title}</div>
              <p className="text-xs text-ink-3 mt-1.5 leading-relaxed">{f.text}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ScoutReport;
