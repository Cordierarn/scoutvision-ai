/**
 * ScoutVision - Recrutement : entonnoir déterministe de la recherche (comptes réels, aucune
 * estimation), exclusions faute de donnée à part
 */

import React from 'react';
import { ArrowRight } from 'lucide-react';
import { CandidateFunnel } from '../../utils/recruitment';
import { InfoTip } from '../ui';
import { INTEGER } from './shared';

const FunnelLine: React.FC<{ funnel: CandidateFunnel; hasMarket: boolean; className?: string }> = ({ funnel: f, hasMarket, className = '' }) => {
  const steps: [number, string][] = [
    [f.pool, 'joueurs'],
    [f.position, 'au poste'],
    [f.minutes, 'minutes'],
    [f.age, 'âge'],
    [f.leagues, 'championnats'],
    ...(hasMarket ? [[f.budget, 'budget'], [f.contract, 'contrat']] as [number, string][] : []),
    [f.projectable, 'projetables'],
  ];
  const excluded: [number, string, string][] = ([
    [f.insufficientData, 'données insuffisantes', 'Aucune métrique du rôle renseignée : indice non projetable. Ce n\'est pas un indice nul.'],
    [f.valueUnknown, 'valeur inconnue', 'Sans valeur Transfermarkt connue : exclus tant qu\'un budget est fixé (« garder les valeurs inconnues » les réintègre).'],
    [f.contractUnknown, 'contrat inconnu', 'Sans date de fin de contrat connue : exclus tant qu\'une échéance est fixée.'],
    [f.ageUnknown, 'âge inconnu', 'Sans âge connu : exclus quand la tranche d\'âge est restreinte.'],
    [f.modelUnavailable, 'modèle indisponible', 'Le filtre « niveau inférieur » demande le modèle de transfert, absent.'],
  ] as [number, string, string][]).filter(([n]) => n > 0);
  return (
    <div className={`text-xs text-ink-3 ${className}`}>
      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1" aria-label="Entonnoir de sélection">
        {steps.map(([n, label], i) => (
          <React.Fragment key={label}>
            {i > 0 && <ArrowRight className="w-3 h-3 text-ink-4" aria-hidden />}
            <span className="whitespace-nowrap"><span className={`num font-semibold ${i === steps.length - 1 ? 'text-accent' : 'text-ink-2'}`}>{INTEGER.format(n)}</span> {label}</span>
          </React.Fragment>
        ))}
      </p>
      {excluded.length > 0 && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-2xs">
          <span className="text-ink-4">Exclus faute de donnée :</span>
          {excluded.map(([n, label, tip]) => (
            <span key={label} className="inline-flex items-center gap-1"><span className="num text-ink-2">{INTEGER.format(n)}</span> {label} <InfoTip text={tip} /></span>
          ))}
        </p>
      )}
    </div>
  );
};

export default FunnelLine;
