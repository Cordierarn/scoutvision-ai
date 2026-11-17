"""
Pronostics exportés dans forecast.json (scripts/prepare_data.py) : un logo d'équipe absent du référentiel vaut null,
jamais NaN. Avec pandas 3, une chaîne absente d'un Parquet est lue en NaN (type « str ») ; write_json refuse alors tout
le fichier (allow_nan=False) et la mise à jour des données échoue.

  python3 -m unittest tests.test_prepare_forecast -v        # ou : npm run test:data
"""

from __future__ import annotations

import io
import json
import tarfile
import tempfile
import unittest
from pathlib import Path

import pandas as pd

import prepare_data as pdata


def teams_ref_from_archive(tmp: str) -> pd.DataFrame:
    """Référentiel des équipes relu comme en production : partition Parquet d'une archive tar, via read_tables."""
    ref = pd.DataFrame({"id": ["t_a", "t_b"], "name": ["Club A", "Club B"], "image_url": ["https://example.test/a.png", None]})
    buf = io.BytesIO()
    ref.to_parquet(buf, index=False)
    data = buf.getvalue()
    path = Path(tmp) / "global.tar"
    with tarfile.open(path, "w") as tar:
        info = tarfile.TarInfo("team/part-0.parquet")
        info.size = len(data)
        tar.addfile(info, io.BytesIO(data))
    return pdata.read_tables(path, {"team"})["team"]


class ForecastLogoTests(unittest.TestCase):
    def test_a_team_without_logo_gets_null_in_matches_and_tables(self):
        with tempfile.TemporaryDirectory() as tmp:
            teams_ref = teams_ref_from_archive(tmp)
            upcoming = pd.DataFrame({
                "league_key": ["AAA"], "date": ["2026-11-21"], "match_id": ["m_1"], "home": ["Club A"], "away": ["Club B"],
                "home_id": ["t_a"], "away_id": ["t_b"], "p_home": [0.5], "p_draw": [0.3], "p_away": [0.2],
                "xg_home_attendu": [1.4], "xg_away_attendu": [0.9]})
            table = pd.DataFrame({
                "league_key": ["AAA", "AAA"], "rang": [1, 2], "team": ["Club A", "Club B"], "team_id": ["t_a", "t_b"],
                "joues": [10, 10], "points": [20, 12], "diff": [8, -3], "restants": [28, 28],
                "points_attendus": [40.2, 33.1], "points_projetes": [60.2, 45.1]})

            forecast = pdata.build_forecast(upcoming, teams_ref)
            forecast["tables"] = pdata.build_tables(table, teams_ref)

            match = forecast["matches"][0]
            self.assertEqual(match["homeLogo"], "https://example.test/a.png")
            self.assertIsNone(match["awayLogo"])
            self.assertEqual([r["logo"] for r in forecast["tables"]["AAA"]], ["https://example.test/a.png", None])
            pdata.write_json(Path(tmp) / "forecast.json", forecast)        # allow_nan=False : aucun NaN ne passe
            self.assertIsNone(json.loads((Path(tmp) / "forecast.json").read_text(encoding="utf-8"))["matches"][0]["awayLogo"])


if __name__ == "__main__":
    unittest.main()
