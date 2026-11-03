# Labo paris

Module de recherche et de suivi de paris sur les cotes Winamax FR, séparé de la page Pronostics (gelée).
Décision du propriétaire : ce module, et lui seul, peut afficher des cotes, des mises, une bankroll, un
rendement et des recommandations. Toutes les autres règles du projet s'appliquent : aucune cote, aucun
nom réel ni résultat de bankroll dans le dépôt, les PR, les issues, les tests ou les captures ; la clé API
reste hors Git.

Source de cotes imposée : OddsPapi (`https://api.oddspapi.io/v4`, bookmaker `winamax.fr`). Clé dans la
variable d'environnement `ODDSPAPI_API_KEY` (`.env.local` en local, secret de workflow en CI), jamais
préfixée `VITE_`, jamais affichée.

## Phase 0 : audit (2 novembre 2026, lecture seule)

Constats sur de vraies réponses (échantillons sous `.research/oddspapi/`, ignoré par Git) :

- **Slug** `winamax.fr` (aussi `winamax.es`, `winamax.de`). Plan gratuit : 250 requêtes par mois, lues
  dans `/v4/account` (`request_limit`, `request_count`) ; aucun en-tête de quota ; limite de débit par
  endpoint signalée par un 429 avec `retryMs`.
- **Endpoints** : `/fixtures?sportId=10&from&to` (fenêtre de 10 jours, toutes compétitions, noms
  d'équipes et de tournois inclus), `/markets?sportId=10` (1 122 marchés), `/bookmakers`,
  `/historical-odds?fixtureId&bookmakers` (3 bookmakers par appel, 2 à 5 Mo par match, tous les relevés
  `createdAt` UTC), `/odds-by-tournaments?tournamentIds&bookmakers` (cotes courantes d'un tournoi en un
  appel, `changedAt` par issue), `/odds?fixtureId`.
- **Profondeur Winamax FR** : rien avant avril 2026, relevés épars fin avril, continus depuis juillet
  2026. Seule la saison 2026-27 est exploitable.
- **Marchés Winamax présents** (75 à 98 par match) : résultat (1N2, double chance, remboursé si nul, temps
  réglementaire et 1re mi-temps), plus/moins (total, par équipe, par mi-temps), handicap asiatique, BTTS,
  clean sheet, gagne sans encaisser, marque dans les deux mi-temps, score exact (FT, MT, par équipe),
  mi-temps/fin de match, marge de victoire, première et dernière équipe à marquer, buteur à tout moment,
  buts et passes par joueur. Corners, cartons, tirs joueur et combinés n'existent pas chez Winamax.
- **Relevés** : 30 000 à 51 000 par match, 1 000 à 2 300 dans la dernière heure, dernier relevé 1N2 entre
  0 et 18 minutes avant le coup d'envoi ; une issue sur deux de handicap asiatique n'a pas de relevé
  avant H−1 ; les relevés postérieurs au coup d'envoi (live) sont présents et doivent être exclus.
- **Marge** (dernier relevé avant coup d'envoi) : 1N2 11 %, plus/moins 13,6 %, par équipe 11,5 %,
  handicap asiatique 12,7 %, BTTS 16,7 %, résultat 1re MT 24,6 %, mi-temps/fin 38,7 %.
- **The Odds API** (testée à titre de comparaison) : Winamax FR présent mais 1N2 seulement, historique
  payant ; non retenue.
- **Nos données** (cache PitchAPI, 35 compétitions, 2021-22 à 2026-27) couvrent toutes ces familles à
  100 % sur l'historique : buts avec buteur, penalty et CSC, période, tirs avec xG par joueur, passes
  décisives et xAG, compositions avec rôle titulaire/remplaçant et minutes, arbitre. Limite : pas de
  composition probable avant le match (seules les compositions confirmées existent).
- **Appariement** OddsPapi ↔ PitchAPI (compétition, date ± 1 jour, noms) : 79 % strict sur une semaine
  toutes compétitions, 100 % sur Premier League, Serie A, Championship ; les échecs sont des variantes
  de nom absorbées par une table d'alias apprise.

Décisions prises : Big 5, puis Championship, Liga Portugal, Eredivisie, puis les trois coupes d'Europe (3 novembre) ; un
relevé par jour par tournoi puis historique complet de chaque match après coup. Plan OddsPapi payant « normal » (5 000 requêtes par mois), pré-match seulement : ni live ni
marchés joueurs. Les familles buteur et passeur sortent donc du périmètre ; les 80 marchés par match
restants (résultat, buts, handicap asiatique, scores exacts, mi-temps/fin, première et dernière équipe à
marquer, marge) sont ceux du Labo.

## Phase 1 : client et archive (`scripts/betting/`)

| Module | Rôle |
|---|---|
| `client.py` | Client OddsPapi : clé hors journaux, débit minimal par endpoint, reprise sur 429 (délai annoncé) et 5xx (backoff 2 s, 4 s), 3 tentatives puis erreur sans écriture, compteur mensuel persistant (`.research/betting/quota.json`) qui refuse l'appel dépassant le quota, cache disque (une relecture ne compte pas), fenêtres de fixtures découpées par 10 jours, bookmakers par 3 |
| `archive.py` | Aplatissement `bookmakers → markets → outcomes → players → relevés` en lignes UTC triées, écriture parquet idempotente (`.research/betting/odds/{compétition}/{saison}.parquet`), vues dérivées premier / H−24 / H−1 / dernier avant coup d'envoi (null sans relevé, jamais un relevé postérieur au coup d'envoi) |
| `matching.py` | Appariement par compétition, date ± 1 jour et similarité de jetons (accents et mots génériques retirés), seuil 0,5 et candidat unique ; échecs listés (`aucun_candidat`, `score_insuffisant`, `ambigu`), jamais d'appariement au plus proche ; alias appris dans `.research/betting/aliases.json` |
| `fetch.py` | Ligne de commande : `status [--account --sync]`, `fixtures --from --to`, `history --max-requests N [--since] [--competitions]`, `snapshot`, `views`, `match` |

Coût en requêtes : 1 par fenêtre de 10 jours de fixtures, 1 par match pour l'historique complet (qui
contient tous les relevés pré-match, donc les vues H−24 et H−1), 1 par tournoi pour un relevé courant.
Comptage serveur mesuré le 2 novembre 2026 : `/fixtures`, `/odds` et `/odds-by-tournaments` sont
décomptés à chaque appel HTTP, réponses 429 comprises (27 comptés pour 14 fenêtres utiles) ;
`/historical-odds` et `/account` ne le sont pas (447 historiques téléchargés, compteur serveur inchangé).
Le compteur local compte prudemment chaque appel ; `status --account --sync` le réaligne sur le serveur.
Limite de débit : `/historical-odds` renvoie 429 sous environ 6 s entre deux appels (intervalle 6,5 s,
relevé automatiquement au délai annoncé après un 429) ; `/fixtures` 1,5 s.
Besoin mensuel Big 5 décompté : 150 relevés quotidiens et 3 fenêtres de fixtures par mois, loin des 5 000.

