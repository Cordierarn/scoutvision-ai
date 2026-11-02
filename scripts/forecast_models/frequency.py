"""
Baselines sans apprentissage.

- LeagueFrequency : fréquences 1-N-2 des matchs antérieurs de la compétition ; repli hiérarchique
  documenté quand l'historique est insuffisant : compétition (≥ min_matches) -> niveau de compétition
  (tier) -> toutes compétitions.
- HomeAdvantage : avantage domicile constant, une seule distribution 1-N-2 pour toutes les compétitions
  (fréquences globales des matchs antérieurs) : baseline distincte, sans spécificité de compétition.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from .base import Context, Model, OUTCOME_INDEX, frame


def _counts(rows: pd.DataFrame) -> np.ndarray:
    idx = rows["result_1x2"].map(OUTCOME_INDEX).dropna().astype(int).to_numpy()
    return np.bincount(idx, minlength=3).astype(float)


class LeagueFrequency(Model):
    model_id = "league_frequency"
    family = "baseline"

    def __init__(self, min_matches: int = 100, prior: float = 1.0):
        super().__init__(min_matches=min_matches, prior=prior)
        self.by_comp: dict[str, np.ndarray] = {}
        self.by_tier: dict[int, np.ndarray] = {}
        self.overall = np.ones(3)
        self.tiers: dict[str, int] = {}

    def fit(self, train_rows: pd.DataFrame, context: Context) -> None:
        self.trained_until = context.train_end
        self.tiers = dict(context.competition_tiers)
        self.by_comp = {c: _counts(g) for c, g in train_rows.groupby("competition")}
        self.by_tier = {}
        for c, n in self.by_comp.items():
            t = self.tiers.get(c, 0)
            self.by_tier[t] = self.by_tier.get(t, np.zeros(3)) + n
        self.overall = _counts(train_rows)

    def level(self, competition: str) -> tuple[np.ndarray, str]:
        n = self.by_comp.get(competition)
        if n is not None and n.sum() >= self.parameters["min_matches"]:
            return n, "competition"
        t = self.by_tier.get(self.tiers.get(competition, 0))
        if t is not None and t.sum() >= self.parameters["min_matches"]:
            return t, "tier"
        return self.overall, "global"

    def predict(self, fixtures: pd.DataFrame) -> pd.DataFrame:
        prior = self.parameters["prior"]
        p = np.zeros((len(fixtures), 3)); reason = np.full(len(fixtures), None, dtype=object)
        for i, c in enumerate(fixtures["competition"].to_numpy()):
            n, lvl = self.level(c)
            if n.sum() == 0:
                reason[i] = "no_history"; p[i] = np.nan
                continue
            p[i] = (n + prior) / (n.sum() + 3 * prior)
        return frame(fixtures, p, reason=reason)


class HomeAdvantage(Model):
    model_id = "home_advantage"
    family = "baseline"

    def __init__(self, prior: float = 1.0):
        super().__init__(prior=prior)
        self.overall = np.ones(3)

    def fit(self, train_rows: pd.DataFrame, context: Context) -> None:
        self.trained_until = context.train_end
        self.overall = _counts(train_rows)

    def predict(self, fixtures: pd.DataFrame) -> pd.DataFrame:
        n = self.overall
        if n.sum() == 0:
            return self.empty(fixtures, "no_history")
        p = np.tile((n + self.parameters["prior"]) / (n.sum() + 3 * self.parameters["prior"]), (len(fixtures), 1))
        return frame(fixtures, p)
