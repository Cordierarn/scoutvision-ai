/**
 * ScoutVision AI - Loading Screen Component
 * Affiche l'écran de chargement pendant l'initialisation des données
 */

import React from 'react';
import { Database, Loader2 } from 'lucide-react';

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
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-8">
      {/* Logo */}
      <div className="mb-8">
        <div className="w-20 h-20 bg-emerald-500/10 rounded-2xl flex items-center justify-center border border-emerald-500/20 shadow-[0_0_60px_-15px_rgba(16,185,129,0.5)]">
          <Database className="w-10 h-10 text-emerald-400" />
        </div>
      </div>

      {/* Title */}
      <h1 className="text-3xl font-bold text-white mb-2 tracking-tight">ScoutVision AI</h1>
      <p className="text-slate-400 mb-8">Loading football intelligence...</p>

      {/* Progress Bar */}
      <div className="w-full max-w-md mb-6">
        <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
          <div 
            className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-500 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="flex justify-between mt-2">
          <span className="text-sm text-slate-500">{currentStep}</span>
          <span className="text-sm text-emerald-400 font-mono">{progress}%</span>
        </div>
      </div>

      {/* Loading Indicator */}
      <div className="flex items-center gap-2 text-slate-400 mb-8">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span className="text-sm">Initializing database...</span>
      </div>

      {/* Stats Preview (when available) */}
      {stats && (
        <div className="grid grid-cols-3 gap-4 mt-4">
          <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4 text-center">
            <div className="text-2xl font-bold text-emerald-400">{stats.playerCount.toLocaleString()}</div>
            <div className="text-xs text-slate-500 uppercase tracking-wider">Players</div>
          </div>
          <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4 text-center">
            <div className="text-2xl font-bold text-blue-400">{stats.teamCount.toLocaleString()}</div>
            <div className="text-xs text-slate-500 uppercase tracking-wider">Teams</div>
          </div>
          <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4 text-center">
            <div className="text-2xl font-bold text-purple-400">{stats.shotCount.toLocaleString()}</div>
            <div className="text-xs text-slate-500 uppercase tracking-wider">Shots</div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LoadingScreen;
