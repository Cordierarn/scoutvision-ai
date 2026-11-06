"""
Tests de la référence sharp par The Odds API (scripts/betting/sharpfeed.py) sans réseau : conversion des
événements en relevés de l'archive (1N2, plus/moins, handicap ; marchés « lay » ignorés ; appariement des
rencontres), crédits et réserve, sélection des compétitions à relever. Et client OddsPapi : bookmakers hors
abonnement retirés puis appel repris.

  python3 -m unittest tests.test_betting_sharpfeed -v        # ou : npm run test:data
"""

from __future__ import annotations

import datetime as dt
import json
import tempfile
import unittest
from pathlib import Path

import pandas as pd

from betting import catalogue, sharpfeed
from betting import client as cl

NOW = dt.datetime(2026, 11, 7, 12, 0, tzinfo=dt.timezone.utc)
CAT = catalogue.parse([
    {"marketId": 101, "marketType": "1x2", "period": "fulltime", "handicap": 0.0, "sportId": 10, "playerProp": False,
     "outcomes": [{"outcomeId": 101, "outcomeName": "1"}, {"outcomeId": 102, "outcomeName": "X"}, {"outcomeId": 103, "outcomeName": "2"}]},
    {"marketId": 1010, "marketType": "totals", "period": "fulltime", "handicap": 2.5, "sportId": 10, "playerProp": False,
     "outcomes": [{"outcomeId": 1010, "outcomeName": "Over"}, {"outcomeId": 1011, "outcomeName": "Under"}]},
    {"marketId": 1068, "marketType": "spreads", "period": "fulltime", "handicap": -0.5, "sportId": 10, "playerProp": False,
     "outcomes": [{"outcomeId": 1068, "outcomeName": "1"}, {"outcomeId": 1069, "outcomeName": "2"}]},
    {"marketId": 2010, "marketType": "totals", "period": "p1", "handicap": 2.5, "sportId": 10, "playerProp": False,
     "outcomes": [{"outcomeId": 2010, "outcomeName": "Over"}, {"outcomeId": 2011, "outcomeName": "Under"}]},
])
FIXTURES = pd.DataFrame([
    {"fixture_id": "f1", "tournament_id": 17, "competition": "ENG", "season": "2026-27", "start_time": pd.Timestamp("2026-11-07T15:00:00Z"), "status_id": 0, "home_name": "Club Alpha FC", "away_name": "Beta United", "has_odds": True},
    {"fixture_id": "f2", "tournament_id": 17, "competition": "ENG", "season": "2026-27", "start_time": pd.Timestamp("2026-11-07T15:00:00Z"), "status_id": 0, "home_name": "Gamma Town", "away_name": "Delta City", "has_odds": True},
    {"fixture_id": "f3", "tournament_id": 8, "competition": "ESP", "season": "2026-27", "start_time": pd.Timestamp("2026-11-09T20:00:00Z"), "status_id": 0, "home_name": "Epsilon", "away_name": "Zeta", "has_odds": True},
    {"fixture_id": "f4", "tournament_id": 17, "competition": "ENG", "season": "2026-27", "start_time": pd.Timestamp("2026-11-01T15:00:00Z"), "status_id": 2, "home_name": "Old", "away_name": "Older", "has_odds": True},
])


def event(home, away, start="2026-11-07T15:00:00Z", books=None):
    books = books if books is not None else [
        {"key": "pinnacle", "last_update": "2026-11-07T11:50:00Z", "markets": [
            {"key": "h2h", "outcomes": [{"name": home, "price": 1.80}, {"name": away, "price": 4.60}, {"name": "Draw", "price": 3.70}]},
            {"key": "totals", "outcomes": [{"name": "Over", "price": 1.95, "point": 2.5}, {"name": "Under", "price": 1.93, "point": 2.5}]},
            {"key": "spreads", "outcomes": [{"name": home, "price": 2.02, "point": -0.5}, {"name": away, "price": 1.88, "point": 0.5}]},
        ]},
        {"key": "betfair_ex_eu", "last_update": "2026-11-07T11:50:00Z", "markets": [
            {"key": "h2h", "outcomes": [{"name": home, "price": 1.84}, {"name": away, "price": 4.8}, {"name": "Draw", "price": 3.8}]},
            {"key": "h2h_lay", "outcomes": [{"name": home, "price": 1.86}, {"name": away, "price": 4.9}, {"name": "Draw", "price": 3.9}]},
        ]},
        {"key": "unknownbook", "markets": [{"key": "h2h", "outcomes": [{"name": home, "price": 1.5}]}]},
    ]
    return {"id": "e", "commence_time": start, "home_team": home, "away_team": away, "bookmakers": books}


