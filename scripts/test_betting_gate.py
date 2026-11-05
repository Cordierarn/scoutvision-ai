"""
Tests de la porte de validation universelle (scripts/betting/gate.py), sur des données synthétiques : catégorie A
(modèle exact validé, modèle faux jamais, segment court non jugé), catégorie B (référence Winamax dé-viguée,
porte de calibration par bande qui bloque un modèle biaisé vers le côté « bas », ECE), catégorie C (fréquence de
base), assemblage des poids / marges / références écrits pour le produit.

  python3 -m unittest test_betting_gate -v        # ou : npm run test:data
"""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

from betting import gate, sharp


def synthetic(n_per_season: int, model: str, seed: int = 3, competitions=("AAA", "BBB"), sharp_noise: float = 0.25) -> pd.DataFrame:
    """Matchs tirés d'une vraie probabilité ; clôture = vérité bruitée ; modèle = vérité (`exact`) ou vérité permutée (`noise`)."""
    rng = np.random.default_rng(seed)
    rows = []
    for season in ("2024-25", "2025-26"):
        for comp in competitions:
            for _ in range(n_per_season):
                home = rng.uniform(0.25, 0.6); draw = rng.uniform(0.18, 0.3); away = max(0.05, 1 - home - draw)
                truth = np.array([home, draw, away]) / (home + draw + away)
                over = rng.uniform(0.35, 0.65)
                outcome = rng.choice(3, p=truth)
                total_over = rng.random() < over
                def noisy(p, scale):
                    q = np.clip(np.asarray(p) * np.exp(rng.normal(0, scale, len(p))), 0.02, 0.98)
                    return q / q.sum()
                s3 = noisy(truth, sharp_noise); s2 = noisy([over, 1 - over], sharp_noise)
                if model == "exact":
                    m3, m2 = truth, np.array([over, 1 - over])
                else:                                           # modèle faux : la vérité permutée, bruitée
                    m3 = noisy(truth[[2, 0, 1]], 0.3); m2 = noisy([1 - over, over], 0.3)
                hg, ag = [(2, 0), (1, 1), (0, 2)][outcome]
                if total_over:
                    hg, ag = hg + 1, ag + 1
                rows.append({"match_id": f"{season}-{comp}-{len(rows)}", "competition": comp, "season": season, "home_goals": hg, "away_goals": ag,
                             "m_home": m3[0], "m_draw": m3[1], "m_away": m3[2], "s_home": s3[0], "s_draw": s3[1], "s_away": s3[2],
                             "m_over": m2[0], "m_under": m2[1], "s_over": s2[0], "s_under": s2[1]})
    return pd.DataFrame(rows)


def rows_b(n: int, model: str, seed: int = 5, family: str = "BTTS / clean sheet", margin: float = 0.06, wx_noise: float = 0.2) -> pd.DataFrame:
    """Lignes de catégorie B : vérité p, Winamax = vérité bruitée avec marge, modèle exact, bruit ou biaisé vers le bas
    (probabilité du côté haut sous-estimée : le modèle « voit » de la valeur sur le côté bas)."""
    rng = np.random.default_rng(seed)
    out = []
    for i in range(n):
        p = rng.uniform(0.3, 0.7)
        wx = float(np.clip(p * np.exp(rng.normal(0, wx_noise)), 0.05, 0.95))
        if model == "exact":
            pm = p
        elif model == "bas":
            pm = float(np.clip(p - 0.12, 0.02, 0.98))
        else:
            pm = float(np.clip(rng.uniform(0.3, 0.7), 0.02, 0.98))
        q_high, q_low = wx * (1 + margin), (1 - wx) * (1 + margin)
        out.append({"match_id": f"m{i}", "competition": "AAA" if i % 2 else "BBB", "kickoff": pd.Timestamp("2026-08-01", tz="UTC") + pd.Timedelta(hours=i),
                    "family": family, "market_type": "bothteamsscore", "handicap": 0.0, "p_model": pm, "p_wx": wx, "odds_high": 1 / q_high, "odds_low": 1 / q_low,
                    "overround": margin, "y": float(rng.random() < p)})
    return pd.DataFrame(out)


