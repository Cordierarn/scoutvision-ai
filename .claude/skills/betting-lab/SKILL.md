---
name: betting-lab
description: Règles du Labo paris de ScoutVision (onglets Matchs à venir, Suivi des paris et Mon test de Pronostics, serveur server/bettingAi.ts, pipeline scripts/betting, workflow betting-odds.yml). À suivre avant toute modification de ce module, seul autorisé à parler de cotes, de mises et de bankroll.
---

# Labo paris ScoutVision

Module **en cours** (voir `docs/roadmap.md`) : il n'a pas encore suivi la méthode complète (audit, fermeture, gel). Référence
détaillée, décisions et mesures : `docs/betting-lab.md` (en français), à mettre à jour dans la même PR qu'un changement de
règle, de chiffre ou de comportement.

## Périmètre

- Interface : `components/forecast/Suggestions.tsx` (Matchs à venir), `BettingAssistant.tsx` (assistant IA du jour),
  `BetHistory.tsx` (Suivi des paris), `MyTest.tsx` + `myTestLogic.ts` + `useMyTest.ts` (Mon test), logique dans
  `suggestionsLogic.ts` et `assistantLogic.ts` ; types dans `services/replayData.ts`.
- Serveur : `server/bettingAi.ts`, `bettingContext.ts`, `newsFeed.ts` (actualité et plan du jour), `claudeAi.ts` (Claude en tête,
  Gemini en secours).
- Pipeline : `scripts/betting/` (client OddsPapi, archive, simulation, coupe-circuit, porte de validation, suggestions, journal,
  règlement, export), tests dans `scripts/tests/test_betting_*.py`.
- Cycle : `.github/workflows/betting-odds.yml`, quatre passages identiques (05 h 37, 09 h 13, 13 h 41, 16 h 47 UTC, alignés sur
  `betting/cycle.py:SLOTS`) ; le travail lourd (fenêtre de rencontres, historiques) est décidé par l'état de l'archive
  (`cycle plan`), jamais par l'heure ; chaque passage est journalisé et un créneau manqué est signalé (`cycle record`). Les commandes se lancent depuis `scripts/` : `cd scripts && python3 -m betting.<module> …`. Le serveur Heroku
  recharge l'artefact au démarrage puis toutes les 6 h (`SCOUTVISION_DATA_REFRESH_HOURS`).

## Invariants

- **Seul module autorisé** à employer cote, mise, pari, suggestion, rendement, bankroll (décision du 2 novembre 2026,
  `docs/roadmap.md`). Les trois autres onglets de Pronostics restent gelés et sans ce vocabulaire (skill `frontend-quality`).
- **Aucune donnée réelle dans le dépôt** : ni cote, ni nom de club ou de joueur, ni résultat de bankroll dans un commit, un test,
  une PR, une issue ou une capture. Tests et exemples : « Club A », « Joueur 1 », cotes inventées.
- **Secrets côté serveur ou secret de workflow seulement** : `ODDSPAPI_API_KEY`, `THE_ODDS_API_KEY`, `ANTHROPIC_API_KEY`,
  `GEMINI_API_KEY`. Jamais préfixés `VITE_`, jamais dans un journal, un README, un test ou une capture.
- **Rien n'est placé automatiquement** : les mises sont indicatives ; le navigateur ne calcule que des euros à partir de la
  bankroll saisie, jamais une probabilité.
- **L'IA rédige, elle ne calcule pas** : jamais de probabilité, de cote ou de mise produite par l'IA ; elle ne contredit jamais un
  « pas de pari » du moteur. Tout changement de prompt incrémente `BETTING_PROMPT_VERSIONS` et ajoute un cas de test.
- **Règlement** : mi-temps et ordre des buts inconnus restent inconnus (`markets.Result` à `None`), jamais 0-0 ; la sélection
  qui en dépend reste en attente. Le règlement est dérivé du résultat courant à chaque passage (`product.resettle`).
- **Mesure** : un pari = la dernière publication d'un match et d'un profil validé avant le coup d'envoi, publiée depuis le
  coupe-circuit (`product.playable`, `CIRCUIT_START`) ; critère d'arrêt du 18 décembre dans `criterion` de l'export ; rendement
  et CLV avec intervalle à 95 % par grappes de match (`cluster_ci`) ; bilan daté du moteur (`engine_fingerprint`), recalculé
  quand il change ; soirées suivies sur la bankroll courante, jamais plus (`evening.rebuild`).
- **Un résultat négatif est un résultat** : il s'affiche tel quel (porte à poids nul, espérance négative) ; les profils retirés
  restent documentés avec leur résultat dans `docs/betting-lab.md`.

## Règles d'interface

