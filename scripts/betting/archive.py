"""
Archive horodatée des cotes Winamax (phase 1).

Schéma d'un relevé (`snapshots`) : fixture_id, bookmaker, market_id, outcome_id, player_id (None hors
marchés joueurs), created_at (UTC), price, limit, active, source (`historical` ou `live`).
L'écriture est idempotente : réécrire la même réponse ne crée aucun doublon.

Vues dérivées par (fixture, bookmaker, marché, issue, joueur) : premier relevé, H−24, H−1 et dernier
relevé strictement antérieur au coup d'envoi. Un relevé postérieur au coup d'envoi n'est jamais retenu ;
sans relevé dans la fenêtre, la vue vaut null (jamais une cote inventée).

Archive publiée d'un passage du cycle au suivant (`betting-odds.tar.gz`, liste `PUBLISHED`, dont `phase2/`) :
  cd scripts && python3 -m betting.archive pack ../betting-odds.tar.gz | restore ../betting-odds.tar.gz
"""

from __future__ import annotations

import argparse
import datetime as dt
import fnmatch
import os
import sys
import tarfile
from pathlib import Path

import numpy as np
import pandas as pd

from . import RESEARCH

SNAPSHOT_KEY = ["fixture_id", "bookmaker", "market_id", "outcome_id", "player_id", "created_at"]
SNAPSHOT_COLUMNS = SNAPSHOT_KEY + ["price", "limit", "active", "source"]
FIXTURE_COLUMNS = ["fixture_id", "tournament_id", "competition", "season", "start_time", "status_id", "home_name", "away_name", "has_odds"]
VIEWS = {"first": None, "h24": dt.timedelta(hours=24), "h1": dt.timedelta(hours=1), "last": dt.timedelta(0)}


def _utc(series: pd.Series) -> pd.Series:
    return pd.to_datetime(series, utc=True, format="ISO8601")


def flatten_historical(payload: dict, source: str = "historical") -> pd.DataFrame:
    """Aplatit `bookmakers → markets → outcomes → players → relevés` en lignes triées par date UTC."""
    rows = []
    fixture_id = payload.get("fixtureId")
    for bookmaker, bk in (payload.get("bookmakers") or {}).items():
        for market_id, market in (bk.get("markets") or {}).items():
            for outcome_id, outcome in (market.get("outcomes") or {}).items():
                for player_id, snaps in (outcome.get("players") or {}).items():
                    for s in snaps or []:
                        rows.append((fixture_id, bookmaker, int(market_id), int(outcome_id), None if str(player_id) == "0" else str(player_id),
                                     s["createdAt"], float(s["price"]), s.get("limit"), bool(s.get("active", True)), source))
    df = pd.DataFrame(rows, columns=SNAPSHOT_COLUMNS)
    if not df.empty:
        df["created_at"] = _utc(df["created_at"])
        df["limit"] = pd.to_numeric(df["limit"], errors="coerce")
        df = df.sort_values(SNAPSHOT_KEY).reset_index(drop=True)
    return df


def flatten_live(fixture: dict, observed_at: dt.datetime | None = None, stamp: str = "changed") -> pd.DataFrame:
    """Aplatit une rencontre de `/odds-by-tournaments` (cotes courantes) dans le même schéma. La date du relevé
    est `changedAt` (dernier changement de prix chez le bookmaker) ou, avec `stamp="observed"`, l'heure de
    l'appel : le prix est alors attesté à cet instant, comme un relevé de `/historical-odds`."""
    rows = []
    for bookmaker, bk in (fixture.get("bookmakerOdds") or {}).items():
        for market_id, market in (bk.get("markets") or {}).items():
            for outcome_id, outcome in (market.get("outcomes") or {}).items():
                for player_id, o in (outcome.get("players") or {}).items():
                    if o.get("price") is None:
                        continue
                    at = observed_at.isoformat() if stamp == "observed" and observed_at else o.get("changedAt") or (observed_at.isoformat() if observed_at else None)
                    if at is None:
                        continue
                    rows.append((fixture["fixtureId"], bookmaker, int(market_id), int(outcome_id), None if str(player_id) == "0" else str(player_id),
                                 at, float(o["price"]), o.get("limit"), bool(o.get("active", True)), "live"))
    df = pd.DataFrame(rows, columns=SNAPSHOT_COLUMNS)
    if not df.empty:
        df["created_at"] = _utc(df["created_at"])
        df["limit"] = pd.to_numeric(df["limit"], errors="coerce")
        df = df.sort_values(SNAPSHOT_KEY).reset_index(drop=True)
    return df


