"""
Tests du dataset point-in-time (scripts/backtest) sur des fixtures synthétiques : équipes, matchs et
cotes fictifs. Huit tests anti-fuite obligatoires, invariants de qualité, adaptateur de cotes,
reproductibilité.

  python3 -m unittest test_backtest -v        # ou : npm run test:data
"""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

from backtest import leakage, manifest, odds as odds_mod, replay, standings


def fixture(seed: int = 0) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Deux saisons d'un championnat fictif « AAA » à 6 équipes (journées entières à la même heure, plus
    quelques matchs décalés), une coupe « CCC » en phase de groupes, et un championnat « BBB » dont une
    équipe porte le même nom qu'une équipe de AAA (identifiant différent)."""
    rng = np.random.default_rng(seed)
    rows, tm = [], []
    k = 0

    def add(comp, season, kickoff, home, away, hname, aname, stage, rnd, status="finished"):
        nonlocal k
        hg, ag = int(rng.poisson(1.4)), int(rng.poisson(1.1))
        mid = f"fx_{k:04d}"; k += 1
        rows.append({"competition": comp, "season": season, "match_id": mid, "match_status": status,
                     "date": kickoff.strftime("%Y-%m-%d"), "time_utc": kickoff.strftime("%Y-%m-%dT%H:%M:%SZ"),
                     "round_name": str(rnd), "stage": stage, "home_team_id": home, "away_team_id": away,
                     "home_team_name": hname, "away_team_name": aname, "score_home": hg, "score_away": ag})
        xh, xa = round(float(rng.gamma(2, 0.7)), 2), round(float(rng.gamma(2, 0.6)), 2)
        for tid, is_home, xf, xg in ((home, True, xh, xa), (away, False, xa, xh)):
            tm.append({"competition": comp, "season": season, "match_id": mid, "team_id": tid, "is_home": is_home,
                       "xg_for": xf, "xg_against": xg, "analytics_available": bool(rng.random() < 0.5)})

    teams = [f"fixture_a{i}" for i in range(6)]
    names = {t: f"Fixture FC {chr(ord('A') + i)}" for i, t in enumerate(teams)}
    for s, season in enumerate(("2023-24", "2024-25")):
        start = pd.Timestamp(f"{2023 + s}-08-05 14:00")
        pairs = [(teams[i], teams[j]) for i in range(6) for j in range(6) if i != j]
        rng.shuffle(pairs)
        for rnd in range(10):                                   # 10 journées de 3 matchs
            day = start + pd.Timedelta(days=7 * rnd)
            for q, (h, a) in enumerate(pairs[3 * rnd: 3 * rnd + 3]):
                kick = day if q < 2 else day + pd.Timedelta(hours=5)     # deux matchs simultanés, un décalé
                add("AAA", season, kick, h, a, names[h], names[a], "regular_season", rnd + 1)
        # coupe : phase de groupes, en semaine
        for rnd in range(4):
            day = start + pd.Timedelta(days=7 * rnd + 3, hours=5)
            add("CCC", season, day, teams[rnd], teams[5 - rnd], names[teams[rnd]], names[teams[5 - rnd]], "group_stage", rnd + 1)
        # autre championnat : homonyme de Fixture FC A avec un autre identifiant
        for rnd in range(6):
            day = start + pd.Timedelta(days=7 * rnd + 1, hours=2)
            h, a = ("fixture_b0", "fixture_b1") if rnd % 2 else ("fixture_b1", "fixture_b0")
            bnames = {"fixture_b0": "Fixture FC A", "fixture_b1": "Fixture United"}
            add("BBB", season, day, h, a, bnames[h], bnames[a], "regular_season", rnd + 1)
    return pd.DataFrame(rows), pd.DataFrame(tm)


def features_of(df: pd.DataFrame) -> pd.DataFrame:
    return df.set_index("match_id")[replay.feature_columns()].astype(object)


class LeakageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.match, cls.tm = fixture()
        cls.ds = replay.build_from_frames(cls.match, cls.tm)
        cls.feat = features_of(cls.ds)

    def _same(self, a: pd.DataFrame, b: pd.DataFrame, ids) -> None:
        pd.testing.assert_frame_equal(a.loc[ids].sort_index(), b.loc[ids].sort_index(), check_dtype=False)

    def test_1_current_match_excluded(self) -> None:
        """Changer le résultat et les xG d'un match ne change aucune de ses features ; le retirer ne change
        aucun match dont le cutoff lui est antérieur ou égal."""
        for mid in self.ds["match_id"].iloc[[5, 40, 60, 75]]:
            m = self.match.copy(); t = self.tm.copy()
            m.loc[m["match_id"] == mid, ["score_home", "score_away"]] = [9, 0]
            t.loc[t["match_id"] == mid, "xg_for"] = 7.7
            alt = features_of(replay.build_from_frames(m, t))
            self._same(self.feat, alt, [mid])
            without = features_of(replay.build_from_frames(m[m["match_id"] != mid], t[t["match_id"] != mid]))
            kick = self.ds.set_index("match_id").at[mid, "kickoff_utc"]
            earlier = self.ds[(self.ds["kickoff_utc"] <= kick) & (self.ds["match_id"] != mid)]["match_id"]
            self._same(self.feat, without, list(earlier))

    def test_2_future_masked(self) -> None:
        """Supprimer tous les matchs postérieurs à un cutoff ne change aucune feature des matchs restants."""
        for cutoff in (pd.Timestamp("2023-10-01"), pd.Timestamp("2024-09-20 14:00"), pd.Timestamp("2024-11-01")):
            keep = self.ds[self.ds["kickoff_utc"] < cutoff]["match_id"]
            m = self.match[self.match["match_id"].isin(keep)]
            masked = features_of(replay.build_from_frames(m, self.tm[self.tm["match_id"].isin(keep)]))
            self._same(self.feat, masked, list(keep))

    def test_3_closing_odds_absent_from_features(self) -> None:
        """En scénario available_snapshot, les colonnes de clôture et les cibles sont absentes et tout accès lève."""
        with_odds = self.ds.copy()
        for c in odds_mod.ODDS_COLUMNS + odds_mod.PROVIDER_COLUMNS:
            with_odds[c] = 2.0 if c.startswith("odds_") and "provider" not in c else "fixture_book"
        view = leakage.features_view(with_odds, "available_snapshot")
        for c in odds_mod.CLOSING_COLUMNS + replay.TARGETS:
            self.assertNotIn(c, view.columns)
            with self.assertRaises(leakage.LeakageError):
                view[c]
        self.assertIn("odds_snapshot_1x2_home", view.columns)
        self.assertIn("f_home_rank", view.columns)
        bench = leakage.features_view(with_odds, "closing_benchmark")
        self.assertIn("odds_closing_1x2_home", bench.columns)
        with self.assertRaises(leakage.LeakageError):
            bench["home_goals"]

    def test_4_fit_window_strictly_before_prediction(self) -> None:
        leakage.FitMetadata("ok", pd.Timestamp("2021-08-01"), pd.Timestamp("2024-05-30"), pd.Timestamp("2024-08-01"), "2023-24", "2024-25")
        with self.assertRaises(leakage.LeakageError):
            leakage.FitMetadata("bad", pd.Timestamp("2021-08-01"), pd.Timestamp("2024-08-01"), pd.Timestamp("2024-08-01"))
        with self.assertRaises(leakage.LeakageError):
            leakage.FitMetadata("bad", pd.Timestamp("2021-08-01"), pd.Timestamp("2024-05-30"), pd.Timestamp("2024-08-01"), "2024-25", "2024-25")

    def test_5_standings_brute_force(self) -> None:
        """Classement incrémental = reconstruction force brute, à plusieurs dates."""
        rows = replay.base_rows(self.match, self.tm)
        for season in ("2023-24", "2024-25"):
            g = rows[(rows["competition"] == "AAA") & (rows["season"] == season)]
            inc = standings.incremental(g[["match_id", "kickoff_utc", "feature_cutoff", "home_team_id", "away_team_id", "home_goals", "away_goals", "stage"]])
            for i in (0, 4, 11, 17, 29):
                r = g.iloc[i]
                bf = standings.brute_force(g, r["feature_cutoff"]).set_index("team_id")
                for t in (r["home_team_id"], r["away_team_id"]):
                    got = inc[(inc["match_id"] == r["match_id"]) & (inc["team_id"] == t)].iloc[0]
                    for c in ("played", "points", "goals_for", "goals_against", "goal_difference", "rank"):
                        self.assertEqual(int(got[c]), int(bf.at[t, c]), f"{season} {r['match_id']} {t} {c}")

    def test_6_simultaneous_matches_do_not_interact(self) -> None:
        """Deux matchs au même coup d'envoi : retirer l'un ne change pas les features de l'autre."""
        same = self.ds.groupby("kickoff_utc")["match_id"].apply(list)
        pairs = [v for v in same if len(v) >= 2][:6]
        self.assertTrue(pairs)
        for a, b in (p[:2] for p in pairs):
            without_b = features_of(replay.build_from_frames(self.match[self.match["match_id"] != b], self.tm[self.tm["match_id"] != b]))
            self._same(self.feat, without_b, [a])

    def test_7_row_order_independence(self) -> None:
        rng = np.random.default_rng(3)
        m = self.match.iloc[rng.permutation(len(self.match))].reset_index(drop=True)
        t = self.tm.iloc[rng.permutation(len(self.tm))].reset_index(drop=True)
        shuffled = replay.canonical(replay.build_from_frames(m, t))
        pd.testing.assert_frame_equal(replay.canonical(self.ds), shuffled, check_dtype=False)
        self.assertEqual(manifest.logical_hash(self.ds), manifest.logical_hash(shuffled))

    def test_8_identity_never_merged_by_name(self) -> None:
        """Deux équipes homonymes de compétitions différentes ne partagent ni classement ni forme."""
        a = self.ds[self.ds["competition"] == "AAA"]
        b = self.ds[self.ds["competition"] == "BBB"]
        self.assertTrue((a["home_team_name"] == "Fixture FC A").any() and (b["home_team_name"] == "Fixture FC A").any())
        self.assertFalse(set(a["home_team_id"]) & set(b["home_team_id"]))
        self.assertTrue((b["f_home_played"].dropna() <= 6).all())        # jamais gonflé par les matchs de AAA
        without_bbb = features_of(replay.build_from_frames(self.match[self.match["competition"] != "BBB"], self.tm[self.tm["competition"] != "BBB"]))
        self._same(self.feat, without_bbb, list(a["match_id"]))
        self.assertEqual(self.ds["match_id"].nunique(), len(self.ds))


