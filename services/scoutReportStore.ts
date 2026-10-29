/**
 * ScoutVision - stockage local des dossiers de scouting (localStorage, V1)
 *
 * Une seule clé versionnée, un tableau de ScoutReportRecord. Lecture tolérante : un
 * enregistrement illisible est ignoré et compté, les autres sont conservés, jamais de page
 * blanche. Export et import JSON pour une sauvegarde utilisateur avant tout futur stockage
 * distant : seuls les dossiers sont écrits, jamais une clé, un secret ni un cache.
 */

import {
  CRITERION_RATINGS, CriterionRating, GeneratedSummary, ObservationCriterion, ObservationGrid, ObservationType, OBSERVATION_TYPES, ReportDataSnapshot, ReportEvaluation,
  ReportPlayerRef, ReportStatus, REPORT_STATUSES, SCOUT_REPORT_SCHEMA_VERSION, SCOUT_REPORT_SCHEMA_VERSIONS_READ, ScoutObservation, ScoutReportRecord,
} from '../types/scoutReport';

export const SCOUT_REPORTS_KEY = 'scoutvision_scout_reports_v1';
export const EXPORT_KIND = 'scoutvision-scout-reports';

export interface StorageLike { getItem(k: string): string | null; setItem(k: string, v: string): void }

const defaultStorage = (): StorageLike | null => {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
};

export class ReportStoreError extends Error {
  constructor(message: string) { super(message); this.name = 'ReportStoreError'; }
}

export const newId = (): string => {
  try { if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID(); } catch { /* repli */ }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

// ============================================
// VALIDATION (lecture tolérante)
// ============================================

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map(x => x.trim()) : []);

function parseSummary(raw: unknown): GeneratedSummary | null {
  if (!isObject(raw)) return null;
  const id = str(raw.id), model = str(raw.model), content = str(raw.content), generatedAt = str(raw.generatedAt), promptVersion = str(raw.promptVersion);
  if (!id || !model || !content || !generatedAt || !promptVersion) return null;
  return { id, model, content, generatedAt, promptVersion, ...(str(raw.requestedModel) ? { requestedModel: str(raw.requestedModel) } : {}) };
}

const rating = (v: unknown): CriterionRating | undefined => (typeof v === 'number' && CRITERION_RATINGS.includes(v as CriterionRating) ? (v as CriterionRating) : undefined);

/** Grille d'observation : rôle obligatoire, critères valides seulement, notes 1 à 5 entières ; null si illisible */
function parseGrid(raw: unknown): ObservationGrid | null {
  if (!isObject(raw)) return null;
  const role = str(raw.role);
  if (!role || !Array.isArray(raw.criteria)) return null;
  const criteria = raw.criteria.filter(isObject).flatMap(c => {
    const key = str(c.key), label = str(c.label), kind = str(c.kind) as ObservationCriterion['kind'] | undefined;
    if (!key || !label || (kind !== 'role_metric' && kind !== 'unmeasured')) return [];
    const r = rating(c.rating), note = str(c.note)?.trim();
    return [{ key, label, kind, ...(r ? { rating: r } : {}), ...(note ? { note } : {}) }];
  });
  const overall = rating(raw.overall);
  return { role, criteria, ...(overall ? { overall } : {}) };
}

function parseEvaluation(raw: unknown): ReportEvaluation | undefined {
  if (!isObject(raw) || typeof raw.blind !== 'boolean') return undefined;
  const revealedAt = str(raw.revealedAt);
  return { blind: raw.blind, ...(revealedAt ? { revealedAt } : {}) };
}

