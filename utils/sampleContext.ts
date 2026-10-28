/**
 * ScoutVision - contexte d'échantillon et textes d'aide de la fiche joueur
 * Les seuils reprennent ceux du pipeline et de l'application ; aucun n'est créé ici.
 */

// Seuils de scripts/prepare_data.py
export const MIN_NETWORK_MATCHES = 5;      // réseau de passes : matchs minimum pour être noté
export const MIN_RAPM_MINUTES = 600;       // RAPM : minutes minimum pour un percentile
// Talent de finition : sous ce nombre de tirs en carrière, l'estimation est tirée vers la moyenne
export const SMALL_SHOT_SAMPLE = 50;

/**
 * Vrai si la saison du joueur n'était pas terminée à la date de génération des données.
 * Fin de saison : 30 juin pour une saison européenne (« 2026-27 »), 31 décembre pour une
 * compétition sur l'année civile (libellé de saison « 2026 »).
 */
export function isSeasonInProgress(appSeason: string, seasonLabel: string | undefined, generatedAt: string | undefined): boolean {
  if (!generatedAt) return false;
  const generated = new Date(generatedAt);
  if (Number.isNaN(generated.getTime())) return false;
  const start = Number(appSeason.slice(0, 4));
  if (!start) return false;
  const end = seasonLabel && /^\d{4}$/.test(seasonLabel)
    ? new Date(Date.UTC(Number(seasonLabel), 11, 31, 23, 59))
    : new Date(Date.UTC(start + 1, 5, 30, 23, 59));
  return generated < end;
}

// Percentiles fournis par le pipeline (« X pct »)
export const PIPELINE_PERCENTILE_HELP = 'Percentile (0-100) parmi les joueurs du même rôle (GK, CB, FB, WB, DM, CM, AM, W, ST) et du même niveau de compétition, sur la même saison.\nComparaison par rôle et par niveau, pas par compétition.';

// Indice du rôle (utils/rolePresets.ts, roleIndex) : même calcul partout dans ScoutVision
export const roleIndexHelp = (coreWeight: number, bonus: number) =>
  'Indice du rôle (0-100) : indice composite pondéré, pas un rang percentile.\n'
  + `Moyenne pondérée des percentiles du joueur (même rôle, même niveau, même saison) sur les critères du rôle : critères éliminatoires au poids ${String(coreWeight).replace('.', ',')} (sauf poids propre), critères de classement à leur poids, « moins c'est mieux » compté 100 − percentile. `
  + `Percentiles absents ignorés, poids recalculés ; +${bonus} si le profil de milieu correspond ; plafonné à 100.\n`
  + 'Calcul identique dans la fiche joueur et le Chasseur de pépites.';

export const RATING_HELP = 'Note : moyenne des notes de match de la saison (PitchAPI), qui surpondère les actions offensives.';
