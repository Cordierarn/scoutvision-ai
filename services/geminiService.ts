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

    const report = response.text || "Failed to generate report.";
    
    // Mettre en cache
    reportCache.set(cacheKey, { report, timestamp: Date.now() });
    
    return report;
  } catch (error) {
    console.error("Gemini API Error:", error);
    return "Error generating report. Please check your API key and try again.";
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
**Crucial:** Do not use vague, subjective terms (e.g., "good technique", "nice passing", "composed"). 
Instead, use **Football Action Language**: clear, specific observations derived from the data (e.g., "Progresses play via high-volume dribbling," "Effective in aerial duels but passive in ground challenges").

**REPORT STRUCTURE:**

### 1. Context & Profile
*   **Context**: List League, Team, Age, Position, and Matches/Minutes Played.
*   **Tactical Role**: Infer the player's specific tactical role based on the stats (e.g., "Ball-Playing Defender," "Box-to-Box Destroyer," "Inverted Winger").
*   **Physical Profile**: Height, Weight, Foot.

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
// COMPARISON ANALYSIS
// ============================================

/**
 * Génère une analyse comparative entre deux joueurs
 */
export async function generateComparisonAnalysis(
  playerA: PlayerData,
  playerB: PlayerData,
  metrics: string[]
): Promise<string> {
  try {
    const ai = initGenAI();
    
    const prompt = `
You are a football analytics expert. Compare these two players based on their statistics.

**Player A: ${playerA.Player}** (${playerA.Team}, ${playerA.Position})
${JSON.stringify(
  Object.fromEntries(
    metrics.map(m => [m, playerA[m]])
  ),
  null, 2
)}

**Player B: ${playerB.Player}** (${playerB.Team}, ${playerB.Position})
${JSON.stringify(
  Object.fromEntries(
    metrics.map(m => [m, playerB[m]])
  ),
  null, 2
)}

---

Provide a concise (200 words max) comparison covering:
1. **Statistical Edge**: Who excels in which areas based on the numbers
2. **Profile Differences**: How their playing styles differ
3. **Best Fit**: Which scenarios/teams would suit each player better

Use specific metrics to support your analysis. Be objective and data-driven.
Format in Markdown.
`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });

    return response.text || "Failed to generate comparison.";
  } catch (error) {
    console.error("Gemini API Error:", error);
    return "Error generating comparison analysis.";
  }
}

// ============================================
// TRANSFER ANALYSIS
// ============================================

/**
 * Génère une analyse de valeur de transfert
 */
export async function generateTransferAnalysis(
  player: PlayerData,
  marketContext?: {
    averageValueForPosition?: number;
    recentTransfers?: { player: string; value: number }[];
  }
): Promise<string> {
  try {
    const ai = initGenAI();
    
    let contextStr = '';
    if (marketContext?.averageValueForPosition) {
      contextStr += `\nAverage market value for ${player.Position}: €${(marketContext.averageValueForPosition / 1000000).toFixed(1)}M`;
    }
    if (marketContext?.recentTransfers) {
      contextStr += `\nRecent comparable transfers: ${marketContext.recentTransfers.map(t => `${t.player} (€${(t.value / 1000000).toFixed(1)}M)`).join(', ')}`;
    }

    const prompt = `
You are a football transfer market analyst. Evaluate the transfer value proposition for this player.

**Player Profile:**
- Name: ${player.Player}
- Age: ${player.Age}
- Position: ${player.Position}
- Team: ${player.Team}
- League: ${player.League}
- Current Estimated Value: €${((Number(player['Market value']) || 0) / 1000000).toFixed(1)}M
- Minutes Played: ${player['Minutes played']}

**Key Performance Metrics:**
- Goals: ${player.Goals || 0}, xG: ${player.xG || 0}
- Assists: ${player.Assists || 0}, xA: ${player.xA || 0}
- Duels Won: ${player['Duels won, %'] || 0}%
${contextStr}

---

Provide a brief (150 words) transfer analysis covering:
1. **Value Assessment**: Is the current valuation fair based on performance?
2. **Risk Factors**: Age, injury concerns (if applicable), contract situation
3. **Upside Potential**: Growth trajectory and value appreciation potential
4. **Recommended Bid Range**: Suggest a realistic price range

Be specific and market-aware.
`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });

    return response.text || "Failed to generate transfer analysis.";
  } catch (error) {
    console.error("Gemini API Error:", error);
    return "Error generating transfer analysis.";
  }
}

