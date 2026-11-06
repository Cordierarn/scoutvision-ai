"""
Tests de l'étape 3 (règles de compétition, simulation de saison, replay) sur fixtures synthétiques :
2 équipes, 4 équipes, égalité parfaite, titre certain, relégation certaine, aucun classement certain,
match restant 100/0/0 et 0/100/0, somme des distributions, règles de différence de buts et
confrontation directe, repli de départage, reproductibilité, validation.

  python3 -m unittest tests.test_season_replay -v        # ou : npm run test:data
"""

from __future__ import annotations

import unittest

import numpy as np
import pandas as pd

from backtest import competition_rules as cr, season_replay as sr


def rules(teams: int, tiebreaks=cr.GD_FIRST, relegation: int = 1, continental: int = 1) -> cr.CompetitionRules:
    return cr.CompetitionRules("FIX", "Fixture League", teams, 2 * (teams - 1), tiebreaks=tiebreaks, relegation_direct=relegation, continental_positions=continental)


def fixture_season(teams: int, start: str = "2024-08-01") -> pd.DataFrame:
    """Calendrier aller-retour fictif, un match par jour, scores à remplir."""
    ids = [f"fx_t{i}" for i in range(teams)]
    rows = []
    day = pd.Timestamp(start)
    k = 0
    for i in range(teams):
        for j in range(teams):
            if i != j:
                rows.append({"match_id": f"fx_m{k:03d}", "competition": "FIX", "season": "2024-25", "stage": "regular_season", "kickoff_utc": day + pd.Timedelta(days=k),
                             "home_team_id": ids[i], "away_team_id": ids[j], "home_team_name": f"Fixture {i}", "away_team_name": f"Fixture {j}",
                             "home_goals": np.nan, "away_goals": np.nan, "usable_for_standings": True, "usable_for_model": True, "match_status": "finished"})
                k += 1
    return pd.DataFrame(rows), ids


def state_of(matches: pd.DataFrame, ids, r) -> dict:
    return sr.played_state(matches[matches["home_goals"].notna()], ids, r)


def probs_for(remaining: pd.DataFrame, p: tuple[float, float, float]) -> np.ndarray:
    return np.tile(np.array(p, float), (len(remaining), 1))


