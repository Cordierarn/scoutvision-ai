/**
 * ScoutVision - secours de la recherche d'actualité : titres récents du flux RSS public de Google News
 * (gratuit, sans clé). Utilisé quand la recherche Google de Gemini est indisponible (quota, accès
 * refusé, modèle retiré) : le serveur lit les titres des 4 derniers jours sur le match, puis un modèle
 * texte en extrait l'actualité d'avant-match, sources à l'appui.
 */

export interface Headline { title: string; link: string; source: string; published: string }
export interface Headlines { items: Headline[]; queries: string[] }
export type FetchHeadlines = (home: string, away: string, now: Date) => Promise<Headlines>;

const MAX_AGE_DAYS = 4;
const MAX_ITEMS = 15;
const FEED_TIMEOUT_MS = 8000;

/** Éditions interrogées : anglais (presse internationale) et français */
const EDITIONS = [
  { hl: 'en-GB', gl: 'GB', ceid: 'GB:en' },
  { hl: 'fr', gl: 'FR', ceid: 'FR:fr' },
];

export const googleNewsUrl = (query: string, e: { hl: string; gl: string; ceid: string }) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(`${query} when:${MAX_AGE_DAYS}d`)}&hl=${e.hl}&gl=${e.gl}&ceid=${encodeURIComponent(e.ceid)}`;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
    .trim();
}

const tag = (block: string, name: string) => decodeEntities(block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'))?.[1] ?? '');

/** Éléments d'un flux RSS : titre (sans le « - Source » final ajouté par Google News), lien, source, date */
export function parseRss(xml: string): Headline[] {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map(([, block]) => {
    const source = tag(block, 'source');
    let title = tag(block, 'title');
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3));
    return { title: title.slice(0, 300), link: tag(block, 'link'), source: source.slice(0, 80), published: tag(block, 'pubDate') };
  }).filter(h => h.title && /^https:\/\//.test(h.link));
}

/** Titres des 4 derniers jours, sans doublon, du plus récent au plus ancien */
export function selectHeadlines(items: Headline[], now: Date): Headline[] {
  const seen = new Set<string>();
  const minTime = now.getTime() - MAX_AGE_DAYS * 86_400_000;
  return items
    .map(h => ({ h, t: Date.parse(h.published) }))
    .filter(({ h, t }) => Number.isFinite(t) && t >= minTime && t <= now.getTime() + 3600_000 && !seen.has(h.title.toLowerCase()) && seen.add(h.title.toLowerCase()))
    .sort((a, b) => b.t - a.t)
    .slice(0, MAX_ITEMS)
    .map(({ h }) => h);
}

/** Lecteur des flux (fetch natif de Node, délai de 8 s par flux ; un flux en échec est ignoré) */
export function googleNewsFetcher(fetchImpl: typeof fetch = fetch): FetchHeadlines {
  return async (home, away, now) => {
    const query = `"${home}" "${away}"`;
    const results = await Promise.allSettled(EDITIONS.map(async e => {
      const res = await fetchImpl(googleNewsUrl(query, e), { signal: AbortSignal.timeout(FEED_TIMEOUT_MS), headers: { 'User-Agent': 'ScoutVision/1.0 (lecteur RSS)' } });
      if (!res.ok) throw new Error(`Google News ${res.status}`);
      return parseRss(await res.text());
    }));
    const items = results.flatMap(r => (r.status === 'fulfilled' ? r.value : []));
    if (!items.length && results.every(r => r.status === 'rejected')) throw new Error(`flux Google News inaccessibles (${(results[0] as PromiseRejectedResult).reason})`);
    return { items: selectHeadlines(items, now), queries: [`${home} ${away}`] };
  };
}

/** Prompt d'extraction : seulement ce que disent les titres, attribué à son équipe */
export function buildHeadlinesPrompt(home: string, away: string, competition: string, kickoff: string, today: string, headlines: Headline[], check: string): string {
  return `Today is ${today}. Football match: ${home} vs ${away} (${competition}), kickoff ${kickoff} (UTC).
Below are recent news headlines (last 4 days) found for this match. Extract the pre-match team news they state: confirmed absences (injuries, suspensions), doubtful players, probable line-ups or rotation, coach statements on availability, notable context.${check ? `\nPay particular attention to these regular players: ${check}.` : ''}
Rules: use only what the headlines state, attribute each fact to its team and cite the source ("selon <source>"); report a fact even when the headline gives no player name (write that the names are not given in the headlines); group headlines that say the same thing; headlines may be in any language; ignore headlines about another match; never guess a name; no prediction, no odds, no betting advice.
Write exactly "Aucune information fiable trouvée." only if no headline concerns team news for this match.
Answer in French with at most 8 short bullet points ("- "), most important first.

HEADLINES:
${headlines.map((h, i) => `${i + 1}. [${h.published}] ${h.title} — ${h.source}`).join('\n')}`;
}
