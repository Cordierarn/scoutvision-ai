"""
Tests du moteur de suggestions (scripts/betting/suggest.py) et du produit (product.py) sans réseau ni
données réelles : classement par profil, doublons, cote ancienne, famille exclue, combiné, mises (Kelly rétréci), bilan et
journal. Le coupe-circuit et la référence sharp sont testés dans test_betting_quant.

  python3 -m unittest tests.test_betting_suggest -v        # ou : npm run test:data
"""

from __future__ import annotations

import datetime as dt
import tempfile
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

from betting import markets as mk
from betting import product
from betting import simulate as sm
from betting import suggest as sg

KO = dt.datetime(2026, 11, 7, 15, 0, tzinfo=dt.timezone.utc)
NOW = dt.datetime(2026, 11, 7, 13, 30, tzinfo=dt.timezone.utc)


def outcome(t, name, odds, period="fulltime", hcp=0.0, at=None, mid=None, oid=None):
    key = hash((t, name, period, hcp)) % 100000
    return {"market_id": mid or key, "outcome_id": oid or key * 10 + 1, "spec": mk.Spec(t, period, hcp, name), "odds": odds, "odds_at": at or NOW - dt.timedelta(minutes=20),
            "home": "Club A", "away": "Club B"}


def market_1x2(o1, ox, o2, at=None):
    return [outcome("1x2", "1", o1, at=at, mid=101, oid=101), outcome("1x2", "X", ox, at=at, mid=101, oid=102), outcome("1x2", "2", o2, at=at, mid=101, oid=103)]