Rattrapage initial (2 novembre 2026) : 447 matchs terminés de 2026-27, 9,1 millions de relevés, 23 Mo
en parquet, 58 à 98 marchés par match, médiane 20 000 relevés par match ; vues dérivées sur 103 870
lignes avec H−1 disponible à 99,5 % (manque surtout sur les scores exacts par équipe, 7,7 %) ;
appariement avec PitchAPI 447/447 après deux alias saisis à la main (Bilbao, Cologne).
Deux processus ne doivent jamais écrire l'archive en même temps (verrou `.research/betting/.lock`).

Tests sans réseau (`npm run test:data`) : `scripts/test_betting_client.py`, `test_betting_archive.py`,
`test_betting_matching.py`, sur des réponses synthétiques calquées sur la forme réelle (« Club A »,
« Joueur 1 »).

## Phase 2 : simulation, probabilités par marché, calibration et comparaison à Winamax

Points ouverts de la phase 1, tranchés sur de vraies réponses (2 novembre 2026) :

- **Cotes courantes** : `/historical-odds` répond pour une rencontre pas encore jouée (tous les relevés
  depuis l'ouverture du marché, 69 marchés, dernier relevé à la minute) et n'est pas décompté du quota
  (compteur serveur inchangé après trois appels). Le relevé courant passe donc par cet endpoint : la
  commande `snapshot` reste disponible mais `history` sur les rencontres à venir suffit (remplacé le
  3 novembre par `/odds-by-tournaments`, voir « Cycle quotidien »). Le workflow
  `betting-odds.yml` est livré avec sa planification commentée ; il n'est pas activé.
- **Compositions** : le cache PitchAPI ne contient que des matchs terminés et des compositions
  `confirmed = true` post-match (`lineup_type` standard ou absent) ; l'export PitchAPI tourne le lundi et
  le vendredi. Aucune composition officielle n'atteint ScoutVision avant le coup d'envoi, et le délai de
  publication côté PitchAPI n'est pas observable d'ici.

### Moteur (`scripts/betting/simulate.py`, `markets.py`, `results.py`)

- Buts attendus lus dans les prévisions figées point-in-time de la recherche (modèle
  `scoutvision_reproduced`, `fitted_at` = date logique du réajustement hebdomadaire, contrôlée ≤ coup
  d'envoi) ; aucun modèle modifié. Les prévisions figées n'existent que pour 2024-25, 2025-26 et 2026-27 :
  la calibration porte sur 2024-25 et 2025-26, la comparaison aux cotes sur 2026-27.
- Loi conjointe du score : Poisson, Dixon-Coles (rho) ou binomiale négative (k), ajustée par maximum de
  vraisemblance sur 2024-25 et choisie sur 2025-26 au log-loss du score exact, puis figée
  (`.research/betting/phase2/variant.json`). Résultat : Dixon-Coles rho = −0,03 (log-loss score exact
  2,8833 contre 2,8838 Poisson et 2,8841 binomiale négative k = 500 ; 1N2 1,0013 contre 1,0020 ;
  plus/moins 2,5 identique à 0,6829), sur 2 906 matchs.
- 20 000 tirages par match, graine 7 ; chaque but est en première mi-temps avec la part observée dans la
  compétition sur les saisons antérieures (0,44 à 0,45) ; ordre des buts par permutation uniforme
  (premier et dernier but).
- 26 types de marchés d'équipe (résultat, double chance, remboursé si nul, plus/moins total et par
  équipe, handicap asiatique, score exact, nombre de buts, BTTS, clean sheet, gagne sans encaisser,
  marque / gagne les deux mi-temps ou l'une d'elles, marge de victoire, premier et dernier but,
  mi-temps / fin de match), sur le temps réglementaire et la 1re mi-temps.

Règlement (règles usuelles des paris football Winamax ; le site n'est pas consultable depuis
l'environnement de développement, à confirmer sur la page « Règles des paris » de Winamax) : temps
réglementaire, prolongations exclues ; but contre son camp crédité à l'équipe bénéficiaire ; remboursé si
nul et handicap entier remboursés en cas d'égalité ; ligne en quart = moitié de la mise sur chaque ligne
voisine (moitié gagnée / moitié remboursée, moitié perdue / moitié remboursée) ; match reporté ou
interrompu : hors périmètre (seuls les matchs terminés sont réglés, matchs à score administratif ou avec
prolongation exclus).

### Mesures (`scripts/betting/phase2.py`)

A. Calibration sans cotes : issues canoniques de chaque famille (lignes usuelles), tranches de
probabilité prédite, prédit / observé / N, log-loss, Brier ; une famille est « utilisable » si l'écart
moyen |prédit − observé| pondéré est ≤ 2 points sur au moins 500 issues.

B. Comparaison à Winamax (2026-27, vues H−1 et dernier relevé, jamais un relevé postérieur au coup
d'envoi) : probabilité Winamax sans marge par normalisation proportionnelle sur les marchés complets ;
log-loss nous contre Winamax ; part des issues à espérance de gain positive (p × cote > 1, demi-mises et
remboursements compris) ; sur ces issues, rendement réel à mise fixe, taux de réussite, intervalle à 90 %
par bootstrap des matchs. Aucun seuil n'est optimisé.

C. Synthèse famille × compétition (`.research/betting/phase2/synthesis.csv`), classée par calibration
puis borne basse de l'intervalle du rendement H−1.

### Résultats de la phase 2 (8 compétitions, 2 novembre 2026)

- **Calibration sans cotes** (2024-25 et 2025-26, 5 803 matchs, issues canoniques) : les 13 familles passent
  le seuil (écart moyen |prédit − observé| de 0,14 point pour le score exact à 1,12 point pour BTTS, gagne
  sans encaisser et premier / dernier but) ; 17 cases famille × compétition sur 104 le dépassent (entre 2,0
  et 3,0 points, surtout LaLiga, Liga Portugal et Serie A) et sont exclues des suggestions.
- **Comparaison à Winamax** (2026-27, 704 matchs appariés avec cotes) : Winamax a un meilleur log-loss que
  la simulation sur les 13 familles, à H−1 comme au dernier relevé (écart de +0,0004 sur « gagne sans
  encaisser » à +0,025 sur la marge de victoire). Part d'issues à espérance positive : 1 à 14 % selon la
  famille ; sur ces issues, rendement réel à mise fixe de −17 % (handicap asiatique, dernier relevé) à
  −71 % (score exact), intervalles à 90 % sous zéro sur toutes les familles. Sur les 104 cases famille ×
  compétition, aucune n'a d'intervalle entièrement positif, 51 ont un intervalle entièrement négatif ; les
  quelques rendements positifs (résultat en Bundesliga, handicap et plus/moins en Premier League à H−1)
  tiennent dans la variance.
- **Lecture** : la simulation est bien calibrée dans l'absolu, mais Winamax l'est mieux ; « notre probabilité
  × cote > 1 » sélectionne surtout les cas où le modèle se trompe. La comparaison reste un indicateur, pas
  un filtre, selon la décision du propriétaire.

## Produit : suggestions de paris dans Pronostics › Matchs à venir

Décision du propriétaire : l'objectif devient un produit ; le gel de Pronostics est levé pour le seul
onglet « Matchs à venir », qui peut employer le vocabulaire des paris. Les trois autres onglets restent
gelés. La comparaison de phase 2 sert d'indicateur, pas de filtre. Le 3 novembre 2026, à la demande du
propriétaire, un onglet « Suivi des paris » s'y ajoute, avec le même vocabulaire (voir plus bas).

### Buts attendus ajustés (`scripts/betting/adjust.py`)

Base : prévisions figées (ScoutVision reproduit) ou prévisions du pipeline pour les rencontres à venir.
Ajustement multiplicatif log(xg) + Σ β · feature, features point-in-time, β par maximum de vraisemblance
de Poisson sur 2024-25, décision sur 2025-26 (log-loss du score exact avec la variante figée) :

| Ajout | Effet mesuré sur 2025-26 | Décision |
|---|---|---|
| Forme pondérée, demi-vie 60 / 120 / 240 jours, terrain propre | score exact 2,8833 → 2,8826 (240 j, le meilleur), 1N2 1,0013 → 1,0004 | gardé, demi-vie 240 j |
| Confrontations directes 5 ans (différence de buts rétrécie) | 2,8826 → 2,8823, 1N2 → 1,0001 | gardé |
| Part de 1re mi-temps propre à chaque équipe | 1N2 de mi-temps 1,0378 → 1,0439 (dégradé) | rejeté |
| Compositions officielles, absences | aucune donnée avant le match dans nos sources | non testé |

Gains réels mais faibles : l'essentiel de l'information est déjà dans la base.

### Moteur de suggestions (`suggest.py`, `product.py`)

- Toutes les issues de tous les marchés Winamax relevés pour le match sont évaluées dans la simulation
  (probabilité hors remboursement, espérance pour 1 €).
- Exclusions : cote < 1,30 ; relevé de plus de 2 h ou postérieur au coup d'envoi (affiché « ancienne »,
  jamais suggéré) ; famille × compétition marquée non utilisable par la calibration de phase 2.
- Profils : « Sûr » (probabilité la plus forte), « Équilibré » (score = p × (1 + espérance) = p² × cote,
  la probabilité pondérée par le multiplicateur attendu de la mise), « Grosse cote » (cote ≥ 3, meilleure
  espérance). Un seul pari par groupe de doublons (même direction sur le même objet : les « plus de »
  d'un même match, un résultat et ses doubles chances, etc.), 3 à 5 suggestions.
- Combiné : 2 ou 3 sélections de groupes différents, compatibles et non emboîtées, probabilité jointe =
  co-occurrence dans la simulation, cote = produit ; proposé si l'espérance jointe est positive, ou en
  profil « Sûr » si la probabilité jointe atteint 45 %.
- Mises : quart de Kelly, plafonds 5 % par pari et 15 % par match ; espérance négative → mise fixe 2 %
  signalée. Le pipeline publie des fractions ; le navigateur applique la bankroll saisie (300 € par
  défaut, mémorisée dans `localStorage`).
- Raisons : forme à domicile / à l'extérieur sur 5 matchs, buts attendus du modèle, confrontations
  directes, part de 1re mi-temps pour les marchés de mi-temps.
- Rejeu 2026-27 (`product replay`) : prévisions figées, features point-in-time, dernier relevé avant le
  coup d'envoi, bankroll de 300 € par profil misée sur la bankroll courante, arrondie au centime.
- Journal (`.research/betting/journal/suggestions.parquet`) : chaque suggestion publiée est enregistrée
  avec l'horodatage du relevé et n'est jamais réécrite ; réglée après le match (remboursements et
  demi-gains compris).
- Export `public/data/forecast/suggestions/index.json` (artefact privé) : rencontres à venir, profils,
  bilan du rejeu, résumé du journal.

### Bilan du rejeu 2026-27 (651 matchs avec cotes, 2 novembre 2026)

| Profil | Paris simples | Réussite | Rendement à mise fixe | 300 € rejoués (mises du moteur) | Pire creux |
|---|---|---|---|---|---|
| Sûr | 3 249 | 62 % | −12 % | 0,09 € | 100 % |
| Équilibré | 3 249 | 61 % | −12 % | 0,09 € | 100 % |
| Grosse cote | 3 246 | 17 % | −26 % | 0,17 € | 100 % |

Avec les règles demandées (3 à 5 paris par match, mise fixe de 2 % même à espérance négative, quart de
Kelly sinon), la bankroll est ruinée sur la saison dans les trois profils : 4,5 paris par match à
rendement négatif, misés sur 10 à 15 % de la bankroll par match. Les sous-ensembles « espérance positive
seulement » (−13 à −36 %) et « meilleur pari du match à espérance positive » (−9 à −31 %, bankroll finale
119 à 166 €) perdent aussi. Par famille, seuls « gagne sans encaisser » (Sûr, +1 %, 81 paris) et « nombre
de buts équipe » (Équilibré, +12 %, 52 paris) sont positifs, sur trop peu de paris pour signifier quelque
chose ; toutes les compétitions sont négatives (−7 % en Premier League à −17 % en Championship en
Équilibré). Les combinés (cote = produit des cotes Winamax, probabilité jointe simulée) affichent des
rendements positifs (+1 %, +8 %, +55 %), mais leur espérance est gonflée par la corrélation entre
sélections d'un même match que le produit des cotes ignore, et Winamax ne propose pas de combiné du même
match à ces cotes : à lire comme une curiosité, pas comme un résultat.

Conclusion du bilan : cohérent avec la phase 2, le moteur de suggestions ne gagne pas d'argent sur
2026-27 ; l'onglet affiche ce bilan à côté de chaque suggestion, tel quel.

### Interface (`components/forecast/Suggestions.tsx`)

Panneau de contrôle (profils en `sv-seg`, bankroll, bilan du profil), bloc repliable sous chaque match
(ouvert sur le premier), une ligne par suggestion (sélection, cote et heure du relevé, probabilité,
espérance, mise, raisons, bilan du type), combiné, « Cotes Winamax non disponibles pour ce match. » ;
cartes empilées sous 640 px avec cote et mise visibles ; espérance positive en `text-pos`, négative en
encre neutre.

### Cycle quotidien (`.github/workflows/betting-odds.yml`, actif à la demande du propriétaire)

- **Le soir** (10 h, 14 h, 17 h UTC) : rencontres de la fenêtre, cotes courantes des rencontres à venir
  (`/odds-by-tournaments`, un appel par tournoi, décompté : 11 appels par passage), vues, appariement,
  suggestions et journal, export. Les cotes sont datées de l'heure de l'appel (`flatten_live(stamp="observed")`) :
  prix vérifiés identiques au dernier relevé de `/historical-odds` sur 834 issues (3 novembre 2026), alors que
  `changedAt` daterait de plusieurs heures une cote inchangée et la ferait écarter comme périmée. L'ancien
  relevé match par match reste disponible (`upcoming --per-fixture`, environ 6,5 s par rencontre).
- **Historiques des matchs terminés** (`/historical-odds`, environ 6,5 s par match, limite d'OddsPapi) :
  au passage du matin seulement, ou tant que l'archive est incomplète. Les relevés sont écrits par lots
  (`SnapshotBuffer`) : chaque écriture réécrit tout le fichier de la saison.
- **Le matin** (06 h 30 UTC) : résultats de la veille lus sur le tableau de scores public d'ESPN
  (`betting/results_web.py`, scores finaux, mi-temps, premier et dernier but, sans clé), fusionnés aux
  résultats PitchAPI pour régler le journal sans attendre l'export du lundi ou du vendredi ; puis
  `betting.evening auto` enregistre les paris de la veille (dernière publication du profil Équilibré avant
  chaque coup d'envoi, mise = fraction × 300 €) et `betting.evening settle` les règle ; `evening show`
  donne le tableau soirée par soirée avec le cumul.
- Publication : archive du Labo (odds, vues, journal, historique des soirées, phase 2, résultats) dans la
  release privée `betting-odds` ; artefact des suggestions dans `scoutvision-data.tar.gz` lue par le serveur.
- Premier passage : l'archive de cotes se reconstitue par lots de 400 matchs par passage (non décomptés) ;
  les artefacts de phase 2 (variante, calibration, ajustements) sont créés s'ils manquent.
- Secrets : `ODDSPAPI_API_KEY` (sinon les étapes de cotes sont sautées avec un avertissement) et
  `PITCHAPI_DATA_TOKEN`. Depuis l'environnement de développement, ESPN et les releases ne sont pas
  accessibles : l'historique se règle en CI.

## Phases suivantes

2. Simulation de chaque match (20 000 tirages, graine fixe) et probabilités de tous les marchés lues dans
   la même simulation ; calibration par famille et par compétition sur l'historique sans cotes.
3. Sélection (valeur = probabilité × cote − 1 ≥ seuil) et mises (fixe, quart de Kelly, plafonds).
4. Backtest 2026-27 sur cotes relevées avant le coup d'envoi (vue H−1) et suivi des recommandations figées.
5. Page « Labo paris ».

Règles de règlement Winamax à citer ici en phase 3 (buteur et CSC, joueur non entré, prolongations,
handicaps asiatiques, match reporté, combinés).

### Onglet « Suivi des paris » (`components/forecast/BetHistory.tsx`)

Ce qui a été suggéré et ce que cela a donné, lu dans l'export (`history`, `evenings[].details`) :

- **Soirées suivies** : profil Équilibré, mises du moteur sur 300 € ; chaque soirée se déplie pari par pari
  (match, sélection, cote, mise, résultat, net), combinés compris ; gagnés et en attente comptés pari par pari.
- **Suggestions publiées et résultats** : 14 derniers jours, matchs commencés ; pour chaque match et profil,
  la dernière publication avant le coup d'envoi (`product.history`), réglée sur le score réel au passage du
  matin (`won`, `lost`, `void`, `half_won`, `half_lost`, `pending`). Le navigateur ne calcule que la mise et
  le net en euros sur la bankroll saisie (`betNet`, `historySummary`) ; réussite hors remboursements.
- Les combinés ne sont pas journalisés : ils ne figurent que dans les soirées.

