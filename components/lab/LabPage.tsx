/**
 * ScoutVision AI - Laboratoire
 * Idées neuves testées sur les données match par match (scripts/lab.py, scripts/prepare_lab.py) :
 * le carnet de toutes les expériences et leurs verdicts, et les outils qui en sont issus.
 */

import React, { useMemo, useState } from 'react';
import { FlaskConical } from 'lucide-react';
import { PlayerData } from '../../types';
import { labData } from '../../services/labData';
import { Loading, Missing, useLab } from './common';
import Notebook, { LabTab } from './Notebook';
import CoachesTab from './CoachesTab';
import ElevatorTab from './ElevatorTab';
import GoalsTab from './GoalsTab';
import DuosTab from './DuosTab';
import RefereesTab from './RefereesTab';
import SquadsTab from './SquadsTab';

const TABS: { key: LabTab; label: string }[] = [
  { key: 'notebook', label: 'Carnet d\'expériences' },
  { key: 'coaches', label: 'Entraîneurs' },
  { key: 'elevator', label: 'L\'ascenseur' },
  { key: 'goals', label: 'Valeur des buts' },
  { key: 'duos', label: 'Duos' },
  { key: 'referees', label: 'Arbitres' },
  { key: 'squads', label: 'Effectifs' },
];

// Onglet retrouvé au retour sur la page
let lastTab: LabTab = 'notebook';

const LabPage: React.FC<{ playerData: PlayerData[] }> = ({ playerData }) => {
  const lab = useLab(labData.experiments);
  const [tab, setTab] = useState<LabTab>(lastTab);
  const open = (t: LabTab) => { lastTab = t; setTab(t); };
  // Photos des joueurs des saisons chargées (l'ascenseur n'en contient pas)
  const images = useMemo(() => new Map(playerData.filter(p => p['Player ID'] && p.Image).map(p => [p['Player ID']!, String(p.Image)])), [playerData]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-6 space-y-6 max-w-[96rem] mx-auto">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-ink flex items-center gap-2.5"><FlaskConical className="w-6 h-6 text-accent" /> Laboratoire</h1>
            <p className="text-sm text-ink-3 mt-1 max-w-3xl">
              Des idées neuves testées sur les données match par match (compositions, buts, momentum, réseaux de passes, entraîneurs, arbitres) :
              chacune a un verdict chiffré, et les idées reçues démenties comptent autant que les découvertes.
            </p>
          </div>
          {lab && <span className="text-[11px] text-ink-3">Calculé le {new Date(lab.generatedAt).toLocaleDateString('fr-FR')} sur {lab.matches.toLocaleString('fr-FR')} matchs</span>}
        </div>

        <div className="flex flex-wrap gap-2 border-b border-line pb-3" role="tablist">
          {TABS.map(t => (
            <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => open(t.key)}
              className={`px-3.5 py-1.5 rounded-md text-sm transition-colors ${tab === t.key ? 'bg-accent text-accent-ink font-semibold' : 'text-ink-3 hover:text-ink hover:bg-raised'}`}>
              {t.label}
            </button>
          ))}
        </div>

        {lab === undefined ? <Loading /> : !lab ? <Missing what="du laboratoire" /> : (
          <>
            {tab === 'notebook' && <Notebook lab={lab} onOpen={open} />}
            {tab === 'coaches' && <CoachesTab lab={lab} />}
            {tab === 'elevator' && <ElevatorTab lab={lab} images={images} />}
            {tab === 'goals' && <GoalsTab lab={lab} />}
            {tab === 'duos' && <DuosTab lab={lab} />}
            {tab === 'referees' && <RefereesTab lab={lab} />}
            {tab === 'squads' && <SquadsTab lab={lab} />}
          </>
        )}
      </div>
    </div>
  );
};

export default LabPage;
