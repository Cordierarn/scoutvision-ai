import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildReportRequest, clearReportCache, generateScoutReport, reportCacheKey, reportFooterLabel, ScoutReportError, SCOUT_REPORT_ENDPOINT } from './scoutReportService';

const player = { Player: 'Joueur Service', Team: 'Club', League: 'Ligue 2025-26', Position: 'ST', 'Matches played': 10, 'Minutes played': 900 };

afterEach(() => { vi.unstubAllGlobals(); clearReportCache(); });

describe('buildReportRequest', () => {
  it('n\'envoie que les percentiles et les champs utiles des rôles et des tirs', () => {
    const body = buildReportRequest(player, {
      language: 'fr',
      percentileProfile: { player, percentiles: { xG: 90 }, zScores: { xG: 1 }, averages: {} },
      bestRoles: [{ role: 'Renard des surfaces', normalizedScore: 80 }],
      shotStats: { total: 10, goals: 3, xG: 2.5, xGDiff: 0.5, onTarget: 5, blocked: 1, conversion: 30, avgXG: 0.25 },
    });
    expect(body.options.percentiles).toEqual({ xG: 90 });
    expect(body.options.bestRoles).toEqual([{ role: 'Renard des surfaces', normalizedScore: 80 }]);
    expect(body.options.shotStats).toEqual({ total: 10, goals: 3, xG: 2.5, conversion: 30 });
    expect(JSON.stringify(body.options)).not.toContain('zScores');
  });
});

describe('generateScoutReport', () => {
  it('appelle l\'endpoint serveur en POST JSON et renvoie le rapport avec le modèle utilisé', async () => {
    const meta = { model: 'gemini-3.6-flash', requestedModel: 'gemini-3.5-flash', generatedAt: '2026-10-28T12:00:00.000Z' };
    const facts = { player: { name: 'Succès' }, sample: {}, metrics: [] };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ content: 'OK', meta, facts, promptVersion: 'scout-report-v2' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await generateScoutReport({ ...player, Player: 'Succès' }, { seasonInProgress: true });
    expect(result).toEqual({ content: 'OK', meta, facts, promptVersion: 'scout-report-v2' });
    expect(reportFooterLabel(result.meta)).toBe('Généré par gemini-3.6-flash');
    expect(JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body)).options.seasonInProgress).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(SCOUT_REPORT_ENDPOINT);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('lève une ScoutReportError avec le message du serveur', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Clé absente' }), { status: 503 })));
    await expect(generateScoutReport({ ...player, Player: 'Erreur' })).rejects.toMatchObject({ name: 'ScoutReportError', message: 'Clé absente', status: 503 });
  });

  it('lève une ScoutReportError si le serveur est injoignable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network'); }));
    await expect(generateScoutReport({ ...player, Player: 'Réseau' })).rejects.toBeInstanceOf(ScoutReportError);
  });

  it('sans métadonnées du serveur, le pied du rapport ne prétend aucun modèle', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ report: 'OK' }), { status: 200 })));
    const result = await generateScoutReport({ ...player, Player: 'Sans meta' });
    expect(result.meta).toBeNull();
    expect(result.content).toBe('OK');
    expect(result.facts).toBeNull();
    expect(result.promptVersion).toBeNull();
    expect(reportFooterLabel(result.meta)).toBe('Généré par IA');
  });
});

describe('reportCacheKey (identité par ligne joueur-saison)', () => {
  const base = { ...player, League: 'Ligue 1 2026-27', 'Player ID': 'p1', 'Team ID': 't1', Competition: 'FRA-L1', Season: '2026-27' };
  it('distingue deux homonymes (identifiants différents, même nom, club et compétition)', () => {
    expect(reportCacheKey(base)).not.toBe(reportCacheKey({ ...base, 'Player ID': 'p2' }));
  });
  it('distingue championnat et coupe, et deux saisons du même joueur', () => {
    expect(reportCacheKey(base)).not.toBe(reportCacheKey({ ...base, Competition: 'EUR-UCL' }));
    expect(reportCacheKey(base)).not.toBe(reportCacheKey({ ...base, League: 'Ligue 1 2025-26', Season: '2025-26' }));
  });
  it('distingue deux clubs successifs d\'un même joueur dans la même saison', () => {
    expect(reportCacheKey(base)).not.toBe(reportCacheKey({ ...base, 'Team ID': 't2' }));
  });
  it('change avec les minutes et les rôles transmis (éléments déterminants du snapshot)', () => {
    expect(reportCacheKey(base)).not.toBe(reportCacheKey({ ...base, 'Minutes played': 1500 }));
    expect(reportCacheKey(base, { bestRoles: [{ role: 'A', normalizedScore: 70 }] })).not.toBe(reportCacheKey(base, { bestRoles: [{ role: 'A', normalizedScore: 75 }] }));
  });
  it('ne sert jamais à un homonyme le rapport en cache d\'un autre joueur', async () => {
    const fetchMock = vi.fn(async (_u: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ content: `Rapport ${body.player['Player ID']}`, meta: { model: 'm', requestedModel: 'm', generatedAt: '2026-10-29T00:00:00.000Z' } }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const a = await generateScoutReport(base);
    const b = await generateScoutReport({ ...base, 'Player ID': 'p2' });
    const again = await generateScoutReport(base);
    expect(a.content).toBe('Rapport p1');
    expect(b.content).toBe('Rapport p2');
    expect(again.content).toBe('Rapport p1');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
