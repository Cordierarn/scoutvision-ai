/**
 * ScoutVision - contrôle du rapport rédigé (déterministe, côté serveur)
 *
 * Repère dans le texte du modèle ce qui ne s'appuie sur aucune donnée envoyée :
 * sujets non mesurés (pression, mentalité, vitesse…), prix de transfert, niveau futur,
 * verdict de recrutement, nombre absent des données, titres en anglais, réserve de
 * saison en cours manquante. Les problèmes servent à une passe de correction ; ce qui
 * subsiste ensuite est retiré phrase par phrase.
 */

import { metricLabel } from '../utils/labels';
import { REPORT_HEADINGS, ReportFacts } from './reportFacts';

export type IssueKind = 'topic' | 'number' | 'heading' | 'season';

export interface ReportIssue {
  kind: IssueKind;
  rule: string;          // règle enfreinte (envoyée au modèle pour la correction)
  excerpt: string;       // passage fautif
}

export interface TopicRule {
  rule: string;
  pattern: RegExp;
  // La donnée correspondante, si ScoutVision l'envoie, autorise le sujet
  unlessMetric?: RegExp;
}

// Sujets que ScoutVision ne mesure pas, ou formulations interdites quelle que soit la donnée
export const TOPIC_RULES: TopicRule[] = [
  { rule: 'play under pressure / pressure applied is not measured', pattern: /sous (?:la )?pression|pressing adverse|pression (?:exercée|appliquée|mise)|under pressure/i, unlessMetric: /pression|pressure|pressing/i },
  { rule: 'off-the-ball runs are not measured', pattern: /courses? sans (?:le )?ballon|appels? (?:de balle|en profondeur)|off[- ]the[- ]ball/i, unlessMetric: /sans ballon|off[- ]ball/i },
  { rule: 'top speed and acceleration are not measured', pattern: /vitesse (?:maximale|de pointe)|pointe de vitesse|accélération|explosivit|\bsprints?\b|top speed/i, unlessMetric: /sprint|vitesse max|accél/i },
  { rule: 'mentality, personality and mental traits are not measured', pattern: /mentalit|personnalit|caractère|maturit|leadership|\bleader\b|intelligen|concentration(?! (?:de|des) (?:tirs|actions|ballons))|concentré|sang-froid|état d'esprit|combativit|abnégation|\bmental(?:e|ement)?\b/i },
  { rule: 'cultural adaptation is not measured', pattern: /adaptation culturelle|acclimat/i },
  { rule: 'injuries are not in the data', pattern: /blessur|injur/i },
  { rule: 'salary is not in the data', pattern: /salaire|rémunération|émoluments/i },
  { rule: 'transfer price or fee is not in the data; the Transfermarkt value is not a price', pattern: /prix (?:de |du )?transfert|prix estimé|co[uû]t (?:de |du )?transfert|montant (?:de |du )?transfert|indemnité|transfert (?:est )?estimé|clause/i },
  { rule: 'interest from clubs is not in the data', pattern: /intérêt (?:de |des |d')(?:plusieurs )?clubs?|courtisé|convoité|suivi par (?:plusieurs|des|le|la)|dans le viseur/i },
  { rule: 'no future level or league claim (Top 5, elite, higher level)', pattern: /top ?5\b|big ?5\b|cinq grands championnats|niveau supérieur|échelon supérieur|grand championnat européen/i },
  { rule: 'percentiles are relative to the comparison group: no "elite", "world class", "exceptional"', pattern: /(?<!\p{L})élite(?!\p{L})|classe mondiale|world[- ]class|exceptionnel|hors norme|meilleurs? (?:du|au) monde/iu },
  { rule: 'absent data is omitted: never say a value, contract or metric is missing or not provided', pattern: /non renseign|pas renseign|non disponible|pas disponible|indisponible|non communiqu|ne (?:sont|est) pas (?:fourni|communiqu|connu)|absente?s? des données|données? manquantes?/i },
  { rule: 'no recruitment decision or verdict', pattern: /priority signing|scout further|\bverdict\b|recommand\w* (?:le |son |de le )?(?:recrutement|recruter)|à recruter|signature prioritaire|offre de transfert|valider (?:une|l')offre/i },
];

// Titres anglais de l'ancien rapport
const ENGLISH_HEADINGS = /context ?& ?profile|performance analysis|key strengths|areas to improve|player ratings|final recommendation|reasoning|in possession|out of possession|transitions ?& ?mentality|current level|potential level|tactical role|physical profile/i;

// « saison en cours », « la saison est en cours », « saison 2026-27 encore en cours », « échantillon limité / restreint »
const SEASON_CAVEAT = /saison[^.\n]{0,25}?(?:en cours|non terminée|inachevée|incomplète)|échantillon[^.\n]{0,20}?(?:limité|partiel|réduit|restreint)/i;

// ============================================
// NOMBRES
// ============================================

export const NUMBER = /[+\-−]?\d{1,3}(?:[  ]\d{3})+(?:[.,]\d+)?|[+\-−]?\d+(?:[.,]\d+)?/g;

function parseNumber(raw: string): { value: number; decimals: number } {
  const s = raw.replace(/[  ]/g, '').replace('−', '-').replace(',', '.');
  const decimals = s.includes('.') ? s.split('.')[1].length : 0;
  return { value: Math.abs(Number(s)), decimals };
}

/** Tous les nombres présents dans les faits (valeurs numériques et nombres écrits dans les textes) */
export function factNumbers(facts: unknown): number[] {
  const out: number[] = [90, 100];      // « par 90 », « pour 100 tirs »
  const walk = (v: unknown) => {
    if (typeof v === 'number') out.push(Math.abs(v));
    else if (typeof v === 'string') (v.match(NUMBER) ?? []).forEach(m => out.push(parseNumber(m).value));
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(facts);
  return out;
}

/** Le nombre écrit est-il une valeur des faits, éventuellement arrondie à moins de décimales ? */
export function supported(raw: string, allowed: number[]): boolean {
  const { value, decimals } = parseNumber(raw);
  const tolerance = 0.5 * 10 ** -decimals + 1e-9;
  return allowed.some(a => Math.abs(a - value) <= tolerance);
}

// Numéros de section et de liste (« ### 1. », « 2) »)
export const stripNumbering = (line: string) => line.replace(/^\s*#{1,6}\s*\d+[.)]\s*/, '').replace(/^\s*\d+[.)]\s+/, '');

// Décomptes de la saison : le nombre doit être celui du champ correspondant (pas un autre nombre des données)
type Count = { label: string; pattern: RegExp; values: (f: ReportFacts) => unknown[] };
const stat = (f: ReportFacts, label: string) => f.otherStats.find(o => o.stat === label)?.value;
// Valeur par 90 de la même statistique (« 0,32 but » par 90 n'est pas un total)
const rate = (f: ReportFacts, key: string) => f.metrics.find(m => m.metric === metricLabel(key))?.value;
const COUNTS: Count[] = [
  { label: 'matches', pattern: /(?<![\d,.])(\d+)\s+match(?:s|es)?\b(?!\s+par)/gi, values: f => [f.sample.matches] },
  { label: 'starts', pattern: /(?<![\d,.])(\d+)\s+titularisations?/gi, values: f => [f.sample.starts] },
  { label: 'minutes', pattern: /(?<!(?:par|sur|\/)\s?)(?<![\d,.])(\d{1,3}(?:[  ]\d{3})+|\d+)\s+minutes\b/gi, values: f => [f.sample.minutes] },
  { label: 'goals', pattern: /(?<![\d,.])(\d+(?:[.,]\d+)?)\s+buts?\b(?!\s*(?:évités?|par|\/|pour|au-dessus|attendus))/gi, values: f => [stat(f, 'Buts'), f.shots?.goals, rate(f, 'Goals per 90')] },
  { label: 'assists', pattern: /(?<![\d,.])(\d+(?:[.,]\d+)?)\s+passes? décisives?\b(?!\s*(?:par|\/))/gi, values: f => [stat(f, 'Passes décisives'), rate(f, 'Assists per 90')] },
];

/** Décomptes écrits qui ne correspondent pas à leur champ (ex. « 8,6 buts » quand le joueur en a marqué 9) */
export function countMismatches(text: string, facts: ReportFacts): string[] {
  const out: string[] = [];
  for (const c of COUNTS) {
    const allowed = c.values(facts).filter((v): v is number => typeof v === 'number');
    for (const m of text.matchAll(c.pattern)) {
      if (!supported(m[1], allowed)) out.push(m[0].trim());
    }
  }
  return out;
}

const stem = (label: string) => label.replace(/\s*(?:par 90|per 90|,\s*%)\s*$/i, '').trim().toLocaleLowerCase('fr');

/** Lignes de la zone « forces » ou « limites » de la section 3 */
function zoneLines(lines: string[], zone: 'strengths' | 'limits'): number[] {
  const start = lines.findIndex(l => /^\s*#{1,6}\s*3[.)]/.test(l));
  const out: number[] = [];
  let current: 'strengths' | 'limits' | null = null;
  for (let i = start + 1; start >= 0 && i < lines.length && !/^\s*#/.test(lines[i]); i++) {
    if (/limites?|points? faibles?/i.test(lines[i])) current = 'limits';
    else if (/forces?|points? forts?/i.test(lines[i])) current = 'strengths';
    if (current === zone) out.push(i);
  }
  return out;
}

/**
 * Métriques « moins c'est mieux » mal orientées : percentile élevé listé en force,
 * ou percentile bas listé en limite
 */
function misreadDirection(report: string, facts: ReportFacts): { zone: 'strengths' | 'limits'; metrics: string[] }[] {
  const lines = report.split('\n');
  const text = (zone: 'strengths' | 'limits') => zoneLines(lines, zone).map(i => lines[i].toLocaleLowerCase('fr')).join('\n');
  const strengths = text('strengths');
  const limits = text('limits');
  const less = facts.metrics.filter(m => m.lessIsPreferable);
  return [
    { zone: 'strengths' as const, metrics: less.filter(m => m.percentile >= 50 && strengths.includes(stem(m.metric))).map(m => m.metric) },
    { zone: 'limits' as const, metrics: less.filter(m => m.percentile < 50 && limits.includes(stem(m.metric))).map(m => m.metric) },
  ].filter(z => z.metrics.length > 0);
}

// ============================================
// CONTRÔLE
// ============================================

const metricNames = (facts: ReportFacts) => [
  ...facts.metrics.map(m => m.metric), ...facts.otherStats.map(s => s.stat),
].join(' | ');

const excerptAround = (text: string, index: number, length: number) =>
  text.slice(Math.max(0, index - 40), index + length + 40).replace(/\s+/g, ' ').trim();

/**
 * Problèmes vérifiables du rapport, au regard des faits envoyés
 */
export function auditReport(report: string, facts: ReportFacts, language: keyof typeof REPORT_HEADINGS = 'fr'): ReportIssue[] {
  const issues: ReportIssue[] = [];
  const names = metricNames(facts);

  for (const t of TOPIC_RULES) {
    if (t.unlessMetric && t.unlessMetric.test(names)) continue;
    const m = t.pattern.exec(report);
    if (m) issues.push({ kind: 'topic', rule: t.rule, excerpt: excerptAround(report, m.index, m[0].length) });
  }

  const allowed = factNumbers(facts);
  const unsupported = new Set<string>();
  for (const line of report.split('\n')) {
    for (const m of stripNumbering(line).match(NUMBER) ?? []) {
      if (!supported(m, allowed)) unsupported.add(m.trim());
    }
  }
  for (const c of countMismatches(report, facts)) unsupported.add(c);
  if (unsupported.size > 0) {
    issues.push({ kind: 'number', rule: `numbers absent from the data (do not compute or invent numbers): ${[...unsupported].join(', ')}`, excerpt: [...unsupported].join(', ') });
  }

  for (const z of misreadDirection(report, facts)) {
    issues.push({
      kind: 'topic',
      rule: z.zone === 'strengths'
        ? `"less is better" metrics with a high percentile listed as strengths (they are statistical limits): ${z.metrics.join(', ')}`
        : `"less is better" metrics with a low percentile listed as limits (a low value is not a weakness): ${z.metrics.join(', ')}`,
      excerpt: z.metrics.join(', '),
    });
  }

  if (language !== 'en') {
    const m = ENGLISH_HEADINGS.exec(report);
    if (m) issues.push({ kind: 'heading', rule: 'English heading or label left in the report', excerpt: m[0] });
  }
  const missing = REPORT_HEADINGS[language].filter(h => !report.toLocaleLowerCase('fr').includes(h.toLocaleLowerCase('fr')));
  if (missing.length > 0) issues.push({ kind: 'heading', rule: `missing headings: ${missing.join(', ')}`, excerpt: missing.join(', ') });

  if (language === 'fr') {
    // Nombre de phrases qui contiennent la réserve (« saison en cours : échantillon limité » compte une fois)
    const mentions = report.split(/(?<=[.!?])\s+|\n/).filter(x => SEASON_CAVEAT.test(x)).length;
    if (facts.sample.seasonInProgress === true && mentions === 0) {
      issues.push({ kind: 'season', rule: 'the season is in progress: say it once in section 1', excerpt: '' });
    }
    if (facts.sample.seasonInProgress === true && mentions > 1) {
      issues.push({ kind: 'season', rule: 'the season caveat is repeated: say it only once, in section 1', excerpt: '' });
    }
    if (facts.sample.seasonInProgress !== true && mentions > 0) {
      issues.push({ kind: 'season', rule: 'the season is finished: never write that it is in progress or that the sample is limited', excerpt: '' });
    }
  }
  return issues;
}

/**
 * Dernier recours après la passe de correction : retire les phrases fautives, ajoute la
 * réserve de saison en cours si elle manque. Les titres ne sont pas réécrits.
 */
export function sanitizeReport(report: string, facts: ReportFacts, issues: ReportIssue[]): string {
  const names = metricNames(facts);
  const rules = TOPIC_RULES.filter(t => !(t.unlessMetric && t.unlessMetric.test(names)) && issues.some(i => i.rule === t.rule));
  const allowed = factNumbers(facts);
  const checkNumbers = issues.some(i => i.kind === 'number');
  const inProgress = facts.sample.seasonInProgress === true;
  const seasonIssue = issues.some(i => i.kind === 'season');
  const bad = (sentence: string) =>
    rules.some(t => t.pattern.test(sentence))
    || (checkNumbers && ((stripNumbering(sentence).match(NUMBER) ?? []).some(m => !supported(m, allowed)) || countMismatches(sentence, facts).length > 0))
    || (seasonIssue && !inProgress && SEASON_CAVEAT.test(sentence));

  // Métrique « moins c'est mieux » mal orientée : seul l'élément de liste concerné est retiré
  let lines = report.split('\n');
  for (const z of misreadDirection(report, facts)) {
    const zone = new Set(zoneLines(lines, z.zone));
    const escape = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    lines = lines.flatMap((line, i) => {
      if (!zone.has(i)) return [line];
      let out = line;
      for (const label of z.metrics) out = out.replace(new RegExp(`${escape(stem(label))}[^(,;\\n]*(?:\\([^)]*\\))?\\s*(?:[,;]\\s*)?`, 'i'), '');
      out = out.replace(/[,;]\s*$/, '');
      return out !== line && /^\s*(?:[-*]\s*)?(?:\*\*[^*]*\*\*\s*:?\s*)?$/.test(out) ? [] : [out];
    });
  }

  // Réserve répétée : seule la première phrase qui la contient est gardée
  let caveatSeen = false;
  const repeated = (sentence: string) => {
    if (!(seasonIssue && inProgress && SEASON_CAVEAT.test(sentence))) return false;
    if (!caveatSeen) { caveatSeen = true; return false; }
    return true;
  };
  lines = lines.flatMap(line => {
    if (/^\s*#/.test(line)) return [line];
    const sentences = line.split(/(?<=[.!?])\s+/);
    if (!bad(line) && !sentences.some(x => SEASON_CAVEAT.test(x))) return [line];
    const prefix = line.match(/^\s*(?:[-*]\s+)?(?:\*\*[^*]+\*\*\s*:?\s*)?/)?.[0] ?? '';
    const kept = line.slice(prefix.length).split(/(?<=[.!?])\s+/).filter(x => !bad(x) && !repeated(x)).join(' ').trim();
    return kept ? [`${prefix}${kept}`] : [];
  });

  // Saison en cours sans réserve : la réserve est ajoutée une fois, en section 1
  if (seasonIssue && inProgress && !SEASON_CAVEAT.test(lines.join('\n'))) {
    const at = lines.findIndex(l => /^\s*#{1,6}\s*1[.)]/.test(l));
    const caveat = '- **Échantillon** : saison en cours, les chiffres reposent sur un échantillon partiel (incertitude plus élevée).';
    if (at >= 0) lines.splice(at + 1, 0, caveat);
    else lines.unshift(caveat);
  }
  return lines.join('\n');
}
