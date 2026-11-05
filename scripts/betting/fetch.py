"""
Ligne de commande du Labo paris, phase 1 (tout sous .research/betting/, ignoré par Git) :

  cd scripts
  python3 -m betting.fetch status [--account]              compteur local du quota (et compteur serveur, 1 requête)
  python3 -m betting.fetch fixtures --from 2026-07-01 --to 2026-11-10
                                                           rencontres Big 5 (1 requête par fenêtre de 10 jours)
  python3 -m betting.fetch upcoming --days 7 --refresh-stale 2 --max-requests 60   # + match par match pour les rencontres non rafraîchies
  python3 -m betting.fetch history --max-requests 20 [--since 2026-10-01] [--competitions ENG,ESP] [--refresh-players | --refresh-sharp]
                                                           historique Winamax complet des matchs terminés non archivés,
                                                           du plus récent au plus ancien (1 requête par match) ;
                                                           --refresh-players redemande les matchs archivés sans marché joueur
                                                           --refresh-sharp redemande ceux archivés sans Pinnacle ni Betfair (référence, CLV)
  python3 -m betting.fetch snapshot                        relevé courant des rencontres à venir (1 requête décomptée par tournoi)
  python3 -m betting.fetch upcoming [--days 7] [--per-fixture]  cotes courantes des rencontres à venir (un appel par tournoi)
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

from . import BOOKMAKER, BOOKMAKERS, COMPETITIONS, RESEARCH, ROOT, SHARP_BOOKMAKERS, TOURNAMENTS
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


def load_snapshots(competitions=COMPETITIONS) -> pd.DataFrame:
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
    from .catalogue import load as load_catalogue
    load_catalogue(client=client)  # catalogue des marchés conservé dans l'archive (les suggestions n'ont alors plus besoin de la clé)
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


def player_props_enabled(client: OddsPapiClient) -> bool | None:
    """Lit l'option « player props » de Winamax FR dans le compte (appel non décompté) et l'affiche."""
    try:
        acc = client.account()
        sub = next((s for s in acc.get("subscriptions", []) if s.get("is_active")), {})
        flag = sub.get("bookmakers", {}).get(BOOKMAKER, {}).get("has_player_props")
    except Exception as exc:  # le compte n'est pas indispensable à l'archivage
        print(f"Compte OddsPapi illisible ({client.redact(str(exc))[:80]}) : option marchés joueurs inconnue")
        return None
    print(f"Marchés joueurs Winamax FR ({BOOKMAKER}) dans le plan : {'oui' if flag else 'non'}")
    return bool(flag)


class SnapshotBuffer:
    """Regroupe les relevés par fichier de saison : chaque `write_snapshots` relit et réécrit tout le fichier,
    une écriture par match coûte donc plusieurs secondes une fois l'archive volumineuse."""

    def __init__(self, every: int = 50) -> None:
        self.every, self.pending, self.count, self.added = every, {}, 0, 0

    def add(self, snaps: pd.DataFrame, path: Path) -> None:
        if snaps.empty:
            return
        self.pending.setdefault(path, []).append(snaps)
        self.count += 1
        if self.count >= self.every:
            self.flush()

    def flush(self) -> int:
        for path, frames in self.pending.items():
            self.added += archive.write_snapshots(pd.concat(frames, ignore_index=True), path)
        self.pending, self.count = {}, 0
        return self.added


def cmd_history(args) -> int:
    client = OddsPapiClient()
    props = player_props_enabled(client)
    if args.refresh_players and not props:
        print("--refresh-players refusé : l'option marchés joueurs n'est pas active sur Winamax FR, la passe serait inutile.")
        return 2
    fx = load_fixtures()
    comps = args.competitions.split(",") if args.competitions else list(COMPETITIONS)
    snaps = load_snapshots(comps)
    if args.refresh_players:
        # matchs archivés sans aucun marché joueur (plan sans « player props » au moment de l'appel) : à redemander
        done = set(snaps.loc[snaps["player_id"].notna(), "fixture_id"].unique())
    elif getattr(args, "refresh_sharp", False):
        # matchs archivés avant la collecte des bookmakers de référence (Pinnacle, Betfair) : à redemander, la
        # même requête rapporte les trois bookmakers (le CLV et le rejeu en ont besoin)
        done = set(snaps.loc[snaps["bookmaker"].isin(SHARP_BOOKMAKERS), "fixture_id"].unique())
    else:
        done = set(snaps["fixture_id"].unique())
    todo = fx[(fx["status_id"] == STATUS_FINISHED) & fx["competition"].isin(comps) & ~fx["fixture_id"].isin(done)]
    if args.since:
        todo = todo[todo["start_time"] >= pd.Timestamp(args.since, tz="UTC")]
    todo = todo.sort_values("start_time", ascending=False)
    budget = min(args.max_requests, client.quota.remaining)
    print(f"{len(todo)} matchs terminés à archiver, {budget} requêtes autorisées pour cette exécution (environ 6,5 s par match)", flush=True)
    fetched, missing = 0, 0
    buffer = SnapshotBuffer()
    for f in todo.head(budget).itertuples(index=False):
        try:
            payload = client.historical_odds(f.fixture_id, list(BOOKMAKERS))
        except QuotaExceeded as exc:
            print(str(exc))
            break
        fetched += 1
        if fetched % 25 == 0:
            print(f"  {fetched} matchs archivés…", flush=True)
        if payload is None:
            missing += 1
            continue
        buffer.add(archive.flatten_historical(payload), _odds_path(f.competition, f.season))
    added = buffer.flush()
    print(f"{fetched} matchs demandés, {missing} sans historique Winamax, {added} relevés ajoutés ; quota {client.quota.used}/{client.quota.budget}")
    return 0


