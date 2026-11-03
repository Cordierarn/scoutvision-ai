/**
 * Secours de la recherche d'actualité (server/newsFeed.ts) et son branchement dans l'assistant, sans
 * réseau : lecture du flux RSS, tri des titres récents, extraction par un modèle texte simulé.
 */
import { describe, expect, it } from 'vitest';
import { articlesToRead, buildArticlesPrompt, buildHeadlinesPrompt, decodeEntities, directLink, googleNewsUrl, isSpam, newsFeedFetcher, newsQueries, parseRss, selectHeadlines, shortName } from './newsFeed';
import { NewsCache, handleBettingNews, SuggestionsIndexFile } from './bettingAi';
import { NoModelAvailable } from './geminiModels';

const NOW = new Date('2026-11-07T12:00:00Z');
const RSS = `<?xml version="1.0"?><rss><channel>
<item><title>Club A striker ruled out against Club B - Daily Test</title><link>https://news.example.test/1</link><pubDate>Fri, 06 Nov 2026 18:00:00 GMT</pubDate><source url="https://dailytest.example">Daily Test</source></item>
<item><title><![CDATA[Club B coach: &quot;everyone is fit&quot; - Le Journal]]></title><link>https://news.example.test/2</link><pubDate>Sat, 07 Nov 2026 09:00:00 GMT</pubDate><source url="https://journal.example">Le Journal</source></item>
<item><title>Old story - Archive</title><link>https://news.example.test/3</link><pubDate>Sun, 25 Oct 2026 09:00:00 GMT</pubDate><source url="https://a.example">Archive</source></item>
<item><title>No link</title><link>javascript:alert(1)</link><pubDate>Sat, 07 Nov 2026 09:00:00 GMT</pubDate></item>
</channel></rss>`;

describe('flux Google News', () => {
  it('lit les éléments, retire la source du titre, décode les entités et écarte les liens non https', () => {
    const items = parseRss(RSS);
    expect(items.map(i => i.title)).toEqual(['Club A striker ruled out against Club B', 'Club B coach: "everyone is fit"', 'Old story']);
    expect(items[1].source).toBe('Le Journal');
    expect(decodeEntities('L&#39;entra&#xEE;neur &amp; co')).toBe("L'entraîneur & co");
  });

  it('garde les titres des 4 derniers jours, sans doublon, du plus récent au plus ancien', () => {
    const items = parseRss(RSS);
    expect(selectHeadlines([...items, items[0]], NOW).map(i => i.link)).toEqual(['https://news.example.test/2', 'https://news.example.test/1']);
  });

  it('interroge Google News (match + absences de chaque équipe) et Bing News, en anglais et en français ; tolère un flux en échec', async () => {
    const urls: string[] = [];
    const fetcher = newsFeedFetcher((async (url: string) => {
      urls.push(url);
      return url.includes('bing.com') ? new Response('erreur', { status: 503 }) : new Response(RSS, { status: 200 });
    }) as unknown as typeof fetch);
    const out = await fetcher('VfB Club A', 'Club B', NOW);
    expect(urls).toHaveLength(8);                                   // 2 éditions × (3 requêtes Google + 1 Bing)
    expect(urls[0]).toBe(googleNewsUrl('Club A Club B', { hl: 'en-GB', gl: 'GB', ceid: 'GB:en' }));
    expect(urls[0]).toContain('when%3A4d');
    expect(urls.some(u => u.includes(encodeURIComponent('Club A (blessure OR')))).toBe(true);
    expect(out.items.map(i => i.link)).toEqual(['https://news.example.test/1', 'https://news.example.test/2']);   // absence d'abord
    expect(out.queries).toEqual(['Club A Club B']);
    const down = newsFeedFetcher((async () => new Response('', { status: 503 })) as unknown as typeof fetch);
    await expect(down('Club A', 'Club B', NOW)).rejects.toThrow('inaccessibles');
  });

  it('noms courts, requêtes par équipe, liens Bing directs, extrait, spam écarté', () => {
    expect(shortName('VfB Stuttgart')).toBe('Stuttgart');
    expect(shortName('Real Madrid')).toBe('Real Madrid');
    expect(newsQueries('VfB Stuttgart', 'Galatasaray', 'en')).toEqual(['Stuttgart Galatasaray', 'Stuttgart (injury OR injured OR "ruled out" OR suspended OR "team news" OR lineup)', 'Galatasaray (injury OR injured OR "ruled out" OR suspended OR "team news" OR lineup)']);
    expect(directLink('https://www.bing.com/news/apiclick.aspx?ref=FexRss&url=http%3a%2f%2fwww.example.test%2farticle&c=1')).toBe('https://www.example.test/article');
    const bing = parseRss('<item><title>Club B defender suspended</title><link>https://www.bing.com/news/apiclick.aspx?url=https%3a%2f%2fwww.example.test%2fa</link><description>The defender misses the trip after a red card.</description><pubDate>Sat, 07 Nov 2026 08:00:00 GMT</pubDate></item>');
    expect(bing[0]).toMatchObject({ link: 'https://www.example.test/a', source: 'example.test', snippet: 'The defender misses the trip after a red card.' });
    expect(isSpam({ title: '!!+[free/Live] Club A vs Club B watch Live free', link: '', source: '', published: '' })).toBe(true);
    expect(isSpam({ title: '[𝐖𝐀𝐓𝐂𝐇𝐋𝐈𝐕𝐄] Club A vs Club B', link: '', source: '', published: '' })).toBe(true);
    expect(isSpam({ title: 'Club A striker ruled out', link: '', source: '', published: '' })).toBe(false);
  });

  it('fait lire les articles qui parlent d\'effectif, au plus 4', () => {
    const items = parseRss(RSS);
    expect(articlesToRead(items).map(a => a.link)).toEqual(['https://news.example.test/1']);
    const prompt = buildArticlesPrompt('Club A', 'Club B', 'AAA', '2026-11-07T19:00:00Z', '2026-11-07', articlesToRead(items), items, '');
    expect(prompt).toContain('- https://news.example.test/1 (Daily Test: Club A striker ruled out against Club B)');
    expect(prompt).toContain('use the URL context tool');
  });

  it('demande de n\'extraire que ce que disent les titres', () => {
    const prompt = buildHeadlinesPrompt('Club A', 'Club B', 'AAA', '2026-11-07T19:00:00Z', '2026-11-07', parseRss(RSS).slice(0, 1), 'Club A: Buteur A');
    expect(prompt).toContain('use only what the articles or headlines state');
    expect(prompt).toContain('1. [Fri, 06 Nov 2026 18:00:00 GMT] Club A striker ruled out against Club B — Daily Test');
    expect(prompt).toContain('Buteur A');
  });
});

