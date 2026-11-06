"""
Tests du lecteur de résultats web (scripts/betting/results_web.py) et de l'historique des soirées
(evening.py) sur des réponses synthétiques, sans réseau.

  python3 -m unittest tests.test_betting_results_web -v        # ou : npm run test:data
"""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

import pandas as pd

from betting import COMPETITIONS, TOURNAMENTS, evening, results_web


def goal(team, minute, own=False):
    """But au format réel du tableau de scores ESPN : minute affichée (« 43' », « 45'+2' »), équipe créditée du but
    (pour un but contre son camp, l'équipe bénéficiaire), sans période ni score de mi-temps."""
    base, _, added = minute.partition("+")
    value = int(base) * 60 + (int(added) * 60 if added else 0)
    return {"scoringPlay": True, "team": {"id": team}, "clock": {"value": float(value), "displayValue": f"{base}'" + (f"+{added}'" if added else "")}, "ownGoal": own}


def event(eid, home, away, score, details, completed=True, period=2, name="STATUS_FULL_TIME"):
    return {"id": eid, "date": "2026-11-02T19:45Z", "competitions": [{"status": {"period": period, "type": {"completed": completed, "name": name}}, "competitors": [
        {"homeAway": "home", "score": str(score[0]), "team": {"id": home[0], "displayName": home[1]}},
        {"homeAway": "away", "score": str(score[1]), "team": {"id": away[0], "displayName": away[1]}}], "details": details}]}


