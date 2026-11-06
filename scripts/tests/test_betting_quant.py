"""
Tests du moteur quantitatif du Labo paris (étape 1) : devigging (proportionnel, puissances, Shin), référence
sharp d'un marché, pool modèle / sharp, mouvement sharp, OPD, dépendance à un joueur clé, coupe-circuit et
Kelly rétréci. Sans réseau, sans données réelles.

  python3 -m unittest tests.test_betting_quant -v        # ou : npm run test:data
"""

from __future__ import annotations

import datetime as dt
import json
import tempfile
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

from betting import catalogue, circuit, dependency, opd, product, sharp
from betting import markets as mk
from betting import suggest as sg
from betting import simulate as sm

KO = pd.Timestamp("2026-11-07T15:00:00Z")
CAT = catalogue.parse([
    {"marketId": 101, "marketType": "1x2", "period": "fulltime", "handicap": 0.0, "sportId": 10, "playerProp": False,
     "outcomes": [{"outcomeId": 101, "outcomeName": "1"}, {"outcomeId": 102, "outcomeName": "X"}, {"outcomeId": 103, "outcomeName": "2"}]},
    {"marketId": 201, "marketType": "totals", "period": "fulltime", "handicap": 2.5, "sportId": 10, "playerProp": False,
     "outcomes": [{"outcomeId": 211, "outcomeName": "Over"}, {"outcomeId": 212, "outcomeName": "Under"}]},
    {"marketId": 301, "marketType": "spreads", "period": "fulltime", "handicap": -0.25, "sportId": 10, "playerProp": False,
     "outcomes": [{"outcomeId": 311, "outcomeName": "1"}, {"outcomeId": 312, "outcomeName": "2"}]},
    {"marketId": 401, "marketType": "doublechance", "period": "fulltime", "handicap": 0.0, "sportId": 10, "playerProp": False,
     "outcomes": [{"outcomeId": 411, "outcomeName": "1X"}, {"outcomeId": 412, "outcomeName": "X2"}, {"outcomeId": 413, "outcomeName": "12"}]},
])


def snap(bookmaker, market_id, outcome_id, price, at, limit=None):
    return {"fixture_id": "f1", "bookmaker": bookmaker, "market_id": market_id, "outcome_id": outcome_id, "player_id": None,
            "created_at": pd.Timestamp(at), "price": price, "limit": limit, "active": True, "source": "historical"}


def frame(rows):
    df = pd.DataFrame(rows)
    df["created_at"] = pd.to_datetime(df["created_at"], utc=True)
    df["limit"] = pd.to_numeric(df["limit"], errors="coerce")
    return df


class DevigTests(unittest.TestCase):
    def test_fair_book_is_unchanged(self):
        q = sharp.implied([2.0, 4.0, 4.0])
        np.testing.assert_allclose(sharp.devig_shin(q)[0], q)
        np.testing.assert_allclose(sharp.devig_power(q)[0], q)

    def test_methods_sum_to_one_and_shin_loads_the_outsider(self):
        q = sharp.implied([1.30, 5.50, 10.0])            # marge ≈ 5 %
        prop = sharp.devig_proportional(q)
        pw, k = sharp.devig_power(q)
        sh, z = sharp.devig_shin(q)
        for p in (prop, pw, sh):
            self.assertAlmostEqual(float(p.sum()), 1.0, places=9)
        self.assertGreater(k, 1.0); self.assertGreater(z, 0.0)
        # favori-outsider : Shin et puissances retirent plus de marge à l'outsider que la proportionnelle
        self.assertLess(sh[2], prop[2]); self.assertLess(pw[2], prop[2])
        self.assertGreater(sh[0], prop[0])
        # ordre préservé
        self.assertTrue(sh[0] > sh[1] > sh[2])

    def test_shin_two_way_known_case(self):
        # cotes 1,91 / 1,91 : marge symétrique, Shin rend 50 / 50
        sh, z = sharp.devig_shin(sharp.implied([1.91, 1.91]))
        np.testing.assert_allclose(sh, [0.5, 0.5], atol=1e-9)
        self.assertGreater(z, 0.0)

    def test_invalid_odds_rejected(self):
        with self.assertRaises(ValueError):
            sharp.implied([1.0, 2.0])


