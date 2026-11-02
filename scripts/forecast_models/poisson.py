"""
Modèles de buts (buts seulement, aucune cote) : forces attaque / défense par équipe et avantage
domicile, ajustés sur le passé par balayages de Newton (même schéma que models.fit_joint, sans niveaux
de championnat ni cible xG), puis matrice de scores 0–10 (base.score_matrix, formules de models.py) ->
1-N-2 et plus / moins 2,5.

- Poisson : indépendant (rho = 0), sans décroissance ;
- DixonColes : rho estimé par maximum de vraisemblance sur l'apprentissage (grille −0,25 … 0,10) ;
- DixonColesDecay : même chose avec poids 0,5^(âge / demi-vie) ; demi-vie choisie sur la validation
  2024-25 parmi HALF_LIFE_GRID, jamais sur 2025-26.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

import models as sv_models
from .base import Context, Model, frame, outcome_probabilities

HALF_LIFE_GRID = [90, 180, 365]
RHO_GRID = np.arange(-0.25, 0.11, 0.01)


def fit_rates(train: pd.DataFrame, at: pd.Timestamp, half_life: float | None, ridge: float = 2.0, sweeps: int = 60) -> dict:
    """Forces log-linéaires : log λ = mu + h·domicile + att_i − def_j, pénalité ridge vers 0, poids temporels."""
    m = train.dropna(subset=["home_goals", "away_goals"])
    teams = sorted(set(m["home_team_id"]) | set(m["away_team_id"]))
    idx = {t: k for k, t in enumerate(teams)}
    hi, ai = m["home_team_id"].map(idx).to_numpy(), m["away_team_id"].map(idx).to_numpy()
    yh, ya = m["home_goals"].to_numpy(float), m["away_goals"].to_numpy(float)
    age = (at - m["kickoff_utc"]).dt.total_seconds().to_numpy() / 86400
    w1 = np.ones(len(m)) if half_life is None else 0.5 ** (age / half_life)
    att = np.concatenate([hi, ai]); dfn = np.concatenate([ai, hi])
    home = np.concatenate([np.ones(len(m)), np.zeros(len(m))])
    y = np.concatenate([yh, ya]); w = np.concatenate([w1, w1])
    nt = len(teams)
    p = {"mu": float(np.log(max(np.average(y, weights=w), 1e-3))), "h": 0.0, "a": np.zeros(nt), "d": np.zeros(nt)}

    def lam():
        return np.exp(p["mu"] + p["h"] * home + p["a"][att] - p["d"][dfn])

    def newton(index, sign, value):
        r = w * (y - lam())
        g = sign * np.bincount(index, r, nt) - ridge * value
        hss = np.bincount(index, w * lam(), nt) + ridge
        return value + g / hss

    for _ in range(sweeps):
        lm = lam(); p["mu"] += (w * (y - lm)).sum() / (w * lm).sum()
        lm = lam(); p["h"] += (w * home * (y - lm)).sum() / max((w * home * lm).sum(), 1e-9)
        p["a"] = newton(att, 1, p["a"]); p["d"] = newton(dfn, -1, p["d"])
        p["a"] -= p["a"].mean(); p["d"] -= p["d"].mean()
    lh, la = lam()[: len(m)], lam()[len(m):]
    return {"teams": idx, "mu": p["mu"], "h": p["h"], "a": p["a"], "d": p["d"], "lh": lh, "la": la, "w": w1,
            "gh": yh.astype(int), "ga": ya.astype(int)}


def fit_rho(fit: dict) -> float:
    """rho de Dixon-Coles par maximum de vraisemblance pondérée sur les scores d'apprentissage."""
    best = (0.0, -np.inf)
    for rho in RHO_GRID:
        tau = sv_models._dc_tau(fit["gh"], fit["ga"], fit["lh"], fit["la"], rho)
        if (tau <= 0).any():
            continue
        ll = (fit["w"] * np.log(tau)).sum()
        if ll > best[1]:
            best = (float(rho), ll)
    return best[0]


class Poisson(Model):
    model_id = "poisson"
    family = "challenger"

    def __init__(self, half_life: float | None = None, dixon_coles: bool = False, ridge: float = 2.0, min_matches: int = 500):
        super().__init__(half_life=half_life, dixon_coles=dixon_coles, ridge=ridge, min_matches=min_matches)
        self.fit_: dict | None = None
        self.rho = 0.0
        self.residual_mass = 0.0

    def fit(self, train_rows: pd.DataFrame, context: Context) -> None:
        self.trained_until = context.train_end
        if len(train_rows) < self.parameters["min_matches"]:
            self.fit_ = None
            return
        self.fit_ = fit_rates(train_rows, context.train_end, self.parameters["half_life"], self.parameters["ridge"])
        self.rho = fit_rho(self.fit_) if self.parameters["dixon_coles"] else 0.0

    def rates(self, fixtures: pd.DataFrame) -> tuple[np.ndarray, np.ndarray]:
        f = self.fit_
        h = fixtures["home_team_id"].map(f["teams"]); a = fixtures["away_team_id"].map(f["teams"])
        ok = h.notna() & a.notna()
        lh = np.full(len(fixtures), np.nan); la = np.full(len(fixtures), np.nan)
        hi, ai = h[ok].astype(int).to_numpy(), a[ok].astype(int).to_numpy()
        lh[ok.to_numpy()] = np.exp(f["mu"] + f["h"] + f["a"][hi] - f["d"][ai])
        la[ok.to_numpy()] = np.exp(f["mu"] + f["a"][ai] - f["d"][hi])
        return lh, la

    def predict(self, fixtures: pd.DataFrame) -> pd.DataFrame:
        if self.fit_ is None:
            return self.empty(fixtures, "insufficient_training")
        lh, la = self.rates(fixtures)
        p, over, worst = outcome_probabilities(lh, la, self.rho)
        self.residual_mass = max(self.residual_mass, worst)
        out = frame(fixtures, p, goals=np.column_stack([lh, la]), reason=np.where(np.isfinite(lh), None, "unknown_team"))
        out["p_over_2_5"] = over
        return out

    def metadata(self) -> dict:
        return {**super().metadata(), "rho": round(float(self.rho), 3), "maxResidualMass": float(self.residual_mass)}


def poisson_model() -> Poisson:
    m = Poisson(half_life=None, dixon_coles=False); m.model_id = "poisson"; return m


def dixon_coles_model() -> Poisson:
    m = Poisson(half_life=None, dixon_coles=True); m.model_id = "dixon_coles"; return m


def dixon_coles_decay_model(half_life: float) -> Poisson:
    m = Poisson(half_life=half_life, dixon_coles=True); m.model_id = "dixon_coles_decay"; return m
