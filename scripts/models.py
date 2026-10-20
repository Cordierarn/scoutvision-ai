"""
ScoutVision AI - Modèles calculés à la préparation des données (numpy seul)

- styles de jeu des équipes : ACP + k-means sur les indicateurs de team_season
- courbes d'âge : évolution moyenne des percentiles d'une saison à l'autre, par rôle et par âge
- valeur estimée : régression ridge de log10(valeur Transfermarkt), prédictions hors échantillon
"""

from __future__ import annotations

import numpy as np
import pandas as pd

RNG_SEED = 7

# ============================================
# STYLES DE JEU DES ÉQUIPES
# ============================================

# (colonne de teams/<saison>.json, signe) : signe -1 quand une valeur basse marque le trait
STYLE_FEATURES: list[tuple[str, str, int]] = [
    ("possession", "Possession, %", 1),
    ("territory", "Field tilt", 1),
    ("pressing", "PPDA", -1),                      # PPDA bas = pressing intense
    ("line_height", "Defensive line height", 1),
    ("directness", "Direct speed", 1),
    ("build_up", "Passes per sequence", 1),
]


def _kmeans(x: np.ndarray, k: int, n_init: int = 20, iters: int = 100) -> tuple[np.ndarray, np.ndarray]:
    """k-means++ ; garde la meilleure de n_init initialisations (inertie minimale)."""
    rng = np.random.default_rng(RNG_SEED)
    best: tuple[float, np.ndarray, np.ndarray] | None = None
    for _ in range(n_init):
        centers = [x[rng.integers(len(x))]]
        for _ in range(1, k):
            d2 = np.min(((x[:, None, :] - np.array(centers)[None]) ** 2).sum(-1), axis=1)
            centers.append(x[rng.choice(len(x), p=d2 / d2.sum())])
        c = np.array(centers)
        for _ in range(iters):
            labels = np.argmin(((x[:, None, :] - c[None]) ** 2).sum(-1), axis=1)
            new = np.array([x[labels == j].mean(0) if (labels == j).any() else c[j] for j in range(k)])
            if np.allclose(new, c):
                break
            c = new
        inertia = ((x - c[labels]) ** 2).sum()
        if best is None or inertia < best[0]:
            best = (inertia, labels, c)
    return best[1], best[2]


def _style_name(z: dict[str, float]) -> str:
    """Nom d'un style à partir des z-scores du centroïde (règles lisibles, dans l'ordre)."""
    if z["possession"] > 1.2:
        return "Dominant possession"
    if z["possession"] > 0.4 and z["build_up"] > 0.5:
        return "Patient build-up"
    if z["pressing"] > 0.5:
        return "High press"
    if z["possession"] < -1 and z["pressing"] < -1:
        return "Deep block & counter"
    if z["directness"] > 0.8:
        return "Direct & vertical"
    if z["pressing"] < -0.3:
        return "Mid-low block"
    return "Balanced"


def team_styles(teams: pd.DataFrame, k: int = 6) -> tuple[pd.DataFrame, list[dict]]:
    """Style de chaque équipe-saison et coordonnées sur les deux premiers axes de l'ACP.

    Ajusté sur toutes les équipes-saisons à la fois : un même style garde le même nom
    d'une saison et d'une compétition à l'autre. Les indicateurs sont centrés-réduits
    sur l'ensemble ; une équipe sans analytics (indicateur manquant) n'a pas de style.
    """
    cols = [c for _, c, _ in STYLE_FEATURES]
    ok = teams[cols].notna().all(axis=1)
    raw = teams.loc[ok, cols].to_numpy(float) * np.array([s for _, _, s in STYLE_FEATURES])
    mean, std = raw.mean(0), raw.std(0)
    x = (raw - mean) / np.where(std > 0, std, 1)

    labels, centers = _kmeans(x, k)
    names = [_style_name(dict(zip([n for n, _, _ in STYLE_FEATURES], c))) for c in centers]
    seen: dict[str, int] = {}
    for i, n in enumerate(names):          # deux centroïdes du même nom : suffixe
        seen[n] = seen.get(n, 0) + 1
        if seen[n] > 1:
            names[i] = f"{n} ({seen[n]})"

    # ACP (SVD) : deux axes pour la carte des styles
    _, _, vt = np.linalg.svd(x, full_matrices=False)
    coords = x @ vt[:2].T
    # Orientation lisible : axe 1 croît avec la possession, axe 2 avec le pressing
    for a, feat in enumerate(("possession", "pressing")):
        j = [n for n, _, _ in STYLE_FEATURES].index(feat)
        if vt[a, j] < 0:
            coords[:, a] *= -1

    out = pd.DataFrame(index=teams.index, columns=["Style", "Style x", "Style y"], dtype=object)
    out.loc[ok, "Style"] = [names[l] for l in labels]
    out.loc[ok, "Style x"] = coords[:, 0].round(3)
    out.loc[ok, "Style y"] = coords[:, 1].round(3)
    styles = [{"name": names[j], "teams": int((labels == j).sum()),
               "profile": {n: round(float(v), 2) for (n, _, _), v in zip(STYLE_FEATURES, centers[j])}}
              for j in range(k)]
    return out, styles


