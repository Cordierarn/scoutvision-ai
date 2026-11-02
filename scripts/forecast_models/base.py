"""
Interface des modèles de prévision et utilitaires partagés (probabilités, matrice de scores).

Un modèle est ajusté sur des lignes d'apprentissage (MatchReplayRow, coups d'envoi strictement
antérieurs à context.train_end) puis prédit des fixtures (mêmes colonnes, cibles ignorées). Il
renvoie une ligne par fixture : p_home, p_draw, p_away (somme 1, bornées, finies), expected_goals_*
quand il en produit, et `reason` (None si prévu, sinon la raison de l'absence de prévision).
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

import models as sv_models          # scripts/models.py : _poisson_pmf, _dc_tau (formules non dupliquées)

PROB_COLUMNS = ["p_home", "p_draw", "p_away"]
GOAL_COLUMNS = ["expected_goals_home", "expected_goals_away"]
MAX_GOALS = 10
OUTCOME_INDEX = {"H": 0, "D": 1, "A": 2}


@dataclass
class Context:
    """Ce que le moteur walk-forward transmet au modèle : fin d'apprentissage (exclusive) et métadonnées."""
    train_end: pd.Timestamp
    competition_tiers: dict[str, int] = field(default_factory=dict)
    seed: int = 7


class Model:
    model_id: str = "base"
    model_version: str = "1.0.0"
    uses_xg: bool = False
    uses_odds: bool = False
    family: str = "baseline"

    def __init__(self, **parameters):
        self.parameters = parameters
        self.trained_until: pd.Timestamp | None = None

    def fit(self, train_rows: pd.DataFrame, context: Context) -> None:
        raise NotImplementedError

    def predict(self, fixtures: pd.DataFrame) -> pd.DataFrame:
        raise NotImplementedError

    def metadata(self) -> dict:
        return {"model_id": self.model_id, "model_version": self.model_version, "family": self.family,
                "trained_until": None if self.trained_until is None else pd.Timestamp(self.trained_until).isoformat(),
                "uses_xg": self.uses_xg, "uses_odds": self.uses_odds, "parameters": self.parameters,
                "parameters_hash": parameters_hash(self.parameters)}

    def empty(self, fixtures: pd.DataFrame, reason: str) -> pd.DataFrame:
        return pd.DataFrame({"match_id": fixtures["match_id"].to_numpy(), "p_home": np.nan, "p_draw": np.nan, "p_away": np.nan,
                             "expected_goals_home": np.nan, "expected_goals_away": np.nan, "reason": reason})


def parameters_hash(parameters: dict) -> str:
    return hashlib.sha256(json.dumps(parameters, sort_keys=True, default=str).encode()).hexdigest()[:16]


def frame(fixtures: pd.DataFrame, p: np.ndarray, goals: np.ndarray | None = None, reason: np.ndarray | None = None) -> pd.DataFrame:
    """Résultat standard d'un predict : probabilités renormalisées, buts attendus, raison d'absence."""
    p = np.asarray(p, float)
    ok = np.isfinite(p).all(axis=1) & (p >= 0).all(axis=1) & (p.sum(axis=1) > 0)
    norm = np.full_like(p, np.nan)
    norm[ok] = p[ok] / p[ok].sum(axis=1, keepdims=True)
    out = pd.DataFrame({"match_id": fixtures["match_id"].to_numpy(), "p_home": norm[:, 0], "p_draw": norm[:, 1], "p_away": norm[:, 2]})
    if goals is None:
        out["expected_goals_home"] = np.nan; out["expected_goals_away"] = np.nan
    else:
        g = np.asarray(goals, float)
        out["expected_goals_home"] = np.where(ok, g[:, 0], np.nan); out["expected_goals_away"] = np.where(ok, g[:, 1], np.nan)
    r = np.full(len(out), None, dtype=object) if reason is None else np.asarray(reason, dtype=object)
    r = np.where(ok, None, np.where(pd.isna(r), "no_prediction", r))
    out["reason"] = r
    return out


def check_probabilities(pred: pd.DataFrame) -> list[str]:
    """Invariants d'un bloc de prévisions : somme 1, bornes, finitude (lignes prévues seulement)."""
    errors = []
    p = pred[PROB_COLUMNS].to_numpy(float)
    done = pred["reason"].isna().to_numpy() if "reason" in pred else np.ones(len(pred), bool)
    q = p[done]
    if not np.isfinite(q).all():
        errors.append("probabilité non finie")
    if ((q < 0) | (q > 1)).any():
        errors.append("probabilité hors [0, 1]")
    if (np.abs(q.sum(axis=1) - 1) > 1e-9).any():
        errors.append("somme des probabilités différente de 1")
    if np.isfinite(p[~done]).any():
        errors.append("ligne sans prévision avec des probabilités")
    g = pred[GOAL_COLUMNS].to_numpy(float)
    if (np.isinf(g)).any() or (g[np.isfinite(g)] < 0).any():
        errors.append("buts attendus invalides")
    return errors


def score_matrix(lh: float, la: float, rho: float = 0.0, max_goals: int = MAX_GOALS) -> tuple[np.ndarray, float]:
    """Matrice des scores (domicile en lignes) Poisson avec correction Dixon-Coles ; renvoie aussi la masse
    hors grille (contrôle : doit rester négligeable)."""
    g = np.arange(max_goals + 1)
    x, y = np.meshgrid(g, g, indexing="ij")
    m = sv_models._poisson_pmf(x, np.full(x.shape, lh)) * sv_models._poisson_pmf(y, np.full(y.shape, la))
    m = m * sv_models._dc_tau(x, y, np.full(x.shape, lh), np.full(x.shape, la), rho)
    total = float(m.sum())
    return m / total, 1.0 - total


def outcome_probabilities(lh: np.ndarray, la: np.ndarray, rho: float = 0.0) -> tuple[np.ndarray, np.ndarray, float]:
    """1-N-2 et P(plus de 2,5 buts) pour des vecteurs de buts attendus ; masse résiduelle maximale observée."""
    n = len(lh)
    p = np.full((n, 3), np.nan); over = np.full(n, np.nan); worst = 0.0
    g = np.arange(MAX_GOALS + 1)
    total = g[:, None] + g[None, :]
    for i in range(n):
        if not (np.isfinite(lh[i]) and np.isfinite(la[i])):
            continue
        m, residual = score_matrix(float(lh[i]), float(la[i]), rho)
        worst = max(worst, residual)
        p[i] = [np.tril(m, -1).sum(), np.trace(m), np.triu(m, 1).sum()]
        over[i] = m[total > 2.5].sum()
    return p, over, worst


def team_history(train_rows: pd.DataFrame) -> pd.DataFrame:
    """Une ligne par équipe et par match d'apprentissage (buts, xG pour / contre), triée par coup d'envoi."""
    cols = ["match_id", "competition", "season", "kickoff_utc"]
    home = train_rows[cols].assign(team_id=train_rows["home_team_id"], gf=train_rows["home_goals"], ga=train_rows["away_goals"],
                                   xg_for=train_rows["home_xg"], xg_against=train_rows["away_xg"], is_home=True)
    away = train_rows[cols].assign(team_id=train_rows["away_team_id"], gf=train_rows["away_goals"], ga=train_rows["home_goals"],
                                   xg_for=train_rows["away_xg"], xg_against=train_rows["home_xg"], is_home=False)
    return pd.concat([home, away], ignore_index=True).sort_values(["team_id", "kickoff_utc", "match_id"], kind="stable")
