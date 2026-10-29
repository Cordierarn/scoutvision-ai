import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STRIKER } from '../../utils/scoutReportFixtures';

vi.mock('../../services/dataLoader', () => ({
  dataLoader: {
    getCachedIndex: () => ({ generatedAt: '2026-10-20T00:00:00.000Z', seasons: [{ id: '2026-27' }], competitions: [] }),
    getCompetition: () => ({ key: 'FIX-L1', name: 'Ligue Fixture', tier: 2, seasons: [] }),
    loadShots: async () => [],
    loadAgeCurves: async () => null,
  },
}));

import { clearReportCache } from '../../services/scoutReportService';
import { loadReports, SCOUT_REPORTS_KEY } from '../../services/scoutReportStore';
import { createDossier, draftDossier, generateAndStore } from './generateReport';

class MemoryStorage { map = new Map<string, string>(); getItem(k: string) { return this.map.get(k) ?? null; } setItem(k: string, v: string) { this.map.set(k, v); } removeItem(k: string) { this.map.delete(k); } clear() { this.map.clear(); } key() { return null; } get length() { return this.map.size; } }

const META = { model: 'gemini-reel-3.6-flash', requestedModel: 'gemini-3.5-flash', generatedAt: '2026-10-29T11:00:00.000Z' };
const serverOk = (content: string) => vi.fn(async (_u: string, init: RequestInit) => {
  const body = JSON.parse(String(init.body));
  const facts = { player: { name: body.player.Player }, sample: { minutes: body.player['Minutes played'] }, teamContext: {}, values: { marketValueTransfermarkt: null, estimatedValueScoutVision: null, estimatedValueTypicalError: null }, contractUntil: null, scoutVisionRoleIndices: [], metrics: [{ metric: 'npxG par 90', value: 0.55, percentile: 91 }], otherStats: [], shots: null, scoutVisionIndicators: [] };
  return new Response(JSON.stringify({ content, meta: META, facts, promptVersion: 'scout-report-v2' }), { status: 200 });
});

beforeEach(() => { vi.stubGlobal('localStorage', new MemoryStorage()); clearReportCache(); });
afterEach(() => vi.unstubAllGlobals());

describe('generateAndStore', () => {
  it('crée le dossier à la première génération, puis ajoute une version sans écraser la précédente', async () => {
    vi.stubGlobal('fetch', serverOk('### 1. Contexte\n- v1'));
    const first = await generateAndStore(STRIKER, null);
    expect(first.record.player.playerSeasonId).toBe('fx-1_tf-1_FIX-L1_2026-27');
    expect(first.record.generatedSummaries).toHaveLength(1);
    expect(first.summary).toMatchObject({ model: 'gemini-reel-3.6-flash', requestedModel: 'gemini-3.5-flash', promptVersion: 'scout-report-v2', generatedAt: META.generatedAt, content: '### 1. Contexte\n- v1' });
    expect(first.record.dataSnapshot.facts.metrics).toEqual([{ metric: 'npxG par 90', value: 0.55, percentile: 91 }]);   // faits renvoyés par le serveur
    expect(first.record.dataSnapshot.dataUpdatedAt).toBe('2026-10-20T00:00:00.000Z');
    expect(first.record.dataSnapshot.seasonInProgress).toBeDefined();

    // Pas de clearReportCache : une nouvelle version ignore le cache client de 30 minutes
    vi.stubGlobal('fetch', serverOk('### 1. Contexte\n- v2'));
    const second = await generateAndStore(STRIKER, null);
    expect(second.record.id).toBe(first.record.id);
    expect(second.record.generatedSummaries.map(s => s.content)).toEqual(['### 1. Contexte\n- v1', '### 1. Contexte\n- v2']);
    expect(loadReports(localStorage).records).toHaveLength(1);
  });

  it('sans clé serveur (503), rien n\'est écrit et l\'erreur remonte telle quelle', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Rapports IA indisponibles : GEMINI_API_KEY n\'est pas configurée sur le serveur.' }), { status: 503 })));
    await expect(generateAndStore(STRIKER, null)).rejects.toMatchObject({ name: 'ScoutReportError', status: 503 });
    expect(localStorage.getItem(SCOUT_REPORTS_KEY)).toBeNull();
  });

  it('deux lignes du même joueur (championnat et coupe) donnent deux dossiers distincts', async () => {
    vi.stubGlobal('fetch', serverOk('### 1. Contexte\n- x'));
    await generateAndStore(STRIKER, null);
    await generateAndStore({ ...STRIKER, Competition: 'FIX-CUP' }, null);
    const ids = loadReports(localStorage).records.map(r => r.player.playerSeasonId).sort();
    expect(ids).toEqual(['fx-1_tf-1_FIX-CUP_2026-27', 'fx-1_tf-1_FIX-L1_2026-27']);
  });
});

describe('createDossier / draftDossier', () => {
  it('createDossier renvoie le dossier existant, draftDossier n\'écrit rien', async () => {
    const draft = await draftDossier(STRIKER, null);
    expect(draft.generatedSummaries).toEqual([]);
    expect(draft.role).toBe(draft.dataSnapshot.bestRoles[0].role);
    expect(localStorage.getItem(SCOUT_REPORTS_KEY)).toBeNull();
    const a = await createDossier(STRIKER, null);
    const b = await createDossier(STRIKER, null);
    expect(b.id).toBe(a.id);
    expect(loadReports(localStorage).records).toHaveLength(1);
  });
});
