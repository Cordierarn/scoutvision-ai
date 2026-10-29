/**
 * ScoutVision - profil de l'effectif (9 dimensions de squadProfile, utils/recruitment.ts)
 * Un seul composant pour l'Analyse d'équipe et le Recrutement : même fonction, mêmes lignes,
 * même rang. Barres divergentes autour de la médiane du championnat.
 */

import React from 'react';
import { DimensionScore } from '../utils/recruitment';
import { BRAND, DIVERGING } from '../theme/charts';
import { LegendItem, Panel } from './ui';

const ordinal = (v: number) => {
  const r = Math.max(1, Math.min(100, Math.round(v)));
  return r === 1 ? '1er' : `${r}e`;
};

export const DivergingRow: React.FC<{ label: string; rank: number; detail: string }> = ({ label, rank, detail }) => {
  const above = rank >= 50;
  const width = Math.abs(rank - 50);
  return (
    <div className="grid grid-cols-[7.5rem_1fr_3rem] items-center gap-3" title={detail}>
      <span className="text-xs text-ink-2 truncate">{label}</span>
      <div className="relative h-2 bg-raised rounded-sm" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(rank)} aria-label={detail}>
        <div className="absolute -inset-y-0.5 left-1/2 w-px bg-ink-4" />
        <div
          className={`absolute inset-y-0 ${above ? 'left-1/2 rounded-r-sm' : 'right-1/2 rounded-l-sm'}`}
          style={{ width: `${width}%`, backgroundColor: above ? BRAND : DIVERGING.below }}
        />
      </div>
      <span className="text-xs text-ink-2 text-right num">{ordinal(rank)}</span>
    </div>
  );
};

const round = (v: number) => Math.round(v);

export const SquadProfilePanel: React.FC<{ profile: DimensionScore[]; leagueName: string; className?: string; note?: React.ReactNode }> = ({ profile, leagueName, className = '', note }) => (
  <Panel
    className={className}
    title="Profil de l'effectif"
    subtitle={`Rang parmi les équipes de ${leagueName} : moyenne des percentiles des joueurs (chacun comparé à son rôle), pondérée par les minutes.`}
  >
    {note}
    {profile.length > 0 ? (
      <>
        <div className="flex gap-4 mb-2.5">
          <LegendItem color={BRAND} shape="bar">Au-dessus de la médiane</LegendItem>
          <LegendItem color={DIVERGING.below} shape="bar">En dessous</LegendItem>
        </div>
        <div className="space-y-2">
          {profile.map(d => (
            <DivergingRow key={d.key} label={d.label} rank={d.rank}
              detail={`${d.label} : moyenne ${round(d.value)}, rang ${ordinal(d.rank)} percentile sur ${d.teams} équipes`} />
          ))}
        </div>
      </>
    ) : <p className="text-xs text-ink-4">Pas assez de données de joueurs.</p>}
  </Panel>
);

export default SquadProfilePanel;