# ============================================
# COURBES D'ÂGE
# ============================================

def age_curves(players: pd.DataFrame, metrics: list[str], min_age: int = 17, max_age: int = 36,
               prior_n: float = 30.0) -> dict:
    """Évolution attendue d'un percentile d'une saison à la suivante, par rôle et par âge.

    Une observation : un joueur présent deux saisons de suite (sa ligne la plus jouée de
    chaque saison), au même rôle. Deux effets sont séparés :
    - le retour vers la moyenne : delta = beta * (percentile - 50), beta < 0, ajusté par
      rôle et par métrique (un percentile extrême redescend en partie, quel que soit l'âge) ;
    - l'effet de l'âge : moyenne des résidus par âge, lissée sur (a-1, a, a+1) et ramenée
      vers 0 quand les observations sont rares : n / (n + prior_n).
    Projection d'un joueur : percentile + beta * (percentile - 50) + effet de l'âge.
    Biais restant : seuls les joueurs restés au-dessus du seuil de minutes sont observés.
    """
    df = players.dropna(subset=["Player ID", "Age"]).copy()
    df["_start"] = df["_app_season"].str[:4].astype(int)
    df = df.sort_values("Minutes played", ascending=False).drop_duplicates(["Player ID", "_app_season"])
    nxt = df.assign(_start=df["_start"] - 1)
    pairs = df.merge(nxt, on=["Player ID", "_start"], suffixes=("", "_next"))
    pairs = pairs[pairs["Position"] == pairs["Position_next"]]

    curves: dict = {}
    for role, g in pairs.groupby("Position"):
        curves[role] = {}
        for m in metrics:
            a, b = f"{m} pct", f"{m} pct_next"
            if a not in g or b not in g:
                continue
            d = g[[a, b, "Age"]].dropna().astype(float)
            if len(d) < 50:
                continue
            centered = d[a] - 50
            delta = d[b] - d[a]
            spread = float((centered ** 2).sum())
            if spread == 0:                 # percentiles tous à 50 : rien à estimer
                continue
            beta = float((centered * delta).sum() / spread)
            resid = (delta - beta * centered).groupby(d["Age"].astype(int))
            mean, n = resid.mean(), resid.size()
            ages = {}
            for age in range(min_age, max_age + 1):
                win = [x for x in (age - 1, age, age + 1) if x in n.index]
                if not win:
                    continue
                nn = float(n[win].sum())
                mm = float((mean[win] * n[win]).sum() / nn)
                ages[age] = [round(mm * nn / (nn + prior_n), 2), int(nn)]
            curves[role][m] = {"beta": round(beta, 3), "ages": ages}
    return {"pairs": int(len(pairs)), "curves": curves}


# ============================================
# VALEUR ESTIMÉE
# ============================================

def _ridge_fit(x: np.ndarray, y: np.ndarray, alpha: float) -> np.ndarray:
    xb = np.hstack([np.ones((len(x), 1)), x])
    reg = alpha * np.eye(xb.shape[1])
    reg[0, 0] = 0.0                         # pas de pénalité sur la constante
    return np.linalg.solve(xb.T @ xb + reg, xb.T @ y)