class SelectionTests(unittest.TestCase):
    def setUp(self):
        self.sims = sm.simulate(1.7, 0.9, 0.45)

    def test_profiles_rank_a_complete_market_differently(self):
        cands = sg.evaluate_candidates(self.sims, market_1x2(1.70, 3.80, 5.50), KO, NOW)
        self.assertEqual(len(cands), 3)
        sur = sg.rank(cands, "sur")
        self.assertEqual(sur[0].candidate.spec.outcome, "1")                       # la plus probable
        self.assertTrue(all(s.candidate.odds >= sg.MIN_ODDS for s in sur))
        grosse = sg.rank(cands, "grosse_cote")
        self.assertTrue(all(s.candidate.odds >= sg.BIG_ODDS for s in grosse))        # cote ≥ 3 seulement
        self.assertEqual(len(grosse), 2)
        eq = sg.rank(cands, "equilibre")
        self.assertAlmostEqual(eq[0].score, eq[0].candidate.p * (1 + eq[0].candidate.ev), places=9)
        self.assertEqual(eq[0].score, max(s.score for s in eq))

    def test_near_duplicates_keep_the_best_ranked(self):
        outs = [outcome("totals", "Over", 1.35, hcp=1.5, mid=1, oid=11), outcome("totals", "Over", 1.95, hcp=2.5, mid=2, oid=21),
                outcome("exactscore", "3+", 1.90, mid=3, oid=31), outcome("totals", "Under", 1.85, hcp=2.5, mid=2, oid=22)]
        cands = sg.evaluate_candidates(self.sims, outs, KO, NOW)
        ranked = sg.rank(cands, "sur")
        groups = [s.candidate.group for s in ranked]
        self.assertEqual(len(groups), len(set(groups)))
        self.assertEqual(sum(1 for s in ranked if s.candidate.group.startswith("over|")), 1)
        self.assertEqual(ranked[0].candidate.spec.handicap, 1.5)                   # plus probable des « over »

    def test_equivalent_selections_across_markets_are_deduplicated(self):
        outs = [outcome("correctscore", "0:0", 9.0, mid=1, oid=11), outcome("exactscore", "0", 9.0, mid=2, oid=21), outcome("firstgoal", "No Goal", 9.0, mid=3, oid=31),
                outcome("lastgoal", "No Goal", 9.0, mid=4, oid=41), outcome("totals", "Under", 9.0, hcp=1.0, mid=5, oid=51), outcome("1x2", "X", 3.3, mid=101, oid=102)]
        ranked = sg.rank(sg.evaluate_candidates(self.sims, outs, KO, NOW), "grosse_cote")
        labels = [s.candidate.label for s in ranked]
        self.assertEqual(sum(1 for l in labels if "0-0" in l or "Aucun but" in l or "0 but" in l or "Moins de 1 but" in l), 1, labels)
        self.assertEqual(sg.describe(mk.Spec("totals", "fulltime", 1.0, "Under"), "A", "B"), "Moins de 1 but")

    def test_old_odds_are_never_suggested(self):
        old = NOW - dt.timedelta(hours=2, minutes=1)
        cands = sg.evaluate_candidates(self.sims, market_1x2(1.70, 3.80, 5.50, at=old), KO, NOW)
        self.assertTrue(all(c.excluded == "cote_ancienne" for c in cands))
        gone = market_1x2(1.70, 3.80, 5.50)
        gone[1]["withdrawn"] = True                                                 # issue absente du dernier relevé Winamax
        gone_cands = sg.evaluate_candidates(self.sims, gone, KO, NOW)
        self.assertEqual([c.excluded for c in gone_cands], [None, "marche_retire", None])
        self.assertEqual(sg.rank(cands, "sur"), [])
        after_ko = sg.evaluate_candidates(self.sims, market_1x2(1.70, 3.80, 5.50, at=KO + dt.timedelta(minutes=1)), KO, KO + dt.timedelta(minutes=2))
        self.assertTrue(all(c.excluded for c in after_ko))

    def test_badly_calibrated_family_and_low_odds_are_excluded(self):
        cands = sg.evaluate_candidates(self.sims, market_1x2(1.25, 3.80, 5.50), KO, NOW, excluded_families={("résultat", "AAA")}, competition="AAA")
        self.assertEqual([c.excluded for c in cands], ["cote_minimale", "famille_mal_calibree", "famille_mal_calibree"])
        other = sg.evaluate_candidates(self.sims, market_1x2(1.25, 3.80, 5.50), KO, NOW, excluded_families={("résultat", "AAA")}, competition="BBB")
        self.assertEqual([c.excluded for c in other], ["cote_minimale", None, None])

    def test_labels_are_readable(self):
        self.assertEqual(sg.describe(mk.Spec("1x2", "fulltime", 0.0, "1"), "Club A", "Club B"), "Club A gagne")
        self.assertEqual(sg.describe(mk.Spec("totals", "p1", 1.5, "Under"), "Club A", "Club B"), "Moins de 1,5 buts (1re mi-temps)")
        self.assertEqual(sg.describe(mk.Spec("spreads", "fulltime", -1.5, "1"), "Club A", "Club B"), "Club A avec handicap -1,5")
        self.assertEqual(sg.describe(mk.Spec("spreads", "fulltime", -1.5, "2"), "Club A", "Club B"), "Club B avec handicap +1,5")
        self.assertEqual(sg.describe(mk.Spec("winningmargin", "fulltime", 0.0, "2 By 3+"), "Club A", "Club B"), "Club B gagne de 3 buts ou plus")


class ComboTests(unittest.TestCase):
    def setUp(self):
        self.sims = sm.simulate(1.7, 0.9, 0.45)

    def test_joint_probability_is_co_occurrence(self):
        outs = market_1x2(1.70, 3.80, 5.50) + [outcome("totals", "Under", 2.10, hcp=3.5, mid=5, oid=51)]
        cands = sg.evaluate_candidates(self.sims, outs, KO, NOW)
        ranked = sg.rank(cands, "sur")
        combo = sg.combine(ranked, "sur")
        self.assertIsNotNone(combo)
        masks = [c.win_mask for c in combo.candidates]
        self.assertAlmostEqual(combo.joint_p, float(np.logical_and.reduce(masks).mean()), places=12)
        self.assertAlmostEqual(combo.odds, float(np.prod([c.odds for c in combo.candidates])), places=9)
        self.assertLess(combo.joint_p, min(c.p for c in combo.candidates))

    def test_combo_bounds_on_joint_probability_and_odds(self):
        sims = sm.simulate(1.3, 1.2, 0.45)
        outs = [outcome("correctscore", "3:2", 35.0, mid=1, oid=11), outcome("winningmargin", "1 By 1", 3.4, mid=2, oid=21), outcome("firstgoal", "2", 3.2, mid=3, oid=31),
                outcome("totals", "Over", 3.1, hcp=4.5, mid=4, oid=41), outcome("halftime-fulltime", "2/1", 15.0, mid=5, oid=51)]
        ranked = sg.rank(sg.evaluate_candidates(sims, outs, KO, NOW), "grosse_cote")
        combo = sg.combine(ranked, "grosse_cote")
        if combo is not None:
            self.assertGreaterEqual(combo.joint_p, sg.COMBO_MIN_JOINT_P)
            self.assertLessEqual(combo.odds, sg.COMBO_MAX_ODDS)

    def test_incompatible_selections_are_never_combined(self):
        outs = market_1x2(1.70, 3.80, 5.50)
        cands = sg.evaluate_candidates(self.sims, outs, KO, NOW)
        ranked = sg.rank(cands, "grosse_cote")   # X et 2 : jamais gagnés ensemble
        self.assertIsNone(sg.combine(ranked, "grosse_cote"))
        nested = [outcome("totals", "Over", 1.40, hcp=1.5, mid=1, oid=11), outcome("bothteamsscore", "Yes", 1.70, mid=7, oid=71)]
        c2 = sg.evaluate_candidates(self.sims, nested, KO, NOW)
        r2 = sg.rank(c2, "sur")
        combo = sg.combine(r2, "sur")
        if combo is not None:  # BTTS implique plus de 1,5 : emboîtées, donc jamais combinées
            self.fail("sélections emboîtées combinées")


