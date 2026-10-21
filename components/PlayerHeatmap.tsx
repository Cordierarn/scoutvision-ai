/**
 * ScoutVision AI - Carte de chaleur d'un joueur
 * Actions cumulées sur la saison (table heatmap PitchAPI, grille 16 x 12),
 * dessinées sur un terrain vertical : l'équipe du joueur attaque vers le haut.
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Flame } from 'lucide-react';
import { PlayerData, getPlayerSeason } from '../types';
import { dataLoader, PlayerHeatmap as HeatmapData } from '../services/dataLoader';

interface PlayerHeatmapProps {
  player: PlayerData;
}

// Terrain vertical en mètres : largeur 68, longueur 105
const PITCH_W = 68;
const PITCH_H = 105;

// Rampe séquentielle à une teinte (bleu), du plus faible au plus fort.
// Sur fond sombre l'intensité monte vers le clair ; une case vide reste transparente.
const RAMP = ['#104281', '#184f95', '#1c5cab', '#256abf', '#2a78d6', '#3987e5',
  '#5598e7', '#6da7ec', '#86b6ef', '#9ec5f4', '#b7d3f6', '#cde2fb'];

const hexToRgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));

/**
 * Couleur RGBA d'une intensité t (0-1)
 */
function rampColor(t: number): string {
  if (t <= 0) return 'rgba(0,0,0,0)';
  const pos = t * (RAMP.length - 1);
  const i = Math.min(Math.floor(pos), RAMP.length - 2);
  const f = pos - i;
  const a = hexToRgb(RAMP[i]);
  const b = hexToRgb(RAMP[i + 1]);
  const [r, g, bl] = a.map((v, k) => Math.round(v + (b[k] - v) * f));
  // L'opacité suit l'intensité : les zones peu fréquentées s'effacent dans le terrain
  return `rgba(${r},${g},${bl},${Math.min(0.95, 0.05 + 0.95 * t).toFixed(2)})`;
}

const THIRDS = ['Tiers défensif', 'Milieu de terrain', 'Tiers offensif'];
const CHANNELS = ['Couloir droit', 'Axe', 'Couloir gauche'];

