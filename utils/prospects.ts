/**
 * ScoutVision - filtrage du Chasseur de pépites (fonction pure, testée)
 *
 * Quatre étapes conjonctives, comptées pour l'entonnoir :
 *   1. poste compatible avec le rôle ;
 *   2. contraintes, dans l'ordre historique : âge, valeur, contrat, estimation / marché, minutes ;
 *   3. profil : filtres qualitatifs (compétitions, niveaux, clubs, nationalités, pied, taille ;
 *      logique de utils/profileFilters.ts) ;
 *   4. critères éliminatoires du rôle : percentile ≥ seuil effectif (base × exigence, plafonné à 99).
 * Puis classement par indice du rôle décroissant (roleIndex, tri stable).
 *
 * Données manquantes :
 *   - percentile absent sur un critère éliminatoire : joueur non éligible, compté à part
 *     (« données insuffisantes »), jamais lu comme P0 ;
 *   - valeur de marché absente : jamais lue comme 0 € ; exclue seulement si une valeur
 *     maximum est fixée, et comptée à part ;
 *   - âge absent : exclu (comportement inchangé) ; contrat absent : exclu si une échéance est fixée ;
 *   - nationalité, pied ou taille absents sous un filtre actif : jamais retenus, sauf option « inclure »
 *     cochée pour ce champ. Compteur `missing` par champ, calculé parmi les joueurs des postes du rôle
 *     qui passent toutes les autres contraintes (valeur de marché connue comprise) et les autres critères
 *     qualitatifs, avant les seuils de percentile. Comme `noMarketValue`, chaque compteur ne retient que
 *     les joueurs écartés pour cette seule raison ; inclus, ils restent comptés.
 * Les contraintes que la saison ne peut pas évaluer (pas de valeur, de contrat ou d'estimation
 * dans les données) ne s'appliquent pas : l'interface les désactive.
 */

import { PlayerData } from '../types';
import { RolePreset, roleIndex } from './rolePresets';
import { EMPTY_PROFILE, MissingField, ProfileFilters, profileCheck, retainedDespiteMissing, tallyMissing } from './profileFilters';
import type { HunterConfig } from '../services/groundedAiService';

// Estimation statistique au moins égale à ce multiple de la valeur de marché
export const ESTIMATE_RATIO_MIN = 1.5;

export interface ProspectConstraints {
  ageMax: number;
  minutesMin: number;
  valueMax: number | null;          // null : sans limite
  contractMonths: number;           // 0 : indifférent
  estimateAboveMarket: boolean;     // estimation ≥ ESTIMATE_RATIO_MIN × valeur de marché
  /** Filtres qualitatifs, comme la Base joueurs (compétitions : aucune = toutes) */
  profile: ProfileFilters;
}

export const DEFAULT_CONSTRAINTS: ProspectConstraints = {
  ageMax: 23,
  minutesMin: 500,
  valueMax: 30_000_000,
  contractMonths: 0,
  estimateAboveMarket: false,
  profile: EMPTY_PROFILE,
};

/**
 * Configuration de l'assistant IA appliquée aux contraintes. Le serveur renvoie au plus une compétition :
 * elle devient la sélection [clé] ; les autres filtres qualitatifs sont conservés. Valeur, contrat et
 * estimation seulement si la saison les fournit.
 */
export function constraintsFromAi(prev: ProspectConstraints, config: HunterConfig, caps: SeasonCapabilities): ProspectConstraints {
  return {
    ...prev,
    ...(config.ageMax !== undefined ? { ageMax: config.ageMax } : {}),
    ...(config.minutesMin !== undefined ? { minutesMin: config.minutesMin } : {}),
    ...(config.valueMax !== undefined && caps.marketValue ? { valueMax: config.valueMax } : {}),
    ...(config.contractMonths !== undefined && caps.contract ? { contractMonths: config.contractMonths } : {}),
    ...(config.estimateAboveMarket !== undefined && caps.estimate ? { estimateAboveMarket: config.estimateAboveMarket } : {}),
    ...(config.competition ? { profile: { ...prev.profile, competitions: [config.competition] } } : {}),
  };
}

/** Données disponibles dans la saison chargée (l'instantané Transfermarkt ne couvre que la saison en cours) */
export interface SeasonCapabilities {
  marketValue: boolean;
  contract: boolean;
  estimate: boolean;
}

export function seasonCapabilities(data: PlayerData[]): SeasonCapabilities {
  return {
    marketValue: data.some(p => typeof p['Market value'] === 'number'),
    contract: data.some(p => typeof p['Contract expires'] === 'string' && p['Contract expires'] !== ''),
    estimate: data.some(p => typeof p['Estimated value'] === 'number'),
  };
}

/** Seuils effectifs : percentile de base × exigence, arrondi, plafonné à 99 */
export function effectiveThresholds(preset: RolePreset, strictness: number): Record<string, number> {
  const out: Record<string, number> = {};
  Object.entries(preset.metrics).forEach(([key, base]) => { out[key] = Math.min(99, Math.round(base * strictness)); });
  return out;
}

