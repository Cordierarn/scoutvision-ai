"""
Ligne de commande du Labo paris, phase 1 (tout sous .research/betting/, ignoré par Git) :

  cd scripts
  python3 -m betting.fetch status [--account]              compteur local du quota (et compteur serveur, 1 requête)
  python3 -m betting.fetch fixtures --from 2026-07-01 --to 2026-11-10
                                                           rencontres Big 5 (1 requête par fenêtre de 10 jours)
  python3 -m betting.fetch history --max-requests 20 [--since 2026-10-01] [--competitions ENG,ESP]
                                                           historique Winamax complet des matchs terminés non archivés,
                                                           du plus récent au plus ancien (1 requête par match)
  python3 -m betting.fetch snapshot                        relevé courant des rencontres à venir (1 requête par tournoi)
  python3 -m betting.fetch views                           vues dérivées premier / H−24 / H−1 / dernier avant coup d'envoi
  python3 -m betting.fetch match                           appariement avec les matchs PitchAPI (alias appris)

La clé est lue dans ODDSPAPI_API_KEY ou .env.local ; elle n'est jamais affichée.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
from contextlib import contextmanager
from pathlib import Path

import pandas as pd

from . import BIG5, BOOKMAKER, RESEARCH, ROOT, TOURNAMENTS
from . import archive, matching
from .client import OddsPapiClient, QuotaExceeded

FIXTURES = RESEARCH / "fixtures.parquet"
ODDS = RESEARCH / "odds"
VIEWS = RESEARCH / "views"
MATCHES = RESEARCH / "matches.parquet"
STATUS_FINISHED = 2


@contextmanager
def archive_lock(path: Path = RESEARCH / ".lock"):
    """Un seul processus écrit l'archive à la fois : une commande concurrente s'arrête avec un message clair."""
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError:
        raise SystemExit(f"Archive verrouillée par une autre commande ({path}). Attendre sa fin, ou supprimer le verrou si elle a été interrompue.")
    try:
        os.write(fd, str(os.getpid()).encode())
        os.close(fd)
        yield
    finally:
        path.unlink(missing_ok=True)


def _odds_path(competition: str, season: str) -> Path:
    return ODDS / competition / f"{season}.parquet"


def load_fixtures() -> pd.DataFrame:
    return pd.read_parquet(FIXTURES) if FIXTURES.exists() else pd.DataFrame(columns=archive.FIXTURE_COLUMNS)


def load_snapshots(competitions=BIG5) -> pd.DataFrame:
    frames = [pd.read_parquet(p) for c in competitions for p in sorted((ODDS / c).glob("*.parquet"))] if ODDS.exists() else []
    return pd.concat(frames, ignore_index=True) if frames else pd.DataFrame(columns=archive.SNAPSHOT_COLUMNS)


def cmd_status(args) -> int:
    client = OddsPapiClient()
    q = client.quota
    print(f"Quota local {q.month} : {q.used} utilisées / {q.budget} (reste {q.remaining})")
    if args.account:
        acc = client.account()
        sub = next((s for s in acc.get("subscriptions", []) if s.get("is_active")), {})
        print(f"Serveur : plan {sub.get('plan')} · {sub.get('request_count')} / {sub.get('request_limit')}")
        if args.sync and sub.get("request_count") is not None:
            q.used, q.budget = int(sub["request_count"]), int(sub.get("request_limit") or q.budget)
            q.save()
            print(f"Compteur local aligné sur le serveur : {q.used}/{q.budget}")
    return 0


def cmd_fixtures(args) -> int:
    client = OddsPapiClient()
    start = dt.datetime.fromisoformat(args.start).replace(tzinfo=dt.timezone.utc)
    end = dt.datetime.fromisoformat(args.end).replace(tzinfo=dt.timezone.utc)
    raw = client.fixtures(start, end)
    comp_of = {tid: c for c, tid in TOURNAMENTS.items()}
    rows = archive.fixture_rows([f for f in raw if int(f["tournamentId"]) in comp_of], comp_of, season="")
    if not rows.empty:
        rows["season"] = rows["start_time"].map(archive.season_of)
    merged = archive.write_fixtures(rows, FIXTURES)
    print(f"{len(rows)} rencontres Big 5 dans la fenêtre, {len(merged)} au total ; {client.calls} appels, {client.cache_hits} relus du cache ; quota {client.quota.used}/{client.quota.budget}")
    return 0


def cmd_history(args) -> int:
    client = OddsPapiClient()
    fx = load_fixtures()
    comps = args.competitions.split(",") if args.competitions else list(BIG5)
    done = set(load_snapshots(comps)["fixture_id"].unique())
    todo = fx[(fx["status_id"] == STATUS_FINISHED) & fx["competition"].isin(comps) & ~fx["fixture_id"].isin(done)]
    if args.since:
        todo = todo[todo["start_time"] >= pd.Timestamp(args.since, tz="UTC")]
    todo = todo.sort_values("start_time", ascending=False)
    budget = min(args.max_requests, client.quota.remaining)
    print(f"{len(todo)} matchs terminés à archiver, {budget} requêtes autorisées pour cette exécution")
    added, fetched, missing = 0, 0, 0
    for f in todo.head(budget).itertuples(index=False):
        try:
            payload = client.historical_odds(f.fixture_id, [BOOKMAKER])
        except QuotaExceeded as exc:
            print(str(exc))
            break
        fetched += 1
        if payload is None:
            missing += 1
            continue
        snaps = archive.flatten_historical(payload)
        added += archive.write_snapshots(snaps, _odds_path(f.competition, f.season))
    print(f"{fetched} matchs demandés, {missing} sans historique Winamax, {added} relevés ajoutés ; quota {client.quota.used}/{client.quota.budget}")
    return 0


def cmd_snapshot(args) -> int:
    client = OddsPapiClient()
    comp_of = {tid: c for c, tid in TOURNAMENTS.items()}
    now = dt.datetime.now(dt.timezone.utc)
    fixtures = client.odds_by_tournaments([TOURNAMENTS[c] for c in BIG5], [BOOKMAKER])
    rows = archive.fixture_rows(fixtures, comp_of, season="")
    if not rows.empty:
        rows["season"] = rows["start_time"].map(archive.season_of)
        archive.write_fixtures(rows, FIXTURES)
    added = 0
    for f in fixtures:
        snaps = archive.flatten_live(f, now)
        if snaps.empty:
            continue
        start = pd.Timestamp(f["startTime"])
        added += archive.write_snapshots(snaps, _odds_path(comp_of[int(f["tournamentId"])], archive.season_of(start)))
    print(f"{len(fixtures)} rencontres à venir, {added} relevés ajoutés ; quota {client.quota.used}/{client.quota.budget}")
    return 0


def cmd_views(args) -> int:
    fx = load_fixtures()
    total = 0
    for comp in BIG5:
        for p in sorted((ODDS / comp).glob("*.parquet")) if (ODDS / comp).exists() else []:
            views = archive.derived_views(pd.read_parquet(p), fx)
            out = VIEWS / comp / p.name
            out.parent.mkdir(parents=True, exist_ok=True)
            views.to_parquet(out, index=False)
            total += len(views)
    print(f"{total} lignes de vues dérivées dans {VIEWS}")
    return 0


def pitchapi_matches() -> pd.DataFrame:
    """Matchs PitchAPI Big 5 : joués (dataset point-in-time) et à venir (forecast.json)."""
    frames = []
    replay = ROOT / ".research" / "forecast" / "replay_pitchapi.parquet"
    if replay.exists():
        d = pd.read_parquet(replay, columns=["match_id", "competition", "kickoff_utc", "home_team_name", "away_team_name"])
        frames.append(d[d["competition"].isin(BIG5)])
    forecast = ROOT / "public" / "data" / "forecast.json"
    if forecast.exists():
        ms = json.loads(forecast.read_text(encoding="utf-8")).get("matches", [])
        frames.append(pd.DataFrame([{"match_id": m["match_id"], "competition": m["competition"], "kickoff_utc": pd.Timestamp(m["date"]),
                                     "home_team_name": m["home"], "away_team_name": m["away"]} for m in ms if m["competition"] in BIG5]))
    if not frames:
        return pd.DataFrame(columns=["match_id", "competition", "kickoff_utc", "home_team_name", "away_team_name"])
    df = pd.concat(frames, ignore_index=True).drop_duplicates("match_id")
    df["kickoff_utc"] = pd.to_datetime(df["kickoff_utc"], utc=True)
    return df


def cmd_match(args) -> int:
    fx = load_fixtures()
    matches = pitchapi_matches()
    aliases = matching.load_aliases()
    matched, failures = matching.match_fixtures(fx, matches, aliases)
    aliases = matching.learn_aliases(matched, fx, matches, aliases)
    matching.save_aliases(aliases)
    matched.to_parquet(MATCHES, index=False)
    failures.to_parquet(RESEARCH / "match_failures.parquet", index=False)
    n = len(matches)
    print(f"{len(matched)} appariés sur {n} ({len(matched) / max(n, 1) * 100:.1f} %), {len(failures)} échecs : {failures['reason'].value_counts().to_dict()} ; {len(aliases)} alias")
    return 0


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("status"); p.add_argument("--account", action="store_true"); p.add_argument("--sync", action="store_true"); p.set_defaults(fn=cmd_status)
    p = sub.add_parser("fixtures"); p.add_argument("--from", dest="start", required=True); p.add_argument("--to", dest="end", required=True); p.set_defaults(fn=cmd_fixtures)
    p = sub.add_parser("history"); p.add_argument("--max-requests", type=int, default=10); p.add_argument("--since"); p.add_argument("--competitions"); p.set_defaults(fn=cmd_history)
    p = sub.add_parser("snapshot"); p.set_defaults(fn=cmd_snapshot)
    p = sub.add_parser("views"); p.set_defaults(fn=cmd_views)
    p = sub.add_parser("match"); p.set_defaults(fn=cmd_match)
    args = parser.parse_args(argv)
    RESEARCH.mkdir(parents=True, exist_ok=True)
    if args.cmd in ("fixtures", "history", "snapshot", "views", "match"):
        with archive_lock():
            return args.fn(args)
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(main())
