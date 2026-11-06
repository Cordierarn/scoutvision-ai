"""
Tests de l'étape 2B (benchmark marché) sur fixtures synthétiques : parsing réel par famille de fichier,
mappings d'équipes, ambiguïtés, de-vig, repli de clôture, population appariée, pool appris sur la
validation seulement et figé, aucune cote dans les modèles sportifs, reproductibilité.

  python3 -m unittest test_market_benchmark -v        # ou : npm run test:data
"""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

from backtest import leakage, market_benchmark as mb, odds as odds_mod, replay, walk_forward
from forecast_models import elo, frequency, poisson, xg
from forecast_models.base import PROB_COLUMNS
from tests.test_forecast_models import big_fixture

MAIN_HEADER = "Div,Date,Time,HomeTeam,AwayTeam,FTHG,FTAG,FTR,B365H,B365D,B365A,PSH,PSD,PSA,AvgH,AvgD,AvgA,B365>2.5,B365<2.5,P>2.5,P<2.5,Avg>2.5,Avg<2.5,PSCH,PSCD,PSCA,AvgCH,AvgCD,AvgCA,PC>2.5,PC<2.5,AvgC>2.5,AvgC<2.5"
NEW_HEADER = "Country,League,Season,Date,Time,Home,Away,HG,AG,Res,PH,PD,PA,MaxH,MaxD,MaxA,AvgH,AvgD,AvgA,PCH,PCD,PCA,MaxCH,MaxCD,MaxCA,AvgCH,AvgCD,AvgCA"


def main_csv(rows: pd.DataFrame, drop_pinnacle_closing_every: int | None = None) -> str:
    lines = [MAIN_HEADER]
    for i, r in enumerate(rows.itertuples()):
        d = pd.Timestamp(r.match_date).strftime("%d/%m/%Y")
        psc = ",," if drop_pinnacle_closing_every and i % drop_pinnacle_closing_every == 0 else "2.05,3.5,3.7"
        lines.append(f"E0,{d},15:00,{r.home_team_name},{r.away_team_name},{r.home_goals},{r.away_goals},H,2.2,3.4,3.6,2.15,3.45,3.65,2.1,3.4,3.7,1.9,1.95,1.92,1.98,1.91,1.96,{psc},2.0,3.5,3.8,1.9,2.0,1.88,1.97")
    lines.append(f"E0,01/01/2030,15:00,Fixture Ghost,Fixture Phantom,1,0,H,2.2,3.4,3.6,2.15,3.45,3.65,2.1,3.4,3.7,1.9,1.95,1.92,1.98,1.91,1.96,2.05,3.5,3.7,2.0,3.5,3.8,1.9,2.0,1.88,1.97")
    return "\n".join(lines) + "\n"


def new_csv(rows: pd.DataFrame) -> str:
    lines = [NEW_HEADER]
    for r in rows.itertuples():
        d = pd.Timestamp(r.match_date).strftime("%d/%m/%Y")
        lines.append(f"Fixtureland,Liga Fixture,{r.season},{d},20:00,{r.home_team_name},{r.away_team_name},{r.home_goals},{r.away_goals},H,2.3,3.3,3.4,2.4,3.5,3.6,2.25,3.3,3.5,2.2,3.4,3.5,2.3,3.5,3.7,2.15,3.4,3.6")
    return "\n".join(lines) + "\n"


def with_patched_leagues(fn):
    saved = dict(odds_mod.MAIN_LEAGUES), dict(odds_mod.EXTRA_LEAGUES)
    odds_mod.MAIN_LEAGUES.clear(); odds_mod.MAIN_LEAGUES["AAA"] = "E0"
    odds_mod.EXTRA_LEAGUES.clear(); odds_mod.EXTRA_LEAGUES["CCC"] = "ARG"
    try:
        return fn()
    finally:
        odds_mod.MAIN_LEAGUES.clear(); odds_mod.MAIN_LEAGUES.update(saved[0])
        odds_mod.EXTRA_LEAGUES.clear(); odds_mod.EXTRA_LEAGUES.update(saved[1])


class DevigTests(unittest.TestCase):
    def test_power_and_proportional_cases(self) -> None:
        cases = {"balanced": [2.9, 3.3, 2.9], "big_favourite": [1.08, 11.0, 26.0], "big_margin": [1.6, 3.0, 4.0]}
        for name, o in cases.items():
            for method in ("power", "proportional"):
                p = odds_mod.devig(np.array([o]), method)[0]
                self.assertTrue(np.isfinite(p).all(), name); self.assertTrue((p > 0).all(), name)
                self.assertAlmostEqual(float(p.sum()), 1.0, places=9, msg=name)
                self.assertEqual(list(np.argsort(p)), list(np.argsort(-np.array(o))), name)      # ordre conservé
        raw, over = odds_mod.implied(np.array([[1.6, 3.0, 4.0]]))
        self.assertAlmostEqual(float(over[0]), 1 / 1.6 + 1 / 3 + 1 / 4 - 1, places=9)
        missing = odds_mod.devig(np.array([[2.0, np.nan, 3.0]]))
        self.assertTrue(np.isnan(missing).all())
        power = odds_mod.devig(np.array([[1.08, 11.0, 26.0]]), "power")[0]; prop = odds_mod.devig(np.array([[1.08, 11.0, 26.0]]), "proportional")[0]
        self.assertGreater(power[0], prop[0])                                                    # power corrige davantage l'outsider


