/**
 * ScoutVision - dossier de scouting (enregistrement local, navigateur)
 *
 * Un dossier est lié à une ligne joueur-saison (playerSeasonId : joueur, club, compétition,
 * saison) et garde les faits exacts que la synthèse a reçus (dataSnapshot.facts), jamais la
 * ligne entière. Trois natures de contenu, jamais mélangées :
 * - dataSnapshot : calculs ScoutVision figés au moment de la création ou de la génération ;
 * - generatedSummaries : synthèses rédigées par Gemini à partir de ces faits, versionnées ;
 * - observations : notes humaines (vidéo, live, général), jamais préremplies par un modèle.
 * `refs` existe pour une future référence vidéo (match, événement, horodatage, clip) : aucune
 * interface ne l'utilise aujourd'hui.
 */

import type { ReportFacts } from '../server/reportFacts';

export type { ReportFacts };

export const SCOUT_REPORT_SCHEMA_VERSION = 1;

export type ReportStatus = 'draft' | 'to_observe' | 'finalized' | 'archived';
export const REPORT_STATUSES: ReportStatus[] = ['draft', 'to_observe', 'finalized', 'archived'];

export type ObservationType = 'video' | 'live' | 'general';
export const OBSERVATION_TYPES: ObservationType[] = ['video', 'live', 'general'];

export interface ObservationRef {
  matchId?: string;
  eventId?: string;
  timestamp?: string;
  clip?: string;
}

export interface ScoutObservation {
  id: string;
  date: string;                 // AAAA-MM-JJ, saisie par l'observateur
  type: ObservationType;
  text: string;
  strengths?: string;
  toReview?: string;
  conclusion?: string;
  refs?: ObservationRef[];
  createdAt: string;
}

export interface GeneratedSummary {
  id: string;
  model: string;                // modèle qui a réellement rédigé
  requestedModel?: string;
  promptVersion: string;
  generatedAt: string;
  content: string;              // Markdown, 5 sections
}

export interface SnapshotIndicators {
  rapm?: { net: number; off?: number; def?: number; pct?: number; reliability?: { net: number; def: number }; minutes?: number };
  finishing?: { skill: number; shots: number };
  passShare?: { value: number; pct?: number; matches?: number };
  valuation?: { market?: number; estimate?: number };
}

export interface SnapshotProjection {
  metric: string;               // clé de la métrique
  label: string;
  current: number;              // percentile actuel
  projected: number;            // percentile projeté (courbes d'âge)
}

export interface ReportDataSnapshot {
  facts: ReportFacts;
  bestRoles: { role: string; index: number }[];
  indicators?: SnapshotIndicators;
  projection?: SnapshotProjection[];
  seasonInProgress?: boolean;
  dataUpdatedAt?: string;       // index.json generatedAt au moment du snapshot
  rolePresetsVersion?: string;
  transferModelVersion?: string;
}

export interface ReportPlayerRef {
  playerSeasonId: string;
  playerId?: string;
  name: string;
  season: string;               // identifiant de saison de l'application (« 2026-27 »)
  seasonLabel?: string;         // libellé court (« 26-27 », « 2026 »)
  teamId?: string;
  team: string;
  competition: string;          // clé de compétition (« FRA », « UCL »)
  competitionName?: string;
  position?: string;
  age?: number;
  minutes?: number;
  image?: string;
}

export interface ScoutReportRecord {
  id: string;
  schemaVersion: typeof SCOUT_REPORT_SCHEMA_VERSION;
  player: ReportPlayerRef;
  createdAt: string;
  updatedAt: string;
  status: ReportStatus;
  role?: string;                // rôle analysé
  tags: string[];
  dataSnapshot: ReportDataSnapshot;
  generatedSummaries: GeneratedSummary[];
  observations: ScoutObservation[];
}
