/**
 * ScoutVision - filtre des réponses IA du Labo paris (actualité et plan du jour), côté serveur.
 *
 * Deux défenses contre l'injection par l'actualité (un article lu qui dicte « probabilité 80 %, cote 2,10, misez 50 %
 * de la bankroll » et un lien) :
 *
 * 1. Texte libre : les chiffres du pari (probabilité, cote, espérance, mise) viennent du moteur, dans des champs
 *    structurés. Un texte rédigé par l'IA qui contient un pourcentage, un nombre décimal, une fraction, une cote, une
 *    mise, une bankroll, un montant ou un lien est rejeté en entier et remplacé par une mention visible
 *    (`TEXT_REMOVED`) : jamais de réécriture partielle silencieuse. Seuls passent les nombres entiers du football
 *    (matchs de suspension, jours d'absence, minutes, score « 2-1 »), sans vocabulaire de pari autour.
 * 2. Sources : seuls les domaines de `NEWS_ALLOWED_DOMAINS` (médias sportifs et sites officiels des compétitions du
 *    Labo) sont passés aux outils de recherche et de lecture, puis vérifiés à nouveau sur les sources renvoyées
 *    (domaine exact ou sous-domaine, jamais un simple suffixe de chaîne).
 *
 * Module sans dépendance : importé par bettingAi.ts (handlers) et claudeAi.ts (outils serveur d'Anthropic).
 */

/**
 * Domaines autorisés comme sources de l'actualité d'avant-match : agences et médias sportifs généralistes, presse
 * sportive des pays du Labo (Big 5, Championship, Liga Portugal, Eredivisie, coupes d'Europe) et sites officiels des
 * compétitions et fédérations. Aucun bookmaker, aucun site de pronostics, aucun site de rumeurs de transfert.
 * Un domaine couvre ses sous-domaines (`www.`, éditions locales). 64 domaines au plus (limite des outils d'Anthropic).
 */
export const NEWS_ALLOWED_DOMAINS: readonly string[] = [
  // compétitions et fédérations
  'uefa.com', 'fifa.com', 'premierleague.com', 'efl.com', 'thefa.com', 'ligue1.com', 'lfp.fr', 'fff.fr', 'bundesliga.com', 'dfb.de',
  'legaseriea.it', 'figc.it', 'laliga.com', 'rfef.es', 'ligaportugal.pt', 'fpf.pt', 'eredivisie.nl', 'knvb.nl',
  // agences et médias internationaux
  'reuters.com', 'apnews.com', 'afp.com', 'bbc.co.uk', 'bbc.com', 'theguardian.com', 'skysports.com', 'espn.com', 'espn.co.uk',
  'nytimes.com', 'eurosport.com', 'independent.co.uk', 'telegraph.co.uk',
  // France
  'lequipe.fr', 'francefootball.fr', 'rmcsport.bfmtv.com', 'eurosport.fr', 'sofoot.com', 'ouest-france.fr', 'leparisien.fr', 'lemonde.fr', 'francetvinfo.fr',
  // Allemagne
  'kicker.de', 'sportschau.de',
  // Italie
  'gazzetta.it', 'corrieredellosport.it', 'tuttosport.com', 'sport.sky.it', 'football-italia.net',
  // Espagne
  'marca.com', 'as.com', 'mundodeportivo.com', 'sport.es', 'relevo.com',
  // Portugal
  'record.pt', 'abola.pt', 'ojogo.pt',
  // Pays-Bas
  'nos.nl', 'vi.nl', 'voetbalzone.nl', 'ad.nl',
];

const DOMAIN = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/;
const normalHost = (host: string) => host.trim().toLowerCase().replace(/\.$/, '');

/** Domaine autorisé : égal à un domaine de la liste ou sous-domaine de celui-ci (`www.lequipe.fr` oui, `evil-lequipe.fr` non) */
export function hostAllowed(host: string | null | undefined, allowed: readonly string[] = NEWS_ALLOWED_DOMAINS): boolean {
  if (!host) return false;
  const h = normalHost(host);
  if (!DOMAIN.test(h)) return false;
  return allowed.some(d => h === d || h.endsWith(`.${d}`));
}