def cmd_upcoming(args) -> int:
    """Cotes courantes des rencontres à venir : un appel /odds-by-tournaments par tournoi (quelques secondes,
    décompté du quota), datées de l'heure du relevé. `--per-fixture` : ancien mode, /historical-odds match par
    match (non décompté, environ 6,5 s par rencontre)."""
    client = OddsPapiClient()
    player_props_enabled(client)
    if args.per_fixture:
        return _upcoming_per_fixture(client, args)
    comp_of = {tid: c for c, tid in TOURNAMENTS.items()}
    now = dt.datetime.now(dt.timezone.utc)
    horizon = pd.Timestamp(now) + pd.Timedelta(days=args.days)
    try:
        fixtures = client.odds_by_tournaments([TOURNAMENTS[c] for c in COMPETITIONS], list(BOOKMAKERS))
    except QuotaExceeded as exc:
        print(f"{exc} : repli sur /historical-odds match par match", flush=True)
        return _upcoming_per_fixture(client, args)
    kept, buffer = 0, SnapshotBuffer(every=10_000)
    for f in fixtures:
        start = pd.Timestamp(f["startTime"])
        if int(f["tournamentId"]) not in comp_of or not (pd.Timestamp(now) <= start <= horizon):
            continue
        snaps = archive.flatten_live(f, now, stamp="observed")
        if snaps.empty:
            continue
        kept += 1
        buffer.add(snaps, _odds_path(comp_of[int(f["tournamentId"])], archive.season_of(start)))
    added = buffer.flush()
    print(f"{kept} rencontres à venir sous {args.days} jours avec cotes ({len(COMPETITIONS)} tournois, un appel chacun), "
          f"{added} relevés ajoutés ; quota {client.quota.used}/{client.quota.budget}")
    if args.refresh_stale is not None:
        _refresh_stale(client, args)
    return 0


def stale_fixtures(fixtures: pd.DataFrame, last_seen: pd.Series, now: pd.Timestamp, days: int, hours: float) -> pd.DataFrame:
    """Rencontres à venir sous `days` jours dont le dernier relevé Winamax (`last_seen`, indexée par fixture_id) date de
    plus de `hours` heures, ou qui n'ont jamais été relevées. `/odds-by-tournaments` ne renvoie pas toute la fenêtre
    (constaté : 56 rencontres sous 72 h le 5 novembre 2026, 90 sous 127 h le 3) : les autres resteraient périmées."""
    todo = fixtures[(fixtures["status_id"] == 0) & (fixtures["start_time"] >= now) & (fixtures["start_time"] <= now + pd.Timedelta(days=days))]
    if last_seen.empty:
        return todo.sort_values("start_time")
    fresh = todo["fixture_id"].map(last_seen).ge(now - pd.Timedelta(hours=hours)).fillna(False)
    return todo[~fresh].sort_values("start_time")


def last_winamax_snapshot(competitions=COMPETITIONS) -> pd.Series:
    """Date du dernier relevé Winamax par rencontre (colonnes minimales : l'archive est volumineuse)."""
    frames = [pd.read_parquet(p, columns=["fixture_id", "bookmaker", "created_at"]) for c in competitions for p in sorted((ODDS / c).glob("*.parquet"))] if ODDS.exists() else []
    if not frames:
        return pd.Series(dtype="datetime64[ns, UTC]")
    df = pd.concat(frames, ignore_index=True)
    return df[df["bookmaker"] == BOOKMAKER].groupby("fixture_id")["created_at"].max()