class QualityTests(unittest.TestCase):
    def setUp(self):
        self.match, self.tm = fixture(1)
        self.ds = replay.build_from_frames(self.match, self.tm)

    def test_invariants_hold_and_violations_are_caught(self) -> None:
        self.assertEqual(leakage.validate(self.ds), [])
        bad = self.ds.copy()
        bad.loc[0, "result_1x2"] = "A" if bad.loc[0, "result_1x2"] != "A" else "H"
        bad.loc[1, "away_team_id"] = bad.loc[1, "home_team_id"]
        bad["f_home_rapm_now"] = 1.0
        errors = leakage.validate(bad)
        self.assertTrue(any("result_1x2" in e for e in errors))
        self.assertTrue(any("identiques" in e for e in errors))
        self.assertTrue(any("rapm" in e for e in errors))

    def test_cutoff_and_targets(self) -> None:
        self.assertTrue((self.ds["feature_cutoff"] < self.ds["kickoff_utc"]).all())
        self.assertEqual(set(self.ds["result_1x2"]) <= {"H", "D", "A"}, True)
        self.assertTrue(((self.ds["home_goals"] + self.ds["away_goals"] > 2.5) == self.ds["over_2_5"].astype(bool)).all())
        for c in replay.TARGETS:
            self.assertFalse(c.startswith("f_"))
        self.assertTrue(all(c.startswith("f_") for c in replay.feature_columns()))

    def test_missing_history_is_null_with_flag(self) -> None:
        first = self.ds[(self.ds["competition"] == "AAA") & (self.ds["season"] == "2023-24")].iloc[0]
        self.assertTrue(pd.isna(first["f_home_points_last5"]))
        self.assertIn("home_points_last5", first["missing_flags"])
        self.assertEqual(first["f_home_matches_last8d"], 0.0)
        self.assertTrue(pd.isna(first["f_home_promoted"]))              # pas de saison précédente dans les données
        second = self.ds[(self.ds["competition"] == "AAA") & (self.ds["season"] == "2024-25")].iloc[0]
        self.assertEqual(second["f_home_promoted"], False)
        cup = self.ds[self.ds["competition"] == "CCC"].iloc[0]
        self.assertFalse(cup["standings_available"])
        self.assertIn("no_standings", cup["data_quality_flags"])

    def test_rest_days_and_congestion(self) -> None:
        rows = self.ds[(self.ds["competition"] == "AAA")].sort_values("kickoff_utc")
        r = rows.iloc[6]                                                  # troisième journée : repos 7 jours ou moins
        self.assertLessEqual(r["f_home_rest_days"], 7.0)
        self.assertGreaterEqual(r["f_home_matches_last8d"], 1.0)


