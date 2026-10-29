import { beforeEach, describe, expect, it } from 'vitest';
import {
  addObservation, addSummary, createReport, deleteReport, exportFileName, exportReportsJson, findReportForPlayer, getReport, importReportsJson, loadReports,
  parseRecord, removeObservation, saveReports, SCOUT_REPORTS_KEY, setRole, setStatus, setTags, StorageLike, subscribeReports, updateObservation,
} from './scoutReportStore';
import { ReportDataSnapshot, ReportPlayerRef, ScoutReportRecord } from '../types/scoutReport';

class MemoryStorage implements StorageLike {
  map = new Map<string, string>();
  getItem(k: string) { return this.map.get(k) ?? null; }
  setItem(k: string, v: string) { this.map.set(k, v); }
}

const playerRef = (over: Partial<ReportPlayerRef> = {}): ReportPlayerRef => ({
  playerSeasonId: 'p1_t1_FRA-L1_2026-27', playerId: 'p1', name: 'Joueur Test', season: '2026-27', teamId: 't1', team: 'Club', competition: 'FRA-L1', position: 'ST', ...over,
});
const snapshot = (): ReportDataSnapshot => ({
  facts: {
    player: { name: 'Joueur Test', age: 21 }, sample: { minutes: 900, matches: 10 }, teamContext: {},
    values: { marketValueTransfermarkt: null, estimatedValueScoutVision: null, estimatedValueTypicalError: null },
    contractUntil: null, scoutVisionRoleIndices: [{ role: 'Renard des surfaces', index: 78 }],
    metrics: [{ metric: 'xG par 90', value: 0.5, percentile: 88 }], otherStats: [], shots: null, scoutVisionIndicators: [],
  },
  bestRoles: [{ role: 'Renard des surfaces', index: 78 }], dataUpdatedAt: '2026-10-20T00:00:00.000Z',
});

let storage: MemoryStorage;
beforeEach(() => { storage = new MemoryStorage(); });

describe('stockage : créer, lire, modifier, supprimer', () => {
  it('crée un dossier brouillon sans synthèse ni observation, retrouvé par playerSeasonId', () => {
    const r = createReport({ player: playerRef(), dataSnapshot: snapshot(), role: 'Renard des surfaces', now: '2026-10-29T10:00:00.000Z' }, storage);
    expect(r.schemaVersion).toBe(1);
    expect(r.status).toBe('draft');
    expect(r.generatedSummaries).toEqual([]);
    expect(r.observations).toEqual([]);
    expect(loadReports(storage)).toEqual({ records: [r], ignored: 0 });
    expect(findReportForPlayer('p1_t1_FRA-L1_2026-27', storage)?.id).toBe(r.id);
    expect(getReport(r.id, storage)).toEqual(r);
    expect(JSON.parse(storage.getItem(SCOUT_REPORTS_KEY)!)).toHaveLength(1);
  });

  it('statut, rôle et tags mettent à jour updatedAt ; la suppression retire le dossier', () => {
    const r = createReport({ player: playerRef(), dataSnapshot: snapshot(), now: '2026-10-29T10:00:00.000Z' }, storage);
    const s = setStatus(r.id, 'to_observe', storage);
    expect(s.status).toBe('to_observe');
    expect(s.updatedAt > r.updatedAt).toBe(true);
    expect(setTags(r.id, [' prêt ', 'prêt', '', 'gaucher'], storage).tags).toEqual(['prêt', 'gaucher']);
    expect(setRole(r.id, 'Finisseur', storage).role).toBe('Finisseur');
    expect(setRole(r.id, undefined, storage).role).toBeUndefined();
    deleteReport(r.id, storage);
    expect(loadReports(storage).records).toEqual([]);
  });

  it('prévient les abonnés après chaque écriture', () => {
    let calls = 0;
    const off = subscribeReports(() => { calls++; });
    const r = createReport({ player: playerRef(), dataSnapshot: snapshot() }, storage);
    setStatus(r.id, 'finalized', storage);
    off();
    setStatus(r.id, 'archived', storage);
    expect(calls).toBe(2);
  });
});

