/**
 * ScoutVision AI - Data Loader Service
 * Charge les données préparées par scripts/prepare_data.py (source PitchAPI)
 *
 *   /data/index.json                   saisons et compétitions disponibles
 *   /data/players/<saison>.json        joueurs d'une saison, toutes compétitions
 *   /data/teams/<saison>.json          équipes d'une saison
 *   /data/shots/<saison>/<COMP>.json   tirs d'une compétition (chargés à la demande)
 *   /data/heatmaps/<saison>/<COMP>.json cartes de chaleur des joueurs (chargées à la demande)
 *   /data/networks/<saison>/<COMP>.json réseaux de passes agrégés par équipe (chargés à la demande)
 *   /data/models/transfer.json         modèle de transfert (recrutement)
 *   /data/market.json                  valeur Transfermarkt et contrat actuels (recrutement)
 */

import { PlayerData, TeamStats, ShotEvent } from '../types';

// ============================================
// TYPES
// ============================================

export interface SeasonInfo {
  id: string;            // "2024-25"
  players: number;
  teams: number;
  competitions: string[];
}

export interface CompetitionInfo {
  key: string;           // "ENG"
  name: string;          // "Premier League"
  tier: number;          // niveau sportif (1 = Big 5 + UCL)
  country?: string;      // code pays FIFA ("ENG"), "INT" pour une coupe d'Europe
  type?: string;         // "league" ou "cup"
  seasons: string[];
  // Fiabilité du RAPM du championnat (corrélation entre moitiés de saison, 0-1)
  rapmReliability?: { off: number; def: number; net: number };
}

export interface TeamStyleInfo {
  name: string;
  teams: number;
  profile: Record<string, number>;   // z-scores du centroïde : possession, pressing...
}

export interface ModelsInfo {
  valuation?: { players: number; r2_cv: number; median_error_factor: number; folds: number };
  styles?: TeamStyleInfo[];
  ageCurvePairs?: number;
}

/**
 * Courbes d'âge : projection = pct + beta * (pct - 50) + effet de l'âge
 */
export interface AgeCurve {
  beta: number;                              // retour vers la moyenne (< 0)
  ages: Record<string, [number, number]>;    // âge -> [effet en points de percentile, observations]
}

export interface AgeCurves {
  pairs: number;
  curves: Record<string, Record<string, AgeCurve>>;   // rôle -> métrique -> courbe
}

/**
 * Modèle de transfert (scripts/models.py) : percentile attendu dans un autre club =
 * projection des courbes d'âge + league * (L[championnat quitté] - L[championnat rejoint])
 * + context · (contexte de la nouvelle équipe - de l'ancienne) + coût d'adaptation
 */
export interface TransferMetric {
  league: number;          // points de percentile par point d'écart de niveau
  context: number[];       // un coefficient par variable de TransferModel.context
  leagueChange: number;    // changement de championnat (points de percentile)
  clubChange: number;      // changement de club dans le même championnat
}

/** Erreurs des trois prévisions : percentile inchangé, courbes d'âge, modèle complet */
export interface TransferErrors {
  persistence: number;
  development: number;
  model: number;
}

export interface TransferErrorTable {
  movers: TransferErrors;        // changements de championnat : erreur absolue moyenne
  clubChanges: TransferErrors;   // changements de club dans le même championnat
  all: TransferErrors;
  biasUp: TransferErrors;        // biais (prévu - observé) des montées de niveau
  biasDown: TransferErrors;      // biais des descentes de niveau
}

export interface TransferValidation {
  season: string;                // saison de test, absente de l'ajustement
  pairs: number;
  movers: number;
  clubChanges: number;
  up: number;
  down: number;
  metric: TransferErrorTable;
  index?: TransferErrorTable & { rankMovers: TransferErrors };   // corrélation de rang
}

export interface TransferModel {
  pairs: number;
  movers: number;
  clubChanges: number;
  context: string[];                                     // colonnes de contexte d'équipe
  leagues: Record<string, { level: number; moves: number }>;
  tierLevels: Record<string, number>;                    // repli d'un championnat inconnu
  metrics: Record<string, TransferMetric>;
  validation: TransferValidation | null;
}

/** Valeur, contrat et estimation à la date du relevé (instantané Transfermarkt de la saison en cours) : ne vaut pas pour une saison passée (recruitment.ts, seasonMarket) */
export interface MarketEntry {
  value?: number;
  contract?: string;     // "2027-06-30"
  estimated?: number;    // valeur estimée par la performance (saison actuelle)
}

