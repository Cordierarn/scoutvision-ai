import React, { useState, useEffect } from 'react';
import Layout from './components/Layout';
import LoadingScreen from './components/LoadingScreen';
import PlayerList from './components/PlayerList';
import PlayerCard from './components/PlayerCard';
import SimilarityFinder from './components/SimilarityFinder';
import PlayerComparison from './components/PlayerComparison';
import ScoutReport from './components/ScoutReport';
import TeamAnalysis from './components/TeamAnalysis';
import Prospects from './components/Prospects';
import Watchlist from './components/Watchlist';
import Forecast from './components/Forecast';
import LabPage from './components/lab/LabPage';
import { PlayerData, TeamStats, ViewState, getPlayerSeasonId } from './types';
import { dataLoader, DataIndex, LoadingState } from './services/dataLoader';
import { queryService } from './services/queryService';

const ALL_SEASONS = 'All';

const App: React.FC = () => {
  // Loading state
  const [isLoading, setIsLoading] = useState(true);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingStep, setLoadingStep] = useState('Initialisation...');
  const [loadError, setLoadError] = useState<string | null>(null);

  // Data state
  const [dataIndex, setDataIndex] = useState<DataIndex | null>(null);
  const [players, setPlayers] = useState<PlayerData[]>([]);
  const [teamStats, setTeamStats] = useState<TeamStats[]>([]);

  // App state
  const [view, setView] = useState<string>(ViewState.TEAM_ANALYSIS);
  const [selectedPlayer, setSelectedPlayer] = useState<PlayerData | null>(null);
  const [returnView, setReturnView] = useState<string>(ViewState.DASHBOARD);
  const [globalSeason, setGlobalSeason] = useState<string>('');

  // Charger l'index puis la saison la plus récente
  useEffect(() => {
    dataLoader.loadIndex()
      .then(index => {
        if (index.seasons.length === 0) {
          throw new Error('Aucune saison disponible. Lancez d\'abord npm run data:pull ou scripts/prepare_data.py.');
        }
        setDataIndex(index);
        setGlobalSeason(index.seasons[index.seasons.length - 1].id);
      })
      .catch(error => {
        console.error('Failed to load data index:', error);
        setLoadError(error instanceof Error ? error.message : 'Erreur inconnue');
        setIsLoading(false);
      });
  }, []);

  // Charger les données de la saison sélectionnée
  useEffect(() => {
    if (!dataIndex || !globalSeason) return;
    let cancelled = false;

    const seasons = globalSeason === ALL_SEASONS
      ? dataIndex.seasons.map(s => s.id)
      : [globalSeason];

    setIsLoading(true);
    dataLoader.loadSeasons(seasons, (state: LoadingState) => {
      if (cancelled) return;
      setLoadingProgress(state.progress);
      setLoadingStep(state.currentStep);
    })
      .then(data => {
        if (cancelled) return;
        queryService.initialize(data.players, data.teams);
        setPlayers(data.players);
        setTeamStats(data.teams);
        setSelectedPlayer(null);
        setIsLoading(false);
      })
      .catch(error => {
        if (cancelled) return;
        console.error('Failed to load season data:', error);
        setLoadError(error instanceof Error ? error.message : 'Erreur inconnue');
        setIsLoading(false);
      });

    return () => { cancelled = true; };
  }, [dataIndex, globalSeason]);

  const handleNavigate = (newView: string) => {
    setView(newView);
    if (newView !== ViewState.PLAYER_DETAIL) {
      setSelectedPlayer(null);
    }
  };

  const handleSelectPlayer = (player: PlayerData) => {
    setSelectedPlayer(player);
    if (view !== ViewState.PLAYER_DETAIL) setReturnView(view);
    setView(ViewState.PLAYER_DETAIL);
  };

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
      <div className="h-screen bg-canvas flex flex-col items-center justify-center p-8 text-center">
        <div className="text-ink font-semibold mb-2">Échec du chargement des données</div>
        <div className="text-sm text-ink-3 mb-6 max-w-lg">{loadError}</div>
        <button
          onClick={() => window.location.reload()}
          className="sv-btn sv-btn-primary"
        >
          Réessayer
        </button>
      </div>
    );
  }

  const seasonOptions = [
    ...(dataIndex?.seasons.map(s => s.id).reverse() ?? []),
    ALL_SEASONS,
  ];

  return (
    <Layout
      onNavigate={handleNavigate}
      currentView={view}
      globalSeason={globalSeason}
      setGlobalSeason={setGlobalSeason}
      seasonOptions={seasonOptions}
      hasData={true}
    >
      {view === ViewState.TEAM_ANALYSIS && (
        <TeamAnalysis
          key="team"
          playerData={players}
          teamStats={teamStats}
          onSelectPlayer={handleSelectPlayer}
        />
      )}

      {/* Recrutement : l'analyse d'équipe ouverte sur son onglet de recrutement */}
      {view === ViewState.RECRUITMENT && (
        <TeamAnalysis
          key="recruitment"
          initialTab="RECRUIT"
          playerData={players}
          teamStats={teamStats}
          onSelectPlayer={handleSelectPlayer}
        />
      )}

      {view === ViewState.PROSPECTS && (
        <Prospects
          data={players}
          onSelectPlayer={handleSelectPlayer}
          selectedId={selectedPlayer ? getPlayerSeasonId(selectedPlayer) : undefined}
        />
      )}

      {view === ViewState.FORECAST && <Forecast />}

      {view === ViewState.LAB && <LabPage playerData={players} />}

      {view === ViewState.WATCHLIST && (
        <Watchlist onSelectPlayer={handleSelectPlayer} />
      )}

      {view === ViewState.DASHBOARD && (
        <PlayerList
          data={players}
          onSelectPlayer={handleSelectPlayer}
          selectedId={selectedPlayer ? getPlayerSeasonId(selectedPlayer) : undefined}
        />
      )}

      {view === ViewState.SIMILARITY && (
        <SimilarityFinder data={players} onSelectPlayer={handleSelectPlayer} />
      )}

      {view === ViewState.COMPARISON && (
        <PlayerComparison data={players} />
      )}

      {view === ViewState.SCOUT_REPORT && (
        <ScoutReport data={players} />
      )}

      {view === ViewState.PLAYER_DETAIL && selectedPlayer && (
        <PlayerCard
          player={selectedPlayer}
          onBack={() => setView(returnView)}
          allPlayers={players}
        />
      )}
    </Layout>
  );
};

export default App;
