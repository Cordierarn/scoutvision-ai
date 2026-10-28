import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildReportRequest, generateScoutReport, ScoutReportError, SCOUT_REPORT_ENDPOINT } from './scoutReportService';

const player = { Player: 'Joueur Service', Team: 'Club', League: 'Ligue 2025-26', Position: 'ST', 'Matches played': 10, 'Minutes played': 900 };

afterEach(() => vi.unstubAllGlobals());

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
  it('appelle l\'endpoint serveur en POST JSON et renvoie le rapport', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ report: 'OK' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(generateScoutReport({ ...player, Player: 'Succès' })).resolves.toBe('OK');
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
});
