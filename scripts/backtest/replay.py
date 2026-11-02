"""
MatchReplayRow : une ligne par match, le monde tel qu'il était avant le coup d'envoi.

Blocs de colonnes, jamais mélangés :
- IDENTITY : match_id, competition, season, match_date, kickoff_utc, équipes, stage, round_name ;
- TARGETS  : home_goals, away_goals, result_1x2, over_2_5, home_xg, away_xg (connus après le match) ;
- FEATURES : préfixe f_ (registre FEATURES), calculées sur les seuls matchs dont kickoff_utc < feature_cutoff ;
- ODDS     : préfixe odds_ (scripts/backtest/odds.py), snapshot et clôture séparés ;
- QUALITY  : feature_cutoff, flags.

Cutoff : feature_cutoff = kickoff_utc − FEATURE_CUTOFF_HOURS (convention de dataset). Un match qui débute
à la même heure qu'un autre n'entre jamais dans ses features. Sources V1 : tables PitchAPI match et
team_match seulement (buts, xG, coup d'envoi, stage) ; aucune composition, aucun agrégat de saison,
aucun indicateur courant (RAPM, valeurs).
"""

from __future__ import annotations

import io
import re
import tarfile
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pandas as pd

from . import SCHEMA_VERSION
from . import standings as st

FEATURE_CUTOFF_HOURS = 3           # décision supposée 3 h avant le coup d'envoi (avant les compositions)
CONGESTION_DAYS = 8
MATCH_COLUMNS = {"match_id", "match_status", "date", "time_utc", "round_name", "stage", "home_team_id", "home_team_name",
                 "away_team_id", "away_team_name", "score_home", "score_away"}
TEAM_MATCH_COLUMNS = {"match_id", "team_id", "is_home", "xg_for", "xg_against", "analytics_available"}
TABLES_ASSET = re.compile(r"^tables-(?P<comp>[A-Z0-9]+)-(?P<season>\d{4}(?:-\d{2})?)\.tar$")

IDENTITY = ["match_id", "competition", "season", "match_date", "kickoff_utc", "home_team_id", "away_team_id",
            "home_team_name", "away_team_name", "stage", "round_name"]
TARGETS = ["home_goals", "away_goals", "result_1x2", "over_2_5", "home_xg", "away_xg"]
QUALITY = ["feature_cutoff", "kickoff_missing", "ranking_rules_approximate", "standings_available",
           "missing_flags", "data_quality_flags"]
FORBIDDEN_SOURCES = ("team_season", "player_season", "rapm", "finishing", "market_value", "transfermarkt", "lineup")


@dataclass(frozen=True)
class FeatureSpec:
    name: str                      # nom sans le camp (préfixé f_home_ / f_away_ ou f_)
    description: str
    window: int | None             # matchs (None : pas de fenêtre)
    min_periods: int | None        # en dessous : valeur absente + flag insufficient_history
    source: str                    # tables d'origine
    missing_value: str = "null + flag"
    cutoff: str = "kickoff_utc < feature_cutoff"
    scope: str = "same competition, all seasons"
    per_side: bool = True


