"""
Fiabilité des statistiques par 90 minutes et joueurs à faible temps de jeu.

PitchAPI publie des valeurs par 90 « rétrécies » vers la moyenne du rôle :
    shrunk = (brut × minutes + prior × k) / (minutes + k),
avec une constante k par métrique, la même pour toutes les compétitions et saisons. C'est un modèle
bayésien empirique : la part de signal d'une valeur sur m minutes vaut R = m / (m + k).

Ce module :
1. lit les constantes k de PitchAPI dans player_season ;
2. recale k métrique par métrique sur un test pair / impair : chaque saison de joueur est coupée en
   matchs pairs et impairs (player_match), la corrélation entre les deux moitiés, à poste et
   compétition égaux, est la fiabilité observée d'une demi-saison ; k est ajusté pour que
   m / (m + k) la reproduise ;
3. estime la variance « vraie » entre joueurs d'un même rôle (covariance des deux moitiés), d'où
   un intervalle à 90 % autour d'une valeur : ± 1,645 × tau × √(1 − R) ;
4. construit les joueurs sous le seuil de PitchAPI (40 % des minutes de l'équipe), à partir de 4 matchs
   et 180 minutes : valeur par 90 rétrécie comme PitchAPI (prior du rôle, k de PitchAPI), fiabilité
   (k recalé), percentile de la valeur et de son intervalle parmi les joueurs qualifiés du même rôle,
   du même niveau et de la même saison (même groupement que les percentiles de l'app).

Seules les métriques « par 90 » sont traitées : les taux (%, PAdj) demandent un modèle binomial.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

Z90 = 1.645
MIN_HALF_MINUTES = 180               # minutes minimum dans chaque moitié pour entrer dans la calibration
HALF_BINS = [180, 300, 450, 650, 900, 1200, 1600, 4000]
MIN_BIN_PLAYERS = 40
K_BOUNDS = (30.0, 20000.0)
SMALL_MIN_MATCHES = 4
SMALL_MIN_MINUTES = 180

# Métriques des fiches par catégorie de poste (utils/positionMetrics.ts, SIMILARITY_METRICS), réduites aux
# métriques par 90 : ce sont elles que la vue « petits temps de jeu » publie, pour borner la taille du fichier
ROLE_CATEGORY = {"GK": "GK", "CB": "DEF", "FB": "FB", "WB": "FB", "DM": "MID", "CM": "MID", "AM": "ATT_MID", "W": "WING", "ST": "FWD"}
CATEGORY_METRICS = {
    "GK": ["Prevented goals per 90", "xGOT against per 90", "Exits per 90", "High claims per 90", "Punches per 90", "Passes per 90"],
    "DEF": ["Duels won per 90", "Aerial duels per 90", "Shots blocked per 90", "Clearances per 90", "Progressive passes per 90", "Progressive runs per 90"],
    "FB": ["Successful defensive actions per 90", "Crosses per 90", "Progressive runs per 90", "Dribbles per 90", "Key passes per 90", "xA per 90"],
    "MID": ["Passes per 90", "Progressive passes per 90", "Key passes per 90", "Passes to final third per 90", "xA per 90", "xG per 90",
            "xG buildup per 90", "Progressive runs per 90"],
    "ATT_MID": ["xG per 90", "xA per 90", "Goals per 90", "Assists per 90", "Key passes per 90", "Shot-creating actions per 90",
                "Through passes per 90", "Dribbles per 90", "Shots per 90", "Passes to penalty area per 90", "Progressive runs per 90"],
    "WING": ["xG per 90", "xA per 90", "Goals per 90", "Assists per 90", "Key passes per 90", "Shot-creating actions per 90", "Dribbles per 90",
             "Shots per 90", "Progressive runs per 90", "Carries into box per 90", "Crosses per 90"],
    "FWD": ["xG per 90", "npxG per 90", "Goals per 90", "Shots per 90", "Shots on target per 90", "xGOT per 90", "Touches in box per 90",
            "xA per 90", "Aerial duels won per 90", "Big chances missed per 90"],
}


# ============================================
# CONSTANTES DE PITCHAPI
# ============================================

def implied_constants(ps: pd.DataFrame, cols: list[str]) -> dict[str, float]:
    """k de PitchAPI par colonne, déduit de shrunk = (brut × m + prior × k) / (m + k)."""
    out: dict[str, float] = {}
    for col in cols:
        raw, sh, pr = ps.get(f"{col}_p90"), ps.get(f"{col}_p90_shrunk"), ps.get(f"{col}__prior")
        if raw is None or sh is None or pr is None:
            continue
        gap = sh - pr
        k = ps["minutes"] * (raw - sh) / gap
        k = k[np.isfinite(k) & (gap.abs() > 1e-6) & (k > 0)]
        if len(k):
            out[col] = float(k.median())
    return out


# ============================================
# DEMI-SAISONS (calibration) ET TOTAUX (petits temps de jeu)
# ============================================

def modal_role(pm: pd.DataFrame) -> pd.Series:
    """Rôle le plus joué (en minutes) de chaque joueur."""
    by = pm.groupby(["player_id", "position_role"], observed=True)["minutes"].sum().reset_index()
    return by.sort_values("minutes").drop_duplicates("player_id", keep="last").set_index("player_id")["position_role"]


def player_halves(pm: pd.DataFrame, cols: list[str], comp: str, season: str) -> pd.DataFrame:
    """Sommes par joueur des matchs pairs (half 0) et impairs (half 1), par ordre de date, rôle le plus joué."""
    pm = pm[pm["minutes"] > 0].sort_values(["player_id", "date"]).copy()
    if pm.empty:
        return pd.DataFrame()
    pm["half"] = pm.groupby("player_id").cumcount() % 2
    have = [c for c in cols if c in pm.columns]
    sums = pm.groupby(["player_id", "half"])[["minutes"] + have].sum(min_count=1).reset_index()
    sums["role"] = sums["player_id"].map(modal_role(pm))
    return sums.assign(comp=comp, season=season)


def player_totals(pm: pd.DataFrame, cols: list[str]) -> pd.DataFrame:
    """Totaux de saison par joueur : minutes, matchs, titularisations, équipe principale, rôle, sommes des métriques."""
    pm = pm[pm["minutes"] > 0]
    if pm.empty:
        return pd.DataFrame()
    have = [c for c in cols if c in pm.columns]
    agg = pm.groupby("player_id").agg(minutes=("minutes", "sum"), matches=("match_id", "nunique"),
                                      starts=("lineup_role", lambda s: int((s == "starter").sum())), name=("player_name", "last"))
    sums = pm.groupby("player_id")[have].sum(min_count=1)
    team = pm.groupby(["player_id", "team_id", "team_name"])["minutes"].sum().reset_index().sort_values("minutes") \
        .drop_duplicates("player_id", keep="last").set_index("player_id")
    team_matches = pm.groupby("team_id")["match_id"].nunique()
    out = agg.join(sums)
    out["team_id"], out["team_name"] = team["team_id"], team["team_name"]
    out["team_minutes"] = out["team_id"].map(team_matches) * 90
    out["role"] = modal_role(pm)
    return out.reset_index()


# ============================================
# CALIBRATION
# ============================================

def split_half_bins(halves: pd.DataFrame, col: str) -> pd.DataFrame:
    """Fiabilité observée d'une demi-saison par tranche de minutes : corrélation entre moitiés, centrée par
    compétition × rôle (le prior de PitchAPI est par rôle), et covariance par rôle (variance vraie)."""
    if col not in halves.columns:
        return pd.DataFrame()
    w = halves.dropna(subset=[col]).pivot_table(index=["comp", "season", "player_id", "role"], columns="half", values=["minutes", col])
    if w.empty or ("minutes", 1) not in w.columns:
        return pd.DataFrame()
    w = pd.DataFrame({"m0": w[("minutes", 0)], "m1": w[("minutes", 1)], "c0": w[(col, 0)], "c1": w[(col, 1)]}).dropna()
    w = w[(w.m0 >= MIN_HALF_MINUTES) & (w.m1 >= MIN_HALF_MINUTES)].reset_index()
    if w.empty:
        return pd.DataFrame()
    w["r0"], w["r1"] = 90 * w.c0 / w.m0, 90 * w.c1 / w.m1
    grp = w.groupby(["comp", "season", "role"])
    w["d0"], w["d1"] = w.r0 - grp.r0.transform("mean"), w.r1 - grp.r1.transform("mean")
    w["mh"] = (w.m0 + w.m1) / 2
    w["bin"] = pd.cut(w.mh, HALF_BINS)
    return w


def fit_constant(w: pd.DataFrame) -> tuple[float | None, list[dict]]:
    """k tel que mh / (mh + k) reproduise la corrélation observée des moitiés, par moindres carrés pondérés."""
    rows = []
    for b, d in w.groupby("bin", observed=True):
        if len(d) < MIN_BIN_PLAYERS or d.d0.std() == 0 or d.d1.std() == 0:
            continue
        rows.append({"minutes": float(d.mh.mean()), "n": int(len(d)), "observed": float(np.corrcoef(d.d0, d.d1)[0, 1])})
    if len(rows) < 2:
        return None, rows
    grid = np.exp(np.linspace(np.log(K_BOUNDS[0]), np.log(K_BOUNDS[1]), 400))
    m = np.array([r["minutes"] for r in rows]); obs = np.array([r["observed"] for r in rows]); n = np.array([r["n"] for r in rows])
    sse = [(n * (obs - m / (m + k)) ** 2).sum() for k in grid]
    k = float(grid[int(np.argmin(sse))])
    for r in rows:
        r["predicted"] = round(r["minutes"] / (r["minutes"] + k), 3)
        r["observed"] = round(r["observed"], 3)
        r["minutes"] = round(r["minutes"])
    return k, rows


def true_sd_by_role(w: pd.DataFrame) -> dict[str, float]:
    """Écart-type « vrai » entre joueurs d'un rôle : racine de la covariance des deux moitiés (centrées)."""
    out = {}
    for role, d in w.groupby("role"):
        if len(d) >= MIN_BIN_PLAYERS:
            cov = float((d.d0 * d.d1).mean())
            out[str(role)] = round(float(np.sqrt(cov)), 4) if cov > 0 else 0.0
    return out