describe('stockage : robustesse en lecture', () => {
  it('ignore individuellement un enregistrement corrompu et garde les autres', () => {
    const ok = createReport({ player: playerRef(), dataSnapshot: snapshot() }, storage);
    const raw = JSON.parse(storage.getItem(SCOUT_REPORTS_KEY)!);
    raw.push({ id: 'x', schemaVersion: 1 }, 'texte', null, { ...raw[0], id: 'v2', schemaVersion: 2 }, { ...raw[0] });   // le dernier : identifiant en double
    storage.setItem(SCOUT_REPORTS_KEY, JSON.stringify(raw));
    const loaded = loadReports(storage);
    expect(loaded.records.map(r => r.id)).toEqual([ok.id]);
    expect(loaded.ignored).toBe(5);   // 4 illisibles + 1 doublon
  });

  it('JSON invalide ou valeur non tableau : aucun dossier, un élément ignoré, pas d\'exception', () => {
    storage.setItem(SCOUT_REPORTS_KEY, '{oops');
    expect(loadReports(storage)).toEqual({ records: [], ignored: 1 });
    storage.setItem(SCOUT_REPORTS_KEY, '{"a":1}');
    expect(loadReports(storage)).toEqual({ records: [], ignored: 1 });
    expect(loadReports(null)).toEqual({ records: [], ignored: 0 });
  });

  it('refuse une version de schéma inconnue et un statut hors liste', () => {
    const r = createReport({ player: playerRef(), dataSnapshot: snapshot() }, storage);
    expect(parseRecord({ ...r, schemaVersion: 0 })).toBeNull();
    expect(parseRecord({ ...r, schemaVersion: '1' })).toBeNull();
    expect(parseRecord({ ...r, status: 'validé' })).toBeNull();
    expect(parseRecord({ ...r, player: { name: 'sans identifiant' } })).toBeNull();
  });

  it('une synthèse ou une observation illisible est écartée sans perdre le dossier', () => {
    const r = createReport({ player: playerRef(), dataSnapshot: snapshot() }, storage);
    const parsed = parseRecord({
      ...r,
      generatedSummaries: [{ id: 's1', model: 'm', promptVersion: 'scout-report-v2', generatedAt: '2026-10-29T00:00:00.000Z', content: 'ok' }, { id: 's2' }],
      observations: [{ id: 'o1', date: '2026-10-29', type: 'video', text: 'vu' }, { id: 'o2', date: '2026-10-29', type: 'audio', text: 'non' }],
    });
    expect(parsed?.generatedSummaries.map(s => s.id)).toEqual(['s1']);
    expect(parsed?.observations.map(o => o.id)).toEqual(['o1']);
  });

  it('signale une erreur lisible quand le stockage refuse l\'écriture (quota)', () => {
    const full: StorageLike = { getItem: () => null, setItem: () => { throw new DOMException('quota', 'QuotaExceededError'); } };
    expect(() => saveReports([], full)).toThrow(/Exportez vos dossiers en JSON/);
  });
});

describe('identité des dossiers : une ligne joueur-saison = un dossier', () => {
  it('sépare championnat et coupe, deux clubs successifs, deux saisons et deux homonymes', () => {
    const ids = ['p1_t1_FRA-L1_2026-27', 'p1_t1_EUR-UCL_2026-27', 'p1_t2_FRA-L1_2026-27', 'p1_t1_FRA-L1_2025-26', 'p9_t1_FRA-L1_2026-27'];
    ids.forEach(id => createReport({ player: playerRef({ playerSeasonId: id }), dataSnapshot: snapshot() }, storage));
    expect(loadReports(storage).records).toHaveLength(5);
    ids.forEach(id => expect(findReportForPlayer(id, storage)?.player.playerSeasonId).toBe(id));
    expect(findReportForPlayer('Joueur Test_Club_FRA-L1_2026-27', storage)).toBeUndefined();
  });
});

describe('synthèses générées : versions', () => {
  it('ajoute une version sans écraser la précédente et garde le modèle réel et la version du prompt', () => {
    const r = createReport({ player: playerRef(), dataSnapshot: snapshot() }, storage);
    const v1 = addSummary(r.id, { model: 'gemini-3.6-flash', requestedModel: 'gemini-3.5-flash', promptVersion: 'scout-report-v2', generatedAt: '2026-10-29T10:00:00.000Z', content: 'Version 1' }, undefined, storage);
    const facts2 = { ...snapshot().facts, sample: { minutes: 1200, matches: 14 } };
    const v2 = addSummary(r.id, { model: 'gemini-3.6-pro', promptVersion: 'scout-report-v2', generatedAt: '2026-10-30T10:00:00.000Z', content: 'Version 2' }, { facts: facts2 }, storage);
    expect(v1.generatedSummaries).toHaveLength(1);
    expect(v2.generatedSummaries.map(s => s.content)).toEqual(['Version 1', 'Version 2']);
    expect(v2.generatedSummaries[0].model).toBe('gemini-3.6-flash');
    expect(v2.generatedSummaries[0].requestedModel).toBe('gemini-3.5-flash');
    expect(v2.generatedSummaries[1].promptVersion).toBe('scout-report-v2');
    expect(v2.dataSnapshot.facts.sample).toEqual({ minutes: 1200, matches: 14 });
    expect(v2.dataSnapshot.bestRoles).toEqual(snapshot().bestRoles);   // le reste du snapshot est conservé
    expect(new Set(v2.generatedSummaries.map(s => s.id)).size).toBe(2);
  });
});