function parseObservation(raw: unknown): ScoutObservation | null {
  if (!isObject(raw)) return null;
  const id = str(raw.id), date = str(raw.date), text = str(raw.text), type = str(raw.type) as ObservationType | undefined;
  if (!id || !date || text === undefined || !type || !OBSERVATION_TYPES.includes(type)) return null;
  const refs = Array.isArray(raw.refs)
    ? raw.refs.filter(isObject).map(r => ({
      ...(str(r.matchId) ? { matchId: str(r.matchId) } : {}), ...(str(r.eventId) ? { eventId: str(r.eventId) } : {}),
      ...(str(r.timestamp) ? { timestamp: str(r.timestamp) } : {}), ...(str(r.clip) ? { clip: str(r.clip) } : {}),
    }))
    : undefined;
  const grid = raw.grid === undefined ? null : parseGrid(raw.grid);   // grille illisible : observation gardée sans sa grille
  return {
    id, date, type, text,
    ...(str(raw.strengths) ? { strengths: str(raw.strengths) } : {}),
    ...(str(raw.toReview) ? { toReview: str(raw.toReview) } : {}),
    ...(str(raw.conclusion) ? { conclusion: str(raw.conclusion) } : {}),
    ...(grid ? { grid } : {}),
    ...(refs && refs.length ? { refs } : {}),
    createdAt: str(raw.createdAt) ?? date,
  };
}

function parsePlayer(raw: unknown): ReportPlayerRef | null {
  if (!isObject(raw)) return null;
  const playerSeasonId = str(raw.playerSeasonId), name = str(raw.name), season = str(raw.season), team = str(raw.team), competition = str(raw.competition);
  if (!playerSeasonId || !name || !season || !team || !competition) return null;
  const out: ReportPlayerRef = { playerSeasonId, name, season, team, competition };
  const copy = (k: keyof ReportPlayerRef) => { const v = str(raw[k]); if (v) (out as unknown as Record<string, unknown>)[k] = v; };
  (['playerId', 'seasonLabel', 'teamId', 'competitionName', 'position', 'image'] as const).forEach(copy);
  if (num(raw.age) !== undefined) out.age = num(raw.age);
  if (num(raw.minutes) !== undefined) out.minutes = num(raw.minutes);
  return out;
}

function parseSnapshot(raw: unknown): ReportDataSnapshot | null {
  if (!isObject(raw) || !isObject(raw.facts)) return null;
  const facts = raw.facts as unknown as ReportDataSnapshot['facts'];
  if (!isObject(facts.player) || !isObject(facts.sample) || !Array.isArray(facts.metrics)) return null;
  const bestRoles = Array.isArray(raw.bestRoles)
    ? raw.bestRoles.filter(isObject).flatMap(r => (str(r.role) && num(r.index) !== undefined ? [{ role: str(r.role)!, index: num(r.index)! }] : []))
    : [];
  const out: ReportDataSnapshot = { facts, bestRoles };
  if (isObject(raw.indicators)) out.indicators = raw.indicators as ReportDataSnapshot['indicators'];
  if (Array.isArray(raw.projection)) {
    out.projection = raw.projection.filter(isObject).flatMap(p => (str(p.metric) && num(p.current) !== undefined && num(p.projected) !== undefined
      ? [{ metric: str(p.metric)!, label: str(p.label) ?? str(p.metric)!, current: num(p.current)!, projected: num(p.projected)! }] : []));
  }
  if (typeof raw.seasonInProgress === 'boolean') out.seasonInProgress = raw.seasonInProgress;
  (['dataUpdatedAt', 'rolePresetsVersion', 'transferModelVersion'] as const).forEach(k => { const v = str(raw[k]); if (v) out[k] = v; });
  return out;
}

/**
 * Un enregistrement lu dans le stockage ou un fichier importé ; null s'il est illisible.
 * Migration : un dossier v1 (sans évaluation ni grille) est accepté tel quel et renvoyé en v2,
 * tous ses champs conservés ; une version inconnue est refusée.
 */
export function parseRecord(raw: unknown): ScoutReportRecord | null {
  if (!isObject(raw) || !(SCOUT_REPORT_SCHEMA_VERSIONS_READ as readonly unknown[]).includes(raw.schemaVersion)) return null;
  const evaluation = parseEvaluation(raw.evaluation);
  const id = str(raw.id), createdAt = str(raw.createdAt), updatedAt = str(raw.updatedAt), status = str(raw.status) as ReportStatus | undefined;
  const player = parsePlayer(raw.player);
  const dataSnapshot = parseSnapshot(raw.dataSnapshot);
  if (!id || !createdAt || !updatedAt || !status || !REPORT_STATUSES.includes(status) || !player || !dataSnapshot) return null;
  return {
    id, schemaVersion: SCOUT_REPORT_SCHEMA_VERSION, player, createdAt, updatedAt, status,
    ...(str(raw.role) ? { role: str(raw.role) } : {}),
    tags: [...new Set(strings(raw.tags))],
    ...(evaluation ? { evaluation } : {}),
    dataSnapshot,
    generatedSummaries: Array.isArray(raw.generatedSummaries) ? raw.generatedSummaries.map(parseSummary).filter((s): s is GeneratedSummary => !!s) : [],
    observations: Array.isArray(raw.observations) ? raw.observations.map(parseObservation).filter((o): o is ScoutObservation => !!o) : [],
  };
}

