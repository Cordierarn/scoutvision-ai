/**
 * Adaptateur Claude (server/claudeAi.ts) sans réseau : client factice. Texte, refus, recherche web (sources,
 * requêtes, reprise d'un tour en pause), lecture d'articles, JSON strict (schéma nettoyé), secours, et choix du
 * fournisseur par le plugin selon les clés présentes.
 */
import { describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import {
  ClaudeClient, NEWS_FETCH_HINT, claudeArticlesReader, claudeGenerator, claudeGroundedGenerator, claudeJsonGenerator, parseFetchedUrls, parseWebSources, resolveClaudeModel, resolveEffort,
  strictSchema, withFallback,
} from './claudeAi';
import { DeadlineError, aiProviders } from './scoutReportPlugin';
import { NEWS_ALLOWED_DOMAINS } from './bettingFilter';

type Create = Anthropic.MessageCreateParamsNonStreaming;

function message(content: Anthropic.ContentBlock[], stop: Anthropic.StopReason = 'end_turn', extra: Partial<Anthropic.Message> = {}): Anthropic.Message {
  return {
    id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content, stop_reason: stop, stop_sequence: null, stop_details: null,
    usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: null, cache_read_input_tokens: null, cache_creation: null, server_tool_use: null, service_tier: null, inference_geo: null, iterations: null, speed: null },
    container: null, context_management: null,
    ...extra,
  } as Anthropic.Message;
}
const text = (t: string, citations: Anthropic.TextCitation[] | null = null): Anthropic.TextBlock => ({ type: 'text', text: t, citations });

/** Client factice : une réponse par appel, paramètres conservés */
function fakeClient(responses: Anthropic.Message[]): ClaudeClient & { calls: Create[] } {
  const calls: Create[] = [];
  return { calls, messages: { async create(params) { calls.push(params); const r = responses.shift(); if (!r) throw new Error('plus de réponse'); return r; } } };
}

describe('claudeGenerator', () => {
  it('sends the prompt to the configured model at low effort and returns text and model', async () => {
    const client = fakeClient([message([text('Synthèse.')], 'end_turn', { model: 'claude-opus-5-5-xyz' })]);
    const out = await claudeGenerator({ apiKey: 'k', client })('Rédige.');
    expect(out).toEqual({ text: 'Synthèse.', modelVersion: 'claude-opus-5-5-xyz' });
    expect(client.calls[0].model).toBe('claude-opus-5-5');
    expect(client.calls[0].output_config).toEqual({ effort: 'low' });
    expect(client.calls[0].messages).toEqual([{ role: 'user', content: 'Rédige.' }]);
    expect(client.calls[0]).not.toHaveProperty('tools');
  });

  it('honours CLAUDE_MODEL and CLAUDE_EFFORT, and falls back on defaults for unknown values', async () => {
    const client = fakeClient([message([text('x')])]);
    await claudeGenerator({ apiKey: 'k', client, model: ' claude-sonnet-5-5 ', effort: 'medium' })('p');
    expect(client.calls[0].model).toBe('claude-sonnet-5-5'); expect(client.calls[0].output_config?.effort).toBe('medium');
    expect(resolveClaudeModel('  ')).toBe('claude-opus-5-5'); expect(resolveEffort('turbo')).toBe('low'); expect(resolveEffort(undefined)).toBe('low');
  });

  it('rejects refusals and truncated answers with an explicit error', async () => {
    const refused = message([], 'refusal', { stop_details: { type: 'refusal', category: 'general_harms', explanation: null } as Anthropic.RefusalStopDetails });
    await expect(claudeGenerator({ apiKey: 'k', client: fakeClient([refused]) })('p')).rejects.toThrow(/refusée.*general_harms/);
    await expect(claudeGenerator({ apiKey: 'k', client: fakeClient([message([text('…')], 'max_tokens')]) })('p')).rejects.toThrow(/tronquée/);
  });
});

