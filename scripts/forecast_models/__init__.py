"""
ScoutVision AI - Recherche prévision, étape 2A : baselines sportives (aucune cote, aucun pari).

Interface unique (base.Model) : fit(train_rows, context) puis predict(fixtures) -> p_home, p_draw, p_away
(+ expected_goals_home / expected_goals_away quand le modèle en produit). Les familles :
  frequency.py   fréquences de la compétition (repli hiérarchique) ; avantage domicile constant global
  form.py        régression multinomiale ridge sur les features point-in-time (forme ; classement / points par match)
  elo.py         Elo dynamique (K, avantage domicile, régression intersaison, marge de victoire), lien logistique
  poisson.py     Poisson indépendant, Dixon-Coles, Dixon-Coles à décroissance temporelle (buts seulement)
  xg.py          forces attaque / défense sur les xG glissants des matchs passés
  scoutvision.py prévisions stockées du pipeline (forecast_backtest) et reproduction par models.fit_joint
"""
