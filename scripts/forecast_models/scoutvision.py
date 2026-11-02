"""
Le modèle ScoutVision, deux objets distincts :
- ScoutVisionReproduced (« ScoutVision reproduced forecast ») : models.fit_joint (modèle conjoint toutes
  compétitions, cible mi-buts mi-xG, niveaux de championnat, Dixon-Coles, demi-vie 180 j) réajusté
  chaque semaine sur une fenêtre de 730 jours comme en production. Reproduction : mêmes fonctions,
  mais ni les mêmes données brutes ni la même date de fabrication que le pipeline PitchAPI.
- ScoutVisionStored (« ScoutVision stored forecast ») : les probabilités réellement publiées dans
  reports/forecast_backtest.csv (variante mélange), lues telles quelles ; pas de fit, période limitée.
"""

from __future__ import annotations

import io
import tarfile
from pathlib import Path

import numpy as np
import pandas as pd

import lab_market
import models as sv_models
from .base import Context, Model, frame

WINDOW_DAYS = 730


class ScoutVisionReproduced(Model):
    model_id = "scoutvision_reproduced"
    family = "challenger"
    uses_xg = True

    def __init__(self, window_days: int = WINDOW_DAYS, half_life: float = 180.0):
        super().__init__(window_days=window_days, half_life=half_life, target="0.5 goals + 0.5 xG", source="models.fit_joint")
        self.model = None

    def fit(self, train_rows: pd.DataFrame, context: Context) -> None:
        self.trained_until = context.train_end
        t = train_rows[train_rows["kickoff_utc"] >= context.train_end - pd.Timedelta(days=self.parameters["window_days"])]
        if len(t) < 500:
            self.model = None
            return
        mf = pd.DataFrame({"date": t["kickoff_utc"], "home": t["home_team_id"], "away": t["away_team_id"],
                           "goals_home": t["home_goals"], "goals_away": t["away_goals"], "xg_home": t["home_xg"], "xg_away": t["away_xg"],
                           "comp": t["competition"], "competition": t["competition"],
                           "league": t["stage"].isin(["regular_season", "playoffs"])})
        team_league = lab_market.domestic_leagues(mf)
        self.model = sv_models.fit_joint(mf, team_league, context.train_end, half_life=self.parameters["half_life"])

    def predict(self, fixtures: pd.DataFrame) -> pd.DataFrame:
        if self.model is None:
            return self.empty(fixtures, "insufficient_training")
        n = len(fixtures); p = np.full((n, 3), np.nan); g = np.full((n, 2), np.nan); reason = np.full(n, None, dtype=object)
        for i, (h, a) in enumerate(zip(fixtures["home_team_id"], fixtures["away_team_id"])):
            pr = self.model.probabilities(h, a)
            if pr is None:
                reason[i] = "unknown_team"; continue
            p[i] = pr; g[i] = self.model.rates(h, a)
        out = frame(fixtures, p, goals=g, reason=reason)
        return out


def load_stored(cache_dir: Path) -> pd.DataFrame:
    """Prévisions stockées du pipeline : match_id, p_home, p_draw, p_away, date (fabrication non datée)."""
    path = cache_dir / "data-v2-current" / "global.tar"
    with tarfile.open(path) as tar:
        names = set(tar.getnames())
        if "reports/forecast_backtest.csv" not in names:
            return pd.DataFrame()
        df = pd.read_csv(io.BytesIO(tar.extractfile("reports/forecast_backtest.csv").read()))
    return df[["match_id", "date", "p_home", "p_draw", "p_away", "league_key"]]


class ScoutVisionStored(Model):
    """Pas un modèle ajusté : des prévisions déjà fabriquées, jointes par match_id."""
    model_id = "scoutvision_stored"
    family = "challenger"
    uses_xg = True

    def __init__(self, stored: pd.DataFrame):
        super().__init__(source="reports/forecast_backtest.csv (variante mélange)", fabrication_date="unknown (pipeline run)")
        self.stored = stored.set_index("match_id") if len(stored) else stored

    def fit(self, train_rows: pd.DataFrame, context: Context) -> None:
        self.trained_until = context.train_end

    def predict(self, fixtures: pd.DataFrame) -> pd.DataFrame:
        if len(self.stored) == 0:
            return self.empty(fixtures, "no_stored_forecast")
        s = self.stored.reindex(fixtures["match_id"])
        p = s[["p_home", "p_draw", "p_away"]].to_numpy(float)
        ok = np.isfinite(p).all(axis=1)
        return frame(fixtures, p, reason=np.where(ok, None, "not_in_stored_forecast"))
