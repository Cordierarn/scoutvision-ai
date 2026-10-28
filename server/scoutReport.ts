/**
 * ScoutVision - rapport de scouting rédigé par Gemini, côté serveur
 *
 * Le navigateur envoie la ligne du joueur et quelques indicateurs déjà calculés ;
 * le serveur valide l'entrée, construit lui-même le prompt (l'endpoint n'est pas un
 * proxy Gemini ouvert) et appelle Gemini avec GEMINI_API_KEY, qui ne quitte jamais
 * le serveur. Ce module ne dépend d'aucun framework : il est branché sur les serveurs
 * Vite (server/scoutReportPlugin.ts) et peut l'être sur n'importe quel serveur Node.
 */

// ============================================
// LIMITES
// ============================================

export const MAX_BODY_BYTES = 128 * 1024;        // une ligne joueur PitchAPI pèse ~20-40 Ko en JSON
const MAX_PLAYER_FIELDS = 1500;
const MAX_KEY_LENGTH = 120;
const MAX_STRING_LENGTH = 300;
const MAX_INSIGHTS = 20;
const MAX_INSIGHT_LENGTH = 600;
const MAX_ROLES = 10;
const MAX_PERCENTILES = 1000;

const LANGUAGES = ['en', 'fr', 'es', 'de'] as const;
const DETAIL_LEVELS = ['brief', 'standard', 'detailed'] as const;
const FOCUS_AREAS = ['attacking', 'defending', 'physical', 'mental'] as const;

export const GEMINI_MODEL = 'gemini-2.5-flash';

// ============================================
// TYPES
// ============================================

export type PlayerRow = Record<string, string | number | boolean | null>;

export interface ReportOptions {
  language?: typeof LANGUAGES[number];
  detailLevel?: typeof DETAIL_LEVELS[number];
  focusAreas?: typeof FOCUS_AREAS[number][];
  targetRole?: string;
  percentiles?: Record<string, number>;           // percentiles par rôle (0-100)
  bestRoles?: { role: string; normalizedScore: number }[];
  shotStats?: { total: number; goals: number; xG: number; conversion: number };
  insights?: string[];
}

export interface ReportRequest {
  player: PlayerRow;
  options: ReportOptions;
}

export type Validation = { ok: true; value: ReportRequest } | { ok: false; error: string };

// ============================================
// VALIDATION
// ============================================

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

const fail = (error: string): Validation => ({ ok: false, error });

/**
 * Valide et nettoie le corps de la requête : seuls les champs attendus sont conservés
 */
export function validateReportRequest(body: unknown): Validation {
  if (!isObject(body)) return fail('Corps de requête invalide : objet JSON attendu.');
  const { player, options = {} } = body;

  if (!isObject(player)) return fail('Champ « player » manquant ou invalide.');
  const entries = Object.entries(player);
  if (entries.length === 0 || entries.length > MAX_PLAYER_FIELDS) return fail('Nombre de champs du joueur invalide.');
  const cleanPlayer: PlayerRow = {};
  for (const [key, value] of entries) {
    if (key.length === 0 || key.length > MAX_KEY_LENGTH) return fail('Nom de champ du joueur invalide.');
    if (value === null) cleanPlayer[key] = null;
    else if (typeof value === 'boolean' || finite(value)) cleanPlayer[key] = value as boolean | number;
    else if (typeof value === 'string') {
      if (value.length > MAX_STRING_LENGTH) return fail(`Champ « ${key.slice(0, 40)} » trop long.`);
      cleanPlayer[key] = value;
    } else return fail(`Champ « ${key.slice(0, 40)} » : valeur non prise en charge.`);
  }
  if (typeof cleanPlayer.Player !== 'string' || cleanPlayer.Player.trim() === '') return fail('Nom du joueur manquant.');

  if (!isObject(options)) return fail('Champ « options » invalide.');
  const clean: ReportOptions = {};

  if (options.language !== undefined) {
    if (!LANGUAGES.includes(options.language as never)) return fail('Langue non prise en charge.');
    clean.language = options.language as ReportOptions['language'];
  }
  if (options.detailLevel !== undefined) {
    if (!DETAIL_LEVELS.includes(options.detailLevel as never)) return fail('Niveau de détail invalide.');
    clean.detailLevel = options.detailLevel as ReportOptions['detailLevel'];
  }
  if (options.focusAreas !== undefined) {
    if (!Array.isArray(options.focusAreas) || !options.focusAreas.every(a => FOCUS_AREAS.includes(a as never))) {
      return fail('Axes d\'analyse invalides.');
    }
    clean.focusAreas = [...new Set(options.focusAreas)] as ReportOptions['focusAreas'];
  }
  if (options.targetRole !== undefined) {
    if (typeof options.targetRole !== 'string' || options.targetRole.length > 80) return fail('Rôle cible invalide.');
    clean.targetRole = options.targetRole;
  }
  if (options.percentiles !== undefined) {
    if (!isObject(options.percentiles)) return fail('Percentiles invalides.');
    const list = Object.entries(options.percentiles);
    if (list.length > MAX_PERCENTILES) return fail('Trop de percentiles.');
    if (!list.every(([k, v]) => k.length > 0 && k.length <= MAX_KEY_LENGTH && finite(v) && v >= 0 && v <= 100)) {
      return fail('Percentiles invalides : valeurs de 0 à 100 attendues.');
    }
    clean.percentiles = Object.fromEntries(list) as Record<string, number>;
  }
  if (options.bestRoles !== undefined) {
    if (!Array.isArray(options.bestRoles) || options.bestRoles.length > MAX_ROLES
      || !options.bestRoles.every(r => isObject(r) && typeof r.role === 'string' && r.role.length <= 80 && finite(r.normalizedScore))) {
      return fail('Rôles invalides.');
    }
    clean.bestRoles = options.bestRoles.map(r => ({ role: String(r.role), normalizedScore: Number(r.normalizedScore) }));
  }
  if (options.shotStats !== undefined) {
    const s = options.shotStats;
    if (!isObject(s) || !['total', 'goals', 'xG', 'conversion'].every(k => finite(s[k]))) return fail('Statistiques de tir invalides.');
    clean.shotStats = { total: Number(s.total), goals: Number(s.goals), xG: Number(s.xG), conversion: Number(s.conversion) };
  }
  if (options.insights !== undefined) {
    if (!Array.isArray(options.insights) || options.insights.length > MAX_INSIGHTS
      || !options.insights.every(l => typeof l === 'string' && l.length <= MAX_INSIGHT_LENGTH)) {
      return fail('Indicateurs avancés invalides.');
    }
    clean.insights = options.insights as string[];
  }

  return { ok: true, value: { player: cleanPlayer, options: clean } };
}

