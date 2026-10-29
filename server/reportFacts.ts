/**
 * ScoutVision - données structurées et prompt du rapport rédigé (côté serveur)
 *
 * Le modèle ne reçoit pas la ligne brute du joueur : il reçoit des faits nommés sans
 * ambiguïté (valeur Transfermarkt et estimation ScoutVision séparées, percentiles avec
 * leur groupe de comparaison, indicateurs avec leurs limites). Le prompt lui interdit
 * d'utiliser autre chose que ces faits.
 */

import { footLabel, metricLabel, positionName, styleLabel } from '../utils/labels';
import { DEFAULT_ROLE_PRESETS } from '../utils/rolePresets';

export type PlayerRow = Record<string, string | number | boolean | null>;

export interface ReportOptions {
  language?: 'en' | 'fr' | 'es' | 'de';
  detailLevel?: 'brief' | 'standard' | 'detailed';
  focusAreas?: ('attacking' | 'defending' | 'physical' | 'mental')[];
  targetRole?: string;
  percentiles?: Record<string, number>;           // percentiles par rôle (0-100)
  bestRoles?: { role: string; normalizedScore: number }[];
  shotStats?: { total: number; goals: number; xG: number; conversion: number };
  insights?: string[];
  seasonInProgress?: boolean;                     // saison non terminée à la date des données
}

export interface ReportFacts {
  player: Record<string, string | number>;
  sample: Record<string, string | number | boolean>;
  teamContext: Record<string, string | number>;
  values: {
    marketValueTransfermarkt: string | null;
    estimatedValueScoutVision: string | null;
    estimatedValueTypicalError: string | null;
  };
  contractUntil: string | null;
  scoutVisionRoleIndices: { role: string; index: number }[];
  metrics: { metric: string; value: number; percentile: number; lessIsPreferable?: true }[];
  otherStats: { stat: string; value: number }[];
  shots: { shots: number; goals: number; xG: number; conversionPct: number } | null;
  scoutVisionIndicators: string[];
}

// Champs déjà repris ailleurs dans les faits, ou sans intérêt pour le rapport (identifiants, images)
const HANDLED = new Set([
  'Player', 'Team', 'League', 'Season', 'Position', 'Age', 'Birth date', 'Height', 'Foot', 'Passport country',
  'Midfield profile', 'Matches played', 'Starts', 'Minutes played', 'Minutes share', 'Team possession, %',
  'Team PPDA', 'Team field tilt', 'Team style', 'Market value', 'Estimated value', 'Contract expires',
  'Player ID', 'Team ID', 'Competition', 'League tier', 'Position group', 'Position slot', 'Analytics coverage',
  'Image', 'Team logo', 'Network matches', 'RAPM minutes',
  // Transmis par les indicateurs ScoutVision, avec leurs limites (RAPM, finition, part des passes)
  'RAPM off', 'RAPM def', 'RAPM net', 'Finishing skill', 'Career shots', 'Career goals - xG', 'Pass share, %',
]);

// Erreur typique du modèle de valeur estimée (README : R² ≈ 0,70, erreur typique ×1,7)
const VALUE_TYPICAL_ERROR = '×1,7';

// Métriques que les rôles officiels comptent « moins c'est mieux » (poids négatif dans utils/rolePresets.json)
const LESS_IS_PREFERABLE = new Set(Object.values(DEFAULT_ROLE_PRESETS)
  .flatMap(p => Object.entries(p.weights ?? {}).filter(([, w]) => w < 0).map(([m]) => m)));

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Arrondi lisible : 3 chiffres significatifs sous 1, une décimale sous 100, entier au-delà */
export function roundStat(v: number): number {
  const a = Math.abs(v);
  if (a === 0) return 0;
  if (a < 1) return Number(v.toPrecision(2));
  if (a < 100) return Math.round(v * 10) / 10;
  return Math.round(v);
}

/** Montant en euros au format français : « 11 M€ », « 6,1 M€ », « 850 k€ » */
export function formatEuro(v: number): string {
  const fmt = (x: number) => x.toLocaleString('fr-FR', { maximumFractionDigits: 1 });
  return v >= 1e6 ? `${fmt(v / 1e6)} M€` : `${fmt(Math.round(v / 1e3))} k€`;
}