def _ridge_predict(x: np.ndarray, w: np.ndarray) -> np.ndarray:
    return np.hstack([np.ones((len(x), 1)), x]) @ w


def estimated_value(players: pd.DataFrame, metrics: list[str], folds: int = 5,
                    alpha: float = 10.0) -> tuple[pd.Series, dict]:
    """Valeur « attendue » d'après la performance, le profil et le championnat.

    Ridge sur log10(valeur Transfermarkt) ; chaque joueur est prédit par un modèle
    entraîné sans lui (validation croisée à `folds` plis), donc l'écart à sa valeur
    réelle n'est pas absorbé par le modèle. Variables : âge et âge², minutes,
    rôle, compétition, note, percentiles par rôle (50 si absent), RAPM net.
    """
    df = players[players["Market value"].notna() & (players["Market value"] > 0)].copy()
    if len(df) < 200:
        return pd.Series(dtype=float), {}

    num = pd.DataFrame(index=df.index)
    num["age"] = df["Age"].fillna(df["Age"].median())
    num["age2"] = num["age"] ** 2
    num["minutes_share"] = df["Minutes share"].fillna(0)
    num["log_minutes"] = np.log1p(df["Minutes played"].fillna(0))
    for m in metrics:
        col = f"{m} pct"
        num[col] = df[col].astype(float).fillna(50) if col in df else 50.0
    num["rapm"] = df["RAPM net"].astype(float).fillna(0) if "RAPM net" in df else 0.0
    cats = pd.get_dummies(df[["Position", "Competition"]].astype(str), dtype=float)
    x_num = num.to_numpy(float)
    mu, sd = x_num.mean(0), x_num.std(0)
    x = np.hstack([(x_num - mu) / np.where(sd > 0, sd, 1), cats.to_numpy(float)])
    y = np.log10(df["Market value"].to_numpy(float))

    rng = np.random.default_rng(RNG_SEED)
    fold = rng.integers(folds, size=len(df))
    pred = np.empty(len(df))
    for f in range(folds):
        w = _ridge_fit(x[fold != f], y[fold != f], alpha)
        pred[fold == f] = _ridge_predict(x[fold == f], w)

    r2 = 1 - ((y - pred) ** 2).sum() / ((y - y.mean()) ** 2).sum()
    mae_factor = float(10 ** np.median(np.abs(y - pred)))
    est = pd.Series(10 ** pred, index=df.index).round(-4)
    return est, {"players": int(len(df)), "r2_cv": round(float(r2), 3),
                 "median_error_factor": round(mae_factor, 2), "folds": folds}


# ============================================
# PRONOSTICS TOUTES COMPÉTITIONS (coupes d'Europe)
# ============================================
#
# Le modèle `forecast` du pipeline s'ajuste championnat par championnat : il ne peut pas
# prédire un match entre deux équipes de championnats différents. Ici, un seul modèle
# de Poisson pour toutes les compétitions, avec deux niveaux de force :
#
#   log lambda = mu + h * domicile + (a[L(att)] + alpha[att]) - (d[L(def)] + delta[def])
#
# a, d : niveau offensif et défensif du championnat de l'équipe ; les matchs de coupe
# d'Europe relient les championnats entre eux. alpha, delta : écart de l'équipe à son
# championnat, ramené vers 0 (ridge) quand elle a peu de matchs. Cible : moitié buts,
# moitié xG ; poids des matchs divisé par deux tous les `half_life` jours ; probabilités
# 1-N-2 par Poisson avec la correction Dixon-Coles des petits scores (rho).

def _dc_tau(x: np.ndarray, y: np.ndarray, lh: np.ndarray, la: np.ndarray, rho: float) -> np.ndarray:
    t = np.ones_like(lh)
    t = np.where((x == 0) & (y == 0), 1 - lh * la * rho, t)
    t = np.where((x == 0) & (y == 1), 1 + lh * rho, t)
    t = np.where((x == 1) & (y == 0), 1 + la * rho, t)
    t = np.where((x == 1) & (y == 1), 1 - rho, t)
    return t


