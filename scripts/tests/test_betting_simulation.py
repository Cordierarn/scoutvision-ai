"""
Tests de la simulation de match et du règlement des marchés (scripts/betting/simulate.py, markets.py),
sans réseau ni données réelles.

  python3 -m unittest tests.test_betting_simulation -v        # ou : npm run test:data
"""

from __future__ import annotations

import unittest

import numpy as np

from betting import markets as mk
from betting import simulate as sm


def sims(xg_h=1.6, xg_a=1.1, p1=0.45, variant=sm.Variant(), n=20_000, seed=7):
    return sm.simulate(xg_h, xg_a, p1, variant, n=n, seed=seed)


class SimulationTests(unittest.TestCase):
    def test_fixed_seed_is_reproducible(self):
        a, b = sims(), sims()
        for f in ("ft_home", "ft_away", "ht_home", "ht_away", "first_goal", "last_goal"):
            np.testing.assert_array_equal(getattr(a, f), getattr(b, f))
        self.assertFalse(np.array_equal(sims(seed=8).ft_home, a.ft_home))

    def test_score_matrix_sums_to_one_for_each_variant(self):
        for v in (sm.Variant("poisson"), sm.Variant("dixon_coles", rho=-0.08), sm.Variant("negbin", dispersion=10.0)):
            m = sm.score_matrix(1.4, 1.2, v)
            self.assertAlmostEqual(m.sum(), 1.0, places=12)
            self.assertTrue((m >= 0).all())

    def test_dixon_coles_moves_low_scores_only(self):
        p, d = sm.score_matrix(1.4, 1.2), sm.score_matrix(1.4, 1.2, sm.Variant("dixon_coles", rho=-0.1))
        self.assertGreater(d[0, 0], p[0, 0])       # rho négatif (Dixon-Coles) : davantage de 0-0 et de 1-1, moins de 1-0 et 0-1
        self.assertGreater(d[1, 1], p[1, 1])
        self.assertLess(d[1, 0], p[1, 0])
        self.assertAlmostEqual(d[3, 2] / p[3, 2], d[2, 3] / p[2, 3], places=9)  # scores élevés : même facteur de renormalisation

    def test_halves_add_up_and_goal_order_is_consistent(self):
        s = sims()
        self.assertTrue((s.ht_home <= s.ft_home).all() and (s.ht_away <= s.ft_away).all())
        np.testing.assert_array_equal(s.sh_home + s.ht_home, s.ft_home)
        total = s.ft_home + s.ft_away
        self.assertTrue(((total == 0) == (s.first_goal == 0)).all())
        self.assertTrue(((total == 0) == (s.last_goal == 0)).all())
        only_home = (s.ft_away == 0) & (s.ft_home > 0)
        self.assertTrue((s.first_goal[only_home] == 1).all() and (s.last_goal[only_home] == 1).all())
        one_goal = total == 1
        np.testing.assert_array_equal(s.first_goal[one_goal], s.last_goal[one_goal])
        # premier but domicile avec probabilité n_h / N en moyenne
        share = np.mean(s.first_goal[total > 0] == 1)
        expected = np.mean((s.ft_home / np.maximum(total, 1))[total > 0])
        self.assertAlmostEqual(share, expected, delta=0.01)

    def test_simulation_matches_analytic_probabilities(self):
        s = sims()
        m = sm.score_matrix(1.6, 1.1)
        p_home_win = sum(m[i, j] for i in range(11) for j in range(11) if i > j)
        self.assertAlmostEqual(np.mean(s.ft_home > s.ft_away), p_home_win, delta=0.012)
        self.assertAlmostEqual(np.mean(s.ft_home + s.ft_away > 2.5), sum(m[i, j] for i in range(11) for j in range(11) if i + j >= 3), delta=0.012)

    def test_fit_variant_recovers_rho_on_simulated_scores(self):
        rng = np.random.default_rng(1)
        xg_h, xg_a = rng.uniform(0.8, 2.2, 3000), rng.uniform(0.6, 1.8, 3000)
        truth = sm.Variant("dixon_coles", rho=-0.08)
        ft_h, ft_a = np.empty(3000, int), np.empty(3000, int)
        for i in range(3000):
            m = sm.score_matrix(xg_h[i], xg_a[i], truth)
            k = rng.choice(m.size, p=m.ravel()); ft_h[i], ft_a[i] = divmod(int(k), 11)
        fitted = sm.fit_variant("dixon_coles", xg_h, xg_a, ft_h, ft_a)
        self.assertAlmostEqual(fitted.rho, -0.08, delta=0.06)


def spec(t, name, period="fulltime", hcp=0.0):
    return mk.Spec(t, period, hcp, name)