describe('secours dans l\'assistant', () => {
  const INDEX: SuggestionsIndexFile = {
    generatedAt: '2026-11-07T11:45:00Z', season: '2026-27', bookmaker: 'Bookmaker test',
    matches: [{ matchId: 'm1', competition: 'AAA', date: '2026-11-07', home: 'Club A', away: 'Club B', status: 'ok', kickoff: '2026-11-07T19:00:00Z',
      profiles: { equilibre: { suggestions: [], combo: null } } }],
  };
  const base = {
    apiKey: 'AIzaTEST-secret-key-123', model: 'modele-test', loadIndex: () => INDEX, news: new NewsCache(), now: () => NOW, log: () => {}, sleep: async () => {},
    generateGrounded: async () => { throw new NoModelAvailable(['gemini-2.5-flash'], Object.assign(new Error('models/gemini-2.5-flash is not found'), { status: 404 })); },
    generateJson: async () => ({ text: '{}' }),
  };

  it('quand la recherche Gemini échoue, lit les titres Google News et garde le motif', async () => {
    let prompt = '';
    const out = await handleBettingNews({ matchId: 'm1' }, {
      ...base, news: new NewsCache(),
      fetchHeadlines: async () => ({ items: parseRss(RSS).slice(0, 2), queries: ['Club A Club B'] }),
      generateText: async p => { prompt = p; return { text: '- Club A : attaquant absent (selon Daily Test).', modelVersion: 'modele-texte' }; },
    });
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ method: 'news-feed', text: '- Club A : attaquant absent (selon Daily Test).', model: 'modele-texte', queries: ['Club A Club B'] });
    expect((out.body.sources as { title: string }[])[0].title).toBe('Daily Test : Club A striker ruled out against Club B');
    expect(String(out.body.fallbackReason)).toContain('Dernier refus de Google : models/gemini-2.5-flash is not found');
    expect(prompt).toContain('HEADLINES');
  });

  it('lit les articles quand c\'est possible : sources lues en tête, nombre d\'articles lus', async () => {
    let usedHeadlinesOnly = false;
    const out = await handleBettingNews({ matchId: 'm1' }, {
      ...base, news: new NewsCache(),
      fetchHeadlines: async () => ({ items: parseRss(RSS).slice(0, 2), queries: ['Club A Club B'] }),
      readArticles: async () => ({ text: '- Club A : Buteur A forfait (selon Daily Test).', modelVersion: 'modele-lecture', read: ['https://news.example.test/1'] }),
      generateText: async () => { usedHeadlinesOnly = true; return ''; },
    });
    expect(out.body).toMatchObject({ articlesRead: 1, model: 'modele-lecture', text: '- Club A : Buteur A forfait (selon Daily Test).' });
    expect((out.body.sources as { title: string }[])[0].title).toBe('[lu] Daily Test : Club A striker ruled out against Club B');
    expect(usedHeadlinesOnly).toBe(false);
    const unreadable = await handleBettingNews({ matchId: 'm1' }, {
      ...base, news: new NewsCache(),
      fetchHeadlines: async () => ({ items: parseRss(RSS).slice(0, 2), queries: ['q'] }),
      readArticles: async () => ({ text: 'rien', read: [] }),
      generateText: async () => ({ text: '- Club A : attaquant absent (selon Daily Test).' }),
    });
    expect(unreadable.body).toMatchObject({ articlesRead: 0, text: '- Club A : attaquant absent (selon Daily Test).' });
  });

  it('sans titre récent : « Aucune information fiable trouvée. » sans appeler le modèle ; secours en échec : les deux motifs', async () => {
    let called = false;
    const empty = await handleBettingNews({ matchId: 'm1' }, { ...base, news: new NewsCache(), fetchHeadlines: async () => ({ items: [], queries: ['q'] }), generateText: async () => { called = true; return ''; } });
    expect(empty.body.text).toBe('Aucune information fiable trouvée.');
    expect(called).toBe(false);
    const failed = await handleBettingNews({ matchId: 'm1' }, { ...base, news: new NewsCache(), fetchHeadlines: async () => { throw new Error('flux Google News inaccessibles'); }, generateText: async () => '' });
    expect(failed.status).toBe(502);
    expect(String(failed.body.error)).toContain('Secours par les titres Google News en échec : flux Google News inaccessibles');
  });
});
