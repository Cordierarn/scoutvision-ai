/**
 * Rapport rédigé : ancrage dans les données ScoutVision (faits, prompt, contrôle, correction),
 * modèle configuré et nouvelles tentatives sur erreurs transitoires
 */
import { describe, expect, it, vi } from 'vitest';
import { auditReport, sanitizeReport } from './reportAudit';
import { buildReportFacts, buildScoutReportPrompt, formatEuro, REPORT_HEADINGS } from './reportFacts';
import { DEFAULT_GEMINI_MODEL, errorStatus, generateWithRetry, handleScoutReport, MAX_ATTEMPTS, resolveGeminiModel } from './scoutReport';
import { reportFooterLabel } from '../services/scoutReportService';
import { metricLabel } from '../utils/labels';

const KEY = 'AIzaTEST-secret-key-123';

// Gardien : valeur Transfermarkt 11 M€, estimation ScoutVision 6,07 M€, aucune donnée de pression ni de mentalité
const keeper = {
  Player: 'Gardien Test', Team: 'Club Test', League: 'Liga Test 2026', Position: 'GK', Age: 21, Height: 191, Foot: 'Left',
  'Matches played': 33, Starts: 32, 'Minutes played': 2968, 'Minutes share': 0.999,
  'Market value': 11_000_000, 'Estimated value': 6_070_000, 'Contract expires': '2027-12-31',
  'Accurate long passes, %': 31.834, 'Accurate long passes, % pct': 14,
  'PAdj Recoveries': 16.633, 'PAdj Recoveries pct': 93,
  'Prevented goals per 90': 0.075, 'Prevented goals per 90 pct': 69,
};
const options = { language: 'fr' as const, seasonInProgress: true, bestRoles: [{ role: 'Gardien libéro', normalizedScore: 63 }] };
const facts = buildReportFacts(keeper, options);

const H = REPORT_HEADINGS.fr.map((h, i) => `### ${i + 1}. ${h}`);
const report = (...sections: string[][]) => H.flatMap((h, i) => [h, ...(sections[i] ?? ['- RAS.'])]).join('\n');

// Rapport conforme : français, nombres des données, réserve de saison, valeurs nommées correctement
const GOOD = report(
  ['- Liga Test 2026, Club Test, 21 ans, 2968 minutes. Saison en cours : échantillon limité.', '- Indice de rôle ScoutVision Gardien libéro : 63.'],
  ['- Récupérations ajustées : 16,6 (93e percentile de son groupe de comparaison).'],
  ['- **Limite** : passes longues réussies 31,8 % (14e percentile).'],
  ['- Sa valeur de marché Transfermarkt est de 11 M€, tandis que le modèle ScoutVision l\'estime à 6,1 M€ (erreur typique ×1,7).'],
  ['- Vérifier en vidéo la qualité et le contexte des passes longues.'],
);

// Ajoute une ligne à la section 3 du rapport conforme
const withLine = (line: string) => GOOD.replace(H[2], `${H[2]}\n- ${line}`);

const run = (texts: string[], extra: Partial<Parameters<typeof handleScoutReport>[1]> = {}) => {
  const generate = vi.fn();
  texts.forEach(t => generate.mockResolvedValueOnce(t));
  generate.mockResolvedValue(texts[texts.length - 1]);
  return { generate, result: handleScoutReport({ player: keeper, options }, { apiKey: KEY, generate, log: () => {}, sleep: async () => {}, ...extra }) };
};
const reportOf = async (r: ReturnType<typeof run>['result']) => {
  const out = await r;
  if (!('content' in out.body)) throw new Error(`échec : ${JSON.stringify(out.body)}`);
  return { ...out.body, report: out.body.content };
};