class MarketProbabilityTests(unittest.TestCase):
    def setUp(self):
        self.s = sims()

    def prob(self, t, name, period="fulltime", hcp=0.0):
        return mk.probability(spec(t, name, period, hcp), self.s)

    def test_complete_markets_sum_to_one(self):
        cases = [("1x2", ["1", "X", "2"]), ("firstgoal", ["1", "2", "No Goal"]), ("lastgoal", ["1", "2", "No Goal"]),
                 ("bothteamsscore", ["Yes", "No"]), ("cleansheet-team2", ["Yes", "No"]), ("wintonil-team1", ["Yes", "No"]),
                 ("toscoreinbh-team1", ["Yes", "No"]), ("winbothh-team2", ["Yes", "No"]), ("wineitherh-team1", ["Yes", "No"]),
                 ("halftime-fulltime", [f"{a}/{b}" for a in "1X2" for b in "1X2"]),
                 ("exactscore", ["0", "1", "2", "3", "4", "5", "6+"]), ("exactscore-team1", ["0", "1", "2", "3+"]),
                 ("winningmargin", ["Draw", "1 By 1", "1 By 2", "1 By 3+", "2 By 1", "2 By 2", "2 By 3+"])]
        for t, names in cases:
            total = sum(self.prob(t, n) for n in names)
            self.assertAlmostEqual(total, 1.0, places=9, msg=t)
            self.assertTrue(mk.is_complete([spec(t, n) for n in names]), t)
        for period in ("p1", "p2"):
            self.assertAlmostEqual(sum(self.prob("1x2", n, period) for n in "1X2"), 1.0, places=9)
            self.assertAlmostEqual(self.prob("totals", "Over", period, 1.5) + self.prob("totals", "Under", period, 1.5), 1.0, places=9)
        self.assertAlmostEqual(self.prob("spreads", "1", hcp=-0.5) + self.prob("spreads", "2", hcp=-0.5), 1.0, places=9)
        # score exact : 11 × 11 cases couvrent tout
        self.assertAlmostEqual(sum(self.prob("correctscore", f"{i}:{j}") for i in range(11) for j in range(11)), 1.0, places=9)

    def test_consistency_between_markets(self):
        over = self.prob("totals", "Over", hcp=2.5)
        cs = sum(self.prob("correctscore", f"{i}:{j}") for i in range(11) for j in range(11) if i + j >= 3)
        self.assertAlmostEqual(over, cs, places=9)
        btts = self.prob("bothteamsscore", "Yes")
        self.assertAlmostEqual(btts, sum(self.prob("correctscore", f"{i}:{j}") for i in range(1, 11) for j in range(1, 11)), places=9)
        self.assertAlmostEqual(self.prob("1x2", "1"), self.prob("doublechance", "1X") + self.prob("doublechance", "12") - 1 + self.prob("1x2", "2") + self.prob("1x2", "X") - self.prob("1x2", "X") - self.prob("1x2", "2"), places=9)
        self.assertAlmostEqual(self.prob("doublechance", "1X"), self.prob("1x2", "1") + self.prob("1x2", "X"), places=9)
        self.assertAlmostEqual(self.prob("cleansheet-team1", "Yes"), self.prob("teamtotals-team2", "Under", hcp=0.5), places=9)
        self.assertAlmostEqual(self.prob("spreads", "1", hcp=-0.5), self.prob("1x2", "1"), places=9)
        self.assertAlmostEqual(self.prob("spreads", "1", hcp=0.5), self.prob("doublechance", "1X"), places=9)
        # remboursé si nul = P(1) / (1 − P(X))
        p1, px = self.prob("1x2", "1"), self.prob("1x2", "X")
        self.assertAlmostEqual(self.prob("drawnobet", "1"), p1 / (1 - px), places=9)
        # handicap entier 0 : identique à remboursé si nul
        self.assertAlmostEqual(self.prob("spreads", "1", hcp=0.0), self.prob("drawnobet", "1"), places=9)

    def test_expected_return_matches_probability_on_simple_market(self):
        p = self.prob("1x2", "1")
        self.assertAlmostEqual(mk.expected_return(spec("1x2", "1"), self.s, 2.0), 2.0 * p - 1, places=9)

    def test_devig_sums_to_one(self):
        q = mk.devig_proportional(np.array([1 / 2.1, 1 / 3.4, 1 / 3.6]))
        self.assertAlmostEqual(q.sum(), 1.0, places=12)
        self.assertLess(q[0], 1 / 2.1)


