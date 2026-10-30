"""
Tests du Labo marché (scripts/lab_market.py) sur données simulées : chaque expérience doit
retrouver un effet connu, ou son absence, et tourner sans cotes réelles.

  python3 -m unittest discover -s scripts -p "test_*.py"      # ou : npm run test:data
"""

from __future__ import annotations

import unittest
from math import factorial

import numpy as np
import pandas as pd

import lab_market as lm


def _poisson_1x2(lh: float, la: float, rho: float = 0.0) -> np.ndarray:
    g = np.arange(9)
    f = np.array([factorial(int(i)) for i in g], float)
    ph = np.exp(-lh) * lh ** g / f
    pa = np.exp(-la) * la ** g / f
    m = ph[:, None] * pa[None, :]
    return np.array([np.tril(m, -1).sum(), np.trace(m), np.triu(m, 1).sum()]) / m.sum()


def simulated(seed: int = 0, teams: int = 20, seasons: tuple[str, ...] = ("2023-24", "2024-25", "2025-26"),
              luck_bias: float = 0.0, margin: float = 0.05) -> tuple[pd.DataFrame, np.ndarray, pd.DataFrame]:
    """Championnat simulé : forces vraies, buts Poisson, probabilités de base bruitées, cotes
    d'ouverture (bruit + biais optionnel selon la chance accumulée) et de clôture (plus justes)."""
    rng = np.random.default_rng(seed)
    rows, odds = [], []
    start = pd.Timestamp("2023-08-01")
    for s, season in enumerate(seasons):
        att = rng.normal(0, 0.25, teams); dfn = rng.normal(0, 0.25, teams)
        luck = np.zeros(teams)
        k = 0
        for rnd in range(2 * (teams - 1)):
            order = rng.permutation(teams)
            for i in range(0, teams - 1, 2):
                h, a = order[i], order[i + 1]
                lh, la = np.exp(0.15 + att[h] - dfn[a]), np.exp(att[a] - dfn[h])
                truth = _poisson_1x2(lh, la)
                gh, ga = rng.poisson(lh), rng.poisson(la)
                date = start + pd.Timedelta(days=365 * s + 3 * k)
                mid = f"m{s}_{k}"
                rows.append({"match_id": mid, "comp": "AAA", "app_season": season, "date": date, "competition": "AAA",
                             "home": f"t{h}", "away": f"t{a}", "home_name": f"T{h}", "away_name": f"T{a}",
                             "goals_home": gh, "goals_away": ga, "xg_home": lh, "xg_away": la, "league": True,
                             "outcome": 0 if gh > ga else 1 if gh == ga else 2, "referee": f"r{k % 7}"})
                noise = lambda sd: np.exp(rng.normal(0, sd, 3))
                base = truth * noise(0.25); base /= base.sum()
                pre = truth * noise(0.12)
                pre[0] *= np.exp(luck_bias * (luck[h] - luck[a])); pre[2] *= np.exp(-luck_bias * (luck[h] - luck[a]))
                pre /= pre.sum()
                close = truth * noise(0.05); close /= close.sum()
                books = {}
                for b in lm.BOOKMAKERS:
                    pb = pre * noise(0.04); pb /= pb.sum()
                    o = (1 + margin) / pb
                    books.update({f"{b}_h": o[0], f"{b}_d": o[1], f"{b}_a": o[2]})
                p_over = 1 - np.exp(-(lh + la)) * (1 + (lh + la) + (lh + la) ** 2 / 2)
                line = -0.5 if lh > la else 0.5
                cover = truth[0] if line == -0.5 else truth[0] + truth[1]
                odds.append({"match_id": mid, "close_h": (1 + margin) / close[0], "close_d": (1 + margin) / close[1],
                             "close_a": (1 + margin) / close[2], "pre_h": (1 + margin) / pre[0], "pre_d": (1 + margin) / pre[1],
                             "pre_a": (1 + margin) / pre[2], "ou_pre_over": (1 + margin) / p_over, "ou_pre_under": (1 + margin) / (1 - p_over),
                             "ah_pre_line": line, "ah_pre_h": (1 + margin) / cover, "ah_pre_a": (1 + margin) / (1 - cover),
                             "_base": base, **books})
                pts_h = 3 if gh > ga else 1 if gh == ga else 0
                luck[h] += pts_h - (3 * truth[0] + truth[1]); luck[a] += (3 - pts_h if gh != ga else 1) - (3 * truth[2] + truth[1])
                k += 1
    mf = pd.DataFrame(rows)
    od = pd.DataFrame(odds)
    base = np.vstack(od.pop("_base").to_numpy())
    return mf, base, od