class PoolTests(unittest.TestCase):
    def test_pool_matrix_is_a_normalised_log_pool_with_the_sharp_side_at_w0(self):
        pm = np.array([[0.5, 0.3, 0.2]]); ps = np.array([[0.4, 0.3, 0.3]])
        np.testing.assert_allclose(gate.pool_matrix(pm, ps, 0.0), ps)
        np.testing.assert_allclose(gate.pool_matrix(pm, ps, 1.0), pm)
        half = gate.pool_matrix(pm, ps, 0.5)
        self.assertAlmostEqual(float(half.sum()), 1.0)
        self.assertTrue(ps[0, 0] < half[0, 0] < pm[0, 0])

    def test_fit_weight_prefers_the_exact_model_and_rejects_noise(self):
        pm, ps, y = gate.segment_arrays(synthetic(300, "exact"), "1x2")
        w, scores = gate.fit_weight(pm, ps, y)
        self.assertGreaterEqual(w, 0.5); self.assertEqual(set(scores), set(gate.WEIGHT_GRID))
        pm, ps, y = gate.segment_arrays(synthetic(300, "noise", sharp_noise=0.05), "1x2")
        self.assertLessEqual(gate.fit_weight(pm, ps, y)[0], 0.05)

    def test_evaluate_is_zero_at_w0_and_bootstraps_an_interval(self):
        pm, ps, y = gate.segment_arrays(synthetic(200, "exact"), "ou25")
        zero = gate.evaluate(pm, ps, y, 0.0, n_boot=200)
        self.assertEqual((zero["gain"], zero["gainLow"], zero["gainHigh"]), (0.0, 0.0, 0.0))
        good = gate.evaluate(pm, ps, y, 0.5, n_boot=200)
        self.assertEqual(good["matches"], len(y)); self.assertLessEqual(good["gainLow"], good["gain"]); self.assertLessEqual(good["gain"], good["gainHigh"])
        self.assertAlmostEqual(good["gain"], good["logLossSharp"] - good["logLossPool"], places=4)

    def test_expected_calibration_error_is_zero_for_perfect_frequencies_and_grows_with_bias(self):
        p = np.repeat([0.25, 0.75], 400)
        y = np.concatenate([np.tile([1, 0, 0, 0], 100), np.tile([1, 1, 1, 0], 100)])
        self.assertAlmostEqual(gate.expected_calibration_error(p, y), 0.0, places=6)
        self.assertAlmostEqual(gate.expected_calibration_error(p + 0.1, y), 0.1, places=6)
        self.assertEqual(gate.expected_calibration_error(np.array([]), np.array([])), 0.0)


class CategoryATests(unittest.TestCase):
    def test_noise_model_validates_nothing_and_short_segments_are_not_judged(self):
        report = gate.run_gate(synthetic(250, "noise", sharp_noise=0.05), min_matches=150)
        self.assertTrue(all(s["verdict"] in ("poids_nul", "gain_non_significatif") for s in report["segments"]))
        self.assertTrue(all(s["category"] == "A" and s["reference"] == "sharp" for s in report["segments"]))
        short = gate.run_gate(synthetic(60, "exact"), min_matches=150)
        self.assertTrue(all(s["verdict"] == "trop_peu_de_matchs" and s["weight"] == 0.0 for s in short["segments"]))

    def test_exact_model_is_validated_per_competition_with_an_ece(self):
        report = gate.run_gate(synthetic(500, "exact"), min_matches=150)
        valid = [s for s in report["segments"] if s["verdict"] == "valide"]
        self.assertTrue(valid)
        for s in valid:
            self.assertGreater(s["weight"], 0.0); self.assertGreater(s["test"]["gainLow"], 0.0); self.assertGreaterEqual(s["ece"], 0.0)
        self.assertIn("résultat", {s["family"] for s in valid if s["competition"] == "AAA"})