**Exception décidée par le propriétaire : l'onglet « Matchs à venir »** porte les suggestions de paris du Labo paris (`components/forecast/Suggestions.tsx`, artefact `public/data/forecast/suggestions/index.json`) et peut y employer cote, mise, pari, suggestion, rendement. Règles propres : le navigateur ne calcule que la mise en euros (`stakeEuros`, bankroll saisie et mémorisée en `localStorage`), jamais une probabilité ; une cote de plus de 2 h est marquée « ancienne » et n'est jamais suggérée ; espérance positive en `text-pos`, négative en encre neutre, jamais en rouge ; match sans cotes : « Cotes Winamax non disponibles pour ce match. » ; sous 640 px les suggestions sont empilées, cote et mise toujours visibles. Même exception pour l'onglet **« Suivi des paris »** (`components/forecast/BetHistory.tsx`) : résultats lus dans l'artefact (statuts du pipeline), seuls la mise et le net en euros sont calculés à partir de la bankroll (`betNet`, `historySummary`) ; gain en `text-pos`, perte en `text-neg`, en attente et remboursé en encre neutre. Message de jeu responsable (18+, 09 74 75 13 13) toujours visible, sous chaque état (chargement, absence, erreur, contenu). L'**assistant IA du jour** (`components/forecast/BettingAssistant.tsx`, même onglet Matchs à venir) ne fait qu'afficher les avis validés par le serveur (`server/bettingAi.ts`) : jamais de probabilité, de cote ou de mise produite par l'IA ; message de jeu responsable (18+, 09 74 75 13 13) toujours visible ; liens externes en `target="_blank" rel="noopener noreferrer"`.

### Profils

- **Sûr**, **Équilibré**, **Grosse cote** : seules les sélections qui passent le coupe-circuit face à la référence sharp
  (Pinnacle ou Betfair Exchange sans marge, méthode de Shin) ; sinon « pas de pari », avec le motif.
- **Ancien moteur** et **Exploratoire** (avec ses combinés du jour) : **retirés le 6 novembre 2026** (décision du
  propriétaire, `docs/betting-lab.md`, « Retrait des profils non validés »). Ne pas les réintroduire sans décision écrite :
  ni publication, ni journalisation, ni export, ni interface, ni prompt. Le journal déjà écrit reste immuable ; les fonctions
  de mesure ignorent ses lignes (`product.VALIDATED_PROFILES`), et l'interface n'affiche que `PROFILE_ORDER`
  (`isValidatedProfile`), même avec un artefact ancien.

### Suivi des paris : clôture et effet « cote du matin »

- Cote de clôture Winamax (`closing_odds` du journal, `closingOdds` de l'historique) : la dernière cote relevée avant le coup
  d'envoi. Chaque pari de l'historique porte `marketId` et `outcomeId`.
- Ligne « Cote du matin face à la clôture Winamax » par profil (`journal.byProfile[profil].closeBets`, `earlyEdge`,
  `oddsDroppedRate`) : cote prise ÷ clôture − 1 en moyenne, et part des paris dont la cote a baissé ensuite.

### Onglet « Mon test » (`components/forecast/MyTest.tsx`)

- Bankroll personnelle du propriétaire, partie de 20 € (réglable), **dans le stockage du navigateur uniquement**
  (`scoutvision.betting.mytest`, événement `scoutvision-mytest` pour synchroniser les composants) ; export et import JSON ;
  la page le dit.
- Seuls les paris des profils validés peuvent être suivis (`addBet` refuse un autre profil ; pas de bouton « Suivre » sinon).
  Les paris déjà enregistrés d'un profil retiré restent affichés (« profil retiré ») et l'import JSON les restaure tels quels :
  ce sont les données personnelles du propriétaire, jamais effacées.
- Le bouton « Suivre » de chaque pari du plan de l'IA l'ajoute avec la fraction de mise du moteur appliquée à la bankroll
  disponible (`proposedStake` : 0,10 € au moins, arrondi à 0,10 €, plafonné au disponible). Pas de bouton une fois le match
  commencé ; un pari déjà suivi affiche « Suivi dans Mon test ».
- Cote et mise restent modifiables tant que le pari n'est pas réglé (montants saisis à la française, `parseAmount`).
- Règlement automatique par l'identifiant match:marché:issue retrouvé dans l'historique publié (`publishedStatus`), mémorisé
  dans le pari (`autoStatus`) parce que l'historique ne garde que 14 jours ; une sélection publiée de nouveau en attente
  l'efface ; le réglage manuel (`manualStatus`) l'emporte.
  Gain net sur la cote saisie, règles Winamax des demi-gains et remboursements (`netPerUnit`).
- Résumé : bankroll, disponible (hors mises en attente), gain net, rendement sur les mises réglées hors remboursés, réglés,
  soirées (regroupement par date de coup d'envoi, heure de Paris).
- Message de jeu responsable (18+, 09 74 75 13 13) toujours visible, comme dans l'assistant.

## Validation d'une modification

1. `npx tsc --noEmit -p .`
2. `npm test` et, dès que `scripts/betting/` ou l'export sont touchés, `npm run test:data`.
3. `npm run build`, puis supprimer `dist/` et `dist-server/`.
4. Navigateur réel (Playwright, build de production servi par `vite preview`) sur les vraies données (`npm run data:pull`) :
   375, 768 et 1440 px au moins ; aucun débordement horizontal ; états chargement, vide (« Cotes Winamax non disponibles… »,
   « Aucun pari suivi… ») et erreur avec Réessayer ; console sans erreur. Les captures partagées ne montrent **aucune** donnée
   réelle.
5. Contrôle des secrets dans le diff (`ODDSPAPI_API_KEY=`, `AIza`, `ghp_`, `github_pat_`, `sk-ant-api`) et `git status` sans
   `public/data/`, `.research/`, `.env*`.
6. Une mesure sur données réelles avant d'annoncer un effet (nombre de matchs, de sélections, période), sans la coller dans un
   artefact public.
7. Un effet s'annonce par le CLV face à la référence sharp et par le rendement hors échantillon après marge, jamais par des
   soirées gagnantes ni par le rejeu seul.