describe('observations humaines', () => {
  it('ajoute, modifie et supprime une observation, jamais mélangée aux synthèses IA', () => {
    const r = createReport({ player: playerRef(), dataSnapshot: snapshot() }, storage);
    const a = addObservation(r.id, { type: 'video', date: '2026-10-28', text: 'Bonne prise d\'information.', strengths: 'Orientation', toReview: '', conclusion: 'À revoir en live' }, storage, '2026-10-28T20:00:00.000Z');
    expect(a.observations).toHaveLength(1);
    expect(a.observations[0]).toMatchObject({ type: 'video', date: '2026-10-28', text: 'Bonne prise d\'information.', strengths: 'Orientation', conclusion: 'À revoir en live', createdAt: '2026-10-28T20:00:00.000Z' });
    expect(a.observations[0]).not.toHaveProperty('toReview');
    expect(a.generatedSummaries).toHaveLength(0);
    const u = updateObservation(r.id, a.observations[0].id, { type: 'live', date: '2026-10-29', text: 'Confirmé au stade.' }, storage);
    expect(u.observations[0]).toMatchObject({ id: a.observations[0].id, type: 'live', text: 'Confirmé au stade.', createdAt: '2026-10-28T20:00:00.000Z' });
    expect(removeObservation(r.id, a.observations[0].id, storage).observations).toEqual([]);
  });

  it('refuse une observation vide ou sans date valide', () => {
    const r = createReport({ player: playerRef(), dataSnapshot: snapshot() }, storage);
    expect(() => addObservation(r.id, { type: 'general', date: '2026-10-29', text: '   ' }, storage)).toThrow();
    expect(() => addObservation(r.id, { type: 'general', date: '29/10/2026', text: 'ok' }, storage)).toThrow();
  });
});

describe('export / import JSON', () => {
  it('exporte uniquement les dossiers, dans une enveloppe versionnée, et réimporte à l\'identique', () => {
    const r = createReport({ player: playerRef(), dataSnapshot: snapshot(), tags: ['prêt'] }, storage);
    addSummary(r.id, { model: 'm', promptVersion: 'scout-report-v2', generatedAt: '2026-10-29T10:00:00.000Z', content: 'Synthèse' }, undefined, storage);
    const full = addObservation(r.id, { type: 'live', date: '2026-10-29', text: 'Observation' }, storage);
    const text = exportReportsJson([full], '2026-10-29T12:00:00.000Z');
    const parsed = JSON.parse(text);
    expect(parsed).toMatchObject({ app: 'ScoutVision', kind: 'scoutvision-scout-reports', schemaVersion: 1, exportedAt: '2026-10-29T12:00:00.000Z' });
    expect(Object.keys(parsed)).toEqual(['app', 'kind', 'schemaVersion', 'exportedAt', 'reports']);
    expect(text).not.toMatch(/GEMINI|apiKey|AIza/i);
    expect(exportFileName(new Date('2026-10-29T12:00:00.000Z'))).toBe('ScoutVision_rapports_2026-10-29.json');

    const other = new MemoryStorage();
    expect(importReportsJson(text, other)).toEqual({ added: 1, updated: 0, skipped: 0, errors: [] });
    expect(loadReports(other).records).toEqual([full]);
    // Réimport : à jour, ignoré ; version plus récente : remplacée
    expect(importReportsJson(text, other).skipped).toBe(1);
    const newer = { ...full, updatedAt: '2027-01-01T00:00:00.000Z', status: 'finalized' };
    expect(importReportsJson(JSON.stringify([newer]), other)).toMatchObject({ updated: 1 });
    expect(getReport(full.id, other)?.status).toBe('finalized');
  });

  it('refuse un fichier invalide ou étranger et ignore les dossiers illisibles un par un', () => {
    expect(importReportsJson('pas du json', storage).errors[0]).toMatch(/JSON invalide/);
    expect(importReportsJson(JSON.stringify({ kind: 'autre', reports: [] }), storage).errors[0]).toMatch(/non reconnu/);
    const good = createReport({ player: playerRef(), dataSnapshot: snapshot() }, new MemoryStorage());
    const res = importReportsJson(JSON.stringify({ app: 'ScoutVision', kind: 'scoutvision-scout-reports', schemaVersion: 1, exportedAt: 'x', reports: [good, { id: 'bad' }, 42] }), storage);
    expect(res).toMatchObject({ added: 1, skipped: 2 });
    expect(res.errors).toHaveLength(2);
    expect(loadReports(storage).records.map((r: ScoutReportRecord) => r.id)).toEqual([good.id]);
  });
});
