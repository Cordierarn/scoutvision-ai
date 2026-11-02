"""
Classement point-in-time : avant chaque match, le classement de sa compétition-saison reconstruit à
partir des seuls matchs dont le coup d'envoi est antérieur au cutoff du match.

Convention V1 (dataset, pas règlement) : 3 / 1 / 0 points ; départage points, différence de buts, buts
marqués, puis identifiant d'équipe (déterminisme). Les règles officielles (confrontations directes,
barrages, scissions) ne sont pas encodées : `ranking_rules_approximate` vaut toujours vrai.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

POINTS_WIN, POINTS_DRAW, POINTS_LOSS = 3, 1, 0
STANDINGS_STAGE = "regular_season"      # seuls les matchs de saison régulière entrent au classement
COLUMNS = ["played", "points", "goals_for", "goals_against", "goal_difference", "rank", "teams"]


def _rank_table(table: dict[str, list[int]]) -> list[str]:
    """Équipes classées : points, différence de buts, buts marqués, identifiant."""
    return sorted(table, key=lambda t: (-table[t][1], -(table[t][2] - table[t][3]), -table[t][2], t))


def incremental(matches: pd.DataFrame) -> pd.DataFrame:
    """Classement avant chaque match d'une compétition-saison.

    matches : match_id, kickoff_utc, feature_cutoff, home_team_id, away_team_id, home_goals, away_goals,
    stage (une seule compétition-saison). Renvoie une ligne par match et par camp (match_id, team_id,
    played, points, goals_for, goals_against, goal_difference, rank, teams), d'après les matchs de saison
    régulière dont le coup d'envoi est strictement antérieur au cutoff du match courant.
    """
    m = matches.sort_values(["kickoff_utc", "match_id"], kind="stable").reset_index(drop=True)
    teams = sorted(set(m["home_team_id"]) | set(m["away_team_id"]))
    table = {t: [0, 0, 0, 0] for t in teams}           # played, points, gf, ga
    kick = m["kickoff_utc"].to_numpy()
    cut = m["feature_cutoff"].to_numpy()
    rows = []
    applied = 0
    ranks: list[str] = _rank_table(table)
    for i in range(len(m)):
        # applique tous les matchs antérieurs au cutoff (le cutoff croît avec le coup d'envoi)
        changed = False
        while applied < len(m) and kick[applied] < cut[i]:
            r = m.iloc[applied]
            applied += 1
            if r["stage"] != STANDINGS_STAGE or pd.isna(r["home_goals"]) or pd.isna(r["away_goals"]):
                continue
            hg, ag = int(r["home_goals"]), int(r["away_goals"])
            h, a = table[r["home_team_id"]], table[r["away_team_id"]]
            h[0] += 1; a[0] += 1
            h[2] += hg; h[3] += ag; a[2] += ag; a[3] += hg
            if hg > ag:
                h[1] += POINTS_WIN; a[1] += POINTS_LOSS
            elif hg < ag:
                a[1] += POINTS_WIN; h[1] += POINTS_LOSS
            else:
                h[1] += POINTS_DRAW; a[1] += POINTS_DRAW
            changed = True
        if changed:
            ranks = _rank_table(table)
        pos = {t: k + 1 for k, t in enumerate(ranks)}
        for t in (m.at[i, "home_team_id"], m.at[i, "away_team_id"]):
            p, pts, gf, ga = table[t]
            rows.append((m.at[i, "match_id"], t, p, pts, gf, ga, gf - ga, pos[t], len(teams)))
    return pd.DataFrame(rows, columns=["match_id", "team_id"] + COLUMNS)


def brute_force(matches: pd.DataFrame, cutoff: pd.Timestamp) -> pd.DataFrame:
    """Classement d'une compétition-saison à un instant, recalculé indépendamment (pour les tests) :
    tous les matchs de saison régulière dont le coup d'envoi est antérieur au cutoff."""
    teams = sorted(set(matches["home_team_id"]) | set(matches["away_team_id"]))
    past = matches[(matches["kickoff_utc"] < cutoff) & (matches["stage"] == STANDINGS_STAGE)].dropna(subset=["home_goals", "away_goals"])
    long = pd.concat([
        pd.DataFrame({"team_id": past["home_team_id"], "gf": past["home_goals"].astype(int), "ga": past["away_goals"].astype(int)}),
        pd.DataFrame({"team_id": past["away_team_id"], "gf": past["away_goals"].astype(int), "ga": past["home_goals"].astype(int)}),
    ])
    long["points"] = np.where(long["gf"] > long["ga"], POINTS_WIN, np.where(long["gf"] == long["ga"], POINTS_DRAW, POINTS_LOSS))
    agg = long.groupby("team_id").agg(played=("gf", "size"), points=("points", "sum"), goals_for=("gf", "sum"), goals_against=("ga", "sum"))
    agg = agg.reindex(teams, fill_value=0)
    agg["goal_difference"] = agg["goals_for"] - agg["goals_against"]
    agg = agg.reset_index().sort_values(["points", "goal_difference", "goals_for", "team_id"], ascending=[False, False, False, True])
    agg["rank"] = np.arange(1, len(agg) + 1)
    agg["teams"] = len(teams)
    return agg.reset_index(drop=True)