class ConversionTests(unittest.TestCase):
    def test_events_become_archive_snapshots_under_sharp_bookmaker_names(self):
        snaps, report = sharpfeed.events_to_snapshots([event("Club Alpha", "Beta United")], FIXTURES, CAT, "ENG", NOW)
        self.assertEqual((report["events"], report["matched"], report["unknownMarkets"]), (1, 1, 0))
        self.assertEqual(set(snaps["bookmaker"]), {"pinnacle", "betfair-ex"})
        self.assertTrue((snaps["fixture_id"] == "f1").all())
        self.assertEqual(set(snaps["source"]), {"the-odds-api"})
        pin = snaps[snaps["bookmaker"] == "pinnacle"].set_index(["market_id", "outcome_id"])["price"]
        self.assertEqual(pin.loc[(101, 101)], 1.80); self.assertEqual(pin.loc[(101, 102)], 3.70); self.assertEqual(pin.loc[(101, 103)], 4.60)
        self.assertEqual(pin.loc[(1010, 1010)], 1.95); self.assertEqual(pin.loc[(1010, 1011)], 1.93)
        self.assertEqual(pin.loc[(1068, 1068)], 2.02); self.assertEqual(pin.loc[(1068, 1069)], 1.88)      # ligne −0,5 : handicap de l'équipe à domicile
        bf = snaps[snaps["bookmaker"] == "betfair-ex"]
        self.assertEqual(len(bf), 3)                                                                  # h2h seulement : le marché « lay » est ignoré
        self.assertTrue((snaps["created_at"] == pd.Timestamp(NOW)).all())                           # prix datés de l'appel
        self.assertTrue(snaps["limit"].isna().all())

    def test_unmatched_and_unknown_lines_are_reported_not_invented(self):
        far = event("Club Alpha", "Beta United", start="2026-11-07T19:00:00Z")                          # 4 h d'écart : pas la même rencontre
        snaps, report = sharpfeed.events_to_snapshots([far], FIXTURES, CAT, "ENG", NOW)
        self.assertTrue(snaps.empty); self.assertEqual(len(report["unmatched"]), 1)
        odd_line = event("Club Alpha", "Beta United", books=[{"key": "pinnacle", "markets": [
            {"key": "totals", "outcomes": [{"name": "Over", "price": 1.9, "point": 3.25}, {"name": "Under", "price": 1.9, "point": 3.25}]}]}])
        snaps, report = sharpfeed.events_to_snapshots([odd_line], FIXTURES, CAT, "ENG", NOW)
        self.assertTrue(snaps.empty); self.assertEqual(report["unknownMarkets"], 1)                   # ligne absente du catalogue : rien d'écrit
        unknown = event("Omega Rovers", "Sigma Wanderers")                                              # aucune rencontre de ce nom
        self.assertIsNone(sharpfeed.match_fixture(unknown, FIXTURES, "ENG"))
        self.assertIsNone(sharpfeed.match_fixture(event("Club Alpha", "Beta United"), FIXTURES, "ESP"))   # autre compétition

    def test_one_sure_side_learns_the_other_name_and_ambiguity_learns_nothing(self):
        aliases = {}
        fx = sharpfeed.match_fixture(event("Gamma Town", "Crvena Delta"), FIXTURES, "ENG", aliases)       # côté domicile sûr, visiteur inconnu
        self.assertEqual(fx.fixture_id, "f2")
        self.assertEqual(aliases, {"Crvena Delta": "Delta City"})
        fx = sharpfeed.match_fixture(event("Gamma Town", "Crvena Delta"), FIXTURES, "ENG", aliases)       # l'alias vaut ensuite un nom exact
        self.assertEqual(fx.fixture_id, "f2")
        before = dict(aliases)
        self.assertIsNone(sharpfeed.match_fixture(event("Club Alpha FC", "Delta City"), FIXTURES, "ENG", aliases))   # deux rencontres désignées : rien
        self.assertIsNone(sharpfeed.match_fixture(event("Gamma Tn", "Crvena Omega"), FIXTURES, "ENG", aliases))     # côté domicile pas assez sûr (0,33)
        self.assertEqual(aliases, before)
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "a" / "aliases.json"
            self.assertEqual(sharpfeed.load_aliases(path), {})
            sharpfeed.save_aliases(aliases, path)
            self.assertEqual(sharpfeed.load_aliases(path), aliases)
        snaps, report = sharpfeed.events_to_snapshots([event("Gamma Town", "Crvena Delta")], FIXTURES, CAT, "ENG", NOW, aliases={})
        self.assertEqual(report["matched"], 1); self.assertEqual(set(snaps["fixture_id"]), {"f2"})

    def test_sports_to_pull_only_competitions_with_a_fixture_in_the_window(self):
        now = pd.Timestamp(NOW)
        self.assertEqual(sharpfeed.sports_to_pull(FIXTURES, now, 36), ["ENG"])
        self.assertEqual(sharpfeed.sports_to_pull(FIXTURES, now, 72), ["ENG", "ESP"])
        self.assertEqual(sharpfeed.sports_to_pull(FIXTURES, now - pd.Timedelta(days=10), 24), [])