class ReferenceTests(unittest.TestCase):
    def test_pinnacle_first_then_betfair_then_none(self):
        t = KO - pd.Timedelta(hours=2)
        snaps = frame([snap("winamax.fr", 101, 101, 1.70, t), snap("winamax.fr", 101, 102, 3.80, t), snap("winamax.fr", 101, 103, 5.50, t),
                       snap("betfair-ex", 101, 101, 1.80, t), snap("betfair-ex", 101, 102, 3.95, t), snap("betfair-ex", 101, 103, 5.9, t),
                       snap("pinnacle", 101, 101, 1.72, t, 2000), snap("pinnacle", 101, 102, 3.90, t, 2000), snap("pinnacle", 101, 103, 5.50, t, 1500)])
        ref = sharp.market_reference(snaps, CAT, 101, KO)
        self.assertEqual(ref.bookmaker, "pinnacle")
        self.assertAlmostEqual(sum(ref.shin.values()), 1.0, places=9)
        self.assertEqual(ref.limits, {101: 2000.0, 102: 2000.0, 103: 1500.0})
        self.assertGreater(ref.overround, 0.0)
        only_bf = sharp.market_reference(snaps[snaps["bookmaker"] != "pinnacle"], CAT, 101, KO)
        self.assertEqual(only_bf.bookmaker, "betfair-ex")
        self.assertIsNone(sharp.market_reference(snaps[snaps["bookmaker"] == "winamax.fr"], CAT, 101, KO))   # Winamax n'est jamais une référence

    def test_incomplete_or_stale_market_gives_no_reference(self):
        t = KO - pd.Timedelta(hours=2)
        partial = frame([snap("pinnacle", 101, 101, 1.78, t), snap("pinnacle", 101, 102, 3.90, t)])        # pas de « 2 »
        self.assertIsNone(sharp.market_reference(partial, CAT, 101, KO))
        stale = frame([snap("pinnacle", 201, 211, 1.95, KO - pd.Timedelta(hours=9)), snap("pinnacle", 201, 212, 1.95, KO - pd.Timedelta(hours=9))])
        self.assertIsNone(sharp.market_reference(stale, CAT, 201, KO))
        self.assertIsNotNone(sharp.closing_reference(stale, CAT, 201, KO))                             # la clôture n'a pas de borne d'âge
        dc = frame([snap("pinnacle", 401, 411, 1.2, t), snap("pinnacle", 401, 412, 1.5, t), snap("pinnacle", 401, 413, 1.3, t)])
        self.assertIsNone(sharp.market_reference(dc, CAT, 401, KO))                                     # double chance : issues recouvrantes

    def test_quarter_line_spread_is_a_two_way_reference(self):
        t = KO - pd.Timedelta(hours=1)
        s = frame([snap("pinnacle", 301, 311, 1.98, t), snap("pinnacle", 301, 312, 1.92, t)])
        ref = sharp.market_reference(s, CAT, 301, KO)
        self.assertIsNotNone(ref)
        self.assertAlmostEqual(ref.shin[311] + ref.shin[312], 1.0, places=9)

    def test_latest_snapshot_per_outcome_before_the_bound(self):
        early, late = KO - pd.Timedelta(hours=3), KO - pd.Timedelta(hours=1)
        s = frame([snap("pinnacle", 201, 211, 2.10, early), snap("pinnacle", 201, 212, 1.80, early), snap("pinnacle", 201, 211, 1.90, late), snap("pinnacle", 201, 212, 1.98, late),
                   snap("pinnacle", 201, 211, 1.50, KO + pd.Timedelta(minutes=10)), snap("pinnacle", 201, 212, 2.60, KO + pd.Timedelta(minutes=10))])
        ref = sharp.market_reference(s, CAT, 201, KO)
        self.assertEqual((ref.prices[211], ref.prices[212]), (1.90, 1.98))                             # jamais un relevé après le coup d'envoi