// ============================================
// LECTURE / ÉCRITURE
// ============================================

export interface LoadedReports {
  records: ScoutReportRecord[];
  ignored: number;              // enregistrements illisibles, laissés de côté
}

export function loadReports(storage: StorageLike | null = defaultStorage()): LoadedReports {
  if (!storage) return { records: [], ignored: 0 };
  let raw: unknown;
  try { raw = JSON.parse(storage.getItem(SCOUT_REPORTS_KEY) ?? '[]'); } catch { return { records: [], ignored: 1 }; }
  const list = Array.isArray(raw) ? raw : isObject(raw) && Array.isArray(raw.reports) ? raw.reports : null;
  if (!list) return { records: [], ignored: 1 };
  const records: ScoutReportRecord[] = [];
  let ignored = 0;
  const seen = new Set<string>();
  list.forEach(item => {
    const r = parseRecord(item);
    if (!r || seen.has(r.id)) { ignored++; return; }
    seen.add(r.id);
    records.push(r);
  });
  return { records, ignored };
}

export function saveReports(records: ScoutReportRecord[], storage: StorageLike | null = defaultStorage()): void {
  if (!storage) throw new ReportStoreError('Stockage local indisponible dans ce navigateur.');
  try { storage.setItem(SCOUT_REPORTS_KEY, JSON.stringify(records)); } catch {
    throw new ReportStoreError('Enregistrement impossible : espace de stockage local insuffisant. Exportez vos dossiers en JSON puis archivez ou supprimez-en.');
  }
}

