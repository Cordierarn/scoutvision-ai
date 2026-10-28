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
import { PageHeader } from '../ui';
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
      <div className="p-5 space-y-4 max-w-[96rem] mx-auto">
        <PageHeader
          title="Laboratoire"
          icon={FlaskConical}
          description="Des idées testées sur les données match par match (compositions, buts, momentum, réseaux de passes, entraîneurs, arbitres). Chaque idée a un verdict chiffré : les idées reçues démenties comptent autant que les découvertes, et un résultat n'est pas une vérité définitive."
          meta={lab ? `Calculé le ${new Date(lab.generatedAt).toLocaleDateString('fr-FR')} sur ${lab.matches.toLocaleString('fr-FR')} matchs` : undefined}
        />

        <div className="sv-tabs" role="tablist">
          {TABS.map(t => (
            <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => open(t.key)}
              className={`sv-tab ${tab === t.key ? 'sv-tab-on' : ''}`}>
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
