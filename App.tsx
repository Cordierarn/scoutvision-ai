
import React, { useState, useMemo, useEffect } from 'react';
import Layout from './components/Layout';
import LoadingScreen from './components/LoadingScreen';
import PlayerList from './components/PlayerList';
import PlayerCard from './components/PlayerCard';
import SimilarityFinder from './components/SimilarityFinder';
import PlayerComparison from './components/PlayerComparison';
import ScoutReport from './components/ScoutReport';
import TeamAnalysis from './components/TeamAnalysis';
import Prospects from './components/Prospects';
import { PlayerData, TeamStats, ShotEvent, ViewState } from './types';
import { dataLoader, LoadingState } from './services/dataLoader';

const App: React.FC = () => {
  // Loading state
  const [isLoading, setIsLoading] = useState(true);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingStep, setLoadingStep] = useState('Initializing...');
  const [loadError, setLoadError] = useState<string | null>(null);

  // Data state
  const [rawData, setRawData] = useState<PlayerData[]>([]);
  const [teamStats, setTeamStats] = useState<TeamStats[]>([]);
  const [shotEvents, setShotEvents] = useState<ShotEvent[]>([]);
  
  // App state
  const [view, setView] = useState<string>(ViewState.TEAM_ANALYSIS);
  const [selectedPlayer, setSelectedPlayer] = useState<PlayerData | null>(null);
  const [globalSeason, setGlobalSeason] = useState<string>('All');

  // Charger les données au démarrage
  useEffect(() => {
    const loadData = async () => {
      try {
        const result = await dataLoader.loadAllData((state: LoadingState) => {
          setLoadingProgress(state.progress);
          setLoadingStep(state.currentStep);
          if (state.error) {
            setLoadError(state.error);
          }
        });

        setRawData(result.players);
        setTeamStats(result.teams);
        setShotEvents(result.shots);
        setIsLoading(false);
        
      } catch (error) {
        console.error('Failed to load data:', error);
        setLoadError(error instanceof Error ? error.message : 'Unknown error');
        setIsLoading(false);
      }
    };

    loadData();
  }, []);

  const handleNavigate = (newView: string) => {
    setView(newView);
    if (newView !== ViewState.PLAYER_DETAIL) {
      setSelectedPlayer(null);
    }
  };

  const handleSelectPlayer = (player: PlayerData) => {
    setSelectedPlayer(player);
    setView(ViewState.PLAYER_DETAIL);
  };

  // Filtrage par saison
  const filteredData = useMemo(() => {
    if (rawData.length === 0) return [];
    if (globalSeason === 'All') return rawData;

    return rawData.filter(p => {
      const league = String(p.League || '');
      
      if (globalSeason === '24-25') {
        return league.includes('2024-25') || (league.endsWith(' 2024') && !league.includes('2024-25'));
      }
      
      if (globalSeason === '25-26') {
        return league.includes('2025-26') || (league.endsWith(' 2025') && !league.includes('2025-26'));
      }

      return true;
    });
  }, [rawData, globalSeason]);

  // Afficher l'écran de chargement
  if (isLoading) {
    return (
      <LoadingScreen 
        progress={loadingProgress} 
        currentStep={loadingStep}
      />
    );
  }

  // Afficher une erreur si le chargement a échoué
  if (loadError) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-8">
        <div className="text-red-400 text-xl mb-4">Failed to load data</div>
        <div className="text-slate-400 mb-8">{loadError}</div>
        <button 
          onClick={() => window.location.reload()}
          className="px-6 py-3 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <Layout 
      onNavigate={handleNavigate} 
      currentView={view}
      globalSeason={globalSeason}
      setGlobalSeason={setGlobalSeason}
      hasData={true}
    >
      {view === ViewState.TEAM_ANALYSIS && (
        <TeamAnalysis 
          playerData={filteredData} 
          teamStats={teamStats}
          shotEvents={shotEvents}
        />
      )}

      {view === ViewState.PROSPECTS && (
        <Prospects data={filteredData} onSelectPlayer={handleSelectPlayer} />
      )}

      {view === ViewState.DASHBOARD && (
        <PlayerList data={filteredData} onSelectPlayer={handleSelectPlayer} />
      )}

      {view === ViewState.SIMILARITY && (
        <SimilarityFinder data={filteredData} onSelectPlayer={handleSelectPlayer} />
      )}

      {view === ViewState.COMPARISON && (
        <PlayerComparison data={filteredData} />
      )}

      {view === ViewState.SCOUT_REPORT && (
        <ScoutReport 
          data={filteredData} 
          shotEvents={shotEvents}
        />
      )}
      
      {view === ViewState.PLAYER_DETAIL && selectedPlayer && (
        <PlayerCard 
          player={selectedPlayer} 
          onBack={() => setView(ViewState.DASHBOARD)}
          allPlayers={filteredData}
          shotEvents={shotEvents}
        />
      )}
    </Layout>
  );
};

export default App;