export interface MarketValues {
  scrapedAt: string | null;
  players: Map<string, MarketEntry>;
}

export interface ProjectedRow {
  rank: number;
  team: string;
  logo?: string;
  played: number;
  points: number;
  goalDiff: number;
  remaining: number;
  expectedPoints: number;     // points attendus sur les matchs restants
  projectedPoints: number;    // points actuels + attendus
  // Simulation de fin de saison (scripts/models.py, 20 000 tirages)
  pTitle?: number;
  pTop4?: number;
  pBottom3?: number;
  expectedRank?: number;
}

export interface MarketSummary {
  matches: number;
  rpsModel: number;           // plus bas = meilleur
  rpsMarket: number;          // cote de clôture sans marge
  llModel: number;
  llMarket: number;
  poolWeight: number;         // poids optimal du modèle dans un mélange avec le marché (0 = rien à ajouter)
  bets?: number;              // paris de valeur simulés (avantage > seuil, cote moyenne avant match)
  clv?: number;               // gain moyen contre la clôture sans marge
  clvSe?: number;
  roi?: number;
  roiSe?: number;
}

export interface OverUnderSummary {
  matches: number;
  brierModel: number;         // plus bas = meilleur
  brierMarket: number;
  llModel: number;
  llMarket: number;
  poolWeight: number;
  overRate: number;           // part des matchs à plus de 2,5 buts
  bets?: number;
  clv?: number;
  clvSe?: number;
  roi?: number;
  roiSe?: number;
}

export interface MarketEvaluation {
  overall?: MarketSummary;
  competitions?: Record<string, MarketSummary>;
  edgeThreshold?: number;
  period?: [string, string];
  upcomingWithOdds?: number;
  source?: string;
  // Plus / moins de 2,5 buts (modèle joint, prédictions hors échantillon)
  overUnder?: { overall?: OverUnderSummary; competitions?: Record<string, OverUnderSummary>; period?: [string, string] };
}

export interface ForecastFile {
  matches: ForecastMatch[];
  tables: Record<string, ProjectedRow[]>;   // classement projeté par compétition
  market?: MarketEvaluation;
}

export interface ForecastMatch {
  competition: string;
  date: string;
  match_id: string;
  home: string;
  away: string;
  homeLogo?: string;
  awayLogo?: string;
  pHome: number;
  pDraw: number;
  pAway: number;
  xgHome: number;
  xgAway: number;
  // Enjeu : variation de P(objectif de saison) entre victoire et défaite, par équipe
  leverage?: { home?: { objective: string; delta: number }; away?: { objective: string; delta: number } };
  // Cotes football-data : probabilités du marché sans marge, meilleures cotes, avantage du modèle
  market?: { fair: number[]; best: (number | null)[]; edge: (number | null)[] };
}

export interface DataIndex {
  generatedAt: string;
  source: string;
  hasMarketValues: boolean;
  seasons: SeasonInfo[];
  competitions: CompetitionInfo[];
  models?: ModelsInfo;
}

export interface SeasonData {
  players: PlayerData[];
  teams: TeamStats[];
}

export interface LoadingState {
  isLoading: boolean;
  progress: number;
  currentStep: string;
  error: string | null;
}

export interface PlayerHeatmap {
  matches: number;       // matchs avec une carte de chaleur
  grid: number[];        // actions par case, index = cell_y * cols + cell_x
}

export interface LineupSlot {
  slot: number;                                   // case de la grille PitchAPI (position_id)
  x: number;                                      // profondeur moyenne, 0 = propre but
  y: number;                                      // largeur moyenne, 0 = côté gauche
  players: [string, string, number][];            // [Player ID, nom, titularisations dans la case]
}

export interface TeamLineups {
  matches: number;
  formations: { formation: string; matches: number; slots: LineupSlot[] }[];
}

/** Réseau de passes agrégé d'une équipe sur la saison (fenêtre jusqu'au premier remplacement de chaque match) */
export interface TeamNetwork {
  matches: number;                                               // matchs avec un réseau
  players: Record<string, [string, number, number, number, number, number]>;   // Player ID -> [nom, x (0 = propre but), y (0 = gauche), matchs, passes, reçues]
  edges: [string, string, number, number][];                     // [de, vers, passes cumulées, matchs où le lien apparaît]
}

