"""
Manifeste de recherche : hash déterministe des entrées, couverture par compétition et saison,
exclusions, sémantique des cotes. Écrit hors public/data (dossier .research, ignoré par Git).
"""

from __future__ import annotations

import hashlib
import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

from . import SCHEMA_VERSION, replay
from .odds import field_metadata


def _file_digest(path: Path, content: bool) -> dict:
    d = {"name": path.name, "size": path.stat().st_size}
    if content:
        h = hashlib.sha256()
        with path.open("rb") as f:
            for chunk in iter(lambda: f.read(1 << 20), b""):
                h.update(chunk)
        d["sha256"] = h.hexdigest()
    return d


def code_version(root: Path) -> dict:
    """Commit Git si disponible, et hash du code du paquet backtest."""
    try:
        commit = subprocess.run(["git", "rev-parse", "HEAD"], cwd=root, capture_output=True, text=True, timeout=10).stdout.strip()
    except Exception:                               # noqa: BLE001
        commit = None
    h = hashlib.sha256()
    for p in sorted((root / "scripts" / "backtest").glob("*.py")):
        h.update(p.read_bytes())
    return {"gitCommit": commit or None, "backtestCodeSha256": h.hexdigest()}


def input_hash(archives: list[Path], odds_files: list[Path], params: dict, root: Path, content: bool = True) -> tuple[str, dict]:
    """Hash des entrées : archives PitchAPI (nom, taille, contenu), fichiers football-data, code, paramètres."""
    inputs = {
        "schemaVersion": SCHEMA_VERSION,
        "archives": [_file_digest(p, content) for p in sorted(archives)],
        "oddsFiles": [_file_digest(p, content) for p in sorted(odds_files)],
        "code": code_version(root),
        "params": params,
    }
    digest = hashlib.sha256(json.dumps(inputs, sort_keys=True).encode()).hexdigest()
    return digest, inputs


def logical_hash(df: pd.DataFrame) -> str:
    """Hash du contenu du dataset (ordre canonique, valeurs) : deux constructions identiques -> même hash."""
    canon = replay.canonical(df)
    return hashlib.sha256(pd.util.hash_pandas_object(canon.astype(str), index=False).to_numpy().tobytes()).hexdigest()


def _share(s: pd.Series) -> float | None:
    return round(float(s.mean()), 4) if len(s) else None


def coverage(df: pd.DataFrame, rows_all: pd.DataFrame, unmatched: pd.DataFrame | None, exclusions: pd.DataFrame) -> list[dict]:
    """Par compétition et saison : effectifs, dates, couvertures, cotes, exclusions, historique disponible."""
    out = []
    has_odds = "odds_semantics" in df
    first_kick = df.groupby("competition")["kickoff_utc"].min()
    for (comp, season), g in df.groupby(["competition", "season"], sort=True):
        excl = exclusions[(exclusions["competition"] == comp) & (exclusions["season"] == season)]
        before = df[(df["competition"] == comp) & (df["kickoff_utc"] < g["kickoff_utc"].min())]
        row = {
            "competition": comp, "season": season,
            "matchesTotal": int(len(g) + len(excl)), "matchesUsable": int(len(g)),
            "firstMatch": str(g["match_date"].min().date()), "lastMatch": str(g["match_date"].max().date()),
            "kickoffCoverage": _share(~g["kickoff_missing"]),
            "resultCoverage": _share(g["result_1x2"].notna()),
            "xgCoverage": _share(g["home_xg"].notna() & g["away_xg"].notna()),
            "advancedAnalyticsCoverage": _share(g["f_home_advanced_analytics_available"].dropna() == 1.0),
            "standingsCoverage": _share(g["standings_available"]),
            "rankingRulesApproximate": True,
            "historyBeforeFirstMatch": int(len(before)),
            "exclusions": excl["reason"].value_counts().to_dict() if len(excl) else {},
        }
        if has_odds:
            row.update({
                "oddsSnapshotCoverage1x2": _share(g["odds_has_snapshot_1x2"]),
                "oddsClosingCoverage1x2": _share(g["odds_has_closing_1x2"]),
                "oddsSnapshotCoverageOu25": _share(g["odds_has_snapshot_ou25"]),
                "oddsClosingCoverageOu25": _share(g["odds_has_closing_ou25"]),
                "unmatchedOddsRows": int(((unmatched["competition"] == comp) & (unmatched["odds_date"] >= g["match_date"].min())
                                         & (unmatched["odds_date"] <= g["match_date"].max())).sum()) if unmatched is not None and len(unmatched) else 0,
            })
        out.append(row)
    return out