class ClientCreditsTests(unittest.TestCase):
    def test_credits_follow_server_headers_and_keep_a_reserve(self):
        calls = []

        def http(url, params):
            calls.append((url, params))
            return 200, {"x-requests-used": "40", "x-requests-remaining": "460", "x-requests-last": "3"}, json.dumps([]).encode()

        credits = sharpfeed.Credits(path=None, month="2026-11")
        c = sharpfeed.TheOddsApiClient("cle-test", http=http, credits=credits, now=lambda: NOW)
        self.assertEqual(c.odds("soccer_epl"), [])
        self.assertEqual((credits.used, credits.remaining), (40, 460))
        self.assertEqual(calls[0][1]["markets"], "h2h,totals,spreads"); self.assertEqual(calls[0][1]["bookmakers"], "pinnacle,betfair_ex_eu")
        credits.remaining = 26
        with self.assertRaises(sharpfeed.SharpFeedError):
            c.odds("soccer_epl")                                                                      # 26 − 3 < réserve de 25
        self.assertEqual(len(calls), 1)

    def test_key_never_appears_in_errors(self):
        def http(url, params):
            return 401, {}, b'{"message":"bad key cle-test"}'
        c = sharpfeed.TheOddsApiClient("cle-test", http=http, credits=sharpfeed.Credits(path=None, month="2026-11", remaining=500), now=lambda: NOW)
        with self.assertRaises(sharpfeed.SharpFeedError) as ctx:
            c.odds("soccer_epl")
        self.assertNotIn("cle-test", str(ctx.exception))