class StakeTests(unittest.TestCase):
    def test_shrink_kelly_known_cases(self):
        self.assertAlmostEqual(sg.kelly_fraction(0.6, 2.0), 0.2)
        c = sg.Candidate(1, 1, mk.Spec("1x2", "fulltime", 0.0, "1"), 2.0, NOW, 0.6, 0.2, np.array([True]))
        f, mode = sg.stake_for(c)
        self.assertEqual(mode, "kelly"); self.assertAlmostEqual(f, 0.025)             # κ 0,15 × 0,2 = 0,03 → plafond 2,5 %
        c2 = sg.Candidate(1, 1, mk.Spec("1x2", "fulltime", 0.0, "1"), 2.0, NOW, 0.55, 0.1, np.array([True]))
        self.assertAlmostEqual(sg.stake_for(c2)[0], 0.015)                           # 0,15 × (1,1 − 1) / 1
        self.assertEqual(sg.kelly_fraction(0.3, 2.0), 0.0)
        big = sg.Candidate(1, 1, mk.Spec("1x2", "fulltime", 0.0, "2"), 4.0, NOW, 0.3, 0.2, np.array([True]))
        self.assertLessEqual(sg.stake_for(big)[0], 0.01)                              # cote > 3,50 : plafond 1 %

    def test_caps_per_bet_and_per_match(self):
        sims = sm.simulate(2.4, 0.5, 0.45)
        outs = [outcome("1x2", "1", 2.2, mid=101, oid=101), outcome("totals", "Over", 2.5, hcp=1.5, mid=1, oid=11), outcome("bothteamsscore", "No", 2.4, mid=7, oid=72),
                outcome("teamtotals-team1", "Over", 2.6, hcp=1.5, mid=8, oid=81)]
        ranked = sg.rank(sg.evaluate_candidates(sims, outs, KO, NOW), "equilibre")
        self.assertTrue(all(s.stake_fraction <= sg.CAP_PER_BET + 1e-9 for s in ranked))
        self.assertLessEqual(sum(s.stake_fraction for s in ranked), sg.CAP_PER_MATCH + 1e-9)

    def test_bankroll_curve_exact_to_the_cent(self):
        bets = pd.DataFrame({"kickoff_utc": pd.to_datetime(["2026-01-01", "2026-01-01", "2026-01-02", "2026-01-03"], utc=True),
                             "stake_fraction": [0.05, 0.02, 0.05, 0.05], "realised": [1.5, -1.0, -1.0, 0.75]})
        curve, final, dd = product.bankroll_curve(bets, 300.0)
        # jour 1 : mises 15 + 6 sur 300 → +22,5 − 6 = 316,5 ; jour 2 : mise 15,83 perdue → 300,67 ; jour 3 : mise 15,03 × 0,75 = +11,27 → 311,94
        self.assertEqual([c["bankroll"] for c in curve], [316.5, 300.67, 311.94])
        self.assertEqual(final, 311.94)
        self.assertAlmostEqual(dd, (316.5 - 300.67) / 316.5, places=6)


