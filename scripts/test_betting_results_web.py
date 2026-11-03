"""
Tests du lecteur de résultats web (scripts/betting/results_web.py) et de l'historique des soirées
(evening.py) sur des réponses synthétiques, sans réseau.

  python3 -m unittest test_betting_results_web -v        # ou : npm run test:data
"""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

import pandas as pd

from betting import COMPETITIONS, TOURNAMENTS, evening, results_web


def payload():
    """Deux rencontres : une terminée 2-1 (mi-temps 0-1, premier but extérieur, dernier but domicile, un but
    contre son camp crédité au domicile), une non terminée."""
    return {"events": [
        {"id": "1", "date": "2026-11-02T19:45Z", "competitions": [{"status": {"type": {"completed": True}}, "competitors": [
            {"homeAway": "home", "score": "2", "team": {"id": "10", "displayName": "Club A"}, "linescores": [{"value": 0}, {"value": 2}]},
            {"homeAway": "away", "score": "1", "team": {"id": "20", "displayName": "Club B"}, "linescores": [{"value": 1}, {"value": 0}]}],
            "details": [{"scoringPlay": True, "team": {"id": "20"}, "clock": {"value": 1500}},
                        {"scoringPlay": True, "team": {"id": "20"}, "clock": {"value": 3900}, "ownGoal": True},
                        {"scoringPlay": True, "team": {"id": "10"}, "clock": {"value": 5200}},
                        {"scoringPlay": False, "team": {"id": "10"}, "clock": {"value": 5300}}]}]},
        {"id": "2", "date": "2026-11-02T20:00Z", "competitions": [{"status": {"type": {"completed": False}}, "competitors": [
            {"homeAway": "home", "score": "0", "team": {"id": "30", "displayName": "Club C"}}, {"homeAway": "away", "score": "0", "team": {"id": "40", "displayName": "Club D"}}]}]}]}


class ScopeTests(unittest.TestCase):
    def test_every_competition_has_odds_and_results_sources(self):
        # une compétition sans tournoi OddsPapi n'a jamais de cotes, une sans ligue ESPN n'est jamais réglée
        self.assertEqual(set(COMPETITIONS), set(TOURNAMENTS))
        self.assertEqual(set(results_web.ESPN), set(COMPETITIONS))
        self.assertTrue({"UCL", "UEL", "UECL"} <= set(COMPETITIONS))


class ParseTests(unittest.TestCase):
    def test_parse_scores_halves_and_goal_order(self):
        rows = results_web.parse(payload(), "AAA")
        self.assertEqual(len(rows), 2)
        a = rows[0]
        self.assertEqual((a["ft_home"], a["ft_away"], a["ht_home"], a["ht_away"]), (2, 1, 0, 1))
        self.assertEqual(a["first_goal"], "away")
        self.assertEqual(a["last_goal"], "home")
        self.assertTrue(a["completed"]); self.assertFalse(rows[1]["completed"])
        self.assertIsNone(rows[1]["first_goal"])

    def test_as_results_keeps_only_completed_and_matched(self):
        df = pd.DataFrame(results_web.parse(payload(), "AAA"), columns=results_web.COLUMNS)
        df.loc[0, "match_id"] = "m1"
        r = results_web.as_results(df)
        self.assertEqual(r["match_id"].tolist(), ["m1"])
        self.assertEqual(int(r.iloc[0]["goals_first_half"]), 1)
        self.assertEqual(r.iloc[0]["last_goal"], "home")

    def test_save_is_idempotent(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "r.parquet"
            df = pd.DataFrame(results_web.parse(payload(), "AAA"), columns=results_web.COLUMNS)
            self.assertEqual(len(results_web.save(df, p)), 2)
            self.assertEqual(len(results_web.save(df, p)), 2)


class MergeTests(unittest.TestCase):
    def test_web_results_get_team_ids_and_feed_features(self):
        from betting import adjust, product
        base = pd.DataFrame([{"match_id": "p1", "competition": "AAA", "season": "2026-27", "kickoff_utc": pd.Timestamp("2026-10-01 15:00", tz="UTC"), "home_team_id": "t1", "away_team_id": "t2",
                              "home_team_name": "Club A", "away_team_name": "Club B", "ft_home": 1, "ft_away": 0, "ht_home": 0, "ht_away": 0, "first_goal": "home", "last_goal": "home",
                              "goals_first_half": 0, "goals_total": 1, "extra_time": False, "awarded": False}])
        df = pd.DataFrame(results_web.parse(payload(), "AAA"), columns=results_web.COLUMNS)
        df.loc[0, "match_id"] = "w1"
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "results_web.parquet"
            df.to_parquet(path, index=False)
            orig = (product._pitchapi_results, product.RESEARCH)
            product._pitchapi_results = lambda: base
            product.RESEARCH = Path(tmp)
            try:
                merged = product.load_results()
            finally:
                product._pitchapi_results, product.RESEARCH = orig
        self.assertEqual(len(merged), 2)
        self.assertEqual(merged.iloc[1]["home_team_id"], "t1")          # retrouvé par le nom
        self.assertEqual(merged.iloc[1]["away_team_id"], "t2")
        feats = adjust.compute_features(merged, 120)                       # ne plante plus sur des identifiants absents
        self.assertEqual(len(feats), 2)


class EveningTests(unittest.TestCase):
    def test_settle_singles_and_combo_with_refund(self):
        with tempfile.TemporaryDirectory() as tmp:
            evening.EVENINGS = Path(tmp) / "evenings.json"
            bets = [{"match": "m1", "label": "Moins de 3,5 buts", "spec": {"market_type": "totals", "handicap": 3.5, "outcome": "Under"}, "odds": 1.5, "stake": 10},
                    {"match": "m1", "label": "Plus de 3 buts", "spec": {"market_type": "totals", "handicap": 3.0, "outcome": "Over"}, "odds": 2.0, "stake": 10},
                    {"match": "m1", "label": "Club A -0,75", "spec": {"market_type": "spreads", "handicap": -0.75, "outcome": "1"}, "odds": 2.0, "stake": 10},
                    {"match": "combo", "combo": [{"key": "m1", "label": "U3,5", "spec": {"market_type": "totals", "handicap": 3.5, "outcome": "Under"}, "odds": 1.5},
                                                 {"key": "m1", "label": "O3", "spec": {"market_type": "totals", "handicap": 3.0, "outcome": "Over"}, "odds": 2.0}], "stake": 10}]
            evening.add("2026-11-02", bets)
            with self.assertRaises(SystemExit):
                evening.add("2026-11-02", bets)                     # jamais réécrite
            e = evening.settle("2026-11-02", {"m1": {"ft": [2, 1], "ht": [0, 1]}})
            self.assertEqual([b["result"] for b in e["bets"]], ["gagné", "remboursé", "moitié gagnée", "gagné"])
            self.assertEqual([b["profit"] for b in e["bets"]], [5.0, 0.0, 5.0, 5.0])  # combiné : O3 remboursé → cote 1,5
            self.assertEqual(e["profit"], 15.0); self.assertTrue(e["settled"])
            missing = evening.settle("2026-11-02", {})
            self.assertEqual(missing["profit"], 15.0)                 # déjà réglée : inchangée
            self.assertIn("2026-11-02", evening.show())


if __name__ == "__main__":
    unittest.main()
