/**
 * ScoutVision AI - Laboratoire : affinités de passe
 * Les duos qui se cherchent plus (ou moins) que leur volume de passes et leur placement ne l'expliquent.
 */

import React, { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { DuoRow, LabExperiments, labData } from '../../services/labData';
import { frNumber } from '../../utils/lab';
import { CompetitionBadge } from '../Media';
import { CONTEXT, Loading, Missing, Panel, SERIES, VerdictBadge, useLab } from './common';

const DuoLine: React.FC<{ d: DuoRow; scale: number }> = ({ d, scale }) => {
  const ratio = d.passes / d.expected;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)_5rem] items-center gap-3 py-2 border-b border-slate-800/60 text-xs">
      <div className="min-w-0">
        <div className="text-slate-200 truncate">{d.from_name} <span className="text-slate-500">→</span> {d.to_name}</div>
        <div className="text-[11px] text-slate-500">{d.passes} passes pour {frNumber(d.expected, 0)} attendues</div>
      </div>
      <div className="relative h-3">
        <div className="absolute top-1/2 inset-x-0 h-px bg-slate-800" />
        <div className="absolute top-1/2 h-px bg-slate-500" style={{ left: `${Math.min(d.passes, d.expected) / scale * 100}%`, width: `${Math.abs(d.passes - d.expected) / scale * 100}%` }} />
        <span className="absolute top-1/2 w-2.5 h-2.5 -ml-[5px] -mt-[5px] rounded-full ring-2 ring-slate-950" style={{ left: `${d.expected / scale * 100}%`, backgroundColor: CONTEXT }} />
        <span className="absolute top-1/2 w-2.5 h-2.5 -ml-[5px] -mt-[5px] rounded-full ring-2 ring-slate-950" style={{ left: `${d.passes / scale * 100}%`, backgroundColor: SERIES[0] }} />
      </div>
      <span className="text-right font-mono text-slate-200 tabular-nums">×{frNumber(ratio, 2)}</span>
    </div>
  );
};

const DuosTab: React.FC<{ lab: LabExperiments }> = ({ lab }) => {
  const data = useLab(labData.duos);
  const seasons = useMemo(() => [...new Set((data?.rows ?? []).map(r => r.app_season))].sort().reverse(), [data]);
  const [season, setSeason] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [teamId, setTeamId] = useState<string | null>(null);
  const current = season ?? seasons.find(s => s !== lab.current) ?? seasons[0];
  const inSeason = useMemo(() => (data?.rows ?? []).filter(r => r.app_season === current), [data, current]);
  const teams = useMemo(() => {
    const by = new Map<string, { id: string; name: string; comp: string }>();
    inSeason.forEach(r => by.set(r.team_id, { id: r.team_id, name: r.team ?? r.team_id, comp: r.comp }));
    return [...by.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [inSeason]);

  if (data === undefined) return <Loading />;
  if (!data) return <Missing what="des duos" />;
  const best = [...inSeason].sort((a, b) => b.affinity - a.affinity).slice(0, 12);
  // Par défaut : l'équipe du duo le plus lié de la saison
  const team = teams.find(t => t.id === teamId) ?? teams.find(t => t.id === best[0]?.team_id) ?? teams[0];
  const own = inSeason.filter(r => r.team_id === team?.id).sort((a, b) => b.affinity - a.affinity);
  const top = own.filter(r => r.affinity > 0).slice(0, 8);
  const low = own.filter(r => r.affinity < 0).slice(-3).reverse();
  const scale = Math.max(...own.map(r => Math.max(r.passes, r.expected)), 1) * 1.05;
  const matches = query ? teams.filter(t => t.name.toLowerCase().includes(query.toLowerCase())).slice(0, 8) : [];
  const e = lab.experiments.duos;

  return (
    <div className="space-y-6">
      <Panel
        title="Affinités de passe"
        subtitle={`Attendu d'un duo dans un match = passes du passeur × passes reçues du receveur / total de l'équipe, corrigé du placement (rapport moyen pour la même paire de rôles et de côtés, tous clubs). Fiabilité entre matchs pairs et impairs : r = ${frNumber(e.reliability, 2)} sur ${e.pairs.toLocaleString('fr-FR')} duos.`}
        right={<VerdictBadge verdict={e.verdict} />}
      >
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-[11px] text-slate-500">Saison
            <select value={current} onChange={e => setSeason(e.target.value)} className="block mt-1 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200">
              {seasons.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <div className="relative w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder={team ? `Équipe : ${team.name}` : 'Chercher une équipe...'}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-9 pr-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-emerald-500" />
            {matches.length > 0 && (
              <div className="absolute z-20 mt-1 w-full bg-slate-900 border border-slate-700 rounded-lg shadow-xl overflow-hidden">
                {matches.map(t => (
                  <button key={t.id} onClick={() => { setTeamId(t.id); setQuery(''); }} className="w-full text-left px-3 py-2 text-sm text-slate-300 hover:bg-slate-800 flex items-center gap-2">
                    {t.name} <CompetitionBadge competition={t.comp} showName={false} />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        {team && (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-8 mt-5">
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">{team.name} : les duos qui se cherchent</h4>
                <div className="flex gap-3 text-[11px] text-slate-400">
                  <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: CONTEXT }} /> attendu</span>
                  <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: SERIES[0] }} /> réel</span>
                </div>
              </div>
              {top.length ? top.map(d => <DuoLine key={`${d.from_player_id}-${d.to_player_id}`} d={d} scale={scale} />)
                : <p className="text-sm text-slate-500">Aucun duo au-dessus de l'attendu (30 passes attendues au moins).</p>}
              {low.length > 0 && (
                <>
                  <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mt-5 mb-2">Les moins liés</h4>
                  {low.map(d => <DuoLine key={`${d.from_player_id}-${d.to_player_id}`} d={d} scale={scale} />)}
                </>
              )}
            </div>
            <div>
              <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Les plus fortes affinités de la saison {current}</h4>
              {best.map(d => (
                <div key={`${d.team_id}-${d.from_player_id}-${d.to_player_id}`} className="flex items-center justify-between gap-3 py-1.5 border-b border-slate-800/60 text-xs">
                  <span className="min-w-0 truncate text-slate-200">{d.from_name} <span className="text-slate-500">→</span> {d.to_name}
                    <span className="text-slate-500"> · {d.team}</span></span>
                  <span className="shrink-0 inline-flex items-center gap-2"><CompetitionBadge competition={d.comp} showName={false} />
                    <span className="font-mono text-slate-200 tabular-nums">×{frNumber(d.passes / d.expected, 2)}</span></span>
                </div>
              ))}
            </div>
          </div>
        )}
        <p className="text-[11px] text-slate-500 mt-4">Duos avec au moins 30 passes attendues sur la saison (championnats, matchs avec réseau de passes). L'attendu absorbe une partie de l'excès d'un duo : ces rapports sont prudents.</p>
      </Panel>
    </div>
  );
};

export default DuosTab;
