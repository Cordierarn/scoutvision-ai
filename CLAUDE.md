# ScoutVision — consignes pour Claude

Plateforme de scouting et de recrutement football fondée sur les données : React 19 + Vite + Tailwind
(racine et `components/`), serveur Node privé (`server/`), pipeline Python (`scripts/`), données privées
PitchAPI. Vue d'ensemble : [README](README.md). État des chantiers et décisions : [roadmap](docs/roadmap.md).

## Règles non négociables

- **Dépôt public.** Aucune donnée privée dans le dépôt, les commits, les PR, les issues, les tests ou les
  captures : noms réels de joueurs ou de clubs, valeurs, cotes, résultats de bankroll, URL de production.
  Tests et exemples : noms fictifs.
- **Données.** `public/data/` est ignoré par Git ; on le remplit avec `npm run data:pull`. Une
  vérification se fait sur les vraies données, jamais sur des données inventées.
- **Secrets.** Côté serveur uniquement (`.env.local`, Config Vars, secrets de workflow), jamais préfixés
  `VITE_`, jamais écrits dans un journal.
- **Le navigateur ne calcule pas les modèles.** Percentiles, indices de rôle, probabilités et projections
  viennent du pipeline ou des artefacts ; une valeur absente vaut `null` et s'affiche « – » ou « N/D ».
- **L'IA rédige, elle ne calcule pas.** Elle reçoit des faits structurés, sa sortie est contrôlée par le
  serveur. Tout changement de prompt incrémente sa version (`PROMPT_VERSION`, `AI_PROMPT_VERSIONS`,
  `BETTING_PROMPT_VERSIONS`) et ajoute un cas de test.
- **Aucun score n'est un verdict.** Un résultat négatif est un résultat valide et reste documenté. Le marché
  de clôture est la référence des prévisions ; la validation est hors échantillon et point-in-time.
- **Langue.** Interface, commits, PR et docs de travail en français ; nombres au format `fr-FR`.

## Méthode de travail (une page ou un module)

1. Audit en lecture seule : constats classés P0 à P3, chacun reproduit sur données réelles.
2. Mesures avant / après (temps, poids, effectifs concernés).
3. Phase fiabilité : calculs, données absentes, populations comparables. Pas d'UX.
4. Phase UX : structure, responsive 320 → 1600 px, clavier, performance. Aucun calcul touché.
5. Contrôle dans un vrai navigateur (build de production).
6. Tests (voir plus bas) et un test de non-régression par bogue confirmé.
7. Passe de fermeture : derniers points, limites documentées.
8. Gel : la page rejoint la liste des pages gelées.

Une page gelée ne change que pour un bogue réel, la régression d'un composant partagé ou une évolution
explicitement demandée. Liste à jour : [`.claude/skills/frontend-quality/SKILL.md`](.claude/skills/frontend-quality/SKILL.md)
(skill à suivre avant toute modification visible). État des autres modules : [roadmap](docs/roadmap.md).

## Carte du dépôt

| Dossier | Contenu |
|---|---|
| `App.tsx`, `components/`, `hooks/`, `utils/`, `services/` | App React ; `components/ui` = primitives partagées |
| `server/` | Serveur privé (session, `/data`, `/cdn`, `/api/*`), fonctions IA (Claude en tête, Gemini en secours) |
| `scripts/` | Pipeline Python : `prepare_data.py`, `models.py`, `lab.py`, `backtest/` (prévisions), `betting/` (Labo paris) |
| `docs/` | Méthodologie, modèles, déploiement, Labo paris |
| `.github/workflows/` | Données (lundi et vendredi), cotes de recherche, cycle quotidien du Labo paris |

## Commandes

```bash
npm run data:pull          # données privées (gh connecté avec accès au dépôt de données)
npm run dev                # http://localhost:3000
npx tsc --noEmit -p .
npm test                   # Vitest
npm run test:data          # Python (unittest)
npm run build              # client + serveur SSR ; supprimer dist/ et dist-server/ ensuite
```

## Livraison

- Un sujet par PR ; un commit ne mélange pas déplacement de fichiers et changement de contenu.
- Si un chiffre, un comportement ou une règle change : mettre à jour la doc concernée (`docs/`, README,
  skill) dans la même PR.
- Correction de CI : reproduire l'étape en local, écrire d'abord un test qui échoue, puis corriger.
- En cas de doute sur le périmètre, demander plutôt que trancher.
