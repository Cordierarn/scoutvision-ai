---
name: frontend-quality
description: Règles de qualité frontend propres à ScoutVision (React 19, Tailwind à jetons, composants components/ui). À suivre avant de modifier une page, un composant partagé ou un jeton de style, et pour valider une modification visible.
---

# Qualité frontend ScoutVision

## Pages gelées
Layout / navigation, Base joueurs, Fiche joueur et Chasseur de pépites sont validés et gelés : n'y toucher que pour un bug réel ou la régression d'un composant partagé.

## Périmètre et méthode
- Mesurer avant de corriger. Classer P0 à P3 et ne présenter comme confirmé que ce qui a été reproduit dans un vrai navigateur, sur les vraies données (`npm run data:pull`). Aucune donnée fictive.
- Une passe qualité ne change pas l'apparence (pas de redesign) et ne touche ni aux modèles statistiques, ni à `utils/rolePresets.ts`, ni au pipeline Python, ni à `server/` (rapports Gemini).
- Pas de nouvelle dépendance UI. Réutiliser `components/ui` (Panel, Stat, StatStrip, Delta, LoadError, EmptyState, Skeleton…) et les jetons de `styles/index.css` / `tailwind.config.js`. Pas de couleur codée en dur hors `theme/`.
- Un composant de `components/ui` sert à des pages hors périmètre : après l'avoir modifié, vérifier aussi Analyse d'équipe et Recrutement (bandeaux flex de `Stat`).

## Règles établies
- **Lignes de tableau cliquables** (Base joueurs, Chasseur) : `onKeyDown` passe par `isRowActivation` (`utils/rowKeys.ts`). Sans ce garde, Entrée/Espace sur un bouton de la ligne (étoile, décomposition) ouvre la fiche au lieu d'agir.
- **Contraste** : tout jeton de texte, `ink-4` compris, reste ≥ 4,5:1 sur `canvas`, `surface` et `raised`. Recalculer le ratio avant de modifier un jeton et mettre `docs/design-system.md` à jour.
- **Texte dans les tuiles** : sous `xl`, les libellés passent à la ligne au lieu d'être tronqués. Pas de `min-w-0` sur le libellé dans un bandeau flex, sinon les mots sont coupés en deux (« JOUE/URS »). `break-words` sert seulement de dernier recours dans une grille. Un texte tronqué doit avoir un `title`.
- **Format français** : nombres via `toLocaleString('fr-FR')` ou un `Intl.NumberFormat` mis en cache au niveau du module ; écarts signés via `formatDelta` (« +0,34 », « −2 »). Ne pas appeler `toLocaleString` dans une boucle de cellules.
  Montants via `formatEuro` (`utils/format.ts`, « 1,8 M€ », « 850 k€ ») : pas de formateur local par page.
- **Couleurs** : le cyan marque l'accent, la sélection, le tri et les percentiles élite. Une colonne de données (valeur, minutes) reste en encre neutre. Orange = avertissement, rouge = constat défavorable, vert = progression.
- **Texte qui ne tient pas** : revoir la structure avant d'ajouter du `break-words` (lignes sémantiques séparées, moins de colonnes sous `sm`). Mesurer la largeur réelle de la tuile à 320 px : une grille de 3 tuiles y laisse ~45 px.
- **Radars sur téléphone** : la largeur vient de `ResponsiveContainer onResize` ; sous 340 px rayon réduit, sous 260 px libellés `/90` sur trois lignes coupées entre les mots (`PolarTick maxLines`). Jamais de police réduite ni de libellé masqué.
- **Tableaux `.sv-table`** : une colonne numérique met `text-right` sur le `th` et les `td` ; l'en-tête s'aligne alors sur les chiffres.
- **Performance React** : `useTransition` ou `useDeferredValue` seulement après une mesure avant/après. Mesuré ici : la transition sur le retour de fiche fait passer l'INP de ~1,5 s à ~50 ms, mais des transitions sur la navigation et l'ouverture de fiche retardent l'affichage (de 1,4 s à 3,6 s). Clés React stables (identifiant joueur-saison, jamais l'index). Pas de `React.memo`/`useMemo` systématique, pas de virtualisation sans profil qui la justifie.
- **États** : chaque chargement asynchrone a un état de chargement (jamais « Aucune donnée » pendant le chargement), une erreur `LoadError` (`role="alert"`, bouton Réessayer) et un état vide qui explique pourquoi.
- **Mouvement** : les animations respectent `prefers-reduced-motion` (règle globale dans `styles/index.css`) ; ne pas la contourner avec un style en ligne.

## Validation d'une modification visible
1. `npx tsc --noEmit -p .`
2. `npm test`, et `npm run test:data` si des données ou des modèles sont concernés.
3. `npm run build`, puis supprimer `dist/`.
4. Navigateur réel (bibliothèque Playwright, build de production servi par `vite preview`) : largeurs 375, 390, 768, 1024, 1440 et 1600, zoom 200 % ; navigation au clavier seul ; mouvement réduit ; console sans erreur ; aucun échec réseau ; états chargement, vide et erreur avec Réessayer.
5. Test de non-régression Vitest pour chaque bogue confirmé quand la logique est extractible (pas d'instantanés massifs).
