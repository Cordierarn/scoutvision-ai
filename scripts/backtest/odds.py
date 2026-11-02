"""
Adaptateur football-data.co.uk : fichiers principaux (mmz4281/<saison>/<DIV>.csv) et fichiers « new »
(new/<CODE>.csv), colonnes variables selon la saison, encodages historiques, équipes renommées.

Sémantique des cotes : les prix non-clôture sont des « available odds snapshot » (collecte
football-data, non horodatée ; ni ouverture ni H−24 : snapshot_type = available_snapshot), les colonnes
suffixées C sont la clôture (closing). Chaque champ importé porte source_column, source_provider et
snapshot_type (ODDS_FIELDS). Aucun téléchargement ici ; entrées : un répertoire local, le cache
`.cache/pitchapi/football-data` de prepare_data, ou des fixtures synthétiques.

Pas de de-vig ni d'évaluation dans ce module : seules les cotes brutes sont jointes au dataset.
"""

from __future__ import annotations

import io
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd

# Compétitions ScoutVision -> fichiers football-data (identiques à scripts/market.py)
MAIN_LEAGUES = {"ENG": "E0", "ENG2": "E1", "SCO": "SC0", "GER": "D1", "GER2": "D2", "ITA": "I1", "ITA2": "I2",
                "ESP": "SP1", "ESP2": "SP2", "FRA": "F1", "FRA2": "F2", "NED": "N1", "BEL": "B1", "POR": "P1",
                "TUR": "T1", "GRE": "G1"}
EXTRA_LEAGUES = {"ARG": "ARG", "AUT": "AUT", "BRA": "BRA", "DEN": "DNK", "JPN": "JPN", "MEX": "MEX", "NOR": "NOR",
                 "POL": "POL", "SWE": "SWE", "SUI": "SWZ", "USA": "USA"}
BASE_URL = "https://www.football-data.co.uk"

SNAPSHOT, CLOSING, UNKNOWN = "available_snapshot", "closing", "unknown"


@dataclass(frozen=True)
class OddsField:
    column: str            # colonne du dataset
    market: str            # 1x2 | ou25
    outcome: str           # home | draw | away | over | under
    snapshot_type: str     # available_snapshot | closing
    candidates: tuple[tuple[str, str], ...]   # (colonne football-data, fournisseur), premier complet retenu


def _one_x_two(prefix: str, provider: str, snap: str, suffixes=("H", "D", "A")) -> list[tuple[str, str, str]]:
    return [(f"{prefix}{s}", provider, snap) for s in suffixes]


# Priorité des fournisseurs : moyenne du marché, puis Pinnacle, puis Bet365 (snapshot) ;
# Pinnacle clôture, moyenne clôture, Betfair Exchange clôture (cote brute, avant commission).
SNAPSHOT_1X2 = (("Avg", "market_average"), ("PS", "pinnacle"), ("P", "pinnacle"), ("B365", "bet365"))
CLOSING_1X2 = (("PSC", "pinnacle"), ("PC", "pinnacle"), ("AvgC", "market_average"), ("BFEC", "betfair_exchange"))
SNAPSHOT_OU = (("Avg", "market_average"), ("P", "pinnacle"), ("B365", "bet365"))
CLOSING_OU = (("PC", "pinnacle"), ("AvgC", "market_average"), ("BFEC", "betfair_exchange"))

ODDS_FIELDS: list[OddsField] = (
    [OddsField(f"odds_snapshot_1x2_{o}", "1x2", o, SNAPSHOT, tuple((f"{p}{s}", prov) for p, prov in SNAPSHOT_1X2))
     for o, s in (("home", "H"), ("draw", "D"), ("away", "A"))]
    + [OddsField(f"odds_closing_1x2_{o}", "1x2", o, CLOSING, tuple((f"{p}{s}", prov) for p, prov in CLOSING_1X2))
       for o, s in (("home", "H"), ("draw", "D"), ("away", "A"))]
    + [OddsField(f"odds_snapshot_ou25_{o}", "ou25", o, SNAPSHOT, tuple((f"{p}{s}", prov) for p, prov in SNAPSHOT_OU))
       for o, s in (("over", ">2.5"), ("under", "<2.5"))]
    + [OddsField(f"odds_closing_ou25_{o}", "ou25", o, CLOSING, tuple((f"{p}{s}", prov) for p, prov in CLOSING_OU))
       for o, s in (("over", ">2.5"), ("under", "<2.5"))]
)
ODDS_COLUMNS = [f.column for f in ODDS_FIELDS]
PROVIDER_COLUMNS = ["odds_snapshot_1x2_provider", "odds_closing_1x2_provider", "odds_snapshot_ou25_provider", "odds_closing_ou25_provider"]
CLOSING_COLUMNS = [f.column for f in ODDS_FIELDS if f.snapshot_type == CLOSING] + ["odds_closing_1x2_provider", "odds_closing_ou25_provider"]