class CategoryBTests(unittest.TestCase):
    def test_exact_model_against_noisy_winamax_is_validated_and_biased_model_fails_the_band_gate(self):
        pick = lambda rep: next(s for s in rep["segments"] if s["competition"] == "toutes" and s["family"] == "BTTS / clean sheet")
        seg = pick(gate.run_gate_b(rows_b(1500, "exact", wx_noise=0.3), min_matches=150))
        self.assertEqual(seg["verdict"], "valide", seg)
        self.assertGreater(seg["weight"], 0.0); self.assertEqual(seg["reference"], "winamax"); self.assertGreater(seg["test"]["gainLow"], 0.0)
        self.assertIn("haut", seg["band"]["sides"]); self.assertTrue(seg["band"]["passed"]); self.assertLess(seg["ece"], seg["eceModelAlone"] + 0.05)
        biased = pick(gate.run_gate_b(rows_b(1500, "bas", wx_noise=0.3), min_matches=150))
        self.assertLess(biased["weight"], seg["weight"])                                        # un modèle biaisé pèse moins dans le pool
        self.assertEqual(biased["bandModelAlone"]["sides"]["haut"]["selections"], 0)            # seul, il ne « voit » jamais de valeur côté haut
        self.assertGreater(biased["bandModelAlone"]["sides"]["bas"]["selections"], 100)
        self.assertIn(biased["verdict"], ("valide", "biais_directionnel", "poids_nul", "gain_non_significatif"))

    def test_noise_model_gets_no_weight_and_short_segments_are_not_judged(self):
        rep = gate.run_gate_b(rows_b(700, "noise", wx_noise=0.05), min_matches=150)
        seg = next(s for s in rep["segments"] if s["competition"] == "toutes" and s["family"] == "BTTS / clean sheet")
        self.assertIn(seg["verdict"], ("poids_nul", "gain_non_significatif"))
        self.assertLessEqual(seg["weight"], 0.1)
        self.assertTrue(all(s["verdict"] == "trop_peu_de_matchs" for s in gate.run_gate_b(rows_b(100, "exact"), min_matches=150)["segments"] if s["family"] == "BTTS / clean sheet"))
        self.assertEqual(gate.run_gate_b(pd.DataFrame())["segments"], [])

    def test_split_is_chronological_and_band_gate_counts_selections_per_side(self):
        rows = rows_b(100, "exact")
        fit, test = gate.split_chronological(rows, 0.6)
        self.assertEqual((len(fit), len(test)), (60, 40)); self.assertLess(fit["kickoff"].max(), test["kickoff"].min())
        p = np.array([0.7, 0.3, 0.5]); y = np.array([1.0, 0.0, 1.0])
        band = gate.band_gate(p, y, odds_high=np.array([1.6, 2.0, 1.5]), odds_low=np.array([2.6, 1.6, 3.0]), family="BTTS / clean sheet")
        self.assertEqual((band["sides"]["haut"]["selections"], band["sides"]["bas"]["selections"]), (1, 2))     # haut : 0,7 × 1,6 − 1 = 12 % ; bas : 0,7 × 1,6 et 0,5 × 3,0
        self.assertFalse(band["judged"]); self.assertTrue(band["passed"])
        # côté bas surestimé de 15 points sur 200 sélections : biais significativement négatif → porte fermée
        rng = np.random.default_rng(2)
        p_true = rng.uniform(0.3, 0.6, 200); y = (rng.random(200) < p_true).astype(float)
        p_pool = p_true - 0.15                                                                   # côté haut sous-estimé = côté bas surestimé
        band = gate.band_gate(p_pool, y, odds_high=np.full(200, 1.2), odds_low=np.full(200, 2.2), family="BTTS / clean sheet")
        self.assertTrue(band["judged"]); self.assertFalse(band["passed"]); self.assertEqual(band["sides"]["bas"]["verdict"], "surestime")
        self.assertLess(band["sides"]["bas"]["biasHigh"], 0)