describe('faits envoyés au modèle', () => {
  it('séparent la valeur Transfermarkt et l\'estimation ScoutVision, sans la ligne brute ambiguë', () => {
    expect(facts.values).toEqual({ marketValueTransfermarkt: '11 M€', estimatedValueScoutVision: '6,1 M€', estimatedValueTypicalError: '×1,7' });
    expect(JSON.stringify(facts)).not.toMatch(/Market value|Estimated value|11000000/);
    expect(facts.sample.seasonInProgress).toBe(true);
    expect(facts.metrics).toContainEqual({ metric: metricLabel('Accurate long passes, %'), value: 31.8, percentile: 14 });
    expect(formatEuro(850_000)).toBe('850 k€');
    const fouls = buildReportFacts({ ...keeper, 'Fouls per 90': 1.6, 'Fouls per 90 pct': 96 }, options).metrics.find(m => m.percentile === 96);
    expect(fouls).toMatchObject({ lessIsPreferable: true });
    expect(facts.metrics.every(m => !('lessIsPreferable' in m))).toBe(true);
  });

  it('le prompt définit les deux valeurs, interdit le prix de transfert, les sujets non mesurés et impose le français', () => {
    const prompt = buildScoutReportPrompt(facts, options);
    expect(prompt).toContain('"marketValueTransfermarkt": "11 M€"');
    expect(prompt).toContain('"estimatedValueScoutVision": "6,1 M€"');
    expect(prompt).toContain('Never call the Transfermarkt value an estimated price, a transfer price, a transfer cost or a ScoutVision estimate');
    expect(prompt).toMatch(/passes under pressure.*mentality.*leadership.*injuries.*salary.*transfer price/s);
    expect(prompt).toContain('A metric that is absent from the data is simply omitted');
    expect(prompt).toContain('Write the entire final report in French. All headings, labels and conclusions must be in French.');
    H.forEach(h => expect(prompt).toContain(h));
    expect(prompt).not.toMatch(/PRIORITY SIGNING \||Potential Level/);
  });
});

describe('contrôle du rapport', () => {
  it('ne relève rien sur un rapport conforme', () => {
    expect(auditReport(GOOD, facts)).toEqual([]);
  });

  it.each([
    ['A. 11 M€ présentés comme prix de transfert', 'Un transfert est estimé à 11 M€.', 'topic'],
    ['A. prix estimé', 'Prix estimé : 11 M€.', 'topic'],
    ['B. passes sous pression (métrique absente)', 'Peu à l\'aise dans les passes sous pression.', 'topic'],
    ['C. mentalité (aucune donnée)', 'Une mentalité de leader.', 'topic'],
    ['niveau futur inventé', 'Titulaire en puissance dans un club du Top 5 européen.', 'topic'],
    ['percentile traduit en « élite »', 'Un relanceur d\'élite.', 'topic'],
    ['verdict de recrutement', 'Verdict : SCOUT FURTHER.', 'topic'],
    ['nombre calculé absent des données', 'Il couvre 55 % de la valeur de marché.', 'number'],
    ['titre anglais', '**Key Strengths** : récupérations.', 'heading'],
  ])('relève : %s', (_label, sentence, kind) => {
    expect(auditReport(withLine(sentence), facts).map(i => i.kind)).toContain(kind);
  });

  it.each(['La saison est en cours.', 'Saison 2026-27 encore en cours.', 'Échantillon restreint (5 matchs).'])('D. reconnaît la réserve formulée : %s', phrase => {
    const text = GOOD.replace(' Saison en cours : échantillon limité.', ` ${phrase}`);
    expect(auditReport(text, facts).filter(i => i.kind === 'season')).toEqual([]);
  });

  it('D. relève l\'absence de réserve quand la saison est en cours, pas quand elle est terminée', () => {
    const without = GOOD.replace(' Saison en cours : échantillon limité.', '');
    expect(auditReport(without, facts).map(i => i.kind)).toEqual(['season']);
    expect(auditReport(without, buildReportFacts(keeper, { ...options, seasonInProgress: false }))).toEqual([]);
  });

  it('autorise un sujet quand ScoutVision envoie la donnée correspondante', () => {
    const withMetric = buildReportFacts({ ...keeper, 'Passes under pressure, %': 80, 'Passes under pressure, % pct': 70 }, options);
    expect(auditReport(withLine('Passes sous pression réussies : 80 %.'), withMetric)).toEqual([]);
  });

  it('retire les phrases fautives et ajoute la réserve de saison en dernier recours', () => {
    const bad = GOOD.replace(' Saison en cours : échantillon limité.', '')
      .replace('(erreur typique ×1,7).', '(erreur typique ×1,7). Un transfert est estimé à 11 M€.');
    const issues = auditReport(bad, facts);
    const clean = sanitizeReport(bad, facts, issues);
    expect(clean).not.toMatch(/transfert est estimé/);
    expect(clean).toContain('valeur de marché Transfermarkt est de 11 M€');
    expect(clean).toMatch(/saison en cours/i);
    expect(auditReport(clean, facts)).toEqual([]);
  });
});