def _refresh_stale(client: OddsPapiClient, args) -> None:
    now = pd.Timestamp.now(tz="UTC")
    todo = stale_fixtures(load_fixtures(), last_winamax_snapshot(), now, args.days, args.refresh_stale)
    if todo.empty:
        print(f"Toutes les rencontres sous {args.days} jours ont un relevé Winamax de moins de {args.refresh_stale:g} h")
        return
    fetched, buffer = 0, SnapshotBuffer()
    print(f"{len(todo)} rencontres sous {args.days} jours sans relevé Winamax depuis {args.refresh_stale:g} h : relevé match par match (environ 6,5 s chacune)", flush=True)
    for f in todo.head(args.max_requests).itertuples(index=False):
        try:
            payload = client.historical_odds(f.fixture_id, list(BOOKMAKERS))
        except QuotaExceeded as exc:
            print(str(exc)); break
        fetched += 1
        if payload is None:
            continue
        buffer.add(archive.flatten_historical(payload), _odds_path(f.competition, f.season))
    added = buffer.flush()
    print(f"{fetched} rencontres périmées relevées, {added} relevés ajoutés ; quota {client.quota.used}/{client.quota.budget}")


def _upcoming_per_fixture(client: OddsPapiClient, args) -> int:
    fx = load_fixtures()
    now = pd.Timestamp.now(tz="UTC")
    todo = fx[(fx["status_id"] == 0) & (fx["start_time"] >= now) & (fx["start_time"] <= now + pd.Timedelta(days=args.days))].sort_values("start_time")
    fetched, buffer = 0, SnapshotBuffer()
    print(f"{len(todo)} rencontres à venir sous {args.days} jours (environ 6,5 s par rencontre)", flush=True)
    for f in todo.head(args.max_requests).itertuples(index=False):
        try:
            payload = client.historical_odds(f.fixture_id, list(BOOKMAKERS))
        except QuotaExceeded as exc:
            print(str(exc)); break
        fetched += 1
        if fetched % 25 == 0:
            print(f"  {fetched} rencontres relevées…", flush=True)
        if payload is None:
            continue
        buffer.add(archive.flatten_historical(payload), _odds_path(f.competition, f.season))
    added = buffer.flush()
    print(f"{len(todo)} rencontres à venir sous {args.days} jours, {fetched} demandées, {added} relevés ajoutés ; quota {client.quota.used}/{client.quota.budget}")
    return 0


def cmd_snapshot(args) -> int:
    client = OddsPapiClient()
    player_props_enabled(client)
    comp_of = {tid: c for c, tid in TOURNAMENTS.items()}
    now = dt.datetime.now(dt.timezone.utc)
    fixtures = client.odds_by_tournaments([TOURNAMENTS[c] for c in COMPETITIONS], list(BOOKMAKERS))
    rows = archive.fixture_rows(fixtures, comp_of, season="")
    if not rows.empty:
        rows["season"] = rows["start_time"].map(archive.season_of)
        archive.write_fixtures(rows, FIXTURES)
    buffer = SnapshotBuffer(every=10_000)
    for f in fixtures:
        start = pd.Timestamp(f["startTime"])
        buffer.add(archive.flatten_live(f, now), _odds_path(comp_of[int(f["tournamentId"])], archive.season_of(start)))
    added = buffer.flush()
    print(f"{len(fixtures)} rencontres à venir, {added} relevés ajoutés ; quota {client.quota.used}/{client.quota.budget}")
    return 0


def cmd_views(args) -> int:
    fx = load_fixtures()
    total = 0
    for comp in COMPETITIONS:
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
        frames.append(d[d["competition"].isin(COMPETITIONS)])
    forecast = ROOT / "public" / "data" / "forecast.json"
    if forecast.exists():
        ms = json.loads(forecast.read_text(encoding="utf-8")).get("matches", [])
        frames.append(pd.DataFrame([{"match_id": m["match_id"], "competition": m["competition"], "kickoff_utc": pd.Timestamp(m["date"]),
                                     "home_team_name": m["home"], "away_team_name": m["away"]} for m in ms if m["competition"] in COMPETITIONS]))
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
    p = sub.add_parser("history"); p.add_argument("--max-requests", type=int, default=10); p.add_argument("--since"); p.add_argument("--competitions"); p.add_argument("--refresh-players", action="store_true"); p.add_argument("--refresh-sharp", action="store_true"); p.set_defaults(fn=cmd_history)
    p = sub.add_parser("snapshot"); p.set_defaults(fn=cmd_snapshot)
    p = sub.add_parser("upcoming"); p.add_argument("--days", type=int, default=7); p.add_argument("--max-requests", type=int, default=200); p.add_argument("--per-fixture", action="store_true")
    p.add_argument("--refresh-stale", type=float, metavar="HEURES", help="après le passage par tournoi, relève match par match les rencontres de la fenêtre sans relevé Winamax depuis HEURES heures (non décompté)")
    p.set_defaults(fn=cmd_upcoming)
    p = sub.add_parser("views"); p.set_defaults(fn=cmd_views)
    p = sub.add_parser("match"); p.set_defaults(fn=cmd_match)
    args = parser.parse_args(argv)
    RESEARCH.mkdir(parents=True, exist_ok=True)
    if args.cmd in ("fixtures", "history", "snapshot", "upcoming", "views", "match"):
        with archive_lock():
            return args.fn(args)
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(main())