class DailyBudgetTests(unittest.TestCase):
    """Un passage sharp par jour, rencontres sous 24 h, dans le plan gratuit (500 crédits, réserve 25)."""

    UTC = dt.timezone.utc

    def credits(self, log):
        c = sharpfeed.Credits(path=None, month="2026-11")
        c.log = log
        return c

    def test_one_pull_per_day_from_the_first_pass_after_the_threshold(self):
        early = dt.datetime(2026, 11, 6, 5, 40, tzinfo=self.UTC)
        late = dt.datetime(2026, 11, 6, 9, 20, tzinfo=self.UTC)
        self.assertFalse(sharpfeed.daily_pull_due(self.credits([]), early, dt.time(9, 0))[0])            # trop tôt
        self.assertTrue(sharpfeed.daily_pull_due(self.credits([]), late, dt.time(9, 0))[0])
        done = [{"at": "2026-11-06T09:21:00+00:00", "sport": "soccer_epl", "cost": 3}]
        self.assertFalse(sharpfeed.daily_pull_due(self.credits(done), dt.datetime(2026, 11, 6, 13, 45, tzinfo=self.UTC), dt.time(9, 0))[0])   # déjà fait aujourd'hui
        self.assertTrue(sharpfeed.daily_pull_due(self.credits(done), dt.datetime(2026, 11, 7, 9, 15, tzinfo=self.UTC), dt.time(9, 0))[0])     # nouveau jour
        refused = [{"at": "2026-11-06T09:21:00+00:00", "sport": "soccer_epl", "cost": 0}]               # appel refusé, rien relevé : à refaire
        self.assertTrue(sharpfeed.daily_pull_due(self.credits(refused), dt.datetime(2026, 11, 6, 13, 45, tzinfo=self.UTC), dt.time(9, 0))[0])

    def test_monthly_cost_counts_three_credits_per_competition_with_a_fixture_in_the_window(self):
        t = lambda d, h: pd.Timestamp(f"2026-11-{d:02d}T{h:02d}:00:00Z")
        fx = pd.DataFrame([{"fixture_id": "a", "competition": "ENG", "status_id": 0, "start_time": t(7, 15)},
                           {"fixture_id": "b", "competition": "ENG", "status_id": 0, "start_time": t(7, 17)},      # même compétition : un seul appel
                           {"fixture_id": "c", "competition": "ESP", "status_id": 0, "start_time": t(8, 8)},       # avant 09 h 13 le 8 : fenêtre du 7
                           {"fixture_id": "d", "competition": "XXX", "status_id": 0, "start_time": t(7, 15)}])     # hors The Odds API
        per_day = sharpfeed.credits_per_day(fx, dt.date(2026, 11, 7), dt.date(2026, 11, 8), hours=24, at=dt.time(9, 13))
        self.assertEqual(per_day, {dt.date(2026, 11, 7): 6, dt.date(2026, 11, 8): 0})


class OddsPapiRestrictedTests(unittest.TestCase):
    def test_restricted_bookmakers_are_dropped_and_the_call_retried(self):
        self.assertEqual(cl.restricted_bookmakers('{"error":{"message":"Restricted bookmaker(s).","code":"RESTRICTED_ACCESS","details":"Restricted bookmakers: pinnacle, betfair-ex. You do not have access to these bookmakers."}}'),
                         ["pinnacle", "betfair-ex"])
        calls = []

        def http(url, params):
            calls.append(dict(params))
            if "pinnacle" in params["bookmakers"]:
                return 403, {}, json.dumps({"error": {"message": "Restricted bookmaker(s).", "code": "RESTRICTED_ACCESS", "details": "Restricted bookmakers: pinnacle, betfair-ex. You do not have access to these bookmakers."}}).encode()
            return 200, {}, json.dumps([{"fixtureId": "f1", "tournamentId": 17, "startTime": "2026-11-07T15:00:00Z", "bookmakerOdds": {"winamax.fr": {"markets": {}}}}]).encode()

        quota = cl.Quota(path=None, budget=5000, used=0, month="2026-11")
        c = cl.OddsPapiClient("cle-test", cache_dir=None, quota=quota, http=http, sleep=lambda s: None, clock=lambda: 0.0, now=lambda: NOW)
        out = c.odds_by_tournaments([17], ["winamax.fr", "pinnacle", "betfair-ex"])
        self.assertEqual([f["fixtureId"] for f in out], ["f1"])
        self.assertEqual([p["bookmakers"] for p in calls], ["winamax.fr,pinnacle,betfair-ex", "winamax.fr"])
        self.assertEqual(c.restricted, {"pinnacle", "betfair-ex"})
        c.odds_by_tournaments([17], ["winamax.fr", "pinnacle"])                                        # appris : plus de tentative inutile
        self.assertEqual(calls[-1]["bookmakers"], "winamax.fr")
        self.assertIsNone(c.historical_odds("f1", ["pinnacle"]))                                      # plus aucun bookmaker : rien demandé
        self.assertEqual(len(calls), 3)


if __name__ == "__main__":
    unittest.main()