class SignalGainTest(unittest.TestCase):
    def test_signal_that_is_truth_beyond_base_is_found_and_noise_is_not(self) -> None:
        mf, base, _ = simulated()
        out = mf["outcome"].to_numpy()
        train, test = lm.split_seasons(mf, "2025-26")
        truth = np.log(mf["xg_home"] / mf["xg_away"]).to_numpy()
        found = lm.signal_gain(base, truth, out, train, test)
        self.assertEqual(found["verdict"], "validated")
        self.assertGreater(found["gain"], 0.005)
        rng = np.random.default_rng(1)
        noise = lm.signal_gain(base, rng.normal(size=len(mf)), out, train, test)
        self.assertNotEqual(noise["verdict"], "validated")

    def test_multinomial_recovers_probabilities(self) -> None:
        rng = np.random.default_rng(2)
        p = rng.dirichlet([2, 2, 2], 4000)
        y = np.array([rng.choice(3, p=q) for q in p])
        x = np.column_stack([np.ones(len(p)), lm._logits(p)])
        w = lm.multinomial_fit(x, y)
        self.assertAlmostEqual(w[0, 1], 1.0, delta=0.15)
        self.assertAlmostEqual(w[1, 2], 1.0, delta=0.15)


class CalibrationTest(unittest.TestCase):
    def test_overconfident_probabilities_get_a_temperature_above_one(self) -> None:
        mf, base, _ = simulated(seed=3)
        sharp = base ** 1.6; sharp /= sharp.sum(axis=1, keepdims=True)
        out = lm.calibration(mf, sharp, "2025-26")
        self.assertGreater(out["temperature"], 1.15)
        self.assertEqual(out["verdict"], "validated")
        self.assertGreaterEqual(len(out["reliability"]), 3)


class OddsTest(unittest.TestCase):
    def setUp(self) -> None:
        self.mf, self.base, od = simulated(seed=4, luck_bias=0.08)
        self.od = lm.odds_arrays(od)
        self.out = self.mf["outcome"].to_numpy()
        self.train, self.test = lm.split_seasons(self.mf, "2025-26")
        self.odds = od

    def test_devig_sums_to_one_and_dispersion_is_measured(self) -> None:
        self.assertTrue(np.allclose(self.od["close"].sum(axis=1), 1))
        self.assertTrue((self.od["books"] >= 3).all())
        self.assertGreater(np.nanmean(self.od["dispersion"]), 0)

    def test_closing_target_explains_part_of_the_movement(self) -> None:
        r = lm.closing_target(self.mf, self.base, self.od, self.out, self.train, self.test)
        self.assertGreater(r["movementExplained"], 0.05)      # la base porte une information absente de l'ouverture
        self.assertLess(r["llPredicted"], r["llOpening"] + 0.01)

    def test_luck_bias_in_opening_is_detected(self) -> None:
        feat = lm.luck_features(self.mf)
        r = lm.luck_market(self.mf, self.od, feat, self.out, self.train, self.test)
        self.assertEqual(r["verdict"], "validated")
        self.assertLess(r["coef"][0], 0)                        # chanceux à domicile : le marché le surcote
        mf0, base0, od0 = simulated(seed=5, luck_bias=0.0)
        r0 = lm.luck_market(mf0, lm.odds_arrays(od0), lm.luck_features(mf0), mf0["outcome"].to_numpy(), *lm.split_seasons(mf0, "2025-26"))
        self.assertNotEqual(r0["verdict"], "validated")

    def test_market_coherence_recovers_rates(self) -> None:
        lh, la = lm.implied_rates(np.array([0.55, 0.40]), np.array([0.6, 0.3]), np.array([-0.5, 0.5]))
        self.assertTrue((lh > 0).all() and (la > 0).all())
        r = lm.market_coherence(self.odds, self.od, self.out, self.train, self.test)
        self.assertGreater(r["matches"], 300)
        self.assertLess(r["meanAbsGap"], 0.6)

    def test_efficiency_map_dispersion_and_stack_run(self) -> None:
        e = lm.efficiency_map(self.mf, self.base, self.od, self.out, self.train, self.test)
        self.assertIn("AAA", e["competitions"])
        d = lm.dispersion(self.mf, self.base, self.od, self.out, self.train, self.test)
        self.assertEqual(set(d["groups"]), {"low", "mid", "high"})
        s = lm.stack(self.mf, self.base, self.od, {"truth": np.log(self.mf["xg_home"] / self.mf["xg_away"]).to_numpy()},
                     self.out, self.train, self.test)
        self.assertLess(s["llStack"], s["llOpening"])


