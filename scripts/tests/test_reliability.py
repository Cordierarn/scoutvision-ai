"""
Tests de la fiabilité des métriques par 90 (scripts/reliability.py), sur données simulées :
constante de PitchAPI retrouvée, calibration pair / impair qui retrouve la constante théorique d'un
modèle de Poisson, percentiles, joueurs sous le seuil et fichier publié.

  python3 -m unittest test_reliability -v        # ou : npm run test:data
"""

from __future__ import annotations

import unittest

import numpy as np
import pandas as pd

import reliability as rl


def simulate_matches(n_players=600, matches=30, mean=2.0, var=0.5, seed=1, comps=3, role="CM"):
    """Joueurs d'un même rôle : vrai taux par 90 ~ Gamma(moyenne, variance), comptes de match ~ Poisson."""
    rng = np.random.default_rng(seed)
    shape, scale = mean ** 2 / var, var / mean
    rows = []
    for p in range(n_players):
        lam = rng.gamma(shape, scale)
        n = rng.integers(8, matches + 1)
        for j in range(n):
            minutes = int(rng.choice([90, 90, 90, 60, 30]))
            rows.append({"match_id": f"g{j}", "date": pd.Timestamp("2026-08-01") + pd.Timedelta(days=7 * j), "player_id": f"p{p}",
                         "player_name": f"Joueur {p}", "team_id": f"t{p % 20}", "team_name": f"Club {p % 20}", "position_role": role,
                         "lineup_role": "starter" if minutes == 90 else "sub", "minutes": minutes, "x_count": rng.poisson(lam * minutes / 90),
                         "comp": f"C{p % comps}"})
    return pd.DataFrame(rows)


class ConstantTests(unittest.TestCase):
    def test_implied_constant_of_pitchapi_is_recovered(self):
        m = np.array([1000.0, 1500, 2500, 3000]); raw = np.array([2.0, 1.0, 3.0, 2.5]); prior = 1.5; k = 500.0
        ps = pd.DataFrame({"minutes": m, "x_p90": raw, "x_p90_shrunk": (raw * m + prior * k) / (m + k), "x__prior": prior})
        self.assertAlmostEqual(rl.implied_constants(ps, ["x"])["x"], 500.0, places=6)
        self.assertEqual(rl.implied_constants(ps, ["absent"]), {})

    def test_split_half_calibration_recovers_the_poisson_constant(self):
        mean, var = 2.0, 0.5
        pm = simulate_matches(mean=mean, var=var)
        halves = pd.concat([rl.player_halves(g, ["x_count"], comp, "2026-27") for comp, g in pm.groupby("comp")], ignore_index=True)
        params = rl.calibrate(halves, [("X per 90", "x_count")], {"x_count": 999.0})
        k_true = 90 * mean / var                                   # bruit de Poisson par 90 minutes / variance vraie
        self.assertLess(abs(params["X per 90"]["k"] - k_true) / k_true, 0.3)
        self.assertEqual(params["X per 90"]["kPitchapi"], 999)
        self.assertAlmostEqual(params["X per 90"]["trueSd"]["CM"], np.sqrt(var), delta=0.15)
        for b in params["X per 90"]["validation"]:
            self.assertLess(abs(b["predicted"] - b["observed"]), 0.12)
        self.assertAlmostEqual(params["X per 90"]["minutesForReliable"], params["X per 90"]["k"] * 0.7 / 0.3, delta=2)

    def test_reliability_formula(self):
        self.assertAlmostEqual(float(rl.reliability(900, 900)), 0.5)
        self.assertEqual(float(rl.reliability(0, 900)), 0.0)


class SmallSampleTests(unittest.TestCase):
    def test_percentile_is_a_mid_rank(self):
        ref = np.array([1.0, 2.0, 3.0, 4.0])
        np.testing.assert_allclose(rl.percentile_of(np.array([0.5, 2.0, 5.0]), ref), [0.0, 37.5, 100.0])

    def test_small_sample_rows_shrink_like_pitchapi_and_skip_qualified_players(self):
        totals = pd.DataFrame([
            {"player_id": "a", "name": "A", "team_id": "t", "team_name": "Club", "minutes": 450, "matches": 6, "starts": 4, "team_minutes": 1800,
             "role": "ST", "xg": 4.5},
            {"player_id": "b", "name": "B", "team_id": "t", "team_name": "Club", "minutes": 450, "matches": 3, "starts": 3, "team_minutes": 1800,
             "role": "ST", "xg": 4.5},                                     # trois matchs seulement
            {"player_id": "c", "name": "C", "team_id": "t", "team_name": "Club", "minutes": 1500, "matches": 17, "starts": 17, "team_minutes": 1800,
             "role": "ST", "xg": 9.0},                                     # déjà dans la base
        ])
        priors = pd.DataFrame({"xg": [0.3]}, index=pd.Index(["ST"], name="position_role"))
        params = {"xG per 90": {"k": 900, "kPitchapi": 1350, "trueSd": {"ST": 0.12}}}
        rows = rl.small_sample_rows(totals, priors, {"c"}, params, [("xG per 90", "xg")], "AAA", "2026-27", 1)
        self.assertEqual(list(rows["Player ID"]), ["a"])
        r = rows.iloc[0]
        self.assertAlmostEqual(r["xG per 90 raw"], 0.9)
        self.assertAlmostEqual(r["xG per 90"], round((0.9 * 450 + 0.3 * 1350) / (450 + 1350), 4))
        self.assertEqual(r["xG per 90 rel"], round(100 * 450 / (450 + 900)))
        self.assertAlmostEqual(r["xG per 90 sd"], round(0.12 * np.sqrt(1 - 450 / 1350), 4))
        self.assertEqual((r["Minutes share"], r["Starts"]), (0.25, 4))

        qualified = pd.DataFrame({"_app_season": "2026-27", "League tier": 1, "Position": "ST", "xG per 90": np.linspace(0.05, 0.75, 20)})
        out = rl.add_small_sample_percentiles(rows, qualified)
        self.assertTrue(out.iloc[0]["xG per 90 pct lo"] <= out.iloc[0]["xG per 90 pct"] <= out.iloc[0]["xG per 90 pct hi"])
        payload = rl.small_samples_payload(out.assign(Age=21.0), "2026-27")
        self.assertIn("xG per 90", payload["labels"])
        p = payload["players"][0]
        self.assertEqual((p["Player"], p["Age"], p["Position"]), ("A", 21.0, "ST"))
        value, raw, rel, pct, lo, hi = p["metrics"][0][1:]
        self.assertEqual((raw, rel), (0.9, 33))
        self.assertTrue(lo <= pct <= hi)

    def test_percentile_agreement_measures_the_gap_to_pitchapi(self):
        q = pd.DataFrame({"_app_season": "2026-27", "League tier": 1, "Position": "CM", "Passes per 90": [10.0, 20, 30, 40],
                          "Passes per 90 pct": [12.5, 37.5, 62.5, 87.5]})
        self.assertEqual(rl.percentile_agreement(q, ["Passes per 90"]), {"Passes per 90": 0.0})


if __name__ == "__main__":
    unittest.main()