class JoinTests(unittest.TestCase):
    def setUp(self):
        self.ds, _ = big_fixture(seed=5)
        self.aaa = self.ds[(self.ds["competition"] == "AAA") & (self.ds["season"] == "2024-25")]
        self.ccc = self.ds[self.ds["competition"] == "CCC"]

    def test_parsing_mapping_ambiguity_fallback_and_population(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            d = Path(tmp)
            csv = main_csv(self.aaa, drop_pinnacle_closing_every=5)
            # une ligne dupliquée -> ambiguïté
            dup = csv.splitlines()[1]
            (d / "2425_E0.csv").write_text(csv + dup + "\n", encoding="utf-8")
            (d / "new_ARG.csv").write_text(new_csv(self.ccc), encoding="latin-1")
            def run():
                audit = odds_mod.audit_directory(d, ["2024-25"])
                odds, files = odds_mod.load_directory(d, ["2024-25"])
                return audit, odds, files
            audit, odds, files = with_patched_leagues(run)
            self.assertEqual({a["kind"] for a in audit}, {"main", "new"})
            main_audit = next(a for a in audit if a["kind"] == "main")
            self.assertIn("pinnacle", main_audit["providers"]["1x2"]["closing"]); self.assertIn("market_average", main_audit["providers"]["ou25"]["available_snapshot"])
            self.assertTrue(main_audit["timeColumn"])
            new_audit = next(a for a in audit if a["kind"] == "new")
            self.assertNotIn("ou25", new_audit["providers"]); self.assertEqual(new_audit["encoding"], "utf-8-sig")
            mapping, votes = odds_mod.map_teams(odds, self.ds)
            self.assertTrue(all(k[0] in ("AAA", "CCC") for k in mapping))
            status, odds_status = odds_mod.classify_join(self.ds, odds, mapping)
            counts = status["join_status"].value_counts()
            self.assertEqual(counts.get("ambiguous", 0), 1)                                    # le match dupliqué
            self.assertEqual(counts.get("matched_exact", 0), len(self.aaa) - 1 + len(self.ccc))
            self.assertEqual(int((odds_status["status"] == "team_not_mapped").sum()), 1)        # la ligne fantôme
            df = odds_mod.attach(self.ds, odds, status)
            self.assertEqual(len(df), len(self.ds))
            sub = df[df["join_status"] == "matched_exact"]
            self.assertTrue(sub["odds_has_closing_1x2"].all())
            # repli de clôture : Pinnacle manquant une ligne sur cinq -> moyenne clôture, enregistré
            saved = dict(mb.BENCHMARKS)
            market_df, report = with_patched_leagues(lambda: mb.build_market_dataset(self.ds, d))
            self.assertIn("odds_avg_closing", report["closingSource"]); self.assertIn("odds_ps_closing", report["closingSource"])
            self.assertEqual(report["statusCounts"].get("ambiguous", 0), 1)
            self.assertTrue(report["ambiguousExamples"])
            covered = self.ds[self.ds["competition"].isin(["AAA", "CCC"])]
            expected_rate = (len(self.aaa) - 1 + len(self.ccc)) / len(covered)          # une saison de AAA couverte, le match ambigu exclu
            self.assertAlmostEqual(report["rates"]["global"]["matchedRate"], expected_rate, places=3)
            self.assertEqual(report["rates"]["global"]["matches"], len(covered))
            p = market_df[[f"mkt_market_closing_pinnacle_p_{n}" for n in ("home", "draw", "away")]].dropna().to_numpy()
            self.assertTrue(np.allclose(p.sum(axis=1), 1))
            self.assertTrue((market_df["mkt_market_closing_pinnacle_overround"].dropna() > 0).all())
            self.assertEqual(market_df["mkt_devig_method"].iloc[0], "power")
            # population appariée : seulement les matchs avec prédiction ET marché
            pred, _ = walk_forward.run(poisson.Poisson(min_matches=100), self.ds, pd.Timestamp("2024-08-01"), pd.Timestamp("2025-06-01"), "h")
            sub = market_df[market_df["season"] == "2024-25"]
            markets = mb.market_frames(sub)
            scores = mb.population_scores(sub, {"poisson": pred}, markets)
            expected = len(set(pred["match_id"]) & set(markets[mb.REFERENCE]["match_id"]) & set(sub[sub["usable_for_model"]]["match_id"]))
            self.assertEqual(scores["population"], expected)
            self.assertEqual(scores["paired"][0]["model"], "poisson")
            self.assertEqual(mb.BENCHMARKS, saved)


class PoolTests(unittest.TestCase):
    def test_weight_learned_on_validation_only_and_frozen(self) -> None:
        rng = np.random.default_rng(6)
        ds, _ = big_fixture(seed=6)
        base = ds[ds["usable_for_model"]][["match_id", "season", "result_1x2"]]
        truth = rng.dirichlet([3, 2, 3], len(base))
        market = pd.DataFrame({"match_id": base["match_id"].to_numpy(), **{c: truth[:, i] for i, c in enumerate(PROB_COLUMNS)}})
        noisy = truth * np.exp(rng.normal(0, 0.5, truth.shape)); noisy /= noisy.sum(axis=1, keepdims=True)
        model = pd.DataFrame({"match_id": base["match_id"].to_numpy(), **{c: noisy[:, i] for i, c in enumerate(PROB_COLUMNS)}})
        val = ds[ds["season"] == "2023-24"]
        res = mb.pool(model[model["match_id"].isin(val["match_id"])], market, val, mb.POOL_GRID)
        self.assertEqual(set(res["logLossByWeight"]), set(mb.POOL_GRID))
        w = min(res["logLossByWeight"], key=res["logLossByWeight"].get)
        self.assertLessEqual(w, 0.3)                                                           # le marché est la vérité : poids faible
        self.assertEqual(mb.interpret_weight(0.0), "Le modèle n'apporte pas d'information supplémentaire mesurable au marché sur la validation.")
        self.assertEqual(mb.interpret_weight(0.1), "Information marginale."); self.assertEqual(mb.interpret_weight(0.5), "Information complémentaire mesurable.")
        retro = ds[ds["season"] == "2024-25"]
        frozen = mb.pool(model[model["match_id"].isin(retro["match_id"])], market, retro, [0.0, w])
        self.assertEqual(set(frozen["logLossByWeight"]), {0.0, w})                              # seul le poids figé est appliqué

    def test_divergence_and_clv_direction_shapes(self) -> None:
        ds, _ = big_fixture(seed=7)
        sub = ds[ds["season"] == "2024-25"].copy()
        rng = np.random.default_rng(8)
        for n in ("home", "draw", "away"):
            sub[f"mkt_market_closing_pinnacle_p_{n}"] = rng.uniform(0.2, 0.5, len(sub))
            sub[f"mkt_market_snapshot_avg_p_{n}"] = sub[f"mkt_market_closing_pinnacle_p_{n}"] + rng.normal(0, 0.02, len(sub))
        model = pd.DataFrame({"match_id": sub["match_id"], "p_home": 0.45, "p_draw": 0.25, "p_away": 0.30})
        market = sub[["match_id"] + [f"mkt_market_closing_pinnacle_p_{n}" for n in ("home", "draw", "away")]].rename(
            columns={f"mkt_market_closing_pinnacle_p_{n}": c for n, c in zip(("home", "draw", "away"), PROB_COLUMNS)})
        rows = mb.divergence(model, market, sub)
        self.assertEqual([r["bucket"] for r in rows], mb.DIVERGENCE_LABELS)
        self.assertEqual(sum(r["outcomes"] for r in rows), 3 * int(sub["usable_for_model"].sum()))
        clv = mb.clv_direction(model, sub)
        self.assertEqual(clv["matches"], len(sub))
        self.assertNotIn("roi", json_dumps_lower(clv))


def json_dumps_lower(obj) -> str:
    import json
    return json.dumps(obj).lower()


class NoOddsInSportModelsTests(unittest.TestCase):
    def test_sport_models_never_see_odds(self) -> None:
        ds, _ = big_fixture(seed=9)
        for c in odds_mod.ODDS_COLUMNS + odds_mod.SPECIFIC_COLUMNS:
            ds[c] = 2.0
        ds["mkt_market_closing_pinnacle_p_home"] = 0.4
        factories = [lambda: frequency.LeagueFrequency(min_matches=20), lambda: elo.Elo(), lambda: poisson.Poisson(min_matches=100), lambda: xg.RollingXG(5)]
        ds_no = ds.drop(columns=[c for c in ds.columns if c.startswith("odds_") or c.startswith("mkt_")])
        for make in factories:
            m = make()
            self.assertFalse(m.uses_odds)
            a, _ = walk_forward.run(m, ds, pd.Timestamp("2024-08-01"), pd.Timestamp("2024-11-01"), "h")
            b, _ = walk_forward.run(make(), ds_no, pd.Timestamp("2024-08-01"), pd.Timestamp("2024-11-01"), "h")
            pd.testing.assert_frame_equal(a.drop(columns=["prediction_created_at"]), b.drop(columns=["prediction_created_at"]), check_dtype=False)
        view = leakage.features_view(ds, "available_snapshot")
        for c in odds_mod.CLOSING_COLUMNS:
            self.assertNotIn(c, view.columns)
        self.assertFalse(any(c.startswith("odds_") or c.startswith("mkt_") for c in walk_forward.PREDICTION_COLUMNS))


if __name__ == "__main__":
    unittest.main()
