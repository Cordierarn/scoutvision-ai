import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AI_PROMPT_VERSIONS, AiHunterResponse, AiTextResponse, auditGroundedText, buildCompareFacts, buildComparePrompt, buildHunterPrompt, cleanFacts, extractJson,
  handleGroundedAi, sanitizeGroundedText, validateCompare, validateHunter, validateHunterConfig, validateOpposition,
} from './groundedAi';
import { scoutReportMiddleware } from './scoutReportPlugin';

const KEY = 'AIzaTEST-secret-key-123';     // clé factice de test, jamais une vraie clé
const starter = { Player: 'Titulaire Test', Team: 'Club A', Age: 29, 'xG per 90': 0.41, 'xG per 90 pct': 80, 'Matches played': 10, 'Minutes played': 900 };
const candidate = { Player: 'Candidat Test', Team: 'Club B', Age: 22, 'xG per 90': 0.33, 'xG per 90 pct': 71, 'Matches played': 12, 'Minutes played': 1000 };
const catalogue = {
  positions: ['ST', 'CB'], roles: [{ name: 'Renard des surfaces', positions: ['ST'] }, { name: 'Défenseur relanceur', positions: ['CB'] }],
  metrics: [{ key: 'npxG per 90', label: 'npxG par 90' }, { key: 'Aerial duels won, %', label: 'Duels aériens gagnés, %' }],
  competitions: [{ key: 'FRA', name: 'Ligue 1' }], capabilities: { marketValue: true, contract: true, estimate: false },
};
const GOOD_COMPARE = ['### 1. Profils en présence', '- Titulaire Test : xG par 90 0,41 (P80) sur 900 minutes.', '### 2. Principales différences', '- Candidat Test : 0,33 (P71).',
  '### 3. Complémentarité et contexte', '- 22 ans contre 29 ans.', '### 4. Points à vérifier en observation', '- Vérifier la finition en vidéo.'].join('\n');

describe('validation des requêtes', () => {
  it('compare : 2 à 4 lignes joueur nettoyées, cadrage et rôle facultatifs', () => {
    const v = validateCompare({ players: [{ row: starter, bestRoles: [{ role: 'R', normalizedScore: 70 }] }, { row: candidate }], framing: 'candidate_vs_incumbent', role: 'R' });
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.value.players).toHaveLength(2);
      expect(v.value.framing).toBe('candidate_vs_incumbent');
      const facts = buildCompareFacts(v.value);
      expect(facts.players[0].player.name).toBe('Titulaire Test');
      expect(facts.players[0].scoutVisionRoleIndices).toEqual([{ role: 'R', index: 70 }]);
      expect(buildComparePrompt(facts)).toContain('The first player is the current starter');
    }
    expect(validateCompare({ players: [{ row: starter }] }).ok).toBe(false);
    expect(validateCompare({ players: [{ row: { Player: '' } }, { row: candidate }] }).ok).toBe(false);
    expect(validateCompare({ players: [{ row: { ...starter, nested: { a: 1 } } }, { row: candidate }] }).ok).toBe(false);
  });
  it('opposition : faits bornés (profondeur, tailles, chaînes), équipe obligatoire', () => {
    expect(validateOpposition({ team: { name: 'Équipe', matches: 10 }, ranks: [{ metric: 'PPDA', value: 9.1, rank: 3, of: 20 }] }).ok).toBe(true);
    expect(validateOpposition({ ranks: [] }).ok).toBe(false);
    expect(validateOpposition({ team: { name: 'x'.repeat(400) } }).ok).toBe(false);
    expect(() => cleanFacts({ a: { b: { c: { d: { e: { f: { g: { h: 1 } } } } } } } })).toThrow(/profond/);
    expect(() => cleanFacts({ a: Number.NaN })).toThrow(/nombre/);
    expect(() => cleanFacts({ a: () => 1 })).toThrow(/non prise en charge/);
  });
  it('hunter : demande bornée et catalogue typé', () => {
    expect(validateHunter({ query: ' un neuf de moins de 23 ans ', catalogue }).ok).toBe(true);
    expect(validateHunter({ query: '', catalogue }).ok).toBe(false);
    expect(validateHunter({ query: 'x'.repeat(501), catalogue }).ok).toBe(false);
    expect(validateHunter({ query: 'ok', catalogue: { ...catalogue, roles: [{ name: 3 }] } }).ok).toBe(false);
    expect(buildHunterPrompt({ query: 'q', catalogue })).toContain('Answer with a single JSON object');
  });
});

