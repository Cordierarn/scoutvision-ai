"""
Tests du cycle du Labo paris (scripts/betting/cycle.py) : créneaux planifiés alignés sur le workflow, passages
manqués journalisés, passage complet décidé par l'état de l'archive et non par l'heure. Sans réseau.

  python3 -m unittest tests.test_betting_cycle -v        # ou : npm run test:data
"""

from __future__ import annotations

import datetime as dt
import re
import tempfile
import unittest
from pathlib import Path

import pandas as pd

from betting import cycle

UTC = dt.timezone.utc
WORKFLOW = Path(__file__).resolve().parents[2] / ".github" / "workflows" / "betting-odds.yml"


class SlotTests(unittest.TestCase):
    def test_slots_match_the_workflow_crons_and_avoid_round_hours(self):
        crons = re.findall(r'cron:\s*"([^"]+)"', WORKFLOW.read_text(encoding="utf-8"))
        slots = sorted((int(h), int(m)) for c in crons for m, h in [c.split()[:2]])
        self.assertEqual(slots, sorted(cycle.SLOTS))
        self.assertTrue(all(m not in (0, 30) for _, m in cycle.SLOTS))      # heures rondes encombrées chez GitHub

    def test_missed_slots_are_those_without_a_run_within_the_tolerance(self):
        runs = [dt.datetime(2026, 11, 5, 14, 20, tzinfo=UTC), dt.datetime(2026, 11, 5, 17, 30, tzinfo=UTC)]   # 13 h 41 servi en retard, 16 h 47 servi
        now = dt.datetime(2026, 11, 6, 14, 10, tzinfo=UTC)                                                   # passage courant (13 h 41)
        missed = cycle.missed_slots(runs, now)
        self.assertEqual(missed, [dt.datetime(2026, 11, 6, 5, 37, tzinfo=UTC), dt.datetime(2026, 11, 6, 9, 13, tzinfo=UTC)])
        self.assertEqual(cycle.missed_slots([], now), [])                     # premier passage : rien à reprocher

    def test_record_keeps_a_bounded_log_and_reports_missed_slots(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "cycle_log.json"
            cycle.record("schedule", dt.datetime(2026, 11, 5, 17, 30, tzinfo=UTC), path)
            out = cycle.record("workflow_dispatch", dt.datetime(2026, 11, 6, 14, 10, tzinfo=UTC), path)
            self.assertEqual([m.hour for m in out["missed"]], [5, 9])
            log = cycle.load_log(path)
            self.assertEqual([r["event"] for r in log["runs"]], ["schedule", "workflow_dispatch"])
            self.assertEqual(len(log["missed"]), 2)
            again = cycle.record("schedule", dt.datetime(2026, 11, 6, 17, 0, tzinfo=UTC), path)
            self.assertEqual(again["missed"], [])                             # créneaux déjà signalés : pas de doublon


class PlanTests(unittest.TestCase):
    now = pd.Timestamp("2026-11-06T13:45:00Z")

    def fixtures(self, rows):
        return pd.DataFrame([{"fixture_id": f, "competition": c, "season": "2026-27", "status_id": st, "start_time": self.now + pd.Timedelta(hours=h)} for f, c, st, h in rows])

    def test_fixture_window_reaches_back_to_the_oldest_match_without_a_final_status(self):
        fx = self.fixtures([("a", "ENG", 2, -72), ("b", "ESP", 0, -50), ("c", "FRA", 0, 30)])          # « b » joué il y a 2 jours, statut non mis à jour
        start = cycle.fixtures_from(fx, self.now, competitions_archived=11, competitions=11)
        self.assertEqual(start, (self.now - pd.Timedelta(hours=50)).date())
        fx.loc[1, "status_id"] = 2
        self.assertEqual(cycle.fixtures_from(fx, self.now, 11, 11), (self.now - pd.Timedelta(days=1)).date())

    def test_incomplete_archive_starts_from_the_season(self):
        fx = self.fixtures([("a", "ENG", 2, -72)])
        self.assertEqual(cycle.fixtures_from(fx, self.now, competitions_archived=8, competitions=11), cycle.SEASON_START)
        self.assertEqual(cycle.fixtures_from(fx.iloc[0:0], self.now, 11, 11), cycle.SEASON_START)

    def test_history_runs_whenever_a_finished_match_lacks_its_full_history(self):
        fx = self.fixtures([("a", "ENG", 2, -20), ("b", "ESP", 0, 30)])
        snaps = pd.DataFrame([{"fixture_id": "a", "bookmaker": "winamax.fr", "created_at": self.now - pd.Timedelta(hours=22)}])   # relevé « à venir » seul
        self.assertEqual(cycle.history_needed(fx, snaps, {}, ["ENG", "ESP"]), 1)
        snaps.loc[1] = {"fixture_id": "a", "bookmaker": "winamax.fr", "created_at": self.now - pd.Timedelta(hours=19)}             # relevé après le coup d'envoi
        self.assertEqual(cycle.history_needed(fx, snaps, {}, ["ENG", "ESP"]), 0)


if __name__ == "__main__":
    unittest.main()