describe('claudeGroundedGenerator', () => {
  const search: Anthropic.ContentBlock = { type: 'server_tool_use', id: 'srv_1', name: 'web_search', input: { query: 'Alpha Beta team news' }, caller: { type: 'direct' } } as Anthropic.ServerToolUseBlock;
  const results: Anthropic.ContentBlock = {
    type: 'web_search_tool_result', tool_use_id: 'srv_1', caller: { type: 'direct' },
    content: [
      { type: 'web_search_result', url: 'https://www.bbc.co.uk/sport/alpha', title: 'Alpha sans son capitaine', encrypted_content: 'x', page_age: null },
      { type: 'web_search_result', url: 'http://insecure.example/x', title: 'Ignoré (http)', encrypted_content: 'x', page_age: null },
      { type: 'web_search_result', url: 'https://www.bbc.co.uk/sport/alpha', title: 'Alpha sans son capitaine', encrypted_content: 'y', page_age: null },
    ],
  } as Anthropic.WebSearchToolResultBlock;
  const cited = text('- Capitaine forfait.', [{ type: 'web_search_result_location', url: 'https://www.lequipe.fr/a', title: 'Source citée', cited_text: 'forfait', encrypted_index: 'e' }]);

  it('collects text, cited sources first, search results and queries', async () => {
    const client = fakeClient([message([search, results, cited])]);
    const out = await claudeGroundedGenerator({ apiKey: 'k', client })('Actualité ?');
    expect(out.text).toBe('- Capitaine forfait.');
    expect(out.queries).toEqual(['Alpha Beta team news']);
    expect(out.sources).toEqual([{ title: 'Source citée', uri: 'https://www.lequipe.fr/a' }, { title: 'Alpha sans son capitaine', uri: 'https://www.bbc.co.uk/sport/alpha' }]);
    expect(client.calls[0].tools).toEqual([{ type: 'web_search_20260209', name: 'web_search', max_uses: 5, allowed_domains: [...NEWS_ALLOWED_DOMAINS] }, { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 3, allowed_domains: [...NEWS_ALLOWED_DOMAINS] }]);
    expect(String(client.calls[0].messages[0].content)).toContain('fetch tool');
    expect(out.articlesRead).toBe(0);
  });

  it('puts pages opened in full first among the sources and counts them', async () => {
    const fetched: Anthropic.ContentBlock = {
      type: 'web_fetch_tool_result', tool_use_id: 'f1', caller: { type: 'direct' },
      content: { type: 'web_fetch_result', url: 'https://www.uefa.com/news/press-conference-friday', retrieved_at: null, content: { type: 'document', source: { type: 'text', media_type: 'text/plain', data: '…' }, title: null, citations: null } },
    } as unknown as Anthropic.WebFetchToolResultBlock;
    const out = await claudeGroundedGenerator({ apiKey: 'k', client: fakeClient([message([search, results, fetched, cited])]) })('Actualité ?');
    expect(out.articlesRead).toBe(1);
    expect(out.sources[0]).toEqual({ title: 'uefa.com · press conference friday', uri: 'https://www.uefa.com/news/press-conference-friday' });
    expect(out.sources).toHaveLength(3);
  });

  it('resumes a paused turn by replaying the received content, and keeps every block', async () => {
    const client = fakeClient([message([search, results], 'pause_turn'), message([cited])]);
    const out = await claudeGroundedGenerator({ apiKey: 'k', client })('Actualité ?');
    expect(client.calls).toHaveLength(2);
    expect(client.calls[1].messages).toEqual([{ role: 'user', content: `Actualité ?\n\n${NEWS_FETCH_HINT}` }, { role: 'assistant', content: [search, results] }]);
    expect(out.queries).toEqual(['Alpha Beta team news']); expect(out.sources).toHaveLength(2); expect(out.text).toBe('- Capitaine forfait.');
  });

  it('treats a search error block as no sources', () => {
    const err: Anthropic.ContentBlock = { type: 'web_search_tool_result', tool_use_id: 's', caller: { type: 'direct' }, content: { type: 'web_search_tool_result_error', error_code: 'max_uses_exceeded' } } as Anthropic.WebSearchToolResultBlock;
    expect(parseWebSources([err, text('rien')])).toEqual({ sources: [], queries: [] });
  });

  it('keeps only sources and fetched pages of allowed domains, even if a tool returned others', async () => {
    const mixed: Anthropic.ContentBlock = {
      type: 'web_search_tool_result', tool_use_id: 'srv_1', caller: { type: 'direct' },
      content: [
        { type: 'web_search_result', url: 'https://evil-lequipe.fr/pronostic', title: 'Pronostic', encrypted_content: 'x', page_age: null },
        { type: 'web_search_result', url: 'https://lequipe.fr.evil.test/x', title: 'Faux', encrypted_content: 'x', page_age: null },
        { type: 'web_search_result', url: 'https://www.lequipe.fr/Football/b', title: 'Club B : le point', encrypted_content: 'x', page_age: null },
      ],
    } as Anthropic.WebSearchToolResultBlock;
    const fetchedEvil: Anthropic.ContentBlock = {
      type: 'web_fetch_tool_result', tool_use_id: 'f1', caller: { type: 'direct' },
      content: { type: 'web_fetch_result', url: 'https://pronos-gagnants.test/club-a', retrieved_at: null, content: { type: 'document', source: { type: 'text', media_type: 'text/plain', data: '…' }, title: null, citations: null } },
    } as unknown as Anthropic.WebFetchToolResultBlock;
    const out = await claudeGroundedGenerator({ apiKey: 'k', client: fakeClient([message([search, mixed, fetchedEvil, text('- Rien.')])]) })('Actualité ?');
    expect(out.sources).toEqual([{ title: 'Club B : le point', uri: 'https://www.lequipe.fr/Football/b' }]);
    expect(out.articlesRead).toBe(0);
    expect(parseFetchedUrls([fetchedEvil])).toEqual([]);
  });
});

