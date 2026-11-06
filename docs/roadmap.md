# Roadmap et décisions

État des chantiers, décisions du propriétaire et idées reportées. Ce fichier ne répète pas la méthodologie
(voir les autres documents de `docs/`) : il dit où en est chaque partie et pourquoi.

## État des modules (6 novembre 2026)

| Module | État | Référence |
|---|---|---|
| Layout / navigation | Gelé | `.claude/skills/frontend-quality/SKILL.md` |
| Base joueurs | Gelé | idem |
| Fiche joueur | Gelé | idem |
| Chasseur de pépites | Gelé | idem, [tactical-roles](tactical-roles.md) |
| Comparaison | Gelé | idem |
| Joueurs similaires | Gelé | idem, [methodology](methodology.md#similar-players) |
| Analyse d'équipe | Gelé | idem, [methodology](methodology.md#team-analysis) |
| Recrutement | Gelé | idem, [recruitment-model](recruitment-model.md) |
| Pronostics : Simulateur de saison, Modèle vs marché, Méthode & fiabilité | Gelé | [forecast-research](forecast-research.md) |
| Pronostics : Matchs à venir (suggestions), Suivi des paris, Mon test | **En cours** (Labo paris) | [betting-lab](betting-lab.md) |
| Rapports de scouting | V1 livrée ; direction artistique du PDF en pause | [ai-reports](ai-reports.md#scouting-dossiers-local-v1) |
| Laboratoire | Stand-by | [laboratory](laboratory.md) |
| Liste de suivi | Stand-by | — |
| Identité visuelle « Tessera » | Stand-by (essai conservé sur une branche, jamais fusionné) | — |

Le Labo paris n'a pas encore suivi la méthode complète (audit, fermeture, gel) : c'est la prochaine étape
avant de le considérer comme stable.

## Décisions

| Date | Décision | Raison |
|---|---|---|
| 2026-10-28 | Une seule source pour les rôles (`utils/rolePresets.ts`), 11 presets recalibrés | Indice identique dans la fiche, le Chasseur et le Recrutement |
| 2026-10-29 | Recrutement : classement sur la seule projection sportive ; complémentarité lue à part ; incertitude = erreur historique, jamais « ± » | Pas de score global qui mélange des grandeurs non comparables |
| 2026-10-30 | Instance privée sur un serveur Node : l'app, `/data`, `/cdn` et `/api` derrière la session | Un écran de connexion côté navigateur ne protège pas les données |
| 2026-11-02 | Pronostics gelé : le marché de clôture reste plus précis que les modèles sportifs testés (poids optimal du modèle dans le mélange : 0) ; pas de recherche de rentabilité sur ces modèles | Résultat négatif conservé et affiché comme tel |
| 2026-11-02 | Ouverture du Labo paris, seul module autorisé à afficher cotes, mises et bankroll | Nouvelle source : cotes Winamax horodatées avant le match, puis référence sharp (Pinnacle, Betfair). *Raison à confirmer par le propriétaire : revient sur la décision précédente.* |
| 2026-11-05 | Coupe-circuit « pas de pari » : un pari n'est validé que s'il passe la porte de validation face à la référence sharp | Le moteur seul surestime ses sélections ; la porte confirme w = 0 partout à ce jour |
| 2026-11-05 | Profils « Exploratoire » puis « Ancien moteur » : publiés et suivis, explicitement non validés | Observer sur données réelles sans les présenter comme des paris validés |
| 2026-11-05 | Fonctions IA : Claude en tête, Gemini en secours | — |

## Idées reportées

**Prévisions et Labo paris**
- Vrai mode « Actuel » 2026-27 dans le Simulateur (artefact strict complet requis).
- Formats de ligue complexes (MLS, ligues à split ou playoffs, coupes) et règles de départage complètes.
- Calibration plus riche ; BTTS si une source fiable existe.
- Composition probable avant H−1, Betfair après commission, décorrélation des paris d'une même soirée.
- Clôture Pinnacle de football-data pour affiner le CLV des ligues principales.

**Rapports de scouting**
- Direction artistique finale du PDF (maquette Figma).
- Vidéo, collaboration, synchronisation hors du navigateur.

**Produit**
- Reprise du Laboratoire et de la Liste de suivi avec la méthode complète.
- Décision sur l'identité visuelle « Tessera ».