def build_manifest(df: pd.DataFrame, exclusions: pd.DataFrame, archives: list[Path], odds_files: list[Path],
                   unmatched: pd.DataFrame | None, mapping_table: pd.DataFrame | None, params: dict, root: Path,
                   timings: dict) -> dict:
    digest, inputs = input_hash(archives, odds_files, params, root)
    has_odds = "odds_semantics" in df
    summary = {
        "rows": int(len(df)), "excluded": int(len(exclusions)),
        "competitions": int(df["competition"].nunique()), "seasons": sorted(df["season"].unique().tolist()),
        "firstMatch": str(df["match_date"].min().date()), "lastMatch": str(df["match_date"].max().date()),
        "kickoffCoverage": _share(~df["kickoff_missing"]), "xgCoverage": _share(df["home_xg"].notna() & df["away_xg"].notna()),
        "standingsCoverage": _share(df["standings_available"]),
        "advancedAnalyticsCoverageBySeason": {s: _share(g["f_home_advanced_analytics_available"].dropna() == 1.0)
                                             for s, g in df.groupby("season")},
        "featureMissingShare": {c: _share(df[c].isna()) for c in replay.feature_columns()},
    }
    if has_odds:
        summary["oddsSemanticsRows"] = {k: int(v) for k, v in df["odds_semantics"].value_counts().items()}
        summary["oddsSemanticsRows"].setdefault("unknown", 0)
        summary["oddsProviders"] = {c: {str(k): int(v) for k, v in df[c].value_counts().items()}
                                    for c in ("odds_snapshot_1x2_provider", "odds_closing_1x2_provider", "odds_snapshot_ou25_provider", "odds_closing_ou25_provider")}
        summary["unmatchedOddsRows"] = int(len(unmatched)) if unmatched is not None else 0
        summary["teamsMapped"] = int(len(mapping_table.drop_duplicates(["competition", "odds_name"]))) if mapping_table is not None and len(mapping_table) else 0
    else:
        summary["oddsSemanticsRows"] = {"available_snapshot": 0, "closing": 0, "unknown": 0, "none": int(len(df))}
        summary["oddsJoin"] = "not_available"
    return {
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "schemaVersion": SCHEMA_VERSION,
        "inputHash": digest,
        "logicalHash": logical_hash(df),
        "inputs": inputs,
        "params": params,
        "timings": timings,
        "summary": summary,
        "features": [spec.__dict__ for spec in replay.FEATURES],
        "columns": {"identity": replay.IDENTITY, "targets": replay.TARGETS, "features": replay.feature_columns(),
                    "quality": replay.QUALITY, "odds": [c for c in df.columns if c.startswith("odds_")]},
        "oddsFields": field_metadata(),
        "coverage": coverage(df, df, unmatched, exclusions),
        "exclusionReasons": exclusions["reason"].value_counts().to_dict() if len(exclusions) else {},
    }


def write_json(path: Path, data: dict) -> None:
    def default(v):
        if isinstance(v, (np.integer,)):
            return int(v)
        if isinstance(v, (np.floating,)):
            return None if not np.isfinite(v) else float(v)
        if isinstance(v, (pd.Timestamp,)):
            return v.isoformat()
        if isinstance(v, Path):
            return str(v)
        if isinstance(v, (np.bool_,)):
            return bool(v)
        raise TypeError(f"non sérialisable : {type(v)}")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=1, default=default), encoding="utf-8")