export interface HeatmapFile {
  cols: number;          // 16 : 0 = propre but, 15 = but adverse
  rows: number;          // 12 : 0 = couloir droit de l'attaquant
  players: Record<string, PlayerHeatmap>;   // clé "<Player ID>_<Team ID>"
}

interface Columnar {
  columns: string[];
  rows: unknown[][];
}

// ============================================
// HELPERS
// ============================================

async function fetchJSON<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Failed to load ${path}: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

/**
 * Fichier facultatif : null s'il est absent (404, ou page HTML de repli selon le serveur)
 */
async function fetchOptionalJSON<T>(path: string): Promise<T | null> {
  const response = await fetch(path);
  const isJson = (response.headers.get('content-type') || '').includes('json');
  if (response.status === 404 || (response.ok && !isJson)) return null;
  if (!response.ok) throw new Error(`Failed to load ${path}: ${response.status}`);
  return response.json();
}

/**
 * Convertit le format colonnes/lignes en objets, sans les valeurs nulles
 */
function expand<T>(data: Columnar): T[] {
  const { columns, rows } = data;
  return rows.map(row => {
    const obj: Record<string, unknown> = {};
    for (let i = 0; i < columns.length; i++) {
      if (row[i] !== null) obj[columns[i]] = row[i];
    }
    return obj as T;
  });
}

// ============================================
// DATA LOADER CLASS
// ============================================

class DataLoader {
  private index: DataIndex | null = null;
  private seasons = new Map<string, Promise<SeasonData>>();
  private shots = new Map<string, Promise<ShotEvent[]>>();
  private heatmaps = new Map<string, Promise<HeatmapFile | null>>();
  private lineups = new Map<string, Promise<Record<string, TeamLineups> | null>>();
  private networks = new Map<string, Promise<Record<string, TeamNetwork> | null>>();
  private ageCurves: Promise<AgeCurves> | null = null;
  private transfer: Promise<TransferModel | null> | null = null;
  private market: Promise<MarketValues | null> | null = null;
  private forecast: Promise<ForecastFile> | null = null;

  /**
   * Charge l'index des saisons et compétitions
   */
  async loadIndex(): Promise<DataIndex> {
    if (!this.index) {
      this.index = await fetchJSON<DataIndex>('/data/index.json');
    }
    return this.index;
  }

  /**
   * Charge les joueurs et équipes d'une saison (mis en cache)
   */
  loadSeason(season: string): Promise<SeasonData> {
    let pending = this.seasons.get(season);
    if (!pending) {
      pending = Promise.all([
        fetchJSON<Columnar>(`/data/players/${season}.json`),
        fetchJSON<Columnar>(`/data/teams/${season}.json`),
      ]).then(([players, teams]) => ({
        players: expand<PlayerData>(players),
        teams: expand<TeamStats>(teams),
      }));
      // Un échec ne doit pas rester en cache
      pending.catch(() => this.seasons.delete(season));
      this.seasons.set(season, pending);
    }
    return pending;
  }

  /**
   * Charge plusieurs saisons et concatène leurs données
   */
  async loadSeasons(
    seasons: string[],
    onProgress?: (state: LoadingState) => void
  ): Promise<SeasonData> {
    const result: SeasonData = { players: [], teams: [] };
    let done = 0;

    const report = (step: string) => onProgress?.({
      isLoading: true,
      progress: Math.round((done / seasons.length) * 100),
      currentStep: step,
      error: null,
    });

    report(`Chargement ${seasons.length > 1 ? `de ${seasons.length} saisons` : `de la saison ${seasons[0]}`}...`);
    const loaded = await Promise.all(seasons.map(async season => {
      const data = await this.loadSeason(season);
      done++;
      report(`Saison ${season} chargée`);
      return data;
    }));

    loaded.forEach(data => {
      result.players.push(...data.players);
      result.teams.push(...data.teams);
    });
    return result;
  }

  /**
   * Charge les tirs d'une compétition pour une saison (mis en cache)
   */
  loadShots(season: string, competition: string): Promise<ShotEvent[]> {
    const key = `${season}/${competition}`;
    let pending = this.shots.get(key);
    if (!pending) {
      // Fichier absent : la compétition n'a pas de tirs (liste vide), à distinguer d'un échec réseau
      pending = fetchOptionalJSON<Columnar>(`/data/shots/${key}.json`).then(data => (data ? expand<ShotEvent>(data) : []));
      pending.catch(() => this.shots.delete(key));
      this.shots.set(key, pending);
    }
    return pending;
  }