/**
 * Faits transmis au modèle, construits uniquement à partir de la ligne validée et des options
 */
export function buildReportFacts(player: PlayerRow, options: ReportOptions = {}): ReportFacts {
  const str = (k: string) => (typeof player[k] === 'string' && player[k] !== '' ? String(player[k]) : undefined);
  const put = (o: Record<string, string | number | boolean>, k: string, v: string | number | boolean | undefined) => {
    if (v !== undefined) o[k] = v;
  };

  const identity: Record<string, string | number> = {};
  put(identity, 'name', str('Player'));
  put(identity, 'team', str('Team'));
  put(identity, 'competition', str('League'));
  put(identity, 'position', str('Position') && positionName(str('Position')));
  put(identity, 'midfieldProfile', str('Midfield profile'));
  if (num(player.Age)) identity.age = Math.floor(player.Age);
  put(identity, 'birthDate', str('Birth date'));
  if (num(player.Height)) identity.heightCm = Math.round(player.Height);
  put(identity, 'preferredFoot', str('Foot') && footLabel(str('Foot')));
  put(identity, 'nationalityCode', str('Passport country'));

  const sample: Record<string, string | number | boolean> = { seasonInProgress: options.seasonInProgress === true };
  if (num(player['Matches played'])) sample.matches = player['Matches played'];
  if (num(player.Starts)) sample.starts = player.Starts;
  if (num(player['Minutes played'])) sample.minutes = Math.round(player['Minutes played']);
  if (num(player['Minutes share'])) sample.shareOfTeamMinutesPct = roundStat(player['Minutes share'] * 100);

  const team: Record<string, string | number> = {};
  if (num(player['Team possession, %'])) team.possessionPct = roundStat(player['Team possession, %']);
  if (num(player['Team PPDA'])) team.ppda = roundStat(player['Team PPDA']);
  if (num(player['Team field tilt'])) team.fieldTiltPct = roundStat(player['Team field tilt']);
  put(team, 'style', str('Team style') && styleLabel(str('Team style')));

  const market = num(player['Market value']) && player['Market value'] > 0 ? player['Market value'] : undefined;
  const estimate = num(player['Estimated value']) && player['Estimated value'] > 0 ? player['Estimated value'] : undefined;

  // Métriques avec percentile ; les autres nombres sont des statistiques sans rang
  const metrics: ReportFacts['metrics'] = [];
  const otherStats: ReportFacts['otherStats'] = [];
  for (const [key, value] of Object.entries(player)) {
    if (key.endsWith(' pct') || HANDLED.has(key) || !num(value)) continue;
    const pct = player[`${key} pct`];
    if (num(pct)) {
      metrics.push({ metric: metricLabel(key), value: roundStat(value), percentile: Math.round(pct), ...(LESS_IS_PREFERABLE.has(key) ? { lessIsPreferable: true as const } : {}) });
    }
    else otherStats.push({ stat: metricLabel(key), value: roundStat(value) });
  }

  return {
    player: identity,
    sample,
    teamContext: team,
    values: {
      marketValueTransfermarkt: market !== undefined ? formatEuro(market) : null,
      estimatedValueScoutVision: estimate !== undefined ? formatEuro(estimate) : null,
      estimatedValueTypicalError: estimate !== undefined ? VALUE_TYPICAL_ERROR : null,
    },
    contractUntil: str('Contract expires') ?? null,
    scoutVisionRoleIndices: (options.bestRoles ?? []).map(r => ({ role: r.role, index: Math.round(r.normalizedScore) })),
    metrics,
    otherStats,
    shots: options.shotStats ? {
      shots: options.shotStats.total, goals: options.shotStats.goals,
      xG: roundStat(options.shotStats.xG), conversionPct: roundStat(options.shotStats.conversion),
    } : null,
    scoutVisionIndicators: options.insights ?? [],
  };
}

// ============================================
// PROMPT
// ============================================