def _odds_csv(rows: pd.DataFrame, comp: str, kind: str) -> str:
    """CSV football-data synthétique à partir de lignes du dataset : cotes fictives, une ligne non appariable."""
    h, a, hg, ag = ("HomeTeam", "AwayTeam", "FTHG", "FTAG") if kind == "main" else ("Home", "Away", "HG", "AG")
    out = []
    for r in rows.itertuples():
        base = 1 / 0.45
        rec = {"Date": pd.Timestamp(r.match_date).strftime("%d/%m/%Y"), "Time": "15:00", h: r.home_team_name, a: r.away_team_name,
               hg: r.home_goals, ag: r.away_goals, "AvgH": round(base, 2), "AvgD": 3.4, "AvgA": 3.9,
               "PSCH": round(base * 0.98, 2), "PSCD": 3.5, "PSCA": 3.8}
        if kind == "main":
            rec.update({"B365H": 2.2, "B365D": 3.4, "B365A": 3.6, "Avg>2.5": 1.9, "Avg<2.5": 1.95, "AvgC>2.5": 1.88, "AvgC<2.5": 1.97})
        else:
            rec = {("Home" if k == h else "Away" if k == a else k): v for k, v in rec.items()}
            rec.update({"PH": 2.2, "PD": 3.4, "PA": 3.6, "PCH": round(base * 0.98, 2), "PCD": 3.5, "PCA": 3.8})
            rec.pop("PSCH"); rec.pop("PSCD"); rec.pop("PSCA")
        out.append(rec)
    out.append({**out[0], "Date": "01/01/2030", h if kind == "main" else "Home": "Fixture Ghost", a if kind == "main" else "Away": "Fixture Phantom"})
    return pd.DataFrame(out).to_csv(index=False)


