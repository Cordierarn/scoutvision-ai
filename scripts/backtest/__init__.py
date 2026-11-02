"""
ScoutVision AI - Recherche prévision : dataset point-in-time (étape 1).

Modules :
  standings.py  classement reconstruit avant chaque match, à partir des seuls résultats antérieurs
  replay.py     MatchReplayRow : identité, cibles, features pré-match, cotes, qualité ; registre des features
  odds.py       adaptateur football-data.co.uk (fichiers principaux et « new »), sémantique des cotes
  leakage.py    garde-fous anti-fuite (vue sans clôture, métadonnées d'ajustement) et invariants de qualité
  manifest.py   hash des entrées, manifeste de couverture et d'exclusions

Aucun modèle, aucun backtest de rentabilité : le dataset décrit le monde tel qu'il était avant chaque match.
"""

SCHEMA_VERSION = "1.0.0"