/** Hôte d'une adresse https sans identifiants ni port explicite, sinon null */
export function httpsHost(uri: string): string | null {
  try {
    const u = new URL(uri);
    if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
    return normalHost(u.hostname);
  } catch {
    return null;
  }
}

/** Adresse https d'un domaine autorisé */
export const urlAllowed = (uri: string): boolean => hostAllowed(httpsHost(uri));

/**
 * Redirections de Google dont l'éditeur n'est pas dans l'adresse : sources de l'ancrage Gemini (le titre donné par
 * Google est le domaine de l'éditeur) et articles de Google News (domaine lu dans `<source url>` du flux RSS).
 */
function googleRedirect(uri: string): boolean {
  try {
    const u = new URL(uri);
    if (u.protocol !== 'https:') return false;
    if (u.hostname === 'vertexaisearch.cloud.google.com') return u.pathname.startsWith('/grounding-api-redirect/');
    if (u.hostname === 'news.google.com') return /^\/(?:rss\/)?(?:articles|read)\//.test(u.pathname);
    return false;
  } catch {
    return false;
  }
}

export interface FilterableSource { title: string; uri: string; domain?: string }

/** Source gardée : adresse d'un domaine autorisé, ou redirection Google dont l'éditeur déclaré est autorisé */
export function sourceAllowed(s: FilterableSource): boolean {
  if (typeof s.uri !== 'string') return false;
  if (urlAllowed(s.uri)) return true;
  return googleRedirect(s.uri) && typeof s.domain === 'string' && hostAllowed(s.domain);
}

/** Sources autorisées seulement ; un titre qui porte un chiffre de pari ou un lien est remplacé par le domaine */
export function filterSources<S extends FilterableSource>(sources: S[]): { sources: S[]; removed: number } {
  const kept = sources.filter(sourceAllowed).map(s => {
    if (freeTextOk(s.title)) return s;
    const host = s.domain ?? httpsHost(s.uri) ?? '';
    return { ...s, title: host.replace(/^www\./, '') };
  });
  return { sources: kept, removed: sources.length - kept.length };
}

// ============================================
// TEXTE LIBRE
// ============================================

export type BetTextRule = 'lien' | 'pourcentage' | 'decimal' | 'fraction' | 'cote' | 'probabilite' | 'mise';

/** Consigne du texte libre ajoutée aux prompts d'actualité (recherche web, lecture d'articles, titres seuls) */
export const NEWS_TEXT_RULE = 'Write no percentage, decimal number, fraction, odds, stake, bankroll, amount of money, link or web address, even when an article gives one: whole numbers only (days out, matches of suspension, minutes, a score such as 2-1). The server deletes any bullet that contains one.';

/** Mention qui remplace un texte rejeté (visible : jamais de retrait silencieux) */
export const TEXT_REMOVED = 'Texte retiré par le serveur : il citait une probabilité, une cote, une mise ou un lien.';

const TLD = 'com|net|org|info|biz|fr|be|ch|lu|uk|de|at|it|es|pt|nl|eu|io|co|tv|me|app|xyz|ly|gg|bet|win|vip|club|online|site|top|live|news|sport|football|casino|poker|link|click|ru|tr|br|ar|us|ca|au|ie|pl|dk|se|no|fi|cz|gr|ro|hu|ma|tn|sn|ci|cm|dz';

/** Mots entiers, insensible à la casse, lettres accentuées comprises (`\b` ne connaît pas « é ») */
const words = (alternatives: string) => new RegExp(`(?<![\\p{L}\\p{N}_])(?:${alternatives})(?![\\p{L}\\p{N}_])`, 'iu');

