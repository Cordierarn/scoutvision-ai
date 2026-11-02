"""
Régression multinomiale ridge (NumPy, lab_market.multinomial_fit réutilisé) sur des écarts de features
point-in-time du dataset (domicile − extérieur), standardisés sur l'apprentissage. Deux instances :
- form_ridge : forme (points, xG, buts sur 5 / 10 matchs), classement / points par match, repos, congestion ;
- standings_ppm : classement et points par match seulement.
Une fixture dont une feature manque n'est pas prévue (raison missing_features).
"""

from __future__ import annotations

import numpy as np
import pandas as pd

import lab_market
from .base import Context, Model, OUTCOME_INDEX, frame

FORM_FEATURES = ["points_last5", "xg_for_last5", "xg_against_last5", "xg_for_last10", "xg_against_last10", "goals_for_last5",
                 "goals_against_last5", "points_per_match", "rank", "rest_days", "matches_last8d"]
STANDINGS_FEATURES = ["points_per_match", "rank", "played"]


class FeatureRidge(Model):
    family = "baseline"

    def __init__(self, model_id: str, features: list[str], l2: float = 1.0, uses_xg: bool = False):
        super().__init__(features=list(features), l2=l2)
        self.model_id = model_id
        self.uses_xg = uses_xg
        self.w: np.ndarray | None = None
        self.mu = self.sd = None

    def _design(self, rows: pd.DataFrame) -> np.ndarray:
        x = np.column_stack([rows[f"f_home_{f}"].to_numpy(float) - rows[f"f_away_{f}"].to_numpy(float) for f in self.parameters["features"]])
        return x

    def fit(self, train_rows: pd.DataFrame, context: Context) -> None:
        self.trained_until = context.train_end
        x = self._design(train_rows)
        y = train_rows["result_1x2"].map(OUTCOME_INDEX).to_numpy(float)
        ok = np.isfinite(x).all(axis=1) & np.isfinite(y)
        if ok.sum() < 200:
            self.w = None
            return
        self.mu, self.sd = x[ok].mean(axis=0), x[ok].std(axis=0)
        self.sd = np.where(self.sd > 0, self.sd, 1.0)
        z = np.column_stack([np.ones(ok.sum()), (x[ok] - self.mu) / self.sd])
        self.w = lab_market.multinomial_fit(z, y[ok].astype(int), l2=self.parameters["l2"])

    def predict(self, fixtures: pd.DataFrame) -> pd.DataFrame:
        if self.w is None:
            return self.empty(fixtures, "insufficient_training")
        x = self._design(fixtures)
        ok = np.isfinite(x).all(axis=1)
        p = np.full((len(fixtures), 3), np.nan)
        if ok.any():
            z = np.column_stack([np.ones(ok.sum()), (x[ok] - self.mu) / self.sd])
            p[ok] = lab_market.multinomial_predict(z, self.w)
        return frame(fixtures, p, reason=np.where(ok, None, "missing_features"))


def form_model(l2: float = 1.0) -> FeatureRidge:
    return FeatureRidge("form_ridge", FORM_FEATURES, l2=l2, uses_xg=True)


def standings_model(l2: float = 1.0) -> FeatureRidge:
    return FeatureRidge("standings_ppm", STANDINGS_FEATURES, l2=l2)