// ============================================
// TEAM ANALYSIS
// ============================================

/**
 * Génère une analyse tactique d'équipe
 */
export async function generateTeamAnalysis(
  teamStats: Record<string, number | string>,
  teamName: string,
  league: string
): Promise<string> {
  try {
    const ai = initGenAI();
    
    const prompt = `
You are a tactical analyst. Analyze this team's playing style based on their statistics.

**Team:** ${teamName} (${league})

**Statistics:**
${JSON.stringify(teamStats, null, 2)}

---

Provide a brief (200 words) tactical analysis covering:
1. **Playing Style**: Possession-based, direct, counter-attacking, pressing, etc.
2. **Strengths**: What they do well statistically
3. **Vulnerabilities**: Areas of statistical weakness
4. **Tactical Profile**: Best suited formation and player types

Use data to support conclusions. Format in Markdown.
`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });

    return response.text || "Failed to generate team analysis.";
  } catch (error) {
    console.error("Gemini API Error:", error);
    return "Error generating team analysis.";
  }
}

// ============================================
// PROSPECT EVALUATION
// ============================================

/**
 * Génère une évaluation de prospect/wonderkid
 */
export async function generateProspectEvaluation(
  player: PlayerData,
  cohortPercentiles?: Record<string, number>
): Promise<string> {
  try {
    const ai = initGenAI();
    
    const age = Number(player.Age) || 0;
    const isYoungProspect = age <= 21;
    
    let percentileContext = '';
    if (cohortPercentiles) {
      const topMetrics = Object.entries(cohortPercentiles)
        .filter(([_, p]) => p >= 80)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
      
      if (topMetrics.length > 0) {
        percentileContext = `\n**Standout Metrics (vs age group):** ${topMetrics.map(([m, p]) => `${m}: ${p}th`).join(', ')}`;
      }
    }

    const prompt = `
You are a youth academy director evaluating a ${isYoungProspect ? 'young prospect' : 'developing player'}.

**Player Profile:**
- Name: ${player.Player}
- Age: ${player.Age}
- Position: ${player.Position}
- Team: ${player.Team}
- League: ${player.League}
- Market Value: €${((Number(player['Market value']) || 0) / 1000000).toFixed(1)}M
- Minutes This Season: ${player['Minutes played']}
${percentileContext}

**Current Performance:**
${JSON.stringify(
  Object.fromEntries(
    Object.entries(player)
      .filter(([k, v]) => typeof v === 'number' && !['Age', 'Height', 'Weight', 'Market value'].includes(k))
      .slice(0, 15)
  ),
  null, 2
)}

---

Provide a prospect evaluation (200 words) covering:
1. **Current Level**: Where does he stand now for his age?
2. **Projection**: What type of player could he become?
3. **Development Priorities**: 2-3 specific areas to work on
4. **Timeline**: When might he be ready for top-level football?
5. **Comparisons**: Any stylistic player comparisons (be specific)

Be realistic but identify genuine potential. Format in Markdown.
`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });

    return response.text || "Failed to generate prospect evaluation.";
  } catch (error) {
    console.error("Gemini API Error:", error);
    return "Error generating prospect evaluation.";
  }
}

// ============================================
// UTILITIES
// ============================================

/**
 * Efface le cache des rapports
 */
export function clearReportCache(): void {
  reportCache.clear();
}

/**
 * Retourne les statistiques du cache
 */
export function getCacheStats(): { size: number; entries: string[] } {
  return {
    size: reportCache.size,
    entries: Array.from(reportCache.keys())
  };
}