/**
 * ScoutVision - contexte statistique des deux équipes d'un match, pour l'assistant IA du Labo paris.
 *
 * Tout vient des données déjà servies par le serveur (dossier des données) : rien n'est calculé ici
 * au-delà de sélections, d'agrégats simples (somme des buts d'un joueur sur ses compétitions) et
 * d'arrondis. Fichiers lus, relus seulement quand ils changent :
 * - forecast.json : probabilités 1N2 du modèle et du marché sans marge, buts attendus, enjeu de saison,
 *   classements des championnats (rang, points, probabilités de titre, top 4, relégation) ;
 * - teams/{saison}.json : profil d'équipe par compétition (xG, tirs, possession, pressing, style) ;
 * - players/{saison}.json : joueurs les plus utilisés (part des minutes, buts, xG, passes, note, impact) ;
 * - lineups/{saison}/{compétition}.json : système le plus utilisé et onze type.
 */

import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const r2 = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 100) / 100 : null);
const r3 = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null);

/** Lecture JSON mise en cache selon la date de modification ; `select` réduit le contenu gardé en mémoire */
function cachedJson<T>(file: string, select: (raw: unknown) => T): () => T | null {
  let cached: { mtime: number; value: T } | null = null;
  return () => {
    try {
      const mtime = statSync(file).mtimeMs;
      if (!cached || cached.mtime !== mtime) cached = { mtime, value: select(JSON.parse(readFileSync(file, 'utf8'))) };
      return cached.value;
    } catch {
      return null;
    }
  };
}

const TEAM_METRICS = ['xG per 90', 'xGA per 90', 'npxG per 90', 'npxGA per 90', 'Shots per 90', 'Shots against per 90', 'Goals per 90', 'Goals against per 90',
  'Possession, %', 'Field tilt', 'PPDA', 'Defensive line height', 'Passes per sequence', 'Direct speed', 'Pass accuracy, %'] as const;

export interface TeamProfile { competition: string; matches: number | null; style: string | null; metrics: Record<string, number | null> }
export interface Standing { competition: string; rank: number; played: number; points: number; goalDiff: number; projectedPoints: number | null; pTitle: number | null; pTop4: number | null; pBottom3: number | null }
export interface KeyPlayer {
  name: string; position: string | null; age: number | null; matches: number; starts: number; minutesShare: number | null;
  goals: number; assists: number; xG: number | null; xA: number | null; rating: number | null; vaepPer90: number | null; rapmNet: number | null;
}
export interface TeamContext {
  team: string;
  standings: Standing[];
  seasonStakes: { objective: string; swing: number } | null;   // écart de probabilité de l'objectif entre victoire et défaite
  profiles: TeamProfile[];
  usualSystem: { formation: string; matches: number; xi: string[] } | null;
  keyPlayers: KeyPlayer[];
}
export interface MatchContext {
  model1x2: { home: number; draw: number; away: number } | null;
  market1x2NoVig: { home: number; draw: number; away: number } | null;
  expectedGoals: { home: number; away: number } | null;
  home: TeamContext;
  away: TeamContext;
}

interface TeamRow { teamId: string; team: string; competition: string; profile: TeamProfile }
interface PlayerAgg extends KeyPlayer { minutes: number; totalMinutes?: number }

type ForecastMatch = { match_id?: string; competition?: string; home?: string; away?: string; pHome?: number; pDraw?: number; pAway?: number; xgHome?: number; xgAway?: number;
  leverage?: { home?: { objective?: string; delta?: number }; away?: { objective?: string; delta?: number } }; market?: { fair?: number[] } };
type ForecastFile = { matches: Map<string, ForecastMatch>; tables: Record<string, Record<string, unknown>[]> };

const MOST_USED = 6;       // titulaires habituels (part des minutes)
const MOST_DECISIVE = 4;   // joueurs les plus décisifs (buts + passes décisives, puis xG + xA)

