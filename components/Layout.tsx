import React, { ReactNode, useState, useEffect } from 'react';
import { Users, Settings, GitCompare, ArrowLeftRight, ClipboardList, TrendingUp, Gem, Star, CalendarDays, FlaskConical, Scale, UserSearch, ChevronRight, LogOut } from 'lucide-react';
import { displayName, logout, useAuth } from '../services/authService';
import { getWatchlist } from '../services/storageService';
import { getSeasonLabel } from '../types';
import { BrandMark } from './Media';

interface LayoutProps {
  children: ReactNode;
  onNavigate: (view: string) => void;
  currentView: string;
  globalSeason?: string;
  setGlobalSeason?: (season: string) => void;
  seasonOptions?: string[];
  hasData?: boolean;
}

// Libellés du fil d'Ariane, par vue
const VIEW_LABELS: Record<string, string> = {
  TEAM_ANALYSIS: 'Analyse d\'équipe',
  RECRUITMENT: 'Recrutement',
  PROSPECTS: 'Chasseur de pépites',
  WATCHLIST: 'Liste de suivi',
  DASHBOARD: 'Base joueurs',
  SCOUT_REPORT: 'Rapports de scouting',
  SIMILARITY: 'Joueurs similaires',
  COMPARISON: 'Comparaison',
  FORECAST: 'Pronostics',
  LAB: 'Laboratoire',
  MARKET_LAB: 'Labo marché',
  PLAYER_DETAIL: 'Fiche joueur',
};

interface NavItem { view: string; label: string; icon: React.ElementType; also?: string[] }

// Navigation groupée par usage : joueurs, équipes, modèles, rapports
const NAV: { group: string; items: NavItem[] }[] = [
  {
    group: 'Joueurs',
    items: [
      { view: 'DASHBOARD', label: 'Base joueurs', icon: Users, also: ['PLAYER_DETAIL'] },
      { view: 'PROSPECTS', label: 'Chasseur de pépites', icon: Gem },
      { view: 'COMPARISON', label: 'Comparaison', icon: ArrowLeftRight },
      { view: 'SIMILARITY', label: 'Joueurs similaires', icon: GitCompare },
      { view: 'WATCHLIST', label: 'Liste de suivi', icon: Star },
    ],
  },
  {
    group: 'Équipes',
    items: [
      { view: 'TEAM_ANALYSIS', label: 'Analyse d\'équipe', icon: TrendingUp },
      { view: 'RECRUITMENT', label: 'Recrutement', icon: UserSearch },
    ],
  },
  {
    group: 'Modèles',
    items: [
      { view: 'FORECAST', label: 'Pronostics', icon: CalendarDays },
      { view: 'LAB', label: 'Laboratoire', icon: FlaskConical },
      { view: 'MARKET_LAB', label: 'Labo marché', icon: Scale },
    ],
  },
  {
    group: 'Rapports',
    items: [
      { view: 'SCOUT_REPORT', label: 'Rapports de scouting', icon: ClipboardList },
    ],
  },
];