def calibrate(halves: pd.DataFrame, metrics: list[tuple[str, str]], pitchapi_k: dict[str, float]) -> dict:
    """Paramètres par métrique (libellé de l'app) : k recalé, k de PitchAPI, écart-type vrai par rôle, validation."""
    out = {}
    for label, col in metrics:
        w = split_half_bins(halves, col)
        if w.empty:
            continue
        k, bins = fit_constant(w)
        kp = pitchapi_k.get(col)
        if k is None and kp is None:
            continue
        k_used = k if k is not None else kp
        out[label] = {
            "k": round(k_used), "kPitchapi": round(kp) if kp is not None else None, "calibrated": k is not None,
            "minutesForReliable": round(k_used * 0.7 / 0.3),       # minutes pour une fiabilité de 0,7
            "trueSd": true_sd_by_role(w), "validation": bins,
        }
    return out


def reliability(minutes: float | np.ndarray, k: float) -> float | np.ndarray:
    """Part de signal d'une valeur par 90 observée sur `minutes` : m / (m + k)."""
    m = np.asarray(minutes, dtype=float)
    return np.where(m > 0, m / (m + k), 0.0)


# ============================================
# JOUEURS À FAIBLE TEMPS DE JEU
# ============================================

def role_priors(ps: pd.DataFrame, cols: list[str]) -> pd.DataFrame:
    """Prior de PitchAPI par rôle (médiane de la colonne __prior des joueurs qualifiés du rôle)."""
    have = [f"{c}__prior" for c in cols if f"{c}__prior" in ps.columns]
    return ps.groupby("position_role")[have].median().rename(columns=lambda c: c[: -len("__prior")])


