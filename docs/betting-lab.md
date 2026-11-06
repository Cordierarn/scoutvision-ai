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
appariement avec PitchAPI 447/447 après deux alias saisis à la main (deux clubs dont le nom OddsPapi diffère du nom PitchAPI).
Deux processus ne doivent jamais écrire l'archive en même temps (verrou `.research/betting/.lock`).

Tests sans réseau (`npm run test:data`) : `scripts/tests/test_betting_client.py`, `test_betting_archive.py`,
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
réglementaire, prolongations exclues ; but contre son camp crédité à l'équipe bénéficiaire ; mi-temps ou ordre des
buts inconnus : sélection en attente (voir « Règlement depuis ESPN ») ; remboursé si
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
- Mises (jusqu'au 5 novembre 2026 ; voir l'étape 1 du moteur quantitatif plus bas) : quart de Kelly,
  plafonds 5 % par pari et 15 % par match ; espérance négative → mise fixe 2 % signalée. Le pipeline publie
  des fractions ; le navigateur applique la bankroll saisie (300 € par défaut, mémorisée dans
  `localStorage`).
- Raisons : forme à domicile / à l'extérieur sur 5 matchs, buts attendus du modèle, confrontations
  directes, part de 1re mi-temps pour les marchés de mi-temps.
- Rejeu 2026-27 (`product replay`) : prévisions figées, features point-in-time, dernier relevé avant le
  coup d'envoi, bankroll de 300 € par profil misée sur la bankroll courante, arrondie au centime. Depuis l'audit du
  6 novembre 2026, le bilan couvre les cinq profils, porte l'empreinte du moteur qui l'a calculé (`engine`, sources
  des modules et paramètres figés) et est recalculé dès qu'elle change (`replay --if-stale`) : un bilan d'un ancien
  moteur n'est plus affiché comme celui du moteur courant. Rendement et CLV ont un intervalle à 95 % par bootstrap des
  matchs (`cluster_ci`, `returnLow`/`returnHigh`, `clvLow`/`clvHigh`) : les paris d'un même match sont liés.
- Journal (`.research/betting/journal/suggestions.parquet`) : chaque suggestion publiée est enregistrée
  avec l'horodatage du relevé et n'est jamais réécrite ; réglée après le match (remboursements et
  demi-gains compris). Le résumé exporté (`journal`, `product.journal_summary`) ne compte que les **paris jouables**
  (`product.playable`) : pour chaque match et profil, la dernière publication avant le coup d'envoi ; les
  republications d'une même sélection et les publications d'après le coup d'envoi ne sont pas des paris.
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