describe('configuration du Chasseur validée contre le catalogue', () => {
  it('garde ce qui est dans le catalogue et signale le reste ; le modèle ne calcule rien', () => {
    const { config, warnings } = validateHunterConfig({
      position: 'ST', role: 'Renard des surfaces', ageMax: 23.4, minutesMin: 600, valueMax: 15000000, contractMonths: 12, estimateAboveMarket: true, competition: 'FRA',
      extraCriteria: [{ metric: 'npxG per 90', minPercentile: 70 }, { metric: 'Vitesse', minPercentile: 80 }, { metric: 'Aerial duels won, %', minPercentile: 140 }],
      explanation: 'Attaquant U23 en Ligue 1 avec un bon npxG ; la vitesse n\'est pas mesurée.',
    }, catalogue);
    expect(config).toEqual({ position: 'ST', role: 'Renard des surfaces', ageMax: 23, minutesMin: 600, valueMax: 15000000, contractMonths: 12, competition: 'FRA', extraCriteria: [{ metric: 'npxG per 90', minPercentile: 70 }], explanation: 'Attaquant U23 en Ligue 1 avec un bon npxG ; la vitesse n\'est pas mesurée.' });
    expect(warnings).toEqual(['estimation statistique indisponible dans la saison chargée', 'métrique inconnue « Vitesse »', 'percentile invalide pour Aerial duels won, %']);
  });
  it('rôle incompatible avec le poste, poste inconnu, valeurs hors plage', () => {
    const { config, warnings } = validateHunterConfig({ position: 'GK', role: 'Défenseur relanceur', ageMax: 99, valueMax: -1 }, catalogue);
    expect(config.position).toBe('CB');   // le rôle fixe le poste quand le poste demandé est inconnu
    expect(config.ageMax).toBeUndefined();
    expect(warnings).toEqual(['poste inconnu « GK »', 'âge maximum hors plage', 'valeur maximale hors plage']);
    expect(validateHunterConfig({ position: 'ST', role: 'Défenseur relanceur' }, catalogue).warnings).toEqual(['rôle « Défenseur relanceur » incompatible avec le poste ST']);
  });
  it('extractJson tolère une clôture de code et refuse le reste', () => {
    expect(extractJson('```json\n{"position":"ST"}\n```')).toEqual({ position: 'ST' });
    expect(extractJson('Voici : {"a":1} merci')).toEqual({ a: 1 });
    expect(extractJson('pas de json')).toBeNull();
    expect(extractJson('[1,2]')).toBeNull();
  });
});

describe('audit générique du texte', () => {
  const facts = { players: [{ player: { name: 'A', age: 29 }, metrics: [{ metric: 'xG par 90', value: 0.41, percentile: 80 }] }] };
  it('rejette un nombre absent des faits, un sujet non mesuré, un verdict ; garde le reste', () => {
    const text = '### 1. Titre\n- xG par 90 : 0,41 (P80). Il court à 34 km/h et a 29 ans.\n- Leader de vestiaire. À recruter.';
    const issues = auditGroundedText(text, facts, ['Titre']);
    expect(issues.map(i => i.kind)).toEqual(expect.arrayContaining(['topic', 'number']));
    expect(issues.find(i => i.kind === 'number')?.rule).toContain('34');
    const clean = sanitizeGroundedText(text, facts, issues);
    expect(clean).toContain('xG par 90 : 0,41 (P80).');
    expect(clean).not.toContain('34 km/h');
    expect(clean).not.toContain('Leader');
    expect(clean).not.toContain('recruter');
    expect(auditGroundedText(text, facts, ['Section absente']).some(i => i.kind === 'heading')).toBe(true);
  });
});

