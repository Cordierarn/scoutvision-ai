"""
Tests de l'étape 2A (scripts/forecast_models, scripts/backtest walk-forward / scoring / prédictions /
registre) sur fixtures synthétiques : invariants des probabilités, fenêtre d'apprentissage, futur masqué,
ordre des lignes, matchs simultanés, matchs attribués, coupe et championnat distincts, reproduction,
scoring apparié, classes de calibration, artefact immuable, registre.

  python3 -m unittest tests.test_forecast_models -v        # ou : npm run test:data
"""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

from backtest import leakage, predictions, registry, replay, scoring, walk_forward
from forecast_models import elo, form, frequency, poisson, xg
from forecast_models.base import Context, Model, check_probabilities, frame


def big_fixture(seed: int = 0, teams: int = 12, seasons: int = 3) -> pd.DataFrame:
    """Championnat fictif « AAA » (journées à heure commune) et coupe « CCC » ; un match attribué."""
    rng = np.random.default_rng(seed)
    rows, tm = [], []
    k = 0
    att = rng.normal(0, 0.3, teams); dfn = rng.normal(0, 0.3, teams)
    ids = [f"fixture_t{i:02d}" for i in range(teams)]

    def add(comp, season, kickoff, h, a, stage, rnd, status="finished"):
        nonlocal k
        lh, la = np.exp(0.2 + att[h] - dfn[a]), np.exp(att[a] - dfn[h])
        hg, ag = int(rng.poisson(lh)), int(rng.poisson(la))
        mid = f"fx_{k:05d}"; k += 1
        rows.append({"competition": comp, "season": season, "match_id": mid, "match_status": status, "date": kickoff.strftime("%Y-%m-%d"),
                     "time_utc": kickoff.strftime("%Y-%m-%dT%H:%M:%SZ"), "round_name": str(rnd), "stage": stage,
                     "home_team_id": ids[h], "away_team_id": ids[a], "home_team_name": f"Fixture {h}", "away_team_name": f"Fixture {a}",
                     "score_home": hg, "score_away": ag})
        for tid, is_home, xf, xg_ in ((ids[h], True, lh, la), (ids[a], False, la, lh)):
            tm.append({"competition": comp, "season": season, "match_id": mid, "team_id": tid, "is_home": is_home,
                       "xg_for": round(float(xf + rng.normal(0, 0.2)), 2), "xg_against": round(float(xg_ + rng.normal(0, 0.2)), 2), "analytics_available": True})

    for s in range(seasons):
        season = f"{2022 + s}-{str(2023 + s)[2:]}"
        start = pd.Timestamp(f"{2022 + s}-08-06 14:00")
        pairs = [(i, j) for i in range(teams) for j in range(teams) if i != j]
        rng.shuffle(pairs)
        per_round = teams // 2
        for rnd in range(len(pairs) // per_round):
            day = start + pd.Timedelta(days=7 * rnd)
            for q, (h, a) in enumerate(pairs[rnd * per_round:(rnd + 1) * per_round]):
                add("AAA", season, day + pd.Timedelta(hours=5 * (q % 2)), h, a, "regular_season", rnd + 1)
        for rnd in range(6):
            add("CCC", season, start + pd.Timedelta(days=7 * rnd + 3, hours=5), rnd, teams - 1 - rnd, "group_stage", rnd + 1)
    match = pd.DataFrame(rows)
    idx = match[(match["competition"] == "AAA") & (match["season"] == "2022-23")].index[30]
    match.loc[idx, ["match_status", "score_home", "score_away"]] = ["awarded", 3, 0]
    return replay.build_from_frames(match, pd.DataFrame(tm)), match


def all_models() -> list[Model]:
    return [frequency.LeagueFrequency(min_matches=20), frequency.HomeAdvantage(), form.form_model(), form.standings_model(),
            elo.Elo(k=20, home_advantage=60, season_regression=0.2, margin=True),
            poisson.Poisson(min_matches=100), poisson.Poisson(min_matches=100, dixon_coles=True), poisson.Poisson(min_matches=100, dixon_coles=True, half_life=180),
            xg.RollingXG(5)]


class SpyModel(Model):
    """Enregistre ce que le moteur lui transmet."""
    model_id = "spy"

    def __init__(self):
        super().__init__()
        self.calls: list[tuple[pd.Timestamp, pd.Timestamp, int]] = []
        self.train_ids: set[str] = set()
        self.saw_targets = False

    def fit(self, train_rows, context):
        self.trained_until = context.train_end
        self.calls.append((train_rows["kickoff_utc"].max() if len(train_rows) else pd.NaT, context.train_end, len(train_rows)))
        self.train_ids |= set(train_rows["match_id"])

    def predict(self, fixtures):
        self.saw_targets = self.saw_targets or any(c in fixtures.columns for c in replay.TARGETS)
        return frame(fixtures, np.tile([0.5, 0.25, 0.25], (len(fixtures), 1)))


class ModelInvariantTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.ds, cls.match = big_fixture()
        cls.start, cls.end = pd.Timestamp("2024-08-01"), pd.Timestamp("2025-01-15")

    def test_probabilities_sum_to_one_bounded_finite(self) -> None:
        for m in all_models():
            pred, rep = walk_forward.run(m, self.ds, self.start, self.end, "h")
            self.assertGreater(rep.predicted, 0, m.model_id)
            p = pred[["p_home", "p_draw", "p_away"]].to_numpy()
            self.assertTrue(np.isfinite(p).all(), m.model_id)
            self.assertTrue(((p >= 0) & (p <= 1)).all(), m.model_id)
            self.assertTrue(np.allclose(p.sum(axis=1), 1), m.model_id)
            g = pred[["expected_goals_home", "expected_goals_away"]].to_numpy(float)
            self.assertFalse(np.isinf(g).any())
            if m.model_id in ("poisson", "xg_rolling"):
                self.assertTrue(np.isfinite(g).all() and (g > 0).all(), m.model_id)
                self.assertTrue(pred["p_over_2_5"].between(0, 1).all())
        bad = pd.DataFrame({"match_id": ["a"], "p_home": [0.6], "p_draw": [0.6], "p_away": [0.1], "expected_goals_home": [np.nan], "expected_goals_away": [np.nan], "reason": [None]})
        self.assertTrue(check_probabilities(bad))

    def test_train_end_strictly_before_prediction_start(self) -> None:
        spy = SpyModel()
        pred, _ = walk_forward.run(spy, self.ds, self.start, self.end, "h")
        for last_train, train_end, _n in spy.calls:
            self.assertTrue(pd.isna(last_train) or last_train < train_end)
        fitted = pred.merge(self.ds[["match_id", "kickoff_utc"]], on="match_id")
        self.assertTrue((fitted["fitted_at"] <= fitted["kickoff_utc"]).all())
        self.assertFalse(spy.saw_targets)
        with self.assertRaises(leakage.LeakageError):
            leakage.FitMetadata("x", pd.Timestamp("2024-01-01"), pd.Timestamp("2024-09-01"), pd.Timestamp("2024-09-01"))

    def test_future_masked_invariance(self) -> None:
        cut = pd.Timestamp("2024-11-01")
        kept = self.ds[self.ds["kickoff_utc"] < cut]["match_id"]
        masked_ds = self.ds[self.ds["match_id"].isin(kept)]
        for m_full, m_masked in zip(all_models(), all_models()):
            a, _ = walk_forward.run(m_full, self.ds, self.start, cut, "h")
            b, _ = walk_forward.run(m_masked, masked_ds, self.start, cut, "h")
            pd.testing.assert_frame_equal(a.drop(columns=["prediction_created_at"]), b.drop(columns=["prediction_created_at"]), check_dtype=False)

    def test_row_order_independence_and_determinism(self) -> None:
        rng = np.random.default_rng(1)
        shuffled = self.ds.iloc[rng.permutation(len(self.ds))].reset_index(drop=True)
        for m1, m2 in zip(all_models(), all_models()):
            a, _ = walk_forward.run(m1, self.ds, self.start, self.end, "h")
            b, _ = walk_forward.run(m2, shuffled, self.start, self.end, "h")
            pd.testing.assert_frame_equal(a.drop(columns=["prediction_created_at"]), b.drop(columns=["prediction_created_at"]), check_dtype=False)
        self.assertEqual(predictions.logical_hash(a), predictions.logical_hash(b))

    def test_simultaneous_matches_do_not_interact(self) -> None:
        week = self.ds[(self.ds["kickoff_utc"] >= self.start)].groupby("kickoff_utc")["match_id"].apply(list)
        a_id, b_id = next(v for v in week if len(v) >= 2)[:2]
        m1, m2 = poisson.Poisson(min_matches=100), poisson.Poisson(min_matches=100)
        full, _ = walk_forward.run(m1, self.ds, self.start, self.end, "h")
        without, _ = walk_forward.run(m2, self.ds[self.ds["match_id"] != b_id], self.start, self.end, "h")
        pa = full[full["match_id"] == a_id][["p_home", "p_draw", "p_away"]].to_numpy()
        pb = without[without["match_id"] == a_id][["p_home", "p_draw", "p_away"]].to_numpy()
        np.testing.assert_allclose(pa, pb)

    def test_awarded_excluded_from_training_and_predictions(self) -> None:
        aw = self.ds[self.ds["match_status"] == "awarded"]["match_id"].iloc[0]
        spy = SpyModel()
        pred, rep = walk_forward.run(spy, self.ds, pd.Timestamp("2022-08-01"), self.end, "h")
        self.assertNotIn(aw, spy.train_ids)
        self.assertNotIn(aw, set(pred["match_id"]))

    def test_cup_and_league_kept_apart(self) -> None:
        """Changer les résultats de la coupe ne change pas les fréquences ni les forces xG du championnat."""
        alt = self.match.copy()
        cup = alt["competition"] == "CCC"
        alt.loc[cup, ["score_home", "score_away"]] = [5, 0]
        tm_alt = None
        ds_alt = replay.build_from_frames(alt, pd.DataFrame([{"competition": r.competition, "season": r.season, "match_id": r.match_id, "team_id": r.home_team_id, "is_home": True,
                                                              "xg_for": 1.0, "xg_against": 1.0, "analytics_available": True} for r in alt.itertuples()]
                                                            + [{"competition": r.competition, "season": r.season, "match_id": r.match_id, "team_id": r.away_team_id, "is_home": False,
                                                                "xg_for": 1.0, "xg_against": 1.0, "analytics_available": True} for r in alt.itertuples()]))
        for m in (frequency.LeagueFrequency(min_matches=20),):
            a, _ = walk_forward.run(m, self.ds, self.start, self.end, "h")
            b, _ = walk_forward.run(frequency.LeagueFrequency(min_matches=20), ds_alt, self.start, self.end, "h")
            league = self.ds[self.ds["competition"] == "AAA"]["match_id"]
            pa = a[a["match_id"].isin(league)].set_index("match_id")[["p_home", "p_draw", "p_away"]]
            pb = b[b["match_id"].isin(league)].set_index("match_id")[["p_home", "p_draw", "p_away"]]
            pd.testing.assert_frame_equal(pa.sort_index(), pb.sort_index())
        model = xg.RollingXG(5)
        model.fit(self.ds[self.ds["kickoff_utc"] < self.start], Context(train_end=self.start))
        self.assertIn(("fixture_t00", "AAA"), model.strength)
        self.assertIn(("fixture_t00", "CCC"), model.strength)
        self.assertNotEqual(model.strength[("fixture_t00", "AAA")][2], model.strength[("fixture_t00", "CCC")][2])


class ScoringTests(unittest.TestCase):
    def setUp(self):
        self.ds, _ = big_fixture(seed=2)
        self.start, self.end = pd.Timestamp("2024-08-01"), pd.Timestamp("2025-02-01")

    def test_paired_scoring_prefers_the_informed_model(self) -> None:
        good, _ = walk_forward.run(poisson.Poisson(min_matches=100), self.ds, self.start, self.end, "h")
        flat, _ = walk_forward.run(frequency.HomeAdvantage(), self.ds, self.start, self.end, "h")
        ev = scoring.evaluate({"poisson": good, "home_advantage": flat}, self.ds)
        self.assertEqual(ev["population"], len(set(good["match_id"]) & set(flat["match_id"])))
        self.assertLess(ev["byModel"]["poisson"]["overall"]["logLoss"], ev["byModel"]["home_advantage"]["overall"]["logLoss"])
        pair = ev["paired"][0]
        self.assertEqual((pair["a"], pair["b"]), ("home_advantage", "poisson"))
        self.assertLess(pair["logLoss"]["pABetter"], 0.1)
        self.assertIn("bySeasonThird", ev["byModel"]["poisson"])
        self.assertIn("overUnder25", ev["byModel"]["poisson"])

    def test_calibration_buckets(self) -> None:
        rng = np.random.default_rng(3)
        prob = rng.uniform(0.05, 0.95, 20000)
        hit = (rng.uniform(size=20000) < prob).astype(float)
        cal = scoring.calibration(prob, hit)
        self.assertEqual(sum(b["n"] for b in cal["bins"]), 20000)
        self.assertLess(cal["ece"], 0.02)
        for b in cal["bins"]:
            self.assertTrue(b["lo"] <= b["meanProbability"] <= b["hi"] + 1e-9)


class ArtefactTests(unittest.TestCase):
    def test_predictions_are_immutable(self) -> None:
        ds, _ = big_fixture(seed=4)
        pred, _ = walk_forward.run(frequency.HomeAdvantage(), ds, pd.Timestamp("2024-08-01"), pd.Timestamp("2024-10-01"), "h")
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "2024-25.parquet"
            meta = predictions.write(path, pred)
            self.assertEqual(meta["rows"], len(pred))
            with self.assertRaises(predictions.ImmutableArtefactError):
                predictions.write(path, pred)
            meta2 = predictions.write(path, pred, overwrite=True)
            self.assertEqual(meta["logicalHash"], meta2["logicalHash"])
            other, _ = walk_forward.run(frequency.LeagueFrequency(min_matches=20), ds, pd.Timestamp("2024-08-01"), pd.Timestamp("2024-10-01"), "h")
            meta3 = predictions.write(path, other)
            self.assertEqual(len(meta3["blocks"]), 2)
            self.assertEqual(len(predictions.read(path)), len(pred) + len(other))

    def test_registry_requires_complete_entries(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "forecast_registry.json"
            entry = {"model_id": "poisson", "model_version": "1.0.0", "parameters": {}, "parameters_hash": "x", "features": "goals", "window": "2024-25",
                     "date": "2026-11-02", "input_hash": "h", "prediction_hash": "p", "matches_predicted": 10, "matches_scored": 10, "status": "challenger"}
            registry.upsert(path, entry)
            self.assertEqual(len(registry.load(path)), 1)
            registry.upsert(path, {**entry, "matches_scored": 11})
            self.assertEqual(registry.load(path)[0]["matches_scored"], 11)
            with self.assertRaises(ValueError):
                registry.upsert(path, {k: v for k, v in entry.items() if k != "prediction_hash"})
            with self.assertRaises(ValueError):
                registry.upsert(path, {**entry, "status": "champion"})


if __name__ == "__main__":
    unittest.main()
