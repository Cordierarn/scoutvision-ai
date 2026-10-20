/**
 * ScoutVision AI - Gemini Service
 * Service d'intelligence artificielle pour la génération de rapports de scout
 */

import { GoogleGenAI } from "@google/genai";
import { PlayerData, PlayerPercentileProfile, RoleScoreResult, ShotStats } from "../types";

// ============================================
// CONFIGURATION
// ============================================

/**
 * Cache pour les rapports générés
 */
const reportCache = new Map<string, { report: string; timestamp: number }>();
const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes

/**
 * Initialise le client Gemini
 */
const initGenAI = (): GoogleGenAI => {
  if (!process.env.API_KEY) {
    throw new Error("API Key not found. Please set the API_KEY environment variable.");
  }
  return new GoogleGenAI({ apiKey: process.env.API_KEY });
};

/**
 * Génère une clé de cache unique pour un joueur
 */
const getCacheKey = (player: PlayerData): string => {
  return `${player.Player}_${player.Team}_${player.League}`;
};

// ============================================
// REPORT GENERATION
// ============================================

/**
 * Génère un rapport de scout professionnel pour un joueur
 */
export async function generateScoutReport(
  player: PlayerData,
  options?: ScoutReportOptions
): Promise<string> {
  const cacheKey = getCacheKey(player);
  
  // Vérifier le cache
  const cached = reportCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return cached.report;
  }

  try {
    const ai = initGenAI();
    
    // Préparer les données du joueur
    const statsJSON = JSON.stringify(player, null, 2);
    
    // Construire le prompt enrichi
    const prompt = buildScoutReportPrompt(player, statsJSON, options);

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });

    const report = response.text || "Le rapport n'a pas pu être généré.";
    
    // Mettre en cache
    reportCache.set(cacheKey, { report, timestamp: Date.now() });
    
    return report;
  } catch (error) {
    console.error("Gemini API Error:", error);
    return "Erreur lors de la génération du rapport. Vérifiez la clé API Gemini et réessayez.";
  }
}

/**
 * Options pour la génération de rapport
 */
export interface ScoutReportOptions {
  language?: 'en' | 'fr' | 'es' | 'de';
  detailLevel?: 'brief' | 'standard' | 'detailed';
  focusAreas?: ('attacking' | 'defending' | 'physical' | 'mental')[];
  includeComparison?: boolean;
  targetRole?: string;
  percentileProfile?: PlayerPercentileProfile;
  bestRoles?: RoleScoreResult[];
  shotStats?: ShotStats;
  insights?: string[];          // indicateurs avancés déjà formulés (RAPM, finition, valeur...)
}

/**
 * Construit le prompt pour le rapport de scout
 */
function buildScoutReportPrompt(
  player: PlayerData,
  statsJSON: string,
  options?: ScoutReportOptions
): string {
  const language = options?.language || 'en';
  const detailLevel = options?.detailLevel || 'standard';
  
  // Section additionnelle si on a les percentiles
  let additionalContext = '';
  
  if (options?.percentileProfile) {
    const topPercentiles = Object.entries(options.percentileProfile.percentiles)
      .filter(([_, p]) => p >= 75)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([metric, percentile]) => `${metric}: ${percentile}th percentile`)
      .join(', ');
    
    const bottomPercentiles = Object.entries(options.percentileProfile.percentiles)
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
  
  if (options?.bestRoles && options.bestRoles.length > 0) {
    const rolesStr = options.bestRoles
      .map(r => `${r.role} (${r.normalizedScore}/100)`)
      .join(', ');
    additionalContext += `\n**Best Suited Roles:** ${rolesStr}`;
  }
  
  if (options?.shotStats) {
    const stats = options.shotStats;
    additionalContext += `\n**Shooting Profile:** ${stats.total} shots, ${stats.goals} goals, ${stats.xG.toFixed(2)} xG (${stats.conversion.toFixed(1)}% conversion)`;
  }

  if (options?.insights && options.insights.length > 0) {
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
