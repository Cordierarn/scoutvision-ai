"""
ScoutVision AI - Modèle contre marché (cotes football-data.co.uk)

Recherche (docs/recherche de PitchApi-big-5) : sur 19 saisons de Serie A, un Dixon-Coles
n'ajoute rien à la cote de clôture (poids 0 dans un mélange de prévisions, RPS 0,1972
contre 0,1905). Avant tout pari, on mesure donc, par compétition :
- RPS et log-loss du modèle contre la cote de clôture sans marge ;
- le poids optimal du modèle dans un mélange logarithmique avec le marché ;
- une simulation de paris de valeur jugée au gain contre la cote de clôture (CLV),
  l'indicateur fiable, bien moins bruité que le profit.

Sources : https://www.football-data.co.uk (fichiers par championnat et saison, cotes
avant match et de clôture ; fixtures.csv et new_league_fixtures.csv pour les matchs à venir).
"""

from __future__ import annotations

import io
import time
from pathlib import Path

import numpy as np
import pandas as pd
import requests

BASE = "https://www.football-data.co.uk"

# Compétitions ScoutVision -> fichiers football-data
MAIN_LEAGUES = {
    "ENG": "E0", "ENG2": "E1", "SCO": "SC0", "GER": "D1", "GER2": "D2", "ITA": "I1", "ITA2": "I2",
    "ESP": "SP1", "ESP2": "SP2", "FRA": "F1", "FRA2": "F2", "NED": "N1", "BEL": "B1", "POR": "P1",
    "TUR": "T1", "GRE": "G1",
}
EXTRA_LEAGUES = {   # fichiers « new/<code>.csv », toutes saisons, cotes de clôture seulement
    "ARG": "ARG", "AUT": "AUT", "BRA": "BRA", "DEN": "DNK", "JPN": "JPN", "MEX": "MEX",
    "NOR": "NOR", "POL": "POL", "SWE": "SWE", "SUI": "SWZ", "USA": "USA",
}
EXTRA_COUNTRY = {"ARG": "Argentina", "AUT": "Austria", "BRA": "Brazil", "DEN": "Denmark", "JPN": "Japan",
                 "MEX": "Mexico", "NOR": "Norway", "POL": "Poland", "SWE": "Sweden", "SUI": "Switzerland",
                 "USA": "USA"}

# Seuil d'avantage pour simuler un pari de valeur (5 %)
EDGE_THRESHOLD = 0.05


# ============================================
# TÉLÉCHARGEMENT
# ============================================

def fetch_csv(url: str, cache: Path, max_age_hours: float) -> pd.DataFrame:
    """CSV football-data avec cache local ; re-téléchargé au-delà de max_age_hours."""
    cache.parent.mkdir(parents=True, exist_ok=True)
    if not cache.exists() or time.time() - cache.stat().st_mtime > max_age_hours * 3600:
        r = requests.get(url, timeout=60, headers={"User-Agent": "ScoutVision data prep"})
        r.raise_for_status()
        cache.write_bytes(r.content)
        time.sleep(0.5)                         # pas de rafale sur le serveur
    raw = cache.read_bytes().decode("utf-8-sig", errors="replace")
    return pd.read_csv(io.StringIO(raw), on_bad_lines="skip", low_memory=False)


def season_codes(today: pd.Timestamp) -> list[str]:
    """Codes des deux dernières saisons européennes : 2627 et 2526 en octobre 2026."""
    start = today.year if today.month >= 7 else today.year - 1
    return [f"{(start - 1) % 100:02d}{start % 100:02d}", f"{start % 100:02d}{(start + 1) % 100:02d}"]


def load_history(cache_dir: Path, today: pd.Timestamp) -> pd.DataFrame:
    """Matchs joués avec cotes, mis au même format pour toutes les compétitions."""
    frames = []
    for comp, div in MAIN_LEAGUES.items():
        for code in season_codes(today):
            try:
                df = fetch_csv(f"{BASE}/mmz4281/{code}/{div}.csv", cache_dir / f"{code}_{div}.csv",
                               max_age_hours=12 if code == season_codes(today)[-1] else 24 * 30)
            except requests.RequestException as e:
                print(f"  football-data {comp} {code} : {e}")
                continue
            frames.append(_normalize(df, comp, home="HomeTeam", away="AwayTeam", hg="FTHG", ag="FTAG"))
    for comp, code in EXTRA_LEAGUES.items():
        try:
            df = fetch_csv(f"{BASE}/new/{code}.csv", cache_dir / f"new_{code}.csv", max_age_hours=12)
        except requests.RequestException as e:
            print(f"  football-data {comp} : {e}")
            continue
        df = df[pd.to_datetime(df["Date"], dayfirst=True, errors="coerce") >= today - pd.Timedelta(days=730)]
        frames.append(_normalize(df, comp, home="Home", away="Away", hg="HG", ag="AG"))
    return pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()