class JournalTests(unittest.TestCase):
    def test_published_suggestions_are_never_rewritten_and_settled_once(self):
        from betting import catalogue
        cat = catalogue.parse([{"marketId": 101, "marketType": "1x2", "period": "fulltime", "handicap": 0.0, "sportId": 10, "playerProp": False,
                                "outcomes": [{"outcomeId": 101, "outcomeName": "1"}, {"outcomeId": 102, "outcomeName": "X"}, {"outcomeId": 103, "outcomeName": "2"}]},
                               {"marketId": 1030, "marketType": "spreads", "period": "fulltime", "handicap": -0.75, "sportId": 10, "playerProp": False,
                                "outcomes": [{"outcomeId": 1030, "outcomeName": "1"}, {"outcomeId": 1031, "outcomeName": "2"}]}])
        entries = [{"status": "ok", "matchId": "m1", "competition": "AAA", "kickoff": KO.isoformat(), "profiles": {"sur": {"suggestions": [
            {"rank": 1, "marketId": 101, "outcomeId": 101, "family": "résultat", "label": "Club A gagne", "odds": 1.8, "oddsAt": NOW.isoformat(), "p": 0.6, "ev": 0.08, "stakeFraction": 0.02, "stakeMode": "kelly"},
            {"rank": 2, "marketId": 1030, "outcomeId": 1030, "family": "handicap asiatique", "label": "Club A -0,75", "odds": 2.0, "oddsAt": NOW.isoformat(), "p": 0.5, "ev": 0.0, "stakeFraction": 0.02, "stakeMode": "fixed"}]}}}]
        with tempfile.TemporaryDirectory() as tmp:
            product.JOURNAL = Path(tmp) / "journal.parquet"
            empty = pd.DataFrame(columns=["match_id", "ft_home", "ft_away", "ht_home", "ht_away", "first_goal", "last_goal"])
            j1 = product.journal_append(entries, NOW, empty, cat)
            self.assertEqual(len(j1), 2); self.assertTrue(j1["settled"].isna().all())
            entries[0]["profiles"]["sur"]["suggestions"][0]["odds"] = 9.9        # tentative de réécriture : ignorée
            j2 = product.journal_append(entries, NOW + dt.timedelta(hours=1), empty, cat)
            self.assertEqual(len(j2), 2); self.assertEqual(float(j2.iloc[0]["odds"]), 1.8)
            res = pd.DataFrame([{"match_id": "m1", "ft_home": 2, "ft_away": 1, "ht_home": 1, "ht_away": 0, "first_goal": "home", "last_goal": "away"}])
            j3 = product.journal_append(entries, NOW + dt.timedelta(days=1), res, cat)
            self.assertEqual(float(j3.iloc[0]["settled"]), 1.0); self.assertAlmostEqual(float(j3.iloc[0]["realised"]), 0.8)
            self.assertEqual(float(j3.iloc[1]["settled"]), 0.5); self.assertAlmostEqual(float(j3.iloc[1]["realised"]), 0.5)   # -0,75 : moitié gagnée
            j4 = product.journal_append([], NOW + dt.timedelta(days=2), res, cat)
            self.assertEqual(j4.iloc[0]["settled_at"], j3.iloc[0]["settled_at"])   # réglé une seule fois


    def test_journal_is_resettled_and_a_half_time_bet_without_half_time_is_pending(self):
        from betting import catalogue
        cat = catalogue.parse([{"marketId": 101, "marketType": "1x2", "period": "fulltime", "handicap": 0.0, "sportId": 10, "playerProp": False,
                                "outcomes": [{"outcomeId": 101, "outcomeName": "1"}, {"outcomeId": 102, "outcomeName": "X"}, {"outcomeId": 103, "outcomeName": "2"}]},
                               {"marketId": 201, "marketType": "totals", "period": "p1", "handicap": 1.5, "sportId": 10, "playerProp": False,
                                "outcomes": [{"outcomeId": 201, "outcomeName": "Over"}, {"outcomeId": 202, "outcomeName": "Under"}]},
                               {"marketId": 301, "marketType": "firstgoal", "period": "fulltime", "handicap": 0.0, "sportId": 10, "playerProp": False,
                                "outcomes": [{"outcomeId": 301, "outcomeName": "1"}, {"outcomeId": 302, "outcomeName": "No Goal"}, {"outcomeId": 303, "outcomeName": "2"}]}])
        s = lambda r, mid, oid, label: {"rank": r, "marketId": mid, "outcomeId": oid, "family": "x", "label": label, "odds": 2.0, "oddsAt": NOW.isoformat(), "p": 0.5, "ev": 0.0,
                                        "stakeFraction": 0.01, "stakeMode": "fixed"}
        entries = [{"status": "ok", "matchId": "m1", "competition": "AAA", "kickoff": KO.isoformat(), "profiles": {"sur": {"suggestions": [
            s(1, 101, 101, "Club A gagne"), s(2, 201, 202, "Moins de 1,5 but (1re mi-temps)"), s(3, 301, 301, "Club A marque le premier")]}}}]
        with tempfile.TemporaryDirectory() as tmp:
            product.JOURNAL = Path(tmp) / "journal.parquet"
            # ancien règlement : mi-temps 0-0 inventée faute de score de mi-temps
            wrong = pd.DataFrame([{"match_id": "m1", "ft_home": 3, "ft_away": 0, "ht_home": 0, "ht_away": 0, "first_goal": "none", "last_goal": "none"}])
            j1 = product.journal_append(entries, NOW, wrong, cat)
            self.assertEqual(j1["settled"].tolist(), [1.0, 1.0, 0.0])
            unknown = pd.DataFrame([{"match_id": "m1", "ft_home": 3, "ft_away": 0, "ht_home": None, "ht_away": None, "first_goal": None, "last_goal": None}])
            j2 = product.journal_append([], NOW + dt.timedelta(days=1), unknown, cat)
            self.assertEqual(float(j2.iloc[0]["settled"]), 1.0)                      # temps réglementaire : inchangé
            self.assertEqual(j2.iloc[0]["settled_at"], j1.iloc[0]["settled_at"])
            self.assertTrue(pd.isna(j2.iloc[1]["settled"]) and pd.isna(j2.iloc[1]["realised"]) and pd.isna(j2.iloc[1]["settled_at"]))   # en attente
            self.assertTrue(pd.isna(j2.iloc[2]["settled"]))
            right = pd.DataFrame([{"match_id": "m1", "ft_home": 3, "ft_away": 0, "ht_home": 2, "ht_away": 0, "first_goal": "home", "last_goal": "home"}])
            j3 = product.journal_append([], NOW + dt.timedelta(days=2), right, cat)
            self.assertEqual(j3["settled"].tolist(), [1.0, 0.0, 1.0])
            self.assertEqual(j3["realised"].tolist(), [1.0, -1.0, 1.0])
            self.assertEqual(j3.iloc[1]["settled_at"], (NOW + dt.timedelta(days=2)).isoformat())

    def test_combo_with_a_leg_lacking_its_half_time_is_not_settled(self):
        from betting import catalogue
        cat = catalogue.parse([{"marketId": 101, "marketType": "1x2", "period": "fulltime", "handicap": 0.0, "sportId": 10, "playerProp": False,
                                "outcomes": [{"outcomeId": 101, "outcomeName": "1"}, {"outcomeId": 102, "outcomeName": "X"}, {"outcomeId": 103, "outcomeName": "2"}]},
                               {"marketId": 201, "marketType": "totals", "period": "p1", "handicap": 1.5, "sportId": 10, "playerProp": False,
                                "outcomes": [{"outcomeId": 201, "outcomeName": "Over"}, {"outcomeId": 202, "outcomeName": "Under"}]}])
        legs = [{"matchId": "m1", "marketId": 101, "outcomeId": 101, "odds": 1.5}, {"matchId": "m2", "marketId": 201, "outcomeId": 202, "odds": 1.6}]
        res = pd.DataFrame([{"match_id": "m1", "ft_home": 1, "ft_away": 0, "ht_home": 1, "ht_away": 0, "first_goal": "home", "last_goal": "home"},
                            {"match_id": "m2", "ft_home": 2, "ft_away": 2, "ht_home": None, "ht_away": None, "first_goal": None, "last_goal": None}])
        self.assertIsNone(product.settle_combo(legs, res, cat))
        res.loc[1, ["ht_home", "ht_away"]] = [0, 0]
        self.assertEqual(product.settle_combo(legs, res, cat), ("won", round(1.5 * 1.6 - 1, 4)))


