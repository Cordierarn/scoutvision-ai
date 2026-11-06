"""
Taxonomie des marchés Winamax (scripts/betting/markets_catalog.py) : classification totale des types du
catalogue OddsPapi, règles de famille (période → mi-temps), de catégorie (A sharp, B fermé, C multiple / joueur)
et audit de l'archive sur des relevés synthétiques.

  python3 -m unittest test_betting_markets_catalog -v        # ou : npm run test:data
"""

from __future__ import annotations

import unittest

import pandas as pd

from betting import catalogue, markets_catalog as mc
from betting import markets as mk

# les 77 types du catalogue OddsPapi (relevé du 5 novembre 2026)
CATALOGUE_TYPES = """1x2 1x2-bookings 1x2-corners 2up bothteamsscore cleansheet-team1 cleansheet-team2 correctscore doublechance drawnobet
exactscore exactscore-team1 exactscore-team2 firstgoal halftime-fulltime highestscoringh highestscoringh-team1 highestscoringh-team2 lastgoal
nobet-team1 nobet-team2 oddeven oddeven-bookings oddeven-bookings-team1 oddeven-bookings-team2 oddeven-corners oddeven-corners-team1
oddeven-corners-team2 oddeven-team1 oddeven-team2 players-anytimegoalscorer players-assists players-cards players-firstgoalscorer
players-foulscommitted players-goals players-lastgoalscorer players-offsides players-saves players-shots players-shotsongoal players-tackles
playertotals-assists playertotals-cards playertotals-foulscommitted playertotals-goals playertotals-offsides playertotals-saves playertotals-shots
playertotals-shotsongoal playertotals-tackles spreads spreads-bookings spreads-corners spreads-european teamtotals-bookings-team1
teamtotals-bookings-team2 teamtotals-corners-team1 teamtotals-corners-team2 teamtotals-team1 teamtotals-team2 toqualify toscore-team1 toscore-team2
toscoreinbh-team1 toscoreinbh-team2 totals totals-bookings totals-corners winbothh-team1 winbothh-team2 wineitherh-team1 wineitherh-team2
winfrombehind winningmargin wintonil-team1 wintonil-team2""".split()


class ClassificationTests(unittest.TestCase):
    def test_every_catalogue_type_and_every_modeled_type_is_classified_explicitly(self):
        self.assertEqual(len(CATALOGUE_TYPES), 77)
        missing = [t for t in CATALOGUE_TYPES if t not in mc.TYPES]
        self.assertEqual(missing, [])
        self.assertEqual([t for t in mk.FAMILIES if t not in mc.TYPES], [])
        for t, (macro, shape, _) in mc.TYPES.items():
            self.assertIn(macro, mc.MACRO, t); self.assertIn(shape, mc.SHAPES, t)

    def test_macro_families_and_period_rule(self):
        self.assertEqual(mc.classify("1x2").macro, "resultats")
        self.assertEqual(mc.classify("totals").macro, "buts")
        self.assertEqual(mc.classify("totals", "p1").macro, "mi_temps")                 # un marché de buts sur une période : mi-temps
        self.assertEqual(mc.classify("halftime-fulltime").macro, "mi_temps")
        self.assertEqual(mc.classify("totals-corners").macro, "stats")
        self.assertEqual(mc.classify("totals-corners", "p1").macro, "stats")            # les stats restent des stats, quelle que soit la période
        self.assertEqual(mc.classify("players-shots", player_prop=True).macro, "joueurs")

    def test_validation_categories(self):
        self.assertEqual(mc.classify("1x2").category, "A"); self.assertEqual(mc.classify("totals").category, "A"); self.assertEqual(mc.classify("spreads").category, "A")
        self.assertEqual(mc.classify("1x2", "p1").category, "B")                        # pas de référence sharp sur la mi-temps
        self.assertEqual(mc.classify("bothteamsscore").category, "B"); self.assertEqual(mc.classify("drawnobet").category, "B")
        self.assertEqual(mc.classify("teamtotals-team1").category, "B"); self.assertEqual(mc.classify("totals-corners").category, "B")
        self.assertEqual(mc.classify("correctscore").category, "C"); self.assertEqual(mc.classify("halftime-fulltime").category, "C")
        self.assertEqual(mc.classify("winningmargin").category, "C"); self.assertEqual(mc.classify("playertotals-shots", player_prop=True).category, "C")
        self.assertTrue(mc.classify("1x2").modeled); self.assertFalse(mc.classify("totals-corners").modeled)

    def test_unknown_type_is_guessed_never_modeled(self):
        self.assertEqual((mc.classify("players-newthing").macro, mc.classify("players-newthing").category, mc.classify("players-newthing").modeled), ("joueurs", "C", False))
        self.assertEqual(mc.classify("something-corners").macro, "stats")
        self.assertEqual((mc.classify("mystery").macro, mc.classify("mystery").category), ("resultats", "C"))