def _num(df: pd.DataFrame, col: str) -> pd.Series:
    return pd.to_numeric(df[col], errors="coerce") if col in df else pd.Series(np.nan, index=df.index)


def _odds(df: pd.DataFrame, *prefixes: str) -> np.ndarray:
    """Première série de cotes 1-N-2 complète parmi les préfixes (BFEC, PSC, AvgC...)."""
    out = np.full((len(df), 3), np.nan)
    for prefix in prefixes:
        cand = np.column_stack([_num(df, f"{prefix}{s}") for s in ("H", "D", "A")])
        fill = np.isnan(out).any(axis=1) & ~np.isnan(cand).any(axis=1)
        out[fill] = cand[fill]
    return out


def _odds_ou(df: pd.DataFrame, *prefixes: str) -> np.ndarray:
    """Première paire de cotes plus / moins de 2,5 buts complète parmi les préfixes."""
    out = np.full((len(df), 2), np.nan)
    for prefix in prefixes:
        cand = np.column_stack([_num(df, f"{prefix}>2.5"), _num(df, f"{prefix}<2.5")])
        fill = np.isnan(out).any(axis=1) & ~np.isnan(cand).any(axis=1)
        out[fill] = cand[fill]
    return out


def _normalize(df: pd.DataFrame, comp: str, home: str, away: str, hg: str, ag: str) -> pd.DataFrame:
    closing = _odds(df, "BFEC", "PSC", "AvgC")        # échange Betfair d'abord : le plus affûté
    pre = _odds(df, "Avg")                             # moyenne des bookmakers avant match
    ou_close = _odds_ou(df, "BFEC", "PC", "AvgC")      # plus / moins de 2,5 buts (championnats principaux)
    ou_pre = _odds_ou(df, "Avg")
    return pd.DataFrame({
        "competition": comp,
        "date": pd.to_datetime(df["Date"], dayfirst=True, errors="coerce"),
        "home_name": df[home].astype(str).str.strip(), "away_name": df[away].astype(str).str.strip(),
        "goals_home": _num(df, hg), "goals_away": _num(df, ag),
        "close_h": closing[:, 0], "close_d": closing[:, 1], "close_a": closing[:, 2],
        "pre_h": pre[:, 0], "pre_d": pre[:, 1], "pre_a": pre[:, 2],
        "close_over": ou_close[:, 0], "close_under": ou_close[:, 1],
        "pre_over": ou_pre[:, 0], "pre_under": ou_pre[:, 1],
    }).dropna(subset=["date", "goals_home", "goals_away"])


def load_fixtures(cache_dir: Path) -> pd.DataFrame:
    """Matchs à venir avec cotes (fixtures.csv et new_league_fixtures.csv)."""
    frames = []
    div_to_comp = {v: k for k, v in MAIN_LEAGUES.items()}
    try:
        f = fetch_csv(f"{BASE}/fixtures.csv", cache_dir / "fixtures.csv", max_age_hours=3)
        f = f[f["Div"].isin(div_to_comp)]
        frames.append(_fixture_rows(f, f["Div"].map(div_to_comp), "HomeTeam", "AwayTeam"))
    except requests.RequestException as e:
        print(f"  football-data fixtures : {e}")
    try:
        f = fetch_csv(f"{BASE}/new_league_fixtures.csv", cache_dir / "new_league_fixtures.csv", max_age_hours=3)
        country_to_comp = {v: k for k, v in EXTRA_COUNTRY.items()}
        f = f[f["Country"].isin(country_to_comp)]
        frames.append(_fixture_rows(f, f["Country"].map(country_to_comp), "Home", "Away"))
    except requests.RequestException as e:
        print(f"  football-data new fixtures : {e}")
    return pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()