describe('erreurs relevées sur les rapports réels', () => {
  // Avant-centre, saison terminée : 9 buts pour 8,57 xG, fautes commises au 100e percentile
  const striker = {
    Player: 'Avant-centre Test', Team: 'Club', League: 'Serie Test 2025-26', Position: 'ST', Age: 23, 'Matches played': 37, Starts: 34, 'Minutes played': 2991,
    Goals: 9, xG: 8.57, 'Fouls per 90': 2.3, 'Fouls per 90 pct': 100, 'Aerial duels won per 90': 3.5, 'Aerial duels won per 90 pct': 88,
  };
  const sOpts = { language: 'fr' as const, seasonInProgress: false };
  const sFacts = buildReportFacts(striker, sOpts);
  const S = report(
    ['- Serie Test 2025-26, 23 ans, 37 matchs, 34 titularisations, 2991 minutes.'],
    ['- 9 buts pour 8,6 xG.'],
    [`- **Forces** : ${metricLabel('Aerial duels won per 90')} (3,5, 88e percentile).`, `- **Limites** : ${metricLabel('Fouls per 90')} (2,3, 100e percentile).`],
  );

  it('le rapport conforme ne relève rien', () => {
    expect(auditReport(S, sFacts)).toEqual([]);
  });

  it('décompte attaché au mauvais champ : « 8,6 buts » pour 9 buts et 8,6 xG', () => {
    const bad = S.replace('9 buts pour 8,6 xG.', '8,6 buts marqués pour 8,6 xG.');
    expect(auditReport(bad, sFacts).map(i => i.kind)).toContain('number');
    expect(sanitizeReport(bad, sFacts, auditReport(bad, sFacts))).not.toContain('8,6 buts');
  });

  it('ratio par 90 et « par 90 minutes » ne sont pas pris pour des décomptes', () => {
    const f = buildReportFacts({ ...striker, 'Goals per 90': 0.324, 'Goals per 90 pct': 5 }, sOpts);
    const text = S.replace('9 buts pour 8,6 xG.', '9 buts pour 8,6 xG (0,32 but, soit 0,32 but par 90 minutes).');
    expect(auditReport(text, f)).toEqual([]);
  });

  it('saison terminée : une réserve « saison en cours » est relevée et retirée', () => {
    const bad = S.replace('2991 minutes.', '2991 minutes. Note : la saison en cours indique un échantillon limité.');
    const issues = auditReport(bad, sFacts);
    expect(issues.map(i => i.kind)).toEqual(['season']);
    expect(sanitizeReport(bad, sFacts, issues)).not.toMatch(/saison en cours|échantillon limité/);
  });

  it('donnée absente signalée comme manquante', () => {
    const bad = S.replace('9 buts pour 8,6 xG.', '9 buts pour 8,6 xG. La valeur de marché n\'est pas renseignée.');
    expect(auditReport(bad, sFacts).map(i => i.kind)).toContain('topic');
    expect(sanitizeReport(bad, sFacts, auditReport(bad, sFacts))).not.toMatch(/renseign/);
  });

  it('métrique « moins c\'est mieux » à percentile élevé listée en force : seul cet élément est retiré', () => {
    const bad = S.replace(`(3,5, 88e percentile).`, `(3,5, 88e percentile), ${metricLabel('Fouls per 90')} (2,3, 100e percentile).`);
    const issues = auditReport(bad, sFacts);
    expect(issues.map(i => i.rule).join(' ')).toMatch(/less is better/);
    const clean = sanitizeReport(bad, sFacts, issues);
    expect(clean).toContain(`**Forces** : ${metricLabel('Aerial duels won per 90')} (3,5, 88e percentile)`);
    expect(auditReport(clean, sFacts)).toEqual([]);
  });

  it('métrique « moins c\'est mieux » à percentile bas listée en limite : seul cet élément est retiré', () => {
    const f = buildReportFacts({ ...striker, 'Dispossessed per 90': 1.2, 'Dispossessed per 90 pct': 5 }, sOpts);
    const bad = S.replace(`(2,3, 100e percentile).`, `(2,3, 100e percentile), ${metricLabel('Dispossessed per 90')} (1,2, 5e percentile).`);
    const issues = auditReport(bad, f);
    expect(issues.map(i => i.rule).join(' ')).toMatch(/low percentile listed as limits/);
    const clean = sanitizeReport(bad, f, issues);
    expect(clean).toContain(`**Limites** : ${metricLabel('Fouls per 90')} (2,3, 100e percentile)`);
    expect(clean).not.toContain(metricLabel('Dispossessed per 90'));
    expect(auditReport(clean, f)).toEqual([]);
  });

  it('réserve répétée : relevée, une seule occurrence gardée', () => {
    const twice = GOOD.replace('- Récupérations', '- La saison est en cours, prudence. Récupérations');
    const issues = auditReport(twice, facts);
    expect(issues.map(i => i.kind)).toEqual(['season']);
    const clean = sanitizeReport(twice, facts, issues);
    expect(clean.match(/saison (?:est )?en cours/gi)).toHaveLength(1);
    expect(clean).toContain('Récupérations ajustées : 16,6');
  });

  it('saison en cours déjà formulée autrement : pas de réserve ajoutée en double', () => {
    const text = GOOD.replace(' Saison en cours : échantillon limité.', ' La saison est en cours.');
    const issues = auditReport(text.replace('- Récupérations', '- Mentalité. Récupérations'), facts);
    const clean = sanitizeReport(text.replace('- Récupérations', '- Mentalité. Récupérations'), facts, issues);
    expect(clean.match(/saison (?:est )?en cours/gi)).toHaveLength(1);
  });
});