class CategoryCTests(unittest.TestCase):
    def test_model_grid_probabilities_and_outcome_indices_are_consistent(self):
        m = np.zeros((11, 11)); m[2, 1] = 0.6; m[0, 0] = 0.4
        self.assertAlmostEqual(gate.c_model_probs(m, "score exact")[gate.c_outcome("score exact", 2, 1)], 0.6)
        self.assertAlmostEqual(gate.c_model_probs(m, "marge de victoire")[gate.c_outcome("marge de victoire", 2, 1)], 0.6)
        self.assertAlmostEqual(gate.c_model_probs(m, "nombre de buts")[gate.c_outcome("nombre de buts", 0, 0)], 0.4)
        self.assertEqual(gate.c_outcome("score exact", 9, 9), gate.c_outcome("score exact", 5, 5)); self.assertEqual(gate.c_outcome("nombre de buts", 12, 0), gate.TOTAL_CAP)

    def test_exact_model_beats_the_base_rate_and_a_flat_model_does_not(self):
        rng = np.random.default_rng(9)
        n = 400; k = gate.TOTAL_CAP + 1
        truth = rng.dirichlet(np.ones(k) * 2, size=2 * n)
        y = np.array([rng.choice(k, p=t) for t in truth])
        season = np.array(["2024-25"] * n + ["2025-26"] * n); comp = np.array(["AAA"] * (2 * n))
        exact = {"nombre de buts": {"pm": truth, "y": y, "competition": comp, "season": season}}
        rep = gate.run_gate_c(exact, min_matches=150)
        seg = next(s for s in rep["segments"] if s["competition"] == "toutes")
        self.assertEqual(seg["verdict"], "valide"); self.assertGreater(seg["weight"], 0.5); self.assertEqual(seg["reference"], "base_rate")
        flat = {"nombre de buts": {"pm": np.tile(gate.base_rate(y[:n], k), (2 * n, 1)), "y": y, "competition": comp, "season": season}}
        seg = next(s for s in gate.run_gate_c(flat, min_matches=150)["segments"] if s["competition"] == "toutes")
        self.assertEqual(seg["verdict"], "poids_nul")


class AssembleTests(unittest.TestCase):
    def test_only_validated_segments_are_written_with_margin_and_reference_and_loaded_by_pool_weights(self):
        a = gate.run_gate(synthetic(500, "exact"), min_matches=150)
        b = gate.run_gate_b(rows_b(1500, "exact", wx_noise=0.3), min_matches=150)
        c = gate.run_gate_c({"nombre de buts": {"pm": np.full((400, 8), 1 / 8), "y": np.zeros(400, int), "competition": np.array(["AAA"] * 400), "season": np.array(["2024-25"] * 200 + ["2025-26"] * 200)}}, min_matches=150)
        report = gate.assemble(a, b, c)
        self.assertIn("résultat|AAA", report["weights"]); self.assertNotIn("résultat|toutes", report["weights"]); self.assertNotIn("résultat", report["weights"])
        self.assertIn("BTTS / clean sheet", report["weights"])                                  # ligne « toutes » de B : clé famille seule
        self.assertEqual(report["references"]["BTTS / clean sheet"], "winamax"); self.assertEqual(report["references"]["résultat|AAA"], "sharp")
        self.assertTrue(all(k in report["margins"] for k in report["weights"]))
        self.assertFalse(any(k.startswith("nombre de buts") for k in report["weights"]))        # C : jamais dans le produit
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "pool_weights.json"
            gate.write_weights(report, path)
            raw = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(set(raw), {"generatedAt", "weights", "margins", "references"})
            pw = sharp.PoolWeights.load(path)
            self.assertEqual(pw.weight("BTTS / clean sheet", "ZZZ"), report["weights"]["BTTS / clean sheet"])
            self.assertEqual(pw.margin("BTTS / clean sheet", "ZZZ"), report["margins"]["BTTS / clean sheet"])
            self.assertEqual(pw.reference("BTTS / clean sheet", "ZZZ"), "winamax"); self.assertEqual(pw.reference("plus/moins", "ENG"), "sharp")
            self.assertEqual(pw.weight("résultat", "ZZZ"), 0.0)
        lines = gate.summary_lines(report)
        self.assertTrue(lines[0].startswith("Catégorie A")); self.assertIn("Segments validés", lines[-1])


if __name__ == "__main__":
    unittest.main()
