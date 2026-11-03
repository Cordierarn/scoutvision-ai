/**
 * ScoutVision - secours de la recherche d'actualité, quand la recherche Google de Gemini est indisponible
 * (quota, accès refusé, modèle retiré). Gratuit, sans clé :
 * 1. titres récents des flux RSS publics de Google News et de Bing News (noms courts des équipes, requête
 *    du match et requêtes blessures / compositions par équipe, en anglais et en français) ;
 * 2. filtre anti-spam (annonces de streaming), tri par pertinence (mots d'absence et de composition
 *    dans plusieurs langues, mention des deux équipes, fraîcheur) ;
 * 3. lecture des articles les plus pertinents par Gemini (outil URL context, disponible au niveau gratuit),
 *    sinon extraction à partir des seuls titres.
 */

export interface Headline { title: string; link: string; source: string; published: string; snippet?: string }
export interface Headlines { items: Headline[]; queries: string[] }
export type FetchHeadlines = (home: string, away: string, now: Date) => Promise<Headlines>;

const MAX_AGE_DAYS = 4;
const MAX_ITEMS = 15;
export const MAX_ARTICLES = 4;
const FEED_TIMEOUT_MS = 8000;

/** Éditions interrogées : anglais (presse internationale) et français */
const EDITIONS = [
  { hl: 'en-GB', gl: 'GB', ceid: 'GB:en', lang: 'en' },
  { hl: 'fr', gl: 'FR', ceid: 'FR:fr', lang: 'fr' },
] as const;
type Edition = typeof EDITIONS[number];

const TEAM_NEWS_TERMS: Record<Edition['lang'], string> = {
  en: '(injury OR injured OR "ruled out" OR suspended OR "team news" OR lineup)',
  fr: '(blessure OR blessé OR forfait OR absent OR suspendu OR composition)',
};

// Sigles de forme juridique retirés des noms (« VfB Stuttgart » → « Stuttgart ») : la presse les omet souvent
const LEGAL = new Set(['fc', 'cf', 'afc', 'ac', 'as', 'sc', 'sv', 'vfb', 'vfl', 'tsg', 'ssc', 'ogc', 'rc', 'rcd', 'cd', 'ud', 'sd', 'fk', 'sk', 'bk', 'if', '1.']);
export function shortName(team: string): string {
  const kept = team.split(/\s+/).filter(t => !LEGAL.has(t.toLowerCase()));
  return kept.length ? kept.join(' ') : team;
}

export const googleNewsUrl = (query: string, e: { hl: string; gl: string; ceid: string }) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(`${query} when:${MAX_AGE_DAYS}d`)}&hl=${e.hl}&gl=${e.gl}&ceid=${encodeURIComponent(e.ceid)}`;
export const bingNewsUrl = (query: string, e: { hl: string }) =>
  `https://www.bing.com/news/search?q=${encodeURIComponent(query)}&format=rss&setlang=${e.hl.slice(0, 2)}&qft=${encodeURIComponent('interval="7"')}`;

/** Requêtes : le match, puis l'actualité de chaque équipe (absences, compositions) */
export function newsQueries(home: string, away: string, lang: Edition['lang']): string[] {
  const h = shortName(home), a = shortName(away);
  return [`${h} ${a}`, `${h} ${TEAM_NEWS_TERMS[lang]}`, `${a} ${TEAM_NEWS_TERMS[lang]}`];
}

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
const stripHtml = (s: string) => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

/** Lien d'article d'un élément Bing News : l'adresse de l'éditeur est dans le paramètre `url` de la redirection */
export function directLink(link: string): string {
  try {
    const u = new URL(link);
    const target = /(^|\.)bing\.com$/.test(u.hostname) ? u.searchParams.get('url') : null;
    return target && /^https?:\/\//.test(target) ? target.replace(/^http:/, 'https:') : link;
  } catch {
    return link;
  }
}

/** Éléments d'un flux RSS (Google News ou Bing News) : titre sans le « - Source » final, lien, source, date, extrait */
export function parseRss(xml: string): Headline[] {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map(([, block]) => {
    let source = tag(block, 'source') || tag(block, 'News:Source');
    let title = tag(block, 'title');
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3));
    const description = stripHtml(tag(block, 'description'));
    const link = directLink(tag(block, 'link'));
    if (!source) { try { source = new URL(link).hostname.replace(/^www\./, ''); } catch { source = ''; } }
    // extrait utile seulement s'il ne répète pas le titre (Google News n'y met que le titre et la source)
    const snippet = description && !description.startsWith(title.slice(0, 40)) ? description.slice(0, 300) : undefined;
    return { title: title.slice(0, 300), link, source: source.slice(0, 80), published: tag(block, 'pubDate'), ...(snippet ? { snippet } : {}) };
  }).filter(h => h.title && /^https:\/\//.test(h.link));
}