export interface ProspectFunnel {
  total: number;              // joueurs de la saison
  position: number;           // compatibles avec le poste
  constraints: number;        // après contraintes (âge, valeur, contrat, estimation, minutes)
  profile: number;            // après profil (filtres qualitatifs) ; égal à constraints sans filtre actif
  eligible: number;           // répondent aux critères du rôle
  noMarketValue: number;      // compatibles, retenus par les autres contraintes et le profil, exclus faute de valeur connue
  insufficientData: number;   // après profil, exclus seulement faute de percentile
  belowThreshold: number;     // après profil, au moins un percentile connu sous le seuil
}

export interface ProspectSearch {
  players: PlayerData[];                 // éligibles, triés par indice du rôle
  thresholds: Record<string, number>;
  funnel: ProspectFunnel;
  /** Par champ incomplet : joueurs des postes du rôle, retenus par toutes les autres contraintes, sans cette donnée */
  missing: Record<MissingField, number>;
}

const knownNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Contraintes hors valeur de marché ; renvoie aussi si la valeur bloque seule
 */
function checkConstraints(
  p: PlayerData,
  c: ProspectConstraints,
  caps: SeasonCapabilities,
  contractDeadline: Date,
): { pass: boolean; blockedByUnknownValue: boolean } {
  let unknownValue = false;
  if ((Number(p.Age) || 100) > c.ageMax) return { pass: false, blockedByUnknownValue: false };
  if (caps.marketValue && c.valueMax !== null) {
    const market = p['Market value'];
    if (!knownNumber(market)) unknownValue = true;
    else if (market > c.valueMax) return { pass: false, blockedByUnknownValue: false };
  }
  if (caps.contract && c.contractMonths > 0) {
    const end = p['Contract expires'] ? new Date(p['Contract expires']) : null;
    if (!end || end > contractDeadline) return { pass: false, blockedByUnknownValue: false };
  }
  if (caps.estimate && c.estimateAboveMarket) {
    const market = Number(p['Market value']);
    const estimate = Number(p['Estimated value']);
    if (!market || !estimate || estimate / market < ESTIMATE_RATIO_MIN) return { pass: false, blockedByUnknownValue: false };
  }
  if ((Number(p['Minutes played']) || 0) < c.minutesMin) return { pass: false, blockedByUnknownValue: false };
  return { pass: !unknownValue, blockedByUnknownValue: unknownValue };
}

export function filterProspects(
  data: PlayerData[],
  preset: RolePreset,
  strictness: number,
  constraints: ProspectConstraints,
  caps: SeasonCapabilities,
  now: Date = new Date(),
): ProspectSearch {
  const thresholds = effectiveThresholds(preset, strictness);
  const contractDeadline = new Date(now);
  contractDeadline.setMonth(contractDeadline.getMonth() + constraints.contractMonths);

  const funnel: ProspectFunnel = {
    total: data.length, position: 0, constraints: 0, profile: 0, eligible: 0,
    noMarketValue: 0, insufficientData: 0, belowThreshold: 0,
  };
  const missingData: Record<MissingField, number> = { nation: 0, foot: 0, height: 0 };
  const profile = profileCheck(constraints.profile);
  const include = constraints.profile.includeMissing;
  const players: PlayerData[] = [];

  data.forEach(p => {
    if (!preset.positions.includes(p.Position)) return;
    funnel.position++;

    const check = checkConstraints(p, constraints, caps, contractDeadline);
    if (!check.pass && !check.blockedByUnknownValue) return;
    if (check.pass) funnel.constraints++;
    // Profil : un critère qui échoue écarte ; une donnée absente écarte sauf option « inclure »
    const absent = profile ? profile(p) : [];
    if (absent === null) return;
    const profileOk = retainedDespiteMissing(absent, include);
    // Chaque compteur ne retient que les joueurs écartés pour cette seule raison
    if (check.blockedByUnknownValue) {
      if (profileOk) funnel.noMarketValue++;
      return;
    }
    tallyMissing(missingData, absent, include);
    if (!profileOk) return;
    funnel.profile++;

    let missing = false;
    let below = false;
    Object.entries(thresholds).forEach(([key, min]) => {
      const pct = p[`${key} pct`];
      if (!knownNumber(pct)) missing = true;
      else if (pct < min) below = true;
    });
    if (below) { funnel.belowThreshold++; return; }
    if (missing) { funnel.insufficientData++; return; }
    funnel.eligible++;
    players.push(p);
  });

  // Tri stable : à indice égal, l'ordre des données est conservé (comme avant)
  const indexed = players.map(p => ({ p, index: roleIndex(p, preset) }));
  indexed.sort((a, b) => b.index - a.index);
  return { players: indexed.map(x => x.p), thresholds, funnel, missing: missingData };
}