class HistoryTests(unittest.TestCase):
    def row(self, mid, profile, rank, published, kick, settled=None, realised=None, label="Club A gagne"):
        return {"suggestion_id": f"{mid}{profile}{rank}{published}", "published_at": published.isoformat(), "match_id": mid, "fixture_id": None, "competition": "AAA",
                "kickoff_utc": kick.isoformat(), "profile": profile, "rank": rank, "kind": "simple", "market_id": 101, "outcome_id": 101, "family": "résultat",
                "label": label, "odds": 1.8, "odds_at": published.isoformat(), "p": 0.6, "ev": 0.08, "stake_fraction": 0.02, "stake_mode": "kelly",
                "settled": settled, "realised": realised, "settled_at": None}

    def test_last_publication_before_kickoff_with_its_settlement(self):
        later = KO + dt.timedelta(days=1)
        journal = pd.DataFrame([
            self.row("m1", "sur", 1, NOW - dt.timedelta(hours=3), KO, label="ancienne"),          # remplacée par la publication suivante
            self.row("m1", "sur", 1, NOW, KO, settled=1.0, realised=0.8),
            self.row("m1", "sur", 2, NOW, KO, settled=-2.0, realised=0.0, label="Club A -0"),     # remboursé
            self.row("m1", "sur", 1, KO + dt.timedelta(minutes=5), KO, label="après coup d'envoi"),  # jamais jouable
            self.row("m1", "grosse_cote", 1, NOW, KO, settled=0.0, realised=-1.0),
            self.row("m2", "sur", 1, NOW, KO + dt.timedelta(hours=3)),                             # commencé, pas encore réglé
            self.row("m3", "sur", 1, NOW, later),                                                  # pas encore commencé
        ])
        res = pd.DataFrame([{"match_id": "m1", "ft_home": 2, "ft_away": 1}])
        names = {"m1": ("Club A", "Club B"), "m2": ("Club C", "Club D")}
        days = product.history(journal, res, names, KO + dt.timedelta(hours=4))
        self.assertEqual([d["date"] for d in days], ["2026-11-07"])
        m1, m2 = days[0]["matches"]
        self.assertEqual((m1["home"], m1["away"], m1["score"]), ("Club A", "Club B", [2, 1]))
        self.assertEqual([(b["label"], b["status"], b["realised"]) for b in m1["profiles"]["sur"]], [("Club A gagne", "won", 0.8), ("Club A -0", "void", 0.0)])
        self.assertEqual(m1["profiles"]["grosse_cote"][0]["status"], "lost")
        self.assertEqual((m2["matchId"], m2["score"], m2["profiles"]["sur"][0]["status"]), ("m2", None, "pending"))
        self.assertEqual(product.history(journal.iloc[0:0], res, names, KO), [])

    def test_evening_details_are_readable(self):
        ev = {"bets": [{"match": "m1", "match_id": "m1", "label": "Club A gagne", "odds": 1.8, "stake": 6.0, "result": "gagné", "profit": 4.8},
                       {"match": "Combiné", "combo": [{"label": "x", "odds": 1.5}, {"label": "y", "odds": 2.0}], "stake": 2.0, "result": None, "profit": None}]}
        single, combo = product.evening_details(ev, {"m1": ("Club A", "Club B")})
        self.assertEqual((single["match"], single["status"], single["profit"]), ("Club A – Club B", "won", 4.8))
        self.assertEqual((combo["label"], combo["legs"], combo["odds"], combo["status"]), ("x + y", 2, 3.0, "pending"))