describe('claudeArticlesReader', () => {
  it('lists the urls really fetched and uses the fetch tool only', async () => {
    const fetched: Anthropic.ContentBlock = {
      type: 'web_fetch_tool_result', tool_use_id: 'f1', caller: { type: 'direct' },
      content: { type: 'web_fetch_result', url: 'https://www.bbc.co.uk/sport/article', retrieved_at: null, content: { type: 'document', source: { type: 'text', media_type: 'text/plain', data: '…' }, title: null, citations: null } },
    } as unknown as Anthropic.WebFetchToolResultBlock;
    const failed: Anthropic.ContentBlock = { type: 'web_fetch_tool_result', tool_use_id: 'f2', caller: { type: 'direct' }, content: { type: 'web_fetch_tool_result_error', error_code: 'url_not_accessible' } } as Anthropic.WebFetchToolResultBlock;
    const client = fakeClient([message([fetched, failed, text('- Blessé.')])]);
    const out = await claudeArticlesReader({ apiKey: 'k', client })('Lis https://www.bbc.co.uk/sport/article');
    expect(out).toEqual({ text: '- Blessé.', modelVersion: 'claude-opus-5-5', read: ['https://www.bbc.co.uk/sport/article'] });
    expect(client.calls[0].tools).toEqual([{ type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 4, allowed_domains: [...NEWS_ALLOWED_DOMAINS] }]);
    expect(parseFetchedUrls([failed])).toEqual([]);
  });
});

describe('claudeJsonGenerator and strictSchema', () => {
  it('requests a json_schema output with a cleaned schema and returns the text', async () => {
    const schema = { type: 'object', properties: { n: { type: 'integer', minimum: 0, maximum: 5 }, tags: { type: 'array', minItems: 1, items: { type: 'string', maxLength: 3 } }, v: { type: 'string', enum: ['a', 'b'], description: 'd' } }, required: ['n'] };
    const client = fakeClient([message([text('{"n":1}')])]);
    const out = await claudeJsonGenerator({ apiKey: 'k', client })('p', schema);
    expect(out.text).toBe('{"n":1}');
    expect(client.calls[0].output_config).toEqual({
      effort: 'low',
      format: { type: 'json_schema', schema: { type: 'object', additionalProperties: false, required: ['n'], properties: { n: { type: 'integer' }, tags: { type: 'array', items: { type: 'string' } }, v: { type: 'string', enum: ['a', 'b'], description: 'd' } } } },
    });
  });

  it('keeps nested objects strict and leaves the original schema untouched', () => {
    const schema = { type: 'object', properties: { m: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } } }, required: ['m'] };
    const strict = strictSchema(schema) as { properties: { m: { items: Record<string, unknown> } } };
    expect(strict.properties.m.items.additionalProperties).toBe(false);
    expect(schema.properties.m.items).not.toHaveProperty('additionalProperties');
  });
});

describe('withFallback and aiProviders', () => {
  it('falls back on failure, except on a request deadline', async () => {
    const log: string[] = [];
    const f = withFallback(async (x: number) => { if (x > 1) throw new Error('boom'); return 'a'; }, async () => 'b', e => e instanceof DeadlineError, m => log.push(m));
    expect(await f(1)).toBe('a'); expect(await f(2)).toBe('b'); expect(log[0]).toMatch(/secours Gemini : boom/);
    const g = withFallback(async () => { throw new DeadlineError('délai'); }, async () => 'b', e => e instanceof DeadlineError);
    await expect(g()).rejects.toBeInstanceOf(DeadlineError);
  });

  it('picks Claude when its key is present, Gemini otherwise, and nothing without a key', () => {
    const log = () => {};
    expect(aiProviders({ apiKey: undefined, anthropicApiKey: 'sk' }, log)).toMatchObject({ provider: 'claude', apiKey: 'sk', model: 'claude-opus-5-5' });
    expect(aiProviders({ apiKey: 'g', anthropicApiKey: 'sk', claudeModel: 'claude-sonnet-5-5' }, log)).toMatchObject({ provider: 'claude', apiKey: 'sk', model: 'claude-sonnet-5-5' });
    expect(aiProviders({ apiKey: 'g', model: 'gemini-x' }, log)).toMatchObject({ provider: 'gemini', apiKey: 'g', model: 'gemini-x' });
    const none = aiProviders({ apiKey: undefined }, log);
    expect(none.provider).toBeNull(); expect(none.readArticles).toBeUndefined();
  });

  it('lets the test generators override the providers', async () => {
    const p = aiProviders({ apiKey: undefined, anthropicApiKey: 'sk', generate: async () => 'mock', generateJson: async () => ({ text: '{}' }) }, () => {});
    expect(await p.generate('x')).toBe('mock'); expect(await p.extractText('x')).toBe('mock'); expect(await p.generateJson('x', {})).toEqual({ text: '{}' });
  });
});
