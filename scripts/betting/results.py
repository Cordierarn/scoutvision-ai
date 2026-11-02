"""
Résultats détaillés des matchs (cache PitchAPI) pour le règlement des marchés et la calibration :
score final, score à la mi-temps, équipe du premier et du dernier but, buts par mi-temps.

Construit `.research/betting/results.parquet` pour les compétitions du Labo, toutes saisons du cache.
Les buts viennent de la table `event` (type `goal`, période FirstHalf / SecondHalf, buts contre son camp
crédités à l'adversaire via `credited_side`) ; le score final vient de la table `match`.
"""

from __future__ import annotations

import glob
import io
import re
import tarfile
from pathlib import Path

import pandas as pd
import pyarrow.parquet as pq

from . import COMPETITIONS, RESEARCH, ROOT

CACHE = ROOT / ".cache" / "pitchapi"
RESULTS = RESEARCH / "results.parquet"
COLUMNS = ["match_id", "competition", "season", "kickoff_utc", "home_team_id", "away_team_id", "home_team_name", "away_team_name",
           "ft_home", "ft_away", "ht_home", "ht_away", "first_goal", "last_goal", "goals_first_half", "goals_total", "extra_time", "awarded"]


def _read(tar: tarfile.TarFile, table: str, columns: list[str] | None = None) -> pd.DataFrame | None:
    names = [n for n in tar.getnames() if n.startswith(table + "/") and n.endswith(".parquet")]
    if not names:
        return None
    return pq.read_table(io.BytesIO(tar.extractfile(names[0]).read()), columns=columns).to_pandas()


def season_results(tar_path: Path) -> pd.DataFrame:
    m = re.search(r"tables-([A-Z0-9]+)-(\d{4}(?:-\d{2})?)\.tar$", tar_path.name)
    competition, season = m.group(1), m.group(2)
    with tarfile.open(tar_path) as tar:
        matches = _read(tar, "match", ["match_id", "match_status", "date", "time_utc", "home_team_id", "away_team_id", "home_team_name",
                                         "away_team_name", "score_home", "score_away", "extra_time"])
        events = _read(tar, "event", ["match_id", "event_type", "period", "minute", "minute_added", "seq", "team_id", "credited_side", "is_cancelled"])
    if matches is None:
        return pd.DataFrame(columns=COLUMNS)
    fin = matches[matches["score_home"].notna() & matches["score_away"].notna()].copy()
    fin["kickoff_utc"] = pd.to_datetime(fin["time_utc"], utc=True, errors="coerce")
    fin = fin[fin["kickoff_utc"].notna()]
    goals = events[(events["event_type"] == "goal") & ~events["is_cancelled"].fillna(False)].copy() if events is not None else pd.DataFrame()
    rows = []
    for mt in fin.itertuples(index=False):
        g = goals[goals["match_id"] == mt.match_id].sort_values(["seq", "minute", "minute_added"]) if not goals.empty else goals
        side = []
        for e in g.itertuples(index=False):
            s = e.credited_side if isinstance(e.credited_side, str) and e.credited_side in ("home", "away") else ("home" if e.team_id == mt.home_team_id else "away")
            side.append((s, e.period))
        ht_h = sum(1 for s, p in side if s == "home" and p == "FirstHalf")
        ht_a = sum(1 for s, p in side if s == "away" and p == "FirstHalf")
        ft_h, ft_a = int(mt.score_home), int(mt.score_away)
        # cohérence : si les événements ne retrouvent pas le score final, le match est marqué awarded (score administratif ou événements incomplets)
        awarded = (sum(1 for s, _ in side if s == "home") != ft_h) or (sum(1 for s, _ in side if s == "away") != ft_a)
        rows.append({"match_id": mt.match_id, "competition": competition, "season": season, "kickoff_utc": mt.kickoff_utc,
                     "home_team_id": mt.home_team_id, "away_team_id": mt.away_team_id, "home_team_name": mt.home_team_name, "away_team_name": mt.away_team_name,
                     "ft_home": ft_h, "ft_away": ft_a, "ht_home": ht_h, "ht_away": ht_a,
                     "first_goal": side[0][0] if side else "none", "last_goal": side[-1][0] if side else "none",
                     "goals_first_half": ht_h + ht_a, "goals_total": ft_h + ft_a, "extra_time": bool(mt.extra_time), "awarded": bool(awarded)})
    return pd.DataFrame(rows, columns=COLUMNS)


def build(competitions=COMPETITIONS, out: Path = RESULTS) -> pd.DataFrame:
    frames = []
    for tar in sorted(glob.glob(str(CACHE / "data-v2-*" / "tables-*.tar"))):
        comp = re.search(r"tables-([A-Z0-9]+)-", tar).group(1)
        if comp in competitions:
            frames.append(season_results(Path(tar)))
    df = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame(columns=COLUMNS)
    out.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(out, index=False)
    return df


def half_share(results: pd.DataFrame) -> pd.DataFrame:
    """Part des buts marqués en première mi-temps par compétition et saison (hors matchs awarded)."""
    r = results[~results["awarded"]]
    g = r.groupby(["competition", "season"]).agg(first=("goals_first_half", "sum"), total=("goals_total", "sum")).reset_index()
    g["share_first_half"] = g["first"] / g["total"]
    return g


if __name__ == "__main__":
    df = build()
    print(f"{len(df)} matchs, {int(df['awarded'].sum())} incohérents/administratifs ; {RESULTS}")
    print(half_share(df).groupby("competition")["share_first_half"].mean().round(3).to_dict())
