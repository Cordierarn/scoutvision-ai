/**
 * ScoutVision AI - Laboratoire : l'ascenseur
 * Joueurs hors Big 5 susceptibles d'être recrutés par un championnat nettement plus fort.
 */

import React, { useMemo, useState } from 'react';
import { ElevatorRow, LabExperiments, labData } from '../../services/labData';
import { frNumber, frPercent } from '../../utils/lab';
import { positionLabel } from '../../utils/labels';
import { CompetitionBadge, PhotoOverlay } from '../Media';
import { Loading, Missing, Panel, SERIES, VerdictBadge, useLab } from './common';

type Mode = 'next' | 'check';

const Status: React.FC<{ row: ElevatorRow }> = ({ row }) => {
  if (row.observed === 1) {
    return <span className="inline-flex items-center gap-1.5 text-xs text-ink">Monté <CompetitionBadge competition={row.next_comp ?? undefined} className="text-ink-3" /></span>;
  }
  if (row.observed === 0) {
    return <span className="text-xs text-ink-3">Pas monté{row.next_comp ? <> · <CompetitionBadge competition={row.next_comp} showName={false} /></> : null}</span>;
  }
  return <span className="text-xs text-ink-3">Pas encore vu</span>;
};

const ElevatorTab: React.FC<{ lab: LabExperiments; images: Map<string, string> }> = ({ lab, images }) => {
  const data = useLab(labData.elevator);
  const [mode, setMode] = useState<Mode>('next');
  const [comp, setComp] = useState('');
  const [position, setPosition] = useState('');
  const [maxAge, setMaxAge] = useState(40);
  const v = lab.experiments.elevator.validation;
  const verify = lab.experiments.elevator.verify;

  const source = data ? (mode === 'next' ? data.provisional : data.check) : null;
  const comps = useMemo(() => [...new Set((source?.rows ?? []).map(r => r.Competition))].sort(), [source]);
  const rows = useMemo(() => (source?.rows ?? [])
    .filter(r => (!comp || r.Competition === comp) && (!position || r.Position === position) && r.Age <= maxAge)
    .slice(0, 60), [source, comp, position, maxAge]);

  if (data === undefined) return <Loading />;
  if (!data) return <Missing what="de l'ascenseur" />;
  const maxP = Math.max(...rows.map(r => r.p), 0.01);

  return (
    <div className="space-y-6">
      <Panel
        title="L'ascenseur"
        subtitle={`Joueurs des championnats hors Big 5 : probabilité de jouer la saison suivante dans un autre club, dans un championnat nettement plus fort (au moins ${frNumber(data.stepUp, 0)} point de niveau au-dessus, modèle de transfert). Régression logistique : indice du meilleur rôle, âge, part des minutes, championnat d'origine, force du club.`}
        right={<VerdictBadge verdict={lab.experiments.elevator.verdict} />}
      >
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="bg-raised rounded-md p-3">
            <div className="text-2xs text-ink-3">AUC hors échantillon</div>
            <div className="text-xl font-semibold text-ink">{frNumber(v.auc, 2)}</div>
            <div className="text-2xs text-ink-3">saison {v.base} → suivante, {v.pairs.toLocaleString('fr-FR')} joueurs</div>
          </div>
          <div className="bg-raised rounded-md p-3">
            <div className="text-2xs text-ink-3">Parmi les {v.top.n} premiers</div>
            <div className="text-xl font-semibold text-ink">{v.top.hits} montés</div>
            <div className="text-2xs text-ink-3">contre {frPercent(v.rate, 1)} en moyenne</div>
          </div>
          {v.top100 && (
            <div className="bg-raised rounded-md p-3">
              <div className="text-2xs text-ink-3">Parmi les {v.top100.n} premiers</div>
              <div className="text-xl font-semibold text-ink">{v.top100.hits} montés</div>
              <div className="text-2xs text-ink-3">{frNumber(v.top100.hits / v.top100.n / v.rate, 1)} fois le hasard</div>
            </div>
          )}
          {verify && (
            <div className="bg-raised rounded-md p-3">
              <div className="text-2xs text-ink-3">Vérification en cours ({verify.season})</div>
              <div className="text-xl font-semibold text-ink">{verify.hits} / {verify.seen}</div>
              <div className="text-2xs text-ink-3">des {verify.top} premiers déjà vus sont montés</div>
            </div>
          )}
        </div>
        <div className="mt-4">
          <div className="text-2xs text-ink-3 mb-2">Calibration hors échantillon, par cinquième de probabilité prévue</div>
          <div className="grid grid-cols-5 gap-2 max-w-xl">
            {v.quintiles.map((q, i) => (
              <div key={i} className="text-center">
                <div className="text-xs text-ink font-semibold tabular-nums">{frPercent(q.observed)}</div>
                <div className="text-2xs text-ink-3 tabular-nums">prévu {frPercent(q.predicted)}</div>
              </div>
            ))}
          </div>
        </div>
        <p className="text-2xs text-ink-3 mt-3 leading-relaxed">
          Montée = transfert observé dans nos 35 compétitions ; un joueur parti ailleurs ou sous 40 % des minutes de son nouveau club n'est pas vu.
          La vérification sur la saison en cours sous-estime donc les montées (un nouveau venu met du temps à jouer). Un club promu n'est pas un transfert.
        </p>
      </Panel>

      <Panel
        title={mode === 'next' ? `Prévisions pour la saison suivante (base ${source?.season ?? '—'}, provisoire)` : `Vérification : prévisions faites sur ${source?.season ?? '—'}`}
        right={
          <div className="flex rounded-md border border-line-strong overflow-hidden text-xs">
            {(['next', 'check'] as Mode[]).map(m => (
              <button key={m} onClick={() => setMode(m)} disabled={m === 'check' && !data.check}
                className={`px-3 py-1.5 ${mode === m ? 'bg-accent/10 text-accent font-semibold' : 'text-ink-3 hover:text-ink'} disabled:opacity-40`}>
                {m === 'next' ? 'Prévisions' : 'Vérification'}
              </button>
            ))}
          </div>
        }
      >
        <div className="flex flex-wrap items-end gap-3 mb-4">
          <label className="text-2xs text-ink-3">Championnat
            <select value={comp} onChange={e => setComp(e.target.value)} className="block mt-1 bg-raised border border-line-strong rounded px-2 py-1 text-xs text-ink">
              <option value="">Tous</option>
              {comps.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="text-2xs text-ink-3">Poste
            <select value={position} onChange={e => setPosition(e.target.value)} className="block mt-1 bg-raised border border-line-strong rounded px-2 py-1 text-xs text-ink">
              <option value="">Tous</option>
              {['GK', 'CB', 'FB', 'WB', 'DM', 'CM', 'AM', 'W', 'ST'].map(p => <option key={p} value={p}>{positionLabel(p)}</option>)}
            </select>
          </label>
          <label className="text-2xs text-ink-3">Âge max.
            <input type="number" min={16} max={40} value={maxAge} onChange={e => setMaxAge(Number(e.target.value) || 40)}
              className="block mt-1 w-16 bg-raised border border-line-strong rounded px-2 py-1 text-xs text-ink" />
          </label>
          {mode === 'next' && <span className="text-2xs text-ink-3 pb-1">Saison en cours : indice et temps de jeu sur une saison partielle.</span>}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-2xs text-ink-3 uppercase tracking-wider border-b border-line">
                <th className="text-left font-semibold py-2 pr-2 w-8">#</th>
                <th className="text-left font-semibold py-2 pr-3">Joueur</th>
                <th className="text-left font-semibold py-2 px-3">Club</th>
                <th className="text-left font-semibold py-2 px-3">Meilleur rôle</th>
                <th className="text-right font-semibold py-2 px-3">Minutes</th>
                <th className="text-left font-semibold py-2 px-3 w-48">Probabilité</th>
                {mode === 'check' && <th className="text-left font-semibold py-2 pl-3">Saison {verify?.season}</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r['Player ID']} className="border-b border-line/60">
                  <td className="py-2 pr-2 text-xs text-ink-3 tabular-nums">{i + 1}</td>
                  <td className="py-2 pr-3">
                    <div className="flex items-center gap-2.5 min-w-[12rem]">
                      <div className="relative overflow-hidden w-8 h-8 rounded-full bg-overlay flex items-center justify-center text-2xs font-bold text-ink-3 shrink-0">
                        {r.Player.substring(0, 2).toUpperCase()}
                        <PhotoOverlay src={images.get(r['Player ID'])} alt={r.Player} />
                      </div>
                      <div className="min-w-0">
                        <div className="text-ink font-medium truncate">{r.Player}</div>
                        <div className="text-2xs text-ink-3">{r.Age} ans · {positionLabel(r.Position)}</div>
                      </div>
                    </div>
                  </td>
                  <td className="py-2 px-3"><span className="inline-flex items-center gap-1.5 text-xs text-ink-2">{r.Team} <CompetitionBadge competition={r.Competition} showName={false} /></span></td>
                  <td className="py-2 px-3 text-xs text-ink-2">{r.best_role} <span className="font-mono text-ink-3">· {Math.round(r.best_index)}</span></td>
                  <td className="py-2 px-3 text-right text-xs text-ink-3 tabular-nums">{r['Minutes share'] !== undefined && r['Minutes share'] !== null ? frPercent(Number(r['Minutes share'])) : '–'}</td>
                  <td className="py-2 px-3">
                    <div className="flex items-center gap-2">
                      <div className="h-2.5 flex-1 bg-raised rounded-r">
                        <div className="h-full rounded-r" style={{ width: `${(r.p / maxP) * 100}%`, backgroundColor: SERIES[0] }} />
                      </div>
                      <span className="w-12 text-right text-xs text-ink font-mono tabular-nums">{frPercent(r.p)}</span>
                    </div>
                  </td>
                  {mode === 'check' && <td className="py-2 pl-3"><Status row={r} /></td>}
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <p className="text-sm text-ink-3 py-4">Aucun joueur ne correspond aux filtres.</p>}
        </div>
      </Panel>
    </div>
  );
};

export default ElevatorTab;