def fixture_rows(fixtures: list[dict], competition_of: dict[int, str], season: str) -> pd.DataFrame:
    rows = [{"fixture_id": f["fixtureId"], "tournament_id": int(f["tournamentId"]), "competition": competition_of[int(f["tournamentId"])],
             "season": season, "start_time": f["startTime"], "status_id": f.get("statusId"), "home_name": f.get("participant1Name"),
             "away_name": f.get("participant2Name"), "has_odds": bool(f.get("hasOdds"))}
            for f in fixtures if int(f["tournamentId"]) in competition_of]
    df = pd.DataFrame(rows, columns=FIXTURE_COLUMNS)
    if not df.empty:
        df["start_time"] = _utc(df["start_time"])
    return df


def merge_unique(existing: pd.DataFrame | None, new: pd.DataFrame, key: list[str]) -> pd.DataFrame:
    frames = [f for f in (existing, new) if f is not None and not f.empty]
    if not frames:
        return new.iloc[0:0].copy()
    df = pd.concat(frames, ignore_index=True)
    df = df.drop_duplicates(subset=key, keep="last").sort_values(key).reset_index(drop=True)
    return df


def atomic_to_parquet(df: pd.DataFrame, path: Path) -> None:
    """Écriture atomique (fichier temporaire puis renommage) : un lecteur ne voit jamais un fichier partiel."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    df.to_parquet(tmp, index=False)
    os.replace(tmp, path)


def write_snapshots(new: pd.DataFrame, path: Path) -> int:
    """Fusionne `new` dans le parquet `path` sans doublon ; renvoie le nombre de relevés ajoutés."""
    existing = pd.read_parquet(path) if path.exists() else None
    before = 0 if existing is None else len(existing)
    merged = merge_unique(existing, new, SNAPSHOT_KEY)
    merged["player_id"] = merged["player_id"].astype(object).where(merged["player_id"].notna(), None)
    atomic_to_parquet(merged, path)
    return len(merged) - before


def write_fixtures(new: pd.DataFrame, path: Path = RESEARCH / "fixtures.parquet") -> pd.DataFrame:
    """Fusion par identifiant ; une valeur absente dans la nouvelle ligne (noms d'équipes manquants dans
    `/odds-by-tournaments`) ne remplace jamais une valeur connue."""
    existing = pd.read_parquet(path) if path.exists() else None
    frames = [f for f in (existing, new) if f is not None and not f.empty]
    if not frames:
        merged = new.iloc[0:0].copy()
    else:
        merged = pd.concat(frames, ignore_index=True).groupby("fixture_id", as_index=False, sort=True).last()[FIXTURE_COLUMNS]
    atomic_to_parquet(merged, path)
    return merged


def derived_views(snapshots: pd.DataFrame, fixtures: pd.DataFrame) -> pd.DataFrame:
    """Une ligne par (fixture, bookmaker, marché, issue, joueur) : first / h24 / h1 / last (prix et dates).

    `h24` = dernier relevé strictement antérieur à coup d'envoi − 24 h ; `h1` idem − 1 h ; `last` = dernier
    relevé strictement antérieur au coup d'envoi ; `first` = premier relevé avant le coup d'envoi. Les relevés
    postérieurs au coup d'envoi sont ignorés. Null quand aucun relevé ne précède la borne.
    """
    group = ["fixture_id", "bookmaker", "market_id", "outcome_id", "player_id"]
    cols = group + [f"{v}_{k}" for v in VIEWS for k in ("price", "at")] + ["n_pre_kickoff", "kickoff"]
    if snapshots.empty:
        return pd.DataFrame(columns=cols)
    ko = fixtures.set_index("fixture_id")["start_time"]
    df = snapshots.merge(ko.rename("kickoff"), left_on="fixture_id", right_index=True, how="inner")
    df = df[df["created_at"] < df["kickoff"]].sort_values(group + ["created_at"])
    if df.empty:
        return pd.DataFrame(columns=cols)
    out = df.groupby(group, dropna=False).agg(first_price=("price", "first"), first_at=("created_at", "first"),
                                              n_pre_kickoff=("price", "size"), kickoff=("kickoff", "first"))
    for name, delta in VIEWS.items():
        if name == "first":
            continue
        sub = df[df["created_at"] < df["kickoff"] - delta]
        last = sub.groupby(group, dropna=False).agg(**{f"{name}_price": ("price", "last"), f"{name}_at": ("created_at", "last")})
        out = out.join(last, how="left")
    out = out.reset_index()
    for name in VIEWS:
        out[f"{name}_price"] = out[f"{name}_price"].astype(float).where(out[f"{name}_price"].notna(), np.nan)
    return out[cols]


def season_of(start_time: pd.Timestamp) -> str:
    """Saison européenne d'une date : juillet → juin."""
    y = start_time.year if start_time.month >= 7 else start_time.year - 1
    return f"{y}-{str(y + 1)[-2:]}"


