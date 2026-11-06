"""
Lecture des valeurs Transfermarkt (scripts/prepare_data.py) : une valeur implausible, sous 10 k€,
vient d'une unité mal lue par market-values et ne doit entrer ni dans l'app ni dans le modèle.

  python3 -m unittest tests.test_prepare_market -v        # ou : npm run test:data
"""

from __future__ import annotations

import unittest

import numpy as np
import pandas as pd

import prepare_data as pdata


class SanitizeMarketTests(unittest.TestCase):
    def test_values_below_ten_thousand_become_unknown(self):
        m = pd.DataFrame({"player_id": ["a", "b", "c", "d", "e"], "league_key": ["X"] * 5,
                          "market_value_eur": [150.0, 1.2, 10_000.0, 750_000.0, np.nan]})
        out, bad = pdata.sanitize_market(m)
        self.assertEqual(bad.tolist(), [True, True, False, False, False])
        self.assertTrue(out["market_value_eur"].iloc[:2].isna().all())
        self.assertEqual(out["market_value_eur"].iloc[2:4].tolist(), [10_000.0, 750_000.0])
        self.assertTrue(np.isnan(out["market_value_eur"].iloc[4]))
        self.assertEqual(m["market_value_eur"].iloc[0], 150.0)          # l'entrée n'est pas modifiée


if __name__ == "__main__":
    unittest.main()
