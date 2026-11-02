/**
 * ScoutVision AI - Distribution des rangs : équipes en lignes, positions en colonnes, couleur = P(rang = k).
 * Rampe séquentielle cyan (theme/charts), valeurs lisibles au clavier (cellules focusables, aria-label),
 * légende, et bascule « valeurs » pour afficher tous les pourcentages. La heatmap complète le tableau
 * principal (P5–P95, objectifs) ; elle n'est jamais le seul moyen de connaître une probabilité.
 */

import React, { useState } from 'react';
import { ReplayTeam } from '../../services/replayData';
import { SEQUENTIAL } from '../../theme/charts';
import { pct } from './simulatorLogic';

function shade(p: number): string {
  if (p <= 0.0005) return 'transparent';
  const i = Math.min(SEQUENTIAL.length - 1, Math.floor(Math.sqrt(Math.min(p, 1)) * SEQUENTIAL.length));
  return SEQUENTIAL[i];
}

const RankHeatmap: React.FC<{ teams: ReplayTeam[]; onSelect?: (id: string) => void; selected?: string | null }> = ({ teams, onSelect, selected }) => {
  const [showValues, setShowValues] = useState(false);
  const n = teams.length ? teams[0].dist.length : 0;
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 text-2xs text-ink-3">
          <span>Faible</span>
          <span className="flex" aria-hidden>{SEQUENTIAL.filter((_, i) => i % 2 === 1).map(c => <span key={c} className="w-4 h-2.5" style={{ backgroundColor: c }} />)}</span>
          <span>Forte probabilité</span>
        </div>
        <button type="button" onClick={() => setShowValues(v => !v)} aria-pressed={showValues} className="sv-btn sv-btn-ghost sv-btn-sm">
          {showValues ? 'Masquer les valeurs' : 'Afficher toutes les valeurs'}
        </button>
      </div>
      <div className="overflow-x-auto" tabIndex={0} aria-label="Distribution des rangs, défilement horizontal">
        <table className="text-xs border-separate border-spacing-px min-w-max">
          <caption className="sr-only">Probabilité de chaque position finale par équipe (20 000 simulations)</caption>
          <thead>
            <tr>
              <th scope="col" className="text-left sv-label pr-2 sticky left-0 bg-surface">Équipe</th>
              {Array.from({ length: n }, (_, k) => <th key={k} scope="col" className="sv-label text-center w-9 px-0.5">{k + 1}</th>)}
            </tr>
          </thead>
          <tbody>
            {teams.map(t => (
              <tr key={t.id} className={selected === t.id ? 'outline outline-1 outline-accent/60' : ''}>
                <th scope="row" className="text-left font-normal text-ink-2 pr-2 whitespace-nowrap sticky left-0 bg-surface">
                  <button type="button" onClick={() => onSelect?.(t.id)} className="hover:text-ink focus-visible:text-ink text-left">{t.name}</button>
                </th>
                {t.dist.map((p, k) => (
                  <td key={k} tabIndex={0} title={`${t.name} · position ${k + 1} : ${pct(p, 1)}`} aria-label={`${t.name}, position ${k + 1} : ${pct(p, 1)}`}
                    className="h-7 w-9 text-center num rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                    style={{ backgroundColor: shade(p), color: p >= 0.45 ? '#0B111A' : undefined }}>
                    {(showValues || p >= 0.2) && p >= 0.005 ? `${Math.round(100 * p)}` : ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-2xs text-ink-4 mt-1">Valeurs en % ; affichées quand elles atteignent 20 % (ou toutes avec le bouton). Survol ou focus d'une cellule : valeur exacte.</p>
    </div>
  );
};

export default RankHeatmap;