def payload():
    """Deux rencontres au format réel (pas de `linescores`) : une terminée 2-1, mi-temps 0-1 (but extérieur à 45'+2'),
    un but contre son camp crédité au domicile (équipe bénéficiaire), dernier but domicile à 90'+3' ; une non terminée."""
    return {"events": [
        event("1", ("10", "Club A"), ("20", "Club B"), (2, 1), [goal("20", "45+2"), goal("10", "65", own=True), goal("10", "90+3"),
                                                              {"scoringPlay": False, "team": {"id": "10"}, "clock": {"value": 5300.0, "displayValue": "88'"}}]),
        event("2", ("30", "Club C"), ("40", "Club D"), (0, 0), [], completed=False, period=0, name="STATUS_SCHEDULED")]}


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
        # mi-temps reconstruite à partir des minutes : 45'+2' est en première mi-temps, 90'+3' en seconde
        self.assertEqual((a["ft_home"], a["ft_away"], a["ht_home"], a["ht_away"]), (2, 1, 0, 1))
        self.assertEqual(a["first_goal"], "away")
        self.assertEqual(a["last_goal"], "home")
        self.assertTrue(a["completed"]); self.assertFalse(rows[1]["completed"])
        self.assertIsNone(rows[1]["first_goal"])

    def test_own_goal_is_already_credited_to_the_beneficiary(self):
        # ESPN crédite le but contre son camp à l'équipe qui en profite : l'inverser une seconde fois fausse le premier but
        p = {"events": [event("3", ("10", "Club A"), ("20", "Club B"), (1, 0), [goal("10", "12", own=True)])]}
        r = results_web.parse(p, "AAA")[0]
        self.assertEqual((r["ht_home"], r["ht_away"], r["first_goal"], r["last_goal"]), (1, 0, "home", "home"))

    def test_goalless_match_has_a_known_half_time(self):
        r = results_web.parse({"events": [event("4", ("10", "Club A"), ("20", "Club B"), (0, 0), [])]}, "AAA")[0]
        self.assertEqual((r["ht_home"], r["ht_away"], r["first_goal"], r["last_goal"]), (0, 0, "none", "none"))

    def test_goals_that_do_not_rebuild_the_score_give_no_half_time(self):
        # un but absent des détails : la mi-temps et l'ordre des buts sont inconnus, jamais 0-0
        missing = event("5", ("10", "Club A"), ("20", "Club B"), (2, 0), [goal("10", "30")])
        unreadable = event("6", ("10", "Club A"), ("20", "Club B"), (1, 0), [{"scoringPlay": True, "team": {"id": "10"}, "clock": {"value": 100.0, "displayValue": "?"}}])
        no_details = event("7", ("10", "Club A"), ("20", "Club B"), (1, 1), [])
        for r in results_web.parse({"events": [missing, unreadable, no_details]}, "AAA"):
            self.assertTrue(r["completed"])
            self.assertIsNone(r["ht_home"]); self.assertIsNone(r["ht_away"])
            self.assertIsNone(r["first_goal"]); self.assertIsNone(r["last_goal"])

    def test_extra_time_is_not_a_regulation_result(self):
        # prolongation ou tirs au but : le score final n'est pas celui du temps réglementaire, la rencontre n'est pas réglée
        aet = event("8", ("10", "Club A"), ("20", "Club B"), (2, 1), [goal("10", "20"), goal("20", "80"), goal("10", "105")], period=4, name="STATUS_FINAL_AET")
        df = pd.DataFrame(results_web.parse({"events": [aet]}, "AAA"), columns=results_web.COLUMNS)
        df.loc[0, "match_id"] = "m8"
        self.assertTrue(bool(df.iloc[0]["completed"]))
        self.assertTrue(results_web.as_results(df).empty)

    def test_as_results_keeps_only_completed_and_matched(self):
        df = pd.DataFrame(results_web.parse(payload(), "AAA"), columns=results_web.COLUMNS)
        df.loc[0, "match_id"] = "m1"
        r = results_web.as_results(df)
        self.assertEqual(r["match_id"].tolist(), ["m1"])
        self.assertEqual(int(r.iloc[0]["goals_first_half"]), 1)
        self.assertEqual(r.iloc[0]["last_goal"], "home")

    def test_as_results_keeps_an_unknown_half_time_unknown(self):
        df = pd.DataFrame(results_web.parse({"events": [event("5", ("10", "Club A"), ("20", "Club B"), (2, 0), [goal("10", "30")])]}, "AAA"), columns=results_web.COLUMNS)
        df.loc[0, "match_id"] = "m5"
        r = results_web.as_results(df).iloc[0]
        self.assertEqual((int(r["ft_home"]), int(r["ft_away"])), (2, 0))
        self.assertTrue(pd.isna(r["ht_home"]) and pd.isna(r["ht_away"]))          # jamais remplacée par 0-0
        self.assertTrue(pd.isna(r["first_goal"]) and pd.isna(r["last_goal"]))

    def test_dates_with_incomplete_rows_are_listed_for_a_new_reading(self):
        df = pd.DataFrame(results_web.parse({"events": [event("5", ("10", "Club A"), ("20", "Club B"), (2, 0), [goal("10", "30")])]}, "AAA"), columns=results_web.COLUMNS)
        old = df.copy(); old["date"] = "2026-10-01"
        done = pd.DataFrame(results_web.parse(payload(), "AAA"), columns=results_web.COLUMNS)
        stored = pd.concat([df, old, done], ignore_index=True)
        import datetime as dt
        self.assertEqual(results_web.incomplete_dates(stored, dt.date(2026, 11, 6), days=14), [dt.date(2026, 11, 2)])

    def test_save_is_idempotent(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "r.parquet"
            df = pd.DataFrame(results_web.parse(payload(), "AAA"), columns=results_web.COLUMNS)
            self.assertEqual(len(results_web.save(df, p)), 2)
            self.assertEqual(len(results_web.save(df, p)), 2)

    def test_a_new_reading_never_loses_a_known_match_id(self):
        # une date relue après l'export suivant : le match n'est plus dans forecast.json, son appariement est gardé
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "r.parquet"
            first = pd.DataFrame(results_web.parse(payload(), "AAA"), columns=results_web.COLUMNS)
            first.loc[0, "match_id"] = "m1"
            results_web.save(first, p)
            again = pd.DataFrame(results_web.parse(payload(), "AAA"), columns=results_web.COLUMNS)
            merged = results_web.save(again, p)
            self.assertEqual(merged.set_index("source_id").loc["1", "match_id"], "m1")


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

    def test_pending_evenings_are_settled_with_later_scores(self):
        import datetime as dt
        with tempfile.TemporaryDirectory() as tmp:
            evening.EVENINGS = Path(tmp) / "evenings.json"
            under = {"market_type": "totals", "handicap": 2.5, "outcome": "Under"}
            evening.add("2026-11-02", [{"match": "m1", "match_id": "m1", "label": "U2,5", "spec": under, "odds": 1.5, "stake": 10},
                                       {"match": "combo", "combo": [{"key": "m1", "label": "U2,5", "spec": under, "odds": 1.5},
                                                                    {"key": "m2", "label": "U2,5", "spec": under, "odds": 2.0}], "stake": 10}])
            evening.add("2026-10-20", [{"match": "m0", "label": "U2,5", "spec": under, "odds": 1.5, "stake": 10}])   # trop ancienne : ignorée
            scores = {"2026-11-02": {"m1": {"ft": [1, 0], "ht": [0, 0]}}, "2026-11-03": {"m2": {"ft": [0, 0], "ht": [0, 0]}}}
            original = evening.scores_from_results
            evening.scores_from_results = lambda d: scores.get(d, {})
            try:
                first = evening.settle_pending(dt.date(2026, 11, 2))      # le combiné attend le match du lendemain
                self.assertEqual([b["result"] for b in first[0]["bets"]], ["gagné", None]); self.assertFalse(first[0]["settled"])
                done = evening.settle_pending(dt.date(2026, 11, 3))
            finally:
                evening.scores_from_results = original
            self.assertEqual(len(done), 1)
            self.assertEqual([b["profit"] for b in done[0]["bets"]], [5.0, 20.0]); self.assertTrue(done[0]["settled"])


    def test_half_time_bet_without_half_time_stays_pending_and_is_resettled(self):
        with tempfile.TemporaryDirectory() as tmp:
            evening.EVENINGS = Path(tmp) / "evenings.json"
            ht_under = {"market_type": "totals", "period": "p1", "handicap": 1.5, "outcome": "Under"}
            ft_under = {"market_type": "totals", "handicap": 2.5, "outcome": "Under"}
            evening.add("2026-11-02", [{"match": "m1", "label": "Moins de 1,5 but (1re mi-temps)", "spec": ht_under, "odds": 1.5, "stake": 10},
                                       {"match": "m1", "label": "Moins de 2,5 buts", "spec": ft_under, "odds": 2.0, "stake": 10}])
            e = evening.settle("2026-11-02", {"m1": {"ft": [3, 0], "ht": None, "first_goal": None, "last_goal": None}})
            self.assertEqual([b["result"] for b in e["bets"]], [None, "perdu"])     # mi-temps inconnue : en attente, jamais 0-0
            self.assertFalse(e["settled"]); self.assertEqual(e["profit"], -10.0)
            # une soirée déjà réglée sur une mi-temps fausse est réglée à nouveau quand le vrai score arrive
            e = evening.settle("2026-11-02", {"m1": {"ft": [3, 0], "ht": [2, 0], "first_goal": "home", "last_goal": "home"}})
            self.assertEqual([b["result"] for b in e["bets"]], ["perdu", "perdu"]); self.assertTrue(e["settled"]); self.assertEqual(e["profit"], -20.0)
            e = evening.settle("2026-11-02", {"m1": {"ft": [3, 0], "ht": None, "first_goal": None, "last_goal": None}})
            self.assertEqual([b["result"] for b in e["bets"]], [None, "perdu"]); self.assertFalse(e["settled"])

    def test_settled_evenings_of_the_window_are_resettled(self):
        import datetime as dt
        with tempfile.TemporaryDirectory() as tmp:
            evening.EVENINGS = Path(tmp) / "evenings.json"
            ht_under = {"market_type": "totals", "period": "p1", "handicap": 1.5, "outcome": "Under"}
            evening.add("2026-11-02", [{"match": "m1", "match_id": "m1", "label": "U1,5 MT", "spec": ht_under, "odds": 1.5, "stake": 10}])
            evening.settle("2026-11-02", {"m1": {"ft": [2, 0], "ht": [0, 0]}})       # ancien règlement sur une mi-temps 0-0 inventée
            original = evening.scores_from_results
            evening.scores_from_results = lambda d: {"m1": {"ft": [2, 0], "ht": [2, 0], "first_goal": "home", "last_goal": "home"}} if d == "2026-11-02" else {}
            try:
                done = evening.settle_pending(dt.date(2026, 11, 4))
            finally:
                evening.scores_from_results = original
            self.assertEqual([b["result"] for b in done[0]["bets"]], ["perdu"]); self.assertEqual(done[0]["profit"], -10.0)

    def test_scores_from_results_keep_an_unknown_half_time(self):
        from betting import product
        rows = pd.DataFrame([{"match_id": "m1", "kickoff_utc": pd.Timestamp("2026-11-02 19:45", tz="UTC"), "ft_home": 2, "ft_away": 0, "ht_home": None, "ht_away": None,
                              "first_goal": None, "last_goal": None}])
        original = product.load_results
        product.load_results = lambda: rows
        try:
            s = evening.scores_from_results("2026-11-02")
        finally:
            product.load_results = original
        self.assertEqual(s["m1"]["ft"], [2, 0]); self.assertIsNone(s["m1"]["ht"]); self.assertIsNone(s["m1"]["first_goal"])


if __name__ == "__main__":
    unittest.main()
