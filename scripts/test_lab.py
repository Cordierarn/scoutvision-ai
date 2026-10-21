"""
Tests des expériences du Laboratoire (scripts/lab.py) sur données simulées : chaque expérience
doit retrouver un effet connu, ou son absence.

  python3 -m unittest discover -s scripts -p "test_*.py"      # ou : npm run test:data
"""

from __future__ import annotations

import unittest

import numpy as np
import pandas as pd

import lab


def season_frame(effect: float, seed: int = 0, teams: int = 20, seasons: int = 3, games: int = 38):
    """Saisons simulées : performance = niveau de l'équipe + bruit ; un club en crise (10 derniers
    matchs nettement sous ses matchs précédents de la saison) change d'entraîneur une fois sur deux,
    ce qui ajoute `effect` ensuite. La décision ne dépend que des résultats observés : si les
    dirigeants en savaient plus que les données sur le niveau réel, l'estimation pencherait vers un
    effet positif (biais qui renforce le constat d'un effet nul sur les vraies données)."""
    rng = np.random.default_rng(seed)
    rows, coach_rows = [], []
    start = pd.Timestamp("2021-08-01")
    for s in range(seasons):
        season = f"{2021 + s}-{str(2022 + s)[2:]}"
        for t in range(teams):
            level = rng.normal(0, 0.4)
            coach, changed, bonus = f"c{s}_{t}_0", False, 0.0
            perf = []
            for k in range(games):
                if not changed and k >= 15 and np.mean(perf[-10:]) < np.mean(perf[:-10]) - 0.5 and rng.random() < 0.5:
                    coach, changed, bonus = f"c{s}_{t}_1", True, effect
                v = level + bonus + rng.normal(0, 0.9)
                perf.append(v)
                mid = f"m{s}_{t}_{k}"
                rows.append({"comp": "AAA", "app_season": season, "match_id": mid, "team_id": f"t{t}",
                             "date": start + pd.Timedelta(days=365 * s + 7 * k), "league": True, "perf": v,
                             "pts": 3 if v > 0.4 else (1 if v > -0.4 else 0)})
                coach_rows.append({"match_id": mid, "team_id": f"t{t}", "coach": coach})
    return pd.DataFrame(rows), pd.DataFrame(coach_rows)


class CoachChangeTest(unittest.TestCase):
    def test_no_effect_is_not_mistaken_for_a_bounce(self) -> None:
        tm, coaches = season_frame(effect=0.0)
        out = lab.coach_change(tm, coaches)
        self.assertGreater(out["changes"], 20)
        self.assertGreater(out["naive"], 0.1)                     # les clubs en crise remontent...
        self.assertLess(out["effectCi"][0], 0)                    # ... sans effet propre du changement
        self.assertGreater(out["effectCi"][1], 0)
        self.assertEqual(out["verdict"], "debunked")
        self.assertEqual(len(out["curve"]["changers"]), 20)

    def test_real_effect_is_found(self) -> None:
        tm, coaches = season_frame(effect=0.6, seed=1)
        out = lab.coach_change(tm, coaches)
        self.assertAlmostEqual(out["effect"], 0.6, delta=0.25)
        self.assertGreater(out["effectCi"][0], 0)
        self.assertEqual(out["verdict"], "validated")


class SpellTest(unittest.TestCase):
    def test_short_absence_and_spelling_do_not_split_a_spell(self) -> None:
        coaches = ["Luis García"] * 6 + ["Adjoint"] * 2 + ["Luis Garcia"] * 6 + ["Nouveau"] * 3 + ["Autre"] * 4
        tm = pd.DataFrame({"match_id": [f"m{i}" for i in range(len(coaches))], "team_id": "t",
                           "date": pd.date_range("2024-08-01", periods=len(coaches), freq="7D")})
        co = lab.coach_by_match(pd.DataFrame({"match_id": tm["match_id"], "team_id": "t", "coach_name": coaches, "role": "starter"}))
        df = lab._with_spells(tm, co)
        self.assertEqual(df["spell"].nunique(), 3)                          # Garcia (adjoint compris), Nouveau, Autre
        self.assertEqual(df.loc[df["spell"] == df["spell"].min(), "coach"].nunique(), 1)