class MeasureTests(unittest.TestCase):
    """Mesure : paris jouables seulement, intervalles par grappes de match, bilan daté du moteur."""

    def row(self, mid, profile, published, kick, settled=None, realised=None, clv=None, rank=1, sid=None):
        return {"suggestion_id": sid or f"{mid}{profile}{rank}{published}", "published_at": published.isoformat(), "match_id": mid, "fixture_id": "f" + mid, "competition": "AAA",
                "kickoff_utc": kick.isoformat(), "profile": profile, "rank": rank, "kind": "simple", "market_id": 101, "outcome_id": 101, "family": "résultat",
                "label": "Club A gagne", "odds": 2.0, "odds_at": published.isoformat(), "p": 0.5, "ev": 0.0, "stake_fraction": 0.02, "stake_mode": "fixed",
                "settled": settled, "realised": realised, "settled_at": None, "clv": clv, "closing_odds": None}

    def test_summary_counts_each_playable_bet_once(self):
        # republiée trois fois avant le coup d'envoi, puis une fois après : un seul pari jouable, la dernière publication d'avant
        rows = [self.row("m1", "sur", NOW - dt.timedelta(hours=h), KO, settled=1.0, realised=1.0) for h in (6, 3, 1)]
        rows.append(self.row("m1", "sur", KO + dt.timedelta(minutes=30), KO, settled=0.0, realised=-1.0))
        rows.append(self.row("m2", "sur", NOW, KO, settled=0.0, realised=-1.0))
        rows.append(self.row("m3", "sur", NOW, KO))                                   # en attente
        out = product.journal_summary(pd.DataFrame(rows))
        sur = out["byProfile"]["sur"]
        self.assertEqual((out["published"], out["playable"], out["settled"]), (6, 3, 2))
        self.assertEqual(sur["bets"], 2); self.assertAlmostEqual(sur["returnFlat"], 0.0); self.assertEqual(sur["hitRate"], 0.5)
        self.assertEqual(sur["matches"], 2)

    def test_cluster_interval_resamples_matches_not_bets(self):
        values = np.array([1.0] * 10 + [-1.0] * 10)
        one_match = product.cluster_ci(values, np.array(["a"] * 10 + ["b"] * 10))
        many = product.cluster_ci(values, np.arange(20).astype(str))
        self.assertGreater(one_match[1] - one_match[0], many[1] - many[0])         # deux matchs : bien moins d'information que vingt
        self.assertEqual(product.cluster_ci(values, np.arange(20).astype(str)), many)   # graine fixe
        self.assertEqual(product.cluster_ci(np.array([0.1]), np.array(["a"])), (None, None))

    def test_clv_block_has_a_match_cluster_interval_on_playable_bets(self):
        rows = [self.row(f"m{i}", "exploratoire", NOW, KO, clv=c) for i, c in enumerate([-0.12, -0.10, -0.09, -0.11])]
        rows.append(self.row("m0", "exploratoire", NOW - dt.timedelta(hours=2), KO, clv=0.5))   # republication remplacée : ignorée
        b = product.journal_summary(pd.DataFrame(rows))["byProfile"]["exploratoire"]
        self.assertEqual(b["clvBets"], 4); self.assertAlmostEqual(b["meanClv"], -0.105)
        self.assertLess(b["clvHigh"], 0); self.assertLess(b["clvLow"], b["meanClv"]); self.assertEqual(b["clvMatches"], 4)

    def test_bilan_covers_every_profile_and_records_the_engine(self):
        tab = pd.DataFrame([{"match_id": f"m{i}", "competition": "AAA", "kickoff_utc": KO + dt.timedelta(days=i), "profile": p, "kind": "simple", "rank": 1, "family": "résultat",
                             "odds": 2.0, "p": 0.5, "ev": 0.0, "stake_fraction": 0.01, "stake_mode": "fixed", "p_sharp": None, "p_ref": None, "ev_ref": None,
                             "clv": None, "settled": 1.0, "realised": 1.0} for i in range(3) for p in ("sur", "exploratoire", "ancien")])
        b = product.summarise(tab)
        self.assertEqual(set(b["profiles"]), {"sur", "equilibre", "grosse_cote", "exploratoire", "ancien"})
        self.assertEqual(b["profiles"]["ancien"]["overall"]["bets"], 3)
        self.assertEqual(b["engine"], product.engine_fingerprint())
        self.assertIn("returnLow", b["profiles"]["sur"]["overall"])
        self.assertFalse(product.bilan_is_stale(b))
        self.assertTrue(product.bilan_is_stale({**b, "engine": "ancien"}))
        self.assertTrue(product.bilan_is_stale(None))


if __name__ == "__main__":
    unittest.main()
