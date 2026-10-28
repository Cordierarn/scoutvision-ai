/**
 * ScoutVision AI - Loading Screen Component
 * Affiche l'écran de chargement pendant l'initialisation des données
 */

import React from 'react';
import { BrandMark } from './Media';

interface LoadingScreenProps {
  progress: number;
  currentStep: string;
  stats?: {
    playerCount: number;
    teamCount: number;
    shotCount: number;
  };
}

const LoadingScreen: React.FC<LoadingScreenProps> = ({ progress, currentStep, stats }) => {
  return (
    <div className="h-screen bg-canvas flex flex-col items-center justify-center p-8">
      <div className="w-full max-w-xs">
        <div className="flex items-center gap-3 mb-8">
          <BrandMark className="w-6 h-7" />
          <div>
            <div className="text-base font-semibold text-ink tracking-tight">Scout<span className="text-accent">Vision</span></div>
            <div className="text-2xs text-ink-3">Football data · modèles statistiques · recrutement</div>
          </div>
        </div>

        <div className="h-0.5 bg-raised overflow-hidden">
          <div
            className="h-full bg-accent transition-all duration-500 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="flex justify-between mt-2 text-2xs">
          <span className="text-ink-3 truncate">{currentStep}</span>
          <span className="text-ink-2 num">{progress}%</span>
        </div>

        {stats && (
          <div className="grid grid-cols-3 gap-px mt-8 bg-line border border-line rounded-md overflow-hidden">
            {[['Joueurs', stats.playerCount], ['Équipes', stats.teamCount], ['Tirs', stats.shotCount]].map(([label, value]) => (
              <div key={label} className="bg-surface px-3 py-2">
                <div className="sv-label">{label}</div>
                <div className="text-sm font-semibold text-ink num">{Number(value).toLocaleString('fr-FR')}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default LoadingScreen;
