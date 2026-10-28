/**
 * ScoutVision AI - Laboratoire : entraîneurs
 * L'électrochoc (retour à la moyenne), l'ADN de style des entraîneurs et le simulateur d'arrivée.
 */

import React, { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CoachSpell, LabExperiments, labData } from '../../services/labData';
import { coachSignature, frNumber, latestSpell, rollingMean, simulateArrival } from '../../utils/lab';
import { CompetitionBadge } from '../Media';
import { CONTEXT, DIVERGING, Loading, Missing, Panel, SERIES, VerdictBadge, useLab } from './common';

const DIM_LABELS: Record<string, { label: string; high: string; low: string }> = {
  possession: { label: 'Possession', high: 'garde le ballon', low: 'le laisse' },
  territoire: { label: 'Domination territoriale', high: 'joue chez l\'adversaire', low: 'défend bas' },
  pressing: { label: 'Pressing', high: 'presse haut', low: 'attend' },
  construction: { label: 'Construction', high: 'longues séquences', low: 'courtes' },
  'verticalité': { label: 'Verticalité', high: 'va vite vers l\'avant', low: 'temporise' },
  hauteur: { label: 'Hauteur du jeu', high: 'joue haut', low: 'joue bas' },
};

/**
 * Barre divergente d'un écart-type (-2 à +2)
 */
const StyleBar: React.FC<{ value: number }> = ({ value }) => {
  const width = Math.min(Math.abs(value), 2) / 2 * 50;
  const above = value >= 0;
  return (
    <div className="relative h-2.5 flex-1">
      <div className="absolute inset-y-0 left-1/2 w-px bg-ink-4" />
      <div className={`absolute inset-y-0 ${above ? 'left-1/2 rounded-r' : 'right-1/2 rounded-l'}`}
        style={{ width: `${width}%`, backgroundColor: above ? DIVERGING.above : DIVERGING.below }} />
    </div>
  );
};

const ChangeChart: React.FC<{ lab: LabExperiments }> = ({ lab }) => {
  const cc = lab.experiments.coachChange;
  const data = useMemo(() => {
    // Lissage séparé avant / après : la rupture au changement n'est pas étalée
    const smooth = (v: number[]) => {
      const cut = cc.curve.x.findIndex(x => x >= 0);
      return [...rollingMean(v.slice(0, cut)), ...rollingMean(v.slice(cut))];
    };
    const a = smooth(cc.curve.changers), b = smooth(cc.curve.controls);
    return cc.curve.x.map((x, i) => ({ x, label: x < 0 ? `${x}` : `+${x + 1}`, changers: a[i], controls: b[i] }));
  }, [cc]);
  return (
    <div>
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-ink-3 mb-2">
        <span className="inline-flex items-center gap-1.5"><span className="w-4 h-0.5" style={{ backgroundColor: SERIES[0] }} /> Clubs qui changent d'entraîneur ({cc.changes})</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-4 h-0.5" style={{ backgroundColor: CONTEXT }} /> Clubs comparables qui gardent le leur</span>
      </div>
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 800, height: 288 }}>
          <LineChart data={data} margin={{ top: 26, right: 16, bottom: 24, left: 0 }}>
            <CartesianGrid stroke="#1e293b" vertical={false} />
            <XAxis dataKey="label" stroke="#334155" tick={{ fill: '#94a3b8', fontSize: 11 }} interval={1}
              label={{ value: 'Matchs de championnat avant / après le changement', position: 'insideBottom', offset: -14, fill: '#64748b', fontSize: 11 }} />
            <YAxis stroke="#334155" tick={{ fill: '#94a3b8', fontSize: 11 }} width={44}
              tickFormatter={(v: number) => frNumber(v, 2, true)} />
            <ReferenceLine x="+1" stroke="#64748b" label={{ value: 'nouvel entraîneur', position: 'top', fill: '#94a3b8', fontSize: 11 }} />
            <Tooltip
              content={({ payload, label }) => {
                if (!payload?.length) return null;
                const p = payload[0].payload as { changers: number; controls: number };
                return (
                  <div className="bg-raised border border-line-strong rounded-md px-3 py-2 text-xs space-y-1">
                    <div className="text-ink-3">Match {label}</div>
                    <div className="flex items-center gap-2"><span className="w-3 h-0.5" style={{ backgroundColor: SERIES[0] }} /><span className="text-ink font-semibold">{frNumber(p.changers, 3, true)}</span><span className="text-ink-3">qui changent</span></div>
                    <div className="flex items-center gap-2"><span className="w-3 h-0.5" style={{ backgroundColor: CONTEXT }} /><span className="text-ink font-semibold">{frNumber(p.controls, 3, true)}</span><span className="text-ink-3">témoins</span></div>
                  </div>
                );
              }}
            />
            <Line type="monotone" dataKey="controls" stroke={CONTEXT} strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="changers" stroke={SERIES[0]} strokeWidth={2} dot={{ r: 3, fill: SERIES[0], stroke: '#020617', strokeWidth: 2 }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="text-[11px] text-ink-3 mt-1">
        xG différentiel par match, corrigé de l'adversaire et du terrain, moyenne glissante sur 3 matchs (avant et après séparément). Témoins : pour chaque
        changement, les 10 périodes de 20 matchs sans changement d'entraîneur (tous championnats) dont la forme des 10 matchs d'avant et le niveau plus
        ancien étaient les plus proches.
      </p>
    </div>
  );
};

