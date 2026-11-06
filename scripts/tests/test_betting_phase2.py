"""
Tests de la phase 2 (scripts/betting/phase2.py) sans réseau ni données réelles : calibration retrouvée sur
des scores simulés à partir de buts attendus connus, anti-fuite sur les prévisions et les relevés, marge
retirée, bootstrap par match.

  python3 -m unittest test_betting_phase2 -v        # ou : npm run test:data
"""

from __future__ import annotations

import unittest

import numpy as np
import pandas as pd

from betting import markets as mk
from betting import phase2
from betting import simulate as sm


class CalibrationTests(unittest.TestCase):
    def test_calibration_recovers_known_probabilities(self):
        """Scores tirés de la vraie loi (buts attendus connus) : prédit ≈ observé par tranche, écart moyen < 2 points."""
        rng = np.random.default_rng(3)
        rows = []
        specs = [mk.Spec("1x2", "fulltime", 0.0, n) for n in "1X2"] + [mk.Spec("totals", "fulltime", 2.5, "Over"), mk.Spec("bothteamsscore", "fulltime", 0.0, "Yes")]
        for i in range(1500):
            xh, xa = float(rng.uniform(0.7, 2.3)), float(rng.uniform(0.6, 1.8))
            m = sm.score_matrix(xh, xa)
            k = rng.choice(m.size, p=m.ravel()); h, a = divmod(int(k), 11)
            ht_h, ht_a = int(rng.binomial(h, 0.45)), int(rng.binomial(a, 0.45))
            s = sm.simulate(xh, xa, 0.45, n=4000, seed=i)
            res = mk.Result(h, a, ht_h, ht_a)
            for sp in specs:
                rows.append({"match_id": f"m{i}", "competition": "AAA", "season": "s", "family": sp.family, "market_type": sp.market_type,
                             "period": sp.period, "handicap": sp.handicap, "outcome": sp.outcome, "p": mk.probability(sp, s), "y": mk.settle(sp, res)})
        tab = pd.DataFrame(rows)
        block = phase2._calibration_block(tab)
        self.assertLess(block["meanGap"], 0.02)
        self.assertTrue(block["usable"])
        for b in block["bins"]:
            if b["n"] >= 200:
                self.assertLess(abs(b["predicted"] - b["observed"]), 0.06, b)

    def test_miscalibrated_probabilities_are_flagged(self):
        rng = np.random.default_rng(4)
        p = rng.uniform(0.2, 0.8, 2000)
        y = (rng.random(2000) < np.clip(p - 0.15, 0, 1)).astype(float)   # sur-confiance systématique
        block = phase2._calibration_block(pd.DataFrame({"p": p, "y": y}))
        self.assertGreater(block["meanGap"], 0.1)
        self.assertFalse(block["usable"])
        small = phase2._calibration_block(pd.DataFrame({"p": p[:100], "y": (rng.random(100) < p[:100]).astype(float)}))
        self.assertFalse(small["usable"])  # moins de 500 issues


