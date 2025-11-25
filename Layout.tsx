import React, { ReactNode } from 'react';
import { LayoutDashboard, Users, Settings, LogOut, Search, GitCompare, ArrowLeftRight, ClipboardList, TrendingUp, Calendar, ChevronDown, Gem } from 'lucide-react';

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
    <div className="flex h-screen bg-[#0B1120] text-slate-100 overflow-hidden font-sans selection:bg-emerald-500/30">
      {/* Background Gradients */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-emerald-500/5 blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-blue-600/5 blur-[120px]" />
      </div>

      {/* Sidebar */}
      <aside className="w-20 lg:w-72 bg-slate-950/80 backdrop-blur-xl border-r border-slate-800/50 flex flex-col transition-all duration-300 z-20 relative">
        <div className="h-20 flex items-center justify-center lg:justify-start lg:px-6 border-b border-slate-800/50">
          <div className="w-10 h-10 bg-gradient-to-br from-emerald-400 to-emerald-600 rounded-xl flex items-center justify-center mr-0 lg:mr-4 shadow-lg shadow-emerald-500/20 ring-1 ring-white/10">
            <Search className="text-slate-950 w-6 h-6" />
          </div>
          <div className="hidden lg:flex flex-col">
            <span className="font-bold text-xl tracking-tight text-white">ScoutVision</span>
            <span className="text-[10px] uppercase tracking-widest text-emerald-500 font-semibold">AI Powered</span>
          </div>
        </div>

        <nav className="flex-1 py-8 flex flex-col gap-2 px-4 overflow-y-auto custom-scrollbar">
          <div className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 px-2 hidden lg:block">Analytics</div>
          
          <NavItem 
            active={currentView === 'TEAM_ANALYSIS'} 
            onClick={() => onNavigate('TEAM_ANALYSIS')} 
            icon={<TrendingUp className="w-5 h-5" />} 
            label="Team Analysis" 
          />

          <NavItem 
            active={currentView === 'PROSPECTS'} 
            onClick={() => onNavigate('PROSPECTS')} 
            icon={<Gem className="w-5 h-5" />} 
            label="Gem Hunter" 
          />

          <div className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 mt-6 px-2 hidden lg:block">Database</div>

          <NavItem 
            active={currentView === 'DASHBOARD' || currentView === 'PLAYER_DETAIL'} 
            onClick={() => onNavigate('DASHBOARD')} 
            icon={<Users className="w-5 h-5" />} 
            label="Players Database" 
          />
          
          <NavItem 
            active={currentView === 'SCOUT_REPORT'} 
            onClick={() => onNavigate('SCOUT_REPORT')} 
            icon={<ClipboardList className="w-5 h-5" />} 
            label="Scout Report" 
          />
          
          <div className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 mt-6 px-2 hidden lg:block">Tools</div>

          <NavItem 
            active={currentView === 'SIMILARITY'} 
            onClick={() => onNavigate('SIMILARITY')} 
            icon={<GitCompare className="w-5 h-5" />} 
            label="Similarity Engine" 
          />

          <NavItem 
            active={currentView === 'COMPARISON'} 
            onClick={() => onNavigate('COMPARISON')} 
            icon={<ArrowLeftRight className="w-5 h-5" />} 
            label="Player Comparison" 
          />
        </nav>

        <div className="p-4 border-t border-slate-800/50 bg-slate-900/30">
          <button className="flex items-center gap-3 px-3 py-3 text-slate-400 hover:text-white hover:bg-white/5 rounded-xl transition-all w-full group">
            <Settings className="w-5 h-5 group-hover:rotate-90 transition-transform duration-500" />
            <span className="hidden lg:block text-sm font-medium">Settings</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-full overflow-hidden relative z-10">
         {/* Top Header */}
         <header className="h-20 bg-slate-900/50 backdrop-blur-md border-b border-slate-800/50 flex items-center justify-between px-8 z-10 transition-all">
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2 text-sm text-slate-400">
                <span className="hover:text-emerald-400 transition-colors cursor-pointer">App</span> 
                <span className="text-slate-600">/</span> 
                <span className="text-slate-200 font-medium capitalize">{currentView.toLowerCase().replace('_', ' ')}</span>
              </div>
              <h2 className="text-xl font-bold text-white hidden md:block capitalize tracking-tight">
                {currentView.toLowerCase().replace('_', ' ')}
              </h2>
            </div>

            <div className="flex items-center gap-6">
               {/* Season Selector */}
               {setGlobalSeason && (
                 <div className="hidden md:flex items-center bg-slate-800/50 rounded-lg p-1 border border-slate-700/50">
                    {['All', '24-25', '25-26'].map(season => (
                      <button
                        key={season}
                        onClick={() => setGlobalSeason(season)}
                        className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all ${
                          globalSeason === season 
                            ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20' 
                            : 'text-slate-400 hover:text-white hover:bg-white/5'
                        }`}
                      >
                        {season}
                      </button>
                    ))}
                 </div>
               )}

               <div className="h-8 w-px bg-slate-800 hidden md:block"></div>

               <div className="flex items-center gap-3 pl-2">
                  <div className="text-right hidden md:block">
                    <div className="text-sm font-bold text-white">Head Scout</div>
                    <div className="text-xs text-emerald-400">Pro License</div>
                  </div>
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-slate-700 to-slate-800 border border-slate-600 flex items-center justify-center text-sm font-bold text-white shadow-lg ring-2 ring-slate-800">
                    HS
                  </div>
               </div>
            </div>
         </header>

         {/* Scrollable Content Area */}
         <div className="flex-1 overflow-y-auto p-6 scroll-smooth custom-scrollbar">
           <div className="max-w-[1600px] mx-auto h-full">
             {children}
           </div>
         </div>
      </main>
    </div>
  );
};

// Helper Component for Nav Items
const NavItem = ({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: ReactNode, label: string }) => (
  <button 
    onClick={onClick}
    className={`group flex items-center gap-3 px-4 py-3.5 rounded-xl transition-all duration-200 relative overflow-hidden ${
      active 
        ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/25' 
        : 'text-slate-400 hover:bg-white/5 hover:text-white'
    }`}
  >
    {active && (
      <div className="absolute left-0 top-0 bottom-0 w-1 bg-white/20"></div>
    )}
    <span className={`transition-transform duration-200 ${active ? 'scale-110' : 'group-hover:scale-110'}`}>
      {icon}
    </span>
    <span className="hidden lg:block font-medium tracking-wide text-sm">{label}</span>
    {active && (
      <div className="absolute right-4 w-1.5 h-1.5 rounded-full bg-white shadow-[0_0_10px_rgba(255,255,255,0.8)] hidden lg:block"></div>
    )}
  </button>
);

export default Layout;