const PlayerHeatmap: React.FC<PlayerHeatmapProps> = ({ player }) => {
  const [heatmap, setHeatmap] = useState<{ cols: number; rows: number; data: HeatmapData } | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing'>('loading');
  const [hover, setHover] = useState<{ x: number; y: number; left: number; top: number } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Chargement de la carte du joueur (fichier de sa compétition, mis en cache)
  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setHeatmap(null);
    const season = getPlayerSeason(player);
    if (!player.Competition || !player['Player ID']) {
      setStatus('missing');
      return;
    }
    dataLoader.loadHeatmaps(season, player.Competition)
      .then(file => {
        if (cancelled) return;
        const data = file?.players[`${player['Player ID']}_${player['Team ID']}`];
        if (file && data) {
          setHeatmap({ cols: file.cols, rows: file.rows, data });
          setStatus('ready');
        } else {
          setStatus('missing');
        }
      })
      .catch(() => { if (!cancelled) setStatus('missing'); });
    return () => { cancelled = true; };
  }, [player]);

  const stats = useMemo(() => {
    if (!heatmap) return null;
    const { cols, rows, data } = heatmap;
    const total = data.grid.reduce((a, b) => a + b, 0);
    const max = Math.max(...data.grid, 1);
    const thirds = [0, 0, 0];
    const channels = [0, 0, 0];
    data.grid.forEach((v, i) => {
      const x = i % cols;
      const y = Math.floor(i / cols);
      thirds[Math.min(2, Math.floor(((x + 0.5) / cols) * 3))] += v;
      channels[Math.min(2, Math.floor(((y + 0.5) / rows) * 3))] += v;
    });
    return { total, max, thirds, channels };
  }, [heatmap]);

  // Dessin : grille basse résolution agrandie avec lissage et léger flou
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !heatmap || !stats) return;
    const { cols, rows, data } = heatmap;

    // Grille verticale : colonne = couloir (cell_y 0, droite de l'attaquant, à droite),
    // ligne = profondeur (cell_x 15, but adverse, en haut)
    const small = document.createElement('canvas');
    small.width = rows;
    small.height = cols;
    const sctx = small.getContext('2d')!;
    data.grid.forEach((v, i) => {
      const x = i % cols;
      const y = Math.floor(i / cols);
      sctx.fillStyle = rampColor(v / stats.max);
      sctx.fillRect(rows - 1 - y, cols - 1 - x, 1, 1);
    });

    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.filter = `blur(${Math.round(canvas.width / 60)}px)`;
    ctx.drawImage(small, 0, 0, canvas.width, canvas.height);
    ctx.filter = 'none';
  }, [heatmap, stats]);

  const handleMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!heatmap) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const col = Math.floor(((e.clientX - rect.left) / rect.width) * heatmap.rows);
    const row = Math.floor(((e.clientY - rect.top) / rect.height) * heatmap.cols);
    if (col < 0 || row < 0 || col >= heatmap.rows || row >= heatmap.cols) {
      setHover(null);
      return;
    }
    setHover({
      x: heatmap.cols - 1 - row,
      y: heatmap.rows - 1 - col,
      left: e.clientX - rect.left,
      top: e.clientY - rect.top,
    });
  };

  const pct = (v: number) => (stats && stats.total > 0 ? Math.round((v / stats.total) * 100) : 0);

  const hoverInfo = useMemo(() => {
    if (!hover || !heatmap || !stats) return null;
    const value = heatmap.data.grid[hover.y * heatmap.cols + hover.x];
    const third = THIRDS[Math.min(2, Math.floor(((hover.x + 0.5) / heatmap.cols) * 3))];
    const channel = CHANNELS[Math.min(2, Math.floor(((hover.y + 0.5) / heatmap.rows) * 3))];
    return { value, label: `${third} · ${channel}`, share: stats.total > 0 ? (value / stats.total) * 100 : 0 };
  }, [hover, heatmap, stats]);

  return (
    <div className="bg-slate-950 border border-slate-800 rounded-3xl p-6 shadow-xl break-inside-avoid">
      <h3 className="text-lg font-bold text-white flex items-center gap-2 mb-1">
        <Flame className="w-5 h-5 text-blue-400" /> Carte de chaleur
      </h3>
      <p className="text-xs text-slate-500 mb-4">
        {status === 'ready' && stats
          ? `${stats.total.toLocaleString('fr-FR')} actions · ${heatmap!.data.matches} matchs · ${player.Season}`
          : 'Zones d\'action du joueur sur la saison'}
      </p>

      {status === 'loading' && (
        <div className="w-full aspect-[68/105] rounded-xl bg-slate-900 animate-pulse" />
      )}

      {status === 'missing' && (
        <div className="w-full aspect-[68/105] rounded-xl bg-slate-900 border border-dashed border-slate-800 flex flex-col items-center justify-center text-center p-6">
          <Flame className="w-8 h-8 text-slate-700 mb-3" />
          <p className="text-sm text-slate-400">Pas de carte de chaleur pour cette saison</p>
          <p className="text-xs text-slate-600 mt-1">Elle n'existe que pour les matchs couverts par les statistiques avancées de PitchAPI.</p>
        </div>
      )}

      {status === 'ready' && stats && (
        <>
          <div
            className="relative w-full aspect-[68/105] rounded-xl overflow-hidden bg-slate-900 cursor-crosshair"
            onMouseMove={handleMove}
            onMouseLeave={() => setHover(null)}
            role="img"
            aria-label={`Carte de chaleur : ${THIRDS.map((t, i) => `${t} ${pct(stats.thirds[i])}%`).join(', ')}`}
          >
            <canvas ref={canvasRef} width={340} height={525} className="absolute inset-0 w-full h-full" />

            {/* Lignes du terrain */}
            <svg viewBox={`0 0 ${PITCH_W} ${PITCH_H}`} className="absolute inset-0 w-full h-full pointer-events-none" fill="none" stroke="rgba(148,163,184,0.45)" strokeWidth="0.35">
              <rect x="0.5" y="0.5" width={PITCH_W - 1} height={PITCH_H - 1} />
              <line x1="0.5" y1={PITCH_H / 2} x2={PITCH_W - 0.5} y2={PITCH_H / 2} />
              <circle cx={PITCH_W / 2} cy={PITCH_H / 2} r="9.15" />
              <circle cx={PITCH_W / 2} cy={PITCH_H / 2} r="0.5" fill="rgba(148,163,184,0.45)" />
              {/* Surfaces de réparation et de but, en haut (but adverse) et en bas */}
              <rect x={(PITCH_W - 40.32) / 2} y="0.5" width="40.32" height="16.5" />
              <rect x={(PITCH_W - 18.32) / 2} y="0.5" width="18.32" height="5.5" />
              <rect x={(PITCH_W - 40.32) / 2} y={PITCH_H - 17} width="40.32" height="16.5" />
              <rect x={(PITCH_W - 18.32) / 2} y={PITCH_H - 6} width="18.32" height="5.5" />
              <path d={`M ${PITCH_W / 2 - 7.3} 17 A 9.15 9.15 0 0 0 ${PITCH_W / 2 + 7.3} 17`} />
              <path d={`M ${PITCH_W / 2 - 7.3} ${PITCH_H - 17} A 9.15 9.15 0 0 1 ${PITCH_W / 2 + 7.3} ${PITCH_H - 17}`} />
            </svg>

            {/* Case survolée */}
            {hover && (
              <div
                className="absolute border border-white/70 pointer-events-none"
                style={{
                  left: `${((heatmap!.rows - 1 - hover.y) / heatmap!.rows) * 100}%`,
                  top: `${((heatmap!.cols - 1 - hover.x) / heatmap!.cols) * 100}%`,
                  width: `${100 / heatmap!.rows}%`,
                  height: `${100 / heatmap!.cols}%`,
                }}
              />
            )}
            {hover && hoverInfo && (
              <div
                className="absolute z-10 pointer-events-none bg-slate-950/95 border border-slate-700 rounded-lg px-3 py-2 text-xs shadow-xl whitespace-nowrap"
                style={{
                  left: Math.min(hover.left + 12, 160),
                  top: Math.max(hover.top - 48, 4),
                }}
              >
                <div className="text-slate-400">{hoverInfo.label}</div>
                <div className="text-white font-bold">
                  {hoverInfo.value} actions <span className="text-slate-400 font-normal">({hoverInfo.share.toFixed(1)}%)</span>
                </div>
              </div>
            )}

            <div className="absolute top-2 left-1/2 -translate-x-1/2 text-[10px] font-semibold uppercase tracking-wider text-slate-300 bg-slate-950/70 px-2 py-0.5 rounded">
              Attaque ↑
            </div>
          </div>

          {/* Légende */}
          <div className="mt-3 flex items-center gap-2 text-[10px] text-slate-500">
            <span>Moins</span>
            <div
              className="flex-1 h-2 rounded-full"
              style={{ background: `linear-gradient(to right, ${[0.05, 0.25, 0.5, 0.75, 1].map(rampColor).join(', ')})` }}
            />
            <span>Plus d'actions</span>
          </div>

          {/* Répartition par tiers et par couloirs */}
          <div className="mt-4 grid grid-cols-2 gap-4 text-xs">
            {[{ title: 'Par tiers', labels: THIRDS, values: stats.thirds, order: [2, 1, 0] },
              { title: 'Par couloir', labels: CHANNELS, values: stats.channels, order: [2, 1, 0] }].map(block => (
              <div key={block.title}>
                <div className="text-slate-500 uppercase font-semibold text-[10px] mb-2">{block.title}</div>
                {block.order.map(i => (
                  <div key={block.labels[i]} className="flex items-center gap-2 mb-1.5">
                    <span className="text-slate-400 w-24 truncate">{block.labels[i].replace('Tiers ', '').replace('Couloir ', '')}</span>
                    <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                      <div className="h-full bg-blue-500 rounded-full" style={{ width: `${pct(block.values[i])}%` }} />
                    </div>
                    <span className="text-slate-200 font-mono w-8 text-right">{pct(block.values[i])}%</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export default PlayerHeatmap;