def _poisson_pmf(k: np.ndarray, lam: np.ndarray) -> np.ndarray:
    from math import lgamma
    lg = np.array([lgamma(v + 1) for v in range(int(k.max()) + 1)])
    return np.exp(k * np.log(lam) - lam - lg[k])


class JointRatings:
    """Forces des équipes et des championnats ajustées sur toutes les compétitions."""

    def __init__(self, team_index: dict, team_league: np.ndarray, params: dict):
        self.team_index = team_index
        self.team_league = team_league
        self.p = params

    def rates(self, home: str, away: str) -> tuple[float, float] | None:
        i, j = self.team_index.get(home), self.team_index.get(away)
        if i is None or j is None:
            return None
        p, L = self.p, self.team_league
        att = p["a"][L] + p["alpha"]
        dfn = p["d"][L] + p["delta"]
        lh = np.exp(p["mu"] + p["h"] + att[i] - dfn[j])
        la = np.exp(p["mu"] + att[j] - dfn[i])
        return float(lh), float(la)

    def probabilities(self, home: str, away: str, max_goals: int = 10) -> tuple[float, float, float] | None:
        r = self.rates(home, away)
        if r is None:
            return None
        lh, la = r
        g = np.arange(max_goals + 1)
        x, y = np.meshgrid(g, g, indexing="ij")
        m = _poisson_pmf(x, np.full(x.shape, lh)) * _poisson_pmf(y, np.full(y.shape, la))
        m = m * _dc_tau(x, y, np.full(x.shape, lh), np.full(x.shape, la), self.p["rho"])
        m = m / m.sum()
        return float(np.tril(m, -1).sum()), float(np.trace(m)), float(np.triu(m, 1).sum())


def fit_joint(matches: pd.DataFrame, team_league: dict[str, str], at: pd.Timestamp,
              half_life: float = 180.0, ridge_team: float = 4.0, ridge_league: float = 0.5,
              sweeps: int = 80) -> JointRatings:
    """Ajuste le modèle sur les matchs joués avant `at`.

    matches : une ligne par match (date, home, away, goals_home, goals_away, xg_home, xg_away).
    team_league : championnat national de chaque équipe (« OTHER » si inconnu).
    """
    m = matches[matches["date"] < at]
    teams = sorted(set(m["home"]) | set(m["away"]))
    t_idx = {t: k for k, t in enumerate(teams)}
    leagues = sorted({team_league.get(t, "OTHER") for t in teams})
    l_idx = {l: k for k, l in enumerate(leagues)}
    t_league = np.array([l_idx[team_league.get(t, "OTHER")] for t in teams])

    # Deux observations par match : l'équipe à domicile attaque, puis l'équipe à l'extérieur
    hi, ai = m["home"].map(t_idx).to_numpy(), m["away"].map(t_idx).to_numpy()
    yh = 0.5 * m["goals_home"].to_numpy(float) + 0.5 * m["xg_home"].fillna(m["goals_home"]).to_numpy(float)
    ya = 0.5 * m["goals_away"].to_numpy(float) + 0.5 * m["xg_away"].fillna(m["goals_away"]).to_numpy(float)
    age = (at - m["date"]).dt.days.to_numpy(float)
    w1 = 0.5 ** (age / half_life)
    att = np.concatenate([hi, ai]); dfn = np.concatenate([ai, hi])
    home = np.concatenate([np.ones(len(m)), np.zeros(len(m))])
    y = np.concatenate([yh, ya]); w = np.concatenate([w1, w1])
    la_att, la_def = t_league[att], t_league[dfn]
    nt, nl = len(teams), len(leagues)

    p = {"mu": float(np.log(max(np.average(y, weights=w), 1e-3))), "h": 0.0,
         "a": np.zeros(nl), "d": np.zeros(nl), "alpha": np.zeros(nt), "delta": np.zeros(nt)}

    def lam():
        return np.exp(p["mu"] + p["h"] * home + p["a"][la_att] + p["alpha"][att]
                      - p["d"][la_def] - p["delta"][dfn])

    def newton(idx, n, sign, value, ridge):
        """Un pas de Newton par paramètre d'un groupe (log-vraisemblance + pénalité ridge)."""
        r = w * (y - lam())
        g = sign * np.bincount(idx, r, n) - ridge * value
        hss = np.bincount(idx, w * lam(), n) + ridge
        return value + g / hss

    for _ in range(sweeps):
        lm = lam()
        p["mu"] += (w * (y - lm)).sum() / (w * lm).sum()
        lm = lam()
        p["h"] += (w * home * (y - lm)).sum() / max((w * home * lm).sum(), 1e-9)
        p["a"] = newton(la_att, nl, 1, p["a"], ridge_league)
        p["d"] = newton(la_def, nl, -1, p["d"], ridge_league)
        p["alpha"] = newton(att, nt, 1, p["alpha"], ridge_team)
        p["delta"] = newton(dfn, nt, -1, p["delta"], ridge_team)
        # Identifiabilité : niveaux de championnat centrés (mu porte la moyenne)
        shift = np.average(p["a"], weights=np.bincount(t_league, minlength=nl) + 1e-9)
        p["a"] -= shift; p["mu"] += shift
        shift = np.average(p["d"], weights=np.bincount(t_league, minlength=nl) + 1e-9)
        p["d"] -= shift; p["mu"] -= shift

    # rho de Dixon-Coles : maximum de vraisemblance sur les scores entiers, par grille
    lh_all = lam()[: len(m)]; la_all = lam()[len(m):]
    gh, ga = m["goals_home"].to_numpy(int), m["goals_away"].to_numpy(int)
    best = (0.0, -np.inf)
    for rho in np.arange(-0.25, 0.11, 0.01):
        tau = _dc_tau(gh, ga, lh_all, la_all, rho)
        if (tau <= 0).any():
            continue
        ll = (w1 * np.log(tau)).sum()
        if ll > best[1]:
            best = (float(rho), ll)
    p["rho"] = best[0]
    return JointRatings(t_idx, t_league, p)


