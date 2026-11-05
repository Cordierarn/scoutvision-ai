"""
Tests de la porte de validation par segment (scripts/betting/gate.py), sur des données synthétiques : un
modèle qui n'apporte rien face à la clôture obtient w = 0 ; un modèle qui connaît la vraie probabilité
alors que la clôture est bruitée obtient un poids strictement positif et un gain hors échantillon
significatif ; un segment trop court n'est pas jugé ; seuls les segments validés sont écrits.

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


class PoolTests(unittest.TestCase):
    def test_pool_matrix_is_a_normalised_log_pool_with_the_sharp_side_at_w0(self):
        pm = np.array([[0.5, 0.3, 0.2]]); ps = np.array([[0.4, 0.3, 0.3]])
        np.testing.assert_allclose(gate.pool_matrix(pm, ps, 0.0), ps)
        np.testing.assert_allclose(gate.pool_matrix(pm, ps, 1.0), pm)
        half = gate.pool_matrix(pm, ps, 0.5)
        self.assertAlmostEqual(float(half.sum()), 1.0)
        self.assertTrue(ps[0, 0] < half[0, 0] < pm[0, 0])

    def test_fit_weight_prefers_the_exact_model_and_rejects_noise(self):
        d = synthetic(300, "exact")
        pm, ps, y = gate.segment_arrays(d, "1x2")
        w, scores = gate.fit_weight(pm, ps, y)
        self.assertGreaterEqual(w, 0.5); self.assertEqual(set(scores), set(gate.WEIGHT_GRID))
        d = synthetic(300, "noise", sharp_noise=0.05)                                   # clôture précise, modèle faux : presque rien
        pm, ps, y = gate.segment_arrays(d, "1x2")
        self.assertLessEqual(gate.fit_weight(pm, ps, y)[0], 0.05)

    def test_evaluate_is_zero_at_w0_and_bootstraps_an_interval(self):
        d = synthetic(200, "exact")
        pm, ps, y = gate.segment_arrays(d, "ou25")
        zero = gate.evaluate(pm, ps, y, 0.0, n_boot=200)
        self.assertEqual((zero["gain"], zero["gainLow"], zero["gainHigh"]), (0.0, 0.0, 0.0))
        good = gate.evaluate(pm, ps, y, 0.5, n_boot=200)
        self.assertEqual(good["matches"], len(y)); self.assertLessEqual(good["gainLow"], good["gain"]); self.assertLessEqual(good["gain"], good["gainHigh"])
        self.assertAlmostEqual(good["gain"], good["logLossSharp"] - good["logLossPool"], places=4)


class GateTests(unittest.TestCase):
    def test_noise_model_validates_nothing_and_short_segments_are_not_judged(self):
        d = synthetic(250, "noise", sharp_noise=0.05)
        report = gate.run_gate(d, min_matches=150)
        self.assertEqual(report["weights"], {})
        self.assertTrue(all(s["verdict"] in ("poids_nul", "gain_non_significatif") for s in report["segments"]))
        short = gate.run_gate(synthetic(60, "exact"), min_matches=150)
        self.assertTrue(all(s["verdict"] == "trop_peu_de_matchs" and s["weight"] == 0.0 for s in short["segments"]))
        self.assertEqual(short["weights"], {})

    def test_exact_model_is_validated_per_competition_and_only_those_segments_are_written(self):
        report = gate.run_gate(synthetic(500, "exact"), min_matches=150)
        valid = [s for s in report["segments"] if s["verdict"] == "valide"]
        self.assertTrue(valid)
        for s in valid:
            self.assertGreater(s["weight"], 0.0); self.assertGreater(s["test"]["gainLow"], 0.0)
        self.assertIn("résultat|AAA", report["weights"])
        self.assertNotIn("résultat|toutes", report["weights"])                       # la famille entière n'est pas un segment du produit
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "pool_weights.json"
            gate.write_weights(report, path)
            raw = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(raw["weights"], report["weights"])
            pw = sharp.PoolWeights.load(path)
            self.assertEqual(pw.weight("résultat", "AAA"), report["weights"]["résultat|AAA"])
            self.assertEqual(pw.weight("résultat", "ZZZ"), 0.0)
        lines = gate.summary_lines(report)
        self.assertTrue(lines[0].startswith("Porte de validation")); self.assertIn("Segments validés", lines[-1])


if __name__ == "__main__":
    unittest.main()