FEATURES: list[FeatureSpec] = [
    FeatureSpec("points_last5", "points sur les 5 derniers matchs de la compétition", 5, 3, "match"),
    FeatureSpec("xg_for_last5", "xG pour sur les 5 derniers matchs", 5, 3, "team_match.xg_for"),
    FeatureSpec("xg_against_last5", "xG contre sur les 5 derniers matchs", 5, 3, "team_match.xg_against"),
    FeatureSpec("xg_for_last10", "xG pour sur les 10 derniers matchs", 10, 5, "team_match.xg_for"),
    FeatureSpec("xg_against_last10", "xG contre sur les 10 derniers matchs", 10, 5, "team_match.xg_against"),
    FeatureSpec("goals_for_last5", "buts pour sur les 5 derniers matchs", 5, 3, "match.score"),
    FeatureSpec("goals_against_last5", "buts contre sur les 5 derniers matchs", 5, 3, "match.score"),
    FeatureSpec("matches_in_window", "matchs de la compétition réellement disponibles dans la fenêtre de 5", 5, None, "match"),
    FeatureSpec("rest_days", "jours depuis le match précédent (toutes compétitions des données)", None, 1, "match.time_utc",
                scope="all competitions"),
    FeatureSpec("matches_last8d", f"matchs lors des {CONGESTION_DAYS} derniers jours (toutes compétitions)", None, None,
                "match.time_utc", missing_value="0 (aucun match = 0 est exact)", scope="all competitions"),
    FeatureSpec("rank", "classement avant match (saison régulière, convention V1)", None, None, "standings",
                missing_value="null si pas de saison régulière", scope="competition-season"),
    FeatureSpec("points", "points avant match", None, None, "standings", scope="competition-season"),
    FeatureSpec("played", "matchs joués avant match", None, None, "standings", scope="competition-season"),
    FeatureSpec("goal_difference", "différence de buts avant match", None, None, "standings", scope="competition-season"),
    FeatureSpec("points_per_match", "points par match avant match", None, 1, "standings", scope="competition-season"),
    FeatureSpec("promoted", "équipe absente de la saison précédente de la compétition", None, None, "match",
                missing_value="null si la saison précédente n'est pas dans les données", scope="competition"),
    FeatureSpec("advanced_analytics_available", "indicateurs avancés PitchAPI disponibles pour l'équipe au match précédent "
                "(couverture seulement, aucune valeur importée)", None, None, "team_match.analytics_available", missing_value="null"),
    FeatureSpec("rank_gap", "classement domicile − classement extérieur", None, None, "standings", per_side=False,
                scope="competition-season"),
]


def feature_columns() -> list[str]:
    cols = []
    for f in FEATURES:
        cols += [f"f_home_{f.name}", f"f_away_{f.name}"] if f.per_side else [f"f_{f.name}"]
    return cols


# ============================================
# LECTURE DES TABLES (match et team_match seulement)
# ============================================

def cached_archives(cache_dir: Path) -> dict[tuple[str, str], Path]:
    """Archives tables-<COMP>-<saison>.tar du cache PitchAPI ; une saison close prime sur data-v2-current."""
    assets: dict[tuple[str, str], Path] = {}
    tags = sorted((d for d in cache_dir.iterdir() if d.is_dir() and d.name.startswith("data-v2-")),
                  key=lambda d: d.name == "data-v2-current")
    for tag in tags:
        for path in sorted(tag.glob("tables-*.tar")):
            m = TABLES_ASSET.match(path.name)
            if m and m.group("comp") != "ALL":
                assets.setdefault((m.group("comp"), m.group("season")), path)
    return assets


def app_season(raw: str) -> str:
    m = re.match(r"^(\d{4})(?:[/-](\d{2,4}))?$", str(raw).strip())
    if not m:
        raise ValueError(f"saison inconnue : {raw!r}")
    start = int(m.group(1))
    return f"{start}-{str(start + 1)[2:]}"


def read_tables(cache_dir: Path) -> tuple[pd.DataFrame, pd.DataFrame, list[Path]]:
    """Tables match et team_match de toutes les archives en cache (colonnes utiles seulement)."""
    import pyarrow.parquet as pq
    matches, team_matches, used = [], [], []
    for (comp, raw_season), path in sorted(cached_archives(cache_dir).items()):
        used.append(path)
        with tarfile.open(path) as tar:
            for member in tar.getmembers():
                table = member.name.split("/", 1)[0]
                wanted = MATCH_COLUMNS if table == "match" else TEAM_MATCH_COLUMNS if table == "team_match" else None
                if wanted is None or not member.name.endswith(".parquet"):
                    continue
                pf = pq.ParquetFile(io.BytesIO(tar.extractfile(member).read()))
                cols = [c for c in pf.schema_arrow.names if c in wanted]
                df = pf.read(columns=cols).to_pandas()
                df.insert(0, "competition", comp)
                df.insert(1, "season", app_season(raw_season))
                (matches if table == "match" else team_matches).append(df)
    return pd.concat(matches, ignore_index=True), pd.concat(team_matches, ignore_index=True), used


# ============================================
# LIGNES DE BASE : IDENTITÉ, CIBLES, CUTOFF
# ============================================