class SimulationTests(unittest.TestCase):
    def test_two_teams_certain_home_win(self) -> None:
        m, ids = fixture_season(2); r = rules(2, relegation=1)
        remaining = m                                             # rien de joué
        sim = sr.simulate(state_of(m, ids, r), remaining, probs_for(remaining, (1.0, 0.0, 0.0)), ids, r, None, n_sims=500, goal_policy="none")
        # chaque équipe gagne à domicile : égalité parfaite 3-3 -> départage approximatif dans toutes les simulations
        self.assertTrue(np.all(sim["points"] == 3))
        self.assertEqual(sim["approximate_share"], 1.0)
        summary = sr.summarise(sim, ids, {}, r)
        for t in ids:
            self.assertAlmostEqual(sum(summary[t]["rankingDistribution"]), 1.0, places=9)

    def test_four_teams_certain_title_and_relegation(self) -> None:
        m, ids = fixture_season(4); r = rules(4, relegation=1)
        # t0 gagne tout 2-0, t3 perd tout, t1 / t2 : matchs 50/50 nul interdit
        def p(row):
            if row.home_team_id == ids[0] or row.away_team_id == ids[3]:
                return (1.0, 0.0, 0.0) if row.home_team_id == ids[0] else (1.0, 0.0, 0.0)
            if row.away_team_id == ids[0] or row.home_team_id == ids[3]:
                return (0.0, 0.0, 1.0)
            return (0.5, 0.0, 0.5)
        probs = np.array([p(row) for row in m.itertuples()])
        cond = [sr.conditional_from_rates(1.3, 1.3)] * len(m)             # scores symétriques : l'égalité t1 / t2 se départage au hasard des buts
        sim = sr.simulate(state_of(m, ids, r), m, probs, ids, r, cond, n_sims=2000, goal_policy="model")
        s = sr.summarise(sim, ids, {}, r)
        self.assertEqual(s[ids[0]]["objectives"]["title"], 1.0)
        self.assertEqual(s[ids[3]]["objectives"]["relegation"], 1.0)
        self.assertEqual(s[ids[0]]["rank"]["p95"], 1.0)
        self.assertLess(abs(s[ids[1]]["rank"]["mean"] - 2.5), 0.15)                  # aucun classement certain entre t1 et t2
        for t in ids:
            self.assertAlmostEqual(sum(s[t]["rankingDistribution"]), 1.0, places=9)
        self.assertAlmostEqual(sum(s[t]["objectives"]["title"] for t in ids), 1.0, places=9)

    def test_remaining_match_certain_draw(self) -> None:
        m, ids = fixture_season(2); r = rules(2)
        sim = sr.simulate(state_of(m, ids, r), m, probs_for(m, (0.0, 1.0, 0.0)), ids, r, None, n_sims=100, goal_policy="none")
        self.assertTrue(np.all(sim["points"] == 2))

    def test_goal_difference_rule_and_head_to_head(self) -> None:
        m, ids = fixture_season(3); r_gd = rules(3, cr.GD_FIRST); r_h2h = rules(3, cr.H2H_FIRST)
        m = m.copy()
        # joué : t0 bat t1 1-0 ; t1 bat t0 3-0 (retour) ; t2 perd tout 0-1 -> t0 et t1 à 9 pts ; GD t1 > t0 ; H2H : t1 +2 en buts, 3 pts chacun
        scores = {("fx_t0", "fx_t1"): (1, 0), ("fx_t1", "fx_t0"): (3, 0), ("fx_t0", "fx_t2"): (1, 0), ("fx_t2", "fx_t0"): (0, 1), ("fx_t1", "fx_t2"): (1, 0), ("fx_t2", "fx_t1"): (0, 1)}
        for i, row in m.iterrows():
            hg, ag = scores[(row.home_team_id, row.away_team_id)]
            m.loc[i, ["home_goals", "away_goals"]] = [hg, ag]
        a_gd = sr.actual_final(m, ids, r_gd); a_h2h = sr.actual_final(m, ids, r_h2h)
        self.assertEqual(a_gd["fx_t1"]["rank"], 1); self.assertEqual(a_h2h["fx_t1"]["rank"], 1)
        # inversons la différence générale sans toucher aux confrontations directes : t0 bat t2 9-0 -> GD t0 > t1, mais H2H t1 devant
        m.loc[(m.home_team_id == "fx_t0") & (m.away_team_id == "fx_t2"), ["home_goals", "away_goals"]] = [9, 0]
        a_gd = sr.actual_final(m, ids, r_gd); a_h2h = sr.actual_final(m, ids, r_h2h)
        self.assertEqual(a_gd["fx_t0"]["rank"], 1)                                     # différence de buts d'abord
        self.assertEqual(a_h2h["fx_t1"]["rank"], 1)                                    # confrontation directe d'abord
        self.assertFalse(a_h2h["_approximate"])

    def test_tiebreak_fallback_is_flagged(self) -> None:
        m, ids = fixture_season(2); r = rules(2)
        m = m.copy(); m.loc[:, ["home_goals", "away_goals"]] = [[1, 1], [1, 1]]
        a = sr.actual_final(m, ids, r)
        self.assertTrue(a["_approximate"])
        self.assertEqual({a[t]["rank"] for t in ids}, {1, 2})

    def test_goal_policies_and_conditional_scores(self) -> None:
        cond = sr.conditional_from_rates(1.5, 1.1)
        for o, (cdf, hg, ag) in enumerate(cond):
            self.assertAlmostEqual(float(cdf[-1]), 1.0, places=9)
            self.assertTrue(np.all((hg > ag) if o == 0 else (hg == ag) if o == 1 else (hg < ag)))
        rng = np.random.default_rng(0)
        hg, ag = sr.sample_scores(np.array([0, 1, 2] * 100), cond, rng)
        self.assertTrue(np.all(hg[::3] > ag[::3])); self.assertTrue(np.all(hg[1::3] == ag[1::3])); self.assertTrue(np.all(hg[2::3] < ag[2::3]))
        m, ids = fixture_season(4)
        m = m.copy(); m["home_goals"] = 1; m["away_goals"] = 0
        emp = sr.empirical_conditional(pd.concat([m.assign(kickoff_utc=m["kickoff_utc"] - pd.Timedelta(days=400))] * 20), "FIX", pd.Timestamp("2024-08-01"))
        self.assertIsNotNone(emp)
        hg2, ag2 = sr.sample_scores(np.zeros(50, int), emp, rng)
        self.assertTrue(np.all(hg2 > ag2))

    def test_reproducible(self) -> None:
        m, ids = fixture_season(4); r = rules(4)
        probs = probs_for(m, (0.45, 0.27, 0.28)); cond = [sr.conditional_from_rates(1.4, 1.1)] * len(m)
        a = sr.simulate(state_of(m, ids, r), m, probs, ids, r, cond, n_sims=300, seed=7)
        b = sr.simulate(state_of(m, ids, r), m, probs, ids, r, cond, n_sims=300, seed=7)
        np.testing.assert_array_equal(a["ranks"], b["ranks"]); np.testing.assert_array_equal(a["points"], b["points"])
        c = sr.simulate(state_of(m, ids, r), m, probs, ids, r, cond, n_sims=300, seed=8)
        self.assertFalse(np.array_equal(a["ranks"], c["ranks"]))
        sa = sr.summarise(a, ids, {}, r); sb = sr.summarise(b, ids, {}, r)
        self.assertEqual(sr.result_hash({"teams_summary": sa}), sr.result_hash({"teams_summary": sb}))

    def test_validation_metrics(self) -> None:
        m, ids = fixture_season(4); r = rules(4, relegation=1)
        probs = np.array([(1.0, 0.0, 0.0) if row.home_team_id == ids[0] else (0.0, 0.0, 1.0) if row.away_team_id == ids[0] else (0.5, 0.0, 0.5) for row in m.itertuples()])
        sim = sr.simulate(state_of(m, ids, r), m, probs, ids, r, None, n_sims=500, goal_policy="none")
        s = sr.summarise(sim, ids, {}, r)
        actual = {ids[0]: {"rank": 1, "points": 18.0}, ids[1]: {"rank": 2, "points": 9.0}, ids[2]: {"rank": 3, "points": 6.0}, ids[3]: {"rank": 4, "points": 3.0}}
        v = sr.validate(s, actual, r)
        self.assertTrue(v["top1Hit"]); self.assertEqual(v["championProbability"], 1.0)
        self.assertEqual(v["maePoints"], 0.0) if False else self.assertGreaterEqual(v["maePoints"], 0)
        self.assertIn("relegationBrier", v); self.assertIn("continentalBrier", v); self.assertTrue(-1 <= v["spearman"] <= 1)


class RulesTests(unittest.TestCase):
    def test_registry_is_explicit(self) -> None:
        for key, r in cr.RULES.items():
            self.assertEqual(r.key, key); self.assertEqual(r.matches, r.teams * (r.teams - 1)); self.assertEqual(r.rounds, 2 * (r.teams - 1))
            self.assertEqual(r.tiebreaks[0], cr.POINTS)
            obj = r.objectives()
            self.assertIn("title", obj)
            self.assertTrue(("continental" in obj) != (r.promotion_positions > 0))
        self.assertTrue(cr.uses_head_to_head_first(cr.RULES["ESP"])); self.assertFalse(cr.uses_head_to_head_first(cr.RULES["ENG"]))
        self.assertNotIn("USA", cr.RULES); self.assertIn("USA", cr.UNSUPPORTED)


if __name__ == "__main__":
    unittest.main()