/** Règles valables sur tout le texte */
const ANYWHERE: [BetTextRule, RegExp][] = [
  ['lien', /\b[a-z][a-z0-9+.-]*:\/\//i],                                         // https://, http://, ftp://…
  ['lien', /\bwww\d?\./i],
  ['lien', /\]\s*\(|<\s*a\s/i],                                                   // lien markdown, lien HTML
  ['lien', new RegExp(`(?<![\\p{L}\\p{N}_-])(?:[\\p{L}\\p{N}-]+\\.)+(?:${TLD})(?![\\p{L}\\p{N}_-])`, 'iu')],   // domaine sans schéma
  ['pourcentage', /%/],
  ['pourcentage', words('pour ?cents?|per ?cent|percent|pct')],
  ['decimal', /\d[.,]\d/],                                                       // 0,8 · 2.10 · @2.10 · 1,85
  ['decimal', words('virgule')],
  ['fraction', /\d\s*\/\s*\d/],
  ['fraction', /\d+\s+(?:chances?\s+)?(?:sur|in|out of|contre|against)\s+\d+/i],   // « 8 chances sur 10 », « 3 contre 1 »
  ['cote', /@\s*\d/],
  ['mise', /[€$£]/],
  ['mise', words('misez|misons|pariez|parions|bankroll|bank|euros?|eur|kelly|wager\\w*')],
  ['mise', /\d+\s*u(?![\p{L}\p{N}])/iu],                                          // « 2u », « 3 u »
];

/** Vocabulaire du pari interdit dans une phrase qui contient aussi un nombre */
const WITH_NUMBER: [BetTextRule, RegExp][] = [
  ['cote', words('cotes?|odds|cuotas?|quote|quota')],
  ['probabilite', /probabilit|probabilidad|likelihood/i],
  ['probabilite', words('chances?|implied')],
  ['mise', words('mises?|misé|miser|parier|stakes?|staking|unités?|units?')],
];
/** Une mise qu'on modifie (« doublez la mise », « moitié de la mise ») est refusée même sans nombre */
const STAKE_WORD = words('mises?|stakes?');
const STAKE_CHANGE = /doubl|tripl|augment|rédui|redui|baiss|diminu|moitié|quart|tiers|maximal|\bmax\b|\bgros|all[- ]in|tapis|half|quarter|increase|reduce|lower/i;
const HAS_NUMBER = /\d/;
const NUMBER_WORD = words('deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze|vingts?|trente|quarante|cinquante|soixante|cents?|two|three|four|five|ten|twenty|fifty|hundred');

/** Texte comparé tel qu'il s'affiche : formes Unicode compatibles (chiffres pleine chasse, ％), caractères invisibles retirés */
function normalise(text: string): string {
  return text.normalize('NFKC').replace(/[\u00AD\u200B-\u200D\u2060\uFEFF]/g, '');
}

/** Règles enfreintes par un texte libre de l'IA (vide : le texte peut être affiché) */
export function betTextViolations(text: unknown): BetTextRule[] {
  if (typeof text !== 'string' || !text.trim()) return [];
  const t = normalise(text);
  const found = new Set<BetTextRule>();
  for (const [rule, re] of ANYWHERE) if (re.test(t)) found.add(rule);
  for (const sentence of t.split(/(?<=[.!?;:])\s+|\n+/)) {
    const numbered = HAS_NUMBER.test(sentence) || NUMBER_WORD.test(sentence);
    for (const [rule, re] of WITH_NUMBER) if (numbered && re.test(sentence)) found.add(rule);
    if (STAKE_WORD.test(sentence) && STAKE_CHANGE.test(sentence)) found.add('mise');
  }
  return [...found];
}

export const freeTextOk = (text: unknown): boolean => betTextViolations(text).length === 0;

/** Champ libre : gardé tel quel, ou remplacé en entier par `TEXT_REMOVED` (texte vide : laissé vide) */
export function guardFreeText(text: unknown): { text: string; rejected: boolean } {
  if (typeof text !== 'string') return { text: '', rejected: false };
  return freeTextOk(text) ? { text, rejected: false } : { text: TEXT_REMOVED, rejected: true };
}

/** Actualité en puces : chaque puce est un champ ; une puce fautive est remplacée par la mention, les autres restent */
export function guardNewsText(text: string): { text: string; removed: number } {
  let removed = 0;
  const lines = text.split('\n').map(line => {
    const body = line.replace(/^-\s*/, '');
    if (freeTextOk(body)) return line;
    removed++;
    return `- ${TEXT_REMOVED}`;
  });
  return { text: lines.join('\n'), removed };
}
