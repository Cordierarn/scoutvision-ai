"""
Construction du dataset point-in-time (étape 1 de la recherche prévision).

  python3 -m backtest.build                       # depuis scripts/ : Dataset A (PitchAPI), + B si des cotes sont présentes
  python3 -m backtest.build --odds-dir <dir>      # cotes football-data lues dans ce répertoire (aucun téléchargement)
  python3 -m backtest.build --download-odds       # téléchargement explicite dans le cache (CI ou poste avec réseau)

Sorties (ignorées par Git) dans .research/forecast/ :
  replay_pitchapi.parquet (+ .meta.json)   Dataset A
  replay_with_odds.parquet (+ .meta.json)  Dataset B quand des cotes ont été jointes
  manifest.json                            couverture, exclusions, hash des entrées, sémantique des cotes
  odds_unmatched.csv, odds_team_mapping.csv  appariement documenté (aucun match caché)
"""

from __future__ import annotations

import argparse
import json
import resource
import sys
import time
from pathlib import Path

import pandas as pd

from . import SCHEMA_VERSION, leakage, manifest, odds as odds_mod, replay

ROOT = Path(__file__).resolve().parents[2]
CACHE_DIR = ROOT / ".cache" / "pitchapi"
OUT_DIR = ROOT / ".research" / "forecast"
SEASONS = ["2021-22", "2022-23", "2023-24", "2024-25", "2025-26", "2026-27"]


def exclusions_from(match: pd.DataFrame, dataset: pd.DataFrame) -> pd.DataFrame:
    """Matchs lus mais absents du dataset, avec la raison."""
    kept = set(dataset["match_id"])
    m = match[~match["match_id"].isin(kept)].copy()
    m["reason"] = pd.Series(m["match_status"].map(lambda s: f"status_{s}"), index=m.index)
    m.loc[m["match_id"].duplicated(keep=False) & m["match_id"].isin(kept), "reason"] = "duplicate_match_id"
    return m[["competition", "season", "match_id", "reason"]]


def write_dataset(df: pd.DataFrame, path: Path, meta: dict) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    out = df.copy()
    for c in ("result_1x2",):
        out[c] = out[c].astype(object)
    out["over_2_5"] = out["over_2_5"].map(lambda v: None if v is None else bool(v)).astype(object)
    out.to_parquet(path, index=False)
    path.with_suffix(".meta.json").write_text(json.dumps(meta, indent=1), encoding="utf-8")
    return path.stat().st_size


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--cache-dir", type=Path, default=CACHE_DIR)
    parser.add_argument("--odds-dir", type=Path, default=CACHE_DIR / "football-data", help="répertoire des CSV football-data")
    parser.add_argument("--download-odds", action="store_true", help="télécharger les CSV football-data (jamais dans les tests)")
    parser.add_argument("--out", type=Path, default=OUT_DIR)
    parser.add_argument("--no-content-hash", action="store_true", help="hash des archives par nom et taille seulement")
    args = parser.parse_args()
    t0 = time.time()
    print("Lecture des tables match et team_match...", flush=True)
    match, team_match, archives = replay.read_tables(args.cache_dir)
    t_read = time.time() - t0
    print(f"  {len(match)} matchs, {len(archives)} archives ({t_read:.1f}s)", flush=True)
    t1 = time.time()
    dataset = replay.build_from_frames(match, team_match)
    t_build = time.time() - t1
    print(f"  dataset A : {len(dataset)} lignes ({t_build:.1f}s)", flush=True)
    errors = leakage.validate(dataset)
    if errors:
        print("Invariants violés :", *errors, sep="\n  ")
        return 1
    exclusions = exclusions_from(match, dataset)
    params = {"featureCutoffHours": replay.FEATURE_CUTOFF_HOURS, "congestionDays": replay.CONGESTION_DAYS,
              "standingsStage": replay.st.STANDINGS_STAGE, "seasons": SEASONS}
    meta = {"schemaVersion": SCHEMA_VERSION, "generatedAt": pd.Timestamp.now("UTC").isoformat(timespec="seconds")}

    odds_files: list[Path] = []
    unmatched = mapping_table = None
    with_odds = None
    if args.download_odds:
        print("Téléchargement football-data...", flush=True)
        odds_files = odds_mod.download(args.odds_dir, SEASONS)
    if args.odds_dir.exists():
        odds, odds_files = odds_mod.load_directory(args.odds_dir, SEASONS)
        if not odds.empty:
            t2 = time.time()
            mapping, mapping_table = odds_mod.map_teams(odds, dataset)
            with_odds, unmatched = odds_mod.join(dataset, odds, mapping)
            print(f"  dataset B : {int(with_odds['odds_has_snapshot_1x2'].sum())} lignes avec snapshot 1x2, "
                  f"{int(with_odds['odds_has_closing_1x2'].sum())} avec clôture, {len(unmatched)} lignes football-data non appariées "
                  f"({time.time() - t2:.1f}s)", flush=True)
            args.out.mkdir(parents=True, exist_ok=True)
            unmatched.to_csv(args.out / "odds_unmatched.csv", index=False)
            mapping_table.to_csv(args.out / "odds_team_mapping.csv", index=False)
    if with_odds is None:
        print("  dataset B : cotes football-data absentes de ce poste (jointure non disponible)", flush=True)

    final = with_odds if with_odds is not None else dataset
    man = manifest.build_manifest(final, exclusions, archives, odds_files, unmatched, mapping_table, params, ROOT,
                                  {"readSeconds": round(t_read, 1), "buildSeconds": round(t_build, 1)})
    meta.update({"inputHash": man["inputHash"], "logicalHash": man["logicalHash"]})
    size_a = write_dataset(dataset, args.out / "replay_pitchapi.parquet", meta)
    size_b = write_dataset(with_odds, args.out / "replay_with_odds.parquet", meta) if with_odds is not None else 0
    man["timings"].update({"totalSeconds": round(time.time() - t0, 1), "peakMemoryMb": round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024),
                           "parquetBytesA": size_a, "parquetBytesB": size_b})
    manifest.write_json(args.out / "manifest.json", man)
    s = man["summary"]
    print(f"Manifeste : {s['rows']} lignes, {s['excluded']} exclues, hash {man['inputHash'][:12]}…, "
          f"{man['timings']['totalSeconds']}s, pic mémoire {man['timings']['peakMemoryMb']} Mo, parquet A {size_a / 1e6:.1f} Mo")
    return 0


if __name__ == "__main__":
    sys.exit(main())
