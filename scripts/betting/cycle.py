"""
Cycle du Labo paris : créneaux planifiés, journal des passages et décision du passage complet selon l'état de
l'archive (et non selon l'heure, car GitHub retarde ou saute des créneaux planifiés).

  cd scripts
  python3 -m betting.cycle record --event schedule      journalise le passage ; signale les créneaux planifiés manqués
  python3 -m betting.cycle plan --stage fixtures        FIXTURES_FROM=AAAA-MM-JJ (fenêtre des rencontres à relire)
  python3 -m betting.cycle plan --stage history         HISTORY=1 si un match terminé n'a pas son historique complet

Fichier (hors Git, publié avec l'archive) : `.research/betting/cycle_log.json`.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
from pathlib import Path

import pandas as pd

from . import BOOKMAKER, COMPETITIONS, RESEARCH

# Créneaux planifiés (UTC, heure, minute) : identiques aux crons de betting-odds.yml (vérifié par un test), hors des heures
# rondes que GitHub encombre. Matin : résultats de la veille, règlement, historiques ; puis cotes et suggestions.
SLOTS = ((5, 37), (9, 13), (13, 41), (16, 47))
TOLERANCE = dt.timedelta(hours=2)        # retard observé de GitHub sur un créneau planifié : jusqu'à environ 50 minutes
SEASON_START = dt.date(2026, 7, 1)
STATUS_SCHEDULED = 0
LOG = RESEARCH / "cycle_log.json"
KEEP = 500


def slots_between(start: dt.datetime, end: dt.datetime) -> list[dt.datetime]:
    """Créneaux planifiés de l'intervalle [start, end]."""
    out, day = [], start.date()
    while day <= end.date():
        for h, m in SLOTS:
            s = dt.datetime(day.year, day.month, day.day, h, m, tzinfo=dt.timezone.utc)
            if start <= s <= end:
                out.append(s)
        day += dt.timedelta(days=1)
    return sorted(out)


def missed_slots(runs: list[dt.datetime], now: dt.datetime, tolerance: dt.timedelta = TOLERANCE) -> list[dt.datetime]:
    """Créneaux planifiés depuis le premier passage journalisé qu'aucun passage n'a servis (un passage sert un créneau
    s'il démarre dans [créneau, créneau + tolérance)). Le créneau en cours n'est jamais compté."""
    if not runs:
        return []
    every = sorted(runs + [now])
    out = []
    for s in slots_between(min(runs) - tolerance, now - tolerance):
        if not any(s <= r < s + tolerance for r in every):
            out.append(s)
    return out


def load_log(path: Path = LOG) -> dict:
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {"runs": [], "missed": []}


def record(event: str, now: dt.datetime, path: Path = LOG) -> dict:
    """Journalise le passage courant ; renvoie les créneaux manqués pas encore signalés."""
    log = load_log(path)
    runs = [dt.datetime.fromisoformat(r["at"]) for r in log["runs"]]
    known = set(log["missed"])
    missed = [s for s in missed_slots(runs, now) if s.isoformat() not in known]
    log["missed"] = (log["missed"] + [s.isoformat() for s in missed])[-KEEP:]
    log["runs"] = (log["runs"] + [{"at": now.isoformat(timespec="seconds"), "event": event}])[-KEEP:]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(log, ensure_ascii=False, indent=1), encoding="utf-8")
    return {"missed": missed}


def fixtures_from(fixtures: pd.DataFrame, now: pd.Timestamp, competitions_archived: int, competitions: int) -> dt.date:
    """Début de la fenêtre des rencontres à relire : la saison entière si l'archive de cotes ne couvre pas toutes les
    compétitions ; sinon la plus ancienne rencontre jouée (coup d'envoi passé de 3 h) dont le statut n'est pas encore
    final, au plus tard la veille."""
    now = pd.Timestamp(now)
    yesterday = (now - pd.Timedelta(days=1)).date()
    if fixtures.empty or competitions_archived < competitions:
        return SEASON_START
    stale = fixtures[(fixtures["status_id"] == STATUS_SCHEDULED) & (pd.to_datetime(fixtures["start_time"], utc=True) < now - pd.Timedelta(hours=3))]
    if stale.empty:
        return yesterday
    return min(pd.to_datetime(stale["start_time"], utc=True).min().date(), yesterday)


def history_needed(fixtures: pd.DataFrame, snaps: pd.DataFrame, fetched: dict, competitions) -> int:
    """1 si un match terminé n'a pas son historique Winamax complet jusqu'au coup d'envoi (`fetch.history_todo`)."""
    from .fetch import history_todo
    return int(not history_todo(fixtures, snaps, fetched, competitions).empty)


def _snapshot_index() -> pd.DataFrame:
    frames = [pd.read_parquet(p, columns=["fixture_id", "bookmaker", "created_at"]) for c in COMPETITIONS for p in sorted((RESEARCH / "odds" / c).glob("*.parquet"))]
    if not frames:
        return pd.DataFrame(columns=["fixture_id", "bookmaker", "created_at"])
    df = pd.concat(frames, ignore_index=True)
    return df[df["bookmaker"] == BOOKMAKER]


def main(argv=None) -> int:
    from .fetch import load_fixtures, load_history_fetched
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("record"); r.add_argument("--event", default="manuel")
    pl = sub.add_parser("plan"); pl.add_argument("--stage", choices=["fixtures", "history"], required=True)
    args = p.parse_args(argv)
    now = dt.datetime.now(dt.timezone.utc)
    if args.cmd == "record":
        out = record(args.event, now)
        for s in out["missed"]:
            print(f"::warning::créneau planifié manqué : {s:%Y-%m-%d %H:%M} UTC (aucun passage dans les {int(TOLERANCE.total_seconds() // 3600)} h suivantes)")
        summary = os.environ.get("GITHUB_STEP_SUMMARY")
        if summary and out["missed"]:
            with open(summary, "a", encoding="utf-8") as f:
                f.write("Créneaux planifiés manqués : " + ", ".join(f"{s:%Y-%m-%d %H:%M} UTC" for s in out["missed"]) + "\n\n")
        print(f"passage journalisé ({args.event}, {now:%Y-%m-%d %H:%M} UTC), {len(out['missed'])} créneau(x) manqué(s) depuis le précédent", file=sys.stderr)
        return 0
    fixtures = load_fixtures()
    if args.stage == "fixtures":
        archived = sum(1 for c in COMPETITIONS if any((RESEARCH / "odds" / c).glob("*.parquet")))
        start = fixtures_from(fixtures, pd.Timestamp(now), archived, len(COMPETITIONS))
        print(f"fenêtre des rencontres depuis le {start} ({archived}/{len(COMPETITIONS)} compétitions archivées)", file=sys.stderr)
        print(f"FIXTURES_FROM={start.isoformat()}")
    else:
        needed = history_needed(fixtures, _snapshot_index(), load_history_fetched(), COMPETITIONS)
        print(f"historiques complets à récupérer : {'oui' if needed else 'non'}", file=sys.stderr)
        print(f"HISTORY={needed}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