def percentile_of(values: np.ndarray, reference: np.ndarray) -> np.ndarray:
    """Rang centile (0-100) de chaque valeur parmi la référence : part strictement inférieure + moitié des égalités."""
    ref = np.sort(reference[np.isfinite(reference)])
    if not len(ref):
        return np.full(len(values), np.nan)
    below = np.searchsorted(ref, values, side="left")
    equal = np.searchsorted(ref, values, side="right") - below
    return 100 * (below + 0.5 * equal) / len(ref)


def small_sample_rows(totals: pd.DataFrame, priors: pd.DataFrame, qualified_ids: set, params: dict,
                      metrics: list[tuple[str, str]], comp: str, season: str, tier: int) -> pd.DataFrame:
    """Joueurs sous le seuil de PitchAPI, à partir de 4 matchs et 180 minutes : valeurs rétrécies comme PitchAPI,
    fiabilité et écart-type d'intervalle (percentiles calculés ensuite, sur tout le niveau)."""
    t = totals[(totals["matches"] >= SMALL_MIN_MATCHES) & (totals["minutes"] >= SMALL_MIN_MINUTES)
               & ~totals["player_id"].isin(qualified_ids) & totals["role"].isin(ROLE_CATEGORY)]
    if t.empty:
        return pd.DataFrame()
    col_of = dict(metrics)
    rows = []
    for r in t.itertuples(index=False):
        rec = {"Player ID": r.player_id, "Player": r.name, "Team ID": r.team_id, "Team": r.team_name, "Competition": comp,
               "League tier": tier, "_app_season": season, "Position": r.role, "Matches played": int(r.matches), "Starts": int(r.starts),
               "Minutes played": int(r.minutes), "Minutes share": round(float(r.minutes / r.team_minutes), 3) if r.team_minutes else None}
        for label in CATEGORY_METRICS[ROLE_CATEGORY[r.role]]:
            col, p = col_of.get(label), params.get(label)
            total = getattr(r, col, None) if col else None
            if p is None or total is None or pd.isna(total) or col not in priors.columns or r.role not in priors.index:
                continue
            raw = 90 * float(total) / r.minutes
            prior = float(priors.at[r.role, col])
            kp = p["kPitchapi"] or p["k"]
            rel = float(reliability(r.minutes, p["k"]))
            sd = p["trueSd"].get(r.role, 0.0) * np.sqrt(max(0.0, 1 - rel))
            value = (raw * r.minutes + prior * kp) / (r.minutes + kp)
            rec[label] = round(value, 4)
            rec[f"{label} raw"] = round(raw, 4)
            rec[f"{label} rel"] = round(rel * 100)
            rec[f"{label} sd"] = round(float(sd), 4)
        rows.append(rec)
    return pd.DataFrame(rows)


