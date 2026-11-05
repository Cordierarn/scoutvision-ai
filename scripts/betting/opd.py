"""
Écart résultat / performance (OPD, outcome-performance discrepancy) d'une équipe sur ses derniers matchs :
buts marqués − xG, et points − points attendus (xP, calculés par Poisson sur les xG des deux équipes).

Usage dans le coupe-circuit : un favori coté sous 1,55 qui vient de récolter nettement plus que ses xG
(P ≫ xP) est surévalué par le public ; on ne le joue pas (Brechot & Flepp, 2020 ; van Ours, 2025 ; voir
docs/betting-lab.md, étape 1 du moteur quantitatif). Les xG par match viennent de la table
`replay_pitchapi.parquet` (prévisions figées de la recherche, mêmes identifiants PitchAPI) et les scores des
résultats du Labo ; rien n'est estimé quand une donnée manque (OPD = None).
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import poisson

from . import ROOT

XG_MATCHES = ROOT / ".research" / "forecast" / "replay_pitchapi.parquet"
WINDOW = 5                      # derniers matchs considérés
MIN_MATCHES = 4                 # en dessous, pas de diagnostic
OVERPERFORMANCE_GOALS = 3.0     # buts − xG cumulés sur la fenêtre
OVERPERFORMANCE_POINTS = 2.5    # points − xP cumulés sur la fenêtre
MAX_GOALS = 10


@dataclass(frozen=True)
class Opd:
    matches: int
    goals_minus_xg: float
    points_minus_xp: float

    @property
    def overperforming(self) -> bool:
        return self.matches >= MIN_MATCHES and (self.goals_minus_xg >= OVERPERFORMANCE_GOALS or self.points_minus_xp >= OVERPERFORMANCE_POINTS)

    def as_dict(self) -> dict:
        return {"matches": self.matches, "goalsMinusXg": round(self.goals_minus_xg, 2), "pointsMinusXp": round(self.points_minus_xp, 2), "overperforming": self.overperforming}


def expected_points(xg_for: float, xg_against: float, max_goals: int = MAX_GOALS) -> float:
    """Points attendus d'une équipe : 3 P(gagne) + P(nul) sous deux lois de Poisson indépendantes."""
    k = np.arange(max_goals + 1)
    pf = poisson.pmf(k, max(float(xg_for), 1e-6))
    pa = poisson.pmf(k, max(float(xg_against), 1e-6))
    m = np.outer(pf, pa)
    win = float(np.tril(m, -1).sum())
    draw = float(np.trace(m))
    return 3.0 * win + draw


def load_xg_matches(results: pd.DataFrame, path: Path = XG_MATCHES) -> pd.DataFrame:
    """Une ligne par match joué avec scores et xG des deux équipes ; vide si la table des xG est absente."""
    if not path.exists():
        return pd.DataFrame(columns=["match_id", "kickoff_utc", "home_team_id", "away_team_id", "ft_home", "ft_away", "home_xg", "away_xg"])
    xg = pd.read_parquet(path, columns=["match_id", "home_xg", "away_xg"]).drop_duplicates("match_id")
    df = results[["match_id", "kickoff_utc", "home_team_id", "away_team_id", "ft_home", "ft_away"]].merge(xg, on="match_id", how="inner")
    df = df[df["home_xg"].notna() & df["away_xg"].notna()].copy()
    df["kickoff_utc"] = pd.to_datetime(df["kickoff_utc"], utc=True)
    return df.sort_values("kickoff_utc").reset_index(drop=True)


def team_opd(matches: pd.DataFrame, team_id: str, before: pd.Timestamp, window: int = WINDOW) -> Opd | None:
    """OPD de l'équipe sur ses `window` derniers matchs avant `before` (toutes compétitions du Labo confondues)."""
    if matches.empty or not team_id:
        return None
    m = matches[(matches["kickoff_utc"] < pd.Timestamp(before)) & ((matches["home_team_id"] == team_id) | (matches["away_team_id"] == team_id))].tail(window)
    if len(m) < MIN_MATCHES:
        return None
    goals_minus_xg, points_minus_xp = 0.0, 0.0
    for r in m.itertuples(index=False):
        home = r.home_team_id == team_id
        gf, ga = (r.ft_home, r.ft_away) if home else (r.ft_away, r.ft_home)
        xf, xa = (r.home_xg, r.away_xg) if home else (r.away_xg, r.home_xg)
        points = 3.0 if gf > ga else 1.0 if gf == ga else 0.0
        goals_minus_xg += float(gf) - float(xf)
        points_minus_xp += points - expected_points(xf, xa)
    return Opd(int(len(m)), goals_minus_xg, points_minus_xp)