class OddsTests(unittest.TestCase):
    def setUp(self):
        self.match, self.tm = fixture(2)
        self.ds = replay.build_from_frames(self.match, self.tm)

    def test_adapter_join_semantics_and_unmatched(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            d = Path(tmp)
            aaa = self.ds[(self.ds["competition"] == "AAA") & (self.ds["season"] == "2024-25")]
            (d / "2425_E0.csv").write_text(_odds_csv(aaa, "AAA", "main"), encoding="utf-8")
            bbb = self.ds[(self.ds["competition"] == "BBB")]
            (d / "new_ARG.csv").write_text(_odds_csv(bbb, "BBB", "new"), encoding="latin-1")
            saved = dict(odds_mod.MAIN_LEAGUES), dict(odds_mod.EXTRA_LEAGUES)
            odds_mod.MAIN_LEAGUES.clear(); odds_mod.MAIN_LEAGUES["AAA"] = "E0"
            odds_mod.EXTRA_LEAGUES.clear(); odds_mod.EXTRA_LEAGUES["BBB"] = "ARG"
            try:
                odds, used = odds_mod.load_directory(d, ["2024-25"])
            finally:
                odds_mod.MAIN_LEAGUES.clear(); odds_mod.MAIN_LEAGUES.update(saved[0])
                odds_mod.EXTRA_LEAGUES.clear(); odds_mod.EXTRA_LEAGUES.update(saved[1])
            self.assertEqual(len(used), 2)
            mapping, table = odds_mod.map_teams(odds, self.ds)
            self.assertIn(("AAA", "Fixture FC A"), mapping)
            self.assertIn(("BBB", "Fixture FC A"), mapping)
            self.assertNotEqual(mapping[("AAA", "Fixture FC A")], mapping[("BBB", "Fixture FC A")])   # homonymes séparés
            joined, unmatched = odds_mod.join(self.ds, odds, mapping)
            self.assertEqual(len(joined), len(self.ds))
            self.assertEqual(int(joined["odds_has_snapshot_1x2"].sum()), len(aaa) + len(bbb))
            self.assertEqual(int(joined["odds_has_closing_1x2"].sum()), len(aaa) + len(bbb))
            self.assertEqual(int(joined["odds_has_snapshot_ou25"].sum()), len(aaa))         # pas de O/U dans les fichiers « new »
            self.assertEqual(set(joined.loc[joined["odds_has_snapshot_1x2"], "odds_snapshot_1x2_provider"]), {"market_average"})
            self.assertEqual(set(joined.loc[joined["odds_has_closing_1x2"], "odds_closing_1x2_provider"]), {"pinnacle"})
            self.assertEqual(len(unmatched), 2)                                            # les deux lignes fantômes, jamais cachées
            self.assertEqual(set(unmatched["reason"]), {"team_not_mapped"})
            sem = joined["odds_semantics"].value_counts()
            self.assertEqual(int(sem.get("available_snapshot+closing", 0)), len(aaa) + len(bbb))
            self.assertEqual(int(sem.get("none", 0)), len(self.ds) - len(aaa) - len(bbb))
            self.assertEqual(leakage.validate(joined), [])
            view = leakage.features_view(joined)
            self.assertNotIn("odds_closing_1x2_home", view.columns)
            man = manifest.build_manifest(joined, pd.DataFrame(columns=["competition", "season", "match_id", "reason"]), [], list(used),
                                          unmatched, table, {"featureCutoffHours": 3}, Path(tmp), {})
            self.assertEqual(man["summary"]["oddsSemanticsRows"]["unknown"], 0)
            self.assertEqual(man["summary"]["unmatchedOddsRows"], 2)
            self.assertTrue(any(f["snapshot_type"] == "available_snapshot" for f in man["oddsFields"]))

    def test_power_devig_sums_to_one(self) -> None:
        p = odds_mod.power_devig(np.array([[2.0, 3.4, 3.9], [1.5, 4.0, np.nan]]))
        self.assertAlmostEqual(float(p[0].sum()), 1.0, places=6)
        self.assertTrue(np.isnan(p[1]).all())


class ReproducibilityTests(unittest.TestCase):
    def test_two_builds_are_identical(self) -> None:
        match, tm = fixture(4)
        a = replay.build_from_frames(match, tm)
        b = replay.build_from_frames(match.copy(), tm.copy())
        pd.testing.assert_frame_equal(a, b)
        self.assertEqual(manifest.logical_hash(a), manifest.logical_hash(b))
        with tempfile.TemporaryDirectory() as tmp:
            f = Path(tmp) / "tables-AAA-2024-25.tar"; f.write_bytes(b"fixture")
            h1, _ = manifest.input_hash([f], [], {"x": 1}, Path(tmp))
            h2, _ = manifest.input_hash([f], [], {"x": 1}, Path(tmp))
            h3, _ = manifest.input_hash([f], [], {"x": 2}, Path(tmp))
            self.assertEqual(h1, h2); self.assertNotEqual(h1, h3)


if __name__ == "__main__":
    unittest.main()
