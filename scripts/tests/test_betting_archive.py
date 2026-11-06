"""
Tests de l'archive de cotes (scripts/betting/archive.py) sur des réponses OddsPapi synthétiques calquées
sur la forme réelle (phase 0) : équipes « Club A / Club B », joueurs « Joueur 1 ». Sans réseau.

  python3 -m unittest tests.test_betting_archive -v        # ou : npm run test:data
"""

from __future__ import annotations

import datetime as dt
import tempfile
import unittest
from pathlib import Path

import pandas as pd

from betting import archive, fetch

KO = "2026-11-01T15:00:00.000Z"


def snap(at: str, price: float, limit=None, active=True) -> dict:
    return {"createdAt": at, "price": price, "limit": limit, "active": active, "exchangeMeta": None}


def payload() -> dict:
    """Un match : marché 101 (1N2) à trois issues, marché joueur 10730 (buteur) avec deux joueurs, relevés
    volontairement désordonnés, un relevé après le coup d'envoi."""
    return {"fixtureId": "fx_synth_1", "bookmakers": {"winamax.fr": {"markets": {
        "101": {"outcomes": {
            "101": {"players": {"0": [snap("2026-10-31T13:00:00.000Z", 2.10), snap("2026-10-25T09:00:00.000Z", 2.00),
                                     snap("2026-11-01T14:30:00.000Z", 2.20), snap("2026-11-01T15:20:00.000Z", 9.00),
                                     snap("2026-11-01T13:59:59.000Z", 2.15)]}},
            "102": {"players": {"0": [snap("2026-10-25T09:00:00.000Z", 3.40), snap("2026-11-01T14:59:00.000Z", 3.50)]}},
            "103": {"players": {"0": [snap("2026-10-25T09:00:00.000Z", 3.60)]}}}},
        "10730": {"outcomes": {"10730": {"players": {
            "900001": [snap("2026-10-30T10:00:00.000Z", 4.1), snap("2026-11-01T14:00:00.000Z", 3.9)],
            "900002": [snap("2026-11-01T15:30:00.000Z", 6.0)]}}}}}}}}


def fixtures_df() -> pd.DataFrame:
    return archive.fixture_rows([{"fixtureId": "fx_synth_1", "tournamentId": 17, "startTime": KO, "statusId": 2,
                                  "participant1Name": "Club A", "participant2Name": "Club B", "hasOdds": True}], {17: "ENG"}, "2026-27")


class FlattenTests(unittest.TestCase):
    def test_flatten_including_player_market(self):
        df = archive.flatten_historical(payload())
        self.assertEqual(list(df.columns), archive.SNAPSHOT_COLUMNS)
        self.assertEqual(len(df), 5 + 2 + 1 + 2 + 1)
        self.assertTrue(df["created_at"].dt.tz is not None)
        self.assertEqual(str(df["created_at"].dt.tz), "UTC")
        players = df[df["market_id"] == 10730]
        self.assertEqual(sorted(players["player_id"].unique()), ["900001", "900002"])
        self.assertTrue(df[df["market_id"] == 101]["player_id"].isna().all())
        # trié par clé puis date : le relevé du 25 octobre précède celui du 31 pour l'issue 101
        home = df[(df["market_id"] == 101) & (df["outcome_id"] == 101)]["created_at"].tolist()
        self.assertEqual(home, sorted(home))

    def test_live_flatten_uses_changed_at(self):
        live = {"fixtureId": "fx_synth_1", "bookmakerOdds": {"winamax.fr": {"markets": {"101": {"outcomes": {
            "101": {"players": {"0": {"price": 2.3, "changedAt": "2026-11-01T12:00:00.000Z", "active": True}}},
            "102": {"players": {"0": {"price": None, "changedAt": None}}}}}}}}}
        df = archive.flatten_live(live, dt.datetime(2026, 11, 1, 12, 5, tzinfo=dt.timezone.utc))
        self.assertEqual(len(df), 1)
        self.assertEqual(df.iloc[0]["source"], "live")
        self.assertEqual(df.iloc[0]["created_at"], pd.Timestamp("2026-11-01T12:00:00Z"))
        # relevé des matchs à venir : le prix est attesté à l'heure de l'appel, pas à son dernier changement
        seen = archive.flatten_live(live, dt.datetime(2026, 11, 1, 12, 5, tzinfo=dt.timezone.utc), stamp="observed")
        self.assertEqual(seen.iloc[0]["created_at"], pd.Timestamp("2026-11-01T12:05:00Z"))
        self.assertEqual(seen.iloc[0]["price"], 2.3)


