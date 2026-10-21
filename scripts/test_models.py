"""
Tests des modèles de préparation des données (unittest, sans dépendance de test) :

  python3 -m unittest discover -s scripts -p "test_*.py"      # ou : npm run test:data
"""

from __future__ import annotations

import json
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

import market
import models
import prepare_data

SEASONS = ["2021-22", "2022-23", "2023-24", "2024-25", "2025-26"]
METRICS = ["m1", "m2", "m3", "m4"]
LAMBDA = {"m1": 0.5, "m2": 1.0, "m3": 1.5, "m4": 1.0}          # moyenne 1 : échelle du modèle
LEAGUES = {"AAA": (1, 6.0), "BBB": (1, 2.0), "CCC": (2, -2.0), "DDD": (2, -6.0)}   # niveau PitchAPI, niveau vrai
KAPPA_LEAGUE, KAPPA_CLUB, TAU = -2.0, -1.0, 0.3


def synthetic_players(seed: int = 0, n_players: int = 1500) -> pd.DataFrame:
    """Joueurs simulés selon le modèle de transfert : percentile' = percentile
    + lambda (L[quitté] - L[rejoint]) + tau * écart de domination + kappa + bruit."""
    rng = np.random.default_rng(seed)
    teams = {league: [f"{league}{i}" for i in range(6)] for league in LEAGUES}
    tilt = {team: float(rng.normal(50, 6)) for ts in teams.values() for team in ts}
    rows = []
    for pid in range(n_players):
        league = rng.choice(list(LEAGUES))
        team = rng.choice(teams[league])
        x = {m: float(rng.uniform(30, 70)) for m in METRICS}
        for season in SEASONS:
            rows.append({"Player ID": f"p{pid}", "_app_season": season, "Competition": league, "Team ID": team,
                         "Position": "CM", "Age": 25, "Minutes played": 2000.0, "Team field tilt": tilt[team],
                         **{f"{m} pct": x[m] for m in METRICS}})
            u = rng.random()
            new_league, new_team = league, team
            if u < 0.25:
                new_league = rng.choice([lg for lg in LEAGUES if lg != league])
                new_team = rng.choice(teams[new_league])
            elif u < 0.35:
                new_team = rng.choice([t for t in teams[league] if t != team])
            for m in METRICS:
                shift = LAMBDA[m] * (LEAGUES[league][1] - LEAGUES[new_league][1]) + TAU * (tilt[new_team] - tilt[team])
                if new_league != league:
                    shift += KAPPA_LEAGUE
                elif new_team != team:
                    shift += KAPPA_CLUB
                x[m] = float(np.clip(x[m] + shift + rng.normal(0, 3), 0, 100))
            league, team = new_league, new_team
    return pd.DataFrame(rows)


class TransferModelTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.players = synthetic_players()
        cls.tiers = {league: tier for league, (tier, _) in LEAGUES.items()}

    def test_pairs_exclude_current_season_and_role_changes(self) -> None:
        players = self.players.copy()
        players.loc[(players["Player ID"] == "p0") & (players["_app_season"] == "2022-23"), "Position"] = "ST"
        pairs = models._transfer_pairs(players, METRICS, cups=set())
        self.assertNotIn("2025-26", set(pairs["_app_season_next"]))
        p0 = pairs[pairs["Player ID"] == "p0"]
        self.assertEqual(sorted(p0["_app_season"]), ["2023-24"])   # 2021-22 et 2022-23 changent de rôle

    def test_recovers_levels_and_coefficients(self) -> None:
        pairs = models._transfer_pairs(self.players, METRICS, cups=set())
        dev = {m: pairs[f"{m} pct"].to_numpy(float) for m in METRICS}     # courbes d'âge neutres
        fit = models._fit_transfer(pairs, dev, METRICS, self.tiers, prior_pairs=1.0, coef_prior_pairs=0.0)
        true = np.array([LEAGUES[lg][1] for lg in sorted(LEAGUES)])
        got = np.array([fit["level"][lg] for lg in sorted(LEAGUES)])
        np.testing.assert_allclose(got - got.mean(), true - true.mean(), atol=0.6)
        for m in METRICS:
            self.assertAlmostEqual(fit["lambda"][m], LAMBDA[m], delta=0.15)
            tau, kappa_league, kappa_club = fit["coef"][m]
            self.assertAlmostEqual(tau, TAU, delta=0.1)
            self.assertAlmostEqual(kappa_league, KAPPA_LEAGUE, delta=0.6)
            self.assertAlmostEqual(kappa_club, KAPPA_CLUB, delta=0.6)

    def test_full_model_beats_persistence_out_of_sample(self) -> None:
        curves = {"CM": {m: {"beta": 0.0, "ages": {}} for m in METRICS}}
        out = models.transfer_model(self.players, METRICS, curves, set(), self.tiers)
        self.assertEqual(set(out["leagues"]), set(LEAGUES))
        self.assertEqual(out["context"], ["Team field tilt"])
        v = out["validation"]
        self.assertEqual(v["season"], "2024-25")
        self.assertLess(v["metric"]["movers"]["model"], v["metric"]["movers"]["persistence"])
        self.assertLess(abs(v["metric"]["biasUp"]["model"]), abs(v["metric"]["biasUp"]["persistence"]))
        json.dumps(out, allow_nan=False)      # écrit tel quel par prepare_data

    def test_too_few_moves_gives_empty_model(self) -> None:
        few = self.players[self.players["Player ID"].isin([f"p{i}" for i in range(20)])]
        self.assertEqual(models.transfer_model(few, METRICS, {}, set(), self.tiers), {})