// Abonnés (page Rapports, fiche joueur) prévenus après chaque écriture
const listeners = new Set<() => void>();
export function subscribeReports(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
const notify = () => listeners.forEach(l => l());

function mutate(storage: StorageLike | null, fn: (records: ScoutReportRecord[]) => ScoutReportRecord[]): ScoutReportRecord[] {
  const { records } = loadReports(storage);
  const next = fn(records);
  saveReports(next, storage);
  notify();
  return next;
}

const touch = (r: ScoutReportRecord, now: string): ScoutReportRecord => ({ ...r, updatedAt: now });

// ============================================
// OPÉRATIONS
// ============================================

export const byUpdatedDesc = (a: ScoutReportRecord, b: ScoutReportRecord) => b.updatedAt.localeCompare(a.updatedAt);

export function getReport(id: string, storage: StorageLike | null = defaultStorage()): ScoutReportRecord | undefined {
  return loadReports(storage).records.find(r => r.id === id);
}

/** Dossier d'une ligne joueur-saison (le plus récemment modifié s'il y en a plusieurs) */
export function findReportForPlayer(playerSeasonId: string, storage: StorageLike | null = defaultStorage()): ScoutReportRecord | undefined {
  return loadReports(storage).records.filter(r => r.player.playerSeasonId === playerSeasonId).sort(byUpdatedDesc)[0];
}

export interface CreateReportInput {
  player: ReportPlayerRef;
  dataSnapshot: ReportDataSnapshot;
  role?: string;
  status?: ReportStatus;
  tags?: string[];
  now?: string;
}

export function createReport(input: CreateReportInput, storage: StorageLike | null = defaultStorage()): ScoutReportRecord {
  const now = input.now ?? new Date().toISOString();
  const record: ScoutReportRecord = {
    id: newId(), schemaVersion: SCOUT_REPORT_SCHEMA_VERSION, player: input.player, createdAt: now, updatedAt: now,
    status: input.status ?? 'draft', ...(input.role ? { role: input.role } : {}), tags: [...new Set((input.tags ?? []).map(t => t.trim()).filter(Boolean))],
    dataSnapshot: input.dataSnapshot, generatedSummaries: [], observations: [],
  };
  mutate(storage, records => [record, ...records]);
  return record;
}

function update(id: string, fn: (r: ScoutReportRecord, now: string) => ScoutReportRecord, storage: StorageLike | null, now = new Date().toISOString()): ScoutReportRecord {
  let out: ScoutReportRecord | undefined;
  mutate(storage, records => records.map(r => { if (r.id !== id) return r; out = touch(fn(r, now), now); return out; }));
  if (!out) throw new ReportStoreError('Dossier introuvable.');
  return out;
}

/**
 * Nouvelle synthèse : ajoutée à l'historique, jamais à la place de l'ancienne. Les faits reçus
 * avec elle deviennent le snapshot courant du dossier (l'ancien texte garde sa date et son modèle).
 */
export function addSummary(id: string, summary: Omit<GeneratedSummary, 'id'>, snapshot?: Partial<ReportDataSnapshot>, storage: StorageLike | null = defaultStorage(), now?: string): ScoutReportRecord {
  return update(id, r => ({
    ...r,
    dataSnapshot: snapshot ? { ...r.dataSnapshot, ...snapshot } : r.dataSnapshot,
    generatedSummaries: [...r.generatedSummaries, { id: newId(), ...summary }],
  }), storage, now);
}

export type ObservationInput = Omit<ScoutObservation, 'id' | 'createdAt'>;

/** En mode aveugle, la première note globale saisie révèle les données (date conservée) */
const revealIfRated = (r: ScoutReportRecord, obs: ObservationInput, at: string): ScoutReportRecord =>
  r.evaluation?.blind && !r.evaluation.revealedAt && obs.grid?.overall !== undefined ? { ...r, evaluation: { ...r.evaluation, revealedAt: at } } : r;

export function addObservation(id: string, obs: ObservationInput, storage: StorageLike | null = defaultStorage(), now?: string): ScoutReportRecord {
  return update(id, (r, at) => revealIfRated({ ...r, observations: [...r.observations, { ...cleanObservation(obs), id: newId(), createdAt: at }] }, obs, at), storage, now);
}

export function updateObservation(id: string, obsId: string, obs: ObservationInput, storage: StorageLike | null = defaultStorage()): ScoutReportRecord {
  return update(id, (r, at) => {
    const clean = cleanObservation(obs);
    // Remplacement champ à champ : un champ facultatif retiré disparaît (grille, forces, conclusion)
    return revealIfRated({ ...r, observations: r.observations.map(o => (o.id === obsId ? { id: o.id, createdAt: o.createdAt, ...clean } : o)) }, obs, at);
  }, storage);
}

export function setBlind(id: string, blind: boolean, storage: StorageLike | null = defaultStorage()): ScoutReportRecord {
  return update(id, r => ({ ...r, evaluation: { ...(r.evaluation ?? {}), blind } }), storage);
}

/** Révélation manuelle d'un dossier en aveugle (sans note globale) */
export function reveal(id: string, storage: StorageLike | null = defaultStorage()): ScoutReportRecord {
  return update(id, (r, at) => ({ ...r, evaluation: { blind: r.evaluation?.blind ?? true, revealedAt: r.evaluation?.revealedAt ?? at } }), storage);
}

export function removeObservation(id: string, obsId: string, storage: StorageLike | null = defaultStorage()): ScoutReportRecord {
  return update(id, r => ({ ...r, observations: r.observations.filter(o => o.id !== obsId) }), storage);
}

const cleanObservation = (o: ObservationInput): ObservationInput => {
  const trim = (v: string | undefined) => (v && v.trim() ? v.trim() : undefined);
  if (!o.text.trim()) throw new ReportStoreError('Le texte de l\'observation est obligatoire.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(o.date)) throw new ReportStoreError('Date d\'observation invalide (AAAA-MM-JJ attendu).');
  if (!OBSERVATION_TYPES.includes(o.type)) throw new ReportStoreError('Type d\'observation inconnu.');
  const grid = o.grid ? parseGrid(o.grid) : null;
  if (o.grid && !grid) throw new ReportStoreError('Grille d\'observation invalide.');
  return {
    date: o.date, type: o.type, text: o.text.trim(),
    ...(trim(o.strengths) ? { strengths: trim(o.strengths) } : {}),
    ...(trim(o.toReview) ? { toReview: trim(o.toReview) } : {}),
    ...(trim(o.conclusion) ? { conclusion: trim(o.conclusion) } : {}),
    ...(grid ? { grid } : {}),
    ...(o.refs && o.refs.length ? { refs: o.refs } : {}),
  };
};

export function setStatus(id: string, status: ReportStatus, storage: StorageLike | null = defaultStorage()): ScoutReportRecord {
  return update(id, r => ({ ...r, status }), storage);
}

export function setTags(id: string, tags: string[], storage: StorageLike | null = defaultStorage()): ScoutReportRecord {
  return update(id, r => ({ ...r, tags: [...new Set(tags.map(t => t.trim()).filter(Boolean))] }), storage);
}

export function setRole(id: string, role: string | undefined, storage: StorageLike | null = defaultStorage()): ScoutReportRecord {
  return update(id, r => { const { role: _old, ...rest } = r; return role ? { ...rest, role } : rest; }, storage);
}

export function deleteReport(id: string, storage: StorageLike | null = defaultStorage()): void {
  mutate(storage, records => records.filter(r => r.id !== id));
}

// ============================================
// EXPORT / IMPORT JSON
// ============================================

export interface ReportsExport {
  app: 'ScoutVision';
  kind: typeof EXPORT_KIND;
  schemaVersion: typeof SCOUT_REPORT_SCHEMA_VERSION;
  exportedAt: string;
  reports: ScoutReportRecord[];
}

/** Fichier d'export : les dossiers seulement (aucune clé, aucun cache, aucune ligne joueur) */
export function exportReportsJson(records: ScoutReportRecord[], now = new Date().toISOString()): string {
  const payload: ReportsExport = { app: 'ScoutVision', kind: EXPORT_KIND, schemaVersion: SCOUT_REPORT_SCHEMA_VERSION, exportedAt: now, reports: records };
  return JSON.stringify(payload, null, 2);
}

export const exportFileName = (now = new Date()) => `ScoutVision_rapports_${now.toISOString().slice(0, 10)}.json`;

export interface ImportResult {
  added: number;
  updated: number;              // dossier déjà présent, version importée plus récente
  skipped: number;              // dossier déjà présent et à jour, ou enregistrement illisible
  errors: string[];
}

/**
 * Import d'un fichier d'export (ou d'un tableau brut de dossiers) : chaque dossier est validé
 * avant insertion ; un dossier au même identifiant n'est remplacé que par une version plus récente
 */
export function importReportsJson(text: string, storage: StorageLike | null = defaultStorage()): ImportResult {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return { added: 0, updated: 0, skipped: 0, errors: ['Fichier illisible : JSON invalide.'] }; }
  const list = Array.isArray(raw) ? raw : isObject(raw) && raw.kind === EXPORT_KIND && Array.isArray(raw.reports) ? raw.reports : null;
  if (!list) return { added: 0, updated: 0, skipped: 0, errors: ['Fichier non reconnu : ce n\'est pas un export de dossiers ScoutVision.'] };
  const result: ImportResult = { added: 0, updated: 0, skipped: 0, errors: [] };
  const incoming: ScoutReportRecord[] = [];
  list.forEach((item, i) => {
    const r = parseRecord(item);
    if (r) incoming.push(r); else { result.skipped++; result.errors.push(`Dossier n° ${i + 1} ignoré : structure ou version non prise en charge.`); }
  });
  if (incoming.length === 0) return result;
  mutate(storage, records => {
    const byId = new Map(records.map(r => [r.id, r]));
    incoming.forEach(r => {
      const existing = byId.get(r.id);
      if (!existing) { byId.set(r.id, r); result.added++; }
      else if (r.updatedAt > existing.updatedAt) { byId.set(r.id, r); result.updated++; }
      else result.skipped++;
    });
    return [...byId.values()];
  });
  return result;
}