// ============================================
// PROMPT
// ============================================

/**
 * Prompt du rapport de scouting (repris tel quel de l'ancien service côté client)
 */
export function buildScoutReportPrompt(player: PlayerRow, options: ReportOptions = {}): string {
  const statsJSON = JSON.stringify(player, null, 2);
  const language = options.language || 'en';
  const detailLevel = options.detailLevel || 'standard';

  let additionalContext = '';

  if (options.percentiles) {
    const topPercentiles = Object.entries(options.percentiles)
      .filter(([_, p]) => p >= 75)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([metric, percentile]) => `${metric}: ${percentile}th percentile`)
      .join(', ');

    const bottomPercentiles = Object.entries(options.percentiles)
      .filter(([_, p]) => p <= 25)
      .sort((a, b) => a[1] - b[1])
      .slice(0, 5)
      .map(([metric, percentile]) => `${metric}: ${percentile}th percentile`)
      .join(', ');

    if (topPercentiles) {
      additionalContext += `\n**Top Percentile Metrics:** ${topPercentiles}`;
    }
    if (bottomPercentiles) {
      additionalContext += `\n**Bottom Percentile Metrics:** ${bottomPercentiles}`;
    }
  }

  if (options.bestRoles && options.bestRoles.length > 0) {
    const rolesStr = options.bestRoles
      .map(r => `${r.role} (${r.normalizedScore}/100)`)
      .join(', ');
    additionalContext += `\n**Best Suited Roles:** ${rolesStr}`;
  }

  if (options.shotStats) {
    const stats = options.shotStats;
    additionalContext += `\n**Shooting Profile:** ${stats.total} shots, ${stats.goals} goals, ${stats.xG.toFixed(2)} xG (${stats.conversion.toFixed(1)}% conversion)`;
  }

  if (options.insights && options.insights.length > 0) {
    additionalContext += `\n**Advanced Indicators:**\n${options.insights.map(line => `- ${line}`).join('\n')}`;
  }

  const languageInstruction = language !== 'en'
    ? `\n**IMPORTANT:** Write the entire report in ${language === 'fr' ? 'French' : language === 'es' ? 'Spanish' : 'German'}.`
    : '';

  const wordLimit = detailLevel === 'brief' ? 250 : detailLevel === 'detailed' ? 600 : 400;

  return `
You are a Chief Scout for a top European football club.
Your task is to write a **Professional Data Scouting Report** based on the aggregated season statistics provided below.
${languageInstruction}

**Player Data (JSON):**
${statsJSON}
${additionalContext}

---

**INSTRUCTIONS:**
Follow the strict structure below based on professional scouting standards.
**Reading the data:** Per-90 values are shrunk toward the role average when minutes are low. Fields ending in " pct" are percentiles (0-100) among players of the same role and the same competition level. Use the Advanced Indicators with their stated caveats: a low-reliability RAPM, a small shot sample or a model value estimate are hints, not facts. The "Rating" field is a match-rating average that over-weights attacking actions; do not base the verdict on it.
**Crucial:** Do not use vague, subjective terms (e.g., "good technique", "nice passing", "composed").
Instead, use **Football Action Language**: clear, specific observations derived from the data (e.g., "Progresses play via high-volume dribbling," "Effective in aerial duels but passive in ground challenges").

**REPORT STRUCTURE:**

### 1. Context & Profile
*   **Context**: List League, Team, Age, Position, and Matches/Minutes Played.
*   **Tactical Role**: Infer the player's specific tactical role based on the stats (e.g., "Ball-Playing Defender," "Box-to-Box Destroyer," "Inverted Winger").
*   **Physical Profile**: Height and preferred foot when available.

### 2. Performance Analysis
*Analyze the data to infer on-pitch behavior. Use specific action language.*
*   **In Possession**: Analyze passing style (volume vs risk), progression (xG/xA contribution), and ball retention.
*   **Out of Possession**: Analyze defensive positioning, engagement (duels per 90), and success rates.
*   **Transitions & Mentality**: Infer work rate and decision-making from efficiency metrics and activity levels.

### 3. Strengths & Areas to Improve
*Separate scalable traits from limiters.*
*   **Key Strengths**: Specific qualities that stand out and could scale to a higher level (e.g., "Elite progressive passing volume").
*   **Areas to Improve**: Clear tactical or technical limiters (e.g., "Low aerial win rate (30%) exposes him against direct teams").

### 4. Player Ratings
*   **Current Level**: [Tier Rating] (e.g., "Starter for current league", "Rotation option").
*   **Potential Level**: [Tier Rating] (e.g., "Top 5 League Starter", "Elite Prospect").
*   *Provide a brief justification for the ratings.*

### 5. Final Recommendation
*   **Verdict**: Choose ONE: [PRIORITY SIGNING | SCOUT FURTHER | PASS]
*   **Reasoning**: A concise, decisive conclusion on whether the player fits a professional system and the risk factor.

---
**Format:** Use Markdown with clear bold headers. Keep the tone objective, professional, and concise (max ${wordLimit} words).
`;
}