class FeatureTest(unittest.TestCase):
    def test_absence_features_count_missing_regulars(self) -> None:
        mf, _, _ = simulated(seed=6, teams=6, seasons=("2023-24",))
        rows = []
        for r in mf.itertuples():
            for side in ("home", "away"):
                tid = getattr(r, side)
                xi = [f"{tid}_p{i}" for i in range(11)]
                if r.Index >= 15 and tid == "t0":
                    xi[0] = f"{tid}_sub"                     # le titulaire 0 manque à partir du 20e match
                rows += [{"match_id": r.match_id, "team_id": tid, "player_id": p, "role": "starter"} for p in xi]
        lineup = pd.DataFrame(rows)
        edges = pd.DataFrame({"match_id": lineup["match_id"], "team_id": lineup["team_id"], "from_player_id": lineup["player_id"],
                              "to_player_id": lineup["player_id"].str.replace("p0", "p1"), "passes": 5})
        feat = lm.absence_features(lineup, edges, mf)
        late = feat[(feat["team_id"] == "t0") & (feat["prior"] >= 6)]
        self.assertTrue((late["missing"] >= 1).any())
        self.assertTrue((late["xi_hit"] >= 10 / 11).all())

    def test_coach_change_counts_matches_since_change(self) -> None:
        mf, _, _ = simulated(seed=7, teams=6, seasons=("2023-24",))
        lu = pd.concat([mf[["match_id", "home"]].rename(columns={"home": "team_id"}), mf[["match_id", "away"]].rename(columns={"away": "team_id"})])
        lu = lu.merge(mf[["match_id", "date"]], on="match_id").sort_values("date")
        lu["coach_name"] = np.where((lu["team_id"] == "t1") & (lu.groupby("team_id").cumcount() >= 4), "new", "old")
        feat = lm.coach_change_features(lu, mf)
        t1 = feat[feat["team_id"] == "t1"].merge(mf[["match_id", "date"]], on="match_id").sort_values("date")
        self.assertEqual(len(t1), 10)
        self.assertEqual(int(t1["since_change"].iloc[4]), 0)
        self.assertEqual(float(t1["new_coach"].iloc[4:9].mean()), 1.0)
        self.assertEqual(float(t1["new_coach"].iloc[9]), 0.0)

    def test_red_card_and_set_piece_features_have_one_row_per_side(self) -> None:
        mf, _, _ = simulated(seed=8, teams=6, seasons=("2023-24",))
        ev = pd.DataFrame({"match_id": mf["match_id"].iloc[::3], "team_id": mf["home"].iloc[::3], "event_type": "redcard"})
        rf = lm.red_card_features(mf, ev)
        self.assertEqual(len(rf), 2 * len(mf))
        self.assertTrue(((rf["ref_red"] > 0) & (rf["ref_red"] < 1)).all())
        shot = pd.DataFrame({"match_id": mf["match_id"], "team_id": mf["home"], "expected_goals": 0.3, "situation": "FromCorner"})
        sf = lm.set_piece_features(shot, mf)
        self.assertEqual(len(sf), 2 * len(mf))
        self.assertGreater(sf["sp_for_rate"].max(), sf["sp_against_rate"].min())


if __name__ == "__main__":
    unittest.main()
