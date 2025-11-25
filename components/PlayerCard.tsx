
import React, { useState, useMemo, useRef } from 'react';
import { PlayerData, ShotEvent, extractSeason, getSeasonColor } from '../types';
import { ArrowLeft, Sparkles, Trophy, Target, Activity, MapPin, Footprints, Ruler, FileText, Download, Share2, Settings2, X, Check, Search, Plus, Award, ChevronRight, Layout, Crosshair } from 'lucide-react';
import { ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, Tooltip, Legend } from 'recharts';
import { generateScoutReport } from '../services/geminiService';
import { getBestRoles } from '../utils/scoringUtils';
import ReactMarkdown from 'react-markdown';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

interface PlayerCardProps {
  player: PlayerData;
  onBack: () => void;
  allPlayers: PlayerData[];
  shotEvents: ShotEvent[];
}

type ComparisonMode = 'all' | 'position' | 'team' | 'league';

const DEFAULT_METRICS = [
  'Goals', 'xG', 'Assists', 'xA', 'Passes per 90', 
  'Accurate passes, %', 'Successful defensive actions per 90', 'Duels won, %'
];

// Coordinate mapping for the positional pitch view
// All values are percentages { top, left }
const POS_COORDS: Record<string, { top: string, left: string }> = {
    // Goalkeeper
    'GK': { top: '90%', left: '50%' },
    
    // Defenders
    'CB': { top: '80%', left: '50%' },
    'LCB': { top: '80%', left: '35%' },
    'RCB': { top: '80%', left: '65%' },
    'LB': { top: '75%', left: '15%' },
    'RB': { top: '75%', left: '85%' },
    'LWB': { top: '65%', left: '10%' },
    'RWB': { top: '65%', left: '90%' },
    
    // Midfielders
    'DMF': { top: '65%', left: '50%' },
    'LDMF': { top: '65%', left: '40%' },
    'RDMF': { top: '65%', left: '60%' },
    'CMF': { top: '50%', left: '50%' },
    'LCMF': { top: '50%', left: '35%' },
    'RCMF': { top: '50%', left: '65%' },
    'AMF': { top: '35%', left: '50%' },
    'LAMF': { top: '35%', left: '35%' },
    'RAMF': { top: '35%', left: '65%' },
    
    // Forwards
    'LW': { top: '25%', left: '15%' },
    'LWF': { top: '25%', left: '15%' },
    'RW': { top: '25%', left: '85%' },
    'RWF': { top: '25%', left: '85%' },
    'SS': { top: '25%', left: '50%' },
    'CF': { top: '15%', left: '50%' },
    'ST': { top: '15%', left: '50%' }
};