// ============================================
// HANDLER
// ============================================

export type GenerateText = (prompt: string) => Promise<string>;

export interface HandlerResult {
  status: number;
  body: { report: string } | { error: string };
}

/**
 * Traite une requête déjà lue et décodée. `generate` appelle Gemini (injecté : testable sans réseau).
 * Les messages d'erreur renvoyés au client sont génériques : ni clé, ni détail de l'API.
 */
export async function handleScoutReport(
  body: unknown,
  deps: { apiKey: string | undefined; generate: GenerateText; log?: (message: string) => void },
): Promise<HandlerResult> {
  if (!deps.apiKey) {
    return { status: 503, body: { error: 'Rapports IA indisponibles : GEMINI_API_KEY n\'est pas configurée sur le serveur.' } };
  }
  const parsed = validateReportRequest(body);
  if ('error' in parsed) return { status: 400, body: { error: parsed.error } };

  try {
    const text = await deps.generate(buildScoutReportPrompt(parsed.value.player, parsed.value.options));
    if (!text.trim()) return { status: 502, body: { error: 'Le modèle n\'a renvoyé aucun texte. Réessayez.' } };
    return { status: 200, body: { report: text } };
  } catch (error) {
    deps.log?.(`[scout-report] échec de l'appel Gemini : ${redact(error instanceof Error ? error.message : String(error), deps.apiKey)}`);
    return { status: 502, body: { error: 'Le service de génération est indisponible pour le moment. Réessayez dans quelques instants.' } };
  }
}

/**
 * Retire un secret d'un message (les erreurs du SDK peuvent citer l'URL appelée)
 */
export function redact(message: string, secret: string | undefined): string {
  let out = message.replace(/([?&]key=)[^&\s]+/gi, '$1[masqué]');
  if (secret) out = out.split(secret).join('[masqué]');
  return out.slice(0, 300);
}

// ============================================
// LIMITE DE DÉBIT
// ============================================

/**
 * Limite simple par client (fenêtre glissante, en mémoire) : protège le quota Gemini
 */
export function createRateLimiter(limit: number, windowMs: number, now: () => number = Date.now) {
  const hits = new Map<string, number[]>();
  return (client: string): boolean => {
    const t = now();
    const recent = (hits.get(client) ?? []).filter(h => t - h < windowMs);
    if (recent.length >= limit) {
      hits.set(client, recent);
      return false;
    }
    recent.push(t);
    hits.set(client, recent);
    return true;
  };
}