class CoachDnaTest(unittest.TestCase):
    def frame(self, imprint: float, seed: int = 2):
        """Chaque entraîneur a une signature de style ; une période = 0,5 x style d'avant du club
        + imprint x signature + bruit. Les entraîneurs changent de club."""
        rng = np.random.default_rng(seed)
        coaches_sig = {f"c{i}": rng.normal(0, 1, len(lab.STYLE)) for i in range(60)}
        names = list(coaches_sig)
        rows, coach_rows = [], []
        date = pd.Timestamp("2021-08-01")
        for t in range(30):
            style = rng.normal(0, 1, len(lab.STYLE))
            for spell in range(4):
                c = names[(t * 3 + spell * 7) % len(names)]
                style = 0.5 * style + imprint * coaches_sig[c] + rng.normal(0, 0.3, len(lab.STYLE))
                for k in range(15):
                    mid = f"m{t}_{spell}_{k}"
                    raw = {col: sign * (style[i] + rng.normal(0, 0.2)) for i, (col, sign) in enumerate(lab.STYLE.values())}
                    rows.append({"comp": "AAA", "app_season": "2023-24", "match_id": mid, "team_id": f"t{t}",
                                 "team_name": f"T{t}", "date": date + pd.Timedelta(days=200 * spell + 7 * k + t),
                                 "league": True, "perf": 0.0, **raw})
                    coach_rows.append({"match_id": mid, "team_id": f"t{t}", "coach": c})
        return pd.DataFrame(rows), pd.DataFrame(coach_rows)

    def test_imprint_is_recovered(self) -> None:
        tm, coaches = self.frame(imprint=0.6)
        out = lab.coach_dna(tm, coaches, boot=100)
        self.assertGreater(out["arrivals"], 30)
        for dim in lab.STYLE:
            self.assertGreater(out["imprint"][dim]["coach"], 0.2)
        self.assertEqual(out["verdict"], "validated")

    def test_no_imprint(self) -> None:
        tm, coaches = self.frame(imprint=0.0, seed=3)
        out = lab.coach_dna(tm, coaches, boot=100)
        mean_coef = np.mean([v["coach"] for v in out["imprint"].values()])
        self.assertLess(abs(mean_coef), 0.15)


class WinProbabilityTest(unittest.TestCase):
    def setUp(self) -> None:
        goals = pd.DataFrame({"t": np.arange(1, 91, dtype=float)})          # un but par minute : temps uniforme
        self.wp = lab.WinProbability(goals, scale=1.0)

    def test_symmetry_and_certainty(self) -> None:
        win, draw, loss = self.wp.outcome([0], [0], [0], [1.4], [1.4])
        self.assertAlmostEqual(float(win[0]), float(loss[0]), places=9)
        self.assertAlmostEqual(float(win[0] + draw[0] + loss[0]), 1.0, places=5)    # Poisson tronquée à 10 buts
        win, draw, loss = self.wp.outcome([1], [0], [90], [1.4], [1.4])
        self.assertGreater(float(win[0]), 0.95)                              # il reste le temps additionnel

    def test_goal_values(self) -> None:
        before, _ = self.wp.points([0], [0], [85], [1.4], [1.4])
        after, _ = self.wp.points([1], [0], [85], [1.4], [1.4])
        self.assertGreater(float(after[0] - before[0]), 1.5)                 # but de la victoire en fin de match
        before, _ = self.wp.points([3], [0], [60], [1.4], [1.4])
        after, _ = self.wp.points([4], [0], [60], [1.4], [1.4])
        self.assertLess(float(after[0] - before[0]), 0.05)                   # but « de confort »


class GoalTimelineTest(unittest.TestCase):
    def test_score_before_each_goal_and_consistency(self) -> None:
        ev = pd.DataFrame([
            {"match_id": "a", "event_type": "goal", "is_cancelled": False, "credited_side": "home", "period": "FirstHalf", "minute": 10, "minute_added": 0, "seq": 1},
            {"match_id": "a", "event_type": "goal", "is_cancelled": False, "credited_side": "away", "period": "SecondHalf", "minute": 50, "minute_added": 0, "seq": 2},
            {"match_id": "a", "event_type": "yellowcard", "is_cancelled": False, "credited_side": None, "period": "SecondHalf", "minute": 60, "minute_added": 0, "seq": 3},
            {"match_id": "b", "event_type": "goal", "is_cancelled": False, "credited_side": "home", "period": "FirstHalf", "minute": 5, "minute_added": 0, "seq": 1},
        ])
        matches = pd.DataFrame({"match_id": ["a", "b"], "score_home": [1, 2], "score_away": [1, 0]})
        g = lab.goal_timeline(ev, matches)
        self.assertEqual(list(g["match_id"].unique()), ["a"])               # b : chronologie incomplète
        self.assertEqual(g[["h_before", "a_before"]].values.tolist(), [[0, 0], [1, 0]])