class SettlementTests(unittest.TestCase):
    R = mk.Result(ft_home=2, ft_away=1, ht_home=0, ht_away=1, first_goal="away", last_goal="home")

    def st(self, t, name, period="fulltime", hcp=0.0, result=None):
        return mk.settle(spec(t, name, period, hcp), result or self.R)

    def test_result_family(self):
        self.assertEqual(self.st("1x2", "1"), 1.0); self.assertEqual(self.st("1x2", "X"), 0.0)
        self.assertEqual(self.st("1x2", "2", "p1"), 1.0)                # 0-1 à la mi-temps
        self.assertEqual(self.st("1x2", "1", "p2"), 1.0)                # 2-0 en seconde période
        self.assertEqual(self.st("doublechance", "X2"), 0.0); self.assertEqual(self.st("doublechance", "12"), 1.0)
        self.assertEqual(self.st("drawnobet", "2"), 0.0)
        draw = mk.Result(1, 1, 0, 0, "home", "away")
        self.assertIsNone(self.st("drawnobet", "1", result=draw))
        self.assertEqual(self.st("halftime-fulltime", "2/1"), 1.0); self.assertEqual(self.st("halftime-fulltime", "1/1"), 0.0)

    def test_totals_whole_half_quarter(self):
        self.assertEqual(self.st("totals", "Over", hcp=2.5), 1.0)
        self.assertEqual(self.st("totals", "Under", hcp=2.5), 0.0)
        self.assertIsNone(self.st("totals", "Over", hcp=3.0))           # 3 buts, ligne entière : remboursé
        self.assertEqual(self.st("totals", "Over", hcp=2.75), 0.5)      # moitié gagnée (2.5), moitié remboursée (3.0)
        self.assertEqual(self.st("totals", "Under", hcp=2.75), -0.5)    # moitié perdue, moitié remboursée
        self.assertEqual(self.st("totals", "Over", hcp=3.25), -0.5)
        self.assertEqual(self.st("totals", "Under", hcp=3.25), 0.5)
        self.assertEqual(self.st("totals", "Over", hcp=2.25), 1.0)
        self.assertEqual(self.st("teamtotals-team2", "Under", hcp=1.5), 1.0)
        self.assertIsNone(self.st("teamtotals-team1", "Over", hcp=2.0))

    def test_asian_handicap(self):
        # domicile gagne 2-1 : marge +1
        self.assertEqual(self.st("spreads", "1", hcp=-0.5), 1.0)
        self.assertIsNone(self.st("spreads", "1", hcp=-1.0))            # ligne entière, égalité après handicap
        self.assertEqual(self.st("spreads", "1", hcp=-1.5), 0.0)
        self.assertEqual(self.st("spreads", "1", hcp=-0.75), 0.5)      # -0.5 gagné, -1.0 remboursé
        self.assertEqual(self.st("spreads", "1", hcp=-1.25), -0.5)     # -1.0 remboursé, -1.5 perdu
        self.assertEqual(self.st("spreads", "2", hcp=-0.75), -0.5)
        self.assertEqual(self.st("spreads", "2", hcp=-1.25), 0.5)
        self.assertEqual(self.st("spreads", "2", hcp=1.5), 0.0)        # +1.5 à l'équipe 1 : 3.5 contre 1, « 2 » perd
        self.assertEqual(self.st("spreads", "1", hcp=1.5), 1.0)
        self.assertEqual(self.st("spreads", "2", hcp=-1.5), 1.0)       # -1.5 à l'équipe 1 : 0.5 contre 1, « 2 » gagne
        self.assertEqual(self.st("spreads", "2", hcp=-1.0), None)

    def test_other_families(self):
        self.assertEqual(self.st("correctscore", "2:1"), 1.0); self.assertEqual(self.st("correctscore", "1:2"), 0.0)
        self.assertEqual(self.st("correctscore", "0:1", "p1"), 1.0)
        self.assertEqual(self.st("exactscore", "3"), 1.0); self.assertEqual(self.st("exactscore", "4+"), 0.0); self.assertEqual(self.st("exactscore", "3+"), 1.0)
        self.assertEqual(self.st("exactscore-team1", "2"), 1.0)
        self.assertEqual(self.st("bothteamsscore", "Yes"), 1.0); self.assertEqual(self.st("cleansheet-team1", "Yes"), 0.0)
        self.assertEqual(self.st("wintonil-team1", "No"), 1.0)
        self.assertEqual(self.st("toscoreinbh-team1", "Yes"), 0.0)    # 0 but en première mi-temps
        self.assertEqual(self.st("winbothh-team1", "Yes"), 0.0); self.assertEqual(self.st("wineitherh-team1", "Yes"), 1.0)
        self.assertEqual(self.st("winningmargin", "1 By 1"), 1.0); self.assertEqual(self.st("winningmargin", "1 By 2+"), 0.0); self.assertEqual(self.st("winningmargin", "Draw"), 0.0)
        self.assertEqual(self.st("firstgoal", "2"), 1.0); self.assertEqual(self.st("lastgoal", "1"), 1.0)
        none = mk.Result(0, 0, 0, 0)
        self.assertEqual(self.st("firstgoal", "No Goal", result=none), 1.0)

    def test_realised_return(self):
        self.assertAlmostEqual(mk.realised_return(1.0, 2.5), 1.5)
        self.assertAlmostEqual(mk.realised_return(0.5, 2.5), 0.75)
        self.assertAlmostEqual(mk.realised_return(-0.5, 2.5), -0.5)
        self.assertAlmostEqual(mk.realised_return(0.0, 2.5), -1.0)
        self.assertAlmostEqual(mk.realised_return(None, 2.5), 0.0)

    def test_incomplete_markets_are_flagged(self):
        self.assertFalse(mk.is_complete([spec("totals", "Over", hcp=2.0), spec("totals", "Under", hcp=2.0)]))
        self.assertFalse(mk.is_complete([spec("doublechance", n) for n in ("1X", "12", "X2")]))
        self.assertFalse(mk.is_complete([spec("correctscore", "1:0"), spec("correctscore", "0:0")]))
        self.assertFalse(mk.is_complete([spec("exactscore", n) for n in ("0", "1", "3+")]))