class LeakTests(unittest.TestCase):
    def test_prediction_after_kickoff_is_refused(self):
        res = pd.DataFrame({"match_id": ["a", "b"], "competition": ["AAA", "AAA"], "season": ["s", "s"], "kickoff_utc": pd.to_datetime(["2026-01-10 15:00", "2026-01-11 15:00"], utc=True),
                            "ft_home": [1, 2], "ft_away": [0, 2], "ht_home": [0, 1], "ht_away": [0, 1], "first_goal": ["home", "home"], "last_goal": ["home", "away"],
                            "awarded": [False, False], "extra_time": [False, False]})
        pred = pd.DataFrame({"match_id": ["a", "b"], "model_id": ["m", "m"], "fitted_at": pd.to_datetime(["2026-01-08", "2026-01-12"], utc=True),
                             "expected_goals_home": [1.4, 1.2], "expected_goals_away": [1.0, 1.1], "season": ["s", "s"]})
        orig_pred, orig_res = phase2.load_predictions, phase2.load_results
        phase2.load_predictions, phase2.load_results = (lambda *a, **k: pred), (lambda: res)
        try:
            with self.assertRaises(RuntimeError):
                phase2.matches_with_predictions(["s"])
            pred.loc[1, "fitted_at"] = pd.Timestamp("2026-01-11 15:00", tz="UTC")  # égal au coup d'envoi : accepté (ajusté sur les matchs antérieurs)
            self.assertEqual(len(phase2.matches_with_predictions(["s"])), 2)
        finally:
            phase2.load_predictions, phase2.load_results = orig_pred, orig_res

    def test_views_never_use_post_kickoff_snapshots(self):
        from betting import archive
        fx = archive.fixture_rows([{"fixtureId": "f", "tournamentId": 17, "startTime": "2026-01-10T15:00:00Z", "statusId": 2,
                                    "participant1Name": "Club A", "participant2Name": "Club B", "hasOdds": True}], {17: "ENG"}, "s")
        snaps = archive.flatten_historical({"fixtureId": "f", "bookmakers": {"winamax.fr": {"markets": {"101": {"outcomes": {"101": {"players": {"0": [
            {"createdAt": "2026-01-10T15:30:00.000Z", "price": 1.5}, {"createdAt": "2026-01-10T16:00:00.000Z", "price": 1.2}]}}}}}}}})
        self.assertTrue(archive.derived_views(snaps, fx).empty)


class ComparisonTests(unittest.TestCase):
    def test_winamax_probabilities_without_margin_sum_to_one(self):
        tab = pd.DataFrame({"match_id": ["m"] * 5, "view": ["h1"] * 5, "market_id": [101, 101, 101, 106, 106],
                            "market_type": ["1x2"] * 3 + ["totals"] * 2, "period": ["fulltime"] * 5, "handicap": [0.0] * 3 + [2.5] * 2,
                            "outcome": ["1", "X", "2", "Over", "Under"], "odds": [2.1, 3.4, 3.6, 1.9, 1.95]})
        out = phase2._attach_winamax_probability(tab, None)
        self.assertTrue(out["complete"].all())
        self.assertAlmostEqual(out.loc[out["market_id"] == 101, "q"].sum(), 1.0, places=12)
        self.assertAlmostEqual(out.loc[out["market_id"] == 106, "q"].sum(), 1.0, places=12)
        tab2 = tab.iloc[:2].copy()  # 1N2 incomplet : pas de normalisation
        out2 = phase2._attach_winamax_probability(tab2, None)
        self.assertFalse(out2["complete"].any())
        self.assertTrue(out2["q"].isna().all())

    def test_cluster_bootstrap_interval(self):
        rng = np.random.default_rng(5)
        clusters = np.repeat(np.arange(300), 3)
        values = rng.normal(0.02, 1.0, 900)
        lo, hi = phase2._cluster_bootstrap(clusters, values, draws=500)
        self.assertLess(lo, values.mean()); self.assertGreater(hi, values.mean())
        self.assertLess(hi - lo, 0.4)

    def test_comparison_block_value_and_logloss(self):
        g = pd.DataFrame({"match_id": ["a", "a", "a", "b", "b", "b"], "market_id": [101] * 6, "complete": [True] * 6,
                          "p": [0.5, 0.3, 0.2, 0.6, 0.25, 0.15], "q": [0.45, 0.3, 0.25, 0.5, 0.3, 0.2],
                          "odds": [2.0, 3.2, 4.0, 1.8, 3.3, 5.0], "settled": [1.0, 0.0, 0.0, 0.0, 1.0, 0.0],
                          "expected_return": [0.0, -0.04, -0.2, 0.08, -0.175, -0.25]})
        g["realised"] = [mk.realised_return(s, o) for s, o in zip(g["settled"], g["odds"])]
        b = phase2._comparison_block(g)
        self.assertEqual(b["completeMarkets"], 2)
        self.assertAlmostEqual(b["logLossOurs"], -(np.log(0.5) + np.log(0.25)) / 2, places=4)
        self.assertAlmostEqual(b["logLossWinamax"], -(np.log(0.45) + np.log(0.3)) / 2, places=4)
        self.assertEqual(b["valueBets"], 1)
        self.assertAlmostEqual(b["valueReturn"], -1.0)


if __name__ == "__main__":
    unittest.main()