def _fixture_rows(f: pd.DataFrame, comp: pd.Series, home: str, away: str) -> pd.DataFrame:
    fair_src = _odds(f, "BFE", "PS", "Avg")            # référence du marché
    best = _odds(f, "Max")
    avg = _odds(f, "Avg")
    return pd.DataFrame({
        "competition": comp.values,
        "date": pd.to_datetime(f["Date"], dayfirst=True, errors="coerce").values,
        "home_name": f[home].astype(str).str.strip().values, "away_name": f[away].astype(str).str.strip().values,
        "ref_h": fair_src[:, 0], "ref_d": fair_src[:, 1], "ref_a": fair_src[:, 2],
        "best_h": best[:, 0], "best_d": best[:, 1], "best_a": best[:, 2],
        "avg_h": avg[:, 0], "avg_d": avg[:, 1], "avg_a": avg[:, 2],
    })


# ============================================
# CORRESPONDANCE DES ÉQUIPES
# ============================================

def map_teams(history: pd.DataFrame, results: pd.DataFrame) -> dict[tuple[str, str], str]:
    """(compétition, nom football-data) -> Team ID PitchAPI, par les matchs communs :
    même compétition, date à un jour près, même score. Vote majoritaire par nom."""
    votes: dict[tuple[str, str, str], int] = {}
    res = results.copy()
    res["day"] = res["date"].dt.normalize()
    for comp, h in history.groupby("competition"):
        r = res[res["competition"] == comp]
        if r.empty:
            continue
        for shift in (0, -1, 1):
            hh = h.assign(day=h["date"].dt.normalize() + pd.Timedelta(days=shift))
            m = hh.merge(r, on=["day", "goals_home", "goals_away"], suffixes=("", "_r"))
            for side in ("home", "away"):
                for (name, tid), n in m.groupby([f"{side}_name", side]).size().items():
                    votes[(comp, name, tid)] = votes.get((comp, name, tid), 0) + int(n)
    best: dict[tuple[str, str], tuple[str, int]] = {}
    for (comp, name, tid), n in votes.items():
        if n >= 2 and n > best.get((comp, name), ("", 0))[1]:
            best[(comp, name)] = (tid, n)
    return {k: v[0] for k, v in best.items()}


# ============================================
# PROBABILITÉS DU MARCHÉ ET ÉVALUATION
# ============================================

def devig(odds: np.ndarray) -> np.ndarray:
    """Probabilités sans marge, méthode « power » : p_i = (1/o_i)^k avec somme 1 (bissection).
    Corrige plus fortement les grosses cotes, ce qui tient compte du biais favori / outsider."""
    inv = 1.0 / odds
    lo, hi = np.ones(len(inv)) * 0.5, np.ones(len(inv)) * 3.0
    for _ in range(60):
        k = (lo + hi) / 2
        s = (inv ** k[:, None]).sum(axis=1)
        lo = np.where(s > 1, k, lo)
        hi = np.where(s > 1, hi, k)
    p = inv ** ((lo + hi) / 2)[:, None]
    return p / p.sum(axis=1, keepdims=True)


def rps(p: np.ndarray, outcome: np.ndarray) -> np.ndarray:
    cum = np.cumsum(p, axis=1)[:, :2]
    obs = np.cumsum(np.eye(3)[outcome], axis=1)[:, :2]
    return ((cum - obs) ** 2).sum(axis=1) / 2


def pool_weight(pm: np.ndarray, pk: np.ndarray, outcome: np.ndarray) -> float:
    """Poids w du modèle dans le mélange p ∝ pm^w · pk^(1-w) qui minimise la log-loss."""
    best = (0.0, np.inf)
    for w in np.linspace(0, 1, 21):
        p = pm ** w * pk ** (1 - w)
        p = p / p.sum(axis=1, keepdims=True)
        ll = -np.log(np.clip(p[np.arange(len(p)), outcome], 1e-12, None)).mean()
        if ll < best[1]:
            best = (float(w), ll)
    return round(best[0], 2)


