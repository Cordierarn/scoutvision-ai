"""
ScoutVision AI - Modèles calculés à la préparation des données (numpy seul)

- styles de jeu des équipes : ACP + k-means sur les indicateurs de team_season
- courbes d'âge : évolution moyenne des percentiles d'une saison à l'autre, par rôle et par âge
- valeur estimée : régression ridge de log10(valeur Transfermarkt), prédictions hors échantillon
- transferts : traduction d'un percentile d'un club et d'un championnat à un autre
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
# TRANSFERTS : D'UN CLUB ET D'UN CHAMPIONNAT À L'AUTRE
# ============================================
#
# Recherche (release « recherche ») : la performance se transfère mal d'un contexte à
# l'autre (championnat, style, coéquipiers). Un recrutement fondé sur les données projette
# le joueur dans le club qui recrute au lieu de reprendre ses chiffres actuels.
#
# Une saison plus tard, au même rôle, sur la projection des courbes d'âge :
#
#   percentile' = projection + lambda[m] * (L[championnat quitté] - L[championnat rejoint])
#                 + tau[m] * (domination territoriale de la nouvelle équipe - de l'ancienne)
#                 + kappa_ligue[m] (changement de championnat) + kappa_club[m] (de club)
#
# L : un niveau par championnat, commun à toutes les métriques, ramené vers la moyenne des
# championnats du même niveau PitchAPI quand les transferts observés sont rares. Les
# percentiles PitchAPI sont calculés par niveau (1, 2, 3) : L mêle la force du championnat
# et ce changement de groupe de référence, c'est une traduction, pas un classement de force.
# kappa : coût d'adaptation moyen d'un changement de championnat ou de club.
# Moindres carrés alternés (L, puis les coefficients de chaque métrique), paires pondérées
# par la moyenne harmonique des minutes des deux saisons.

TRANSFER_CONTEXT = ("Team field tilt",)


def _transfer_pairs(players: pd.DataFrame, metrics: list[str], cups: set[str]) -> pd.DataFrame:
    """Deux saisons consécutives en championnat (ligne la plus jouée), au même rôle.

    La seconde saison doit être terminée : la saison la plus récente des données est exclue.
    """
    df = players[~players["Competition"].isin(cups)].dropna(subset=["Player ID", "Age", "Position"])
    df = df.sort_values("Minutes played", ascending=False).drop_duplicates(["Player ID", "_app_season"]).copy()
    for col in TRANSFER_CONTEXT:
        if col not in df:
            df[col] = np.nan
    df["_start"] = df["_app_season"].str[:4].astype(int)
    cols = ["Player ID", "_start", "_app_season", "Competition", "Team ID", "Position", "Age",
            "Minutes played", *TRANSFER_CONTEXT, *(f"{m} pct" for m in metrics)]
    df = df[cols]
    pairs = df.merge(df.assign(_start=df["_start"] - 1), on=["Player ID", "_start"], suffixes=("", "_next"))
    keep = ((pairs["Position"] == pairs["Position_next"])
            & (pairs["_app_season_next"] != players["_app_season"].max()))
    return pairs[keep].reset_index(drop=True)


def _development_pct(pairs: pd.DataFrame, curves: dict, metrics: list[str]) -> dict[str, np.ndarray]:
    """Projection des courbes d'âge (utils/development.ts, sans arrondi) ; NaN sans courbe."""
    ages = pairs["Age"].round().astype(int).to_numpy()
    roles = pairs["Position"].to_numpy()
    out = {}
    for m in metrics:
        x = pairs[f"{m} pct"].to_numpy(float)
        beta = np.full(len(pairs), np.nan)
        effect = np.zeros(len(pairs))
        for role in np.unique(roles):
            curve = curves.get(role, {}).get(m)
            if curve is None:
                continue
            sel = roles == role
            beta[sel] = curve["beta"]
            by_age = {int(age): v[0] for age, v in curve["ages"].items()}
            effect[sel] = [by_age.get(age, 0.0) for age in ages[sel]]
        out[m] = np.clip(x + beta * (x - 50) + effect, 0, 100)
    return out