def field_metadata() -> list[dict]:
    """Sémantique exportée dans le manifeste : colonne, marché, issue, type de snapshot, colonnes sources."""
    return [{"column": f.column, "market": f.market, "outcome": f.outcome, "snapshot_type": f.snapshot_type,
             "source_columns": [{"source_column": c, "source_provider": p} for c, p in f.candidates]} for f in ODDS_FIELDS]


# ============================================
# LECTURE
# ============================================

def read_csv(path: Path) -> pd.DataFrame:
    """CSV football-data : encodage utf-8 (BOM) ou latin-1 selon la saison, lignes vides ignorées."""
    raw = path.read_bytes()
    for enc in ("utf-8-sig", "latin-1"):
        try:
            text = raw.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    df = pd.read_csv(io.StringIO(text), on_bad_lines="skip", low_memory=False)
    return df.dropna(how="all")


def _num(df: pd.DataFrame, col: str) -> pd.Series:
    return pd.to_numeric(df[col], errors="coerce") if col in df else pd.Series(np.nan, index=df.index)


def _pick(df: pd.DataFrame, group: tuple[tuple[str, str], ...], suffixes: tuple[str, ...]) -> tuple[np.ndarray, np.ndarray]:
    """Première série de cotes complète parmi les fournisseurs candidats ; fournisseur retenu par ligne."""
    out = np.full((len(df), len(suffixes)), np.nan)
    provider = np.full(len(df), None, dtype=object)
    for prefix, prov in group:
        cand = np.column_stack([_num(df, f"{prefix}{s}") for s in suffixes])
        fill = np.isnan(out).any(axis=1) & ~np.isnan(cand).any(axis=1) & (cand > 1).all(axis=1)
        out[fill] = cand[fill]
        provider[fill] = prov
    return out, provider


def normalize(df: pd.DataFrame, competition: str, kind: str, source_file: str) -> pd.DataFrame:
    """Un match football-data par ligne, au format commun ; kind = main | new."""
    home, away, hg, ag = ("HomeTeam", "AwayTeam", "FTHG", "FTAG") if kind == "main" else ("Home", "Away", "HG", "AG")
    if home not in df or away not in df:
        return pd.DataFrame()
    s1, p1 = _pick(df, SNAPSHOT_1X2, ("H", "D", "A"))
    c1, pc1 = _pick(df, CLOSING_1X2, ("H", "D", "A"))
    so, po = _pick(df, SNAPSHOT_OU, (">2.5", "<2.5"))
    co, pco = _pick(df, CLOSING_OU, (">2.5", "<2.5"))
    out = pd.DataFrame({
        "competition": competition,
        "odds_date": pd.to_datetime(df["Date"], dayfirst=True, errors="coerce"),
        "odds_time": df["Time"].astype(str) if "Time" in df else None,
        "odds_home_name": df[home].astype(str).str.strip(), "odds_away_name": df[away].astype(str).str.strip(),
        "odds_home_goals": _num(df, hg), "odds_away_goals": _num(df, ag),
        "odds_snapshot_1x2_home": s1[:, 0], "odds_snapshot_1x2_draw": s1[:, 1], "odds_snapshot_1x2_away": s1[:, 2],
        "odds_snapshot_1x2_provider": p1,
        "odds_closing_1x2_home": c1[:, 0], "odds_closing_1x2_draw": c1[:, 1], "odds_closing_1x2_away": c1[:, 2],
        "odds_closing_1x2_provider": pc1,
        "odds_snapshot_ou25_over": so[:, 0], "odds_snapshot_ou25_under": so[:, 1], "odds_snapshot_ou25_provider": po,
        "odds_closing_ou25_over": co[:, 0], "odds_closing_ou25_under": co[:, 1], "odds_closing_ou25_provider": pco,
        "odds_source_file": source_file,
    })
    return out.dropna(subset=["odds_date", "odds_home_goals", "odds_away_goals"]).reset_index(drop=True)


