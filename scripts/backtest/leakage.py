"""
Garde-fous anti-fuite et invariants de qualité du dataset point-in-time.

- features_view : vue d'un scénario de décision. En scénario available_snapshot, les colonnes de clôture
  sont physiquement absentes ; y accéder lève LeakageError (test 3).
- FitMetadata : métadonnées d'un ajustement ; fit_end >= prediction_start lève LeakageError (test 4).
- validate : invariants (identité, cibles, score, infinis, sources interdites) ; renvoie la liste des
  violations, vide si le dataset est sain.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from . import replay
from .odds import CLOSING_COLUMNS, ODDS_COLUMNS, PROVIDER_COLUMNS

SCENARIOS = ("available_snapshot", "closing_benchmark")


class LeakageError(RuntimeError):
    """Accès à une information postérieure au cutoff de décision."""


class FeatureFrame:
    """DataFrame en lecture seule limité aux colonnes autorisées du scénario ; toute colonne interdite lève."""

    def __init__(self, df: pd.DataFrame, forbidden: list[str], scenario: str):
        self._df = df.drop(columns=[c for c in forbidden if c in df], errors="ignore")
        self._forbidden = set(forbidden)
        self.scenario = scenario

    @property
    def columns(self) -> list[str]:
        return list(self._df.columns)

    def __getitem__(self, key):
        keys = key if isinstance(key, list) else [key]
        bad = [k for k in keys if k in self._forbidden]
        if bad:
            raise LeakageError(f"scénario {self.scenario} : colonne(s) interdite(s) {bad}")
        return self._df[key]

    def __getattr__(self, name):
        if name in self._forbidden:
            raise LeakageError(f"scénario {self.scenario} : colonne interdite {name}")
        return getattr(self._df, name)

    def to_frame(self) -> pd.DataFrame:
        return self._df.copy()


def features_view(df: pd.DataFrame, scenario: str = "available_snapshot") -> FeatureFrame:
    """Colonnes d'un scénario : identité, features f_*, qualité, et les cotes autorisées. Les cibles sont
    toujours exclues ; en available_snapshot les colonnes de clôture le sont aussi."""
    if scenario not in SCENARIOS:
        raise ValueError(f"scénario inconnu : {scenario}")
    forbidden = list(replay.TARGETS)
    if scenario == "available_snapshot":
        forbidden += CLOSING_COLUMNS
    return FeatureFrame(df, forbidden, scenario)


@dataclass(frozen=True)
class FitMetadata:
    """Fenêtre d'un ajustement (modèle, calibration, seuil) : ce qu'il a vu, et à partir de quand il prédit."""
    name: str
    fit_start: pd.Timestamp
    fit_end: pd.Timestamp            # dernier coup d'envoi vu
    prediction_start: pd.Timestamp   # premier cutoff prédit
    fit_season_end: str | None = None
    prediction_season: str | None = None

    def __post_init__(self):
        if pd.Timestamp(self.fit_end) >= pd.Timestamp(self.prediction_start):
            raise LeakageError(f"{self.name} : fit_end {self.fit_end} >= prediction_start {self.prediction_start}")
        if self.fit_season_end and self.prediction_season and self.fit_season_end >= self.prediction_season:
            raise LeakageError(f"{self.name} : saison d'ajustement {self.fit_season_end} >= saison prédite {self.prediction_season}")


def validate(df: pd.DataFrame) -> list[str]:
    """Invariants du dataset ; liste des violations (vide = sain)."""
    errors = []
    if df["match_id"].duplicated().any():
        errors.append(f"match_id dupliqués : {int(df['match_id'].duplicated().sum())}")
    same = df["home_team_id"] == df["away_team_id"]
    if same.any():
        errors.append(f"équipes identiques : {int(same.sum())}")
    if df["kickoff_utc"].isna().any():
        errors.append("kickoff_utc absent")
    if (df["feature_cutoff"] >= df["kickoff_utc"]).any():
        errors.append("feature_cutoff non strictement antérieur au coup d'envoi")
    hg, ag = df["home_goals"], df["away_goals"]
    expected = np.where(hg > ag, "H", np.where(hg == ag, "D", "A"))
    ok = hg.notna() & ag.notna()
    if (df.loc[ok, "result_1x2"].to_numpy() != expected[ok.to_numpy()]).any():
        errors.append("result_1x2 incompatible avec le score")
    if (df.loc[ok, "over_2_5"].astype(bool).to_numpy() != ((hg + ag) > 2.5)[ok].to_numpy()).any():
        errors.append("over_2_5 incompatible avec le score")
    num = df.select_dtypes(include=[np.number])
    if np.isinf(num.to_numpy(float)).any():
        errors.append("valeur infinie")
    for c in df.columns:
        if df[c].dtype == object and df[c].map(lambda v: not isinstance(v, (str, bool, int, float, type(None))) and not pd.isna(v)).any():
            errors.append(f"objet non sérialisable dans {c}")
    feats = [c for c in df.columns if c.startswith("f_")]
    for c in feats:
        if c in replay.TARGETS or c in ODDS_COLUMNS or c in PROVIDER_COLUMNS:
            errors.append(f"colonne de cible ou de cote dans les features : {c}")
    for c in df.columns:
        low = c.lower()
        if any(s in low for s in ("team_season", "player_season", "rapm", "transfermarkt", "market_value", "lineup")):
            errors.append(f"source interdite : {c}")
    for spec in replay.FEATURES:
        if any(s in spec.source.lower() for s in replay.FORBIDDEN_SOURCES):
            errors.append(f"feature {spec.name} lit une source interdite : {spec.source}")
    return errors