def _transfer_terms(pairs: pd.DataFrame) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Termes communs aux métriques : écarts de contexte, changement de championnat, de club."""
    league = (pairs["Competition"] != pairs["Competition_next"]).to_numpy()
    club = ~league & (pairs["Team ID"] != pairs["Team ID_next"]).to_numpy()
    context = [np.nan_to_num((pairs[f"{c}_next"] - pairs[c]).to_numpy(float)) for c in TRANSFER_CONTEXT]
    return np.column_stack([*context, league, club]).astype(float), league, club


def _league_levels(levels: dict[str, float], tiers: dict[str, int]) -> dict[int, float]:
    """Niveau moyen des championnats de chaque niveau PitchAPI (repli d'un championnat inconnu)."""
    by_tier: dict[int, list[float]] = {}
    for league, value in levels.items():
        by_tier.setdefault(tiers.get(league, 2), []).append(value)
    return {t: float(np.mean(v)) for t, v in sorted(by_tier.items())}


def _fit_transfer(pairs: pd.DataFrame, dev: dict[str, np.ndarray], metrics: list[str],
                  tiers: dict[str, int], prior_pairs: float = 10.0, coef_prior_pairs: float = 10.0,
                  iters: int = 100, min_pairs: int = 150, min_movers: int = 20) -> dict:
    """Niveaux de championnat et coefficients par métrique sur les résidus de `dev`.

    prior_pairs : poids du rappel des niveaux vers la moyenne du niveau PitchAPI, en
    nombre de transferts ; coef_prior_pairs : rappel des coefficients d'une métrique vers
    ceux de la métrique moyenne (lambda) ou vers 0 (contexte, coûts d'adaptation), utile
    aux métriques de gardien, observées sur peu de transferts. Échelle finale : lambda
    moyen = 1 (L en points de percentile).
    """
    leagues = sorted(set(pairs["Competition"]) | set(pairs["Competition_next"]))
    index = {league: i for i, league in enumerate(leagues)}
    a = pairs["Competition"].map(index).to_numpy()
    b = pairs["Competition_next"].map(index).to_numpy()
    minutes, minutes_next = pairs["Minutes played"].to_numpy(float), pairs["Minutes played_next"].to_numpy(float)
    w = 1 / (1 / minutes + 1 / minutes_next) / 1000
    terms, moved, _ = _transfer_terms(pairs)
    tier = np.array([tiers.get(league, 2) for league in leagues], float)

    resid = {}
    for m in metrics:
        y = pairs[f"{m} pct_next"].to_numpy(float)
        ok = ~np.isnan(y) & ~np.isnan(dev[m])
        if ok.sum() >= min_pairs and (ok & moved).sum() >= min_movers:
            resid[m] = (ok, y - dev[m])
    if not resid:
        return {}

    def coefficients(level: np.ndarray, lam_prior: float) -> tuple[dict, dict]:
        gap = level[a] - level[b]
        ridge = (coef_prior_pairs * float(np.median(w)) + 1e-2) * np.eye(terms.shape[1] + 1)
        prior = np.zeros(terms.shape[1] + 1)
        prior[0] = lam_prior
        lam, coef = {}, {}
        for m, (ok, r) in resid.items():
            x = np.column_stack([gap, terms])[ok]
            wo = w[ok]
            c = np.linalg.solve(x.T @ (x * wo[:, None]) + ridge, x.T @ (r[ok] * wo) + ridge @ prior)
            lam[m], coef[m] = float(c[0]), c[1:]
        return lam, coef

    n, nm = len(leagues), len(resid)
    level = 2.0 - tier                          # départ : niveau 1 au-dessus, niveau 3 en dessous
    level = (level - level.mean()) / (level.std() or 1.0)
    lam_prior = 0.0
    for _ in range(iters):
        lam, coef = coefficients(level, lam_prior)
        lam_prior = float(np.mean(list(lam.values())))
        # Niveaux : moindres carrés sur toutes les métriques des joueurs qui ont changé de
        # championnat ; chaque joueur compte une fois (poids divisés par le nombre de métriques)
        gram, rhs = np.zeros((n, n)), np.zeros(n)
        for m, (ok, r) in resid.items():
            o = ok & moved
            rest = r[o] - terms[o] @ coef[m]
            ww = w[o] * lam[m] ** 2 / nm
            g = w[o] * lam[m] * rest / nm
            np.add.at(gram, (a[o], a[o]), ww)
            np.add.at(gram, (b[o], b[o]), ww)
            np.add.at(gram, (a[o], b[o]), -ww)
            np.add.at(gram, (b[o], a[o]), -ww)
            np.add.at(rhs, a[o], g)
            np.add.at(rhs, b[o], -g)
        ridge = prior_pairs * float(np.median(w)) * float(np.mean([v * v for v in lam.values()]))
        prior = np.array([level[tier == t].mean() for t in tier])
        new = np.linalg.solve(gram + ridge * np.eye(n), rhs + ridge * prior)
        new = (new - new.mean()) / (new.std() or 1.0)
        converged = float(np.max(np.abs(new - level))) < 1e-6
        level = new
        if converged:
            break
    lam, coef = coefficients(level, lam_prior)

    scale = float(np.mean(list(lam.values())))
    return {"level": dict(zip(leagues, level * scale)),
            "lambda": {m: v / scale for m, v in lam.items()}, "coef": coef}


def _transfer_predict(fit: dict, pairs: pd.DataFrame, base: np.ndarray, metric: str,
                      tiers: dict[str, int]) -> np.ndarray:
    """Percentile prévu au nouveau club : base (projection des courbes d'âge) + transfert."""
    if metric not in fit["lambda"]:
        return base
    by_tier = _league_levels(fit["level"], tiers)
    level = {league: fit["level"].get(league, by_tier.get(tiers.get(league, 2), 0.0))
             for league in set(pairs["Competition"]) | set(pairs["Competition_next"])}
    gap = (pairs["Competition"].map(level) - pairs["Competition_next"].map(level)).to_numpy(float)
    terms, _, _ = _transfer_terms(pairs)
    return np.clip(base + fit["lambda"][metric] * gap + terms @ fit["coef"][metric], 0, 100)


def role_index(pct: dict[str, np.ndarray], preset: dict, core_weight: float) -> np.ndarray:
    """Indice d'un rôle (utils/rolePresets.ts) sur des tableaux de percentiles, sans le
    bonus de profil de milieu ; NaN quand aucune métrique du rôle n'a de percentile."""
    weights = dict(preset.get("weights", {}))
    for key in preset["metrics"]:
        weights.setdefault(key, core_weight)
    size = len(next(iter(pct.values())))
    num, den = np.zeros(size), np.zeros(size)
    for key, weight in weights.items():
        v = pct.get(key)
        if v is None or weight == 0:
            continue
        ok = ~np.isnan(v)
        num += np.where(ok, abs(weight) * (100 - v if weight < 0 else v), 0)
        den += np.where(ok, abs(weight), 0)
    with np.errstate(invalid="ignore", divide="ignore"):
        return np.where(den > 0, num / den, np.nan)


def _spearman(x: np.ndarray, y: np.ndarray) -> float:
    return float(pd.Series(x).rank().corr(pd.Series(y).rank()))


def _validate_transfer(players: pd.DataFrame, pairs: pd.DataFrame, metrics: list[str],
                       tiers: dict[str, int], presets: dict | None) -> dict:
    """Validation hors échantillon : modèles ajustés sans la dernière saison terminée
    (courbes d'âge comprises), erreurs sur les paires qui s'y terminent.

    Trois prévisions : percentile inchangé, courbes d'âge seules, modèle complet (sans courbe
    pour le rôle, la projection garde le percentile, comme l'app). Erreur absolue moyenne et
    biais (prévu - observé) par métrique et sur l'indice des rôles.
    """
    season = pairs["_app_season_next"].max()
    test = (pairs["_app_season_next"] == season).to_numpy()
    curves = age_curves(players[players["_app_season"] < season], metrics)["curves"]
    dev_all = _development_pct(pairs, curves, metrics)
    train = pairs[~test].reset_index(drop=True)
    fit = _fit_transfer(train, {m: v[~test] for m, v in dev_all.items()}, metrics, tiers)
    if not fit:
        return {}
    tp = pairs[test].reset_index(drop=True)
    dev = {m: v[test] for m, v in dev_all.items()}
    _, moved, club = _transfer_terms(tp)
    by_tier = _league_levels(fit["level"], tiers)

    def level(comps: pd.Series) -> np.ndarray:
        return comps.map(lambda c: fit["level"].get(c, by_tier.get(tiers.get(c, 2), 0.0))).to_numpy(float)

    up = moved & (level(tp["Competition_next"]) > level(tp["Competition"]))
    down = moved & (level(tp["Competition_next"]) < level(tp["Competition"]))
    groups = {"movers": moved, "clubChanges": club, "all": np.ones(len(tp), bool), "up": up, "down": down}

    forecasts: dict[str, dict[str, np.ndarray]] = {"persistence": {}, "development": {}, "model": {}}
    truth = {}
    for m in metrics:
        x = tp[f"{m} pct"].to_numpy(float)
        base = np.where(np.isnan(dev[m]), x, dev[m])
        truth[m] = tp[f"{m} pct_next"].to_numpy(float)
        forecasts["persistence"][m] = x
        forecasts["development"][m] = base
        forecasts["model"][m] = _transfer_predict(fit, tp, base, m, tiers)

    def errors(pred: dict[str, np.ndarray], true: dict[str, np.ndarray], sel: np.ndarray) -> tuple[float, float]:
        diff = np.concatenate([(pred[k] - true[k])[sel & ~np.isnan(true[k]) & ~np.isnan(pred[k])] for k in true])
        return float(np.abs(diff).mean()), float(diff.mean())

    def table(pred_by: dict, true: dict) -> dict:
        out = {}
        for g in ("movers", "clubChanges", "all"):
            out[g] = {name: round(errors(p, true, groups[g])[0], 2) for name, p in pred_by.items()}
        for g, key in (("up", "biasUp"), ("down", "biasDown")):
            out[key] = {name: round(errors(p, true, groups[g])[1], 2) for name, p in pred_by.items()}
        return out

    result = {"season": season, "pairs": int(test.sum()), "movers": int(moved.sum()),
              "clubChanges": int(club.sum()), "up": int(up.sum()), "down": int(down.sum()),
              "metric": table(forecasts, truth)}

    if presets:
        core = float(presets.get("coreWeight", 1.5))
        roles = tp["Position"].to_numpy()
        idx_true, idx_pred = [], {name: [] for name in forecasts}
        rank = {name: [] for name in forecasts}
        sel_rows = []
        for preset in presets["presets"].values():
            rows = np.isin(roles, preset["positions"])
            if not rows.any():
                continue
            t = role_index(truth, preset, core)
            for name, f in forecasts.items():
                p = role_index(f, preset, core)
                idx_pred[name].append(p[rows])
                mv = rows & moved & ~np.isnan(t) & ~np.isnan(p)
                if mv.sum() >= 20:
                    rank[name].append((_spearman(p[mv], t[mv]), int(mv.sum())))
            idx_true.append(t[rows])
            sel_rows.append(np.nonzero(rows)[0])
        rows_all = np.concatenate(sel_rows)
        t_all = np.concatenate(idx_true)
        index_groups = {g: sel[rows_all] for g, sel in groups.items()}

        def index_errors(p_all: np.ndarray, g: str) -> tuple[float, float]:
            ok = index_groups[g] & ~np.isnan(t_all) & ~np.isnan(p_all)
            d = p_all[ok] - t_all[ok]
            return float(np.abs(d).mean()), float(d.mean())

        preds = {name: np.concatenate(v) for name, v in idx_pred.items()}
        index = {g: {name: round(index_errors(p, g)[0], 2) for name, p in preds.items()}
                 for g in ("movers", "clubChanges", "all")}
        index["biasUp"] = {name: round(index_errors(p, "up")[1], 2) for name, p in preds.items()}
        index["biasDown"] = {name: round(index_errors(p, "down")[1], 2) for name, p in preds.items()}
        index["rankMovers"] = {name: round(sum(r * k for r, k in v) / sum(k for _, k in v), 3)
                               for name, v in rank.items() if v}
        result["index"] = index
    return result


def transfer_model(players: pd.DataFrame, metrics: list[str], curves: dict, cups: set[str],
                   tiers: dict[str, int], presets: dict | None = None, prior_pairs: float = 10.0) -> dict:
    """Modèle de transfert (voir plus haut) et sa validation ; {} si trop peu de transferts.

    curves : courbes d'âge de l'app (age_curves(...)["curves"]) ; presets : utils/rolePresets.json,
    pour valider aussi l'indice des rôles.
    """
    metrics = [m for m in dict.fromkeys(metrics) if f"{m} pct" in players.columns]
    pairs = _transfer_pairs(players, metrics, cups)
    moved = (pairs["Competition"] != pairs["Competition_next"]).to_numpy()
    if moved.sum() < 200 or pairs["_app_season_next"].nunique() < 2:
        return {}
    fit = _fit_transfer(pairs, _development_pct(pairs, curves, metrics), metrics, tiers, prior_pairs)
    if not fit:
        return {}
    _, _, club = _transfer_terms(pairs)
    moves = pd.concat([pairs.loc[moved, "Competition"], pairs.loc[moved, "Competition_next"]]).value_counts()
    nctx = len(TRANSFER_CONTEXT)
    return {
        "pairs": int(len(pairs)), "movers": int(moved.sum()), "clubChanges": int(club.sum()),
        "context": list(TRANSFER_CONTEXT),
        "leagues": {league: {"level": round(v, 2), "moves": int(moves.get(league, 0))}
                    for league, v in sorted(fit["level"].items(), key=lambda kv: -kv[1])},
        "tierLevels": {str(t): round(v, 2) for t, v in _league_levels(fit["level"], tiers).items()},
        "metrics": {m: {"league": round(lam, 3),
                        "context": [round(float(c), 3) for c in fit["coef"][m][:nctx]],
                        "leagueChange": round(float(fit["coef"][m][nctx]), 2),
                        "clubChange": round(float(fit["coef"][m][nctx + 1]), 2)}
                    for m, lam in fit["lambda"].items()},
        "validation": _validate_transfer(players, pairs, metrics, tiers, presets) or None,
    }


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

    def score_matrix(self, home: str, away: str, max_goals: int = 10) -> np.ndarray | None:
        """Probabilités des scores (domicile en lignes, extérieur en colonnes), Dixon-Coles."""
        r = self.rates(home, away)
        if r is None:
            return None
        lh, la = r
        g = np.arange(max_goals + 1)
        x, y = np.meshgrid(g, g, indexing="ij")
        m = _poisson_pmf(x, np.full(x.shape, lh)) * _poisson_pmf(y, np.full(y.shape, la))
        m = m * _dc_tau(x, y, np.full(x.shape, lh), np.full(x.shape, la), self.p["rho"])
        return m / m.sum()

    def probabilities(self, home: str, away: str, max_goals: int = 10) -> tuple[float, float, float] | None:
        m = self.score_matrix(home, away, max_goals)
        if m is None:
            return None
        return float(np.tril(m, -1).sum()), float(np.trace(m)), float(np.triu(m, 1).sum())

    def prob_over(self, home: str, away: str, line: float = 2.5) -> float | None:
        """Probabilité que le total de buts dépasse `line`."""
        m = self.score_matrix(home, away)
        if m is None:
            return None
        g = np.arange(m.shape[0])
        total = g[:, None] + g[None, :]
        return float(m[total > line].sum())


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