const PlayerCard: React.FC<PlayerCardProps> = ({ player, onBack, allPlayers, shotEvents }) => {
  const [report, setReport] = useState<string | null>(null);
  const [loadingReport, setLoadingReport] = useState(false);
  const [comparisonMode, setComparisonMode] = useState<ComparisonMode>('position');
  const [isExporting, setIsExporting] = useState(false);
  
  // Custom Metric Config State
  const [activeMetrics, setActiveMetrics] = useState<string[]>(DEFAULT_METRICS);
  const [showMetricConfig, setShowMetricConfig] = useState(false);
  const [metricSearch, setMetricSearch] = useState('');
  
  const printRef = useRef<HTMLDivElement>(null);

  // Available Numeric Keys
  const availableMetrics = useMemo(() => {
    if (!player) return [];
    return Object.keys(player).filter(key => 
      typeof player[key] === 'number' && 
      !['Age', 'Market value', 'Height', 'Weight', 'Matches played', 'Minutes played'].includes(key)
    ).sort();
  }, [player]);

  // Calculate Best Roles (US-09)
  const bestRoles = useMemo(() => {
    return getBestRoles(player, allPlayers);
  }, [player, allPlayers]);

  // Parse Positions for Pitch Visualization
  const positionAnalysis = useMemo(() => {
     const raw = player.Position || "";
     const parts = raw.split(',').map(s => s.trim());
     return {
         primary: parts[0],
         secondary: parts.slice(1)
     };
  }, [player]);

  // Shot Map Data
  const playerShots = useMemo(() => {
    if (!shotEvents) return [];
    return shotEvents.filter(s => s.player === player.Player);
  }, [shotEvents, player]);

  const shotStats = useMemo(() => {
    const total = playerShots.length;
    const goals = playerShots.filter(s => s.result === 'Goal').length;
    const xG = playerShots.reduce((acc, curr) => acc + curr.xG, 0);
    return { total, goals, xG };
  }, [playerShots]);

  const toggleMetric = (key: string) => {
    if (activeMetrics.includes(key)) {
        setActiveMetrics(activeMetrics.filter(m => m !== key));
    } else {
        if (activeMetrics.length < 12) {
            setActiveMetrics([...activeMetrics, key]);
        }
    }
  };

  // Filter cohort based on selected mode
  const cohort = useMemo(() => {
    return allPlayers.filter(p => {
      if (comparisonMode === 'position') return p.Position === player.Position;
      if (comparisonMode === 'team') return p.Team === player.Team;
      if (comparisonMode === 'league') return p.League === player.League;
      return true; // 'all'
    });
  }, [allPlayers, player, comparisonMode]);

  const chartData = useMemo(() => {
    return activeMetrics.map(key => {
      const val = Number(player[key]) || 0;
      
      // Calculate Percentile Rank within Cohort
      const values = cohort.map(p => Number(p[key]) || 0).sort((a, b) => a - b);
      const countBelow = values.filter(v => v < val).length;
      const countEqual = values.filter(v => v === val).length;
      
      // Rank calculation: (Below + 0.5 * Equal) / Total * 100
      let percentile = 50;
      if (values.length > 1) {
          percentile = Math.round(((countBelow + (0.5 * countEqual)) / values.length) * 100);
      } else if (values.length === 1) {
          percentile = 100;
      }

      // Dynamic label creation
      const label = key.length > 15 ? key.substring(0, 12) + '..' : key;

      return {
        subject: label,
        fullSubject: key,
        A: percentile,
        fullMark: 100,
        rawValue: val,
        cohortSize: values.length
      };
    });
  }, [player, cohort, activeMetrics]);

  const handleGenerateReport = async () => {
    setLoadingReport(true);
    const text = await generateScoutReport(player);
    setReport(text);
    setLoadingReport(false);
  };

  const handleExportPDF = async () => {
    if (!printRef.current) return;
    setIsExporting(true);

    try {
      const element = printRef.current;
      const canvas = await html2canvas(element, {
        scale: 2, // Higher resolution
        useCORS: true,
        backgroundColor: '#0f172a', // Match theme background
        logging: false,
      });

      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4',
      });

      const imgWidth = 210; // A4 width in mm
      const pageHeight = 297; // A4 height in mm
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      let heightLeft = imgHeight;
      let position = 0;

      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;

      // Handle multi-page content if the report is long
      while (heightLeft >= 0) {
        position = heightLeft - imgHeight;
        pdf.addPage();
        pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;
      }

      pdf.save(`${player.Player}_ScoutReport.pdf`);
    } catch (error) {
      console.error('PDF Export failed:', error);
      alert('Failed to export PDF');
    } finally {
      setIsExporting(false);
    }
  };

  const formatCurrency = (val: number) => {
      if (val >= 1000000) return `€${(val / 1000000).toFixed(1)}M`;
      if (val >= 1000) return `€${(val / 1000).toFixed(0)}K`;
      return `€${val}`;
  };

  const getRoleColor = (score: number) => {
      if (score >= 90) return 'bg-emerald-500';
      if (score >= 80) return 'bg-emerald-400';
      if (score >= 70) return 'bg-yellow-400';
      return 'bg-slate-500';
  };

  return (
    <div className="flex flex-col gap-6 animate-fade-in pb-10">
      <div className="flex items-center justify-between">
        <button 
            onClick={onBack}
            className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors"
        >
            <ArrowLeft className="w-4 h-4" /> Back to list
        </button>

        <button
            onClick={handleExportPDF}
            disabled={isExporting}
            className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-white px-4 py-2 rounded-lg transition-all border border-slate-700 hover:border-emerald-500 shadow-lg"
        >
            {isExporting ? (
                <span className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin"></span>
            ) : (
                <Download className="w-4 h-4 text-emerald-400" />
            )}
            <span>{isExporting ? 'Exporting...' : 'Export PDF'}</span>
        </button>
      </div>

      {/* Printable Area Wrapper */}
      <div ref={printRef} className="flex flex-col gap-6 bg-slate-900 p-4 -m-4 rounded-3xl"> 

      {/* Header Card */}
      <div className="bg-gradient-to-r from-slate-950 to-slate-900 rounded-3xl p-6 lg:p-10 border border-slate-800 relative overflow-hidden shadow-2xl">
         {/* Background Decoration */}
         <div className="absolute top-0 right-0 w-96 h-96 bg-emerald-500/5 rounded-full blur-3xl -mr-20 -mt-20 pointer-events-none"></div>
         
         <div className="flex flex-col md:flex-row gap-8 items-start relative z-10">
            {(() => {
              const playerSeason = extractSeason(player.League);
              const seasonColors = getSeasonColor(playerSeason);
              return (
                <div className="relative">
                  <div className="w-32 h-32 lg:w-40 lg:h-40 bg-slate-800 rounded-2xl flex items-center justify-center shadow-2xl border-2 border-emerald-500/30 text-slate-300">
                     <span className="text-4xl font-bold">{(player.Player || '??').substring(0, 2).toUpperCase()}</span>
                  </div>
                  <div className={`absolute -bottom-2 -right-2 px-3 py-1 rounded-lg text-sm font-bold ${seasonColors.bg} ${seasonColors.text} border ${seasonColors.border} shadow-lg`}>
                    {playerSeason}
                  </div>
                </div>
              );
            })()}
            
            <div className="flex-1 w-full">
               <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
                  <div>
                    <h1 className="text-4xl lg:text-5xl font-bold text-white tracking-tight mb-2">{player.Player}</h1>
                    <div className="flex items-center gap-4 text-slate-300">
                        <span className="flex items-center gap-1 bg-slate-800/50 px-3 py-1 rounded-full border border-slate-700"><Trophy className="w-3.5 h-3.5 text-emerald-400"/> {player.Team}</span>
                        <span className="flex items-center gap-1 bg-slate-800/50 px-3 py-1 rounded-full border border-slate-700"><MapPin className="w-3.5 h-3.5 text-emerald-400"/> {player["Passport country"] || 'Unknown'}</span>
                    </div>
                  </div>
                  <div className="text-right p-4 bg-emerald-500/10 rounded-2xl border border-emerald-500/20 backdrop-blur-sm">
                     <div className="text-xs text-emerald-300 uppercase tracking-wider font-bold mb-1">Market Value</div>
                     <div className="text-3xl font-mono text-white font-bold tracking-tighter">
                        {typeof player["Market value"] === 'number' ? formatCurrency(player["Market value"]) : 'N/A'}
                     </div>
                  </div>
               </div>

               <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-8">
                  <div className="bg-slate-900 p-4 rounded-xl border border-slate-800">
                     <div className="text-xs text-slate-500 mb-1 flex items-center gap-1 uppercase font-semibold"><Ruler className="w-3 h-3"/> Height</div>
                     <div className="text-lg font-bold text-slate-200">{player.Height} <span className="text-xs text-slate-500 font-normal">cm</span></div>
                  </div>
                   <div className="bg-slate-900 p-4 rounded-xl border border-slate-800">
                     <div className="text-xs text-slate-500 mb-1 flex items-center gap-1 uppercase font-semibold"><Activity className="w-3 h-3"/> Weight</div>
                     <div className="text-lg font-bold text-slate-200">{player.Weight} <span className="text-xs text-slate-500 font-normal">kg</span></div>
                  </div>
                   <div className="bg-slate-900 p-4 rounded-xl border border-slate-800">
                     <div className="text-xs text-slate-500 mb-1 flex items-center gap-1 uppercase font-semibold"><Footprints className="w-3 h-3"/> Foot</div>
                     <div className="text-lg font-bold text-slate-200">{player.Foot}</div>
                  </div>
                  <div className="bg-slate-900 p-4 rounded-xl border border-slate-800">
                     <div className="text-xs text-slate-500 mb-1 flex items-center gap-1 uppercase font-semibold"><Target className="w-3 h-3"/> Age</div>
                     <div className="text-lg font-bold text-slate-200">{player.Age} <span className="text-xs text-slate-500 font-normal">yrs</span></div>
                  </div>
               </div>
            </div>
         </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Column: Charts */}
        <div className="lg:col-span-1 flex flex-col gap-6">
            
            {/* Radar Chart */}
            <div className="bg-slate-950 border border-slate-800 rounded-3xl p-6 shadow-xl flex flex-col relative overflow-hidden group">
                <div className="flex items-center justify-between mb-2 relative z-10">
                    <h3 className="text-lg font-bold text-white flex items-center gap-2">
                        <Activity className="w-5 h-5 text-emerald-500" /> Performance Profile
                    </h3>
                    <div className="flex items-center gap-2">
                        <button 
                            onClick={() => setShowMetricConfig(!showMetricConfig)}
                            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors border border-transparent hover:border-slate-700"
                            title="Configure Metrics"
                        >
                            <Settings2 className="w-4 h-4" />
                        </button>
                        <div className="text-xs font-medium px-2 py-1 rounded bg-slate-900 text-slate-400 border border-slate-800">
                            vs {comparisonMode}
                        </div>
                    </div>
                </div>

                {/* Metric Configuration Overlay */}
                {showMetricConfig && (
                    <div className="absolute inset-0 z-50 bg-slate-950/95 backdrop-blur-sm p-4 flex flex-col animate-fade-in">
                        <div className="flex items-center justify-between mb-4 border-b border-slate-800 pb-2">
                            <h4 className="text-sm font-bold text-white">Select Metrics</h4>
                            <button onClick={() => setShowMetricConfig(false)} className="text-slate-400 hover:text-white">
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        
                        <div className="relative mb-3">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                            <input 
                                type="text" 
                                placeholder="Search..." 
                                className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-9 pr-3 py-2 text-xs text-white"
                                value={metricSearch}
                                onChange={(e) => setMetricSearch(e.target.value)}
                            />
                        </div>

                        <div className="flex-1 overflow-y-auto custom-scrollbar space-y-1">
                            {availableMetrics
                                .filter(k => k.toLowerCase().includes(metricSearch.toLowerCase()))
                                .map(key => (
                                    <button
                                        key={key}
                                        onClick={() => toggleMetric(key)}
                                        className={`w-full text-left px-3 py-2 rounded-lg text-xs flex items-center justify-between ${
                                            activeMetrics.includes(key) 
                                            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30' 
                                            : 'hover:bg-slate-900 text-slate-400'
                                        }`}
                                    >
                                        <span className="truncate pr-2">{key}</span>
                                        {activeMetrics.includes(key) && <Check className="w-3 h-3 shrink-0" />}
                                    </button>
                                ))
                            }
                        </div>
                        
                        <div className="mt-4 pt-2 border-t border-slate-800 text-center">
                            <span className="text-[10px] text-slate-500">{activeMetrics.length} / 12 metrics selected</span>
                        </div>
                    </div>
                )}

                {/* Comparison Controls */}
                <div className="bg-slate-900 rounded-lg p-1 flex items-center justify-between border border-slate-800 mb-6 relative z-10">
                    {(['position', 'team', 'league'] as ComparisonMode[]).map(mode => (
                        <button
                            key={mode}
                            onClick={() => setComparisonMode(mode)}
                            className={`flex-1 py-1.5 text-[10px] uppercase font-bold tracking-wider rounded-md transition-all ${
                                comparisonMode === mode 
                                ? 'bg-emerald-500 text-slate-950 shadow-sm' 
                                : 'text-slate-500 hover:text-slate-300'
                            }`}
                        >
                            {mode}
                        </button>
                    ))}
                </div>

                <div className="flex-1 min-h-[350px] w-full relative -ml-2">
                    <ResponsiveContainer width="100%" height="100%">
                        <RadarChart cx="50%" cy="50%" outerRadius="75%" data={chartData} margin={{ top: 30, right: 30, bottom: 30, left: 30 }}>
                            <defs>
                                <linearGradient id="radarFill" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.5}/>
                                    <stop offset="95%" stopColor="#10b981" stopOpacity={0.1}/>
                                </linearGradient>
                            </defs>
                            
                            {/* Styled Polar Grid */}
                            <PolarGrid 
                                gridType="polygon" 
                                stroke="#334155" 
                                strokeWidth={1} 
                                strokeDasharray="4 4" 
                            />
                            
                            {/* Enhanced Labels */}
                            <PolarAngleAxis 
                                dataKey="subject" 
                                tick={{ fill: '#f8fafc', fontSize: 11, fontWeight: 600, dy: 3 }} 
                            />
                            
                            {/* Clean Radius Axis */}
                            <PolarRadiusAxis 
                                angle={90} 
                                domain={[0, 100]} 
                                tickCount={6} 
                                tick={false} 
                                axisLine={false} 
                            />

                            {/* The Radar Shape */}
                            <Radar
                                name={player.Player}
                                dataKey="A"
                                stroke="#10b981"
                                strokeWidth={3}
                                fill="url(#radarFill)"
                                fillOpacity={1}
                                activeDot={{ r: 6, strokeWidth: 0, fill: '#fff' }}
                            />
                            
                            <Tooltip 
                                contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '0.5rem', color: '#f8fafc', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.5)' }}
                                itemStyle={{ color: '#10b981', fontWeight: 'bold' }}
                                labelStyle={{ color: '#94a3b8', marginBottom: '0.25rem', fontSize: '12px', textTransform: 'uppercase' }}
                                formatter={(value: number, name: string, props: any) => [`${value} (Raw: ${props.payload.rawValue})`, 'Percentile Rank']}
                            />
                        </RadarChart>
                    </ResponsiveContainer>
                </div>
                
                <div className="mt-2 text-center">
                    <p className="text-[10px] text-slate-500 uppercase tracking-widest">Cohort Size: {cohort.length} players</p>
                </div>
            </div>

            {/* Positional Map (Mini Pitch) */}
            <div className="bg-slate-950 border border-slate-800 rounded-3xl p-6 shadow-xl">
                 <h3 className="text-lg font-bold text-white flex items-center gap-2 mb-4">
                     <Layout className="w-5 h-5 text-emerald-400" /> Positional Versatility
                 </h3>
                 <div className="relative w-full aspect-[2/3] bg-emerald-900/30 rounded-xl border border-white/10 overflow-hidden">
                     {/* Pitch Lines */}
                     <div className="absolute inset-4 border border-white/20 rounded-lg"></div>
                     <div className="absolute top-1/2 left-0 right-0 h-px bg-white/20"></div>
                     <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-16 h-16 rounded-full border border-white/20"></div>
                     <div className="absolute top-4 left-1/2 -translate-x-1/2 w-20 h-10 border-b border-x border-white/20 rounded-b-sm"></div>
                     <div className="absolute bottom-4 left-1/2 -translate-x-1/2 w-20 h-10 border-t border-x border-white/20 rounded-t-sm"></div>

                     {/* Primary Position */}
                     {POS_COORDS[positionAnalysis.primary] && (
                        <div 
                            className="absolute transform -translate-x-1/2 -translate-y-1/2 flex flex-col items-center z-20"
                            style={{ top: POS_COORDS[positionAnalysis.primary].top, left: POS_COORDS[positionAnalysis.primary].left }}
                        >
                            <div className="w-6 h-6 rounded-full bg-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.5)] border-2 border-white animate-pulse"></div>
                            <span className="mt-1 px-2 py-0.5 bg-slate-950/80 rounded text-[10px] font-bold text-white">{positionAnalysis.primary}</span>
                        </div>
                     )}

                     {/* Secondary Positions */}
                     {positionAnalysis.secondary.map(pos => {
                        const coords = POS_COORDS[pos];
                        if (!coords) return null;
                        return (
                            <div 
                                key={pos}
                                className="absolute transform -translate-x-1/2 -translate-y-1/2 flex flex-col items-center z-10"
                                style={{ top: coords.top, left: coords.left }}
                            >
                                <div className="w-3 h-3 rounded-full bg-yellow-400 border border-slate-900"></div>
                                <span className="mt-1 px-1.5 py-0.5 bg-slate-950/80 rounded text-[9px] font-semibold text-slate-300">{pos}</span>
                            </div>
                        );
                     })}
                 </div>
                 <div className="mt-4 flex justify-center gap-4 text-xs">
                     <div className="flex items-center gap-2">
                         <div className="w-3 h-3 rounded-full bg-emerald-500 border border-white"></div>
                         <span className="text-slate-400">Primary</span>
                     </div>
                     <div className="flex items-center gap-2">
                         <div className="w-2 h-2 rounded-full bg-yellow-400 border border-slate-900"></div>
                         <span className="text-slate-400">Secondary</span>
                     </div>
                 </div>
            </div>

            {/* US-09: Suggested Roles */}
            <div className="bg-slate-950 border border-slate-800 rounded-3xl p-6 shadow-xl break-inside-avoid">
                 <h3 className="text-lg font-bold text-white flex items-center gap-2 mb-4">
                     <Award className="w-5 h-5 text-purple-400" /> Best Tactical Fit
                 </h3>
                 <p className="text-xs text-slate-500 mb-4">
                    Based on normalized data analysis across all leagues. Recommended for repositioning.
                 </p>
                 <div className="space-y-3">
                     {bestRoles.map((role, idx) => (
                         <div key={role.role} className="relative overflow-hidden bg-slate-900 rounded-xl p-3 border border-slate-800">
                             {/* Progress Bar Background */}
                             <div 
                                className={`absolute left-0 top-0 bottom-0 opacity-10 ${getRoleColor(role.normalizedScore)}`} 
                                style={{ width: `${role.normalizedScore}%` }}
                             ></div>
                             
                             <div className="flex justify-between items-center relative z-10">
                                 <div className="flex items-center gap-3">
                                     <div className="text-xs font-bold text-slate-600 w-4">{idx + 1}</div>
                                     <span className="font-semibold text-slate-200 text-sm">{role.role}</span>
                                 </div>
                                 <div className="flex items-center gap-2">
                                     <div className={`text-sm font-bold px-2 py-0.5 rounded text-slate-950 ${getRoleColor(role.normalizedScore)}`}>
                                         {role.normalizedScore}
                                     </div>
                                 </div>
                             </div>
                         </div>
                     ))}
                 </div>
            </div>
        </div>

        {/* Right Column: AI Scout Report & Shot Map */}
        <div className="lg:col-span-2 flex flex-col gap-6">
            
            {/* AI Scout Report */}
            <div className="bg-slate-950 border border-slate-800 rounded-3xl p-8 shadow-xl flex flex-col">
                <div className="flex items-center justify-between mb-6 pb-6 border-b border-slate-800">
                    <h3 className="text-xl font-bold text-white flex items-center gap-3">
                        <FileText className="w-6 h-6 text-purple-400" /> 
                        <span>AI Scout Analysis</span>
                    </h3>
                    {!report && (
                        <button 
                        onClick={handleGenerateReport}
                        disabled={loadingReport}
                        className="px-5 py-2.5 bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white rounded-xl text-sm font-bold transition-all disabled:opacity-50 flex items-center gap-2 shadow-lg shadow-emerald-500/20 hover:shadow-emerald-500/40"
                    >
                        {loadingReport ? (
                            <>
                                <span className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin"></span>
                                Analyzing Data...
                            </>
                        ) : (
                            <>
                                <Sparkles className="w-4 h-4" />
                                Generate Full Report
                            </>
                        )}
                    </button>
                    )}
                </div>

                <div className="flex-1 bg-slate-900/30 rounded-2xl p-2 md:p-6 overflow-y-auto max-h-[600px] min-h-[400px]">
                    {report ? (
                        <div className="prose prose-invert prose-sm md:prose-base max-w-none">
                            <ReactMarkdown 
                                components={{
                                    h1: ({node, ...props}) => <h1 className="text-2xl font-bold text-white mb-4" {...props} />,
                                    h2: ({node, ...props}) => <h2 className="text-xl font-bold text-emerald-400 mt-8 mb-4 flex items-center gap-2" {...props} />,
                                    h3: ({node, ...props}) => <div className="text-sm font-bold text-slate-500 uppercase tracking-widest mt-6 mb-3 border-b border-slate-800 pb-2" {...props} />,
                                    strong: ({node, ...props}) => <strong className="text-white font-bold bg-slate-800/50 px-1 rounded" {...props} />,
                                    ul: ({node, ...props}) => <ul className="space-y-3 my-4 pl-0" {...props} />,
                                    li: ({node, ...props}) => <li className="flex items-start gap-3 text-slate-300 bg-slate-900/50 p-3 rounded-lg border border-slate-800/50 hover:border-slate-700 transition-colors" {...props} />,
                                    p: ({node, ...props}) => <p className="leading-relaxed text-slate-300 mb-4" {...props} />
                                }}
                            >
                                {report}
                            </ReactMarkdown>
                            
                            <div className="mt-8 pt-6 border-t border-slate-800 flex items-center justify-between text-xs text-slate-500">
                                <span>Generated by Gemini 2.5 Flash</span>
                                <span>{new Date().toLocaleDateString()}</span>
                            </div>
                        </div>
                    ) : (
                        <div className="h-full flex flex-col items-center justify-center text-slate-500 gap-8 py-10">
                            <div className="relative group cursor-pointer" onClick={handleGenerateReport}>
                                <div className="absolute inset-0 bg-emerald-500/20 blur-2xl rounded-full group-hover:bg-emerald-500/30 transition-all duration-500"></div>
                                <div className="w-24 h-24 rounded-3xl bg-slate-800 border-2 border-slate-700 group-hover:border-emerald-500 flex items-center justify-center relative z-10 transition-all duration-300 shadow-2xl">
                                    <Sparkles className="w-10 h-10 text-emerald-500 group-hover:scale-110 transition-transform" />
                                </div>
                            </div>
                            <div className="text-center max-w-sm space-y-3">
                                <h4 className="text-white font-bold text-lg">Detailed Scouting Report</h4>
                                <p className="text-sm leading-relaxed">
                                    Uses advanced LLM analysis to interpret stats into football language.
                                    <br/>Includes: <span className="text-emerald-400">Tactical Role</span>, <span className="text-emerald-400">Strength Profiling</span>, and <span className="text-emerald-400">Future Projection</span>.
                                </p>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* US-11: Player Shot Map Visualization */}
            <div className="bg-slate-950 border border-slate-800 rounded-3xl p-8 shadow-xl flex flex-col">
                <div className="flex items-center justify-between mb-6 pb-6 border-b border-slate-800">
                    <h3 className="text-xl font-bold text-white flex items-center gap-3">
                        <Crosshair className="w-6 h-6 text-red-400" /> 
                        <span>Season Shot Map</span>
                    </h3>
                    <div className="flex gap-4">
                        <div className="text-center">
                            <div className="text-[10px] uppercase text-slate-500 font-bold">Goals</div>
                            <div className="text-lg font-bold text-emerald-400">{shotStats.goals}</div>
                        </div>
                        <div className="text-center">
                            <div className="text-[10px] uppercase text-slate-500 font-bold">xG</div>
                            <div className="text-lg font-bold text-blue-400">{shotStats.xG.toFixed(2)}</div>
                        </div>
                        <div className="text-center">
                            <div className="text-[10px] uppercase text-slate-500 font-bold">Shots</div>
                            <div className="text-lg font-bold text-white">{shotStats.total}</div>
                        </div>
                    </div>
                </div>

                <div className="bg-[#1a2c2c] rounded-2xl p-4 border border-slate-800/50 relative min-h-[400px] flex items-center justify-center overflow-hidden">
                     {/* Horizontal Pitch Container */}
                     <div className="relative w-full aspect-[105/68] max-w-[600px] bg-emerald-900/30 border-2 border-white/30 rounded-lg shadow-2xl">
                        {/* Pitch Markings */}
                        <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/grass.png')] opacity-30"></div>
                        <div className="absolute top-1/2 left-0 w-full h-px bg-white/20 -translate-y-1/2"></div> {/* Halfway Line */}
                        <div className="absolute right-0 top-1/4 bottom-1/4 w-px bg-white/20"></div> {/* Penalty Area Line */}
                        <div className="absolute right-0 top-[40%] bottom-[40%] w-[5%] border border-white/20 bg-emerald-800/50"></div> {/* 6 yard box */}
                        <div className="absolute left-0 top-0 bottom-0 w-1 bg-white/50"></div> {/* Goal Line Own */}
                        <div className="absolute right-0 top-0 bottom-0 w-1 bg-white/50"></div> {/* Goal Line Opp */}
                        <div className="absolute left-1/2 top-1/2 w-16 h-16 border border-white/20 rounded-full -translate-x-1/2 -translate-y-1/2"></div>
                        <div className="absolute right-[11%] top-1/2 w-1 h-1 bg-white rounded-full"></div> {/* Penalty Spot */}

                        {/* Plots */}
                        {playerShots.length > 0 ? playerShots.map((shot, i) => {
                            const isGoal = shot.result === 'Goal';
                            const color = isGoal ? '#10b981' : shot.result === 'SavedShot' ? '#3b82f6' : '#ef4444';
                            // Normalize size
                            const size = Math.max(6, Math.min(20, shot.xG * 30));

                            return (
                                <div 
                                    key={i}
                                    className="absolute rounded-full border border-black/20 hover:scale-150 transition-transform cursor-pointer shadow-sm z-10 group"
                                    style={{
                                        left: `${shot.X * 100}%`,
                                        top: `${shot.Y * 100}%`,
                                        width: `${size}px`,
                                        height: `${size}px`,
                                        backgroundColor: color,
                                        opacity: 0.8,
                                        transform: 'translate(-50%, -50%)'
                                    }}
                                >
                                    {isGoal && <div className="absolute inset-0 border border-white rounded-full animate-pulse"></div>}
                                    
                                    {/* Tooltip */}
                                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-32 bg-slate-900/90 text-[10px] text-white p-2 rounded hidden group-hover:block z-50 pointer-events-none">
                                        <div className="font-bold">{shot.result}</div>
                                        <div>xG: {shot.xG.toFixed(2)}</div>
                                        <div>Min: {shot.minute}'</div>
                                        <div>Type: {shot.shotType}</div>
                                    </div>
                                </div>
                            );
                        }) : (
                            <div className="absolute inset-0 flex items-center justify-center">
                                <span className="text-white/30 text-sm font-medium">No shot data available for this player.</span>
                            </div>
                        )}
                    </div>
                </div>
                 {/* Legend */}
                 <div className="mt-4 flex justify-center gap-6">
                    <div className="flex items-center gap-2 text-xs text-slate-400">
                        <div className="w-3 h-3 rounded-full bg-emerald-500"></div> Goal
                    </div>
                    <div className="flex items-center gap-2 text-xs text-slate-400">
                        <div className="w-3 h-3 rounded-full bg-blue-500"></div> Saved
                    </div>
                    <div className="flex items-center gap-2 text-xs text-slate-400">
                        <div className="w-3 h-3 rounded-full bg-red-500"></div> Missed/Blocked
                    </div>
                 </div>
            </div>

        </div>
      </div>
      
      {/* Detailed Stat Grid (Compact for Print) */}
      <div className="bg-slate-950 border border-slate-800 rounded-3xl p-8 shadow-xl break-inside-avoid">
          <h3 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
             <Share2 className="w-5 h-5 text-emerald-500" /> Complete Metrics
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {Object.entries(player).map(([key, value]) => {
                if (['Player','Team','Position','Passport country', 'League', 'Foot', 'Height', 'Weight'].includes(key) || typeof value === 'object') return null;
                return (
                    <div key={key} className="bg-slate-900/50 p-3 rounded-xl border border-slate-800 hover:border-slate-700 transition-colors">
                        <div className="text-[10px] text-slate-500 uppercase font-semibold truncate mb-1" title={key}>{key}</div>
                        <div className="text-sm font-mono text-slate-200 font-bold">
                            {typeof value === 'number' ? value.toLocaleString(undefined, { maximumFractionDigits: 2 }) : value}
                        </div>
                    </div>
                );
            })}
          </div>
      </div>

      </div> {/* End Print Ref */}
    </div>
  );
};

export default PlayerCard;