// Annonces de streaming illégal et titres en caractères « fantaisie » (spam des flux d'actualité)
const SPAM = /\b(live\s*stream(ing)?|watch\s*(it\s*)?live|streaming\s*(free|gratuit)|free\s*live|en\s*direct\s*gratuit|reddit|crackstream)\b|\[\s*(watch|live|stream)/i;
const FANCY = /[\u{1D400}-\u{1D7FF}\u{FF01}-\u{FF5E}℀-⅏]/u;
export const isSpam = (h: Headline) => SPAM.test(h.title) || FANCY.test(h.title);

// Mots d'actualité d'effectif (absences, retours, compositions) dans les langues des championnats couverts
const TEAM_NEWS = /injur|ruled out|sidelined|doubt|miss(es|ing)?\b|out (of|for)\b|suspen|ban(ned)?\b|fitness|return|line-?up|starting xi|\bxi\b|team news|squad|blessé|blessure|forfait|absen|incertain|suspendu|composition|groupe|retour|verletz|ausfall|fehlt|aufstellung|kader|lesion|infortun|squalific|formazione|convocat|baja|lesión|sancion|alineaci|lesão|desfalque|escala|blessur|geblesseerd|opstelling|sakat|cezal|kadro|ilk 11/i;

/** Pertinence d'un titre : mots d'actualité d'effectif, mention des deux équipes, fraîcheur */
export function relevance(h: Headline, home: string, away: string, now: Date): number {
  const text = `${h.title} ${h.snippet ?? ''}`.toLowerCase();
  const mentions = [shortName(home), shortName(away)].filter(t => text.includes(t.toLowerCase().split(' ')[0])).length;
  const ageHours = Math.max(0, (now.getTime() - Date.parse(h.published)) / 3600_000);
  return (TEAM_NEWS.test(text) ? 3 : 0) + mentions + Math.max(0, 1 - ageHours / (MAX_AGE_DAYS * 24));
}

/** Titres des 4 derniers jours, sans spam ni doublon, du plus pertinent au moins pertinent */
export function selectHeadlines(items: Headline[], now: Date, home = '', away = ''): Headline[] {
  const seen = new Set<string>();
  const minTime = now.getTime() - MAX_AGE_DAYS * 86_400_000;
  return items
    .map(h => ({ h, t: Date.parse(h.published) }))
    .filter(({ h, t }) => Number.isFinite(t) && t >= minTime && t <= now.getTime() + 3600_000 && !isSpam(h)
      && !seen.has(h.title.toLowerCase()) && seen.add(h.title.toLowerCase()))
    .map(({ h, t }) => ({ h, t, score: home ? relevance(h, home, away, now) : 0 }))
    .sort((a, b) => b.score - a.score || b.t - a.t)
    .slice(0, MAX_ITEMS)
    .map(({ h }) => h);
}

/** Articles à faire lire : les plus pertinents qui parlent d'effectif (un par lien) */
export function articlesToRead(items: Headline[]): Headline[] {
  return items.filter(h => TEAM_NEWS.test(`${h.title} ${h.snippet ?? ''}`)).slice(0, MAX_ARTICLES);
}

/** Lecteur des flux (fetch natif de Node, délai de 8 s par flux ; un flux en échec est ignoré) */
export function newsFeedFetcher(fetchImpl: typeof fetch = fetch): FetchHeadlines {
  return async (home, away, now) => {
    const urls = EDITIONS.flatMap(e => newsQueries(home, away, e.lang).flatMap((q, i) => [googleNewsUrl(q, e), ...(i === 0 ? [bingNewsUrl(q, e)] : [])]));
    const results = await Promise.allSettled(urls.map(async url => {
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(FEED_TIMEOUT_MS), headers: { 'User-Agent': 'ScoutVision/1.0 (lecteur RSS)' } });
      if (!res.ok) throw new Error(`${new URL(url).hostname} ${res.status}`);
      return parseRss(await res.text());
    }));
    const items = results.flatMap(r => (r.status === 'fulfilled' ? r.value : []));
    if (!items.length && results.every(r => r.status === 'rejected')) throw new Error(`flux d'actualité inaccessibles (${(results[0] as PromiseRejectedResult).reason})`);
    return { items: selectHeadlines(items, now, home, away), queries: [`${shortName(home)} ${shortName(away)}`] };
  };
}
/** Ancien nom, conservé pour les appels existants */
export const googleNewsFetcher = newsFeedFetcher;

const RULES = `Rules: use only what the articles or headlines state, attribute each fact to its team and cite the source ("selon <source>"); report a fact even when no player name is given (say so); group items that say the same thing; texts may be in any language; ignore items about another match; never guess a name; no prediction, no odds, no betting advice.
Write exactly "Aucune information fiable trouvée." only if nothing concerns team news for this match.
Answer in French with at most 8 short bullet points ("- "), most important first.`;

const listHeadlines = (headlines: Headline[]) =>
  headlines.map((h, i) => `${i + 1}. [${h.published}] ${h.title} — ${h.source}${h.snippet ? `\n   ${h.snippet}` : ''}`).join('\n');

const intro = (home: string, away: string, competition: string, kickoff: string, today: string, check: string) =>
  `Today is ${today}. Football match: ${home} vs ${away} (${competition}), kickoff ${kickoff} (UTC).
Extract the pre-match team news: confirmed absences (injuries, suspensions), doubtful players, probable line-ups or rotation, coach statements on availability, notable context.${check ? `\nPay particular attention to these regular players: ${check}.` : ''}`;

/** Prompt d'extraction à partir des seuls titres */
export function buildHeadlinesPrompt(home: string, away: string, competition: string, kickoff: string, today: string, headlines: Headline[], check: string): string {
  return `${intro(home, away, competition, kickoff, today, check)}
Source material: recent news headlines (last 4 days) found for this match.
${RULES}

HEADLINES:
${listHeadlines(headlines)}`;
}

/** Prompt de lecture d'articles (outil URL context) : les articles d'abord, les titres en complément */
export function buildArticlesPrompt(home: string, away: string, competition: string, kickoff: string, today: string, articles: Headline[], headlines: Headline[], check: string): string {
  return `${intro(home, away, competition, kickoff, today, check)}
Read these articles (use the URL context tool), then complete with the headlines below. Name the players when the articles name them.
${articles.map(a => `- ${a.link} (${a.source}: ${a.title})`).join('\n')}
${RULES}

HEADLINES:
${listHeadlines(headlines)}`;
}