def add_small_sample_percentiles(small: pd.DataFrame, qualified: pd.DataFrame) -> pd.DataFrame:
    """Percentile de la valeur et des bornes de l'intervalle à 90 % parmi les joueurs qualifiés de la même saison,
    du même niveau et du même rôle (groupement des percentiles de l'app)."""
    if small.empty:
        return small
    small = small.copy()
    keys = ["_app_season", "League tier", "Position"]
    labels = sorted({l for ls in CATEGORY_METRICS.values() for l in ls if l in small.columns})
    for label in labels:
        for c in (f"{label} pct", f"{label} pct lo", f"{label} pct hi"):
            small[c] = np.nan
        if label not in qualified.columns:
            continue
        for key, idx in small.groupby(keys).groups.items():
            ref = qualified.loc[(qualified[keys[0]] == key[0]) & (qualified[keys[1]] == key[1]) & (qualified[keys[2]] == key[2]), label]
            ref = pd.to_numeric(ref, errors="coerce").to_numpy(dtype=float)
            if len(ref) < 10:
                continue
            v = small.loc[idx, label].to_numpy(dtype=float)
            sd = small.loc[idx, f"{label} sd"].to_numpy(dtype=float)
            ok = np.isfinite(v)
            for c, x in ((f"{label} pct", v), (f"{label} pct lo", v - Z90 * sd), (f"{label} pct hi", v + Z90 * sd)):
                out = np.full(len(v), np.nan)
                out[ok] = percentile_of(x[ok], ref)
                small.loc[idx, c] = np.round(out)
    return small


def percentile_agreement(qualified: pd.DataFrame, labels: list[str]) -> dict:
    """Contrôle : percentiles recalculés ici pour les joueurs qualifiés, comparés à ceux de PitchAPI (écart absolu moyen)."""
    keys = ["_app_season", "League tier", "Position"]
    gaps = {}
    for label in labels:
        if label not in qualified.columns or f"{label} pct" not in qualified.columns:
            continue
        d = qualified[keys + [label, f"{label} pct"]].dropna()
        if d.empty:
            continue
        mine = d.groupby(keys)[label].transform(lambda s: pd.Series(percentile_of(s.to_numpy(dtype=float), s.to_numpy(dtype=float)), index=s.index))
        gaps[label] = round(float((mine - d[f"{label} pct"].astype(float)).abs().mean()), 2)
    return gaps


# ============================================
# FICHIERS PUBLIÉS
# ============================================

BASE_FIELDS = ["Player ID", "Player", "Team ID", "Team", "Competition", "League tier", "Position", "Age", "Matches played", "Starts",
               "Minutes played", "Minutes share"]


def small_samples_payload(small: pd.DataFrame, season_label: str) -> dict:
    """Fichier compact d'une saison : champs du joueur, puis par métrique [valeur, brut, fiabilité %, pct, pct bas, pct haut]."""
    labels = sorted({l for ls in CATEGORY_METRICS.values() for l in ls if l in small.columns})
    index = {l: i for i, l in enumerate(labels)}

    def num(v, digits=None):
        if v is None or (isinstance(v, float) and not np.isfinite(v)) or pd.isna(v):
            return None
        return round(float(v), digits) if digits is not None else int(round(float(v)))

    players = []
    for r in small.to_dict("records"):
        base = {f: (None if pd.isna(r.get(f)) else (r[f].item() if hasattr(r.get(f), "item") else r.get(f))) for f in BASE_FIELDS if f in r}
        metrics = [[index[l], num(r[l], 4), num(r.get(f"{l} raw"), 4), num(r.get(f"{l} rel")), num(r.get(f"{l} pct")),
                    num(r.get(f"{l} pct lo")), num(r.get(f"{l} pct hi"))]
                   for l in labels if l in r and r[l] is not None and not pd.isna(r[l])]
        players.append({**base, "metrics": metrics})
    return {"season": season_label, "labels": labels, "fields": ["value", "raw", "reliability", "pct", "pctLow", "pctHigh"],
            "minMatches": SMALL_MIN_MATCHES, "minMinutes": SMALL_MIN_MINUTES, "players": players}