class PassDuosTest(unittest.TestCase):
    def test_planted_affinity_is_reliable(self) -> None:
        rng = np.random.default_rng(4)
        rows, pos = [], []
        players = [f"p{i}" for i in range(6)]
        # Affinité vraie de chaque duo de chaque équipe (multiplicateur log-normal), plus un duo
        # nettement préférentiel dans une équipe sur deux
        true = {(t, i, j): float(np.exp(rng.normal(0, 0.3))) for t in range(30) for i in range(6) for j in range(6)}
        for team in range(30):
            for m in range(20):
                mid = f"m{team}_{m}"
                for i, a in enumerate(players):
                    pos.append({"match_id": mid, "player_id": f"{team}{a}", "zone": f"Z{i}"})
                    for j, b in enumerate(players):
                        if a == b:
                            continue
                        favoured = team % 2 == 0 and (i, j) == (0, 1)
                        lam = 6 * true[(team, i, j)] * (2.0 if favoured else 1.0)
                        rows.append({"comp": "AAA", "app_season": "2024-25", "match_id": mid, "team_id": f"t{team}",
                                     "from_player_id": f"{team}{a}", "to_player_id": f"{team}{b}", "passes": rng.poisson(lam)})
        out = lab.pass_duos(pd.DataFrame(rows), pd.DataFrame(pos), min_expected=30)
        duos = out["duos"]
        planted = duos[(duos["from_player_id"].str.endswith("p0")) & (duos["to_player_id"].str.endswith("p1"))]
        even = planted[planted["team_id"].str[1:].astype(int) % 2 == 0]
        odd = planted[planted["team_id"].str[1:].astype(int) % 2 == 1]
        # L'attendu (volume x placement) absorbe une partie de l'excès : l'affinité est prudente
        self.assertGreater(even["affinity"].mean() - odd["affinity"].mean(), 0.25)
        self.assertGreater(out["reliability"], 0.4)
        est = duos.assign(i=duos["from_player_id"].str[-1].astype(int), j=duos["to_player_id"].str[-1].astype(int),
                          t=duos["team_id"].str[1:].astype(int))
        truth = np.log([true[(t, i, j)] for t, i, j in zip(est["t"], est["i"], est["j"])])
        self.assertGreater(np.corrcoef(est["affinity"], truth)[0, 1], 0.5)


class ElevatorTest(unittest.TestCase):
    def test_signal_and_big5_exclusion(self) -> None:
        rng = np.random.default_rng(5)
        levels = {"LOW": -2.0, "MID": 0.5, "TOP": 4.0}
        tiers = {"LOW": 3, "MID": 2, "TOP": 1}
        seasons = ["2021-22", "2022-23", "2023-24", "2024-25", "2025-26", "2026-27"]
        rows = []
        for i in range(2500):
            comp = rng.choice(["LOW", "MID"]); team = f"{comp}{rng.integers(0, 12)}"
            idx = rng.uniform(20, 95)
            for k, s in enumerate(seasons):
                rows.append({"Player ID": f"p{i}", "Player": f"P{i}", "Team": team, "Team ID": team, "Competition": comp,
                             "League tier": tiers[comp], "Position": rng.choice(["CB", "ST"]), "Age": 20 + k,
                             "Minutes share": 0.8, "best_index": idx, "best_role": "r", "_app_season": s})
                if comp != "TOP" and rng.random() < 1 / (1 + np.exp(-(idx - 85) / 4)):
                    comp, team = "TOP", f"TOP{rng.integers(0, 12)}"
        players = pd.DataFrame(rows)
        team_xgd = players[["Competition", "_app_season", "Team ID"]].drop_duplicates().assign(team_xgd=0.0)
        out = lab.elevator(players, levels, {1: 4.0, 2: 0.5, 3: -2.0}, team_xgd, current="2026-27")
        self.assertGreater(out["validation"]["auc"], 0.8)
        self.assertEqual(out["validation"]["base"], "2024-25")
        self.assertTrue((out["provisional"]["League tier"] != 1).all())     # pas de prévision pour le Big 5
        self.assertEqual(out["verify"]["base"], "2025-26")


class RefereeTest(unittest.TestCase):
    def test_strict_referee_is_detected(self) -> None:
        rng = np.random.default_rng(6)
        matches, events = [], []
        for i in range(1200):
            ref = f"r{i % 20}"
            mid = f"m{i}"
            matches.append({"comp": "AAA", "app_season": "2024-25", "match_id": mid, "match_status": "finished",
                            "referee": ref, "home_team_id": "h", "date": pd.Timestamp("2024-08-01") + pd.Timedelta(days=i)})
            n = rng.poisson(4 + (2.5 if ref == "r0" else 0.0))
            events += [{"match_id": mid, "event_type": "yellowcard", "team_id": "h" if k % 2 else "a",
                        "is_penalty": False, "is_cancelled": False} for k in range(n)]
        out = lab.referees(pd.DataFrame(matches), pd.DataFrame(events), min_matches=30)
        table = out["table"].set_index("referee")
        self.assertGreater(table.loc["r0", "cards_shrunk"], 1.5)
        self.assertGreater(out["reliability"]["cards"]["r"], 0.5)


if __name__ == "__main__":
    unittest.main()