def season_code(app_season: str) -> str:
    """'2024-25' -> '2425'."""
    start = int(app_season[:4])
    return f"{start % 100:02d}{(start + 1) % 100:02d}"


def load_directory(directory: Path, seasons: list[str]) -> tuple[pd.DataFrame, list[Path]]:
    """Fichiers déjà présents dans `directory` : <code>_<DIV>.csv (principaux, nommage de market.py) et
    new_<CODE>.csv ; les fichiers absents sont ignorés et listés dans le manifeste."""
    frames, used = [], []
    for comp, div in MAIN_LEAGUES.items():
        for season in seasons:
            path = directory / f"{season_code(season)}_{div}.csv"
            if path.exists():
                frames.append(normalize(read_csv(path), comp, "main", path.name)); used.append(path)
    for comp, code in EXTRA_LEAGUES.items():
        path = directory / f"new_{code}.csv"
        if path.exists():
            frames.append(normalize(read_csv(path), comp, "new", path.name)); used.append(path)
    frames = [f for f in frames if not f.empty]
    return (pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()), used


def download(directory: Path, seasons: list[str]) -> list[Path]:
    """Téléchargement explicite (jamais dans les tests) : CI GitHub ou commande locale documentée."""
    import market                                   # scripts/market.py : fetch_csv avec cache
    paths = []
    for comp, div in MAIN_LEAGUES.items():
        for season in seasons:
            code = season_code(season)
            try:
                market.fetch_csv(f"{BASE_URL}/mmz4281/{code}/{div}.csv", directory / f"{code}_{div}.csv", 24 * 30)
                paths.append(directory / f"{code}_{div}.csv")
            except Exception as e:                  # noqa: BLE001 - une saison manquante n'arrête pas le reste
                print(f"  football-data {comp} {code} : {e}")
    for comp, code in EXTRA_LEAGUES.items():
        try:
            market.fetch_csv(f"{BASE_URL}/new/{code}.csv", directory / f"new_{code}.csv", 12)
            paths.append(directory / f"new_{code}.csv")
        except Exception as e:                      # noqa: BLE001
            print(f"  football-data {comp} : {e}")
    return paths


# ============================================
# APPARIEMENT ET JOINTURE
# ============================================

def map_teams(odds: pd.DataFrame, rows: pd.DataFrame) -> tuple[dict[tuple[str, str], str], pd.DataFrame]:
    """(compétition, nom football-data) -> team_id PitchAPI par les matchs communs : même compétition,
    date à un jour près, même score ; vote majoritaire par nom (au moins 2 voix). Renvoie aussi la table
    des votes (documentation des correspondances)."""
    votes: dict[tuple[str, str, str], int] = {}
    r = rows[["competition", "match_date", "home_team_id", "away_team_id", "home_goals", "away_goals"]].copy()
    r["day"] = pd.to_datetime(r["match_date"]).dt.normalize()
    for comp, h in odds.groupby("competition"):
        rr = r[r["competition"] == comp]
        if rr.empty:
            continue
        for shift in (0, -1, 1):
            hh = h.assign(day=h["odds_date"].dt.normalize() + pd.Timedelta(days=shift))
            m = hh.merge(rr, left_on=["day", "odds_home_goals", "odds_away_goals"], right_on=["day", "home_goals", "away_goals"])
            for side, col in (("odds_home_name", "home_team_id"), ("odds_away_name", "away_team_id")):
                for (name, tid), n in m.groupby([side, col]).size().items():
                    votes[(comp, name, tid)] = votes.get((comp, name, tid), 0) + int(n)
    table = pd.DataFrame([(c, n, t, v) for (c, n, t), v in votes.items()], columns=["competition", "odds_name", "team_id", "votes"])
    best: dict[tuple[str, str], tuple[str, int]] = {}
    for (comp, name, tid), n in votes.items():
        if n >= 2 and n > best.get((comp, name), ("", 0))[1]:
            best[(comp, name)] = (tid, n)
    return {k: v[0] for k, v in best.items()}, table.sort_values(["competition", "odds_name", "votes"], ascending=[True, True, False])