# ----- archive publiée (`betting-odds.tar.gz`, release privée du dépôt de données) -----

# Entrées de `.research/betting` publiées d'un passage du cycle au suivant ; une entrée absente est sautée.
# `phase2` porte le rapport de la porte (`gate.json`, dont la catégorie A reprise quand le dataset de la recherche manque)
# et `pool_weights.json` ; ses tables de lignes (`*_rows.parquet`, recherche, fournies par l'amorce) n'y sont pas.
PUBLISHED = ("odds", "views", "journal", "product", "phase2", "fixtures.parquet", "matches.parquet", "match_failures.parquet",
             "aliases.json", "aliases_theoddsapi.json", "history_fetched.json", "cycle_log.json", "quota.json", "quota_theoddsapi.json",
             "results_web.parquet", "markets_catalogue.json")
UNPUBLISHED = ("phase2/*_rows.parquet",)


def pack(dest: Path, root: Path = RESEARCH) -> list[str]:
    """Archive gzip des entrées publiées de `root` (chemins relatifs à `root`) ; renvoie les entrées présentes."""
    present = [name for name in PUBLISHED if (root / name).exists()]
    skip = lambda info: None if any(fnmatch.fnmatch(info.name, pat) for pat in UNPUBLISHED) else info
    dest.parent.mkdir(parents=True, exist_ok=True)
    with tarfile.open(dest, "w:gz") as tar:
        for name in present:
            tar.add(root / name, arcname=name, filter=skip)
    return present


def restore(src: Path, root: Path = RESEARCH) -> list[str]:
    """Extrait l'archive publiée dans `root` (filtre « data » : ni chemin absolu, ni sortie de `root`, ni lien) ; renvoie
    les entrées de premier niveau restaurées."""
    root.mkdir(parents=True, exist_ok=True)
    with tarfile.open(src, "r:gz") as tar:
        names = sorted({m.name.split("/")[0] for m in tar.getmembers()})
        tar.extractall(root, filter="data")
    return names


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Archive publiée du Labo paris (betting-odds.tar.gz).")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("pack", help="construit l'archive depuis .research/betting").add_argument("dest", type=Path)
    sub.add_parser("restore", help="restaure l'archive dans .research/betting").add_argument("src", type=Path)
    args = parser.parse_args(argv)
    if args.command == "pack":
        names = pack(args.dest)
        size = f"{args.dest.stat().st_size / 1e6:.1f}".replace(".", ",")
        print(f"{args.dest.name} : {len(names)} entrée(s), {size} Mo ({', '.join(names)})")
    else:
        names = restore(args.src)
        print(f"archive restaurée : {', '.join(names) or 'vide'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