const CoachesTab: React.FC<{ lab: LabExperiments }> = ({ lab }) => {
  const data = useLab(labData.coaches);
  const [query, setQuery] = useState('');
  const [coach, setCoach] = useState<string | null>(null);
  const [teamQuery, setTeamQuery] = useState('');
  const [teamId, setTeamId] = useState<string | null>(null);
  const cc = lab.experiments.coachChange;
  const res = lab.experiments.coachResults;

  const coaches = useMemo(() => {
    if (!data) return [];
    const by = new Map<string, number>();
    data.spells.forEach(s => by.set(s.coach, (by.get(s.coach) ?? 0) + s.n));
    return [...by.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
  }, [data]);
  const teams = useMemo(() => {
    if (!data) return [];
    const by = new Map<string, CoachSpell>();
    data.spells.forEach(s => { const prev = by.get(s.team_id); if (!prev || s.end > prev.end) by.set(s.team_id, s); });
    return [...by.values()].sort((a, b) => a.team.localeCompare(b.team));
  }, [data]);

  if (data === undefined) return <Loading />;
  const selected = coach ?? coaches[0];
  const spells = data ? data.spells.filter(s => s.coach === selected).sort((a, b) => a.start.localeCompare(b.start)) : [];
  const signature = data && selected ? coachSignature(data.spells, selected, data.dimensions) : null;
  const team = teams.find(t => t.team_id === teamId) ?? teams[0];
  const current = data && team ? latestSpell(data.spells, team.team_id) : undefined;
  const predicted = data && current && signature ? simulateArrival(
    Object.fromEntries(data.dimensions.map(d => [d, Number(current[d])])), signature, data.imprint) : null;
  const matchesCoach = query ? coaches.filter(c => c.toLowerCase().includes(query.toLowerCase())).slice(0, 8) : [];
  const matchesTeam = teamQuery ? teams.filter(t => t.team.toLowerCase().includes(teamQuery.toLowerCase())).slice(0, 8) : [];

  return (
    <div className="space-y-6">
      <Panel
        title="L'électrochoc n'existe pas"
        subtitle={`${cc.changes} changements d'entraîneur en cours de saison, après au moins 15 matchs de championnat avec le même entraîneur (un intérim suivi d'un nouveau titulaire compte pour un seul changement).`}
        right={<VerdictBadge verdict={cc.verdict} />}
      >
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_20rem] gap-6">
          <ChangeChart lab={lab} />
          <div className="space-y-3 text-sm text-ink-3 leading-relaxed">
            <p>Avant le changement, ces équipes sont en crise : <span className="text-ink font-semibold">{frNumber(cc.prePerf, 2, true)}</span> xG par match sur 10 matchs, contre {frNumber(cc.otherPerf, 2, true)} pour les autres.</p>
            <p>Après, elles remontent : <span className="text-ink font-semibold">{frNumber(cc.naive, 3, true)}</span> xG et <span className="text-ink font-semibold">{frNumber(cc.naivePoints, 2, true)}</span> point par match.</p>
            <p>Mais le simple retour à la moyenne prévoyait déjà <span className="text-ink font-semibold">{frNumber(cc.expectedRebound, 3, true)}</span> : l'effet propre du changement est de {frNumber(cc.effect, 3, true)} xG par match (IC 95 % [{frNumber(cc.effectCi[0], 3, true)} ; {frNumber(cc.effectCi[1], 3, true)}]), soit {frNumber(cc.effectPoints, 2, true)} point.</p>
            <p className="text-xs text-ink-3">Réserve : si les dirigeants jugent le niveau réel d'une équipe mieux que ses 30 derniers matchs, cette mesure surestime l'effet du changement. Elle est pourtant nulle.</p>
          </div>
        </div>
      </Panel>

      {!data ? <Missing what="des entraîneurs" /> : (
        <>
          <Panel
            title="L'ADN des entraîneurs"
            subtitle={`${data.arrivals} arrivées de ${data.coaches} entraîneurs dans un nouveau club. Style au nouveau club = poids du style d'avant du club + poids du style de l'entraîneur dans son club précédent (écarts-types par rapport au championnat).`}
            right={<VerdictBadge verdict={lab.experiments.coachDna.verdict} />}
          >
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
              <div>
                <div className="flex gap-4 text-[11px] text-ink-3 mb-3">
                  <span className="inline-flex items-center gap-1.5"><span className="w-3 h-2 rounded-sm" style={{ backgroundColor: CONTEXT }} /> Style d'avant du club</span>
                  <span className="inline-flex items-center gap-1.5"><span className="w-3 h-2 rounded-sm" style={{ backgroundColor: SERIES[0] }} /> Style apporté par l'entraîneur</span>
                </div>
                <div className="space-y-3">
                  {data.dimensions.map(d => {
                    const w = data.imprint[d];
                    return (
                      <div key={d} className="grid grid-cols-[9rem_1fr_6.5rem] items-center gap-3 text-xs">
                        <span className="text-ink-2">{DIM_LABELS[d]?.label ?? d}</span>
                        <div className="space-y-1">
                          <div className="h-2 rounded-r" style={{ width: `${Math.max(0, w.club) * 100}%`, backgroundColor: CONTEXT }} />
                          <div className="h-2 rounded-r" style={{ width: `${Math.max(0, w.coach) * 100}%`, backgroundColor: SERIES[0] }} />
                        </div>
                        <span className="text-right font-mono text-ink-3 tabular-nums" title={`IC 95 % du poids de l'entraîneur : [${frNumber(w.ci[0], 2)} ; ${frNumber(w.ci[1], 2)}]`}>
                          {frNumber(w.club, 2)} · {frNumber(w.coach, 2)}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <p className="text-[11px] text-ink-3 mt-3">
                  Exemple : un entraîneur dont l'équipe pressait un écart-type plus haut que son championnat fait monter le pressing de son nouveau club d'environ {frNumber(data.imprint.pressing.coach, 2)} écart-type.
                  Ses résultats, eux, ne le suivent pas : r = {frNumber(res.r, 2)} entre deux clubs successifs (IC [{frNumber(res.ci[0], 2, true)} ; {frNumber(res.ci[1], 2, true)}]).
                </p>
              </div>

              <div>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-3" />
                  <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Chercher un entraîneur..."
                    className="w-full bg-raised border border-line-strong rounded-md pl-9 pr-3 py-2 text-sm text-ink focus:outline-none focus:border-accent" />
                  {matchesCoach.length > 0 && (
                    <div className="absolute z-20 mt-1 w-full bg-raised border border-line-strong rounded-md  overflow-hidden">
                      {matchesCoach.map(c => (
                        <button key={c} onClick={() => { setCoach(c); setQuery(''); }} className="w-full text-left px-3 py-2 text-sm text-ink-2 hover:bg-overlay">{c}</button>
                      ))}
                    </div>
                  )}
                </div>
                {selected && signature && (
                  <div className="mt-4">
                    <div className="text-lg font-semibold text-ink">{selected}</div>
                    <div className="space-y-2 mt-3">
                      {data.dimensions.map(d => (
                        <div key={d} className="flex items-center gap-3 text-xs">
                          <span className="w-36 text-ink-2">{DIM_LABELS[d]?.label ?? d}</span>
                          <StyleBar value={signature[d]} />
                          <span className="w-12 text-right font-mono text-ink-3 tabular-nums">{frNumber(signature[d], 2, true)}</span>
                        </div>
                      ))}
                    </div>
                    <table className="w-full text-xs mt-4">
                      <thead>
                        <tr className="text-[10px] uppercase tracking-wider text-ink-3 border-b border-line">
                          <th className="text-left font-semibold py-1.5">Club</th>
                          <th className="text-left font-semibold py-1.5">Période</th>
                          <th className="text-right font-semibold py-1.5">Matchs</th>
                          <th className="text-right font-semibold py-1.5" title="xG différentiel par match, corrigé de l'adversaire et du terrain">xGD/match</th>
                        </tr>
                      </thead>
                      <tbody>
                        {spells.map(s => (
                          <tr key={`${s.team_id}-${s.start}`} className="border-b border-line/60">
                            <td className="py-1.5"><span className="inline-flex items-center gap-1.5 text-ink">{s.team} <CompetitionBadge competition={s.comp} showName={false} /></span></td>
                            <td className="py-1.5 text-ink-3">{s.start.slice(0, 7)} → {s.end.slice(0, 7)}</td>
                            <td className="py-1.5 text-right text-ink-3 tabular-nums">{s.n}</td>
                            <td className="py-1.5 text-right font-mono text-ink-2 tabular-nums">{frNumber(s.perf, 2, true)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="text-[10px] text-ink-3 mt-2">Style : moyenne de ses périodes (matchs de championnat avec données avancées), pondérée par les matchs. À droite = plus que la moyenne de son championnat.</p>
                  </div>
                )}
              </div>
            </div>
          </Panel>

          <Panel
            title="Simulateur : et si cet entraîneur arrivait ?"
            subtitle="Style attendu du club avec l'entraîneur choisi ci-dessus, d'après les poids mesurés sur les arrivées passées. Le style seulement : rien n'indique que les résultats suivent."
          >
            <div className="relative max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-3" />
              <input value={teamQuery} onChange={e => setTeamQuery(e.target.value)} placeholder={team ? `Club : ${team.team}` : 'Chercher un club...'}
                className="w-full bg-raised border border-line-strong rounded-md pl-9 pr-3 py-2 text-sm text-ink focus:outline-none focus:border-accent" />
              {matchesTeam.length > 0 && (
                <div className="absolute z-20 mt-1 w-full bg-raised border border-line-strong rounded-md  overflow-hidden">
                  {matchesTeam.map(t => (
                    <button key={t.team_id} onClick={() => { setTeamId(t.team_id); setTeamQuery(''); }} className="w-full text-left px-3 py-2 text-sm text-ink-2 hover:bg-overlay flex items-center gap-2">
                      {t.team} <CompetitionBadge competition={t.comp} showName={false} />
                    </button>
                  ))}
                </div>
              )}
            </div>
            {team && current && predicted && (
              <div className="mt-5">
                <div className="text-sm text-ink-3 mb-3">
                  <span className="text-ink font-semibold">{team.team}</span> sous {current.coach} ({current.start.slice(0, 7)} → {current.end.slice(0, 7)})
                  {' '}avec <span className="text-ink font-semibold">{selected}</span>
                </div>
                <div className="flex gap-5 text-[11px] text-ink-3 mb-3">
                  <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: CONTEXT }} /> Style actuel</span>
                  <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: SERIES[0] }} /> Style attendu avec {selected}</span>
                </div>
                <div className="space-y-2.5">
                  {data.dimensions.map(d => {
                    const now = Number(current[d]), next = predicted[d];
                    const pos = (v: number) => `${50 + Math.max(-2, Math.min(2, v)) / 2 * 50}%`;
                    return (
                      <div key={d} className="grid grid-cols-[9rem_1fr_7rem] items-center gap-3 text-xs">
                        <span className="text-ink-2">{DIM_LABELS[d]?.label ?? d}</span>
                        <div className="relative h-4">
                          <div className="absolute top-1/2 inset-x-0 h-px bg-overlay" />
                          <div className="absolute top-0 bottom-0 left-1/2 w-px bg-line-strong" />
                          <div className="absolute top-1/2 h-px bg-ink-4" style={{ left: `calc(${pos(Math.min(now, next))})`, width: `${Math.abs(next - now) / 4 * 100}%` }} />
                          <span className="absolute top-1/2 w-2.5 h-2.5 -ml-[5px] -mt-[5px] rounded-full ring-2 ring-surface" style={{ left: pos(now), backgroundColor: CONTEXT }} />
                          <span className="absolute top-1/2 w-2.5 h-2.5 -ml-[5px] -mt-[5px] rounded-full ring-2 ring-surface" style={{ left: pos(next), backgroundColor: SERIES[0] }} />
                        </div>
                        <span className="text-right font-mono text-ink-3 tabular-nums">{frNumber(now, 2, true)} → {frNumber(next, 2, true)}</span>
                      </div>
                    );
                  })}
                </div>
                <p className="text-[10px] text-ink-3 mt-3">Écarts-types par rapport au championnat ; à droite = plus de possession, de domination, de pressing, de construction, de verticalité, un jeu plus haut.</p>
              </div>
            )}
          </Panel>
        </>
      )}
    </div>
  );
};

export default CoachesTab;