class AuditTests(unittest.TestCase):
    def test_audit_counts_coverage_per_market_and_summarises_by_family(self):
        cat = catalogue.parse([
            {"marketId": 101, "marketType": "1x2", "period": "fulltime", "handicap": 0.0, "sportId": 10, "playerProp": False,
             "outcomes": [{"outcomeId": 101, "outcomeName": "1"}, {"outcomeId": 102, "outcomeName": "X"}, {"outcomeId": 103, "outcomeName": "2"}]},
            {"marketId": 104, "marketType": "bothteamsscore", "period": "fulltime", "handicap": 0.0, "sportId": 10, "playerProp": False,
             "outcomes": [{"outcomeId": 1, "outcomeName": "Yes"}, {"outcomeId": 2, "outcomeName": "No"}]},
            {"marketId": 10799, "marketType": "totals-corners", "period": "fulltime", "handicap": 8.5, "sportId": 10, "playerProp": False,
             "outcomes": [{"outcomeId": 1, "outcomeName": "Over"}, {"outcomeId": 2, "outcomeName": "Under"}]},
        ])
        at = pd.Timestamp("2026-11-05T14:00:00Z")
        rows = [("f1", "winamax.fr", 101, 101, None, at, 1.8), ("f1", "winamax.fr", 101, 102, None, at, 3.6), ("f1", "winamax.fr", 101, 103, None, at, 4.5),
                ("f2", "winamax.fr", 101, 101, None, at, 2.0), ("f1", "winamax.fr", 104, 1, None, at, 1.9), ("f1", "winamax.fr", 10799, 1, None, at, 1.9),
                ("f1", "winamax.fr", 99999, 1, None, at, 1.5), ("f1", "pinnacle", 101, 101, None, at, 1.85)]
        snaps = pd.DataFrame(rows, columns=["fixture_id", "bookmaker", "market_id", "outcome_id", "player_id", "created_at", "price"])
        table = mc.audit(snaps, cat)
        self.assertEqual(len(table), 4)                                                  # le relevé Pinnacle n'est pas compté
        one = table.set_index("marketId")
        self.assertEqual((one.loc[101, "fixtures"], one.loc[101, "rows"], one.loc[101, "outcomes"], one.loc[101, "category"], one.loc[101, "macro"]), (2, 4, 3, "A", "resultats"))
        self.assertEqual((one.loc[104, "category"], bool(one.loc[104, "modeled"])), ("B", True))
        self.assertEqual((one.loc[10799, "macro"], bool(one.loc[10799, "modeled"])), ("stats", False))
        self.assertEqual(one.loc[99999, "label"], "hors catalogue")
        s = {x["macro"]: x for x in mc.summary(table)}
        self.assertEqual((s["resultats"]["markets"], s["buts"]["markets"], s["stats"]["markets"], s["joueurs"]["markets"]), (1, 1, 1, 0))
        self.assertAlmostEqual(sum(x["rowsShare"] for x in s.values()), 6 / 7, places=3)   # le marché hors catalogue n'a pas de famille


if __name__ == "__main__":
    unittest.main()
