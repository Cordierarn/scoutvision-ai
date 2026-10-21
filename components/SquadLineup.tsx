/**
 * ScoutVision AI - Composition type d'une équipe
 * Tirée des compositions réellement alignées (table lineup de PitchAPI) : formations
 * utilisées, et pour chaque case les joueurs qui y ont le plus souvent débuté.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Users } from 'lucide-react';
import { PlayerData } from '../types';
import { dataLoader, TeamLineups } from '../services/dataLoader';
import { placeEleven } from '../utils/lineup';
import { bestPreset } from '../utils/rolePresets';
import { positionLabel } from '../utils/labels';
import { PhotoOverlay } from './Media';

interface SquadLineupProps {
  teamId?: string;
  season?: string;
  competition?: string;
  players: PlayerData[];          // effectif de l'équipe dans la compétition (player_season)
}

const SquadLineup: React.FC<SquadLineupProps> = ({ teamId, season, competition, players }) => {
  const [lineups, setLineups] = useState<TeamLineups | null | undefined>(undefined);
  const [formationIdx, setFormationIdx] = useState(0);

  useEffect(() => {
    setLineups(undefined);
    setFormationIdx(0);
    if (!teamId || !season || !competition) {
      setLineups(null);
      return;
    }
    let cancelled = false;
    dataLoader.loadLineups(season, competition)
      .then(file => { if (!cancelled) setLineups(file?.[teamId] ?? null); })
      .catch(() => { if (!cancelled) setLineups(null); });
    return () => { cancelled = true; };
  }, [teamId, season, competition]);

  const byId = useMemo(() => new Map(players.map(p => [p['Player ID'], p])), [players]);
  const formation = lineups?.formations[formationIdx];
  const eleven = useMemo(() => (formation ? placeEleven(formation.slots) : []), [formation]);

  if (lineups === undefined) {
    return <div className="h-full min-h-[700px] bg-[#1a2c2c] animate-pulse" />;
  }
  if (!lineups || lineups.formations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-slate-500">
        <Users className="w-12 h-12 mb-3 opacity-20" />
        <p>Aucune composition disponible pour cette équipe dans cette compétition.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Formations réellement utilisées */}
      <div className="flex items-center gap-2 px-6 py-3 bg-slate-950 border-b border-slate-800 overflow-x-auto">
        <span className="text-xs text-slate-500 uppercase font-semibold shrink-0 mr-1">Formation</span>
        {lineups.formations.map((f, idx) => (
          <button
            key={f.formation}
            onClick={() => setFormationIdx(idx)}
            className={`shrink-0 px-3 py-1.5 rounded-full text-xs border ${idx === formationIdx ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-300 font-semibold' : 'border-slate-700 text-slate-400 hover:text-slate-200'}`}
          >
            {f.formation} <span className="text-slate-500">· {f.matches} match{f.matches > 1 ? 's' : ''}</span>
          </button>
        ))}
        <span className="text-[11px] text-slate-500 ml-auto shrink-0">
          Titulaires les plus fréquents par poste, sur {lineups.matches} matchs
        </span>
      </div>

      <div className="relative flex-1 min-w-[800px] min-h-[700px] w-full bg-[#1a2c2c] overflow-hidden">
        {/* Terrain : l'équipe attaque vers le haut */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:4rem_4rem] z-0"></div>
        <div className="absolute inset-12 border-2 border-white/10 rounded-sm z-0"></div>
        <div className="absolute top-1/2 left-0 right-0 h-px bg-white/10 z-0"></div>
        <div className="absolute top-1/2 left-1/2 w-40 h-40 border-2 border-white/10 rounded-full -translate-x-1/2 -translate-y-1/2 z-0"></div>
        <div className="absolute top-12 left-1/2 w-[40%] h-40 border-2 border-t-0 border-white/10 -translate-x-1/2 z-0"></div>
        <div className="absolute bottom-12 left-1/2 w-[40%] h-40 border-2 border-b-0 border-white/10 -translate-x-1/2 z-0"></div>

        {eleven.map(({ slot, starter, backups }) => {
          const data = starter ? byId.get(starter.id) : undefined;
          const role = data ? bestPreset(data) : null;
          // pitch_x : 0,1 (gardien) à 0,87 (attaque) ; pitch_y : 0 = gauche
          const top = `${92 - ((slot.x - 0.08) / 0.82) * 80}%`;
          const left = `${8 + slot.y * 84}%`;
          return (
            <div key={slot.slot} className="absolute w-48 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center z-10 hover:z-30" style={{ top, left }}>
              <div className="mb-1.5 px-2.5 py-0.5 bg-black/40 backdrop-blur-md rounded-full border border-white/10 text-[10px] font-bold text-emerald-400 uppercase tracking-wide">
                {role ? role.name : data ? positionLabel(data.Position) : 'Titulaire'}
              </div>
              {starter ? (
                <div className="w-full bg-slate-900/90 backdrop-blur-xl border border-white/10 rounded-xl p-2.5 shadow-2xl hover:border-emerald-500/50 transition-colors group relative">
                  <div className="flex items-center gap-2.5">
                    <div className="relative overflow-hidden w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-white bg-slate-700 border-2 border-slate-500 shrink-0">
                      {starter.name.substring(0, 1)}
                      <PhotoOverlay src={data?.Image} alt={starter.name} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-white font-bold truncate text-sm">{starter.name}</div>
                      <div className="flex items-center justify-between mt-0.5 text-[10px]">
                        <span className="text-slate-400">{starter.starts} tit.</span>
                        {role && <span className={role.index >= 70 ? 'text-emerald-400 font-bold' : 'text-yellow-400 font-bold'}>{role.index}</span>}
                        <span className="text-slate-400">{data?.Age !== undefined ? `${data.Age} ans` : ''}</span>
                      </div>
                    </div>
                  </div>
                  {backups.length > 0 && (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-slate-900 border border-slate-700 rounded-lg overflow-hidden hidden group-hover:block z-50">
                      <div className="px-2 py-1 text-[9px] uppercase text-slate-500 border-b border-slate-800">Aussi titulaire à ce poste</div>
                      {backups.map(b => (
                        <div key={b.id} className="px-2 py-1.5 border-b border-slate-800 flex justify-between text-[10px]">
                          <span className="text-slate-300 truncate">{b.name}</span>
                          <span className="text-slate-500">{b.starts} tit.</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="w-10 h-10 rounded-full border-2 border-dashed border-white/20" title="Aucun titulaire disponible" />
              )}
            </div>
          );
        })}

        <div className="absolute bottom-3 right-4 text-[10px] text-slate-500">
          Note = indice du meilleur rôle (percentiles, rôles du Chasseur de pépites) · tit. = titularisations à ce poste
        </div>
      </div>
    </div>
  );
};

export default SquadLineup;