def base_rows(match: pd.DataFrame, team_match: pd.DataFrame) -> pd.DataFrame:
    """Identité, cibles et cutoff de chaque match terminé. Les xG du match sont des cibles (post-match)."""
    m = match[match["match_status"].isin(["finished", "awarded"])].copy()
    m = m.rename(columns={"score_home": "home_goals", "score_away": "away_goals"})
    m["match_date"] = pd.to_datetime(m["date"], format="mixed", utc=True).dt.tz_localize(None).dt.normalize()
    t = pd.to_datetime(m["time_utc"], errors="coerce", utc=True).dt.tz_localize(None) if "time_utc" in m else pd.Series(pd.NaT, index=m.index)
    m["kickoff_missing"] = t.isna()
    m["kickoff_utc"] = t.fillna(m["match_date"])
    m["feature_cutoff"] = m["kickoff_utc"] - pd.Timedelta(hours=FEATURE_CUTOFF_HOURS)
    for c in ("stage", "round_name"):
        if c not in m:
            m[c] = None
    xg = team_match[team_match["is_home"] == True][["match_id", "xg_for", "xg_against"]]
    m = m.merge(xg.rename(columns={"xg_for": "home_xg", "xg_against": "away_xg"}), on="match_id", how="left")
    hg, ag = m["home_goals"], m["away_goals"]
    m["result_1x2"] = np.where(hg.isna() | ag.isna(), None, np.where(hg > ag, "H", np.where(hg == ag, "D", "A")))
    m["over_2_5"] = np.where(hg.isna() | ag.isna(), None, (hg + ag) > 2.5)
    return m[IDENTITY + TARGETS + ["kickoff_missing", "feature_cutoff", "match_status"]].sort_values(["kickoff_utc", "match_id"], kind="stable").reset_index(drop=True)


# ============================================
# FEATURES GLISSANTES (kickoff < cutoff)
# ============================================

def _team_long(rows: pd.DataFrame, team_match: pd.DataFrame) -> pd.DataFrame:
    """Une ligne par équipe et par match : résultat du point de vue de l'équipe, xG, cutoff, coup d'envoi."""
    cols = ["match_id", "competition", "season", "kickoff_utc", "feature_cutoff", "stage"]
    gf = rows["home_goals"]; ga = rows["away_goals"]
    pts_h = np.where(gf > ga, 3, np.where(gf == ga, 1, 0)).astype(float)
    pts_a = np.where(ga > gf, 3, np.where(gf == ga, 1, 0)).astype(float)
    home = rows[cols].assign(team_id=rows["home_team_id"], is_home=True, pts=pts_h, gf=gf.astype(float), ga=ga.astype(float),
                             xg_for=rows["home_xg"], xg_against=rows["away_xg"])
    away = rows[cols].assign(team_id=rows["away_team_id"], is_home=False, pts=pts_a, gf=ga.astype(float), ga=gf.astype(float),
                             xg_for=rows["away_xg"], xg_against=rows["home_xg"])
    long = pd.concat([home, away], ignore_index=True)
    av = team_match[["match_id", "team_id", "analytics_available"]].drop_duplicates(["match_id", "team_id"])
    long = long.merge(av, on=["match_id", "team_id"], how="left")
    return long.sort_values(["team_id", "competition", "kickoff_utc", "match_id"], kind="stable").reset_index(drop=True)


def _window_sum(values: np.ndarray, eligible: np.ndarray, window: int) -> tuple[np.ndarray, np.ndarray]:
    """Somme des `window` dernières valeurs parmi les `eligible[i]` premières lignes du groupe (NaN ignorés),
    et nombre de valeurs réellement disponibles."""
    v = np.nan_to_num(values, nan=0.0)
    present = (~np.isnan(values)).astype(float)
    cs = np.concatenate([[0.0], np.cumsum(v)])
    cp = np.concatenate([[0.0], np.cumsum(present)])
    lo = np.maximum(eligible - window, 0)
    return cs[eligible] - cs[lo], cp[eligible] - cp[lo]