describe('handleGroundedAi', () => {
  const deps = (generate: (p: string) => Promise<string | { text: string; modelVersion?: string }>) => ({ apiKey: KEY, model: 'gemini-3.5-flash', generate, log: () => {}, sleep: async () => {}, now: () => new Date('2026-10-30T10:00:00.000Z') });
  it('sans clé : 503 et rien n\'est appelé', async () => {
    const generate = vi.fn();
    expect((await handleGroundedAi('compare', { players: [] }, { apiKey: undefined, generate, log: () => {} })).status).toBe(503);
    expect(generate).not.toHaveBeenCalled();
  });
  it('compare : texte ancré, modèle réel, faits et version de prompt renvoyés', async () => {
    const generate = vi.fn(async (_prompt: string) => ({ text: GOOD_COMPARE, modelVersion: 'gemini-reel-3.6' }));
    const r = await handleGroundedAi('compare', { players: [{ row: starter }, { row: candidate }], framing: 'candidate_vs_incumbent' }, deps(generate));
    expect(r.status).toBe(200);
    const body = r.body as AiTextResponse;
    expect(body.content).toBe(GOOD_COMPARE);
    expect(body.meta).toEqual({ model: 'gemini-reel-3.6', requestedModel: 'gemini-3.5-flash', generatedAt: '2026-10-30T10:00:00.000Z' });
    expect(body.promptVersion).toBe(AI_PROMPT_VERSIONS.compare);
    expect((body.facts as { players: unknown[] }).players).toHaveLength(2);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(String(generate.mock.calls[0][0])).not.toContain(KEY);
  });
  it('compare : un nombre inventé déclenche la correction puis le retrait de la phrase', async () => {
    const bad = GOOD_COMPARE.replace('- 22 ans contre 29 ans.', '- 22 ans contre 29 ans. Il vaut 45 M€ sur le marché.');
    const generate = vi.fn(async () => bad);
    const r = await handleGroundedAi('compare', { players: [{ row: starter }, { row: candidate }] }, deps(generate));
    expect(generate).toHaveBeenCalledTimes(2);     // génération + passe de correction
    expect((r.body as AiTextResponse).content).toContain('22 ans contre 29 ans.');
    expect((r.body as AiTextResponse).content).not.toContain('45 M€');
  });
  it('hunter : JSON strict, nouvelle tentative si la réponse n\'est pas du JSON, configuration validée', async () => {
    const generate = vi.fn()
      .mockResolvedValueOnce('Je propose un attaquant.')
      .mockResolvedValueOnce('```json\n{"position":"ST","role":"Renard des surfaces","ageMax":23,"minutesMin":null,"valueMax":20000000,"contractMonths":null,"estimateAboveMarket":null,"competition":"FRA","extraCriteria":[{"metric":"npxG per 90","minPercentile":70}],"explanation":"Attaquant U23 de Ligue 1, moins de 20 M€, npxG au 70e percentile."}\n```');
    const r = await handleGroundedAi('hunter', { query: 'un jeune attaquant de Ligue 1 à moins de 20 M€ qui crée beaucoup d\'occasions', catalogue }, deps(generate));
    expect(r.status).toBe(200);
    const body = r.body as AiHunterResponse;
    expect(body.config).toMatchObject({ position: 'ST', role: 'Renard des surfaces', ageMax: 23, valueMax: 20000000, competition: 'FRA', extraCriteria: [{ metric: 'npxG per 90', minPercentile: 70 }] });
    expect(body.warnings).toEqual([]);
    expect(body.promptVersion).toBe('ai-hunter-v1');
    expect(generate).toHaveBeenCalledTimes(2);
  });
  it('hunter : deux réponses illisibles → 502 ; erreur réseau → 502 sans détail', async () => {
    const r = await handleGroundedAi('hunter', { query: 'q', catalogue }, deps(async () => 'rien'));
    expect(r.status).toBe(502);
    const r2 = await handleGroundedAi('opposition', { team: { name: 'Équipe' } }, deps(async () => { throw new Error(`401 key ${KEY}`); }));
    expect(r2.status).toBe(502);
    expect(JSON.stringify(r2.body)).not.toContain(KEY);
  });
});

describe('middleware /api/ai/*', () => {
  let server: Server | undefined;
  afterEach(() => { server?.close(); server = undefined; });
  const start = (generate: (p: string) => Promise<string>) => new Promise<string>(resolve => {
    const middleware = scoutReportMiddleware({ apiKey: KEY, generate, log: () => {} });
    server = createServer((req, res) => middleware(req, res, () => { res.statusCode = 404; res.end('next'); }));
    server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server!.address() as AddressInfo).port}`));
  });
  it('route les trois tâches, refuse une tâche inconnue et une méthode non POST', async () => {
    const base = await start(async p => (p.includes('single JSON object') ? '{"position":"ST","extraCriteria":[],"explanation":"ok"}' : GOOD_COMPARE));
    const post = (path: string, body: unknown) => fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    expect((await post('/api/ai/compare', { players: [{ row: starter }, { row: candidate }] })).status).toBe(200);
    expect(((await (await post('/api/ai/hunter', { query: 'un neuf', catalogue })).json()) as AiHunterResponse).config.position).toBe('ST');
    expect((await post('/api/ai/opposition', { team: { name: 'Équipe' } })).status).toBe(200);
    expect(await (await post('/api/ai/inconnue', {})).text()).toBe('next');
    expect((await fetch(`${base}/api/ai/compare`)).status).toBe(405);
  });
});
