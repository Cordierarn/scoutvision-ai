/**
 * Assistant IA du Labo paris (server/bettingAi.ts), sans réseau ni données réelles : actualité ancrée
 * (sources, cache, actualisation), plan JSON validé (références, verdicts, combiné, nombres), endpoints HTTP.
 */
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BETTING_NEWS_PATH, BETTING_PLAN_PATH, BettingDeps, GenerateGrounded, GenerateJson, NEWS_REFRESH_MIN_MS, NewsCache, SuggestionsIndexFile,
  auditText, buildNewsPrompt, buildPlanFacts, buildPlanPrompt, cleanNews, handleBettingNews, handleBettingPlan, matchFacts, parseGrounding, validatePlan,
} from './bettingAi';
import { scoutReportMiddleware } from './scoutReportPlugin';

const KEY = 'AIzaTEST-secret-key-123';     // clé factice de test, jamais une vraie clé
const NOW = new Date('2026-11-07T12:00:00Z');
const sug = (rank: number, label: string, family: string, odds: number, p: number, ev: number, stakeFraction = 0.02) =>
  ({ rank, family, label, odds, oddsAt: '2026-11-07T11:40:00Z', p, ev, stakeFraction, stakeMode: 'kelly' as const, reasons: ['Forme : 3 V 1 N 1 D'] });
const INDEX: SuggestionsIndexFile = {
  generatedAt: '2026-11-07T11:45:00Z', season: '2026-27', bookmaker: 'Bookmaker test',
  matches: [
    { matchId: 'm1', competition: 'AAA', date: '2026-11-07', home: 'Club A', away: 'Club B', status: 'ok', kickoff: '2026-11-07T19:00:00Z', xg: [1.6, 0.9],
      profiles: { equilibre: { suggestions: [sug(1, 'Club A gagne', 'résultat', 1.85, 0.6, 0.11, 0.03), sug(2, 'Plus de 2,5 buts', 'plus/moins', 1.95, 0.55, 0.07)], combo: null } } },
    { matchId: 'm2', competition: 'AAA', date: '2026-11-07', home: 'Club C', away: 'Club D', status: 'ok', kickoff: '2026-11-07T20:00:00Z', xg: [1.1, 1.2],
      profiles: { equilibre: { suggestions: [sug(1, 'Moins de 3,5 buts', 'plus/moins', 1.4, 0.74, 0.04)], combo: null } } },
    { matchId: 'm3', competition: 'AAA', date: '2026-11-07', home: 'Club E', away: 'Club F', status: 'no_odds' },
  ],
  bilan: { profiles: { equilibre: { byFamily: { 'résultat': { bets: 40, hitRate: 0.5, returnFlat: -0.06 }, 'plus/moins': { bets: 60, hitRate: 0.55, returnFlat: -0.02 }, 'buteur': { bets: 5, hitRate: 0.2, returnFlat: -0.4 } } } } },
};
const GOOD_PLAN = {
  summary: 'Journée calme : une absence côté Club B.',
  matches: [
    { matchId: 'm1', verdicts: [{ ref: 'm1#1', verdict: 'garder', reason: "L'attaquant de Club B est suspendu." }, { ref: 'm1#2', verdict: 'prudence', reason: 'Rotation probable avant la coupe.' }] },
    { matchId: 'm2', verdicts: [{ ref: 'm2#1', verdict: 'garder', reason: 'Aucune actualité contraire.' }] },
  ],
  picks: [{ ref: 'm1#1', why: 'Cote 1,85 et absence adverse.' }, { ref: 'm2#1', why: 'Marché stable.' }],
  combo: { refs: ['m1#1', 'm2#1'], why: 'Deux sélections gardées.' },
  avoid: [],
  discipline: 'Mises du moteur, sans rattrapage des pertes.',
};

