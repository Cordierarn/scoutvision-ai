import React, { ReactNode } from 'react';
import { LayoutDashboard, Users, Settings, LogOut, Search, GitCompare, ArrowLeftRight, ClipboardList, TrendingUp, Gem, Calendar } from 'lucide-react';

interface LayoutProps {
  children: ReactNode;
  onNavigate: (view: string) => void;
  currentView: string;
  globalSeason?: string;
  setGlobalSeason?: (season: string) => void;
  hasData?: boolean;
}

const Layout: React.FC<LayoutProps> = ({ children, onNavigate, currentView, globalSeason, setGlobalSeason, hasData }) => {
  return (
    <div className="flex h-screen bg-slate-900 text-slate-100 overflow-hidden">
      {/* Sidebar */}
      <aside className="w-20 lg:w-64 bg-slate-950 border-r border-slate-800 flex flex-col transition-all duration-300">
        <div className="h-16 flex items-center justify-center lg:justify-start lg:px-6 border-b border-slate-800">
          <div className="w-8 h-8 bg-emerald-500 rounded-lg flex items-center justify-center mr-0 lg:mr-3 shadow-lg shadow-emerald-500/20">
            <Search className="text-slate-950 w-5 h-5" />
          </div>
          <span className="hidden lg:block font-bold text-xl tracking-tight">ScoutVision</span>
        </div>

        <nav className="flex-1 py-6 flex flex-col gap-2 px-3">
          <button 
             onClick={() => onNavigate('TEAM_ANALYSIS')}
             className={`flex items-center gap-3 px-3 py-3 rounded-xl transition-all ${currentView === 'TEAM_ANALYSIS' ? 'bg-emerald-500/10 text-emerald-400 font-medium' : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'}`}
          >
            <TrendingUp className="w-6 h-6" />
            <span className="hidden lg:block">Team Analysis</span>
          </button>

          <button 
             onClick={() => onNavigate('PROSPECTS')}
             className={`flex items-center gap-3 px-3 py-3 rounded-xl transition-all ${currentView === 'PROSPECTS' ? 'bg-emerald-500/10 text-emerald-400 font-medium' : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'}`}
          >
            <Gem className="w-6 h-6" />
            <span className="hidden lg:block">Gem Hunter</span>
          </button>

          <button 
            onClick={() => onNavigate('DASHBOARD')}
            className={`flex items-center gap-3 px-3 py-3 rounded-xl transition-all ${currentView === 'DASHBOARD' || currentView === 'PLAYER_DETAIL' ? 'bg-emerald-500/10 text-emerald-400 font-medium' : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'}`}
          >
            <Users className="w-6 h-6" />
            <span className="hidden lg:block">Players Database</span>
          </button>
          
          <button 
             onClick={() => onNavigate('SCOUT_REPORT')}
             className={`flex items-center gap-3 px-3 py-3 rounded-xl transition-all ${currentView === 'SCOUT_REPORT' ? 'bg-emerald-500/10 text-emerald-400 font-medium' : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'}`}
          >
            <ClipboardList className="w-6 h-6" />
            <span className="hidden lg:block">Scout Report</span>
          </button>
          
          <button 
             onClick={() => onNavigate('SIMILARITY')}
             className={`flex items-center gap-3 px-3 py-3 rounded-xl transition-all ${currentView === 'SIMILARITY' ? 'bg-emerald-500/10 text-emerald-400 font-medium' : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'}`}
          >
            <GitCompare className="w-6 h-6" />
            <span className="hidden lg:block">Similarity Engine</span>
          </button>

          <button 
             onClick={() => onNavigate('COMPARISON')}
             className={`flex items-center gap-3 px-3 py-3 rounded-xl transition-all ${currentView === 'COMPARISON' ? 'bg-emerald-500/10 text-emerald-400 font-medium' : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'}`}
          >
            <ArrowLeftRight className="w-6 h-6" />
            <span className="hidden lg:block">Player Comparison</span>
          </button>
        </nav>

        <div className="p-4 border-t border-slate-800">
          <button className="flex items-center gap-3 px-3 py-2 text-slate-500 hover:text-slate-300 transition-colors w-full">
            <Settings className="w-5 h-5" />
            <span className="hidden lg:block text-sm">Settings</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-full overflow-hidden relative">
         {/* Top Header */}
         <header className="h-16 bg-slate-900/50 backdrop-blur-md border-b border-slate-800 flex items-center justify-between px-8 z-10">
            <div className="text-sm breadcrumbs text-slate-400">
              <span className="text-slate-500">App</span> / <span className="text-slate-200 font-medium capitalize">{currentView.toLowerCase().replace('_', ' ')}</span>
            </div>
            
            <div className="flex items-center gap-6">
               
               {/* Global Season Selector */}
               {hasData && setGlobalSeason && (
                   <div className="flex items-center gap-3 bg-slate-800 rounded-lg p-1 pr-3 border border-slate-700">
                      <div className="bg-slate-700 p-1.5 rounded-md">
                         <Calendar className="w-4 h-4 text-emerald-400" />
                      </div>
                      <select 
                        value={globalSeason}
                        onChange={(e) => setGlobalSeason(e.target.value)}
                        className="bg-transparent border-none text-sm text-white font-medium focus:ring-0 cursor-pointer p-0"
                      >
                         <option value="25-26">Season 25/26</option>
                         <option value="24-25">Season 24/25</option>
                         <option value="All">All Seasons</option>
                      </select>
                   </div>
               )}

               <div className="flex items-center gap-4">
                  <div className="w-8 h-8 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-xs font-bold text-emerald-400">
                    JD
                  </div>
               </div>
            </div>
         </header>

         {/* Scrollable Content Area */}
         <div className="flex-1 overflow-y-auto p-4 lg:p-0 scroll-smooth">
           {children}
         </div>
      </main>
    </div>
  );
};

export default Layout;