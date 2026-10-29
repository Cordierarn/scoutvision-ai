/**
 * ScoutVision AI - Carte de chaleur d'un joueur
 * Actions cumulées sur la saison (table heatmap PitchAPI, grille 16 x 12),
 * dessinées sur un terrain vertical : l'équipe du joueur attaque vers le haut.
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Flame } from 'lucide-react';
import { PlayerData, getPlayerSeason } from '../types';
import { dataLoader } from '../services/dataLoader';
import { useAsyncData } from '../hooks/useAsyncData';
import { Panel, LoadError } from './ui';
import { SEQUENTIAL } from '../theme/charts';

interface PlayerHeatmapProps {
  player: PlayerData;
}

// Terrain vertical en mètres : largeur 68, longueur 105
const PITCH_W = 68;
const PITCH_H = 105;

// Rampe séquentielle à une teinte (cyan ScoutVision), du plus faible au plus fort.
// Sur fond sombre l'intensité monte vers le clair ; une case vide reste transparente.
const RAMP: readonly string[] = SEQUENTIAL;

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
  const [hover, setHover] = useState<{ x: number; y: number; left: number; top: number } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Carte du joueur (fichier de sa compétition, mis en cache) : chargement, échec ou carte absente
  // sont trois états distincts ; « absente » seulement après un chargement réussi
  const season = getPlayerSeason(player);
  const competition = player.Competition;
  const canLoad = Boolean(competition && player['Player ID']);
  const request = useAsyncData(
    canLoad ? () => dataLoader.loadHeatmaps(season, competition!) : null,
    [season, competition, canLoad],
  );
  const heatmap = useMemo(() => {
    const file = request.data;
    const data = file?.players[`${player['Player ID']}_${player['Team ID']}`];
    return file && data ? { cols: file.cols, rows: file.rows, data } : null;
  }, [request.data, player]);
  const status = request.status === 'loading' ? 'loading'
    : request.status === 'error' ? 'error'
    : heatmap ? 'ready' : 'missing';

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
    <Panel title="Carte de chaleur" icon={Flame} className="h-full break-inside-avoid"
      subtitle={status === 'ready' && stats
        ? `${stats.total.toLocaleString('fr-FR')} actions · ${heatmap!.data.matches} matchs · ${player.Season}`
        : 'Zones d\'action du joueur sur la saison'}>
      {status === 'loading' && (
        <div role="status" aria-label="Chargement de la carte de chaleur">
          <div className="w-full max-w-[260px] mx-auto aspect-[68/105] rounded-md bg-raised/70 animate-pulse" />
          <div className="mt-3 h-1.5 rounded-sm bg-raised/70" />
          <div className="mt-4 grid grid-cols-2 xl:grid-cols-1 gap-x-4 gap-y-3">
            {[0, 1].map(i => <div key={i} className="h-[4.5rem] rounded-md bg-raised/50 animate-pulse" />)}
          </div>
        </div>
      )}

      {status === 'error' && (
        <LoadError message="La carte de chaleur n'a pas pu être chargée." onRetry={request.retry} />
      )}

      {status === 'missing' && (
        <div className="w-full max-w-[260px] mx-auto rounded-md border border-dashed border-line flex flex-col items-center justify-center text-center px-4 py-8">
          <Flame className="w-5 h-5 text-ink-4 mb-2" aria-hidden />
          <p className="text-xs text-ink-2">Aucune donnée disponible</p>
          <p className="text-2xs text-ink-4 mt-1 leading-relaxed">La carte n'existe que pour les matchs couverts par les statistiques avancées de PitchAPI.</p>
        </div>
      )}

      {status === 'ready' && stats && (
        <>
          <div
            className="relative w-full max-w-[260px] mx-auto aspect-[68/105] rounded-md overflow-hidden bg-raised/60 border border-line cursor-crosshair"
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
                className="absolute z-10 pointer-events-none bg-surface/95 border border-line-strong rounded-md px-3 py-2 text-xs  whitespace-nowrap"
                style={{
                  left: Math.min(hover.left + 12, 160),
                  top: Math.max(hover.top - 48, 4),
                }}
              >
                <div className="text-ink-3">{hoverInfo.label}</div>
                <div className="text-ink font-bold">
                  {hoverInfo.value} actions <span className="text-ink-3 font-normal">({hoverInfo.share.toFixed(1)}%)</span>
                </div>
              </div>
            )}

            <div className="absolute top-2 left-1/2 -translate-x-1/2 text-[10px] font-semibold uppercase tracking-wider text-ink-2 bg-surface/70 px-2 py-0.5 rounded">
              Attaque ↑
            </div>
          </div>

          {/* Légende */}
          <div className="mt-3 flex items-center gap-2 text-[10px] text-ink-3">
            <span>Moins</span>
            <div
              className="flex-1 h-1.5 rounded-sm"
              style={{ background: `linear-gradient(to right, ${[0.05, 0.25, 0.5, 0.75, 1].map(rampColor).join(', ')})` }}
            />
            <span>Plus d'actions</span>
          </div>

          {/* Répartition par tiers et par couloirs */}
          <div className="mt-4 grid grid-cols-2 xl:grid-cols-1 gap-x-4 gap-y-3 text-xs">
            {[{ title: 'Par tiers', labels: THIRDS, values: stats.thirds, order: [2, 1, 0] },
              { title: 'Par couloir', labels: CHANNELS, values: stats.channels, order: [2, 1, 0] }].map(block => (
              <div key={block.title}>
                <div className="sv-label mb-1.5">{block.title}</div>
                {block.order.map(i => (
                  <div key={block.labels[i]} className="flex items-center gap-2 mb-1.5">
                    <span className="text-ink-3 flex-1 leading-snug">{block.labels[i].replace('Tiers ', '').replace('Couloir ', '')}</span>
                    <div className="w-12 h-1.5 bg-raised rounded-sm overflow-hidden shrink-0">
                      <div className="h-full bg-accent-deep rounded-sm" style={{ width: `${pct(block.values[i])}%` }} />
                    </div>
                    <span className="text-ink font-mono w-8 text-right">{pct(block.values[i])}%</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </>
      )}
    </Panel>
  );
};

export default PlayerHeatmap;
