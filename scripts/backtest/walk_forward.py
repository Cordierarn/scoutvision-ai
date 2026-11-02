"""
Moteur walk-forward : refit hebdomadaire, apprentissage sur les seuls matchs dont le coup d'envoi est
strictement antérieur au début de la semaine, prédiction des matchs de la semaine, prédictions
écrites avant toute lecture des résultats (les cibles ne sont jamais transmises au predict).
Fenêtre expansive par défaut ; `window_days` prépare la fenêtre glissante (730 j) sans la multiplier.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from forecast_models.base import Context, Model, PROB_COLUMNS, GOAL_COLUMNS, check_probabilities
from .leakage import LeakageError
from . import replay

PREDICTION_COLUMNS = ["match_id", "model_id", "model_version", "parameters_hash", "fitted_at", "prediction_created_at", "input_hash",
                      "p_home", "p_draw", "p_away", "expected_goals_home", "expected_goals_away", "p_over_2_5"]


@dataclass
class RunReport:
    model: dict
    weeks: int = 0
    fixtures: int = 0
    predicted: int = 0
    reasons: dict = field(default_factory=dict)
    fit_seconds: float = 0.0
    predict_seconds: float = 0.0
    by_competition: dict = field(default_factory=dict)
    by_season: dict = field(default_factory=dict)


def run(model: Model, dataset: pd.DataFrame, start: pd.Timestamp, end: pd.Timestamp, input_hash: str,
        step_days: int = 7, window_days: int | None = None, context_extra: dict | None = None,
        created_at: pd.Timestamp | None = None) -> tuple[pd.DataFrame, RunReport]:
    """Prédictions de `model` pour tous les matchs utilisables de [start, end), semaine par semaine."""
    rows = replay.canonical(dataset[dataset["usable_for_model"]])
    created = (created_at or pd.Timestamp.now("UTC").tz_localize(None)).isoformat(timespec="seconds")
    report = RunReport(model=model.metadata())
    out = []
    kick = rows["kickoff_utc"].to_numpy()
    feature_cols = [c for c in rows.columns if c not in replay.TARGETS]          # les cibles ne sortent jamais du passé
    for t in pd.date_range(start, end, freq=f"{step_days}D"):
        t_end = min(t + pd.Timedelta(days=step_days), end)
        fx_mask = (kick >= np.datetime64(t)) & (kick < np.datetime64(t_end))
        if not fx_mask.any():
            continue
        tr_mask = kick < np.datetime64(t)
        if window_days is not None:
            tr_mask &= kick >= np.datetime64(t - pd.Timedelta(days=window_days))
        train, fixtures = rows[tr_mask], rows.loc[fx_mask, feature_cols]
        if len(train) and train["kickoff_utc"].max() >= t:
            raise LeakageError("apprentissage avec un match postérieur ou égal au début de la semaine")
        t0 = time.time()
        model.fit(train, Context(train_end=t, **(context_extra or {})))
        report.fit_seconds += time.time() - t0
        t0 = time.time()
        pred = model.predict(fixtures)
        report.predict_seconds += time.time() - t0
        errors = check_probabilities(pred)
        if errors:
            raise ValueError(f"{model.model_id} : {errors}")
        pred["fitted_at"] = t
        report.weeks += 1; report.fixtures += len(fixtures); report.predicted += int(pred["reason"].isna().sum())
        for r, n in pred["reason"].dropna().value_counts().items():
            report.reasons[r] = report.reasons.get(r, 0) + int(n)
        pred = pred.merge(rows.loc[fx_mask, ["match_id", "competition", "season"]], on="match_id")
        out.append(pred)
    if not out:
        return pd.DataFrame(columns=PREDICTION_COLUMNS), report
    df = pd.concat(out, ignore_index=True)
    done = df[df["reason"].isna()]
    for key, attr in (("competition", "by_competition"), ("season", "by_season")):
        total = df.groupby(key).size(); got = done.groupby(key).size()
        setattr(report, attr, {k: {"fixtures": int(v), "predicted": int(got.get(k, 0))} for k, v in total.items()})
    meta = model.metadata()
    done = done.assign(model_id=meta["model_id"], model_version=meta["model_version"], parameters_hash=meta["parameters_hash"],
                       prediction_created_at=created, input_hash=input_hash)
    if "p_over_2_5" not in done:
        done["p_over_2_5"] = np.nan
    return done[PREDICTION_COLUMNS].reset_index(drop=True), report