def rolling_features(rows: pd.DataFrame, team_match: pd.DataFrame) -> pd.DataFrame:
    """Features glissantes par équipe, dans la même compétition (toutes saisons), sur les matchs dont le
    coup d'envoi est antérieur au cutoff du match courant ; repos et congestion toutes compétitions."""
    long = _team_long(rows, team_match)
    out = {c: np.full(len(long), np.nan) for c in ("points_last5", "xg_for_last5", "xg_against_last5", "xg_for_last10",
                                                     "xg_against_last10", "goals_for_last5", "goals_against_last5",
                                                     "matches_in_window", "advanced_analytics_available")}
    for _, idx in long.groupby(["team_id", "competition"], sort=False).indices.items():
        g = long.iloc[idx]
        kick = g["kickoff_utc"].to_numpy()
        cut = g["feature_cutoff"].to_numpy()
        eligible = np.searchsorted(kick, cut, side="left")        # matchs antérieurs : kickoff < cutoff
        for name, col, w in (("points_last5", "pts", 5), ("xg_for_last5", "xg_for", 5), ("xg_against_last5", "xg_against", 5),
                             ("xg_for_last10", "xg_for", 10), ("xg_against_last10", "xg_against", 10),
                             ("goals_for_last5", "gf", 5), ("goals_against_last5", "ga", 5)):
            s, n = _window_sum(g[col].to_numpy(float), eligible, w)
            spec = next(f for f in FEATURES if f.name == name)
            out[name][idx] = np.where(n >= spec.min_periods, s, np.nan)
        _, n5 = _window_sum(g["pts"].to_numpy(float), eligible, 5)
        out["matches_in_window"][idx] = n5
        av = g["analytics_available"].map({True: 1.0, False: 0.0}).to_numpy(float)
        prev = eligible - 1
        out["advanced_analytics_available"][idx] = np.where(prev >= 0, av[np.maximum(prev, 0)], np.nan)
    feats = pd.DataFrame(out)
    # repos et congestion : toutes compétitions
    rest = np.full(len(long), np.nan); cong = np.zeros(len(long))
    order = long.sort_values(["team_id", "kickoff_utc", "match_id"], kind="stable").index.to_numpy()
    for _, idx in long.loc[order].groupby("team_id", sort=False).indices.items():
        ids = order[idx]
        kick = long["kickoff_utc"].to_numpy()[ids]
        cut = long["feature_cutoff"].to_numpy()[ids]
        eligible = np.searchsorted(kick, cut, side="left")
        prev = eligible - 1
        rest[ids] = np.where(prev >= 0, (cut - kick[np.maximum(prev, 0)]) / np.timedelta64(1, "D") + FEATURE_CUTOFF_HOURS / 24, np.nan)
        start = np.searchsorted(kick, cut - np.timedelta64(CONGESTION_DAYS, "D"), side="left")
        cong[ids] = eligible - start
    feats["rest_days"] = rest
    feats["matches_last8d"] = cong
    feats["match_id"] = long["match_id"].to_numpy()
    feats["team_id"] = long["team_id"].to_numpy()
    feats["is_home"] = long["is_home"].to_numpy()
    return feats


def standings_features(rows: pd.DataFrame) -> pd.DataFrame:
    """Classement avant match par compétition-saison (standings.incremental)."""
    parts = []
    for (comp, season), g in rows.groupby(["competition", "season"], sort=False):
        if (g["stage"] == st.STANDINGS_STAGE).any():
            s = st.incremental(g[["match_id", "kickoff_utc", "feature_cutoff", "home_team_id", "away_team_id", "home_goals", "away_goals", "stage"]])
            parts.append(s)
    if not parts:
        return pd.DataFrame(columns=["match_id", "team_id"] + st.COLUMNS)
    return pd.concat(parts, ignore_index=True)


def promoted_flags(rows: pd.DataFrame) -> pd.DataFrame:
    """Équipe absente de la saison précédente de la même compétition ; null si cette saison n'est pas dans les données."""
    seasons = rows.groupby("competition")["season"].apply(lambda s: sorted(set(s))).to_dict()
    members = rows.groupby(["competition", "season"]).apply(lambda g: set(g["home_team_id"]) | set(g["away_team_id"]), include_groups=False).to_dict()
    out = {}
    for (comp, season), teams in members.items():
        prev = [s for s in seasons[comp] if s < season]
        prev_members = members.get((comp, prev[-1])) if prev else None
        for t in teams:
            out[(comp, season, t)] = None if prev_members is None else (t not in prev_members)
    return out