function deps(over: Partial<BettingDeps> = {}): BettingDeps {
  return {
    apiKey: KEY, model: 'gemini-test', loadIndex: () => INDEX, news: new NewsCache(), now: () => NOW, log: () => {}, sleep: async () => {},
    generateGrounded: async () => ({ text: '- Club B : attaquant suspendu (3 matchs).\n- Club A : effectif complet.', modelVersion: 'gemini-test-001', sources: [{ title: 'source.test', uri: 'https://example.test/a' }], queries: ['Club A Club B team news'], searchHtml: '<div>chips</div>' }),
    generateJson: async () => ({ text: JSON.stringify(GOOD_PLAN), modelVersion: 'gemini-test-001' }),
    ...over,
  };
}

describe('actualité ancrée', () => {
  it('lit les métadonnées d\'ancrage : sources https dédoublonnées, requêtes, bloc de suggestions', () => {
    const g = parseGrounding({
      groundingChunks: [{ web: { uri: 'https://a.test/1', title: 'a.test' } }, { web: { uri: 'https://a.test/1', title: 'a.test' } }, { web: { uri: 'javascript:alert(1)', title: 'x' } }, { web: { title: 'sans lien' } }],
      webSearchQueries: ['q1', '', 3], searchEntryPoint: { renderedContent: '<style></style><div>chips</div>' },
    });
    expect(g.sources).toEqual([{ title: 'a.test', uri: 'https://a.test/1' }]);
    expect(g.queries).toEqual(['q1']);
    expect(g.searchHtml).toContain('chips');
    expect(parseGrounding(undefined)).toEqual({ sources: [], queries: [] });
  });

  it('borne le texte à des puces et reconnaît l\'absence d\'information', () => {
    expect(cleanNews('Intro\n* **Club A** : complet\n- Club B : doute')).toBe('- Club A : complet\n- Club B : doute');
    expect(cleanNews('- Aucune information fiable trouvée.')).toBe('Aucune information fiable trouvée.');
    expect(cleanNews(Array.from({ length: 12 }, (_, i) => `- point ${i}`).join('\n')).split('\n')).toHaveLength(8);
  });

  it('demande l\'actualité du bon match, sans pronostic ni cote', () => {
    const prompt = buildNewsPrompt(matchFacts(INDEX.matches[0], 'equilibre'), '2026-11-07');
    expect(prompt).toContain('Club A vs Club B');
    expect(prompt).toContain('no prediction, no odds, no betting advice');
    expect(prompt).not.toContain('1.85');
  });

  it('met l\'actualité en cache et limite l\'actualisation', async () => {
    let calls = 0;
    let t = 0;
    const d = deps({ news: new NewsCache(90 * 60_000, () => t), generateGrounded: async () => { calls++; return { text: '- Club B : doute', sources: [], queries: [] }; } });
    const first = await handleBettingNews({ matchId: 'm1' }, d);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ matchId: 'm1', text: '- Club B : doute', cached: false });
    expect((await handleBettingNews({ matchId: 'm1' }, d)).body.cached).toBe(true);
    expect((await handleBettingNews({ matchId: 'm1', refresh: true }, d)).body.cached).toBe(true);   // moins de 15 min
    t = NEWS_REFRESH_MIN_MS + 1;
    expect((await handleBettingNews({ matchId: 'm1', refresh: true }, d)).body.cached).toBe(false);
    expect(calls).toBe(2);
  });

  it('refuse un identifiant invalide, un match sans cotes, une clé absente ; masque la clé dans les journaux', async () => {
    expect((await handleBettingNews({ matchId: '../x' }, deps())).status).toBe(400);
    expect((await handleBettingNews({ matchId: 'm3' }, deps())).status).toBe(404);
    expect((await handleBettingNews({ matchId: 'm1' }, deps({ apiKey: undefined }))).status).toBe(503);
    expect((await handleBettingNews({ matchId: 'm1' }, deps({ loadIndex: () => null }))).status).toBe(503);
    const logs: string[] = [];
    const failing = await handleBettingNews({ matchId: 'm1' }, deps({ log: m => logs.push(m), generateGrounded: async () => { throw new Error(`400 bad request key=${KEY}`); } }));
    expect(failing.status).toBe(502);
    expect(JSON.stringify(failing.body)).not.toContain(KEY);
    expect(logs.join(' ')).not.toContain(KEY);
  });
});

