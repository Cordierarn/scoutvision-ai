"""
Tests de l'appariement OddsPapi ↔ PitchAPI (scripts/betting/matching.py) sur des équipes fictives.

  python3 -m unittest test_betting_matching -v        # ou : npm run test:data
"""

from __future__ import annotations

import unittest

import pandas as pd

from betting import matching


def fx(rows):
    return pd.DataFrame(rows, columns=["fixture_id", "competition", "start_time", "home_name", "away_name"])


def ms(rows):
    return pd.DataFrame(rows, columns=["match_id", "competition", "kickoff_utc", "home_team_name", "away_team_name"])


class MatchingTests(unittest.TestCase):
    def test_same_match_with_different_names_is_matched(self):
        f = fx([("f1", "AAA", "2026-11-01T15:00:00Z", "FC Club Alpha", "Club Bêta United")])
        m = ms([("m1", "AAA", "2026-11-01 15:00:00", "Alpha", "Beta")])
        matched, failures = matching.match_fixtures(f, m)
        self.assertEqual(matched["fixture_id"].tolist(), ["f1"])
        self.assertTrue(failures.empty)

    def test_date_tolerance_of_one_day_and_competition_barrier(self):
        f = fx([("f1", "AAA", "2026-11-01T23:30:00Z", "Alpha", "Beta"), ("f2", "BBB", "2026-11-02T20:00:00Z", "Gamma", "Delta")])
        m = ms([("m1", "AAA", "2026-11-02 00:30:00", "Alpha", "Beta"), ("m2", "AAA", "2026-11-02 20:00:00", "Gamma", "Delta")])
        matched, failures = matching.match_fixtures(f, m)
        self.assertEqual(matched["match_id"].tolist(), ["m1"])
        self.assertEqual(failures.iloc[0]["reason"], "aucun_candidat")  # Gamma-Delta existe dans une autre compétition

    def test_two_matches_same_day_sharing_a_team_are_not_confused(self):
        f = fx([("f1", "AAA", "2026-11-01T13:00:00Z", "Alpha", "Beta"), ("f2", "AAA", "2026-11-01T18:00:00Z", "Alpha", "Gamma")])
        m = ms([("m1", "AAA", "2026-11-01 13:00:00", "Alpha", "Gamma"), ("m2", "AAA", "2026-11-01 18:00:00", "Alpha", "Beta")])
        matched, _ = matching.match_fixtures(f, m)
        self.assertEqual(dict(zip(matched["match_id"], matched["fixture_id"])), {"m1": "f2", "m2": "f1"})

    def test_missing_match_is_a_failure_never_nearest(self):
        f = fx([("f1", "AAA", "2026-11-01T15:00:00Z", "Alpha", "Beta")])
        m = ms([("m1", "AAA", "2026-11-01 15:00:00", "Omega", "Sigma"), ("m2", "AAA", "2026-11-01 15:00:00", "Alpha", "Sigma")])
        matched, failures = matching.match_fixtures(f, m)
        self.assertTrue(matched.empty)
        self.assertEqual(set(failures["reason"]), {"aucun_candidat"})

    def test_low_score_is_reported_with_best_candidate(self):
        f = fx([("f1", "AAA", "2026-11-01T15:00:00Z", "Alpha Nord Ouest", "Beta")])
        m = ms([("m1", "AAA", "2026-11-01 15:00:00", "Alpha Sud", "Beta")])
        matched, failures = matching.match_fixtures(f, m, threshold=0.5)
        self.assertTrue(matched.empty)
        self.assertEqual(failures.iloc[0]["reason"], "score_insuffisant")
        self.assertEqual(failures.iloc[0]["best_fixture_id"], "f1")

    def test_alias_resolves_a_low_score_and_is_learned(self):
        f = fx([("f1", "AAA", "2026-11-01T15:00:00Z", "Alpha Nord Ouest", "Beta")])
        m = ms([("m1", "AAA", "2026-11-01 15:00:00", "Alpha Sud", "Beta")])
        matched, _ = matching.match_fixtures(f, m, aliases={"Alpha Nord Ouest": "Alpha Sud"})
        self.assertEqual(matched["fixture_id"].tolist(), ["f1"])
        learned = matching.learn_aliases(matched, f, m, {})
        self.assertEqual(learned, {"Alpha Nord Ouest": "Alpha Sud", "Beta": "Beta"})

    def test_ambiguous_tie_is_a_failure(self):
        f = fx([("f1", "AAA", "2026-11-01T13:00:00Z", "Alpha", "Beta"), ("f2", "AAA", "2026-11-01T18:00:00Z", "Alpha", "Beta")])
        m = ms([("m1", "AAA", "2026-11-01 13:00:00", "Alpha", "Beta")])
        matched, failures = matching.match_fixtures(f, m)
        self.assertTrue(matched.empty)
        self.assertEqual(failures.iloc[0]["reason"], "ambigu")

    def test_missing_names_never_match(self):
        f = fx([("f1", "AAA", "2026-11-01T15:00:00Z", None, "Beta")])
        m = ms([("m1", "AAA", "2026-11-01 15:00:00", "Alpha", "Beta")])
        matched, failures = matching.match_fixtures(f, m)
        self.assertTrue(matched.empty)
        self.assertEqual(matching.normalize(float("nan")), set())

    def test_normalisation(self):
        self.assertEqual(matching.normalize("Śląsk Wrocław FC"), {"slask", "wroclaw"})
        self.assertGreaterEqual(matching.similarity("Bodø/Glimt", "Bodoe/Glimt"), 0.9)
        self.assertGreaterEqual(matching.similarity("Bayern Munich", "Bayern München"), 0.9)
        self.assertGreaterEqual(matching.similarity("Real Sociedad San Sebastian", "Real Sociedad"), 0.9)
        self.assertLess(matching.similarity("Real Madrid", "Atlético Madrid"), 0.5)
        self.assertLess(matching.similarity("Manchester City", "Manchester United"), 0.5)
        self.assertEqual(matching.similarity("Athletic Club", "Athletic Club"), 1.0)


if __name__ == "__main__":
    unittest.main()