/**
 * Version méthodologique du prompt, enregistrée avec chaque synthèse. À changer à la main quand
 * une modification du prompt ou des faits justifie de distinguer les rapports (v1 : ancien rapport
 * à titres anglais ; v2 : faits structurés, 5 sections françaises, règles de grounding).
 * Jamais dérivée de la date.
 */
export const PROMPT_VERSION = 'scout-report-v2';

const LANGUAGE_NAMES = { en: 'English', fr: 'French', es: 'Spanish', de: 'German' } as const;

// Titres imposés des 5 sections
export const REPORT_HEADINGS: Record<keyof typeof LANGUAGE_NAMES, string[]> = {
  fr: ['Contexte et profil', 'Analyse de la performance', 'Forces et limites statistiques', 'Projection et contexte', "Priorités d'observation"],
  en: ['Context and profile', 'Performance analysis', 'Statistical strengths and limits', 'Projection and context', 'Observation priorities'],
  es: ['Contexto y perfil', 'Análisis del rendimiento', 'Fortalezas y límites estadísticos', 'Proyección y contexto', 'Prioridades de observación'],
  de: ['Kontext und Profil', 'Leistungsanalyse', 'Statistische Stärken und Grenzen', 'Projektion und Kontext', 'Beobachtungsprioritäten'],
};

/**
 * Prompt du rapport : consignes en anglais, rapport final dans la langue demandée (français par défaut)
 */