def _rps(p: tuple[float, float, float], outcome: int) -> float:
    cum = np.cumsum(p)[:2]
    obs = np.cumsum([outcome == 0, outcome == 1, outcome == 2])[:2]
    return float(((cum - obs) ** 2).sum() / 2)


def backtest_joint(matches: pd.DataFrame, team_league: dict[str, str], cup_keys: set[str],
                   days: int = 300, step: int = 14) -> dict:
    """Validation hors échantillon sur les matchs de coupe : tous les `step` jours, ajustement
    sur les seuls matchs antérieurs, prédiction des matchs de coupe des `step` jours suivants.
    Référence : fréquences 1-N-2 des matchs de coupe antérieurs. Score : RPS (plus bas = mieux)."""
    end = matches["date"].max()
    rps_model, rps_base, n = [], [], 0
    for start in pd.date_range(end - pd.Timedelta(days=days), end, freq=f"{step}D"):
        test = matches[(matches["date"] >= start) & (matches["date"] < start + pd.Timedelta(days=step))
                       & matches["competition"].isin(cup_keys)]
        if test.empty:
            continue
        past_cups = matches[(matches["date"] < start) & matches["competition"].isin(cup_keys)]
        if len(past_cups) < 30:
            continue
        outcome_past = np.sign(past_cups["goals_away"] - past_cups["goals_home"]) + 1
        # 0 = victoire à domicile, 1 = nul, 2 = victoire à l'extérieur
        base = tuple(np.bincount(outcome_past.astype(int), minlength=3) / len(past_cups))
        model = fit_joint(matches, team_league, start)
        for r in test.itertuples():
            pr = model.probabilities(r.home, r.away)
            if pr is None:
                continue
            outcome = 0 if r.goals_home > r.goals_away else 1 if r.goals_home == r.goals_away else 2
            rps_model.append(_rps(pr, outcome)); rps_base.append(_rps(base, outcome)); n += 1
    if n == 0:
        return {}
    return {"matches": n, "rps_model": round(float(np.mean(rps_model)), 4),
            "rps_baseline": round(float(np.mean(rps_base)), 4)}


