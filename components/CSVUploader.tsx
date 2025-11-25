
import React, { useState } from 'react';
import { Upload, FileText, AlertCircle, Play, CheckCircle, Database, Info } from 'lucide-react';
import { parseCSV, autoParseCSV, generateDummyData, generateDummyTeamStats } from '../utils/csvParser';
import { PlayerData, TeamStats, ShotEvent } from '../types';

interface CSVUploaderProps {
  onDataLoaded: (type: 'players' | 'teams' | 'shots', data: any[]) => void;
}

const CSVUploader: React.FC<CSVUploaderProps> = ({ onDataLoaded }) => {
  const [statuses, setStatuses] = useState({
    players: { count: 0, error: null as string | null },
    teams: { count: 0, error: null as string | null },
    shots: { count: 0, error: null as string | null }
  });
  const [autoDetect, setAutoDetect] = useState(true);

  const processFile = (file: File, type: 'players' | 'teams' | 'shots') => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        
        // Auto-detection ou parsing spécifique
        if (autoDetect) {
          const result = autoParseCSV(text);
          if (result && result.type !== 'unknown') {
            const detectedType = result.type as 'players' | 'teams' | 'shots';
            onDataLoaded(detectedType, result.data);
            setStatuses(prev => ({
                ...prev, 
                [detectedType]: { count: result.data.length, error: null }
            }));
            return;
          }
        }
        
        // Fallback: parse standard
        const data = parseCSV(text);
        
        if (data.length === 0) {
            setStatuses(prev => ({...prev, [type]: { ...prev[type], error: "No valid data found." }}));
        } else {
            onDataLoaded(type, data);
            setStatuses(prev => ({
                ...prev, 
                [type]: { count: data.length, error: null }
            }));
        }
      } catch (err) {
        console.error('CSV Parse error:', err);
        setStatuses(prev => ({...prev, [type]: { ...prev[type], error: "Failed to parse CSV." }}));
      }
    };
    reader.readAsText(file);
  };

  const handleDrop = (e: React.DragEvent, type: 'players' | 'teams' | 'shots') => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processFile(e.dataTransfer.files[0], type);
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>, type: 'players' | 'teams' | 'shots') => {
    if (e.target.files && e.target.files[0]) {
      processFile(e.target.files[0], type);
    }
  };

  const loadDemoData = () => {
    const players = generateDummyData();
    const teams = generateDummyTeamStats();
    onDataLoaded('players', players);
    onDataLoaded('teams', teams);
    setStatuses(prev => ({ 
      ...prev, 
      players: { count: players.length, error: null },
      teams: { count: teams.length, error: null }
    }));
  };

  const totalLoaded = statuses.players.count + statuses.teams.count + statuses.shots.count;

  const UploadZone = ({ type, title, desc, status }: { type: 'players' | 'teams' | 'shots', title: string, desc: string, status: any }) => (
    <div 
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => handleDrop(e, type)}
        className={`relative flex-1 p-6 border-2 border-dashed rounded-2xl flex flex-col items-center justify-center transition-all duration-300 group cursor-pointer overflow-hidden min-h-[200px] ${status.count > 0 ? 'border-emerald-500 bg-emerald-500/10' : 'border-slate-700 bg-slate-900/50 hover:border-emerald-500/50 hover:bg-slate-800'}`}
    >
        <input 
           type="file" 
           accept=".csv" 
           onChange={(e) => handleFileInput(e, type)}
           className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" 
        />
        
        {status.count > 0 ? (
            <>
                <div className="w-12 h-12 bg-emerald-500 rounded-full flex items-center justify-center mb-4 shadow-lg animate-bounce">
                    <CheckCircle className="w-6 h-6 text-white" />
                </div>
                <h3 className="text-lg font-bold text-white mb-1">Loaded!</h3>
                <p className="text-emerald-400 text-sm font-medium">{status.count} records</p>
            </>
        ) : (
            <>
                <div className="w-12 h-12 bg-slate-800 rounded-xl flex items-center justify-center mb-4 shadow-lg group-hover:scale-110 transition-transform duration-300">
                    <Upload className="w-6 h-6 text-slate-400 group-hover:text-emerald-400" />
                </div>
                <h3 className="text-lg font-bold text-slate-200 mb-1">{title}</h3>
                <p className="text-slate-500 text-xs text-center px-4">{desc}</p>
            </>
        )}
        
        {status.error && (
            <div className="absolute bottom-4 flex items-center gap-1 text-rose-400 bg-rose-950/50 px-3 py-1 rounded-full text-xs">
                <AlertCircle className="w-3 h-3" />
                <span>{status.error}</span>
            </div>
        )}
    </div>
  );

  return (
    <div className="flex flex-col items-center justify-center h-full max-w-6xl mx-auto animate-fade-in p-6">
      <div className="text-center mb-10">
        <h1 className="text-4xl font-bold text-white mb-3 tracking-tight">ScoutVision Data Hub</h1>
        <p className="text-slate-400 text-lg">Upload your Wyscout/Instat exports to power the analysis engine.</p>
      </div>
      
      {/* Auto-detect toggle */}
      <div className="flex items-center gap-3 mb-6 bg-slate-900 px-4 py-2 rounded-lg border border-slate-700">
        <Info className="w-4 h-4 text-blue-400" />
        <span className="text-sm text-slate-300">Auto-detect CSV type</span>
        <button
          onClick={() => setAutoDetect(!autoDetect)}
          className={`relative w-10 h-5 rounded-full transition-colors ${autoDetect ? 'bg-emerald-500' : 'bg-slate-700'}`}
        >
          <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${autoDetect ? 'translate-x-5' : ''}`}></div>
        </button>
      </div>

      <div className="flex flex-col md:flex-row gap-6 w-full mb-8">
        <UploadZone 
            type="players" 
            title="1. Player Stats" 
            desc="Individual season metrics (Goals, xG, Actions) - Wyscout Export" 
            status={statuses.players}
        />
        <UploadZone 
            type="teams" 
            title="2. Team Stats" 
            desc="Aggregated team data (Goals/90, Possession) - FBRef style" 
            status={statuses.teams}
        />
        <UploadZone 
            type="shots" 
            title="3. Shot Events" 
            desc="Match event data with X,Y coordinates - Understat/FB style" 
            status={statuses.shots}
        />
      </div>
      
      {/* Summary */}
      {totalLoaded > 0 && (
        <div className="w-full max-w-md mb-6 bg-slate-900 border border-slate-700 rounded-xl p-4">
          <div className="flex items-center gap-3">
            <Database className="w-5 h-5 text-emerald-400" />
            <div className="flex-1">
              <div className="text-sm font-medium text-white">Data Loaded</div>
              <div className="text-xs text-slate-500">
                {statuses.players.count > 0 && `${statuses.players.count} players`}
                {statuses.teams.count > 0 && ` • ${statuses.teams.count} teams`}
                {statuses.shots.count > 0 && ` • ${statuses.shots.count} shots`}
              </div>
            </div>
            <CheckCircle className="w-5 h-5 text-emerald-400" />
          </div>
        </div>
      )}

      <div className="flex items-center gap-4 w-full max-w-md">
        <div className="h-px bg-slate-800 flex-1"></div>
        <span className="text-slate-600 text-sm font-medium uppercase tracking-wider">Or</span>
        <div className="h-px bg-slate-800 flex-1"></div>
      </div>

      <button 
        onClick={loadDemoData}
        className="mt-6 flex items-center gap-3 px-6 py-3 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl font-medium transition-all hover:ring-2 hover:ring-emerald-500/50"
      >
        <Play className="w-4 h-4 text-emerald-400" />
        Load Demo Data (Players + Teams)
      </button>
      
      {/* Help text */}
      <div className="mt-8 text-center text-xs text-slate-600 max-w-lg">
        <p className="mb-2">Supported formats: Wyscout League Export, FBRef Team Stats, Understat Shot Data</p>
        <p>Files should be in CSV format. The system will auto-detect column mappings.</p>
      </div>
    </div>
  );
};

export default CSVUploader;