if __name__ == "__main__":
    unittest.main()


class ComPoissonTests(unittest.TestCase):
    def test_com_poisson_keeps_the_mean_and_reduces_the_variance_when_nu_exceeds_one(self):
        k = np.arange(sm.MAX_GOALS + 1)
        for mu in (0.6, 1.4, 2.3):
            p1 = sm.com_poisson_pmf(mu, 1.0); p2 = sm.com_poisson_pmf(mu, 1.2)
            np.testing.assert_allclose(p1, sm._marginal(mu, sm.Variant(), sm.MAX_GOALS), atol=1e-6)        # nu = 1 : Poisson
            self.assertAlmostEqual(float((p2 * k).sum()), mu, places=3)
            var1 = float((p1 * k ** 2).sum() - mu ** 2); var2 = float((p2 * k ** 2).sum() - mu ** 2)
            self.assertLess(var2, var1); self.assertLess(var2, mu)

    def test_total_shrink_keeps_the_supremacy_and_moves_the_total_toward_the_mean(self):
        v = sm.Variant("compoisson", shrink=0.8, mean_total=2.7)
        h, a = v.expected(2.4, 0.6)                                     # total 3,0 → 2,7 + 0,8 × 0,3 = 2,94 ; différence 1,8 conservée
        self.assertAlmostEqual(h + a, 2.94); self.assertAlmostEqual(h - a, 1.8)
        self.assertEqual(sm.Variant("compoisson", shrink=1.0, mean_total=2.7).expected(2.4, 0.6), (2.4, 0.6))
        self.assertEqual(sm.Variant("compoisson", shrink=0.8).expected(2.4, 0.6), (2.4, 0.6))               # sans référence : rien
        m = sm.score_matrix(2.4, 0.6, v)
        self.assertAlmostEqual(float(m.sum()), 1.0)
        idx = np.add.outer(np.arange(sm.MAX_GOALS + 1), np.arange(sm.MAX_GOALS + 1))
        self.assertLess(float(m[idx > 2.5].sum()), float(sm.score_matrix(2.4, 0.6)[idx > 2.5].sum()))   # total rétréci : moins de plus de 2,5

    def test_dixon_coles_applies_whenever_rho_is_set(self):
        plain = sm.score_matrix(1.4, 1.2, sm.Variant("compoisson", nu=1.1))
        dc = sm.score_matrix(1.4, 1.2, sm.Variant("compoisson", nu=1.1, rho=-0.05))
        self.assertGreater(dc[0, 0], plain[0, 0]); self.assertLess(dc[1, 0], plain[1, 0])        # rho < 0 : plus de 0-0, moins de 1-0

    def test_fit_compoisson_finds_underdispersion_and_shrink_on_synthetic_scores(self):
        rng = np.random.default_rng(3)
        n = 2500
        xg_h = rng.uniform(0.8, 2.2, n); xg_a = rng.uniform(0.6, 1.8, n)
        truth = sm.Variant("compoisson", nu=1.2, shrink=0.8, mean_total=float((xg_h + xg_a).mean()), rho=-0.03)
        ft_h, ft_a = np.empty(n, int), np.empty(n, int)
        for i in range(n):
            m = sm.score_matrix(xg_h[i], xg_a[i], truth)
            flat = rng.choice(m.size, p=m.ravel()); ft_h[i], ft_a[i] = divmod(int(flat), sm.MAX_GOALS + 1)
        fitted = sm.fit_variant("compoisson", xg_h, xg_a, ft_h, ft_a)
        self.assertGreaterEqual(fitted.nu, 1.1); self.assertLessEqual(fitted.nu, 1.3)
        self.assertGreaterEqual(fitted.shrink, 0.7); self.assertLessEqual(fitted.shrink, 0.9)
        self.assertAlmostEqual(fitted.mean_total, truth.mean_total, places=6)