class PoolTests(unittest.TestCase):
    def test_pool_weights(self):
        self.assertEqual(sharp.pool(0.70, 0.60, 0.0), 0.60)
        self.assertEqual(sharp.pool(0.70, 0.60, 1.0), 0.70)
        mid = sharp.pool(0.70, 0.60, 0.5)
        self.assertTrue(0.60 < mid < 0.70)
        self.assertAlmostEqual(sharp.pool(0.5, 0.5, 0.3), 0.5)

    def test_segment_weights_default_to_zero(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "w.json"
            self.assertEqual(sharp.PoolWeights.load(p).weight("résultat", "ENG"), 0.0)
            p.write_text(json.dumps({"weights": {"handicap asiatique|ENG2": 0.3, "plus/moins": 0.1}}))
            w = sharp.PoolWeights.load(p)
            self.assertEqual(w.weight("handicap asiatique", "ENG2"), 0.3)
            self.assertEqual(w.weight("handicap asiatique", "ENG"), 0.0)
            self.assertEqual(w.weight("plus/moins", "FRA"), 0.1)


class MoveTests(unittest.TestCase):
    def test_limit_backed_move_against_the_selection(self):
        now = KO - pd.Timedelta(hours=2)
        t0 = now - pd.Timedelta(hours=30)
        s = frame([snap("pinnacle", 201, 211, 1.95, t0, 1000), snap("pinnacle", 201, 212, 1.95, t0, 1000),
                   snap("pinnacle", 201, 211, 2.10, now - pd.Timedelta(minutes=5), 3000), snap("pinnacle", 201, 212, 1.80, now - pd.Timedelta(minutes=5), 3000)])
        ref = sharp.market_reference(s, CAT, 201, now)
        mv = sharp.sharp_move(s, CAT, 201, 211, now, ref)       # on parie Over, dont la cote monte : argent sur Under
        self.assertLess(mv.delta, -0.03)
        self.assertTrue(mv.limit_up)
        self.assertEqual(mv.from_at, t0.to_pydatetime())

    def test_move_falls_back_to_the_oldest_snapshot_three_hours_away(self):
        now = KO - pd.Timedelta(hours=2)
        s = frame([snap("pinnacle", 201, 211, 1.95, now - pd.Timedelta(hours=4)), snap("pinnacle", 201, 212, 1.95, now - pd.Timedelta(hours=4)),
                   snap("pinnacle", 201, 211, 1.96, now - pd.Timedelta(minutes=5)), snap("pinnacle", 201, 212, 1.94, now - pd.Timedelta(minutes=5))])
        ref = sharp.market_reference(s, CAT, 201, now)
        mv = sharp.sharp_move(s, CAT, 201, 211, now, ref)
        self.assertIsNone(mv.limit_up)
        self.assertAlmostEqual(mv.delta, ref.shin[211] - 0.5, places=6)
        recent_only = frame([snap("pinnacle", 201, 211, 1.95, now - pd.Timedelta(hours=1)), snap("pinnacle", 201, 212, 1.95, now - pd.Timedelta(hours=1))])
        self.assertIsNone(sharp.sharp_move(recent_only, CAT, 201, 211, now, sharp.market_reference(recent_only, CAT, 201, now)))

    def test_clv(self):
        self.assertAlmostEqual(sharp.clv(2.0, 0.55), 0.10)
        self.assertAlmostEqual(sharp.clv(2.0, 0.45), -0.10)


class OpdTests(unittest.TestCase):
    def matches(self, goals, xg, conceded=None):
        rows = []
        for i, (g, x) in enumerate(zip(goals, xg)):
            rows.append({"match_id": f"m{i}", "kickoff_utc": KO - pd.Timedelta(days=7 * (len(goals) - i)), "home_team_id": "A", "away_team_id": f"B{i}",
                         "ft_home": g, "ft_away": 0 if conceded is None else conceded[i], "home_xg": x, "away_xg": 1.0})
        return pd.DataFrame(rows)

    def test_expected_points_is_three_times_win_plus_draw(self):
        self.assertAlmostEqual(opd.expected_points(1.0, 1.0), 3 * 0.3487 + 0.3026, places=2)  # loi de Poisson 1,0 / 1,0 : symétrie
        self.assertGreater(opd.expected_points(2.5, 0.5), 2.0)

    def test_overperformance_detected_only_with_enough_matches(self):
        good_luck = opd.team_opd(self.matches([2, 3, 2, 2, 2], [0.8, 0.9, 0.7, 1.0, 0.6]), "A", KO)
        self.assertTrue(good_luck.overperforming)
        self.assertGreater(good_luck.goals_minus_xg, opd.OVERPERFORMANCE_GOALS)
        normal = opd.team_opd(self.matches([1, 1, 2, 0, 1], [1.2, 0.9, 1.7, 0.8, 1.1], conceded=[1, 1, 1, 1, 0]), "A", KO)
        self.assertFalse(normal.overperforming)                           # 2 V 2 N 1 D pour des xG équilibrés : rien d'anormal
        self.assertIsNone(opd.team_opd(self.matches([3, 3, 3], [0.5, 0.5, 0.5]), "A", KO))
        self.assertIsNone(opd.team_opd(self.matches([3, 3, 3, 3, 3], [0.5] * 5), "A", KO - pd.Timedelta(days=60)))   # avant tous les matchs


class DependencyTests(unittest.TestCase):
    def rows(self, hub_share):
        others = 7
        rows = [{"Team ID": "t1", "Player": f"J{i}", "Matches played": 8, "Minutes share": 0.8, "Network betweenness": (1 - hub_share) / others, "RAPM net": 0.0} for i in range(others)]
        rows.append({"Team ID": "t1", "Player": "Hub", "Matches played": 9, "Minutes share": 0.9, "Network betweenness": hub_share, "RAPM net": 0.21})
        rows.append({"Team ID": "t1", "Player": "Remplaçant", "Matches played": 6, "Minutes share": 0.2, "Network betweenness": 5.0, "RAPM net": 0.5})   # hors titulaires
        return rows

    def test_strong_dependency_on_a_hub(self):
        d = dependency.TeamDependencies(self.rows(0.4)).of("t1")
        self.assertEqual(d.player, "Hub"); self.assertAlmostEqual(d.share, 0.4); self.assertTrue(d.strong); self.assertEqual(d.rapm_net, 0.21)
        self.assertFalse(dependency.TeamDependencies(self.rows(0.2)).of("t1").strong)
        self.assertIsNone(dependency.TeamDependencies(self.rows(0.4)).of("t2"))
        self.assertIsNone(dependency.TeamDependencies([]).of("t1"))


class CircuitTests(unittest.TestCase):
    def ref(self, p_sharp, bookmaker="pinnacle"):
        return sharp.Reference(bookmaker, 101, KO.to_pydatetime(), 0.03, 0.02, {101: p_sharp, 102: (1 - p_sharp) * 0.6, 103: (1 - p_sharp) * 0.4},
                               {101: p_sharp, 102: (1 - p_sharp) * 0.6, 103: (1 - p_sharp) * 0.4}, {101: 1.8}, {})

    def test_no_reference_means_no_bet(self):
        a = circuit.assess(0.62, 1.80, "résultat", mk.Spec("1x2", "fulltime", 0.0, "1"), None, 101, 0.0)
        self.assertEqual((a.verdict, a.blocks, a.stake_fraction), ("no_bet", ["reference_absente"], 0.0))

    def test_sharp_probability_is_the_reference_when_w_is_zero(self):
        a = circuit.assess(0.70, 1.80, "résultat", mk.Spec("1x2", "fulltime", 0.0, "1"), self.ref(0.58), 101, 0.0)
        self.assertEqual(a.p_ref, 0.58)
        self.assertAlmostEqual(a.ev, 0.58 * 1.8 - 1)                  # +4,4 % : passe le seuil des marchés 1N2
        self.assertEqual(a.verdict, "bet")
        self.assertAlmostEqual(a.stake_fraction, round(min(0.025, 0.15 * (0.58 * 1.8 - 1) / 0.8), 4))
        low = circuit.assess(0.70, 1.80, "résultat", mk.Spec("1x2", "fulltime", 0.0, "1"), self.ref(0.57), 101, 0.0)
        self.assertEqual(low.blocks, ["ev_insuffisant"])              # +2,6 % : insuffisant pour un 1N2…
        ah = circuit.assess(0.70, 1.80, "handicap asiatique", mk.Spec("spreads", "fulltime", -0.5, "1"), self.ref(0.57), 101, 0.0)
        self.assertEqual(ah.verdict, "bet")                           # …mais suffisant pour un handicap asiatique

    def test_winner_curse_and_edge(self):
        a = circuit.assess(0.80, 1.80, "résultat", mk.Spec("1x2", "fulltime", 0.0, "1"), self.ref(0.56), 101, 1.0)   # w = 1 : modèle seul
        self.assertIn("winner_curse", a.blocks)                      # EV +44 %, écart +24 points
        b = circuit.assess(0.80, 1.50, "résultat", mk.Spec("1x2", "fulltime", 0.0, "1"), self.ref(0.62), 101, 0.5)
        self.assertNotIn("winner_curse", b.blocks)                      # p_ref ≈ 0,72 : EV +8 %, écart +10 points

    def test_contrary_sharp_move(self):
        spec = mk.Spec("1x2", "fulltime", 0.0, "1")
        backed = sharp.SharpMove("pinnacle", KO.to_pydatetime(), KO.to_pydatetime(), 0.61, 0.58, 1000, 3000)
        self.assertIn("sharp_contraire", circuit.assess(0.70, 1.80, "résultat", spec, self.ref(0.58), 101, 0.0, move=backed).blocks)
        limit_down = sharp.SharpMove("pinnacle", KO.to_pydatetime(), KO.to_pydatetime(), 0.61, 0.58, 3000, 1000)
        self.assertNotIn("sharp_contraire", circuit.assess(0.70, 1.80, "résultat", spec, self.ref(0.58), 101, 0.0, move=limit_down).blocks)
        unknown_weak = sharp.SharpMove("betfair-ex", KO.to_pydatetime(), KO.to_pydatetime(), 0.60, 0.58, None, None)
        a = circuit.assess(0.70, 1.80, "résultat", spec, self.ref(0.58, "betfair-ex"), 101, 0.0, move=unknown_weak)
        self.assertNotIn("sharp_contraire", a.blocks); self.assertIn("limite_inconnue", a.warnings)
        unknown_strong = sharp.SharpMove("betfair-ex", KO.to_pydatetime(), KO.to_pydatetime(), 0.62, 0.58, None, None)
        self.assertIn("sharp_contraire", circuit.assess(0.70, 1.80, "résultat", spec, self.ref(0.58, "betfair-ex"), 101, 0.0, move=unknown_strong).blocks)

    def test_overperforming_favourite_is_refused(self):
        spec = mk.Spec("1x2", "fulltime", 0.0, "1")
        a = circuit.assess(0.80, 1.40, "résultat", spec, self.ref(0.75), 101, 0.0, overperforming={"home": True, "away": False})
        self.assertIn("favori_surperformant", a.blocks)
        b = circuit.assess(0.80, 1.40, "résultat", spec, self.ref(0.75), 101, 0.0, overperforming={"home": False, "away": True})
        self.assertNotIn("favori_surperformant", b.blocks)
        c = circuit.assess(0.80, 1.60, "résultat", spec, self.ref(0.75), 101, 0.0, overperforming={"home": True, "away": False})
        self.assertNotIn("favori_surperformant", c.blocks)          # cote ≥ 1,55 : pas un favori populaire
        self.assertIsNone(circuit.backed_team(mk.Spec("totals", "fulltime", 2.5, "Over")))
        self.assertEqual(circuit.backed_team(mk.Spec("doublechance", "fulltime", 0.0, "X2")), "away")

    def test_key_player_dependency_halves_the_cap_only_before_lineups(self):
        spec = mk.Spec("totals", "fulltime", 2.5, "Under")
        ref = sharp.Reference("pinnacle", 201, KO.to_pydatetime(), 0.03, 0.02, {211: 0.4, 212: 0.6}, {211: 0.4, 212: 0.6}, {212: 1.75}, {})
        far = circuit.assess(0.7, 1.75, "plus/moins", spec, ref, 212, 0.0, dependency={"home": "Hub", "away": None}, hours_to_kickoff=30)
        near = circuit.assess(0.7, 1.75, "plus/moins", spec, ref, 212, 0.0, dependency={"home": "Hub", "away": None}, hours_to_kickoff=2)
        self.assertEqual(far.warnings, ["dependance_joueur_cle"]); self.assertEqual(near.warnings, [])
        self.assertEqual(far.verdict, "bet")
        self.assertLessEqual(far.stake_fraction, circuit.CAP_PER_BET * circuit.DEPENDENCY_CAP_FACTOR)
        self.assertGreaterEqual(near.stake_fraction, far.stake_fraction)

    def test_stake_caps(self):
        self.assertAlmostEqual(circuit.shrink_kelly(0.6, 2.0), 0.15 * 0.2)
        self.assertEqual(circuit.shrink_kelly(0.4, 2.0), 0.0)
        self.assertEqual(circuit.stake_cap(4.0, False), circuit.CAP_HIGH_ODDS)
        self.assertEqual(circuit.cap_match([0.02, 0.02, 0.02]), [0.0166, 0.0166, 0.0166])            # arrondi par défaut : somme ≤ 5 %
        self.assertEqual(circuit.cap_match([0.02, 0.01]), [0.02, 0.01])


class CalibrationMarginTests(unittest.TestCase):
    def test_ev_threshold_adds_the_segment_margin_and_assess_records_the_required_ev(self):
        self.assertAlmostEqual(circuit.ev_threshold("plus/moins"), 0.025); self.assertAlmostEqual(circuit.ev_threshold("résultat"), 0.04)
        self.assertAlmostEqual(circuit.ev_threshold("plus/moins", 0.035), 0.06); self.assertAlmostEqual(circuit.ev_threshold("résultat", -0.1), 0.04)
        ref = sharp.Reference("pinnacle", 101, dt.datetime(2026, 11, 7, 12, tzinfo=dt.timezone.utc), 0.03, 0.01, {101: 0.5, 102: 0.28, 103: 0.22}, {101: 0.5, 102: 0.28, 103: 0.22}, {101: 1.94, 102: 3.5, 103: 4.4})
        spec = mk.Spec("1x2", "fulltime", 0.0, "1")
        ok = circuit.assess(0.5, 2.12, "résultat", spec, ref, 101, 0.0)                    # EV = 0,5 × 2,12 − 1 = 6 % ≥ 4 %
        self.assertEqual(ok.blocks, []); self.assertAlmostEqual(ok.ev_min, 0.04)
        blocked = circuit.assess(0.5, 2.12, "résultat", spec, ref, 101, 0.0, ev_margin=0.03)   # seuil 7 % : refusé
        self.assertEqual(blocked.blocks, ["ev_insuffisant"]); self.assertAlmostEqual(blocked.ev_min, 0.07)

    def test_pool_weights_expose_margins_and_references_with_family_fallback(self):
        pw = sharp.PoolWeights({"BTTS / clean sheet": 0.2, "plus/moins|ENG": 0.1}, {"BTTS / clean sheet": 0.021}, {"BTTS / clean sheet": "winamax"})
        self.assertEqual((pw.weight("BTTS / clean sheet", "ESP"), pw.margin("BTTS / clean sheet", "ESP"), pw.reference("BTTS / clean sheet", "ESP")), (0.2, 0.021, "winamax"))
        self.assertEqual((pw.weight("plus/moins", "ENG"), pw.margin("plus/moins", "ENG"), pw.reference("plus/moins", "ENG")), (0.1, 0.0, "sharp"))
        self.assertEqual(sharp.PoolWeights().reference("x", "y"), "sharp")


class SuggestMatchTests(unittest.TestCase):
    """suggest_match avec l'archive : Winamax pour les cotes jouées, Pinnacle pour la référence."""

    def setUp(self):
        self.sims = sm.simulate(1.9, 0.8, 0.45)
        self.now = (KO - pd.Timedelta(hours=1)).to_pydatetime()
        self.quant = product.Quant(pd.DataFrame(columns=["match_id", "kickoff_utc", "home_team_id", "away_team_id", "ft_home", "ft_away"]), "2026-27",
                                   weights=sharp.PoolWeights(), xg_matches=pd.DataFrame(columns=["match_id", "kickoff_utc", "home_team_id", "away_team_id", "ft_home", "ft_away", "home_xg", "away_xg"]),
                                   deps=dependency.TeamDependencies([]))

    def archive(self, winamax_home=1.85, pinnacle_home=1.72, with_pinnacle=True):
        t = KO - pd.Timedelta(hours=2)
        rows = [snap("winamax.fr", 101, 101, winamax_home, t), snap("winamax.fr", 101, 102, 3.90, t), snap("winamax.fr", 101, 103, 5.00, t),
                snap("winamax.fr", 201, 211, 1.80, t), snap("winamax.fr", 201, 212, 1.95, t)]
        if with_pinnacle:
            rows += [snap("pinnacle", 101, 101, pinnacle_home, t, 3000), snap("pinnacle", 101, 102, 3.90, t, 3000), snap("pinnacle", 101, 103, 4.80, t, 3000),
                     snap("pinnacle", 201, 211, 1.92, t, 3000), snap("pinnacle", 201, 212, 1.96, t, 3000)]
        return frame(rows)

    def run_match(self, snaps):
        outcomes = product.outcomes_from_snapshots(snaps, CAT, pd.Timestamp(self.now), "Club A", "Club B")
        self.assertTrue(all(o["odds"] in (1.85, 2.05, 3.90, 5.00, 1.80, 1.95) for o in outcomes))        # jamais une cote Pinnacle jouée
        return product.suggest_match(self.sims, outcomes, KO.to_pydatetime(), self.now, "AAA", set(), {}, "Club A", "Club B", snaps=snaps, cat=CAT, quant=self.quant, team_ids=("tA", "tB"))

    def test_outcome_missing_from_the_latest_winamax_pull_is_withdrawn(self):
        snaps = self.archive()
        older = KO - pd.Timedelta(hours=3)                                            # une ligne vue au passage précédent seulement
        snaps = pd.concat([snaps, frame([snap("winamax.fr", 201, 211, 1.70, older)])], ignore_index=True)
        snaps.loc[(snaps["bookmaker"] == "winamax.fr") & (snaps["outcome_id"] == 211) & (snaps["created_at"] > older), "created_at"] = older   # dernier relevé de 211 = passage précédent
        outcomes = product.outcomes_from_snapshots(snaps, CAT, pd.Timestamp(self.now), "Club A", "Club B")
        flags = {o["outcome_id"]: o["withdrawn"] for o in outcomes}
        self.assertTrue(flags[211]); self.assertFalse(flags[101]); self.assertFalse(flags[212])
        res = product.suggest_match(self.sims, outcomes, KO.to_pydatetime(), self.now, "AAA", set(), {}, "Club A", "Club B", snaps=snaps, cat=CAT, quant=self.quant, team_ids=("tA", "tB"))
        self.assertEqual(res["excluded"].get("marche_retire"), 1)

    def test_only_validated_profiles_are_published(self):
        # Ancien moteur et Exploratoire retirés (décision du propriétaire) : ni publiés, ni journalisés, ni exportés
        for archive in (self.archive(winamax_home=1.80, pinnacle_home=1.80), self.archive()):
            res = self.run_match(archive)
            self.assertEqual(set(res["profiles"]), {"sur", "equilibre", "grosse_cote"})
        self.assertEqual(product.VALIDATED_PROFILES, ("sur", "equilibre", "grosse_cote"))
        self.assertFalse(hasattr(sg, "LEGACY_PROFILE") or hasattr(sg, "EXPLORE_PROFILE"))

    def test_early_block_measures_odds_taken_against_winamax_closing(self):
        j = pd.DataFrame({"odds": [2.0, 1.5, 1.8], "closing_odds": [1.8, 1.5, None]})
        out = product.early_block(j)
        self.assertEqual(out["closeBets"], 2); self.assertAlmostEqual(out["earlyEdge"], (2.0 / 1.8 - 1 + 0) / 2, places=4); self.assertEqual(out["oddsDroppedRate"], 0.5)
        self.assertEqual(product.early_block(pd.DataFrame({"odds": []}))["closeBets"], 0)

    def test_winamax_closing_is_recomputed_when_the_archive_is_completed(self):
        ko = pd.Timestamp("2026-11-03T19:45:00Z")
        now = ko + pd.Timedelta(hours=12)
        row = lambda sid, kick, closing: {"suggestion_id": sid, "fixture_id": "f1", "market_id": 101, "outcome_id": 101, "kickoff_utc": kick.isoformat(), "odds": 2.0, "closing_odds": closing}
        journal = pd.DataFrame([row("recent", ko, 2.0), row("old", ko - pd.Timedelta(days=30), 2.0), row("future", now + pd.Timedelta(days=1), None)])
        snap = lambda minutes, price: {"fixture_id": "f1", "bookmaker": "winamax.fr", "market_id": 101, "outcome_id": 101, "player_id": None,
                                       "created_at": ko + pd.Timedelta(minutes=minutes), "price": price}
        snaps = pd.DataFrame([snap(-150, 2.0), snap(-8, 1.85), snap(3, 1.2)])   # relevé d'avant-match tardif ; le relevé en direct est ignoré
        n = product.update_winamax_closing(journal, snaps, now)
        self.assertEqual(n, 1)
        self.assertEqual(journal["closing_odds"].tolist()[:2], [1.85, 2.0])       # hors fenêtre de recalcul : inchangée
        self.assertTrue(pd.isna(journal.iloc[2]["closing_odds"]))                 # match pas commencé

    def test_winamax_late_on_pinnacle_is_a_bet_with_sharp_probability(self):
        res = self.run_match(self.archive(winamax_home=2.05, pinnacle_home=1.72))      # Winamax paie 2,05 un favori que Pinnacle met à 1,72
        sug = res["profiles"]["equilibre"]["suggestions"]
        self.assertTrue(sug, res["excluded"])
        top = sug[0]
        self.assertEqual((top["label"], top["verdict"], top["sharpBookmaker"], top["poolW"]), ("Club A gagne", "bet", "pinnacle", 0.0))
        self.assertAlmostEqual(top["pRef"], top["pSharp"])                          # w = 0 : la probabilité de référence est celle du marché sharp
        self.assertAlmostEqual(top["evRef"], top["pRef"] * 2.05 - 1, places=3)
        self.assertGreater(top["evRef"], circuit.EV_MIN)
        self.assertEqual(top["stakeMode"], "shrink_kelly"); self.assertLessEqual(top["stakeFraction"], circuit.CAP_PER_BET)
        self.assertTrue(top["reasons"][0].startswith("Marché sharp (Pinnacle"))
        self.assertIsNone(res["profiles"]["equilibre"]["combo"])
        self.assertEqual(res["sharpCoverage"], 1.0)

    def test_fair_winamax_price_means_no_bet(self):
        res = self.run_match(self.archive(winamax_home=1.85, pinnacle_home=1.80))
        self.assertEqual(sum(len(b["suggestions"]) for b in res["profiles"].values()), 0)
        self.assertIn("ev_insuffisant", res["excluded"])
        self.assertIsNotNone(res["noBet"]); self.assertIn("espérance insuffisante", res["noBet"]["reasons"][0])

    def test_without_sharp_reference_nothing_is_bet(self):
        res = self.run_match(self.archive(winamax_home=2.05, with_pinnacle=False))
        self.assertEqual(sum(len(b["suggestions"]) for b in res["profiles"].values()), 0)
        self.assertEqual(set(res["excluded"]), {"reference_absente"})
        self.assertEqual(res["sharpCoverage"], 0.0)
        self.assertEqual(res["noBet"]["codes"], ["reference_absente"])


if __name__ == "__main__":
    unittest.main()