describe('plan du jour', () => {
  const facts = buildPlanFacts(INDEX, ['m1', 'm2', 'm3', 'inconnu'], 'equilibre', '2026-11-07');

  it('ne transmet que les matchs avec cotes, des références stables et le bilan des familles présentes', () => {
    expect(facts.matches.map(m => m.matchId)).toEqual(['m1', 'm2']);
    expect(facts.matches[0].suggestions.map(s => s.ref)).toEqual(['m1#1', 'm1#2']);
    expect(Object.keys(facts.familyRecord).sort()).toEqual(['plus/moins', 'résultat']);
    const prompt = buildPlanPrompt(facts, { m1: '- Club B : attaquant suspendu.' });
    expect(prompt).toContain('Never invent a bet');
    expect(prompt).toContain('[m1] Club A – Club B\n- Club B : attaquant suspendu.');
    expect(prompt).toContain('[m2] Club C – Club D\nActualité non recherchée.');
  });

  it('valide références, verdicts et sélection ; la mise vient du moteur, jamais du modèle', () => {
    const plan = validatePlan(GOOD_PLAN, facts, {}, INDEX);
    expect(plan.picks.map(p => [p.ref, p.verdict, p.stakeFraction, p.odds])).toEqual([['m1#1', 'garder', 0.03, 1.85], ['m2#1', 'garder', 0.02, 1.4]]);
    expect(plan.combo?.labels).toEqual(['Club A – Club B : Club A gagne', 'Club C – Club D : Moins de 3,5 buts']);
    expect(plan.matches[0].verdicts.map(v => v.verdict)).toEqual(['garder', 'prudence']);
    expect(plan.warnings).toEqual([]);
  });

  it('écarte une sélection inventée, évitée ou en double, et un combiné non conforme', () => {
    const bad = {
      ...GOOD_PLAN,
      matches: [{ matchId: 'm1', verdicts: [{ ref: 'm1#1', verdict: 'eviter', reason: 'Gardien titulaire blessé.' }, { ref: 'm1#9', verdict: 'garder', reason: 'x' }, { ref: 'm1#2', verdict: 'super', reason: 'x' }] }],
      picks: [{ ref: 'm1#1', why: 'x' }, { ref: 'm9#1', why: 'x' }, { ref: 'm2#1', why: 'x' }, { ref: 'm2#1', why: 'x' }],
      combo: { refs: ['m1#1', 'm1#2'], why: 'même match' },
      avoid: [{ matchId: 'm1', why: 'Trop d\'incertitude.' }, { matchId: 'zz', why: 'x' }],
    };
    const plan = validatePlan(bad, facts, {}, INDEX);
    expect(plan.picks).toEqual([]);                       // m1#1 évitée, m9#1 inconnue, m2#1 sans verdict
    expect(plan.combo).toBeNull();
    expect(plan.avoid.map(a => a.matchId)).toEqual(['m1']);
    expect(plan.matches[0].verdicts.map(v => v.verdict)).toEqual(['eviter', 'non_evalue']);
    expect(plan.warnings.join(' ')).toContain('sans avis');
    expect(plan.warnings.join(' ')).toContain('Combiné proposé écarté');
  });

  it('retire les phrases qui citent un nombre absent des faits et de l\'actualité', () => {
    const allowed = [1.85, 3];
    expect(auditText('Cote 1,85. Probabilité réelle 72 %. Suspendu 3 matchs.', allowed)).toEqual({ text: 'Cote 1,85. Suspendu 3 matchs.', removed: 1 });
    const plan = validatePlan({ ...GOOD_PLAN, summary: 'Nous estimons 64 % de chances. Journée calme.' }, facts, { m1: { matchId: 'm1', text: '- Suspendu 3 matchs', sources: [], queries: [], fetchedAt: '', model: '' } }, INDEX);
    expect(plan.summary).toBe('Journée calme.');
    expect(plan.warnings.join(' ')).toContain('1 phrase(s) retirée(s)');
  });

  it('handler : utilise l\'actualité en cache, signale les matchs sans actualité, renvoie le modèle utilisé', async () => {
    const d = deps();
    await handleBettingNews({ matchId: 'm1' }, d);
    let prompt = '';
    const out = await handleBettingPlan({ matchIds: ['m1', 'm2'], profile: 'equilibre' }, { ...d, generateJson: async p => { prompt = p; return { text: JSON.stringify(GOOD_PLAN), modelVersion: 'gemini-test-001' }; } });
    expect(out.status).toBe(200);
    expect(prompt).toContain('attaquant suspendu');
    expect(out.body.warnings).toEqual(['1 match(s) sans actualité recherchée : avis fondé sur les seules données du moteur.']);
    expect(out.body.meta).toMatchObject({ model: 'gemini-test-001', requestedModel: 'gemini-test', suggestionsAt: INDEX.generatedAt });
    expect((out.body.matches as { news: unknown }[])[0].news).toMatchObject({ sources: [{ title: 'source.test' }] });
  });

  it('handler : requêtes invalides et réponse illisible', async () => {
    expect((await handleBettingPlan({}, deps())).status).toBe(400);
    expect((await handleBettingPlan({ matchIds: Array.from({ length: 9 }, (_, i) => `m${i}`) }, deps())).status).toBe(400);
    expect((await handleBettingPlan({ matchIds: ['m3'] }, deps())).status).toBe(404);
    expect((await handleBettingPlan({ matchIds: ['m1'], profile: 'sur' }, deps())).status).toBe(422);   // aucun pari Sûr publié
    expect((await handleBettingPlan({ matchIds: ['m1'] }, deps({ generateJson: async () => ({ text: 'pas du json' }) }))).status).toBe(502);
  });
});