def join(rows: pd.DataFrame, odds: pd.DataFrame, mapping: dict[tuple[str, str], str]) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Cotes jointes aux lignes (compétition, équipes appariées, date à un jour près). Renvoie le dataset
    avec les colonnes de cotes (NaN si aucune cote) et la table des lignes football-data non appariées."""
    h = odds.copy()
    h["home_team_id"] = [mapping.get((c, n)) for c, n in zip(h["competition"], h["odds_home_name"])]
    h["away_team_id"] = [mapping.get((c, n)) for c, n in zip(h["competition"], h["odds_away_name"])]
    h["day"] = h["odds_date"].dt.normalize()
    h["_odds_row"] = np.arange(len(h))
    r = rows[["match_id", "competition", "match_date", "home_team_id", "away_team_id"]].copy()
    r["day"] = pd.to_datetime(r["match_date"]).dt.normalize()
    keep = ODDS_COLUMNS + PROVIDER_COLUMNS + ["odds_source_file", "_odds_row"]
    joined = []
    for shift in (0, -1, 1):
        j = r.merge(h.dropna(subset=["home_team_id", "away_team_id"]).assign(day=h["day"] + pd.Timedelta(days=shift))[
            ["competition", "day", "home_team_id", "away_team_id"] + keep], on=["competition", "day", "home_team_id", "away_team_id"])
        joined.append(j)
    j = pd.concat(joined).drop_duplicates("match_id").drop_duplicates("_odds_row")
    matched_rows = set(j["_odds_row"])
    unmatched = h[~h["_odds_row"].isin(matched_rows)][["competition", "odds_date", "odds_home_name", "odds_away_name", "odds_source_file"]]
    unmatched = unmatched.assign(reason=np.where(h.loc[unmatched.index, "home_team_id"].isna() | h.loc[unmatched.index, "away_team_id"].isna(),
                                                  "team_not_mapped", "no_match_on_date"))
    out = rows.merge(j[["match_id"] + ODDS_COLUMNS + PROVIDER_COLUMNS + ["odds_source_file"]], on="match_id", how="left")
    out["odds_has_snapshot_1x2"] = out["odds_snapshot_1x2_home"].notna()
    out["odds_has_closing_1x2"] = out["odds_closing_1x2_home"].notna()
    out["odds_has_snapshot_ou25"] = out["odds_snapshot_ou25_over"].notna()
    out["odds_has_closing_ou25"] = out["odds_closing_ou25_over"].notna()
    out["odds_semantics"] = np.where(out["odds_has_snapshot_1x2"] & out["odds_has_closing_1x2"], "available_snapshot+closing",
                            np.where(out["odds_has_snapshot_1x2"], SNAPSHOT, np.where(out["odds_has_closing_1x2"], CLOSING, "none")))
    return out, unmatched


def power_devig(odds: np.ndarray) -> np.ndarray:
    """Probabilités sans marge, méthode « power » (contrôle qualité seulement ; aucun edge ici) :
    p_i = (1/o_i)^k avec somme 1. Lignes incomplètes -> NaN."""
    odds = np.asarray(odds, float)
    out = np.full(odds.shape, np.nan)
    ok = ~np.isnan(odds).any(axis=1) & (odds > 1).all(axis=1)
    if ok.any():
        inv = 1.0 / odds[ok]
        lo, hi = np.full(len(inv), 0.5), np.full(len(inv), 3.0)
        for _ in range(60):
            k = (lo + hi) / 2
            s = (inv ** k[:, None]).sum(axis=1)
            lo = np.where(s > 1, k, lo)
            hi = np.where(s > 1, hi, k)
        p = inv ** ((lo + hi) / 2)[:, None]
        out[ok] = p / p.sum(axis=1, keepdims=True)
    return out