# ============================================
# SIMULATION DE FIN DE SAISON ET ENJEU DES MATCHS
# ============================================
#
# Recherche : « la valeur n'est pas dans une meilleure prévision mais dans ce qu'on construit
# sur une prévision calibrée » (Serie A, 2026) : probabilités d'objectifs de saison, et enjeu
# d'un match = variation de la probabilité d'atteindre l'objectif entre victoire et défaite.

OBJECTIVES = {"title": "titre", "top4": "top 4", "bottom3": "relégation (3 derniers)"}


def simulate_season(table: pd.DataFrame, fixtures: pd.DataFrame, n: int = 20000,
                    leverage_until: pd.Timestamp | None = None) -> tuple[list[dict], dict]:
    """Simule les matchs restants d'un championnat avec les probabilités 1-N-2 du pipeline.

    table : classement actuel (team_id, team, points, diff) ; fixtures : matchs restants
    (match_id, date, home_id, away_id, p_home, p_draw, p_away). Départage : différence de
    buts approchée (+1 / -1 par victoire / défaite simulée), puis tirage au sort.
    Renvoie les probabilités par équipe et, pour les matchs jusqu'à `leverage_until`,
    l'enjeu de chaque équipe : max sur les objectifs de |P(objectif | V) - P(objectif | D)|.
    """
    rng = np.random.default_rng(RNG_SEED)
    teams = table["team_id"].tolist()
    idx = {t: i for i, t in enumerate(teams)}
    fx = fixtures[fixtures["home_id"].isin(idx) & fixtures["away_id"].isin(idx)].reset_index(drop=True)
    nt, nm = len(teams), len(fx)

    u = rng.random((n, nm))
    ph = fx["p_home"].to_numpy(float); pdr = fx["p_draw"].to_numpy(float)
    out = np.where(u < ph, 0, np.where(u < ph + pdr, 1, 2)).astype(np.int8)

    pts = np.tile(table["points"].to_numpy(float), (n, 1))
    gd = np.tile(table["diff"].to_numpy(float), (n, 1))
    hi = fx["home_id"].map(idx).to_numpy(); ai = fx["away_id"].map(idx).to_numpy()
    for j in range(nm):
        o = out[:, j]
        pts[:, hi[j]] += np.where(o == 0, 3, np.where(o == 1, 1, 0))
        pts[:, ai[j]] += np.where(o == 2, 3, np.where(o == 1, 1, 0))
        swing = np.where(o == 0, 1, np.where(o == 2, -1, 0))
        gd[:, hi[j]] += swing
        gd[:, ai[j]] -= swing

    score = pts * 1000 + gd + rng.random((n, nt)) * 1e-3
    pos = np.argsort(np.argsort(-score, axis=1), axis=1)      # 0 = premier
    goals = {"title": pos == 0, "top4": pos < 4, "bottom3": pos >= nt - 3}

    rows = []
    for t, i in idx.items():
        r = table.iloc[i]
        rows.append({
            "team_id": t, "team": r["team"],
            "pTitle": round(float(goals["title"][:, i].mean()), 4),
            "pTop4": round(float(goals["top4"][:, i].mean()), 4),
            "pBottom3": round(float(goals["bottom3"][:, i].mean()), 4),
            "expectedRank": round(float(pos[:, i].mean() + 1), 1),
            "expectedPoints": round(float(pts[:, i].mean()), 1),
        })

    leverage: dict = {}
    if leverage_until is not None and nm:
        soon = pd.to_datetime(fx["date"]) <= leverage_until
        for j in np.nonzero(soon.to_numpy())[0]:
            o = out[:, j]
            entry = {}
            for side, team_i, win, loss in (("home", hi[j], 0, 2), ("away", ai[j], 2, 0)):
                w, l = o == win, o == loss
                if w.sum() < 100 or l.sum() < 100:
                    continue
                best = max(((abs(float(goals[g][w, team_i].mean() - goals[g][l, team_i].mean())), g) for g in goals))
                entry[side] = {"objective": OBJECTIVES[best[1]], "delta": round(best[0], 3)}
            if entry:
                leverage[str(fx.loc[j, "match_id"])] = entry
    return rows, leverage