describe('génération contrôlée (fixtures A à D)', () => {
  it('rapport conforme : un seul appel', async () => {
    const { generate, result } = run([GOOD]);
    expect((await reportOf(result)).report).toBe(GOOD);
    expect(generate).toHaveBeenCalledOnce();
  });

  it('A. 11 M€ appelés prix de transfert : passe de correction, rapport corrigé', async () => {
    const bad = withLine('Un transfert est estimé à 11 M€.');
    const { generate, result } = run([bad, GOOD]);
    const body = await reportOf(result);
    expect(body.report).toBe(GOOD);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate.mock.calls[1][0]).toContain('IT BREAKS THESE RULES');
  });

  it('A. erreur persistante : la phrase est retirée, jamais « prix de transfert »', async () => {
    const bad = GOOD.replace('(erreur typique ×1,7).', '(erreur typique ×1,7). Le prix du transfert est estimé à 11 M€.');
    const body = await reportOf(run([bad, bad]).result);
    expect(body.report).not.toMatch(/prix|transfert est estimé/i);
    expect(body.report).toContain('valeur de marché Transfermarkt est de 11 M€');
  });

  it('B. passes sous pression non mesurées : absentes du rapport final', async () => {
    const bad = withLine('Fragile dans ses passes sous pression. Récupérations : 16,6.');
    const body = await reportOf(run([bad, bad]).result);
    expect(body.report).not.toMatch(/pression/i);
    expect(body.report).toContain('Récupérations : 16,6.');
  });

  it('C. aucune donnée de mentalité : jamais présentée comme caractéristique', async () => {
    const bad = withLine('Grande maturité et mentalité de compétiteur.');
    const body = await reportOf(run([bad, bad]).result);
    expect(body.report).not.toMatch(/mentalit|maturit/i);
  });

  it('D. saison en cours : la réserve figure dans le rapport final', async () => {
    const without = GOOD.replace(' Saison en cours : échantillon limité.', '');
    const body = await reportOf(run([without, without]).result);
    expect(body.report).toMatch(/saison en cours/i);
    expect(body.report.match(/saison en cours/gi)).toHaveLength(1);
  });
});