def evaluate(backtest: pd.DataFrame, results: pd.DataFrame, history: pd.DataFrame,
             mapping: dict[tuple[str, str], str]) -> dict:
    """Compare les probabilités du backtest du pipeline (prédictions faites avant chaque match)
    aux cotes de clôture, par compétition et au total."""
    h = history.copy()
    h["home"] = [mapping.get((c, n)) for c, n in zip(h["competition"], h["home_name"])]
    h["away"] = [mapping.get((c, n)) for c, n in zip(h["competition"], h["away_name"])]
    h = h.dropna(subset=["home", "away", "close_h", "close_d", "close_a"])
    h["day"] = h["date"].dt.normalize()

    bt = backtest.merge(results[["match_id", "home", "away"]], on="match_id")
    bt["day"] = pd.to_datetime(bt["date"], format="mixed").dt.normalize()
    joined = []
    for shift in (0, -1, 1):
        j = bt.merge(h.assign(day=h["day"] + pd.Timedelta(days=shift)),
                     left_on=["league_key", "day", "home", "away"], right_on=["competition", "day", "home", "away"])
        joined.append(j)
    df = pd.concat(joined).drop_duplicates("match_id")
    if df.empty:
        return {}

    pm = df[["p_home", "p_draw", "p_away"]].to_numpy(float)
    pk = devig(df[["close_h", "close_d", "close_a"]].to_numpy(float))
    out = df["outcome"].to_numpy(int)
    pre = df[["pre_h", "pre_d", "pre_a"]].to_numpy(float)

    def summary(mask: np.ndarray) -> dict:
        if mask.sum() == 0:
            return {}
        s = {
            "matches": int(mask.sum()),
            "rpsModel": round(float(rps(pm[mask], out[mask]).mean()), 4),
            "rpsMarket": round(float(rps(pk[mask], out[mask]).mean()), 4),
            "llModel": round(float(-np.log(pm[mask][np.arange(mask.sum()), out[mask]]).mean()), 4),
            "llMarket": round(float(-np.log(pk[mask][np.arange(mask.sum()), out[mask]]).mean()), 4),
            "poolWeight": pool_weight(pm[mask], pk[mask], out[mask]),
        }
        # Paris de valeur simulés : cote moyenne avant match, avantage > EDGE_THRESHOLD
        ok = mask & ~np.isnan(pre).any(axis=1)
        if ok.sum() > 0:
            edge = pm[ok] * pre[ok] - 1
            bets = edge > EDGE_THRESHOLD
            if bets.sum() > 0:
                rows, cols = np.nonzero(bets)
                price = pre[ok][rows, cols]
                clv = price * pk[ok][rows, cols] - 1               # valeur contre la clôture sans marge
                won = out[ok][rows] == cols
                profit = np.where(won, price - 1, -1.0)
                s.update({
                    "bets": int(len(rows)),
                    "clv": round(float(clv.mean()), 4),
                    "clvSe": round(float(clv.std(ddof=1) / np.sqrt(len(clv))) if len(clv) > 1 else 0.0, 4),
                    "roi": round(float(profit.mean()), 4),
                    "roiSe": round(float(profit.std(ddof=1) / np.sqrt(len(profit))) if len(profit) > 1 else 0.0, 4),
                })
        return s

    comps = df["league_key"].to_numpy()
    by_comp = {c: summary(comps == c) for c in sorted(set(comps))}
    return {"overall": summary(np.ones(len(df), dtype=bool)), "competitions": by_comp,
            "edgeThreshold": EDGE_THRESHOLD, "period": [str(df["day"].min().date()), str(df["day"].max().date())]}


def attach_odds(matches: list[dict], fixtures: pd.DataFrame, mapping: dict[tuple[str, str], str],
                team_ids: dict[str, tuple[str, str]]) -> int:
    """Ajoute aux pronostics les cotes des matchs à venir : probabilités du marché sans marge,
    meilleures cotes, et avantage du modèle sur chaque issue. Renvoie le nombre de matchs couverts."""
    if fixtures.empty:
        return 0
    f = fixtures.copy()
    f["home"] = [mapping.get((c, n)) for c, n in zip(f["competition"], f["home_name"])]
    f["away"] = [mapping.get((c, n)) for c, n in zip(f["competition"], f["away_name"])]
    f = f.dropna(subset=["home", "away", "ref_h", "ref_d", "ref_a"])
    f["day"] = pd.to_datetime(f["date"]).dt.strftime("%Y-%m-%d")
    index = {(r.competition, r.day, r.home, r.away): r for r in f.itertuples()}
    covered = 0
    for m in matches:
        ids = team_ids.get(m["match_id"])
        if not ids:
            continue
        r = index.get((m["competition"], m["date"], ids[0], ids[1]))
        if r is None:
            continue
        fair = devig(np.array([[r.ref_h, r.ref_d, r.ref_a]]))[0]
        best = [r.best_h, r.best_d, r.best_a]
        model = [m["pHome"], m["pDraw"], m["pAway"]]
        m["market"] = {
            "fair": [round(float(x), 3) for x in fair],
            "best": [None if np.isnan(x) else round(float(x), 2) for x in best],
            "edge": [None if np.isnan(o) else round(float(p * o - 1), 3) for p, o in zip(model, best)],
        }
        covered += 1
    return covered