/** Joueurs clés : les plus utilisés, complétés par les plus décisifs (sans doublon) */
export function pickKeyPlayers<T extends { name: string; goals: number; assists: number; xG: number | null; xA: number | null }>(byMinutes: T[]): T[] {
  const involvement = (p: T) => p.goals + p.assists + ((p.xG ?? 0) + (p.xA ?? 0)) / 100;
  const decisive = [...byMinutes].sort((a, b) => involvement(b) - involvement(a)).filter(p => p.goals + p.assists > 0 || (p.xG ?? 0) + (p.xA ?? 0) > 0);
  const out = byMinutes.slice(0, MOST_USED);
  for (const p of decisive) {
    if (out.length >= MOST_USED + MOST_DECISIVE) break;
    if (!out.includes(p)) out.push(p);
  }
  return out;
}

export interface ContextLoader { (matchId: string, competition: string, home: string, away: string, season: string): MatchContext | null }

export function contextLoader(dataDir: string): ContextLoader {
  const forecast = cachedJson<ForecastFile>(path.join(dataDir, 'forecast.json'), raw => {
    const f = raw as { matches?: ForecastMatch[]; tables?: Record<string, Record<string, unknown>[]> };
    return { matches: new Map((f.matches ?? []).filter(m => m.match_id).map(m => [m.match_id!, m])), tables: f.tables ?? {} };
  });
  const teamsBySeason = new Map<string, () => TeamRow[] | null>();
  const playersBySeason = new Map<string, () => Map<string, PlayerAgg[]> | null>();
  const lineups = new Map<string, () => Record<string, { matches?: number; formations?: { formation: string; matches: number; slots: { players: [string, string, number][] }[] }[] }> | null>();

  const teams = (season: string) => {
    if (!teamsBySeason.has(season)) {
      teamsBySeason.set(season, cachedJson(path.join(dataDir, 'teams', `${season}.json`), raw => {
        const t = raw as { columns: string[]; rows: unknown[][] };
        const idx = (c: string) => t.columns.indexOf(c);
        return t.rows.map(r => ({
          teamId: String(r[idx('team_id')]), team: String(r[idx('team')]), competition: String(r[idx('competition')]),
          profile: {
            competition: String(r[idx('competition')]), matches: r2(r[idx('Matches')]), style: typeof r[idx('Style')] === 'string' ? r[idx('Style')] as string : null,
            metrics: Object.fromEntries(TEAM_METRICS.map(m => [m, r2(r[idx(m)])])),
          },
        }));
      }));
    }
    return teamsBySeason.get(season)!();
  };

  // Joueurs : seules les colonnes utiles sont gardées, agrégées par joueur et par équipe toutes compétitions
  const players = (season: string) => {
    if (!playersBySeason.has(season)) {
      playersBySeason.set(season, cachedJson(path.join(dataDir, 'players', `${season}.json`), raw => {
        const p = raw as { columns: string[]; rows: unknown[][] };
        const c = (name: string) => p.columns.indexOf(name);
        const col = { id: c('Player ID'), name: c('Player'), team: c('Team ID'), pos: c('Position'), age: c('Age'), mp: c('Matches played'), st: c('Starts'), min: c('Minutes played'),
          share: c('Minutes share'), g: c('Goals'), a: c('Assists'), xg: c('xG'), xa: c('xA'), rating: c('Rating'), vaep: c('VAEP per 90'), rapm: c('RAPM net') };
        const byTeam = new Map<string, Map<string, PlayerAgg>>();
        const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
        for (const r of p.rows) {
          const team = String(r[col.team]);
          const id = String(r[col.id]);
          const players = byTeam.get(team) ?? new Map<string, PlayerAgg>();
          byTeam.set(team, players);
          const prev = players.get(id);
          const minutes = num(r[col.min]);
          const cur: PlayerAgg = prev ?? { name: String(r[col.name]), position: typeof r[col.pos] === 'string' ? r[col.pos] as string : null, age: r2(r[col.age]), matches: 0, starts: 0,
            minutesShare: null, goals: 0, assists: 0, xG: 0, xA: 0, rating: null, vaepPer90: null, rapmNet: r2(r[col.rapm]), minutes: 0 };
          // part des minutes, note et impact : ceux de la compétition où le joueur a le plus joué ; minutes et
          // matchs cumulés sur toutes les compétitions (un seul match de coupe ne fait pas un titulaire)
          if (!prev || minutes > prev.minutes) { cur.minutesShare = r3(r[col.share]); cur.rating = r2(r[col.rating]); cur.vaepPer90 = r3(r[col.vaep]); cur.minutes = minutes; }
          cur.matches += num(r[col.mp]); cur.starts += num(r[col.st]); cur.goals += num(r[col.g]); cur.assists += num(r[col.a]);
          cur.xG = r2(num(cur.xG) + num(r[col.xg])); cur.xA = r2(num(cur.xA) + num(r[col.xa])); cur.totalMinutes = (cur.totalMinutes ?? 0) + minutes;
          players.set(id, cur);
        }
        return new Map([...byTeam].map(([team, ps]) => [team, [...ps.values()]
          .sort((a, b) => (b.totalMinutes ?? 0) - (a.totalMinutes ?? 0) || (b.minutesShare ?? 0) - (a.minutesShare ?? 0))]));
      }));
    }
    return playersBySeason.get(season)!();
  };

  const lineup = (season: string, competition: string) => {
    const key = `${season}/${competition}`;
    if (!lineups.has(key)) lineups.set(key, cachedJson(path.join(dataDir, 'lineups', season, `${competition}.json`), raw => raw as never));
    return lineups.get(key)!();
  };

  const teamContext = (name: string, competition: string, season: string, side: 'home' | 'away', fm: ForecastMatch | undefined): TeamContext => {
    const rows = (teams(season) ?? []).filter(r => r.team === name);
    const teamId = rows.find(r => r.competition === competition)?.teamId ?? rows[0]?.teamId;
    const all = teamId ? (teams(season) ?? []).filter(r => r.teamId === teamId) : rows;
    const tables = forecast()?.tables ?? {};
    const standings: Standing[] = [];
    for (const r of all) {
      const row = (tables[r.competition] ?? []).find(x => x.team === name);
      if (row) standings.push({ competition: r.competition, rank: Number(row.rank), played: Number(row.played), points: Number(row.points), goalDiff: Number(row.goalDiff),
        projectedPoints: r2(row.projectedPoints), pTitle: r3(row.pTitle), pTop4: r3(row.pTop4), pBottom3: r3(row.pBottom3) });
    }
    const lev = fm?.leverage?.[side];
    const lu = teamId ? (lineup(season, competition)?.[teamId] ?? all.map(r => lineup(season, r.competition)?.[teamId]).find(Boolean)) : undefined;
    const top = lu?.formations?.slice().sort((a, b) => b.matches - a.matches)[0];
    const pool = teamId ? players(season)?.get(teamId) ?? [] : [];
    return {
      team: name,
      standings,
      seasonStakes: lev?.objective && typeof lev.delta === 'number' ? { objective: lev.objective, swing: r3(lev.delta) ?? 0 } : null,
      profiles: all.sort((a, b) => (a.competition === competition ? -1 : b.competition === competition ? 1 : 0)).map(r => r.profile),
      usualSystem: top ? { formation: top.formation, matches: top.matches, xi: top.slots.map(s => s.players?.[0]?.[1]).filter((n): n is string => !!n) } : null,
      keyPlayers: pickKeyPlayers(pool).map(({ minutes: _m, totalMinutes: _t, ...p }) => p),
    };
  };

  return (matchId, competition, home, away, season) => {
    const fm = forecast()?.matches.get(matchId);
    const fair = fm?.market?.fair;
    return {
      model1x2: typeof fm?.pHome === 'number' && typeof fm.pDraw === 'number' && typeof fm.pAway === 'number' ? { home: fm.pHome, draw: fm.pDraw, away: fm.pAway } : null,
      market1x2NoVig: Array.isArray(fair) && fair.length === 3 && fair.every(x => typeof x === 'number') ? { home: r3(fair[0])!, draw: r3(fair[1])!, away: r3(fair[2])! } : null,
      expectedGoals: typeof fm?.xgHome === 'number' && typeof fm.xgAway === 'number' ? { home: fm.xgHome, away: fm.xgAway } : null,
      home: teamContext(home, competition, season, 'home', fm),
      away: teamContext(away, competition, season, 'away', fm),
    };
  };
}

/** Joueurs clés d'une équipe à vérifier dans l'actualité : les 4 plus utilisés et les 3 plus décisifs */
export const regulars = (t: TeamContext) => [...new Set([...t.keyPlayers.slice(0, 4), ...t.keyPlayers.slice(MOST_USED, MOST_USED + 3)].map(p => p.name))];