describe('E. modèle configuré', () => {
  it('GEMINI_MODEL absente : modèle par défaut', () => {
    expect(resolveGeminiModel(undefined)).toBe(DEFAULT_GEMINI_MODEL);
    expect(resolveGeminiModel('  ')).toBe('gemini-3.5-flash');
    expect(resolveGeminiModel(' gemini-x ')).toBe('gemini-x');
  });

  it('le pied du rapport affiche exactement le modèle serveur', async () => {
    const body = await reportOf(run([GOOD], { model: 'gemini-serveur-test' }).result);
    expect(body.meta).toMatchObject({ model: 'gemini-serveur-test', requestedModel: 'gemini-serveur-test' });
    expect(reportFooterLabel(body.meta)).toBe('Généré par gemini-serveur-test');
  });

  it('affiche le modèle qui a réellement répondu quand l\'API en renvoie un autre', async () => {
    const generate = vi.fn(async () => ({ text: GOOD, modelVersion: 'gemini-3.6-flash' }));
    const out = await handleScoutReport({ player: keeper, options }, { apiKey: KEY, model: 'gemini-3.5-flash', generate });
    expect(out.body).toMatchObject({ meta: { model: 'gemini-3.6-flash', requestedModel: 'gemini-3.5-flash' } });
    expect(reportFooterLabel(null)).toBe('Généré par IA');
  });
});

describe('erreurs transitoires', () => {
  const apiError = (status: number) => Object.assign(new Error(`{"error":{"code":${status}}}`), { status });

  it('lit le statut d\'une erreur du SDK ou de son message', () => {
    expect(errorStatus(apiError(503))).toBe(503);
    expect(errorStatus(new Error('{"error":{"code":429,"status":"RESOURCE_EXHAUSTED"}}'))).toBe(429);
    expect(errorStatus(new Error('délai dépassé'))).toBeUndefined();
  });

  it.each([429, 502, 503])('%i : relance avec délai exponentiel et gigue, puis réussit', async status => {
    const sleep = vi.fn(async (_ms: number) => {});
    const generate = vi.fn().mockRejectedValueOnce(apiError(status)).mockRejectedValueOnce(apiError(status)).mockResolvedValue('ok');
    await expect(generateWithRetry(generate, 'p', { sleep, random: () => 0.5 })).resolves.toEqual({ text: 'ok' });
    expect(generate).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map(c => c[0])).toEqual([900, 1500]);
  });

  it.each([400, 401, 403, 404])('%i : aucune nouvelle tentative', async status => {
    const generate = vi.fn().mockRejectedValue(apiError(status));
    await expect(generateWithRetry(generate, 'p', { sleep: async () => {} })).rejects.toThrow();
    expect(generate).toHaveBeenCalledOnce();
  });

  it('429 de quota journalier : aucune nouvelle tentative', async () => {
    const daily = Object.assign(new Error('{"error":{"code":429,"details":[{"quotaId":"GenerateRequestsPerDayPerProjectPerModel-FreeTier"}]}}'), { status: 429 });
    const generate = vi.fn().mockRejectedValue(daily);
    await expect(generateWithRetry(generate, 'p', { sleep: async () => {} })).rejects.toThrow();
    expect(generate).toHaveBeenCalledOnce();
  });

  it(`au plus ${MAX_ATTEMPTS} tentatives, puis le message d'erreur propre`, async () => {
    const generate = vi.fn().mockRejectedValue(apiError(503));
    const out = await handleScoutReport({ player: keeper, options }, { apiKey: KEY, generate, log: () => {}, sleep: async () => {} });
    expect(generate).toHaveBeenCalledTimes(3);
    expect(out).toEqual({ status: 502, body: { error: 'Le service de génération est indisponible pour le moment. Réessayez dans quelques instants.' } });
  });

  it('les journaux ne contiennent ni la clé, ni le prompt, ni le texte généré', async () => {
    const log = vi.fn();
    const bad = withLine('Mentalité de leader.');
    await handleScoutReport({ player: keeper, options }, { apiKey: KEY, generate: vi.fn().mockResolvedValue(bad), log, sleep: async () => {} });
    const logged = log.mock.calls.map(c => c[0]).join('\n');
    expect(logged).not.toContain(KEY);
    expect(logged).not.toMatch(/Gardien Test|Mentalité|SCOUTVISION DATA/);
  });
});