# ============================================
# PLUS / MOINS DE 2,5 BUTS
# ============================================

def _bet_stats(pm: np.ndarray, pk: np.ndarray, out: np.ndarray, pre: np.ndarray) -> dict:
    """Paris de valeur simulés : avantage du modèle > EDGE_THRESHOLD sur la cote avant match,
    jugés au gain contre la clôture sans marge (CLV) et au rendement, avec erreurs-types."""
    ok = ~np.isnan(pre).any(axis=1)
    if ok.sum() == 0:
        return {}
    edge = pm[ok] * pre[ok] - 1
    rows, cols = np.nonzero(edge > EDGE_THRESHOLD)
    if len(rows) == 0:
        return {"bets": 0}
    price = pre[ok][rows, cols]
    clv = price * pk[ok][rows, cols] - 1
    profit = np.where(out[ok][rows] == cols, price - 1, -1.0)
    se = lambda v: round(float(v.std(ddof=1) / np.sqrt(len(v))), 4) if len(v) > 1 else 0.0
    return {"bets": int(len(rows)), "clv": round(float(clv.mean()), 4), "clvSe": se(clv),
            "roi": round(float(profit.mean()), 4), "roiSe": se(profit)}


def evaluate_over_under(results: pd.DataFrame, history: pd.DataFrame, mapping: dict[tuple[str, str], str],
                        team_league: dict[str, str], fit, start: pd.Timestamp, window_days: int = 730) -> dict:
    """Plus / moins de 2,5 buts : chaque semaine depuis `start`, le modèle joint (`fit`, ex.
    models.fit_joint) est ajusté sur les seuls matchs antérieurs et prédit les matchs de la
    semaine ; comparaison aux cotes de clôture football-data sans marge.

    Issue 0 = plus de 2,5 buts, 1 = moins. Brier et log-loss, poids du modèle dans un
    mélange logarithmique avec le marché, paris de valeur simulés.
    """
    h = history.copy()
    h["home"] = [mapping.get((c, n)) for c, n in zip(h["competition"], h["home_name"])]
    h["away"] = [mapping.get((c, n)) for c, n in zip(h["competition"], h["away_name"])]
    h = h.dropna(subset=["home", "away", "close_over", "close_under"])
    h = h[h["date"] >= start]
    if h.empty:
        return {}

    rows = []
    for week_start, g in h.groupby(h["date"].dt.to_period("W").dt.start_time):
        train = results[(results["date"] < week_start)
                        & (results["date"] >= week_start - pd.Timedelta(days=window_days))]
        if len(train) < 500:
            continue
        model = fit(train, team_league, week_start)
        for r in g.itertuples():
            p = model.prob_over(r.home, r.away)
            if p is not None:
                rows.append((r.competition, p, r.goals_home + r.goals_away > 2.5,
                             r.close_over, r.close_under, r.pre_over, r.pre_under, r.date))
    if not rows:
        return {}
    df = pd.DataFrame(rows, columns=["comp", "p_over", "over", "c_over", "c_under", "p_o", "p_u", "date"])

    p_over = df["p_over"].clip(1e-6, 1 - 1e-6).to_numpy()
    pm = np.column_stack([p_over, 1 - p_over])
    pk = devig(df[["c_over", "c_under"]].to_numpy(float))
    out = np.where(df["over"].to_numpy(), 0, 1)
    pre = df[["p_o", "p_u"]].to_numpy(float)

    def summary(mask: np.ndarray) -> dict:
        if mask.sum() == 0:
            return {}
        n = int(mask.sum()); y = (out[mask] == 0).astype(float); idx = np.arange(n)
        return {
            "matches": n,
            "brierModel": round(float(((pm[mask][:, 0] - y) ** 2).mean()), 4),
            "brierMarket": round(float(((pk[mask][:, 0] - y) ** 2).mean()), 4),
            "llModel": round(float(-np.log(pm[mask][idx, out[mask]]).mean()), 4),
            "llMarket": round(float(-np.log(pk[mask][idx, out[mask]]).mean()), 4),
            "poolWeight": pool_weight(pm[mask], pk[mask], out[mask]),
            "overRate": round(float(y.mean()), 3),
            **_bet_stats(pm[mask], pk[mask], out[mask], pre[mask]),
        }

    comps = df["comp"].to_numpy()
    return {"overall": summary(np.ones(len(df), dtype=bool)),
            "competitions": {c: summary(comps == c) for c in sorted(set(comps))},
            "period": [str(df["date"].min().date()), str(df["date"].max().date())]}