  /**
   * Charge les cartes de chaleur d'une compétition pour une saison (mises en cache).
   * null si la compétition n'a pas de heatmap cette saison (analytics absente).
   */
  loadHeatmaps(season: string, competition: string): Promise<HeatmapFile | null> {
    const key = `${season}/${competition}`;
    let pending = this.heatmaps.get(key);
    if (!pending) {
      pending = fetchOptionalJSON<HeatmapFile>(`/data/heatmaps/${key}.json`);
      pending.catch(() => this.heatmaps.delete(key));
      this.heatmaps.set(key, pending);
    }
    return pending;
  }

  /**
   * Compositions réelles des équipes d'une compétition (mises en cache), clé = Team ID.
   * null si la compétition n'a pas de compositions cette saison.
   */
  loadLineups(season: string, competition: string): Promise<Record<string, TeamLineups> | null> {
    const key = `${season}/${competition}`;
    let pending = this.lineups.get(key);
    if (!pending) {
      pending = fetchOptionalJSON<Record<string, TeamLineups>>(`/data/lineups/${key}.json`);
      pending.catch(() => this.lineups.delete(key));
      this.lineups.set(key, pending);
    }
    return pending;
  }

  /**
   * Réseaux de passes agrégés des équipes d'une compétition (mis en cache), clé = Team ID.
   * null si la compétition n'a pas de réseaux cette saison.
   */
  loadNetworks(season: string, competition: string): Promise<Record<string, TeamNetwork> | null> {
    const key = `${season}/${competition}`;
    let pending = this.networks.get(key);
    if (!pending) {
      pending = fetchOptionalJSON<Record<string, TeamNetwork>>(`/data/networks/${key}.json`);
      pending.catch(() => this.networks.delete(key));
      this.networks.set(key, pending);
    }
    return pending;
  }

  /**
   * Courbes d'âge par rôle et par métrique (mises en cache)
   */
  loadAgeCurves(): Promise<AgeCurves> {
    if (!this.ageCurves) {
      this.ageCurves = fetchJSON<AgeCurves>('/data/models/age_curves.json');
      this.ageCurves.catch(() => { this.ageCurves = null; });
    }
    return this.ageCurves;
  }

  /**
   * Modèle de transfert (mis en cache) ; null si le pipeline ne l'a pas produit
   */
  loadTransferModel(): Promise<TransferModel | null> {
    if (!this.transfer) {
      this.transfer = fetchOptionalJSON<TransferModel>('/data/models/transfer.json');
      this.transfer.catch(() => { this.transfer = null; });
    }
    return this.transfer;
  }

  /**
   * Valeurs Transfermarkt actuelles par joueur (mises en cache) ; null sans données de marché
   */
  loadMarketValues(): Promise<MarketValues | null> {
    if (!this.market) {
      this.market = fetchOptionalJSON<Columnar & { scrapedAt?: string | null }>('/data/market.json').then(data => {
        if (!data) return null;
        const players = new Map<string, MarketEntry>();
        expand<Record<string, string | number>>(data).forEach(row => {
          players.set(String(row['Player ID']), {
            value: typeof row['Market value'] === 'number' ? row['Market value'] : undefined,
            contract: typeof row['Contract expires'] === 'string' ? row['Contract expires'] : undefined,
            estimated: typeof row['Estimated value'] === 'number' ? row['Estimated value'] : undefined,
          });
        });
        return { scrapedAt: data.scrapedAt ?? null, players };
      });
      this.market.catch(() => { this.market = null; });
    }
    return this.market;
  }

  /**
   * Pronostics des prochains matchs (mis en cache)
   */
  loadForecast(): Promise<ForecastFile> {
    if (!this.forecast) {
      this.forecast = fetchJSON<ForecastFile>('/data/forecast.json').then(d => ({ matches: d.matches ?? [], tables: d.tables ?? {}, market: d.market }));
      this.forecast.catch(() => { this.forecast = null; });
    }
    return this.forecast;
  }

  /**
   * Retourne l'index en cache (ou null si non chargé)
   */
  getCachedIndex(): DataIndex | null {
    return this.index;
  }

  /**
   * Retourne les infos d'une compétition (nom, pays) depuis l'index en cache
   */
  getCompetition(key: string | undefined): CompetitionInfo | undefined {
    return key ? this.index?.competitions.find(c => c.key === key) : undefined;
  }
}

// Singleton
export const dataLoader = new DataLoader();

export default dataLoader;