- **Quatre passages identiques** (05 h 37, 09 h 13, 13 h 41, 16 h 47 UTC, hors des heures rondes que GitHub
  encombre ; `betting/cycle.py:SLOTS`, aligné sur les crons par un test). Audit du 6 novembre 2026 : sur l'ancien
  planning (06 h 30, 10 h, 14 h, 17 h), GitHub n'avait servi aucun créneau du matin, et le passage complet, décidé
  par l'heure, n'avait jamais tourné. Désormais ce qui est lourd est décidé par **l'état de l'archive**
  (`cycle plan`) : fenêtre de rencontres depuis la plus ancienne rencontre jouée sans statut final (toute la saison si
  une compétition manque à l'archive), historiques dès qu'un match terminé n'a pas le sien. Chaque passage est
  journalisé (`cycle record`, `cycle_log.json` publié avec l'archive) ; un créneau qu'aucun passage n'a servi dans les
  2 h est signalé en avertissement et dans le résumé du workflow.
- **Cotes** (à chaque passage) : rencontres de la fenêtre, cotes courantes des rencontres à venir
  (`/odds-by-tournaments`, un appel par tournoi, décompté : 11 appels par passage), vues, appariement,
  suggestions et journal, export. Les cotes sont datées de l'heure de l'appel (`flatten_live(stamp="observed")`) :
  prix vérifiés identiques au dernier relevé de `/historical-odds` sur 834 issues (3 novembre 2026), alors que
  `changedAt` daterait de plusieurs heures une cote inchangée et la ferait écarter comme périmée. L'ancien
  relevé match par match reste disponible (`upcoming --per-fixture`, environ 6,5 s par rencontre).
- **Historiques des matchs terminés** (`/historical-odds`, environ 6,5 s par match, limite d'OddsPapi, non
  décomptés) : à n'importe quel passage, dès qu'un match terminé n'a pas son historique complet. Les relevés sont écrits par lots
  (`SnapshotBuffer`) : chaque écriture réécrit tout le fichier de la saison. Un match est redemandé tant que son
  historique ne va pas jusqu'au coup d'envoi (`fetch.history_todo`) : un relevé « à venir » pris quelques heures avant
  ne suffit pas (correction de l'audit du 6 novembre 2026 : ces matchs n'étaient jamais redemandés, et leur « clôture »
  était le dernier relevé « à venir »). L'historique est complet quand l'archive contient un relevé Winamax postérieur
  au coup d'envoi, ou quand il a été demandé après le coup d'envoi (`history_fetched.json`, publié avec l'archive).
- **Résultats et règlement** (à chaque passage) : résultats de la veille lus sur le tableau de scores public d'ESPN
  (`betting/results_web.py`, sans clé ; voir « Règlement depuis ESPN » plus bas), fusionnés aux
  résultats PitchAPI pour régler le journal sans attendre l'export du lundi ou du vendredi ; puis
  `betting.evening rebuild` reconstruit les soirées depuis le journal (dernière publication du profil Équilibré
  avant chaque coup d'envoi) : chaque soirée mise la fraction publiée de la **bankroll courante** (300 € au départ,
  plus les gains nets des soirées précédentes), et jamais plus que cette bankroll (mises ramenées
  proportionnellement), puis est réglée ; `evening show` donne le tableau soirée par soirée avec le cumul. Avant
  l'audit du 6 novembre 2026, chaque soirée misait la fraction de 300 € sans plafond : la somme des mises d'un soir
  dépassait plusieurs fois la bankroll et le cumul affiché n'était pas jouable.
- Publication : archive du Labo (odds, vues, journal, historique des soirées, phase 2, résultats) dans la
  release privée `betting-odds` ; artefact des suggestions dans `scoutvision-data.tar.gz` lue par le serveur.
- Premier passage : l'archive de cotes se reconstitue par lots de 400 matchs par passage (non décomptés) ;
  les artefacts de phase 2 (variante, calibration, ajustements) sont créés s'ils manquent.
- Secrets : `ODDSPAPI_API_KEY` (sinon les étapes de cotes sont sautées avec un avertissement),
  `THE_ODDS_API_KEY` (référence sharp ; sans elle, aucun pari n'est validé) et `PITCHAPI_DATA_TOKEN`. Depuis l'environnement de développement, ESPN et les releases ne sont pas
  accessibles : l'historique se règle en CI.

### Règlement depuis ESPN (correction du 6 novembre 2026)

Audit du 6 novembre : le tableau de scores d'ESPN ne donne **pas** le score de mi-temps (pas de `linescores`), et le
lecteur le remplaçait par 0-0. Tous les paris de mi-temps (1re mi-temps, mi-temps / fin de match, marque ou gagne dans
les deux mi-temps…) réglés depuis ESPN l'ont été sur une mi-temps inventée, et les buts contre son camp étaient inversés
une seconde fois alors qu'ESPN les crédite déjà à l'équipe bénéficiaire (premier et dernier but faux). Règles depuis :

- **Mi-temps et ordre des buts reconstruits** à partir des buts listés (`details`) : minute affichée (« 43' », « 45'+2' »,
  un but à 45'+n est en première mi-temps), équipe créditée telle quelle. Seulement si chaque minute est lisible et si les
  buts listés redonnent exactement le score final ; sinon mi-temps et ordre des buts restent **inconnus**.
- **Inconnu n'est jamais 0** (`markets.Result` accepte `None`, `markets.settleable`) : une sélection qui dépend de la
  mi-temps ou de l'ordre des buts reste **en attente** ; les marchés du temps réglementaire se règlent normalement.
- **Temps réglementaire seulement** : une rencontre terminée au-delà de la deuxième période (prolongation, tirs au but)
  n'est pas réglée depuis ESPN (`regulation`).
- **Re-règlement** : le règlement est dérivé du résultat courant à chaque passage (`product.resettle`, combinés et soirées
  des 7 derniers jours compris) ; un score corrigé remplace l'ancien règlement, la publication n'est jamais réécrite.
  `results_web --refresh-incomplete 14` relit les dates dont une rencontre terminée n'a pas de mi-temps reconstruite ; une
  relecture ne perd jamais un appariement connu. Dans Mon test, une sélection publiée de nouveau en attente efface le
  statut mémorisé.

## Étape 1 du moteur quantitatif : référence sharp, coupe-circuit, CLV (5 novembre 2026)

Décision du propriétaire, après le bilan du rejeu (1 862 paris simulés 2026-27, rendement à mise fixe −8,5 % à
−14,7 %, bankroll de 300 € ramenée à 7 €, 5 € et 1 € selon le profil) : le marché est efficient par défaut,
la réponse normale est « pas de pari », et 100 % des calculs (devigging, espérance, coupe-circuit, mise)
vivent dans le code Python ; le LLM ne fait que commenter. Plan en quatre étapes ; ceci est l'étape 1.

### Référence sharp (`scripts/betting/sharp.py`, `sharpfeed.py`)

- **Bookmakers.** `winamax.fr` reste le bookmaker d'exécution (cote jouée, espérance et mise). `pinnacle` puis
  `betfair-ex` sont les références. L'abonnement OddsPapi « normal » (25 $/mois) ne couvre que Winamax :
  Pinnacle, Betfair, bet365, Unibet, Betclic… sont tous refusés (`RESTRICTED_ACCESS`, mesuré le 5 novembre
  2026, y compris les flux Pinnacle retardés) ; le client retire désormais les bookmakers refusés et reprend
  l'appel au lieu d'échouer. La référence vient de **The Odds API** (`sharpfeed.py`, clé `THE_ODDS_API_KEY`) :
  Pinnacle sur toutes les rencontres des compétitions du Labo et Betfair Exchange (prix « back » bruts) sur
  une partie, trois marchés (1N2, plus/moins et handicap asiatique à la ligne principale), écrits dans
  l'archive sous les mêmes noms et au même schéma, datés de l'heure de l'appel. Coût : un crédit par marché
  et par compétition ayant une rencontre dans la fenêtre (3 marchés), plan gratuit de 500 crédits par mois lus
  dans les en-têtes, réserve de 25 (budget quotidien : voir « Budget The Odds API ») ; premier relevé réel : 8 compétitions, 36 crédits, 77 rencontres
  appariées sur 126 (les autres sont au-delà de la fenêtre OddsPapi, plus quelques noms non reconnus).
  Appariement des rencontres : même compétition, coup d'envoi à ± 2 h, les deux noms similaires (seuil
  0,5) ; sinon un seul côté sûr (≥ 0,8) qui ne désigne qu'une rencontre du créneau suffit et l'autre nom
  est appris dans `aliases_theoddsapi.json` (nom anglais d'un club serbe → nom OddsPapi, nom allemand / français
  d'un club allemand…) ; deux
  rencontres désignées = aucun appariement, jamais le plus proche.
  Un plan OddsPapi incluant Pinnacle suffirait à revenir à une seule source (`BOOKMAKERS`).
- **Devigging.** Méthode de Shin (part de parieurs informés z, marge plus lourde sur les outsiders),
  comparée à la méthode des puissances (p_i = q_i^k) et à la proportionnelle ; les deux premières sont
  publiées dans la référence. Un marché n'est une référence que s'il est complet (issues qui se partagent
  la probabilité 1 : 1N2, deux issues de plus/moins et de handicap quelle que soit la ligne, BTTS, score
  exact avec « autre »…), relevé moins de 6 h avant l'instant de décision ; sinon : pas de référence,
  pas de pari. Jamais une probabilité inventée.
- **Probabilité de référence.** p_ref ∝ p_modèle^w · p_sharp^(1−w) (pool logarithmique sur l'issue et son
  complément). w = 0 par défaut pour tout segment famille × compétition
  (`.research/betting/phase2/pool_weights.json`, écrit par l'étape 2 seulement quand le poids hors
  échantillon d'un segment est strictement positif). Avec w = 0, le Labo ne détecte donc que les cas où
  Winamax est en retard sur Pinnacle / Betfair.
- **Mouvement sharp.** Variation de p_sharp entre un relevé de référence (H−24, sinon le plus ancien à au
  moins 3 h) et le relevé courant, avec la limite de mise du marché quand OddsPapi la fournit (colonne
  `limit`, souvent nulle) : une baisse de la probabilité de la sélection avec limite en hausse
  (« limit-backed ») bloque le pari ; sans limite connue, seule une forte baisse (≥ 3 points) bloque.

### Coupe-circuit et mise (`scripts/betting/circuit.py`, `opd.py`, `dependency.py`)

Après les exclusions antérieures (cote < 1,30, relevé > 2 h, famille mal calibrée), chaque sélection est
refusée si : pas de référence sharp ; espérance (cote Winamax × p_ref − 1) < 2,5 % sur le handicap
asiatique et les plus/moins, < 4 % ailleurs ; espérance > 20 % ou écart p_ref − p_sharp > 15 points
(« winner's curse » : plus probablement une donnée non observée) ; mouvement sharp contraire ; favori coté
sous 1,55 dont l'équipe a dépassé ses xG de 3 buts ou ses points attendus de 2,5 sur ses 5 derniers
matchs (OPD, xG de `replay_pitchapi.parquet`). Avertissements sans refus : à plus de 12 h du coup d'envoi,
une équipe qui dépend fortement d'un joueur clé (≥ 30 % de l'intermédiarité des titulaires habituels dans
le réseau de passes publié) divise le plafond de mise par deux ; limite de mise inconnue.

Mise : Kelly rétréci f = κ (p_ref × cote − 1) / (cote − 1), κ = 0,15, plafonds 2,5 % par pari, 1 % au-delà
d'une cote de 3,50, 5 % par match. Aucune mise sur une espérance négative : la sélection n'existe pas.
Combinés désactivés (corrélation intra-match non mesurable face au marché). Les profils classent les seules
sélections validées, sur p_ref.

### CLV et produit

- Journal : chaque suggestion publiée porte p_sharp, p_ref, espérance de référence, poids du pool,
  bookmaker de référence ; après le coup d'envoi, `closing_p_sharp` (dernier marché complet avant le coup
  d'envoi, sans borne d'âge) et `clv = cote prise × p_clôture − 1`. Le rejeu et le résumé du journal (paris
  jouables seulement) donnent le CLV moyen avec son intervalle par grappes de match et la part des paris qui
  battent la clôture (Buchdahl : le CLV juge une sélection bien plus vite que le résultat, bruité par le hasard).
- Export : `pSharp`, `pRef`, `evRef`, `poolW`, `sharpBookmaker`, `warnings`, `verdict` par suggestion ;
  `noBet` par match (meilleure idée du moteur et motifs du refus), `sharpCoverage`, `teams` (OPD,
  dépendance) ; `rules` et `reference` (bookmakers, méthode, poids, libellés) ; `schemaVersion` 1.1.0.
- Interface : colonnes Moteur / Sharp / Espérance (face à la référence) / Mise ; « Pas de pari » avec la
  meilleure idée refusée et ses motifs ; CLV par pari et CLV moyen dans le Suivi des paris.
- Assistant IA : reçoit les seuls faits calculés (cote Winamax, probabilités moteur / sharp / référence,
  espérance, mise, motifs de « pas de pari », dépendance à un joueur clé, surperformance récente) ; verdicts
  « garder / prudence / éviter » sur les seules sélections validées ; les « pas de pari » du moteur sont
  placés en tête des matchs à éviter avec la raison calculée ; aucune sélection validée nulle part → plan
  déterministe sans appel au modèle.

### Ce que l'étape 1 ne fait pas encore

Pas de poids w > 0 (l'étape 2 ci-dessous confirme w = 0 partout sur la clôture Pinnacle) ; pas de
composition probable avant H−1 (seule la dépendance à un joueur clé est signalée) ; pas de Betfair après commission (prix bruts) ; pas de décorrélation ni
d'agrégation du onze (étape 4). L'archive antérieure au 5 novembre n'a pas de bookmaker de référence :
le rejeu ne compte un pari qu'à partir du moment où Pinnacle ou Betfair est archivé pour le match. La
« clôture » sharp qui sert au CLV est le dernier relevé The Odds API avant le coup d'envoi (dernier passage
du cycle avant le match) : une clôture approchée, à affiner avec la clôture Pinnacle de football-data pour
les ligues principales (étape 2).

### Budget The Odds API (6 novembre 2026)

Audit du 6 novembre : trois passages par jour sur les rencontres des 36 h suivantes consommaient le plan gratuit en
quelques jours (de l'ordre de 1 000 crédits par mois sur le calendrier réel pour 500), après quoi plus aucune
référence sharp, donc plus aucun pari validé. Décision du propriétaire (option a) : **un passage sharp par jour**, le
premier passage du cycle à partir de 09 h UTC (`sharpfeed pull --daily --not-before 09:00`, `daily_pull_due`), sur les
rencontres des **24 h** suivantes. Un passage sauté est repris au créneau suivant du même jour ; un appel refusé ne
compte pas comme fait.

Calcul : 3 crédits (1N2, plus/moins, handicap) par compétition couverte ayant une rencontre dans la fenêtre, soit de
l'ordre de 300 crédits par mois sur le calendrier réel des 11 compétitions (`credits_per_day`, affiché par
`sharpfeed status` pour la fin du mois en cours), sous les 475 utilisables. Contrepartie : la « clôture » sharp du CLV
est un relevé du matin pour les matchs du soir, plus éloigné du coup d'envoi qu'avec trois passages ; le CLV reste une
clôture approchée tant que la référence ne vient pas d'un flux couvrant la dernière heure (plan payant ou clôture
Pinnacle de football-data).

## Étape 2 du moteur quantitatif : porte de validation par segment, catégorie A (5 novembre 2026)

Question posée : la simulation apporte-t-elle, quelque part, une information que la clôture Pinnacle n'a
pas déjà ? Si non, le poids w du modèle dans la probabilité de référence reste 0 et le coupe-circuit ne
voit que le marché sharp (`scripts/betting/gate.py`, `python3 -m betting.gate [--write]`).

### Méthode

- **Données** : clôture Pinnacle de football-data (dataset de la recherche, `replay_market.parquet`,
  cotes brutes `odds_ps_closing_*` pour le 1N2 et `odds_p_ou_closing_*` pour le plus/moins 2,5),
  dévigées par la méthode de Shin ; probabilités du modèle lues dans la simulation de phase 2 (variante
  figée) sur les buts attendus figés avant le match (`phase2.matches_with_predictions`, anti-fuite).
  Pas de clôture pour les coupes d'Europe (football-data ne les couvre pas) : leurs segments gardent w = 0.
- **Pool** : p ∝ p_modèle^w · p_sharp^(1−w), w sur une grille de 0 à 1 par pas de 0,05, **choisi sur la
  saison 2024-25** (log-loss minimal) puis **évalué sur 2025-26 sans réoptimisation** ; gain de log-loss
  du pool contre la clôture seule, intervalle bootstrap à 90 % (2 000 tirages, graine fixe).
- **Verdict** par famille × compétition : `trop_peu_de_matchs` (moins de 150 matchs sur l'une des deux
  saisons), `poids_nul` (w = 0 déjà en validation), `gain_non_significatif` (w > 0 mais borne basse ≤ 0),
  `valide` (w > 0 et borne basse > 0). Seuls les segments `valide` entrent dans
  `.research/betting/phase2/pool_weights.json` ; le fichier est écrit même vide, le produit lit alors w = 0.
  Le rapport complet (tous les segments, log-loss par poids) est dans `gate.json`.
- **Cycle** : recalcul à chaque amorce du Labo (`update-data.yml`, après `betting.adjust`), fichiers
  embarqués dans l'archive `betting-seed`. Tests synthétiques dans `scripts/tests/test_betting_gate.py` (un
  modèle qui connaît la vérité face à une clôture bruitée est validé ; un modèle faux ne l'est jamais).

### Résultat (clôture Pinnacle 2024-25 → 2025-26, 8 ligues du Labo)

| Famille | Segment | Validation / test | w choisi | Gain hors échantillon [IC 90 %] | Verdict |
| --- | --- | --- | --- | --- | --- |
| résultat | toutes | 2 891 / 1 450 | 0,00 | — | poids nul |
| résultat | ENG | 377 / 209 | 0,50 | −0,0097 [−0,0182 ; −0,0005] | non significatif (négatif) |
| résultat | ENG2 | 547 / 268 | 0,25 | −0,0021 [−0,0055 ; +0,0013] | non significatif |
| résultat | FRA | 304 / 152 | 0,05 | −0,0005 [−0,0014 ; +0,0004] | non significatif |
| résultat | ESP, ITA, POR | ≥ 302 / ≥ 151 | 0,00 | — | poids nul |
| résultat | GER, NED | 303 / < 150 | — | — | trop peu de matchs (test) |
| plus/moins | toutes | 2 875 / 1 442 | 0,00 | — | poids nul |
| plus/moins | ENG | 374 / 209 | 0,20 | −0,0003 [−0,0027 ; +0,0021] | non significatif |
| plus/moins | ENG2 | 547 / 268 | 0,50 | −0,0068 [−0,0121 ; −0,0011] | non significatif (négatif) |
| plus/moins | ESP, FRA, ITA, POR | ≥ 301 / ≥ 151 | 0,00 | — | poids nul |
| plus/moins | GER, NED | ≥ 295 / < 150 | — | — | trop peu de matchs (test) |

**Aucun segment validé.** Sur toute la famille (près de 2 900 matchs de validation), le poids optimal du
modèle est 0 : la clôture Pinnacle contient déjà tout ce que la simulation sait. Les quelques poids
positifs choisis sur 2024-25 (ENG, ENG2, FRA) se retournent sur 2025-26 : un gain apparent en validation
qui ne tient pas hors échantillon, exactement ce que la porte doit écarter. Le produit reste donc à w = 0
partout : la probabilité de référence est la probabilité sharp, et le coupe-circuit ne joue que lorsque
Winamax s'écarte de Pinnacle / Betfair au-delà des seuils de l'étape 1. Le modèle sert aux marchés sans
référence sharp uniquement comme signal d'exclusion, jamais comme source d'avantage.

Ce résultat est attendu (Pitcan 2026 trouve un poids faible mais positif avec un modèle xG plus riche et
plus de saisons) et sera réévalué : à la fin de 2025-26 (GER et NED passeront le seuil des 150 matchs), à
l'arrivée du handicap asiatique dans le dataset football-data, et après toute variante du modèle qui
améliore son log-loss propre en recherche (`docs/forecast-research.md`).

## Marchés secondaires : audit de l'offre Winamax et fraîcheur des cotes (5 novembre 2026)

Point de départ de la phase « tous les marchés pertinents d'une feuille de match » : ce que l'archive contient
réellement, classé en cinq grandes familles (`scripts/betting/markets_catalog.py`, audit écrit dans
`.research/betting/phase2/markets_audit.json` par `python3 -m betting.markets_catalog`), et la correction des
rejets « cote trop ancienne ».

### Les 132 marchés Winamax de l'archive (969 rencontres 2026-27)

| Grande famille | Marchés | Modélisés | Part des relevés | Catégorie de validation (A / B / C) |
| --- | --- | --- | --- | --- |
| Résultats & handicaps (1N2, double chance, DNB, handicaps asiatiques, écart de buts) | 27 | 27 | 9 % | 24 / 2 / 1 |
| Buts & équipes (plus/moins toutes lignes, par équipe, BTTS, clean sheet, scores exacts, 1er / dernier but) | 44 | 44 | 62 % | 17 / 23 / 4 |
| Mi-temps & périodes (1N2, buts, scores et handicaps de 1re mi-temps, mi-temps / fin de match) | 55 | 55 | 29 % | 0 / 50 / 5 |
| Statistiques d'équipe & discipline (corners, cartons) | 6 | 0 | 0 % (une seule rencontre) | 0 / 6 / 0 |
| Marchés joueurs | 0 | 0 | 0 % | — |

Catégories : **A** marché principal couvert par la référence sharp (1N2, plus/moins et handicap asiatique du
temps réglementaire) ; **B** marché fermé à deux ou trois issues, ou à ligne, sans référence sharp (la
probabilité dé-viguée de Winamax lui-même servira de référence dans la porte de validation) ; **C** issues
multiples ou unilatérales (score exact, mi-temps / fin de match, écart de buts, joueurs), validation sur
l'historique seulement.

Deux constats qui bornent la phase :

- **Aucun marché joueur dans l'archive** : l'option « player props » n'est pas dans le plan OddsPapi
  (`has_player_props = false` sur Winamax FR, lu dans le compte), alors que la feuille de match Winamax en
  propose des dizaines (buteur, passeur, joueur décisif, buteur multiple, premier / dernier buteur, type de but,
  duos et trios, « serial player »). Les corners et cartons ne sont présents que sur une rencontre. Les sous-
  modèles joueurs et statistiques d'équipe peuvent être construits et validés sur l'historique PitchAPI, mais
  aucune espérance ne peut être calculée face à une cote tant que ces marchés ne sont pas relevés.
- **La feuille de match Winamax** (`/paris-sportifs/match/<id>`, application chargée par socket.io) affiche
  aussi, pour chaque issue, la part des mises du public : un signal de biais du public à relever le jour où une
  source de cotes couvrira ces marchés. Rien n'est lu sur le site de Winamax par le Labo.

### Fraîcheur des cotes : les 23 % de « cote trop ancienne »

Cause mesurée : `/odds-by-tournaments` ne renvoie pas toute la fenêtre de sept jours (56 rencontres sous 72 h le
5 novembre, 90 sous 127 h le 3). Les rencontres au-delà gardaient le relevé d'un passage antérieur (jusqu'à
49 h), toutes leurs issues étaient évaluées puis rejetées une à une pour ancienneté, ce qui gonflait le compte
des « issues évaluées » sans rien analyser. Deux corrections :

- `fetch upcoming --refresh-stale 2 --max-requests 60` : après le passage par tournoi, les rencontres de la
  fenêtre sans relevé Winamax depuis 2 h sont relevées match par match (`/historical-odds`, non décompté du
  quota, environ 6,5 s chacune) ;
- à l'export, une rencontre dont le dernier relevé Winamax a plus de 2 h n'est plus évaluée (statut sans
  cotes, `oddsStale`), et une issue absente du dernier passage est exclue comme `marche_retire` (ligne
  déplacée ou marché retiré) au lieu de compter comme une cote périmée.

## Lots 1 et 2 : loi des buts et porte de validation universelle (5 novembre 2026)

### Lot 1 : le diagnostic contredit l'hypothèse de surdispersion

Hypothèse de départ : la simulation de Poisson sous-estime les gros scores et fabrique le signal « Moins ». Mesure
sur 2025-26 (2 906 matchs, buts attendus figés avant le match, variante Dixon-Coles figée) : P(≥ 4 buts) prédite
29,7 % contre 29,8 % observée ; variance des totaux observés 2,63 pour une moyenne de 2,77, soit un rapport
variance / moyenne de 0,85 à 0,98 selon la ligue (1,23 en Ligue 1 seulement) : les totaux sont **sous-dispersés**.
Une binomiale négative, même à fragilité gamma partagée entre les deux équipes (α de 0,02 à 0,18), dégrade toutes
les vraisemblances hors échantillon ; la littérature récente dit la même chose ([Sarmanov / Dixon-Coles à marginales
négatives binomiales, JRSS-C 2025](https://www.ebsco.com/articles/mathematics/48178df0-c5e3-5d06-ac05-8b88421e1443/extending-the-dixon-and-coles-model-an-application-to-women-s-football-data),
[comparaisons Poisson / Dixon-Coles / binomiale négative](https://penaltyblog.readthedocs.io/en/latest/models/overview.html),
[Weibull count et copule, Boshnakov et al. 2017](https://econpapers.repec.org/RePEc:eee:intfor:v:33:y:2017:i:2:p:458-466)).

Les deux défauts réels, mesurés sur 2024-25 et 2025-26 :

- **les buts attendus sont trop étalés** : pente des buts réels sur les buts attendus 0,84 (2024-25) et 0,76
  (2025-26) ; les matchs annoncés à 2,16 buts en font 2,39, ceux annoncés à 3,51 en font 3,41. C'est exactement le
  mécanisme du « Moins » : le modèle croit voir des matchs fermés qui ne le sont pas ;
- **la distribution est trop plate** : trop de 0 et 1 but prédits (24,7 % contre 22,7 % observés), pas assez de 3 et
  4 (36,2 % contre 40,0 %).

Correction retenue (`simulate.py`, variante `compoisson`, choisie par `phase2.choose_variant` sur la vraisemblance
du score exact : ajustée sur 2024-25, choisie sur 2025-26, figée) : rétrécissement du total attendu vers la moyenne
de la saison d'ajustement à supériorité constante (`shrink` 0,85), marginales de Conway-Maxwell-Poisson
(`nu` 1,15, sous-dispersion), Dixon-Coles (`rho` −0,02).

| Log-loss hors échantillon (2025-26) | Dixon-Coles (avant) | Binomiale négative | compoisson (retenue) |
| --- | --- | --- | --- |
| score exact | 2,8833 | 2,8841 | **2,8775** |
| 1N2 | 1,0013 | 1,0020 | **1,0000** |
| plus/moins 1,5 · 2,5 · 3,5 · 4,5 | 0,5287 · 0,6829 · 0,5976 · 0,3872 | 0,5291 · 0,6829 · 0,5976 · 0,3872 | **0,5272 · 0,6813 · 0,5970 · 0,3861** |
| les deux équipes marquent | 0,6848 | 0,6852 | **0,6830** |
| totaux 0 · 1 · 2 · 3 · 4 prédits (observés 6,2 · 16,5 · 23,8 · 23,7 · 16,2 %) | 7,3 · 17,4 · 24,2 · 21,4 · 14,8 | 7,0 · 18,1 · 23,9 · 21,4 · 14,7 | **6,2 · 17,0 · 24,9 · 22,6 · 15,3** |

Toutes les métriques s'améliorent, modestement : la loi des buts n'était pas le cœur du problème.

**Le biais « Moins » face à Winamax ne vient pas de la loi des buts.** Sur les 705 matchs joués de 2026-27 avec
clôture Winamax, parmi les issues plus/moins (demi-lignes) que le modèle seul jugerait rentables (espérance ≥ 4 %) :

| Modèle seul | Sélections « Moins » / « Plus » | Réussite des « Moins » (probabilité modèle) | Rendement |
| --- | --- | --- | --- |
| Dixon-Coles (avant) | 301 / 38 | 29,6 % (47,1 %) | −36 % |
| compoisson (après) | 300 / 25 | 36,3 % (55,8 %) | −34 % |

Quand le modèle s'écarte de Winamax, Winamax a raison. Seul le pool avec la probabilité dé-viguée du marché (lot 2)
peut arrêter ces sélections ; une meilleure loi des buts ne le pouvait pas.

### Lot 2 : porte de validation universelle (`gate.py` v2)

Trois catégories (A : référence sharp, clôture Pinnacle de football-data ; B : référence Winamax dé-viguée par Shin
sur le dernier relevé complet avant le coup d'envoi, archive 2026-27, 60 % chronologiques pour choisir w et 40 %
pour juger ; C : fréquence de base de la saison de validation) et trois portes hors échantillon : gain de log-loss du
pool avec w > 0 et IC 90 % positif, porte de calibration par bande (aucun côté « haut » ni « bas » des sélections
que prendrait le coupe-circuit à la cote Winamax ne doit être significativement surestimé), marge de calibration
(ECE à 10 classes) enregistrée dans `pool_weights.json` et ajoutée au seuil d'espérance du coupe-circuit
(`EV_min = EV_base + ECE`, `circuit.ev_threshold`). Le produit lit poids, marge et référence par segment
(`sharp.PoolWeights`) ; pour un segment B validé, la référence du coupe-circuit devient le marché Winamax complet.

Verdicts réels (5 novembre 2026) :

| Catégorie | Segment (toutes compétitions) | Validation / test | w | Gain hors échantillon | ECE pool | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| A | résultat (1N2) | 2 891 / 1 450 | 0,00 | — | 0,013 | poids nul |
| A | plus/moins 2,5 | 2 875 / 1 442 | 0,00 | — | 0,020 | poids nul |
| B | plus/moins (toutes lignes) | 422 / 282 | 0,00 | — | 0,016 | poids nul |
| B | plus/moins équipe | 422 / 282 | 0,00 | — | 0,024 | poids nul |
| B | BTTS / clean sheet | 422 / 282 | 0,00 | — | 0,025 | poids nul |
| B | gagne sans encaisser | 422 / 282 | 0,00 | — | 0,007 | poids nul |
| C | score exact | 2 897 / 2 906 | 1,00 | +0,115 [+0,101 ; +0,129] | 0,000 | valide (hors produit) |
| C | marge de victoire | 2 897 / 2 906 | 1,00 | +0,101 [+0,088 ; +0,114] | 0,004 | valide (hors produit) |
| C | nombre de buts | 2 897 / 2 906 | 1,00 | +0,020 [+0,013 ; +0,027] | 0,001 | valide (hors produit) |

Par compétition, aucun segment B n'atteint 150 matchs par partie (de 33 à 91 en validation) : non jugés. Les
segments A par compétition restent à poids nul ou à gain négatif (ENG, ENG2, FRA), comme à l'étape 2.

Ce que dit la porte de bande, modèle seul, sur la partie test de 2026-27 : plus/moins 382 sélections « bas »
contre 19 « haut », réussite 44,5 % pour une probabilité annoncée de 59,0 % ; plus/moins équipe 223 contre 54 ;
BTTS 28 « oui » réussis à 7 % pour 23 % annoncés. Le modèle seul est surestimé sur tous les côtés qu'il choisit ;
avec w = 0 le pool ne sélectionne rien. **Aucun segment validé** : le produit reste à w = 0 et à la référence
sharp. La catégorie C confirme seulement que la simulation bat la fréquence de base, ce qui ne suffit pas à battre
un bookmaker.

Relecture prévue : fin 2025-26 pour la catégorie A (GER, NED), et chaque semaine pour la catégorie B à mesure que
l'archive 2026-27 grandit (150 matchs par partie et par compétition vers février 2027). La porte tourne dans
`betting-odds.yml` avant les suggestions, `update-data.yml` la recalcule sans la catégorie B (archive absente).

## Profil exploratoire (5 novembre 2026)

À la demande du propriétaire, un quatrième profil, **Exploratoire**, s'ajoute à Sûr, Équilibré et Grosse cote dans
Matchs à venir et dans le Suivi des paris. Les trois profils validés restent inchangés : ils n'affichent que ce qui
passe le coupe-circuit, donc le plus souvent « pas de pari ». Le profil exploratoire montre chaque soir quelque chose
à suivre, en le disant clairement : **ce ne sont pas des paris validés**.

Règles (`suggest.explore`, `product._explore_block`) :

- issues refusées par le coupe-circuit pour espérance insuffisante ou faute de référence sharp seulement (jamais une
  cote ancienne, une issue retirée, une famille mal calibrée, un mouvement sharp contraire, un favori surperformant
  ou un écart suspect) ;
- cote de 1,60 à 6,00 ;
- probabilité du marché sans marge : Pinnacle ou Betfair quand le marché y est coté, sinon le marché Winamax complet
  dévigé par la méthode de Shin (un marché à une seule issue, comme le remboursé si nul archivé, est ignoré) ;
- le moteur au moins d'accord avec le marché (probabilité du moteur ≥ probabilité du marché) ;
- classées par espérance de la cote Winamax face au marché sans marge, la moins négative d'abord ; trois au plus par
  match, une par groupe de doublons ;
- mise fixe symbolique de 0,5 % de la bankroll ; journalisées sous le profil `exploratoire` pour suivre leur
  rendement réel et leur CLV, comme les autres.

Mesure sur les 56 matchs à venir du 5 novembre : 168 sélections (trois par match), cote médiane 1,76, espérance face
au marché médiane −13 % (meilleure −8 %), référence Pinnacle pour un tiers, Winamax sans marge pour le reste. Ce
chiffre est la marge de Winamax : il mesure ce que coûte en moyenne un pari sur ces marchés. Relâcher l'accord du
moteur ne change presque rien (−13,0 % au lieu de −13,4 %).

**Combinés du jour** (journalisés dans `journal/combos.parquet`, réglés quand tous leurs matchs sont terminés selon les règles
Winamax — sélection perdue : combiné perdu ; remboursée : cote retirée ; demi-gain : (1 + cote) / 2 ; demi-perte : 0,5 —, affichés
dans le Suivi des paris en profil Exploratoire ; `suggest.day_combos`, `product.explore_day_combos`, champ `exploreCombos` de l'export) : la meilleure
sélection exploratoire de chaque match, combinée entre matchs différents du même jour (indépendants, donc probabilité
jointe = produit des probabilités sans marge), un combiné de 2 et un de 3 sélections par jour, cote de 2,00 à 12,00,
retenus sur la meilleure espérance face au marché, mise symbolique de 0,5 %. Mesure du 5 novembre : cotes de 3,7 à
10,9, espérance de −15 % à −28 % (la marge de chaque sélection se cumule). Pas de combiné d'un même match : ses
sélections sont liées, le produit des cotes affichait jusqu'à +72 % d'espérance, un artefact que Winamax ne paie pas
(MyMatch cote lui-même ces combinaisons).

L'assistant IA accepte le profil exploratoire : son prompt précise alors que les sélections ne sont pas validées, que
leur espérance face au marché est le plus souvent négative et qu'elles servent à suivre le moteur. La recherche
d'actualité de Claude peut désormais ouvrir jusqu'à trois articles en entier (outil serveur de lecture d'URL) quand
l'extrait d'un résultat ne suffit pas à confirmer une absence ou une composition ; les pages lues passent en tête des
sources.

## Lot 3 : marchés de mi-temps dans la porte de validation (6 novembre 2026)

Les poids du pool et les marges sont désormais indexés par **segment** (`Spec.segment`) : la famille, suffixée de la
période pour une mi-temps (« plus/moins (1re mi-temps) »). Une mi-temps validée n'ouvre pas le match entier, ni
l'inverse. La porte (`gate.py`) passe en catégorie B (référence Winamax dé-viguée par Shin, archive 2026-27, partage
60 / 40 chronologique) les marchés à deux issues de la mi-temps, et en catégorie B à plusieurs issues les marchés
complets (`build_rows_m`, `run_gate_m`, porte de bande issue par issue). Simulation avec la part de buts de première
mi-temps propre à chaque compétition.

Diagnostic préalable, 1re mi-temps 2025-26 (2 906 matchs) : nul à la pause 39,9 % observé contre 40,8 % prédit, 0-0
28,6 % contre 29,0 %, 1,22 but contre 1,23. La loi de la mi-temps est juste en moyenne ; aucune correction appliquée.

| Segment (toutes compétitions) | Test | w | ECE pool | Moteur seul : sélections, réussite / probabilité annoncée, rendement | Verdict |
| --- | --- | --- | --- | --- | --- |
| plus/moins (1re mi-temps) | 282 | 0,00 | 0,027 | 33, 27 % / 46 %, −51 % | poids nul |
| plus/moins équipe (1re mi-temps) | 282 | 0,00 | 0,028 | 42, 33 % / 53 %, −29 % | poids nul |
| BTTS / clean sheet (1re mi-temps) | 282 | 0,00 | 0,039 | 32, 25 % / 43 %, −33 % | poids nul |
| handicap asiatique (1re mi-temps) | 259 | 0,00 | 0,023 | 72, 38 % / 55 %, −27 % | poids nul |
| mi-temps (équipe) : marque / gagne dans les mi-temps | 282 | 0,00 | 0,016 | 160, 31 % / 44 %, −29 % | poids nul |
| résultat (1re mi-temps) | 282 | 0,00 | 0,033 | 27, 15 % / 27 %, −31 % | poids nul |
| mi-temps / fin de match | 282 | 0,00 | 0,005 | 69, 9 % / 17 %, −53 % | poids nul |

Même conclusion que pour les lots 1 et 2 : partout, le log-loss croît avec le poids du modèle dès la partie de
validation, et les sélections du moteur seul sont surestimées d'une quinzaine de points. Les marchés de mi-temps ne
sont pas plus mal pricés par Winamax que ceux du match entier. Par compétition, aucun segment n'atteint 150 matchs
par partie. Relecture quotidienne automatique dans `betting-odds.yml` à mesure que l'archive grandit.

## Suivi de l'ancien moteur et onglet « Mon test » (6 novembre 2026)

Les soirées des 3 au 5 novembre ont été gagnantes avec des suggestions publiées par le moteur d'avant le coupe-circuit,
alors que le rejeu de la saison reste négatif. Deux hypothèses à départager sur des données réelles : la chance, ou une
cote du matin meilleure que celle de la clôture. D'où un cinquième profil publié et journalisé, sans validation :

- **Ancien moteur** (`suggest.LEGACY_PROFILE = "ancien"`) : classement Équilibré sur la seule probabilité du moteur,
  calculé avant le coupe-circuit (`product._legacy_block`). La probabilité sharp de Shin, quand elle existe, est
  exportée (`pSharp`, `evRef`) pour mesurer le CLV ; le verdict vaut `ancien` et le bilan du rejeu n'est pas affiché ;
- **cote de clôture Winamax** (colonne `closing_odds` du journal) : la dernière cote Winamax relevée avant le coup
  d'envoi, remplie par `journal_append` pour les paris dont le match a commencé et recalculée pendant 7 jours
  (`product.update_winamax_closing`), le temps que l'historique complet du match soit archivé ; exportée en
  `closingOdds` dans l'historique avec `marketId` et `outcomeId` ;
- **effet « cote du matin »** (`product.early_block`, champs `closeBets`, `earlyEdge`, `oddsDroppedRate` de
  `journal.byProfile`) : cote prise ÷ clôture Winamax − 1 en moyenne, et part des paris dont la cote a baissé ensuite.
  Affiché dans le Suivi des paris pour chaque profil.

L'assistant IA accepte le profil Ancien moteur : son prompt précise que ce sont les sélections d'avant le coupe-circuit,
non validées.

**Mon test** (onglet de Pronostics, `components/forecast/MyTest.tsx`, `myTestLogic.ts`, `useMyTest.ts`) : la bankroll
personnelle du propriétaire, partie de 20 € (réglable). Le bouton « Suivre » de chaque pari du plan de l'IA l'ajoute avec la
fraction de mise du moteur appliquée à la bankroll disponible (0,10 € au moins, arrondi à 0,10 €). Cote et mise restent
modifiables tant que le pari n'est pas réglé. Règlement automatique par l'identifiant match:marché:issue retrouvé dans
l'historique publié, mémorisé dans le pari (l'historique ne garde que 14 jours) ; réglage manuel en secours. Données
dans le stockage du navigateur uniquement (`scoutvision.betting.mytest`), export et import JSON.

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

- **Soirées suivies** : profil Équilibré, mises du moteur sur la bankroll courante, plafonnées à cette bankroll
  (`evening.rebuild`, bankroll de chaque soirée exportée en `bankroll`) ; chaque soirée se déplie pari par pari
  (match, sélection, cote, mise, résultat, net), combinés compris ; gagnés et en attente comptés pari par pari.
- **Suggestions publiées et résultats** : 14 derniers jours, matchs commencés ; pour chaque match et profil,
  la dernière publication avant le coup d'envoi (`product.history`), réglée sur le score réel au passage du
  matin (`won`, `lost`, `void`, `half_won`, `half_lost`, `pending`). Le navigateur ne calcule que la mise et
  le net en euros sur la bankroll saisie (`betNet`, `historySummary`) ; réussite hors remboursements.
- Les combinés ne sont pas journalisés : ils ne figurent que dans les soirées.