class RoleIndexTest(unittest.TestCase):
    def test_matches_app_definition(self) -> None:
        preset = {"positions": ["CB"], "metrics": {"A": 60, "B": 50}, "weights": {"B": 2, "C": -1}}
        pct = {"A": np.array([80.0, np.nan, np.nan]), "B": np.array([50.0, np.nan, np.nan]),
               "C": np.array([30.0, 20.0, np.nan])}
        got = models.role_index(pct, preset, core_weight=1.5)
        self.assertAlmostEqual(got[0], (1.5 * 80 + 2 * 50 + 70) / 4.5)
        self.assertAlmostEqual(got[1], 80.0)                      # renormalisé sur la seule métrique connue
        self.assertTrue(np.isnan(got[2]))

    def test_app_presets_use_existing_metrics(self) -> None:
        presets = json.loads(prepare_data.ROLE_PRESETS.read_text(encoding="utf-8"))
        known = {label for label, _, kind in prepare_data.PLAYER_METRICS if kind != "total"}
        known |= set(prepare_data.COMPUTED_RATES)
        for name, preset in presets["presets"].items():
            used = set(preset["metrics"]) | set(preset.get("weights", {}))
            self.assertFalse(used - known, f"{name} : métriques inconnues {used - known}")


class LineupTest(unittest.TestCase):
    def test_counts_name_variants_as_one_player(self) -> None:
        rows = []
        for match, name in enumerate(["Inigo Cordoba", "Iñigo Córdoba", "Inigo Cordoba"]):
            rows.append({"role": "starter", "formation": "4-3-3", "position_id": 7, "team_id": "t", "match_id": match,
                         "player_id": "p_a", "player_name": name, "pitch_x": 0.8, "pitch_y": 0.1})
        rows.append({"role": "starter", "formation": "4-3-3", "position_id": 7, "team_id": "t", "match_id": 9,
                     "player_id": "p_b", "player_name": "B", "pitch_x": 0.8, "pitch_y": 0.1})
        lineups = prepare_data.build_lineups(pd.DataFrame(rows))
        slot = lineups["t"]["formations"][0]["slots"][0]
        self.assertEqual(slot["players"], [["p_a", "Inigo Cordoba", 3], ["p_b", "B", 1]])


class MarketTest(unittest.TestCase):
    def test_devig_removes_margin_and_keeps_order(self) -> None:
        p = market.devig(np.array([[1.8, 3.6, 4.5], [3.0, 3.2, 2.5]]))
        np.testing.assert_allclose(p.sum(axis=1), 1.0)
        self.assertTrue(p[0, 0] > p[0, 1] > p[0, 2])
        self.assertTrue(p[1, 2] > p[1, 0] > p[1, 1])

    def test_rps_of_a_sure_and_right_forecast_is_zero(self) -> None:
        self.assertAlmostEqual(float(market.rps(np.array([[1.0, 0.0, 0.0]]), np.array([0]))[0]), 0.0)
        self.assertAlmostEqual(float(market.rps(np.array([[0.0, 0.0, 1.0]]), np.array([0]))[0]), 1.0)


class SeasonSimulationTest(unittest.TestCase):
    def test_certain_results_give_certain_table(self) -> None:
        table = pd.DataFrame({"team_id": ["a", "b", "c", "d", "e"], "team": list("ABCDE"),
                              "points": [10, 10, 0, 0, 0], "diff": [0, 0, 0, 0, 0]})
        fixtures = pd.DataFrame({"match_id": ["m1"], "date": [pd.Timestamp("2026-11-01")], "home_id": ["a"],
                                 "away_id": ["b"], "p_home": [1.0], "p_draw": [0.0], "p_away": [0.0]})
        rows, _ = models.simulate_season(table, fixtures, n=2000)
        by_team = {r["team_id"]: r for r in rows}
        self.assertEqual(by_team["a"]["pTitle"], 1.0)
        self.assertEqual(by_team["b"]["pTitle"], 0.0)
        self.assertAlmostEqual(sum(r["pTitle"] for r in rows), 1.0)
        self.assertAlmostEqual(sum(r["pBottom3"] for r in rows), 3.0)


if __name__ == "__main__":
    unittest.main()
