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

Décisions prises : Big 5 seulement, un relevé par jour par tournoi puis historique complet de chaque match
après coup. Plan OddsPapi payant « normal » (5 000 requêtes par mois), pré-match seulement : ni live ni
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
Le serveur compte chaque appel HTTP, réponses 429 et 5xx comprises (mesuré : 27 comptés pour 14 réponses
utiles au premier lot) ; le compteur local fait de même et `status --account --sync` le réaligne.
Besoin mensuel Big 5 : environ 205 historiques, 150 relevés quotidiens, 14 fenêtres de fixtures, soit
moins de 400 sur 5 000. Rattrapage initial de la saison 2026-27 : 447 matchs terminés au 2 novembre.

Tests sans réseau (`npm run test:data`) : `scripts/test_betting_client.py`, `test_betting_archive.py`,
`test_betting_matching.py`, sur des réponses synthétiques calquées sur la forme réelle (« Club A »,
« Joueur 1 »).

## Phases suivantes

2. Simulation de chaque match (20 000 tirages, graine fixe) et probabilités de tous les marchés lues dans
   la même simulation ; calibration par famille et par compétition sur l'historique sans cotes.
3. Sélection (valeur = probabilité × cote − 1 ≥ seuil) et mises (fixe, quart de Kelly, plafonds).
4. Backtest 2026-27 sur cotes relevées avant le coup d'envoi (vue H−1) et suivi des recommandations figées.
5. Page « Labo paris ».

Règles de règlement Winamax à citer ici en phase 3 (buteur et CSC, joueur non entré, prolongations,
handicaps asiatiques, match reporté, combinés).
