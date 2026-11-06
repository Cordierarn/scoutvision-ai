"""
Résultats de la veille (scores finaux ; mi-temps, premier et dernier but reconstruits à partir des minutes des buts) lus
sur le tableau de scores public d'ESPN, par compétition et par date, pour régler les suggestions sans attendre l'export PitchAPI
(lundi et vendredi). Aucun secret ; appelé par le workflow du matin.

  cd scripts
  python3 -m betting.results_web --date 2026-11-02          # UTC ; par défaut : hier
  python3 -m betting.results_web --refresh-incomplete 14    # relit les dates sans mi-temps reconstruite

Sortie : `.research/betting/results_web.parquet` (ajout sans doublon), colonnes alignées sur
`betting.results` (match_id attribué par appariement de noms avec les rencontres PitchAPI quand il existe).
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import sys
import time
from pathlib import Path

import pandas as pd

from . import COMPETITIONS, RESEARCH, ROOT
from .matching import similarity

ESPN = {"ENG": "eng.1", "ENG2": "eng.2", "ESP": "esp.1", "ITA": "ita.1", "FRA": "fra.1", "GER": "ger.1", "POR": "por.1", "NED": "ned.1",
        "UCL": "uefa.champions", "UEL": "uefa.europa", "UECL": "uefa.europa.conf"}
BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer/{league}/scoreboard"
OUT = RESEARCH / "results_web.parquet"
COLUMNS = ["source_id", "competition", "date", "kickoff_utc", "home_name", "away_name", "ft_home", "ft_away", "ht_home", "ht_away", "first_goal", "last_goal", "completed",
           "regulation", "match_id"]


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


MINUTE = re.compile(r"^(\d+)'(?:\+(\d+)')?$")
REGULATION_PERIODS = 2          # au-delà : prolongation ou tirs au but, le score final n'est pas celui du temps réglementaire


def goal_minute(detail: dict) -> tuple[int, int] | None:
    """(minute, temps additionnel) d'un but d'après la minute affichée (« 43' », « 45'+2' ») ; None si illisible."""
    m = MINUTE.match(str(((detail.get("clock") or {}).get("displayValue")) or "").strip())
    return (int(m.group(1)), int(m.group(2) or 0)) if m else None


def goal_facts(goals: list[tuple[tuple[int, int] | None, str]], ft: tuple[int | None, int | None]) -> dict:
    """Mi-temps et ordre des buts reconstruits à partir des buts listés (minute, côté crédité). Seulement si chaque
    minute est lisible et si les buts listés redonnent exactement le score final ; sinon tout reste inconnu (None),
    jamais 0-0 ni « aucun but ». Un but à 45'+n est en première mi-temps."""
    unknown = {"ht_home": None, "ht_away": None, "first_goal": None, "last_goal": None}
    if ft[0] is None or ft[1] is None or any(minute is None for minute, _ in goals):
        return unknown
    if (sum(side == "home" for _, side in goals), sum(side == "away" for _, side in goals)) != (ft[0], ft[1]):
        return unknown
    ordered = sorted(goals, key=lambda g: g[0])
    first_half = [side for (minute, _added), side in ordered if minute <= 45]
    return {"ht_home": first_half.count("home"), "ht_away": first_half.count("away"),
            "first_goal": ordered[0][1] if ordered else "none", "last_goal": ordered[-1][1] if ordered else "none"}


def parse(payload: dict, competition: str) -> list[dict]:
    """Un dict par rencontre : score final, et pour une rencontre terminée dans le temps réglementaire, mi-temps et
    premier / dernier but reconstruits à partir des buts listés (`details`) ; le tableau de scores ne donne pas le score
    de mi-temps. ESPN crédite un but contre son camp à l'équipe bénéficiaire : il n'est pas inversé."""
    rows = []
    for ev in payload.get("events", []):
        comp = (ev.get("competitions") or [{}])[0]
        status_block = comp.get("status") or ev.get("status") or {}
        status = status_block.get("type", {})
        competitors = comp.get("competitors") or []
        home = next((c for c in competitors if c.get("homeAway") == "home"), None)
        away = next((c for c in competitors if c.get("homeAway") == "away"), None)
        if home is None or away is None:
            continue
        completed = bool(status.get("completed"))
        period = _int(status_block.get("period"))
        regulation = completed and (period is None or period <= REGULATION_PERIODS)
        ft_h, ft_a = _int(home.get("score")), _int(away.get("score"))
        home_id = str((home.get("team") or {}).get("id"))
        goals = [(goal_minute(d), "home" if str((d.get("team") or {}).get("id")) == home_id else "away")
                 for d in comp.get("details") or [] if d.get("scoringPlay")]
        facts = goal_facts(goals, (ft_h, ft_a)) if regulation else {"ht_home": None, "ht_away": None, "first_goal": None, "last_goal": None}
        rows.append({"source_id": str(ev.get("id")), "competition": competition, "date": str(ev.get("date", ""))[:10], "kickoff_utc": ev.get("date"),
                     "home_name": (home.get("team") or {}).get("displayName"), "away_name": (away.get("team") or {}).get("displayName"),
                     "ft_home": ft_h, "ft_away": ft_a, **facts, "completed": completed, "regulation": bool(regulation), "match_id": None})
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
    """Ajout sans doublon (la dernière lecture d'une rencontre l'emporte) ; un appariement connu n'est jamais effacé
    par une relecture qui ne le retrouve plus (match sorti de forecast.json après l'export suivant)."""
    existing = pd.read_parquet(path) if path.exists() else pd.DataFrame(columns=COLUMNS)
    if not df.empty and not existing.empty:
        known = existing.dropna(subset=["match_id"]).drop_duplicates("source_id", keep="last").set_index("source_id")["match_id"]
        df = df.copy()
        df["match_id"] = df["match_id"].where(df["match_id"].notna(), df["source_id"].map(known))
    merged = pd.concat([existing, df], ignore_index=True) if not df.empty else existing
    merged = merged.drop_duplicates("source_id", keep="last").reset_index(drop=True)
    path.parent.mkdir(parents=True, exist_ok=True)
    merged.to_parquet(path, index=False)
    return merged


def as_results(df: pd.DataFrame) -> pd.DataFrame:
    """Lignes au format de `betting.results` pour les rencontres terminées dans le temps réglementaire et appariées à un
    match PitchAPI. Mi-temps et ordre des buts inconnus restent inconnus (NaN, None) : les marchés qui en dépendent
    attendent (`markets.settleable`). Une ligne lue avant la colonne `regulation` n'est jamais tenue pour réglementaire
    sans mi-temps reconstruite."""
    regulation = df["regulation"].fillna(False).astype(bool) if "regulation" in df else df["ht_home"].notna()
    d = df[df["completed"].fillna(False).astype(bool) & regulation & df["match_id"].notna() & df["ft_home"].notna()].copy()
    ht_h, ht_a = pd.to_numeric(d["ht_home"], errors="coerce"), pd.to_numeric(d["ht_away"], errors="coerce")
    known = lambda col: d[col].where(d[col].isin(["home", "away", "none"]), None)
    return pd.DataFrame({"match_id": d["match_id"], "competition": d["competition"], "season": "2026-27", "kickoff_utc": pd.to_datetime(d["kickoff_utc"], utc=True, errors="coerce"),
                         "home_team_id": None, "away_team_id": None, "home_team_name": d["home_name"], "away_team_name": d["away_name"],
                         "ft_home": d["ft_home"].astype(int), "ft_away": d["ft_away"].astype(int), "ht_home": ht_h, "ht_away": ht_a,
                         "first_goal": known("first_goal"), "last_goal": known("last_goal"), "goals_first_half": ht_h + ht_a,
                         "goals_total": d["ft_home"].astype(int) + d["ft_away"].astype(int), "extra_time": False, "awarded": False})


def incomplete_dates(stored: pd.DataFrame, today: dt.date, days: int = 14) -> list[dt.date]:
    """Dates des `days` derniers jours dont une rencontre terminée n'a pas de mi-temps ou d'ordre des buts connus (lue
    par une version antérieure du lecteur, ou buts incomplets à la première lecture) : à relire."""
    if stored.empty:
        return []
    done = stored[stored["completed"].fillna(False).astype(bool)]
    missing = done[done["ht_home"].isna() | done["first_goal"].isna()]
    dates = {dt.date.fromisoformat(str(x)[:10]) for x in missing["date"]}
    return sorted(d for d in dates if 0 <= (today - d).days <= days)


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--date", help="AAAA-MM-JJ (UTC), par défaut hier")
    p.add_argument("--refresh-incomplete", type=int, metavar="JOURS",
                   help="relit les dates des JOURS derniers jours dont une rencontre terminée n'a pas de mi-temps reconstruite")
    args = p.parse_args(argv)
    today = dt.datetime.now(dt.timezone.utc).date()
    if args.refresh_incomplete is not None:
        days = incomplete_dates(pd.read_parquet(OUT) if OUT.exists() else pd.DataFrame(columns=COLUMNS), today, args.refresh_incomplete)
        print(f"{len(days)} date(s) à relire : {', '.join(map(str, days)) or 'aucune'}")
    else:
        days = [dt.date.fromisoformat(args.date) if args.date else today - dt.timedelta(days=1)]
    for day in days:
        df = collect(day)
        merged = save(df)
        done = df[df["completed"]]
        known = done["ht_home"].notna()
        print(f"{day} : {len(df)} rencontres lues, {len(done)} terminées dont {int(known.sum())} avec mi-temps reconstruite, "
              f"{int(done['match_id'].notna().sum())} appariées PitchAPI ; {len(merged)} au total dans {OUT}")
        for r in done.itertuples():
            ht = f"{int(r.ht_home)}-{int(r.ht_away)}" if pd.notna(r.ht_home) else "inconnue (paris de mi-temps en attente)"
            regulation = "" if r.regulation else " (au-delà du temps réglementaire : non réglé)"
            print(f"  {r.competition} {r.home_name} {r.ft_home}-{r.ft_away} {r.away_name} (mi-temps {ht}, 1er but {r.first_goal}, dernier {r.last_goal}){regulation}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
