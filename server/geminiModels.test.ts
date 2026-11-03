/**
 * Chaînes de modèles Gemini (server/geminiModels.ts) : classement des erreurs, mise de côté jusqu'à la
 * remise à zéro, passage au modèle suivant, message quand plus rien n'est disponible.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_SEARCH_MODELS, ModelPool, NoModelAvailable, modelChain, takesThinkingLevel, unavailability, unavailableUntil, withModelFallback } from './geminiModels';
import { newsErrorMessage } from './bettingAi';

const err = (status: number, message: string) => Object.assign(new Error(message), { status });
const DAILY = err(429, '{"error":{"code":429,"message":"You exceeded your current quota, please check your plan and billing details."}}');

describe('chaînes de modèles Gemini', () => {
  it('lit une chaîne configurée, met GEMINI_MODEL en tête, sans doublon', () => {
    expect(modelChain(undefined, ['a', 'b'])).toEqual(['a', 'b']);
    expect(modelChain(' x , y ,', ['a'])).toEqual(['x', 'y']);
    expect(modelChain(undefined, ['a', 'b'], 'b')).toEqual(['b', 'a']);
    expect(DEFAULT_SEARCH_MODELS.some(m => m.startsWith('gemini-2.5'))).toBe(false);   // 2.5 retiré pour les nouvelles clés
  });

  it('classe les erreurs : quota du jour, limite par minute, modèle absent, autre', () => {
    expect(unavailability(DAILY)).toBe('daily');
    expect(unavailability(err(429, 'Quota exceeded for metric: GenerateRequestsPerDayPerProjectPerModel'))).toBe('daily');
    expect(unavailability(err(429, 'Resource has been exhausted (e.g. check quota).'))).toBe('rate');
    expect(unavailability(err(404, 'models/gemini-x is not found for API version v1beta'))).toBe('missing');
    expect(unavailability(err(404, 'This model models/gemini-2.5-flash is no longer available to new users.'))).toBe('missing');
    expect(unavailability(err(503, '{"error":{"code":503,"message":"This model is currently experiencing high demand.","status":"UNAVAILABLE"}}'))).toBe('rate');
    expect(unavailability(err(400, 'Invalid JSON payload'))).toBeNull();
    expect(unavailability(new Error('délai dépassé'))).toBeNull();
  });

  it('met un modèle de côté jusqu\'à sa remise à zéro probable (8 h UTC pour le quota du jour)', () => {
    const now = Date.UTC(2026, 10, 3, 15, 0);
    expect(new Date(unavailableUntil('daily', now)).toISOString()).toBe('2026-11-04T08:00:00.000Z');
    expect(new Date(unavailableUntil('daily', Date.UTC(2026, 10, 3, 6, 0))).toISOString()).toBe('2026-11-03T08:00:00.000Z');
    expect(unavailableUntil('rate', now)).toBe(now + 60_000);
  });

  it('passe au modèle suivant sur quota et s\'en souvient pour les appels suivants', async () => {
    let t = 0;
    const pool = new ModelPool(['m1', 'm2', 'm3'], () => t);
    const calls: string[] = [];
    const logs: string[] = [];
    const out = await withModelFallback(pool, async m => { calls.push(m); if (m === 'm1') throw DAILY; if (m === 'm2') throw err(404, 'not found'); return `ok ${m}`; }, l => logs.push(l));
    expect(out).toBe('ok m3');
    expect(calls).toEqual(['m1', 'm2', 'm3']);
    expect(pool.available()).toEqual(['m3']);
    expect(logs[0]).toContain('m1 indisponible (quota du jour)');
    t = 7 * 3600_000;                                   // modèle absent : réessayé après 6 h
    expect(pool.available()).toEqual(['m2', 'm3']);
  });

  it('remonte une erreur qui n\'est pas un quota sans changer de modèle', async () => {
    const pool = new ModelPool(['m1', 'm2']);
    await expect(withModelFallback(pool, async () => { throw err(400, 'bad schema'); })).rejects.toThrow('bad schema');
    expect(pool.available()).toEqual(['m1', 'm2']);
  });

  it('plus aucun modèle : 429 et message qui nomme les modèles et l\'heure de retour', async () => {
    const pool = new ModelPool(['m1', 'm2']);
    const failure = await withModelFallback(pool, async () => { throw DAILY; }).catch(e => e);
    expect(failure).toBeInstanceOf(NoModelAvailable);
    expect(failure.status).toBe(429);
    expect(failure.message).toBe('Quota gratuit atteint ou modèle indisponible sur m1, m2. Dernier refus de Google : {"error":{"code":429,"message":"You exceeded your current quota, please check your plan and billing details."}}');
    expect(newsErrorMessage(failure, '')).toContain('vers 9 h (heure de Paris)');
    const again = await withModelFallback(pool, async () => 'jamais').catch(e => e);
    expect(again.message).toContain('en pause');
  });

  it('niveau de réflexion seulement pour Gemini 3 et suivants', () => {
    expect(takesThinkingLevel('gemini-3.8-flash')).toBe(true);
    expect(takesThinkingLevel('gemini-2.5-flash')).toBe(false);
  });
});
