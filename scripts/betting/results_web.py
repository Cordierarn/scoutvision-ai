"""
Résultats de la veille (scores finaux, mi-temps, premier et dernier but) lus sur le tableau de scores
public d'ESPN, par compétition et par date, pour régler les suggestions sans attendre l'export PitchAPI
(lundi et vendredi). Aucun secret ; appelé par le workflow du matin.

  cd scripts
  python3 -m betting.results_web --date 2026-11-02          # UTC ; par défaut : hier

Sortie : `.research/betting/results_web.parquet` (ajout sans doublon), colonnes alignées sur
`betting.results` (match_id attribué par appariement de noms avec les rencontres PitchAPI quand il existe).
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
import time
from pathlib import Path

import pandas as pd

from . import COMPETITIONS, RESEARCH, ROOT
from .matching import similarity

ESPN = {"ENG": "eng.1", "ENG2": "eng.2", "ESP": "esp.1", "ITA": "ita.1", "FRA": "fra.1", "GER": "ger.1", "POR": "por.1", "NED": "ned.1"}
BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer/{league}/scoreboard"
OUT = RESEARCH / "results_web.parquet"
COLUMNS = ["source_id", "competition", "date", "kickoff_utc", "home_name", "away_name", "ft_home", "ft_away", "ht_home", "ht_away", "first_goal", "last_goal", "completed", "match_id"]


def fetch(league: str, day: dt.date, http=None) -> dict:
    import requests

    url = BASE.format(league=league)
    for attempt in range(3):
        try:
            r = (http or requests.get)(url, params={"dates": day.strftime("%Y%m%d")}, timeout=60)
            if r.status_code == 200:
                return r.json()
        except Exception:
            pass
        time.sleep(2 ** attempt)
    return {"events": []}


def parse(payload: dict, competition: str) -> list[dict]:
    """Un dict par rencontre terminée : score final, mi-temps (linescores), premier et dernier but (details)."""
    rows = []
    for ev in payload.get("events", []):
        comp = (ev.get("competitions") or [{}])[0]
        status = (comp.get("status") or ev.get("status") or {}).get("type", {})
        competitors = comp.get("competitors") or []
        home = next((c for c in competitors if c.get("homeAway") == "home"), None)
        away = next((c for c in competitors if c.get("homeAway") == "away"), None)
        if home is None or away is None:
            continue
        completed = bool(status.get("completed"))
        ft_h, ft_a = _int(home.get("score")), _int(away.get("score"))
        ls_h, ls_a = home.get("linescores") or [], away.get("linescores") or []
        ht_h = _int(ls_h[0].get("value")) if ls_h else None
        ht_a = _int(ls_a[0].get("value")) if ls_a else None
        goals = []
        for d in comp.get("details") or []:
            if not d.get("scoringPlay"):
                continue
            team_id = str((d.get("team") or {}).get("id"))
            side = "home" if team_id == str((home.get("team") or {}).get("id")) else "away"
            if d.get("ownGoal"):
                side = "away" if side == "home" else "home"
            goals.append((float((d.get("clock") or {}).get("value") or 0.0), side))
        goals.sort()
        rows.append({"source_id": str(ev.get("id")), "competition": competition, "date": str(ev.get("date", ""))[:10], "kickoff_utc": ev.get("date"),
                     "home_name": (home.get("team") or {}).get("displayName"), "away_name": (away.get("team") or {}).get("displayName"),
                     "ft_home": ft_h, "ft_away": ft_a, "ht_home": ht_h, "ht_away": ht_a,
                     "first_goal": goals[0][1] if goals else ("none" if completed else None), "last_goal": goals[-1][1] if goals else ("none" if completed else None),
                     "completed": completed, "match_id": None})
    return rows


def _int(v):
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return None


def attach_match_ids(rows: pd.DataFrame, threshold: float = 0.5) -> pd.DataFrame:
    """Identifiant PitchAPI par compétition, date ± 1 jour et similarité des noms (candidat unique au-dessus du seuil)."""
    forecast = ROOT / "public" / "data" / "forecast.json"
    if not forecast.exists() or rows.empty:
        return rows
    ms = pd.DataFrame(json.loads(forecast.read_text(encoding="utf-8")).get("matches", []))
    if ms.empty:
        return rows
    ms["day"] = pd.to_datetime(ms["date"])
    rows = rows.copy()
    for i, r in rows.iterrows():
        if pd.isna(r.get("match_id")) or r.get("match_id") is None:
            day = pd.to_datetime(r["date"])
            cands = ms[(ms["competition"] == r["competition"]) & ((ms["day"] - day).abs() <= pd.Timedelta(days=1))]
            scored = sorted(((min(similarity(c.home, r["home_name"] or ""), similarity(c.away, r["away_name"] or "")), c.match_id) for c in cands.itertuples()), key=lambda t: -t[0])
            if scored and scored[0][0] >= threshold and (len(scored) == 1 or scored[1][0] < scored[0][0]):
                rows.at[i, "match_id"] = scored[0][1]
    return rows


def collect(day: dt.date, competitions=COMPETITIONS, http=None) -> pd.DataFrame:
    rows = []
    for comp in competitions:
        league = ESPN.get(comp)
        if league:
            rows += parse(fetch(league, day, http), comp)
    df = pd.DataFrame(rows, columns=COLUMNS)
    return attach_match_ids(df)


def save(df: pd.DataFrame, path: Path = OUT) -> pd.DataFrame:
    existing = pd.read_parquet(path) if path.exists() else pd.DataFrame(columns=COLUMNS)
    merged = pd.concat([existing, df], ignore_index=True) if not df.empty else existing
    merged = merged.drop_duplicates("source_id", keep="last").reset_index(drop=True)
    path.parent.mkdir(parents=True, exist_ok=True)
    merged.to_parquet(path, index=False)
    return merged


def as_results(df: pd.DataFrame) -> pd.DataFrame:
    """Lignes au format de `betting.results` pour les rencontres terminées appariées à un match PitchAPI."""
    d = df[df["completed"] & df["match_id"].notna() & df["ft_home"].notna()].copy()
    d["ht_home"] = d["ht_home"].fillna(0).astype(int); d["ht_away"] = d["ht_away"].fillna(0).astype(int)
    d["first_goal"] = d["first_goal"].fillna("none"); d["last_goal"] = d["last_goal"].fillna("none")
    return pd.DataFrame({"match_id": d["match_id"], "competition": d["competition"], "season": "2026-27", "kickoff_utc": pd.to_datetime(d["kickoff_utc"], utc=True, errors="coerce"),
                         "home_team_id": None, "away_team_id": None, "home_team_name": d["home_name"], "away_team_name": d["away_name"],
                         "ft_home": d["ft_home"].astype(int), "ft_away": d["ft_away"].astype(int), "ht_home": d["ht_home"], "ht_away": d["ht_away"],
                         "first_goal": d["first_goal"], "last_goal": d["last_goal"], "goals_first_half": d["ht_home"] + d["ht_away"],
                         "goals_total": d["ft_home"].astype(int) + d["ft_away"].astype(int), "extra_time": False, "awarded": False})


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--date", help="AAAA-MM-JJ (UTC), par défaut hier")
    args = p.parse_args(argv)
    day = dt.date.fromisoformat(args.date) if args.date else (dt.datetime.now(dt.timezone.utc).date() - dt.timedelta(days=1))
    df = collect(day)
    merged = save(df)
    done = df[df["completed"]]
    print(f"{day} : {len(df)} rencontres lues, {len(done)} terminées, {int(done['match_id'].notna().sum())} appariées PitchAPI ; {len(merged)} au total dans {OUT}")
    for r in done.itertuples():
        ht = f"{r.ht_home}-{r.ht_away}" if r.ht_home is not None and not pd.isna(r.ht_home) else "N/D"
        print(f"  {r.competition} {r.home_name} {r.ft_home}-{r.ft_away} {r.away_name} (mi-temps {ht}, 1er but {r.first_goal}, dernier {r.last_goal})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