def assemble(rows: pd.DataFrame, team_match: pd.DataFrame) -> pd.DataFrame:
    """Dataset A : identité, cibles, features, qualité (sans cotes)."""
    feats = rolling_features(rows, team_match)
    stand = standings_features(rows)
    promoted = promoted_flags(rows)
    df = rows.copy()
    for side, is_home in (("home", True), ("away", False)):
        f = feats[feats["is_home"] == is_home].set_index("match_id")
        for name in ("points_last5", "xg_for_last5", "xg_against_last5", "xg_for_last10", "xg_against_last10", "goals_for_last5",
                     "goals_against_last5", "matches_in_window", "rest_days", "matches_last8d", "advanced_analytics_available"):
            df[f"f_{side}_{name}"] = df["match_id"].map(f[name])
        key = pd.MultiIndex.from_arrays([df["match_id"], df[f"{side}_team_id"]])
        s = stand.set_index(["match_id", "team_id"])
        for name in ("rank", "points", "played", "goal_difference"):
            df[f"f_{side}_{name}"] = s[name].reindex(key).to_numpy()
        played = df[f"f_{side}_played"]
        df[f"f_{side}_points_per_match"] = np.where(played > 0, df[f"f_{side}_points"] / played.replace(0, np.nan), np.nan)
        df[f"f_{side}_promoted"] = [promoted.get((c, s_, t)) for c, s_, t in zip(df["competition"], df["season"], df[f"{side}_team_id"])]
    df["f_rank_gap"] = df["f_home_rank"] - df["f_away_rank"]
    df["standings_available"] = df["f_home_rank"].notna()
    df["ranking_rules_approximate"] = True
    df["missing_flags"] = _missing_flags(df)
    df["data_quality_flags"] = _quality_flags(df)
    cols = IDENTITY + TARGETS + feature_columns() + QUALITY
    return df[cols].sort_values(["kickoff_utc", "match_id"], kind="stable").reset_index(drop=True)


def _missing_flags(df: pd.DataFrame) -> pd.Series:
    flags = []
    cols = [c for c in feature_columns() if c not in ("f_home_promoted", "f_away_promoted")]
    for row in df[cols].isna().itertuples(index=False):
        flags.append(";".join(c[2:] for c, miss in zip(cols, row) if miss))
    return pd.Series(flags, index=df.index)


def _quality_flags(df: pd.DataFrame) -> pd.Series:
    flags = []
    for r in df.itertuples(index=False):
        f = []
        if r.kickoff_missing:
            f.append("kickoff_missing")
        if r.match_status == "awarded":
            f.append("awarded")
        if r.result_1x2 is None:
            f.append("no_result")
        if pd.isna(r.home_xg) or pd.isna(r.away_xg):
            f.append("no_xg")
        if not r.standings_available:
            f.append("no_standings")
        if r.stage != st.STANDINGS_STAGE:
            f.append(f"stage_{r.stage}")
        flags.append(";".join(f))
    return pd.Series(flags, index=df.index)


def canonical(df: pd.DataFrame) -> pd.DataFrame:
    """Ordre canonique : coup d'envoi puis identifiant."""
    return df.sort_values(["kickoff_utc", "match_id"], kind="stable").reset_index(drop=True)


@dataclass
class BuildResult:
    dataset: pd.DataFrame
    archives: list[Path] = field(default_factory=list)
    timings: dict = field(default_factory=dict)


def build_from_frames(match: pd.DataFrame, team_match: pd.DataFrame) -> pd.DataFrame:
    rows = base_rows(match, team_match)
    return assemble(rows, team_match)


def build(cache_dir: Path) -> BuildResult:
    import time
    t0 = time.time()
    match, team_match, used = read_tables(cache_dir)
    t_read = time.time() - t0
    t1 = time.time()
    dataset = build_from_frames(match, team_match)
    return BuildResult(dataset, used, {"readSeconds": round(t_read, 1), "buildSeconds": round(time.time() - t1, 1),
                                       "matchesRead": int(len(match))})