describe('endpoints HTTP (serveur réel, Gemini simulé)', () => {
  let server: Server | null = null;
  afterEach(() => new Promise<void>(resolve => (server ? server.close(() => resolve()) : resolve())));

  async function start(generateGrounded: GenerateGrounded, generateJson: GenerateJson) {
    const middleware = scoutReportMiddleware({ apiKey: KEY, log: () => {}, loadIndex: () => INDEX, generateGrounded, generateJson, bettingRateLimit: { limit: 3, windowMs: 60_000 } });
    server = createServer((req, res) => { void middleware(req, res, () => { res.statusCode = 404; res.end(); }); });
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  }

  it('actualité puis plan ; POST JSON obligatoire ; limite de débit propre à l\'assistant', async () => {
    const base = await start(deps().generateGrounded, deps().generateJson);
    const post = (p: string, body: unknown) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const news = await post(BETTING_NEWS_PATH, { matchId: 'm1' });
    expect(news.status).toBe(200);
    expect((await news.json()).sources).toHaveLength(1);
    const plan = await post(BETTING_PLAN_PATH, { matchIds: ['m1', 'm2'] });
    expect(plan.status).toBe(200);
    expect((await plan.json()).picks).toHaveLength(2);
    expect((await fetch(base + BETTING_PLAN_PATH)).status).toBe(405);
    expect((await post(BETTING_PLAN_PATH, { matchIds: ['m1'] })).status).toBe(200);   // 3e requête POST : la méthode refusée ne compte pas
    expect((await post(BETTING_PLAN_PATH, { matchIds: ['m1'] })).status).toBe(429);   // 4e requête dans la fenêtre
  });
});
