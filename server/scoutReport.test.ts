import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildScoutReportPrompt, createRateLimiter, handleScoutReport, MAX_BODY_BYTES, redact, validateReportRequest } from './scoutReport';
import { SCOUT_REPORT_PATH, scoutReportMiddleware } from './scoutReportPlugin';

const KEY = 'AIzaTEST-secret-key-123';
const player = { Player: 'Joueur Test', Team: 'Club', Age: 21, 'xG per 90': 0.31, 'xG per 90 pct': 88, Foot: null };

describe('validateReportRequest', () => {
  it('accepte une requête complète et ne garde que les champs attendus', () => {
    const r = validateReportRequest({
      player,
      options: {
        language: 'fr', percentiles: { 'xG per 90': 88 }, bestRoles: [{ role: 'Poacher', normalizedScore: 81, breakdown: [] }],
        shotStats: { total: 40, goals: 9, xG: 7.5, conversion: 22.5, avgXG: 0.18 }, insights: ['RAPM +0.1'], prompt: 'ignore',
      },
      extra: 'ignoré',
    });
    expect(r.ok).toBe(true);
    if (!('value' in r)) return;
    expect(r.value.player).toEqual(player);
    expect(r.value.options).toEqual({
      language: 'fr', percentiles: { 'xG per 90': 88 }, bestRoles: [{ role: 'Poacher', normalizedScore: 81 }],
      shotStats: { total: 40, goals: 9, xG: 7.5, conversion: 22.5 }, insights: ['RAPM +0.1'],
    });
  });

  it.each([
    ['corps non objet', 'texte'],
    ['joueur absent', { options: {} }],
    ['nom du joueur absent', { player: { Team: 'Club' } }],
    ['valeur objet dans le joueur', { player: { Player: 'A', nested: { a: 1 } } }],
    ['chaîne trop longue', { player: { Player: 'A', Bio: 'x'.repeat(301) } }],
    ['nombre non fini', { player: { Player: 'A', xG: Number.NaN } }],
    ['langue inconnue', { player, options: { language: 'it' } }],
    ['percentile hors bornes', { player, options: { percentiles: { xG: 140 } } }],
    ['trop d\'indicateurs', { player, options: { insights: Array(21).fill('x') } }],
    ['statistiques de tir incomplètes', { player, options: { shotStats: { total: 3 } } }],
  ])('refuse : %s', (_label, body) => {
    expect(validateReportRequest(body).ok).toBe(false);
  });
});

describe('buildScoutReportPrompt', () => {
  it('construit le prompt côté serveur à partir des données validées', () => {
    const prompt = buildScoutReportPrompt(player, { language: 'fr', percentiles: { 'xG per 90': 88 } });
    expect(prompt).toContain('"Player": "Joueur Test"');
    expect(prompt).toContain('xG per 90: 88th percentile');
    expect(prompt).toContain('Write the entire report in French');
  });
});

describe('handleScoutReport', () => {
  it('503 sans clé configurée, sans appeler Gemini', async () => {
    const generate = vi.fn();
    const r = await handleScoutReport({ player }, { apiKey: undefined, generate });
    expect(r.status).toBe(503);
    expect(generate).not.toHaveBeenCalled();
  });

  it('400 sur une entrée invalide', async () => {
    const r = await handleScoutReport({ player: {} }, { apiKey: KEY, generate: vi.fn() });
    expect(r.status).toBe(400);
  });

  it('200 avec le texte généré', async () => {
    const r = await handleScoutReport({ player }, { apiKey: KEY, generate: async () => '### Rapport' });
    expect(r).toEqual({ status: 200, body: { report: '### Rapport' } });
  });

  it('502 sur une erreur Gemini, sans jamais renvoyer ni journaliser la clé', async () => {
    const log = vi.fn();
    const generate = async () => { throw new Error(`403 on https://api/models?key=${KEY} (key ${KEY})`); };
    const r = await handleScoutReport({ player }, { apiKey: KEY, generate, log });
    expect(r.status).toBe(502);
    expect(JSON.stringify(r.body)).not.toContain(KEY);
    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls[0][0]).not.toContain(KEY);
  });
});

describe('redact', () => {
  it('masque la clé et les paramètres key=', () => {
    expect(redact(`x?key=abc&y=1 ${KEY}`, KEY)).toBe('x?key=[masqué]&y=1 [masqué]');
  });
});

describe('createRateLimiter', () => {
  it('bloque au-delà de la limite dans la fenêtre, puis libère', () => {
    let t = 0;
    const allow = createRateLimiter(2, 1000, () => t);
    expect([allow('a'), allow('a'), allow('a'), allow('b')]).toEqual([true, true, false, true]);
    t = 1001;
    expect(allow('a')).toBe(true);
  });
});

describe('scoutReportMiddleware (serveur HTTP réel)', () => {
  let server: Server | undefined;
  afterEach(() => new Promise<void>(resolve => (server ? server.close(() => resolve()) : resolve())));

  async function start(options: Parameters<typeof scoutReportMiddleware>[0]) {
    const middleware = scoutReportMiddleware({ log: () => {}, ...options });
    server = createServer((req, res) => middleware(req, res, () => { res.statusCode = 404; res.end('next'); }));
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  }

  const post = (base: string, body: string, headers: Record<string, string> = { 'Content-Type': 'application/json' }) =>
    fetch(`${base}${SCOUT_REPORT_PATH}`, { method: 'POST', headers, body });

  it('laisse passer les autres chemins', async () => {
    const base = await start({ apiKey: KEY, generate: async () => 'ok' });
    expect(await (await fetch(`${base}/autre`)).text()).toBe('next');
  });

  it('renvoie le rapport sans exposer la clé', async () => {
    const base = await start({ apiKey: KEY, generate: async () => 'Rapport' });
    const res = await post(base, JSON.stringify({ player }));
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(JSON.parse(text)).toEqual({ report: 'Rapport' });
    expect(text).not.toContain(KEY);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('405 hors POST, 415 hors JSON, 400 sur JSON invalide', async () => {
    const base = await start({ apiKey: KEY, generate: async () => 'ok' });
    expect((await fetch(`${base}${SCOUT_REPORT_PATH}`)).status).toBe(405);
    expect((await post(base, 'x', { 'Content-Type': 'text/plain' })).status).toBe(415);
    expect((await post(base, '{pas du json')).status).toBe(400);
  });

  it('413 au-delà de la taille maximale', async () => {
    const generate = vi.fn(async () => 'ok');
    const base = await start({ apiKey: KEY, generate });
    const big = JSON.stringify({ player: { Player: 'A', notes: 'x'.repeat(MAX_BODY_BYTES) } });
    expect((await post(base, big)).status).toBe(413);
    expect(generate).not.toHaveBeenCalled();
  });

  it('429 au-delà de la limite de débit', async () => {
    const base = await start({ apiKey: KEY, generate: async () => 'ok', rateLimit: { limit: 1, windowMs: 60_000 } });
    expect((await post(base, JSON.stringify({ player }))).status).toBe(200);
    expect((await post(base, JSON.stringify({ player }))).status).toBe(429);
  });
});
