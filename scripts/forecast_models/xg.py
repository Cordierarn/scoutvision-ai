"""
Forces attaque / défense sur les xG glissants des matchs passés (jamais l'xG du match prédit) :
att = moyenne des xG pour sur les N derniers matchs de l'équipe dans la compétition, def = moyenne des
xG contre ; buts attendus λ_dom = f_dom · att_dom · def_ext / μ, λ_ext = f_ext · att_ext · def_dom / μ, avec
μ = xG moyen par équipe-match de la compétition et f_dom / f_ext les ratios domicile / extérieur de la
compétition (apprentissage) ; puis matrice de scores Poisson (rho = 0). Fenêtre N parmi WINDOW_GRID,
choisie sur la validation 2024-25 seulement.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from .base import Context, Model, frame, outcome_probabilities, team_history

WINDOW_GRID = [5, 10, 20]


class RollingXG(Model):
    model_id = "xg_rolling"
    family = "challenger"
    uses_xg = True

    def __init__(self, window: int = 10):
        super().__init__(window=window, min_periods=max(3, window // 2))
        self.strength: dict[tuple[str, str], tuple[float, float, int]] = {}
        self.comp: dict[str, tuple[float, float, float]] = {}

    def fit(self, train_rows: pd.DataFrame, context: Context) -> None:
        self.trained_until = context.train_end
        t = train_rows.dropna(subset=["home_xg", "away_xg"])
        self.comp = {}
        for c, g in t.groupby("competition"):
            mu = float(pd.concat([g["home_xg"], g["away_xg"]]).mean())
            self.comp[c] = (mu, float(g["home_xg"].mean()) / mu if mu > 0 else 1.0, float(g["away_xg"].mean()) / mu if mu > 0 else 1.0)
        h = team_history(t)
        n = self.parameters["window"]
        last = h.groupby(["team_id", "competition"], sort=False).tail(n)
        agg = last.groupby(["team_id", "competition"]).agg(att=("xg_for", "mean"), dfn=("xg_against", "mean"), n=("match_id", "size"))
        self.strength = {k: (float(v.att), float(v.dfn), int(v.n)) for k, v in agg.iterrows()}

    def predict(self, fixtures: pd.DataFrame) -> pd.DataFrame:
        n = len(fixtures); lh = np.full(n, np.nan); la = np.full(n, np.nan); reason = np.full(n, None, dtype=object)
        mp = self.parameters["min_periods"]
        for i, r in enumerate(fixtures[["competition", "home_team_id", "away_team_id"]].itertuples(index=False)):
            c = self.comp.get(r.competition)
            sh, sa = self.strength.get((r.home_team_id, r.competition)), self.strength.get((r.away_team_id, r.competition))
            if c is None or sh is None or sa is None:
                reason[i] = "unknown_team"; continue
            if sh[2] < mp or sa[2] < mp:
                reason[i] = "insufficient_history"; continue
            mu, fh, fa = c
            lh[i] = fh * sh[0] * sa[1] / mu; la[i] = fa * sa[0] * sh[1] / mu
        p, over, _ = outcome_probabilities(lh, la, 0.0)
        out = frame(fixtures, p, goals=np.column_stack([lh, la]), reason=reason)
        out["p_over_2_5"] = over
        return out
