"""
Elo dynamique reproductible, toutes compétitions (les coupes relient les championnats) :
- note initiale 1500 ; espérance E = 1 / (1 + 10^(-(r_dom + avantage − r_ext) / 400)) ; mise à jour
  r += K · m · (S − E) avec S = 1 / 0,5 / 0 et m = ln(|écart de buts| + 1) si la marge est activée, 1 sinon ;
- régression intersaison : au premier match d'une équipe dans une nouvelle saison, r = 1500 + (1 − ρ)(r − 1500) ;
- lien vers 1-N-2 : régression multinomiale (lab_market.multinomial_fit) de l'issue sur l'écart d'Elo
  avant match, réajustée à chaque fit sur toutes les paires (écart, issue) de l'apprentissage.
L'état est incrémental : fit ne traite que les matchs postérieurs au dernier match déjà intégré, dans
l'ordre des coups d'envoi, et n'utilise jamais un match dont le coup d'envoi atteint context.train_end.

Grille préenregistrée (validation 2024-25 seulement) : ELO_GRID.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

import lab_market
from .base import Context, Model, OUTCOME_INDEX, frame

INITIAL = 1500.0
ELO_GRID = [{"k": k, "home_advantage": h, "season_regression": r, "margin": m}
            for k in (15, 25) for h in (50, 80) for r in (0.0, 0.25) for m in (False, True)]


class Elo(Model):
    model_id = "elo"
    family = "challenger"

    def __init__(self, k: float = 20.0, home_advantage: float = 60.0, season_regression: float = 0.0, margin: bool = False):
        super().__init__(k=k, home_advantage=home_advantage, season_regression=season_regression, margin=margin)
        self.rating: dict[str, float] = {}
        self.last_season: dict[str, str] = {}
        self.last_kickoff: pd.Timestamp | None = None
        self.seen: set[str] = set()
        self.diffs: list[float] = []
        self.outcomes: list[int] = []
        self.w: np.ndarray | None = None

    def _get(self, team: str, season: str) -> float:
        r = self.rating.get(team, INITIAL)
        if self.parameters["season_regression"] and self.last_season.get(team) not in (None, season):
            r = INITIAL + (1 - self.parameters["season_regression"]) * (r - INITIAL)
            self.rating[team] = r
        self.last_season[team] = season
        return r

    def fit(self, train_rows: pd.DataFrame, context: Context) -> None:
        self.trained_until = context.train_end
        new = train_rows[train_rows["kickoff_utc"] < context.train_end]
        if self.last_kickoff is not None:
            new = new[new["kickoff_utc"] >= self.last_kickoff]
        new = new[~new["match_id"].isin(self.seen)].sort_values(["kickoff_utc", "match_id"], kind="stable")
        k, ha, margin = self.parameters["k"], self.parameters["home_advantage"], self.parameters["margin"]
        for r in new.itertuples(index=False):
            rh, ra = self._get(r.home_team_id, r.season), self._get(r.away_team_id, r.season)
            diff = rh + ha - ra
            e = 1 / (1 + 10 ** (-diff / 400))
            s = 1.0 if r.home_goals > r.away_goals else 0.5 if r.home_goals == r.away_goals else 0.0
            m = np.log(abs(r.home_goals - r.away_goals) + 1) if margin else 1.0
            delta = k * m * (s - e)
            self.rating[r.home_team_id] = rh + delta
            self.rating[r.away_team_id] = ra - delta
            self.diffs.append(diff); self.outcomes.append(OUTCOME_INDEX[r.result_1x2])
            self.seen.add(r.match_id); self.last_kickoff = r.kickoff_utc
        if len(self.diffs) >= 200:
            x = np.column_stack([np.ones(len(self.diffs)), np.asarray(self.diffs) / 400])
            self.w = lab_market.multinomial_fit(x, np.asarray(self.outcomes, int), l2=1.0)

    def predict(self, fixtures: pd.DataFrame) -> pd.DataFrame:
        if self.w is None:
            return self.empty(fixtures, "insufficient_training")
        ha = self.parameters["home_advantage"]
        known = fixtures["home_team_id"].isin(self.rating) & fixtures["away_team_id"].isin(self.rating)
        diff = np.array([self.rating.get(h, INITIAL) + ha - self.rating.get(a, INITIAL)
                         for h, a in zip(fixtures["home_team_id"], fixtures["away_team_id"])])
        p = lab_market.multinomial_predict(np.column_stack([np.ones(len(diff)), diff / 400]), self.w)
        p[~known.to_numpy()] = np.nan
        return frame(fixtures, p, reason=np.where(known, None, "unknown_team"))