export function buildScoutReportPrompt(facts: ReportFacts, options: ReportOptions = {}): string {
  const language = options.language ?? 'fr';
  const name = LANGUAGE_NAMES[language];
  const headings = REPORT_HEADINGS[language].map((h, i) => `### ${i + 1}. ${h}`).join('\n');
  const wordLimit = options.detailLevel === 'brief' ? 250 : options.detailLevel === 'detailed' ? 550 : 400;

  return `You are writing the summary section of a ScoutVision player profile.
Your job is to SUMMARISE the analyses that ScoutVision already computed and sends you below as structured data.
You never create a new analysis, a new metric, a transfer price or a conclusion that the data does not support.

Write the entire final report in ${name}. All headings, labels and conclusions must be in ${name}.
Do not leave any heading, label or verdict in English${language === 'en' ? '' : ' (no "Context & Profile", "Strengths", "Scout further", "Verdict"…)'}.
Metric names: use the labels given in the data.${language === 'fr' ? '\nWrite numbers in French format: decimal comma (0,068 ; 16,6), "M€" for millions of euros.' : ''}

**SCOUTVISION DATA (JSON) — your only source:**
${JSON.stringify(facts, null, 2)}

**HOW TO READ THE DATA**
- "metrics": value and percentile (0-100). The percentile ranks the raw value among players of the same position group and the same competition level, same season. It ranks volume, not quality: a high percentile means more of it. Metrics flagged "lessIsPreferable" are counted "less is better" by the ScoutVision role indices: for them a high percentile is a statistical limit, never a strength. The same holds for errors and goals conceded.
- "scoutVisionRoleIndices": ScoutVision role index (0-100), a weighted composite of percentiles. It is not a percentile and not a rating of overall ability.
- "values.marketValueTransfermarkt": the current market value published by Transfermarkt.
- "values.estimatedValueScoutVision": a statistical estimate produced by the ScoutVision model from performance data (typical error "values.estimatedValueTypicalError").
- "scoutVisionIndicators": indicators computed by ScoutVision with their limits (RAPM, finishing, share of team passes, statistical projection for next season…). Keep the limits they state (reliability, small sample, regression to the mean).
- "sample.seasonInProgress": true when the season was not finished when the data was produced.
- "otherStats": season totals without a percentile.
- "teamContext": team possession (%), PPDA (opponent passes per defensive action: lower means more pressing by the team), field tilt (share of the territory, ${language === 'fr' ? '"domination territoriale"' : 'territorial dominance'}) and playing style. It describes the team, not the player.

**STRICT GROUNDING RULES**
1. Use ONLY the information present in the data above. No outside knowledge about the player, his club, his league, his career, his transfers or his reputation.
2. A metric that is absent from the data is simply omitted. Never describe an absent metric as weak, strong, good, bad, unknown or to be estimated, and never guess it. Never write that a value, a contract or a metric is missing, unavailable or not provided.
3. Unless the data contains an explicit field for it, never mention: passes under pressure, pressure applied by the player, play under pressure, off-the-ball runs, top speed, acceleration, mentality, personality, character, maturity, leadership, intelligence, concentration, composure, cultural adaptation, injuries, salary, transfer price or fee, release clause, interest from other clubs.
4. Every number you write must appear in the data (you may round it to fewer decimals). Do not compute ratios, differences, sums or new indicators.
5. Values: call "marketValueTransfermarkt" "valeur de marché Transfermarkt" and "estimatedValueScoutVision" "estimation du modèle ScoutVision". Never call the Transfermarkt value an estimated price, a transfer price, a transfer cost or a ScoutVision estimate. Never state or imply a transfer price. If both exist you may compare them neutrally, e.g. "Sa valeur de marché Transfermarkt est de 11 M€, tandis que le modèle ScoutVision l'estime à 6,1 M€." Forbidden: "Un transfert est estimé à 11 M€."
6. Percentiles: describe them relative to their real population, e.g. "95e percentile de son groupe de comparaison". Never translate a percentile into "elite", "world class", "exceptional", "best in Europe" or similar.
7. Season in progress: if "sample.seasonInProgress" is true, say ONCE, in section 1, that the season is in progress and the sample is limited (higher uncertainty, not poorer performance). Do not repeat it elsewhere. If it is false, the season is finished: never write that it is in progress or that the sample is limited.
8. Potential: never state a future level, league, club tier or role the player could reach (no "Top 5 league starter", no "can play at a higher level"). Only if the data contains a ScoutVision projection may you rephrase its result, calling it "projection statistique ScoutVision" and keeping its limits. The projection is written in percentiles ("P41→P47"): render it as percentiles (e.g. "du 41e au 47e percentile"), never as raw values or as percentages.
9. No recruitment decision: no verdict, no "sign", "recruit", "pass", "priority signing", "scout further", no offer. Section 5 lists 3 to 5 observation priorities, each tied to a specific data point, phrased as what to check on video, e.g. P14 on accurate long passes → "Vérifier en vidéo la qualité et le contexte des passes longues." Never turn a data point into a claim the data does not measure (e.g. "he cannot play under pressure").
10. Tactical profile: describe it only through "scoutVisionRoleIndices" (role name and index) and "player.midfieldProfile" when present. Do not invent another role label.
11. "Rating" (match-rating average) over-weights attacking actions: never base a conclusion on it.
12. Be concise and selective: keep the most discriminating data (percentiles at or above 75 or at or below 25, and the metrics of the ScoutVision roles). At most 5 strengths and 5 limits. Do not list every statistic.
13. Direction: for metrics flagged "lessIsPreferable", and for losses of possession, miscontrols, fouls committed, errors, being dribbled past and big chances missed, a high percentile is a statistical limit and a low percentile is not a weakness. Never list them as strengths when their percentile is high.
14. Season totals ("otherStats", e.g. goals, assists, xG) are distinct numbers: never attach one total to another label (goals scored are not xG).

**REPORT STRUCTURE (Markdown, exactly these 5 headings, in this order)**
${headings}

Section 1: competition, club, age, position, playing time, ScoutVision role indices, sample caveat if any.
Section 2: in possession and out of possession, from the metrics.
Section 3: statistical strengths and statistical limits (with their percentiles).
Section 4: ScoutVision statistical projection if present, team context, the two values and the contract if present, with the limits of each indicator.
Section 5: observation priorities (bullet list).

Format: Markdown, short bullet points, bold labels allowed. Maximum ${wordLimit} words.
`;
}

/**
 * Seconde passe : le brouillon enfreint des règles vérifiables ; le modèle le réécrit en entier
 */
export function buildCorrectionPrompt(prompt: string, draft: string, problems: string[]): string {
  return `${prompt}
---
**YOUR PREVIOUS DRAFT**
${draft}

**IT BREAKS THESE RULES**
${problems.map(p => `- ${p}`).join('\n')}

Rewrite the complete report so that it follows every rule above: same 5 headings, same language, only facts from the data.`;
}