const Layout: React.FC<LayoutProps> = ({ children, onNavigate, currentView, globalSeason, setGlobalSeason, seasonOptions = [], hasData }) => {
  const auth = useAuth();
  const [watchlistCount, setWatchlistCount] = useState(0);

  // Update watchlist count when view changes or periodically
  useEffect(() => {
    const updateCount = () => {
      setWatchlistCount(getWatchlist().length);
    };
    updateCount();

    // Listen for storage events to update count
    const handleStorage = () => updateCount();
    window.addEventListener('storage', handleStorage);

    // Also check when switching views
    const interval = setInterval(updateCount, 2000);

    return () => {
      window.removeEventListener('storage', handleStorage);
      clearInterval(interval);
    };
  }, [currentView]);

  return (
    <div className="flex h-screen bg-canvas text-ink-2 overflow-hidden">
      {/* Barre latérale : icônes seules sous 1024 px */}
      <aside className="w-14 lg:w-56 shrink-0 bg-surface border-r border-line flex flex-col">
        <div className="h-12 flex items-center justify-center lg:justify-start lg:px-4 gap-2.5 border-b border-line">
          <BrandMark className="w-[18px] h-[22px] shrink-0" />
          <span className="hidden lg:block text-[15px] font-semibold tracking-tight text-ink">
            Scout<span className="text-accent">Vision</span>
          </span>
        </div>

        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-4" aria-label="Navigation principale">
          {NAV.map(section => (
            <div key={section.group}>
              <div className="hidden lg:block px-2 mb-1 sv-label text-ink-4">{section.group}</div>
              <div className="space-y-px">
                {section.items.map(item => {
                  const active = currentView === item.view || item.also?.includes(currentView);
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.view}
                      onClick={() => onNavigate(item.view)}
                      title={item.label}
                      aria-current={active ? 'page' : undefined}
                      className={`relative w-full flex items-center justify-center lg:justify-start gap-2.5 h-8 px-2 rounded-md text-[13px] transition-colors ${
                        active ? 'bg-raised text-ink font-medium' : 'text-ink-3 hover:bg-raised/60 hover:text-ink'
                      }`}
                    >
                      {active && <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r bg-accent" aria-hidden />}
                      <span className="relative">
                        <Icon className={`w-4 h-4 ${active ? 'text-accent' : ''}`} />
                        {item.view === 'WATCHLIST' && watchlistCount > 0 && (
                          <span className="lg:hidden absolute -top-1.5 -right-2 min-w-[14px] h-[14px] px-0.5 bg-warn text-accent-ink text-[9px] font-bold rounded-sm flex items-center justify-center">
                            {watchlistCount > 9 ? '9+' : watchlistCount}
                          </span>
                        )}
                      </span>
                      <span className="hidden lg:block truncate">{item.label}</span>
                      {item.view === 'WATCHLIST' && watchlistCount > 0 && (
                        <span className="hidden lg:inline-flex ml-auto text-2xs num text-ink-3">{watchlistCount}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="p-2 border-t border-line">
          <button className="w-full flex items-center justify-center lg:justify-start gap-2.5 h-8 px-2 rounded-md text-[13px] text-ink-4 hover:text-ink-2 hover:bg-raised/60 transition-colors" title="Paramètres">
            <Settings className="w-4 h-4" />
            <span className="hidden lg:block">Paramètres</span>
          </button>
          {/* Session privée : utilisateur et déconnexion (absents en mode local ouvert) */}
          {auth.user && !auth.open && (
            <div className="mt-1 pt-1 border-t border-line lg:flex lg:items-center lg:gap-2">
              <span className="hidden lg:block flex-1 min-w-0 truncate px-2 text-[13px] text-ink-3">{displayName(auth.user)}</span>
              <button type="button" onClick={() => void logout()} title="Se déconnecter" aria-label="Se déconnecter"
                className="w-full lg:w-auto flex items-center justify-center lg:justify-start gap-2 h-8 px-2 rounded-md text-[13px] text-ink-4 hover:text-ink-2 hover:bg-raised/60 transition-colors">
                <LogOut className="w-4 h-4" aria-hidden />
                <span className="hidden lg:block whitespace-nowrap">Se déconnecter</span>
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* Contenu */}
      <main className="flex-1 min-w-0 flex flex-col h-full overflow-hidden relative">
         <header className="h-12 shrink-0 bg-canvas border-b border-line flex items-center justify-between gap-4 px-5 z-10">
            <nav className="flex items-center gap-1.5 text-[13px] min-w-0" aria-label="Fil d'Ariane">
              <span className="text-ink-4">ScoutVision</span>
              <ChevronRight className="w-3.5 h-3.5 text-ink-4 shrink-0" />
              <span className="text-ink font-medium truncate">{VIEW_LABELS[currentView] ?? currentView}</span>
            </nav>

            {/* Saison analysée, partagée par toutes les vues */}
            {hasData && setGlobalSeason && (
              <label className="flex items-center gap-2 shrink-0">
                <span className="sv-label hidden sm:inline">Saison</span>
                <select
                  value={globalSeason}
                  onChange={(e) => setGlobalSeason(e.target.value)}
                  className="sv-select sv-select-sm font-medium"
                >
                  {seasonOptions.map(season => (
                    <option key={season} value={season}>
                      {season === 'All' ? 'Toutes les saisons' : getSeasonLabel(season)}
                    </option>
                  ))}
                </select>
              </label>
            )}
         </header>

         <div className="flex-1 overflow-y-auto">
           {children}
         </div>
      </main>
    </div>
  );
};

export default Layout;