class IdempotenceTests(unittest.TestCase):
    def test_rewriting_same_payload_adds_nothing(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "ENG" / "2026-27.parquet"
            df = archive.flatten_historical(payload())
            self.assertEqual(archive.write_snapshots(df, p), len(df))
            self.assertEqual(archive.write_snapshots(df, p), 0)
            self.assertEqual(len(pd.read_parquet(p)), len(df))
            # un relevé live au même instant et même prix ne crée pas de doublon ; un nouvel instant en crée un
            live = df.iloc[[0]].copy(); live["source"] = "live"
            self.assertEqual(archive.write_snapshots(live, p), 0)
            new = df.iloc[[0]].copy(); new["created_at"] = new["created_at"] + pd.Timedelta(minutes=1)
            self.assertEqual(archive.write_snapshots(new, p), 1)

    def test_fixtures_merge_by_id(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "fixtures.parquet"
            a = fixtures_df()
            archive.write_fixtures(a, p)
            b = a.copy(); b["status_id"] = 2; b["has_odds"] = False; b["home_name"] = None
            merged = archive.write_fixtures(b, p)
            self.assertEqual(len(merged), 1)
            self.assertEqual(bool(merged.iloc[0]["has_odds"]), False)
            self.assertEqual(merged.iloc[0]["home_name"], "Club A")  # un nom absent ne remplace pas un nom connu


class ViewsTests(unittest.TestCase):
    def test_views_h1_h24_last_first_and_post_kickoff_excluded(self):
        df = archive.flatten_historical(payload())
        v = archive.derived_views(df, fixtures_df()).set_index(["market_id", "outcome_id", "player_id"])
        home = v.loc[(101, 101, None)] if (101, 101, None) in v.index else v.xs((101, 101), level=("market_id", "outcome_id")).iloc[0]
        self.assertEqual(home["first_price"], 2.00)                     # 25 octobre
        self.assertEqual(home["h24_price"], 2.10)                       # dernier relevé avant KO − 24 h (31 oct 15:00) : le 31 oct 13:00
        self.assertEqual(home["h1_price"], 2.15)                        # dernier relevé strictement avant 14:00 (13:59:59)
        self.assertEqual(home["last_price"], 2.20)                      # 14:30 ; le relevé 15:20 (après KO) est ignoré
        self.assertEqual(int(home["n_pre_kickoff"]), 4)
        away = v.xs((101, 103), level=("market_id", "outcome_id")).iloc[0]
        self.assertEqual(away["h1_price"], 3.60)
        draw = v.xs((101, 102), level=("market_id", "outcome_id")).iloc[0]
        self.assertEqual(draw["h1_price"], 3.40)                        # 14:59 n'est pas avant 14:00
        self.assertEqual(draw["last_price"], 3.50)
        self.assertNotIn((10730, 10730, "900002"), v.index)              # seul relevé après KO : aucune ligne, jamais une cote inventée
        self.assertEqual(v.loc[(10730, 10730, "900001")]["h1_price"], 4.1)

    def test_no_snapshot_before_bound_gives_null(self):
        df = archive.flatten_historical({"fixtureId": "fx_synth_1", "bookmakers": {"winamax.fr": {"markets": {"101": {"outcomes": {
            "101": {"players": {"0": [snap("2026-11-01T14:50:00.000Z", 2.0)]}}}}}}}})
        v = archive.derived_views(df, fixtures_df()).iloc[0]
        self.assertTrue(pd.isna(v["h24_price"]) and pd.isna(v["h1_price"]))
        self.assertEqual(v["last_price"], 2.0)
        self.assertEqual(v["first_price"], 2.0)

    def test_season_of(self):
        self.assertEqual(archive.season_of(pd.Timestamp("2026-08-15")), "2026-27")
        self.assertEqual(archive.season_of(pd.Timestamp("2027-05-20")), "2026-27")
        self.assertEqual(archive.season_of(pd.Timestamp("2026-06-30")), "2025-26")


if __name__ == "__main__":
    unittest.main()


class StaleFixturesTests(unittest.TestCase):
    def test_finished_fixtures_without_a_complete_history_are_fetched_again(self):
        # un relevé « à venir » ne vaut pas historique complet : la clôture exige l'historique demandé après le coup d'envoi
        ko = pd.Timestamp("2026-11-03T19:45:00Z")
        fx = pd.DataFrame([{"fixture_id": f, "competition": "ENG", "season": "2026-27", "status_id": st, "start_time": ko} for f, st in
                           [("upcoming_only", 2), ("with_live", 2), ("marked", 2), ("marked_early", 2), ("none", 2), ("not_played", 0)]])
        snap = lambda f, minutes, bk="winamax.fr": {"fixture_id": f, "bookmaker": bk, "created_at": ko + pd.Timedelta(minutes=minutes)}
        snaps = pd.DataFrame([snap("upcoming_only", -150), snap("with_live", -150), snap("with_live", 5), snap("marked", -150), snap("marked_early", -150),
                              snap("upcoming_only", 10, bk="pinnacle")])          # un relevé de référence après le coup d'envoi ne compte pas
        fetched = {"marked": (ko + pd.Timedelta(hours=11)).isoformat(), "marked_early": (ko - pd.Timedelta(hours=3)).isoformat()}
        todo = fetch.history_todo(fx, snaps, fetched, ["ENG"])
        self.assertEqual(sorted(todo["fixture_id"]), ["marked_early", "none", "upcoming_only"])

    def test_fixtures_without_a_recent_winamax_snapshot_in_the_window_are_selected(self):
        now = pd.Timestamp("2026-11-05T14:52:00Z")
        fx = pd.DataFrame([
            {"fixture_id": "fresh", "competition": "ENG", "season": "2026-27", "status_id": 0, "start_time": now + pd.Timedelta(hours=30)},
            {"fixture_id": "stale", "competition": "ESP", "season": "2026-27", "status_id": 0, "start_time": now + pd.Timedelta(hours=72)},
            {"fixture_id": "never", "competition": "FRA", "season": "2026-27", "status_id": 0, "start_time": now + pd.Timedelta(days=5)},
            {"fixture_id": "far", "competition": "FRA", "season": "2026-27", "status_id": 0, "start_time": now + pd.Timedelta(days=9)},
            {"fixture_id": "played", "competition": "ENG", "season": "2026-27", "status_id": 2, "start_time": now - pd.Timedelta(hours=3)},
        ])
        last = pd.Series({"fresh": now - pd.Timedelta(minutes=1), "stale": now - pd.Timedelta(hours=49.5), "far": now - pd.Timedelta(days=3)})
        todo = fetch.stale_fixtures(fx, last, now, days=7, hours=2)
        self.assertEqual(list(todo["fixture_id"]), ["stale", "never"])        # triées par coup d'envoi ; hors fenêtre et jouées ignorées
        self.assertTrue(fetch.stale_fixtures(fx, last, now, days=7, hours=60).query("fixture_id == 'stale'").empty)
        self.assertEqual(list(fetch.stale_fixtures(fx, pd.Series(dtype="datetime64[ns, UTC]"), now, 7, 2)["fixture_id"]), ["fresh", "stale", "never"])
