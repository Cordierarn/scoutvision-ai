"""
ScoutVision AI - Laboratoire : idées neuves testées sur les données match par match

Chaque expérience pose une question, la teste sur les tables PitchAPI de toutes les
compétitions (hors échantillon quand c'est une prévision) et rend un verdict chiffré ;
certaines alimentent un outil de la page Labo. numpy et pandas seuls.

Verdicts :
- validated : effet net (intervalle de confiance qui exclut zéro, ou gain hors échantillon) ;
- partial : signal réel mais faible, ou limité à une partie de la question ;
- debunked : idée reçue démentie (effet nul ou non reproductible) ;
- measured : mesure descriptive, sans hypothèse à trancher.
"""

from __future__ import annotations

from math import factorial

import numpy as np
import pandas as pd

RNG_SEED = 7

# Style d'une équipe (team_match), avec le sens « plus c'est haut, plus le trait est marqué »
STYLE = {
    "possession": ("adv_territory__possession_pct", 1),
    "territoire": ("adv_territory__field_tilt", 1),
    "pressing": ("adv_defending__ppda", -1),               # PPDA bas = pressing intense
    "construction": ("adv_tempo__passes_per_sequence", 1),
    "verticalité": ("adv_tempo__direct_speed", 1),
    "hauteur": ("adv_territory__avg_action_x", 1),
}


# ============================================
# OUTILS
# ============================================

def _corr(a, b) -> float:
    a, b = np.asarray(a, float), np.asarray(b, float)
    ok = ~np.isnan(a) & ~np.isnan(b)
    return float(np.corrcoef(a[ok], b[ok])[0, 1]) if ok.sum() > 2 else float("nan")


def _ci(samples) -> list[float]:
    s = np.asarray(samples, float)
    s = s[~np.isnan(s)]
    return [round(float(np.percentile(s, 2.5)), 4), round(float(np.percentile(s, 97.5)), 4)]


def _boot_corr(a, b, n: int = 1000) -> list[float]:
    a, b = np.asarray(a, float), np.asarray(b, float)
    rng = np.random.default_rng(RNG_SEED)
    return _ci([_corr(a[i], b[i]) for i in (rng.integers(0, len(a), len(a)) for _ in range(n))])


def _logit_fit(x: np.ndarray, y: np.ndarray, l2: float = 1.0, iters: int = 60) -> np.ndarray:
    """Régression logistique (Newton), pénalité ridge hors constante."""
    w = np.zeros(x.shape[1])
    pen = l2 * np.eye(x.shape[1])
    pen[0, 0] = 0.0
    for _ in range(iters):
        p = 1 / (1 + np.exp(-x @ w))
        step = np.linalg.solve(x.T @ (x * (p * (1 - p))[:, None]) + pen, x.T @ (y - p) - pen @ w)
        w = w + step
        if np.max(np.abs(step)) < 1e-8:
            break
    return w


def _auc(p: np.ndarray, y: np.ndarray) -> float:
    rank = pd.Series(p).rank().to_numpy()
    n1 = float(y.sum())
    n0 = len(y) - n1
    return float((rank[y == 1].sum() - n1 * (n1 + 1) / 2) / (n1 * n0)) if n1 and n0 else float("nan")


def _season_pairs(df: pd.DataFrame, col: str, key: list[str]) -> tuple[float, int]:
    """Corrélation d'une mesure entre deux saisons consécutives (même clé)."""
    d = df.dropna(subset=[col]).copy()
    d["_y"] = d["app_season"].str[:4].astype(int)
    nxt = d.assign(_y=d["_y"] - 1)[key + ["_y", col]]
    p = d.merge(nxt, on=key + ["_y"], suffixes=("", "_next"))
    return _corr(p[col], p[f"{col}_next"]), int(len(p))


def _by_match(df: pd.DataFrame, cols: list[str]) -> tuple[dict[str, tuple[int, int]], dict[str, np.ndarray]]:
    """Colonnes d'un tableau trié par match, et position (début, fin) de chaque match : des tranches
    de tableaux numpy plutôt qu'un petit DataFrame par match (mémoire)."""
    d = df.sort_values("match_id", kind="stable")
    ids = d["match_id"].to_numpy()
    if len(ids) == 0:
        return {}, {c: np.array([]) for c in cols}
    cut = np.flatnonzero(ids[1:] != ids[:-1]) + 1
    starts = np.concatenate([[0], cut])
    ends = np.concatenate([cut, [len(ids)]])
    return ({ids[a]: (int(a), int(b)) for a, b in zip(starts, ends)},
            {c: d[c].to_numpy() for c in cols})


def _poisson_pmf(lam, k_max: int = 10) -> np.ndarray:
    k = np.arange(k_max + 1)
    lam = np.asarray(lam, float)[:, None]
    return np.exp(-lam) * lam ** k / np.array([factorial(int(i)) for i in k], float)


# ============================================
# PERFORMANCE PAR MATCH
# ============================================

def team_matches(tm: pd.DataFrame, cups: set[str]) -> pd.DataFrame:
    """Une ligne par équipe et par match joué, toutes compétitions, avec :
    - perf : xG différentiel face à un adversaire moyen sur terrain neutre (championnats :
      force de l'adversaire = son xGD moyen de la saison sans ce match ; avantage du terrain du
      championnat-saison) ;
    - expected_xgd : ce que prévoient la force des deux équipes et le terrain.
    """
    tm = tm.dropna(subset=["xg_for", "xg_against", "goals_for", "goals_against"]).copy()
    tm["date"] = pd.to_datetime(tm["date"], format="mixed", utc=True).dt.tz_localize(None)
    tm["league"] = ~tm["comp"].isin(cups)
    tm["xgd"] = tm["xg_for"] - tm["xg_against"]
    gd = tm["goals_for"] - tm["goals_against"]
    tm["pts"] = np.where(gd > 0, 3, np.where(gd == 0, 1, 0))
    key = ["comp", "app_season"]
    lg = tm[tm["league"]]
    g = lg.groupby(key + ["team_id"])["xgd"]
    rating = (g.transform("sum") - lg["xgd"]) / (g.transform("count") - 1).replace(0, np.nan)
    tm.loc[lg.index, "team_rating"] = rating
    opp = tm.loc[lg.index, key + ["match_id", "team_id", "team_rating"]].rename(
        columns={"team_id": "opponent_id", "team_rating": "opp_rating"})
    tm = tm.merge(opp, on=key + ["match_id", "opponent_id"], how="left")
    home = tm[tm["league"] & (tm["is_home"] == True)].groupby(key)["xgd"].mean().rename("home_adv")
    tm = tm.merge(home, on=key, how="left")
    half = np.where(tm["is_home"] == True, 0.5, -0.5) * tm["home_adv"]
    tm["perf"] = tm["xgd"] - half + tm["opp_rating"]
    tm["expected_xgd"] = half + tm["team_rating"] - tm["opp_rating"]
    return tm.sort_values(["team_id", "date"]).reset_index(drop=True)


# ============================================
# ENTRAÎNEURS
# ============================================
#
# Le nom de l'entraîneur figure sur chaque feuille de match (table lineup). Une période =
# une suite de matchs consécutifs (toutes compétitions) avec le même entraîneur.

# Une courte période (suspension, absence : l'adjoint sur la feuille de match) encadrée par le même
# entraîneur ne compte pas comme un changement
SHORT_ABSENCE = 5


def _coach_key(name: str) -> str:
    """Nom comparable : sans accents ni majuscules (« Luis García » = « Luis Garcia »)."""
    import unicodedata
    return "".join(c for c in unicodedata.normalize("NFKD", str(name)) if not unicodedata.combining(c)).lower().strip()


def coach_by_match(lineup: pd.DataFrame) -> pd.DataFrame:
    """(match_id, team_id) -> entraîneur, d'après les titulaires de la feuille de match ; la graphie
    affichée d'un entraîneur est la plus fréquente."""
    st = lineup[(lineup["role"] == "starter") & lineup["coach_name"].notna()]
    out = (st.groupby(["match_id", "team_id"])["coach_name"].agg(lambda x: x.mode().iat[0])
           .rename("coach").reset_index())
    out["coach_key"] = out["coach"].map(_coach_key)
    display = out.groupby("coach_key")["coach"].agg(lambda x: x.mode().iat[0])
    out["coach"] = out["coach_key"].map(display)
    return out


def _with_spells(tm: pd.DataFrame, coaches: pd.DataFrame) -> pd.DataFrame:
    """Matchs de chaque équipe dans l'ordre, avec le numéro de période d'entraîneur ; une courte
    période encadrée par le même entraîneur lui est rendue (adjoint pendant une suspension)."""
    df = tm.merge(coaches, on=["match_id", "team_id"], how="inner").sort_values(["team_id", "date"])
    df = df.reset_index(drop=True)
    if "coach_key" not in df:
        df["coach_key"] = df["coach"].map(_coach_key)

    def runs(keys: pd.Series) -> pd.Series:
        first = df.groupby("team_id").cumcount().eq(0)
        return ((df.groupby("team_id")[keys.name].shift() != keys) | first).groupby(df["team_id"]).cumsum()

    df["_run"] = runs(df["coach_key"])
    r = df.groupby(["team_id", "_run"]).agg(key=("coach_key", "first"), n=("match_id", "size")).reset_index()
    r["prev"] = r.groupby("team_id")["key"].shift()
    r["next"] = r.groupby("team_id")["key"].shift(-1)
    absent = r[(r["n"] <= SHORT_ABSENCE) & r["prev"].notna() & (r["prev"] == r["next"])]
    fix = absent.set_index(["team_id", "_run"])["prev"]
    idx = pd.MultiIndex.from_arrays([df["team_id"], df["_run"]])
    df["coach_key"] = pd.Series(fix.reindex(idx).to_numpy(), index=df.index).fillna(df["coach_key"])
    name = df.groupby("coach_key")["coach"].agg(lambda x: x.mode().iat[0])
    df["coach"] = df["coach_key"].map(name)
    df["spell"] = runs(df["coach_key"])
    return df.drop(columns="_run")


def coach_change(tm: pd.DataFrame, coaches: pd.DataFrame, window: int = 10, long: int = 20,
                 matched: int = 10) -> dict:
    """Le « choc » du nouvel entraîneur : performance des 10 matchs de championnat qui suivent un
    changement en cours de saison, comparée à ce que prévoit le seul retour à la moyenne.

    Fenêtres « 10 matchs avant / 10 matchs après » d'une saison de championnat :
    après = a + b * avant + c * niveau plus ancien (20 matchs précédents) + effet * changement.
    Témoins : fenêtres sans aucun changement d'entraîneur sur les 40 matchs (le retour à la
    moyenne) ; traités : premier changement après 30 matchs avec le même entraîneur (un intérim
    suivi d'un nouveau titulaire fait partie du même changement). Effet = ce qu'ajoute le
    changement. Courbe : moyenne des équipes qui changent, et de témoins appariés (fenêtres sans
    changement à la forme et au niveau d'avant les plus proches). Réserve : si les dirigeants jugent
    le niveau réel mieux que ces 30 matchs, l'effet est surestimé (il paraît plus favorable).
    """
    df = _with_spells(tm[tm["league"] & tm["perf"].notna()], coaches)
    rows, seqs = [], []
    for (team, comp, season), g in df.groupby(["team_id", "comp", "app_season"], sort=False):
        perf = g["perf"].to_numpy()
        pts = g["pts"].to_numpy(float)
        spell = g["spell"].to_numpy()
        switch = np.concatenate([[False], spell[1:] != spell[:-1]])      # premier match d'un nouvel entraîneur
        for k in range(window, len(g) - window + 1):
            lo = max(0, k - window - long)
            older = perf[lo:k - window]
            before = int(switch[lo + 1:k].sum())                        # changements avant : période d'avant non stable
            after = int(switch[k + 1:k + window].sum())                 # changements après (intérim puis titulaire)
            rows.append((comp, season, team, perf[k - window:k].mean(), perf[k:k + window].mean(),
                         pts[k - window:k].mean(), pts[k:k + window].mean(),
                         older.mean() if len(older) >= 5 else np.nan, bool(switch[k]), before, after))
            seqs.append(perf[k - window:k + window])
    win = pd.DataFrame(rows, columns=["comp", "season", "team", "pre", "post", "pre_pts", "post_pts", "older",
                                      "changed", "before", "after"])
    seqs = np.array(seqs)
    treated = (win["changed"] & (win["before"] == 0)).to_numpy()
    control = (~win["changed"] & (win["before"] == 0) & (win["after"] == 0)).to_numpy()
    use = (treated | control) & win["older"].notna().to_numpy()

    def fit(idx: np.ndarray, y: str, x: str) -> np.ndarray:
        d = win.iloc[idx]
        design = np.column_stack([np.ones(len(d)), d[x], d["older"], d["changed"].astype(float)])
        return np.linalg.lstsq(design, d[y].to_numpy(), rcond=None)[0]

    idx = np.nonzero(use)[0]
    beta = fit(idx, "post", "pre")
    beta_pts = fit(idx, "post_pts", "pre_pts")
    rng = np.random.default_rng(RNG_SEED)
    t_idx, c_idx = idx[treated[idx]], idx[control[idx]]
    boot = [fit(np.concatenate([rng.choice(t_idx, len(t_idx)), rng.choice(c_idx, min(len(c_idx), 40000))]),
                "post", "pre")[3] for _ in range(300)]
    tr = win.iloc[t_idx]
    rebound = beta[0] + beta[1] * tr["pre"] + beta[2] * tr["older"] - tr["pre"]

    # Témoins appariés (courbe) : parmi toutes les fenêtres sans changement, les `matched` dont la
    # forme d'avant (10 matchs) et le niveau plus ancien sont les plus proches
    ctrl = win.iloc[c_idx]
    c_pre, c_old = ctrl["pre"].to_numpy(), ctrl["older"].to_numpy()
    c_old = np.where(np.isnan(c_old), c_pre, c_old)
    curve_t, curve_c = [], []
    for i in t_idx:
        dist = np.abs(c_pre - win.at[i, "pre"]) + 0.5 * np.abs(c_old - win.at[i, "older"])
        near = c_idx[np.argpartition(dist, matched)[:matched]]
        curve_t.append(seqs[i])
        curve_c.append(seqs[near].mean(axis=0))
    naive = (tr["post"] - tr["pre"]).to_numpy()
    naive_boot = [naive[rng.integers(0, len(naive), len(naive))].mean() for _ in range(1000)]
    effect_ci = _ci(boot)
    return {
        "changes": int(len(tr)),
        "bySeason": {k: int(v) for k, v in tr["season"].value_counts().sort_index().items()},
        "prePerf": round(float(tr["pre"].mean()), 3),
        "otherPerf": round(float(win.loc[control, "pre"].mean()), 3),
        "naive": round(float(naive.mean()), 3), "naiveCi": _ci(naive_boot),
        "naivePoints": round(float((tr["post_pts"] - tr["pre_pts"]).mean()), 3),
        "expectedRebound": round(float(rebound.mean()), 3),
        "effect": round(float(beta[3]), 3), "effectCi": effect_ci,
        "effectPoints": round(float(beta_pts[3]), 3),
        "curve": {"x": list(range(-window, window)),
                  "changers": [round(float(v), 3) for v in np.mean(curve_t, axis=0)],
                  "controls": [round(float(v), 3) for v in np.mean(curve_c, axis=0)]},
        "verdict": "debunked" if effect_ci[0] < 0 < effect_ci[1] else "validated",
    }


def _spell_styles(tm: pd.DataFrame, coaches: pd.DataFrame, min_matches: int) -> pd.DataFrame:
    """Style moyen de chaque période d'entraîneur (championnat), centré-réduit par championnat-saison."""
    df = _with_spells(tm, coaches)
    cols = [c for c, _ in STYLE.values()]
    lg = df[df["league"]].dropna(subset=cols).copy()
    for name, (col, sign) in STYLE.items():
        g = lg.groupby(["comp", "app_season"])[col]
        lg[name] = sign * (lg[col] - g.transform("mean")) / g.transform("std")
    sp = lg.groupby(["team_id", "spell", "coach"]).agg(
        team=("team_name", "last"), comp=("comp", "last"), n=("match_id", "size"),
        start=("date", "min"), end=("date", "max"), perf=("perf", "mean"),
        **{name: (name, "mean") for name in STYLE}).reset_index()
    return sp[sp["n"] >= min_matches].sort_values("start").reset_index(drop=True)


def coach_dna(tm: pd.DataFrame, coaches: pd.DataFrame, min_matches: int = 12, boot: int = 500) -> dict:
    """L'ADN des entraîneurs : quand un entraîneur arrive dans un nouveau club, le style du club
    se rapproche-t-il de celui qu'il avait dans son club précédent ?

    Pour chaque dimension : style au nouveau club = a + b * style du club avant son arrivée
    + c * style de l'entraîneur dans son club précédent ; c > 0 = l'entraîneur imprime son style.
    """
    sp = _spell_styles(tm, coaches, min_matches)
    rows = []
    for _, g in sp.groupby("coach"):
        g = g.sort_values("start")
        for i in range(len(g)):
            for j in range(i + 1, len(g)):
                a, b = g.iloc[i], g.iloc[j]
                if a["team_id"] == b["team_id"]:
                    continue
                prior = sp[(sp["team_id"] == b["team_id"]) & (sp["end"] < b["start"])]
                if prior.empty:
                    continue
                p = prior.iloc[-1]
                rows.append({**{f"a_{k}": a[k] for k in STYLE}, **{f"p_{k}": p[k] for k in STYLE},
                             **{f"b_{k}": b[k] for k in STYLE}, "coach": a["coach"]})
    pr = pd.DataFrame(rows)
    rng = np.random.default_rng(RNG_SEED)
    imprint = {}
    for k in STYLE:
        x = np.column_stack([np.ones(len(pr)), pr[f"p_{k}"], pr[f"a_{k}"]])
        y = pr[f"b_{k}"].to_numpy()
        beta = np.linalg.lstsq(x, y, rcond=None)[0]
        bs = [np.linalg.lstsq(x[i], y[i], rcond=None)[0][2] for i in (rng.integers(0, len(pr), len(pr)) for _ in range(boot))]
        imprint[k] = {"intercept": round(float(beta[0]), 3), "club": round(float(beta[1]), 3),
                      "coach": round(float(beta[2]), 3), "ci": _ci(bs)}
    validated = all(v["ci"][0] > 0 for v in imprint.values())
    return {"arrivals": int(len(pr)), "coaches": int(pr["coach"].nunique()) if len(pr) else 0,
            "imprint": imprint, "verdict": "validated" if validated else "partial", "spells": sp}


def coach_results(tm: pd.DataFrame, coaches: pd.DataFrame, min_matches: int = 15) -> dict:
    """Les résultats suivent-ils l'entraîneur ? Effet d'une période = performance moyenne moins ce
    que prévoit le niveau de l'équipe avant son arrivée (20 derniers matchs, retour à la moyenne
    compris) ; corrélation entre les effets d'un même entraîneur dans deux clubs successifs."""
    df = _with_spells(tm[tm["league"] & tm["perf"].notna()], coaches)
    sp = df.groupby(["team_id", "spell", "coach"]).agg(n=("perf", "size"), perf=("perf", "mean"),
                                                      start=("date", "min")).reset_index()
    prior = []
    by_team = {t: g for t, g in df.groupby("team_id")}
    for r in sp.itertuples():
        before = by_team[r.team_id]
        before = before[before["date"] < r.start].tail(20)
        prior.append(before["perf"].mean() if len(before) >= 10 else np.nan)
    sp["prior"] = prior
    sp = sp[sp["n"] >= min_matches].dropna(subset=["prior"])
    b = np.polyfit(sp["prior"], sp["perf"], 1)
    sp["effect"] = sp["perf"] - np.polyval(b, sp["prior"])
    pairs = []
    for _, g in sp.sort_values("start").groupby("coach"):
        g = g.reset_index(drop=True)
        pairs += [(g.at[i, "effect"], g.at[i + 1, "effect"]) for i in range(len(g) - 1)
                  if g.at[i, "team_id"] != g.at[i + 1, "team_id"]]
    e1, e2 = (np.array(v) for v in zip(*pairs)) if pairs else (np.array([]), np.array([]))
    ci = _boot_corr(e1, e2)
    r = _corr(e1, e2)
    # aucune preuve (l'intervalle contient 0) ; signal faible ; signal net
    return {"pairs": int(len(pairs)), "r": round(r, 3), "ci": ci,
            "verdict": "debunked" if ci[0] <= 0 else ("partial" if r < 0.3 else "validated")}


# ============================================
# ARBITRES
# ============================================

def referees(matches: pd.DataFrame, events: pd.DataFrame, min_matches: int = 30) -> dict:
    """Sévérité des arbitres : cartons par match comparés à la moyenne du championnat-saison.
    Fiabilité = corrélation entre ses matchs pairs et impairs ; l'écart publié est ramené vers 0
    selon cette fiabilité (shrinkage). Même test pour le biais domicile et les penalties."""
    ev = events[events["is_cancelled"] != True]
    m = matches[(matches["match_status"] == "finished") & matches["referee"].notna()].copy()
    cards = ev[ev["event_type"].isin(["yellowcard", "redcard"])]
    m = m.merge(cards.groupby("match_id").size().rename("cards"), on="match_id", how="left")
    pens = ev[(ev["event_type"] == "goal") & (ev["is_penalty"] == True)].groupby("match_id").size().rename("pens")
    m = m.merge(pens, on="match_id", how="left").fillna({"cards": 0, "pens": 0})
    home_cards = cards.merge(m[["match_id", "home_team_id"]], on="match_id")
    home_cards = home_cards.assign(away=home_cards["team_id"] != home_cards["home_team_id"])
    bias = home_cards.groupby("match_id")["away"].agg(lambda a: a.sum() - (~a).sum()).rename("bias")
    m = m.merge(bias, on="match_id", how="left").fillna({"bias": 0})
    for col in ("cards", "pens", "bias"):
        m[f"{col}_rel"] = m[col] - m.groupby(["comp", "app_season"])[col].transform("mean")
    m["date"] = pd.to_datetime(m["date"], format="mixed", utc=True)
    m = m.sort_values("date")
    m["half"] = m.groupby("referee").cumcount() % 2
    rel = {}
    for col in ("cards", "pens", "bias"):
        h = m.groupby(["referee", "half"])[f"{col}_rel"].agg(["mean", "count"]).unstack()
        h = h[(h[("count", 0)] >= min_matches / 2) & (h[("count", 1)] >= min_matches / 2)]
        rel[col] = (_corr(h[("mean", 0)], h[("mean", 1)]), int(len(h)))
    agg = m.groupby("referee").agg(matches=("match_id", "size"), comp=("comp", lambda c: c.mode().iat[0]),
                                   first=("app_season", "min"), last=("app_season", "max"),
                                   cards=("cards", "mean"), cards_rel=("cards_rel", "mean"),
                                   pens=("pens", "mean"), pens_rel=("pens_rel", "mean"))
    agg = agg[agg["matches"] >= min_matches // 2].reset_index()
    # Shrinkage : part de variance vraie entre arbitres (variance observée - bruit d'échantillonnage)
    for col in ("cards", "pens"):
        noise = m[f"{col}_rel"].var()
        between = max(agg[f"{col}_rel"].var() - noise / agg["matches"].mean(), 1e-6)
        agg[f"{col}_shrunk"] = agg[f"{col}_rel"] * between / (between + noise / agg["matches"])
    return {
        "reliability": {k: {"r": round(v[0], 3), "referees": v[1]} for k, v in rel.items()},
        "verdicts": {"cards": "validated" if rel["cards"][0] >= 0.3 else "debunked",
                     "bias": "validated" if rel["bias"][0] >= 0.3 else "debunked",
                     "pens": "validated" if rel["pens"][0] >= 0.3 else "debunked"},
        "table": agg,
    }


# ============================================
# VALEUR DES BUTS (PROBABILITÉ DE VICTOIRE MINUTE PAR MINUTE)
# ============================================
#
# Avant le match : buts attendus de chaque équipe d'après ses xG pour et contre de la saison
# (sans ce match) et l'avantage du terrain. À la minute t avec un score donné : les buts encore à
# venir suivent une loi de Poisson dont la moyenne est la part des buts qui restent à marquer
# (distribution réelle des buts dans le match, temps additionnel et fins de match compris).
# Valeur d'un but = points attendus de l'équipe qui marque juste après, moins juste avant.

def goal_timeline(events: pd.DataFrame, matches: pd.DataFrame) -> pd.DataFrame:
    """Buts des matchs terminés, minute (plafonnée à 45 / 90) et score avant le but ; seuls les
    matchs dont la chronologie redonne le score final sont gardés."""
    g = events[(events["event_type"] == "goal") & (events["is_cancelled"] != True)
               & events["credited_side"].isin(["home", "away"]) & events["period"].isin(["FirstHalf", "SecondHalf"])].copy()
    g["t"] = np.where(g["period"] == "FirstHalf", np.minimum(g["minute"], 45), np.minimum(g["minute"], 90)).astype(float)
    g = g.sort_values(["match_id", "period", "minute", "minute_added", "seq"])
    g["home_goal"] = (g["credited_side"] == "home").astype(int)
    g["h_after"] = g.groupby("match_id")["home_goal"].cumsum()
    g["a_after"] = g.groupby("match_id")["home_goal"].transform(lambda s: (1 - s).cumsum())
    final = g.groupby("match_id")[["h_after", "a_after"]].last()
    fin = matches.set_index("match_id")[["score_home", "score_away"]].join(final, how="inner")
    ok = fin[(fin["score_home"] == fin["h_after"]) & (fin["score_away"] == fin["a_after"])].index
    g = g[g["match_id"].isin(ok)].copy()
    g["h_before"] = g["h_after"] - g["home_goal"]
    g["a_before"] = g["a_after"] - (1 - g["home_goal"])
    return g


class WinProbability:
    """Points attendus à la minute t avec le score sh-sa, buts attendus du match lam_h, lam_a."""

    def __init__(self, goals: pd.DataFrame, scale: float):
        counts = np.bincount(np.clip(goals["t"].round().astype(int), 0, 90), minlength=91).astype(float)
        self.remaining = 1 - np.concatenate([[0.0], np.cumsum(counts)[:-1]]) / counts.sum()
        self.scale = scale

    def outcome(self, sh, sa, t, lam_h, lam_a):
        rem = self.remaining[np.clip(np.round(np.asarray(t, float)).astype(int), 0, 90)] * self.scale
        ph, pa = _poisson_pmf(np.asarray(lam_h, float) * rem), _poisson_pmf(np.asarray(lam_a, float) * rem)
        joint = ph[:, :, None] * pa[:, None, :]
        k = np.arange(ph.shape[1])
        diff = (np.asarray(sh, float)[:, None, None] + k[None, :, None]) - (np.asarray(sa, float)[:, None, None] + k[None, None, :])
        win, draw, loss = ((joint * (diff > 0)).sum((1, 2)), (joint * (diff == 0)).sum((1, 2)), (joint * (diff < 0)).sum((1, 2)))
        return win, draw, loss

    def points(self, sh, sa, t, lam_h, lam_a):
        win, draw, loss = self.outcome(sh, sa, t, lam_h, lam_a)
        return 3 * win + draw, 3 * loss + draw


def match_rates(tm: pd.DataFrame, matches: pd.DataFrame) -> pd.DataFrame:
    """Buts attendus de chaque équipe avant le match (championnats) : attaque x défense adverse / moyenne."""
    lg = tm[tm["league"]].copy()
    key = ["comp", "app_season", "team_id"]
    for col in ("xg_for", "xg_against"):
        g = lg.groupby(key)[col]
        lg[f"{col}_loo"] = (g.transform("sum") - lg[col]) / (g.transform("count") - 1).replace(0, np.nan)
    mean = lg.groupby(["comp", "app_season"])["xg_for"].mean().rename("league_xg")
    home_factor = (lg[lg["is_home"] == True].groupby(["comp", "app_season"])["xg_for"].mean()
                   / lg[lg["is_home"] == False].groupby(["comp", "app_season"])["xg_for"].mean()).rename("hf")
    h = lg[lg["is_home"] == True][["match_id", "xg_for_loo", "xg_against_loo"]].rename(columns={"xg_for_loo": "h_att", "xg_against_loo": "h_def"})
    a = lg[lg["is_home"] == False][["match_id", "xg_for_loo", "xg_against_loo"]].rename(columns={"xg_for_loo": "a_att", "xg_against_loo": "a_def"})
    m = matches.merge(h, on="match_id").merge(a, on="match_id")
    m = m.merge(mean, on=["comp", "app_season"]).merge(home_factor, on=["comp", "app_season"])
    m["lam_h"] = (m["h_att"] * m["a_def"] / m["league_xg"] * np.sqrt(m["hf"])).clip(0.2, 4.5)
    m["lam_a"] = (m["a_att"] * m["h_def"] / m["league_xg"] / np.sqrt(m["hf"])).clip(0.2, 4.5)
    return m.dropna(subset=["lam_h", "lam_a"])


def goal_values(tm: pd.DataFrame, matches: pd.DataFrame, events: pd.DataFrame) -> dict:
    """Valeur en points de chaque but ; joueurs ; courbes du modèle ; calibration."""
    m = match_rates(tm, matches[matches["match_status"] == "finished"].dropna(subset=["score_home", "score_away"]))
    g = goal_timeline(events, m).merge(m[["match_id", "lam_h", "lam_a", "comp", "app_season"]], on="match_id",
                                       suffixes=("_ev", ""))
    m = m[m["match_id"].isin(g["match_id"].unique()) | ((m["score_home"] == 0) & (m["score_away"] == 0))]
    scale = float((m["score_home"] + m["score_away"]).sum() / (m["lam_h"] + m["lam_a"]).sum())
    wp = WinProbability(g, scale)
    bh, ba = wp.points(g["h_before"], g["a_before"], g["t"], g["lam_h"], g["lam_a"])
    ah, aa = wp.points(g["h_after"], g["a_after"], g["t"], g["lam_h"], g["lam_a"])
    g["value"] = np.where(g["home_goal"] == 1, ah - bh, aa - ba)
    g["diff_before"] = np.where(g["home_goal"] == 1, g["h_before"] - g["a_before"], g["a_before"] - g["h_before"])

    # Calibration : P(victoire domicile) prévue à la minute t, contre le résultat final
    calib = {}
    for t0 in (0, 45, 70):
        before = g[g["t"] <= t0].groupby("match_id")[["home_goal"]].agg(["sum", "count"])
        hs = before[("home_goal", "sum")].reindex(m["match_id"]).fillna(0).to_numpy()
        n = before[("home_goal", "count")].reindex(m["match_id"]).fillna(0).to_numpy()
        win, draw, loss = wp.outcome(hs, n - hs, np.full(len(m), t0), m["lam_h"], m["lam_a"])
        res = np.where(m["score_home"] > m["score_away"], 0, np.where(m["score_home"] == m["score_away"], 1, 2))
        p = np.column_stack([win, draw, loss])
        p = p / p.sum(1, keepdims=True)
        bins = pd.cut(win, [0, 0.2, 0.4, 0.6, 0.8, 1.0], include_lowest=True)
        tab = pd.DataFrame({"p": win, "y": res == 0, "b": bins}).groupby("b", observed=True).agg(p=("p", "mean"), y=("y", "mean"), n=("p", "size"))
        calib[str(t0)] = {"logLoss": round(float(-np.log(np.clip(p[np.arange(len(p)), res], 1e-9, 1)).mean()), 4),
                          "bins": [{"predicted": round(float(r.p), 3), "observed": round(float(r.y), 3), "n": int(r.n)} for r in tab.itertuples()]}

    # Courbes du modèle : valeur d'un but selon la minute et le score, équipes de force égale
    lam = float(m[["lam_h", "lam_a"]].mean().mean())
    minutes = np.arange(0, 91, 5)
    curves = {}
    for d in (-1, 0, 1):
        sh = np.full(len(minutes), max(d, 0)); sa = np.full(len(minutes), max(-d, 0))
        before, _ = wp.points(sh, sa, minutes, np.full(len(minutes), lam), np.full(len(minutes), lam))
        after, _ = wp.points(sh + 1, sa, minutes, np.full(len(minutes), lam), np.full(len(minutes), lam))
        curves[str(d)] = [round(float(v), 3) for v in after - before]

    # Joueurs : buts, points apportés, buts décisifs (égalisation ou prise d'avance), buts « de confort »
    sc = g.dropna(subset=["player_id"])
    sc = sc.assign(decisive=sc["diff_before"].isin([-1, 0]), padding=sc["diff_before"] >= 2,
                   late=(sc["t"] >= 75) & sc["diff_before"].isin([-1, 0]))
    team = sc.groupby(["player_id", "app_season"])["team_id"].agg(lambda x: x.mode().iat[0]).rename("team_id")
    players = sc.groupby(["player_id", "app_season", "comp"]).agg(
        name=("player_name", "last"), goals=("value", "size"), points=("value", "sum"),
        decisive=("decisive", "sum"), late=("late", "sum"), padding=("padding", "sum")).reset_index()
    players = players.merge(team.reset_index(), on=["player_id", "app_season"], how="left")
    players["per_goal"] = players["points"] / players["goals"]
    r, n = _season_pairs(players[players["goals"] >= 6].groupby(["player_id", "app_season"], as_index=False)["per_goal"].mean(),
                         "per_goal", ["player_id"])
    return {"goals": int(len(g)), "matches": int(g["match_id"].nunique()), "meanValue": round(float(g["value"].mean()), 3),
            "byState": {str(int(d)): round(float(v), 3) for d, v in g.groupby(g["diff_before"].clip(-2, 2))["value"].mean().items()},
            "scale": round(scale, 3), "calibration": calib, "curves": {"minutes": minutes.tolist(), "byScore": curves},
            "perGoalReliability": {"r": round(r, 3), "pairs": n},
            "verdict": "partial" if 0.2 <= r < 0.5 else ("validated" if r >= 0.5 else "debunked"),
            "players": players, "timeline": g, "wp": wp, "rates": m}


def momentum_test(goals: pd.DataFrame, rates: pd.DataFrame, momentum: pd.DataFrame, shots: pd.DataFrame,
                  test_season: str) -> dict:
    """Le momentum (pression minute par minute) annonce-t-il le prochain but, au-delà du score, des
    forces et des xG des 5 dernières minutes ? Logistique, ajustée sur les saisons d'avant
    test_season, évaluée sur test_season (log-loss)."""
    m = rates[["match_id", "lam_h", "lam_a", "home_team_id", "app_season"]]
    keep = set(m["match_id"])
    mo = momentum[momentum["match_id"].isin(keep)].assign(t=lambda d: d["minute"].round().astype(int).clip(0, 91))
    sh = shots[shots["match_id"].isin(keep)].merge(m[["match_id", "home_team_id"]], on="match_id")
    sh = sh.assign(t=np.where(sh["period"] == "FirstHalf", np.minimum(sh["minute"], 45), np.minimum(sh["minute"], 90)).astype(int),
                   xgd=np.where(sh["team_id"] == sh["home_team_id"], sh["expected_goals"], -sh["expected_goals"]))
    mo_at, mo_c = _by_match(mo, ["t", "value"])
    sh_at, sh_c = _by_match(sh, ["t", "xgd"])
    gl_at, gl_c = _by_match(goals, ["t", "home_goal"])
    rows = []
    for r in m.itertuples(index=False):
        span = mo_at.get(r.match_id)
        if span is None or span[1] - span[0] < 60:
            continue
        mv, cnt = np.zeros(92), np.zeros(92)
        np.add.at(mv, mo_c["t"][span[0]:span[1]], mo_c["value"][span[0]:span[1]])
        np.add.at(cnt, mo_c["t"][span[0]:span[1]], 1)
        mv = np.divide(mv, cnt, out=np.zeros_like(mv), where=cnt > 0)
        xg = np.zeros(92)
        if r.match_id in sh_at:
            a, b = sh_at[r.match_id]
            np.add.at(xg, sh_c["t"][a:b], sh_c["xgd"][a:b])
        a, b = gl_at.get(r.match_id, (0, 0))
        gt, gh = gl_c["t"][a:b], gl_c["home_goal"][a:b]
        for t in range(10, 81, 5):
            before = gt < t
            nxt = (gt >= t) & (gt < t + 10)
            score = gh[before].sum() - (before.sum() - gh[before].sum())
            rows.append((r.app_season, t, score, np.log(r.lam_h / r.lam_a), mv[t - 5:t].mean() / 100,
                         xg[t - 5:t].sum(), float((gh[nxt] == 1).any()), float((gh[nxt] == 0).any())))
    d = pd.DataFrame(rows, columns=["season", "t", "score", "strength", "momentum", "xg5", "home", "away"])
    train, test = (d["season"] < test_season).to_numpy(), (d["season"] == test_season).to_numpy()

    def loss(cols: list[str], target: str) -> float:
        x = np.column_stack([np.ones(len(d)), d["score"].clip(-2, 2), d["strength"], d["t"] / 90] + [d[c] for c in cols])
        w = _logit_fit(x[train], d[target].to_numpy()[train], l2=1e-3)
        p = np.clip(1 / (1 + np.exp(-x[test] @ w)), 1e-9, 1 - 1e-9)
        y = d[target].to_numpy()[test]
        return float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p)))

    out = {}
    for target in ("home", "away"):
        base, shots_only, both = loss([], target), loss(["xg5"], target), loss(["xg5", "momentum"], target)
        out[target] = {"base": round(base, 5), "shots": round(shots_only, 5), "momentum": round(both, 5)}
    quiet = d[test & (d["xg5"].abs() < 1e-6) & (d["score"] == 0)]
    q = pd.qcut(quiet["momentum"].rank(method="first"), 5, labels=False)
    gain = all(v["momentum"] < v["shots"] for v in out.values())
    return {"observations": int(test.sum()), "season": test_season, "logLoss": out,
            "quiet": {"home": [round(float(v), 3) for v in quiet.groupby(q)["home"].mean()],
                      "away": [round(float(v), 3) for v in quiet.groupby(q)["away"].mean()]},
            "verdict": "validated" if gain else "debunked"}


# ============================================
# L'ASCENSEUR : QUI SERA RECRUTÉ PAR UN CHAMPIONNAT PLUS FORT ?
# ============================================
#
# Joueurs des championnats hors Big 5 (niveau PitchAPI 2 et 3) : au-dessus du Big 5, une
# « montée » ne mènerait qu'à la Premier League. Montée = la saison suivante, dans un autre club
# et dans un championnat de niveau supérieur d'au moins STEP_UP (modèle de transfert) ; un club
# promu n'est pas un transfert.

STEP_UP = 1.0


def best_role_index(players: pd.DataFrame, presets: dict, role_index) -> pd.DataFrame:
    """Indice du meilleur rôle de chaque ligne parmi les rôles de son poste (hors spécialistes)."""
    pct = {c[:-4]: players[c].astype(float).to_numpy() for c in players.columns if c.endswith(" pct")}
    best = np.full(len(players), np.nan)
    name = np.full(len(players), None, dtype=object)
    for role, p in presets["presets"].items():
        if p.get("category") == "sp":
            continue
        idx = role_index(pct, p, presets["coreWeight"])
        better = players["Position"].isin(p["positions"]).to_numpy() & ~np.isnan(idx) & (np.isnan(best) | (idx > best))
        best[better] = idx[better]
        name[better] = role
    return players.assign(best_index=best, best_role=name)


def _elevator_features(d: pd.DataFrame, comps: list[str], positions: list[str]) -> np.ndarray:
    """Indice, âge, temps de jeu, championnat d'origine (taux d'export propre à chacun), force du
    club et son interaction avec l'indice, poste."""
    age = (d["Age"] - 24) / 4
    team = d["team_xgd"].fillna(0)
    cols = [np.ones(len(d)), d["best_index"] / 100, age, age ** 2, d["Minutes share"].fillna(0.6),
            team, d["best_index"] / 100 * team]
    cols += [(d["Competition"] == c).astype(float) for c in comps[1:]]
    cols += [(d["Position"] == p).astype(float) for p in positions[1:]]
    return np.column_stack(cols)


def elevator(players: pd.DataFrame, levels: dict[str, float], tier_levels: dict[int, float],
             team_xgd: pd.DataFrame, current: str, top: int = 25) -> dict:
    """Probabilité qu'un joueur hors Big 5 soit transféré la saison suivante dans un championnat
    nettement plus fort (logistique ridge).

    Validation : modèle ajusté sans la dernière saison close, testé sur elle (AUC, Brier, montées
    parmi les `top` premiers). Vérification : prévisions faites sur la dernière saison close,
    confrontées à la saison en cours (partielle : un joueur arrivé dans un championnat plus fort
    n'apparaît qu'une fois 40 % des minutes de son club atteints). Prévisions : saison en cours.
    `players` : une ligne par joueur et par saison (championnat le plus joué), avec best_index.
    """
    allp = players.dropna(subset=["Age"]).copy()
    allp["level"] = allp["Competition"].map(levels)
    allp["level"] = allp["level"].fillna(allp["League tier"].map(tier_levels)).fillna(0.0)
    allp["_y"] = allp["_app_season"].str[:4].astype(int)
    p = allp[(allp["League tier"] != 1) & allp["best_index"].notna()]
    p = p.merge(team_xgd, on=["Competition", "_app_season", "Team ID"], how="left")
    nxt = allp[["Player ID", "_y", "level", "Competition", "Team ID"]].assign(_y=allp["_y"] - 1)
    pairs = p.merge(nxt, on=["Player ID", "_y"], suffixes=("", "_next"))
    pairs["up"] = ((pairs["level_next"] > pairs["level"] + STEP_UP)
                   & (pairs["Team ID_next"] != pairs["Team ID"])).astype(float)
    comps, positions = sorted(p["Competition"].unique()), sorted(p["Position"].dropna().unique())
    nxt_season = lambda s: f"{int(s[:4]) + 1}-{str(int(s[:4]) + 2)[2:]}"
    closed_bases = sorted(b for b in pairs["_app_season"].unique() if nxt_season(b) != current)
    test_base = closed_bases[-1]
    train, test = pairs[pairs["_app_season"] < test_base], pairs[pairs["_app_season"] == test_base]
    w = _logit_fit(_elevator_features(train, comps, positions), train["up"].to_numpy())
    prob = 1 / (1 + np.exp(-_elevator_features(test, comps, positions) @ w))
    y = test["up"].to_numpy()
    order = np.argsort(-prob)
    quint = pd.qcut(pd.Series(prob).rank(method="first"), 5, labels=False)
    calib = pd.DataFrame({"p": prob, "y": y, "q": quint}).groupby("q").mean()
    validation = {"base": test_base, "pairs": int(len(test)), "rate": round(float(y.mean()), 4),
                  "auc": round(_auc(prob, y), 3), "brier": round(float(np.mean((prob - y) ** 2)), 4),
                  "brierBase": round(float(np.mean((y.mean() - y) ** 2)), 4),
                  "quintiles": [{"predicted": round(float(r.p), 3), "observed": round(float(r.y), 3)} for r in calib.itertuples()],
                  "top": {"n": top, "hits": int(y[order[:top]].sum())},
                  "top100": {"n": 100, "hits": int(y[order[:100]].sum())}}
    final = pairs[pairs["_app_season"] <= test_base]
    w = _logit_fit(_elevator_features(final, comps, positions), final["up"].to_numpy())

    def predict(base: str) -> pd.DataFrame:
        d = p[p["_app_season"] == base].copy()
        d["p"] = 1 / (1 + np.exp(-_elevator_features(d, comps, positions) @ w))
        return d

    check_base = next((b for b in sorted(pairs["_app_season"].unique()) if nxt_season(b) == current), None)
    check, verify = None, None
    if check_base:
        check = predict(check_base)
        seen = pairs[pairs["_app_season"] == check_base].set_index("Player ID")
        check["observed"] = check["Player ID"].map(seen["up"])        # absent : pas (encore) vu cette saison
        check["next_comp"] = check["Player ID"].map(seen["Competition_next"])
        ranked = check.sort_values("p", ascending=False).head(top)
        verify = {"base": check_base, "season": current, "top": top, "seen": int(ranked["observed"].notna().sum()),
                  "hits": int((ranked["observed"] == 1).sum()),
                  "rateSeen": round(float(check["observed"].mean()), 4) if check["observed"].notna().any() else None}
    verdict = "validated" if validation["auc"] >= 0.65 and validation["brier"] < validation["brierBase"] else "partial"
    return {"validation": validation, "verify": verify, "verdict": verdict, "stepUp": STEP_UP,
            "check": check, "provisional": predict(current)}


# ============================================
# CHIMIE DE PASSE : LES DUOS
# ============================================

def pass_duos(edges: pd.DataFrame, positions: pd.DataFrame, min_expected: float = 30.0) -> dict:
    """Un joueur cherche-t-il un coéquipier plus que leur volume de passes et leur placement ne
    l'expliquent ? Attendu d'un match = passes du passeur x passes reçues du receveur / total ;
    placement : rapport observé / attendu moyen pour la même paire de zones (rôle + côté), tous
    clubs. Affinité = log((passes + 5) / (attendu + 5)). Fiabilité : matchs pairs contre impairs."""
    e = edges[edges["from_player_id"] != edges["to_player_id"]].copy()
    grp = ["match_id", "team_id"]
    out = e.groupby(grp + ["from_player_id"])["passes"].transform("sum")
    inn = e.groupby(grp + ["to_player_id"])["passes"].transform("sum")
    tot = e.groupby(grp)["passes"].transform("sum")
    e["expected"] = out * inn / tot
    zone = positions.set_index(["match_id", "player_id"])["zone"]
    zone = zone[~zone.index.duplicated()]
    e["zf"] = zone.reindex(pd.MultiIndex.from_arrays([e["match_id"], e["from_player_id"]])).to_numpy()
    e["zt"] = zone.reindex(pd.MultiIndex.from_arrays([e["match_id"], e["to_player_id"]])).to_numpy()
    e = e.dropna(subset=["zf", "zt"])
    zz = e.groupby(["zf", "zt"])[["passes", "expected"]].sum()
    e = e.merge((zz["passes"] / zz["expected"]).rename("zratio").reset_index(), on=["zf", "zt"])
    e["expected"] = e["expected"] * e["zratio"]
    rank = e.groupby(["comp", "app_season", "team_id"])["match_id"].rank(method="dense")
    e["half"] = (rank % 2).astype(int)
    key = ["comp", "app_season", "team_id", "from_player_id", "to_player_id"]
    h = e.groupby(key + ["half"])[["passes", "expected"]].sum().unstack()
    h = h[(h[("expected", 0)] >= 15) & (h[("expected", 1)] >= 15)]
    aff = lambda o, x: np.log((o + 5) / (x + 5))
    r = _corr(aff(h[("passes", 0)], h[("expected", 0)]), aff(h[("passes", 1)], h[("expected", 1)]))
    full = e.groupby(key)[["passes", "expected"]].sum().reset_index()
    full = full[full["expected"] >= min_expected]
    full["affinity"] = aff(full["passes"], full["expected"])
    return {"pairs": int(len(h)), "reliability": round(r, 3), "sd": round(float(full["affinity"].std()), 3),
            "strong": round(float((full["affinity"] > np.log(1.3)).mean()), 3),
            "verdict": "validated" if r >= 0.4 else ("partial" if r >= 0.2 else "debunked"), "duos": full}


# ============================================
# HORLOGE DE L'EFFECTIF
# ============================================

def squad_clock(players: pd.DataFrame, curves: dict, tm: pd.DataFrame, metric: str = "Rating") -> dict:
    """Vieillissement de l'effectif : effet moyen de l'âge (courbes d'âge, note globale, points de
    percentile par saison), pondéré par les minutes. Prédit-il l'évolution de l'xGD de l'équipe la
    saison suivante, à niveau égal (retour à la moyenne compris) ?"""
    d = players.dropna(subset=["Age"]).copy()
    eff = []
    for pos, age in zip(d["Position"], d["Age"]):
        c = curves.get(pos, {}).get(metric)
        eff.append(c["ages"].get(str(int(age)), [0.0])[0] if c else np.nan)
    d["age_effect"] = eff
    d = d.dropna(subset=["age_effect"])
    clock = d.groupby(["Competition", "_app_season", "Team ID"]).apply(
        lambda g: pd.Series({"clock": np.average(g["age_effect"], weights=g["Minutes played"]),
                             "age": np.average(g["Age"], weights=g["Minutes played"]),
                             "team": g["Team"].iloc[0]})).reset_index()
    xgd = tm[tm["league"]].groupby(["comp", "app_season", "team_id"])["xgd"].mean().rename("xgd").reset_index()
    cx = clock.merge(xgd, left_on=["Competition", "_app_season", "Team ID"], right_on=["comp", "app_season", "team_id"])
    cx["_y"] = cx["_app_season"].str[:4].astype(int)
    nxt = cx.assign(_y=cx["_y"] - 1)[["Team ID", "Competition", "_y", "xgd"]]
    pairs = cx.merge(nxt, on=["Team ID", "Competition", "_y"], suffixes=("", "_next"))
    x = np.column_stack([np.ones(len(pairs)), pairs["xgd"], pairs["clock"]])
    y = pairs["xgd_next"].to_numpy()
    beta = np.linalg.lstsq(x, y, rcond=None)[0]
    rng = np.random.default_rng(RNG_SEED)
    bs = [np.linalg.lstsq(x[i], y[i], rcond=None)[0][2] for i in (rng.integers(0, len(pairs), len(pairs)) for _ in range(500))]
    ci = _ci(bs)
    return {"pairs": int(len(pairs)), "coef": round(float(beta[2]), 4), "ci": ci, "persistence": round(float(beta[1]), 3),
            "verdict": "validated" if ci[0] > 0 else "debunked", "teams": clock}


# ============================================
# EXPÉRIENCES À VERDICT SEUL
# ============================================

def style_matchups(tm: pd.DataFrame, current: str, folds: int = 5, ridge: float = 50.0) -> dict:
    """Confrontations de styles : un style d'attaque produit-il plus ou moins d'xG contre un style de
    défense donné, au-delà des forces des deux équipes ? log(xG + 0,1) = championnat + terrain +
    attaque + défense (+ 36 interactions style x style), validation croisée par match."""
    cols = [c for c, _ in STYLE.values()]
    d = tm[tm["league"] & (tm["app_season"] != current)].dropna(subset=cols + ["xg_for"]).copy()
    d = d[d.groupby("match_id")["team_id"].transform("size") == 2].reset_index(drop=True)
    d["ls"] = d["comp"] + " " + d["app_season"]
    d["y"] = np.log(d["xg_for"] + 0.1)
    mids = d["match_id"].unique()
    fold = dict(zip(mids, np.random.default_rng(RNG_SEED).integers(0, folds, len(mids))))
    d["fold"] = d["match_id"].map(fold)

    def styles(train):
        s = train.groupby(["ls", "team_id"])[cols].mean()
        s.columns = list(STYLE)
        for k, (_, sign) in STYLE.items():
            s[k] = sign * s[k]
        return s.groupby(level=0).transform(lambda c: (c - c.mean()) / c.std())

    def design(df, sz):
        a = sz.reindex(pd.MultiIndex.from_arrays([df["ls"], df["team_id"]])).to_numpy()
        b = sz.reindex(pd.MultiIndex.from_arrays([df["ls"], df["opponent_id"]])).to_numpy()
        return np.nan_to_num(np.einsum("ni,nj->nij", a, b).reshape(len(df), -1))

    def fit(df, inter, iters=20):
        ka, kd = (df["ls"] + "|" + df["team_id"]).to_numpy(), (df["ls"] + "|" + df["opponent_id"]).to_numpy()
        ls = df["ls"].to_numpy()
        home = np.where(df["is_home"] == True, 0.5, -0.5)
        att, dfn = pd.Series(0.0, index=np.unique(ka)), pd.Series(0.0, index=np.unique(kd))
        beta = np.zeros(inter.shape[1]) if inter is not None else None
        y = df["y"].to_numpy()
        for _ in range(iters):
            off = inter @ beta if beta is not None else 0.0
            base = y - att.reindex(ka).to_numpy() - dfn.reindex(kd).to_numpy() - off
            mu = pd.Series(base).groupby(ls).mean()
            r = base - mu.reindex(ls).to_numpy()
            h = pd.Series(r * home).groupby(ls).sum() / pd.Series(home * home).groupby(ls).sum()
            e = y - mu.reindex(ls).to_numpy() - h.reindex(ls).to_numpy() * home - off
            att = pd.Series(e - dfn.reindex(kd).to_numpy()).groupby(ka).sum() / (pd.Series(1.0, index=range(len(ka))).groupby(ka).sum() + 2)
            dfn = pd.Series(e - att.reindex(ka).to_numpy()).groupby(kd).sum() / (pd.Series(1.0, index=range(len(kd))).groupby(kd).sum() + 2)
            if beta is not None:
                res = y - mu.reindex(ls).to_numpy() - h.reindex(ls).to_numpy() * home - att.reindex(ka).to_numpy() - dfn.reindex(kd).to_numpy()
                beta = np.linalg.solve(inter.T @ inter + ridge * np.eye(inter.shape[1]), inter.T @ res)
        return mu, h, att, dfn, beta

    def predict(model, df, inter):
        mu, h, att, dfn, beta = model
        home = np.where(df["is_home"] == True, 0.5, -0.5)
        p = (mu.reindex(df["ls"]).to_numpy() + h.reindex(df["ls"]).to_numpy() * home
             + att.reindex(df["ls"] + "|" + df["team_id"]).fillna(0).to_numpy()
             + dfn.reindex(df["ls"] + "|" + df["opponent_id"]).fillna(0).to_numpy())
        return p + inter @ beta if beta is not None else p

    gains, base = [], []
    for f in range(folds):
        tr, te = d[d["fold"] != f], d[d["fold"] == f]
        sz = styles(tr)
        xtr, xte = design(tr, sz), design(te, sz)
        pb, pi = predict(fit(tr, None), te, None), predict(fit(tr, xtr), te, xte)
        err_b = (te["y"].to_numpy() - pb) ** 2
        err = err_b - (te["y"].to_numpy() - pi) ** 2
        ok = ~np.isnan(err)
        gains.append(err[ok])
        base.append(err_b[ok])
    g = np.concatenate(gains)
    rng = np.random.default_rng(RNG_SEED)
    ci = _ci([g[rng.integers(0, len(g), len(g))].mean() for _ in range(1000)])
    return {"rows": int(len(d)), "gain": round(float(g.mean()), 6), "ci": ci,
            "baseMse": round(float(np.concatenate(base).mean()), 5),
            "verdict": "validated" if ci[0] > 0 else "debunked"}


def fatigue(tm: pd.DataFrame) -> dict:
    """Fatigue du calendrier : résultat (xGD au-delà des forces et du terrain) d'une équipe qui a eu
    3 jours de repos ou moins contre un adversaire qui en a eu 6 ou plus (toutes compétitions)."""
    d = tm.sort_values(["team_id", "date"]).copy()
    d["rest"] = (d["date"] - d.groupby("team_id")["date"].shift()).dt.days
    d = d.merge(d[["match_id", "team_id", "rest"]].rename(columns={"team_id": "opponent_id", "rest": "opp_rest"}),
                on=["match_id", "opponent_id"], how="left")
    lg = d[d["league"] & d["expected_xgd"].notna() & (d["rest"] <= 30) & (d["opp_rest"] <= 30)].copy()
    lg["resid"] = lg["xgd"] - lg["expected_xgd"]
    tired = lg[(lg["rest"] <= 3) & (lg["opp_rest"] >= 6)]["resid"].to_numpy()
    rng = np.random.default_rng(RNG_SEED)
    ci = _ci([tired[rng.integers(0, len(tired), len(tired))].mean() for _ in range(1000)])
    slope = np.polyfit((lg["rest"].clip(upper=8) - lg["opp_rest"].clip(upper=8)), lg["resid"], 1)[0]
    by = lg.groupby(pd.cut(lg["rest"], [-1, 3, 4, 5, 6, 30], labels=["≤3", "4", "5", "6", "7+"]), observed=True)["resid"].mean()
    return {"matches": int(len(tired)), "effect": round(float(tired.mean()), 3), "ci": ci,
            "perDay": round(float(slope), 4), "byRest": {k: round(float(v), 3) for k, v in by.items()},
            "verdict": "debunked" if ci[0] < 0 < ci[1] else "validated"}


def game_state(tm: pd.DataFrame, goals: pd.DataFrame, rates: pd.DataFrame, shots: pd.DataFrame, current: str) -> dict:
    """« Gérer un score » et « finir fort » sont-ils des traits d'équipe ? Part d'xG d'une équipe
    quand elle mène (moins à égalité), quand elle est menée, et écart d'xGD après la 75e ;
    persistance d'une saison à l'autre."""
    sh = shots[shots["match_id"].isin(rates["match_id"]) & shots["period"].isin(["FirstHalf", "SecondHalf"])]
    sh = sh.merge(rates[["match_id", "home_team_id", "away_team_id", "comp", "app_season"]], on="match_id", suffixes=("_s", ""))
    sh = sh.assign(t=np.where(sh["period"] == "FirstHalf", np.minimum(sh["minute"], 45), np.minimum(sh["minute"], 90)).astype(float))
    # Score avant chaque tir : dernier but strictement antérieur du même match
    g = goals[["match_id", "t", "h_after", "a_after"]].sort_values("t")
    sh = pd.merge_asof(sh.reset_index(drop=True).sort_values("t"), g, on="t", by="match_id", allow_exact_matches=False)
    diff = (sh["h_after"].fillna(0) - sh["a_after"].fillna(0)).to_numpy()
    home = (sh["team_id"] == sh["home_team_id"]).to_numpy()
    sh = sh.assign(s_home=np.sign(diff), xg_h=np.where(home, sh["expected_goals"], 0.0), xg_a=np.where(home, 0.0, sh["expected_goals"]),
                   late=sh["t"] >= 75)
    ms = sh.groupby(["comp", "app_season", "match_id", "home_team_id", "away_team_id", "s_home"])[["xg_h", "xg_a"]].sum().reset_index()
    both = pd.concat([ms.assign(team_id=ms["home_team_id"], st=ms["s_home"], own=ms["xg_h"], opp=ms["xg_a"]),
                      ms.assign(team_id=ms["away_team_id"], st=-ms["s_home"], own=ms["xg_a"], opp=ms["xg_h"])])
    agg = both.groupby(["comp", "app_season", "team_id", "st"])[["own", "opp"]].sum()
    share = (agg["own"] / (agg["own"] + agg["opp"])).unstack().reset_index()
    share["protect"], share["chase"] = share[1.0] - share[0.0], share[-1.0] - share[0.0]
    lm = sh.groupby(["comp", "app_season", "match_id", "home_team_id", "away_team_id", "late"])[["xg_h", "xg_a"]].sum().reset_index()
    late = pd.concat([lm.assign(team_id=lm["home_team_id"], d=lm["xg_h"] - lm["xg_a"]),
                      lm.assign(team_id=lm["away_team_id"], d=lm["xg_a"] - lm["xg_h"])])
    lt = late.groupby(["comp", "app_season", "team_id", "late"])["d"].sum().unstack()
    games = late.groupby(["comp", "app_season", "team_id"])["match_id"].nunique()
    lt["late_edge"] = (lt[True] / 15 - lt[False] / 75) * 90 / games.reindex(lt.index)
    lt = lt.reset_index()
    out = {}
    for name, df, col in (("protect", share, "protect"), ("chase", share, "chase"), ("late", lt, "late_edge")):
        r, n = _season_pairs(df[df["app_season"] != current], col, ["team_id", "comp"])
        out[name] = {"mean": round(float(df[col].mean()), 3), "r": round(r, 3), "pairs": n}
    out["verdict"] = "debunked" if max(v["r"] for v in out.values()) < 0.2 else "partial"
    return out


def set_pieces(shots: pd.DataFrame, current: str) -> dict:
    """Dépendance aux coups de pied arrêtés : part de l'xG obtenue sur phases arrêtées (corners,
    coups francs, touches longues ; hors penalties), persistance d'une saison à l'autre."""
    s = shots.assign(sp=shots["situation"].isin(["FromCorner", "SetPiece", "FreeKick", "ThrowInSetPiece"]))
    s = s[s["situation"] != "Penalty"]
    t = s.groupby(["comp", "app_season", "team_id"]).apply(
        lambda d: d.loc[d["sp"], "expected_goals"].sum() / max(d["expected_goals"].sum(), 1e-6)).rename("share").reset_index()
    r, n = _season_pairs(t[t["app_season"] != current], "share", ["team_id", "comp"])
    return {"mean": round(float(t["share"].mean()), 3), "r": round(r, 3), "pairs": n,
            "verdict": "validated" if r >= 0.3 else "debunked", "teams": t}


def red_cards(events: pd.DataFrame, shots: pd.DataFrame, rates: pd.DataFrame) -> dict:
    """Ce que coûte un carton rouge : xG par 90 minutes de l'équipe réduite et de son adversaire,
    avant et après le premier rouge du match (rouges entre la 15e et la 75e)."""
    rc = events[(events["event_type"] == "redcard") & events["period"].isin(["FirstHalf", "SecondHalf"])].copy()
    rc["t"] = np.where(rc["period"] == "FirstHalf", np.minimum(rc["minute"], 45), np.minimum(rc["minute"], 90))
    rc = rc.sort_values("t").drop_duplicates("match_id")
    rc = rc[rc["match_id"].isin(rates["match_id"]) & rc["t"].between(15, 75)]
    sh = shots[shots["match_id"].isin(rc["match_id"]) & shots["period"].isin(["FirstHalf", "SecondHalf"])].copy()
    sh["t"] = np.where(sh["period"] == "FirstHalf", np.minimum(sh["minute"], 45), np.minimum(sh["minute"], 90))
    x = sh.merge(rc[["match_id", "team_id", "t"]].rename(columns={"team_id": "red_team", "t": "tr"}), on="match_id")
    x["red"], x["after"] = x["team_id"] == x["red_team"], x["t"] >= x["tr"]
    xg = x.groupby(["red", "after"])["expected_goals"].sum()
    before, after = rc["t"].sum(), (90 - rc["t"]).sum()
    per90 = lambda red, aft: round(float(xg.get((red, aft), 0.0) / (after if aft else before) * 90), 3)
    return {"matches": int(len(rc)), "reduced": [per90(True, False), per90(True, True)],
            "opponent": [per90(False, False), per90(False, True)], "verdict": "measured"}


def luck(tm: pd.DataFrame, current: str) -> dict:
    """La chance : points - points attendus (xPts, Poisson sur les xG du match). Persiste-t-elle d'une
    moitié de saison à l'autre ? Et pour prévoir les points de la seconde moitié, vaut-il mieux
    regarder les points ou l'xGD de la première ?"""
    d = tm[tm["league"] & (tm["app_season"] != current)].sort_values("date").copy()
    ph, pa = _poisson_pmf(d["xg_for"].clip(0.01)), _poisson_pmf(d["xg_against"].clip(0.01))
    joint = ph[:, :, None] * pa[:, None, :]
    k = np.arange(ph.shape[1])
    diff = k[None, :, None] - k[None, None, :]
    d["xpts"] = 3 * (joint * (diff > 0)).sum((1, 2)) + (joint * (diff == 0)).sum((1, 2))
    d["luck"] = d["pts"] - d["xpts"]
    key = ["comp", "app_season", "team_id"]
    first = d.groupby(key).cumcount() < d.groupby(key)["match_id"].transform("size") / 2
    h = d.assign(part=np.where(first, 1, 2)).groupby(key + ["part"])[["luck", "pts", "xgd"]].mean().unstack().dropna()
    # Points de la seconde moitié : mieux prévus par les points ou par l'xGD de la première ?
    return {"teams": int(len(h)), "luckR": round(_corr(h[("luck", 1)], h[("luck", 2)]), 3),
            "pointsR": round(_corr(h[("pts", 1)], h[("pts", 2)]), 3), "xgdR": round(_corr(h[("xgd", 1)], h[("pts", 2)]), 3),
            "verdict": "measured"}


def availability(lineup: pd.DataFrame, matches: pd.DataFrame, cups: set[str], current: str) -> dict:
    """Disponibilité : part des matchs de son équipe où le joueur figure sur la feuille de match
    (titulaire ou remplaçant), entre sa première et sa dernière apparition de la saison ; persistance
    d'une saison à l'autre (joueurs réguliers : 10 titularisations ou plus)."""
    lu = lineup[~lineup["comp"].isin(cups)].merge(matches[["match_id", "date"]], on="match_id")
    lu["date"] = pd.to_datetime(lu["date"], format="mixed", utc=True)
    key = ["comp", "app_season", "team_id"]
    ten = lu.groupby(key + ["player_id"]).agg(first=("date", "min"), last=("date", "max"), squad=("match_id", "nunique"),
                                              starts=("role", lambda r: int((r == "starter").sum()))).reset_index()
    games = lu[key + ["match_id", "date"]].drop_duplicates()
    span = games.merge(ten[key + ["player_id", "first", "last"]], on=key)
    span = span[(span["date"] >= span["first"]) & (span["date"] <= span["last"])].groupby(key + ["player_id"])["match_id"].nunique()
    ten = ten.merge(span.rename("span").reset_index(), on=key + ["player_id"])
    ten["avail"] = ten["squad"] / ten["span"]
    reg = ten[(ten["span"] >= 15) & (ten["starts"] >= 10) & (ten["app_season"] != current)]
    reg = reg.sort_values("span", ascending=False).drop_duplicates(["player_id", "app_season"])
    r, n = _season_pairs(reg, "avail", ["player_id"])
    return {"median": round(float(reg["avail"].median()), 3), "r": round(r, 3), "pairs": n,
            "verdict": "partial" if 0.1 <= r < 0.4 else ("validated" if r >= 0.4 else "debunked"), "players": ten}


def twins(players: pd.DataFrame, presets: dict, curves: dict, role_index, development_pct, test_base: str,
          k: int = 25) -> dict:
    """Jumeaux statistiques (à la PECOTA) : prévoir l'indice de la saison suivante par l'évolution des
    joueurs qui avaient le même profil au même âge (même poste, percentiles des rôles du poste, âge,
    niveau du championnat), comparé aux courbes d'âge. Test : saison de départ test_base."""
    d = players.dropna(subset=["best_index", "best_role", "Age"]).copy()
    d["_y"] = d["_app_season"].str[:4].astype(int)
    nxt = d.assign(_y=d["_y"] - 1)
    pairs = d.merge(nxt[["Player ID", "_y", "Position"] + [c for c in d.columns if c.endswith(" pct")]],
                    on=["Player ID", "_y"], suffixes=("", "_next"))
    pairs = pairs[pairs["Position"] == pairs["Position_next"]].reset_index(drop=True)
    core = presets["coreWeight"]
    nxt_pct = {c[:-4]: pairs[f"{c}_next"].astype(float).to_numpy() for c in d.columns if c.endswith(" pct")}
    pairs["index_next"] = [np.nan] * len(pairs)
    for role, pre in presets["presets"].items():
        sel = (pairs["best_role"] == role).to_numpy()
        if sel.any():
            pairs.loc[sel, "index_next"] = role_index({m: v[sel] for m, v in nxt_pct.items()}, pre, core)
    pairs = pairs.dropna(subset=["index_next"])
    test, hist = pairs[pairs["_app_season"] == test_base].copy(), pairs[pairs["_app_season"] < test_base]
    metrics = [c[:-4] for c in d.columns if c.endswith(" pct")]
    dev = development_pct(test, curves, metrics)
    dev_idx = np.full(len(test), np.nan)
    for role, pre in presets["presets"].items():
        sel = (test["best_role"] == role).to_numpy()
        if sel.any():
            vals = {m: np.where(np.isnan(dev[m][sel]), test[f"{m} pct"].astype(float).to_numpy()[sel], dev[m][sel]) for m in metrics}
            dev_idx[sel] = role_index(vals, pre, core)
    test["development"] = dev_idx
    twin = np.full(len(test), np.nan)
    for pos, tg in test.groupby("Position"):
        ms = sorted({m for r, pre in presets["presets"].items() if pre.get("category") != "sp" and pos in pre["positions"]
                     for m in list(pre["metrics"]) + list(pre.get("weights", {}))})
        ms = [m for m in ms if f"{m} pct" in d.columns]
        hg = hist[hist["Position"] == pos]
        if len(hg) < k:
            continue
        hx = np.nan_to_num(hg[[f"{m} pct" for m in ms]].to_numpy(float), nan=50.0) / 100
        tx = np.nan_to_num(tg[[f"{m} pct" for m in ms]].to_numpy(float), nan=50.0) / 100
        for j, ix in enumerate(tg.index):
            dist = np.sqrt(((hx - tx[j]) ** 2).mean(axis=1)) + 0.04 * np.abs(hg["Age"].to_numpy() - tg.at[ix, "Age"])
            near = np.argsort(dist)[:k]
            w = 1 / (dist[near] + 0.05)
            delta = (hg["index_next"].to_numpy() - hg["best_index"].to_numpy())[near]
            twin[test.index.get_loc(ix)] = tg.at[ix, "best_index"] + np.average(delta, weights=w)
    test["twins"] = twin
    young = test["Age"] <= 23
    mae = lambda col, sel: round(float(np.nanmean(np.abs(test.loc[sel, col] - test.loc[sel, "index_next"]))), 2)
    out = {"base": test_base, "players": int(len(test)), "youngPlayers": int(young.sum())}
    for name, sel in (("all", slice(None)), ("young", young)):
        out[name] = {"unchanged": mae("best_index", sel), "development": mae("development", sel), "twins": mae("twins", sel)}
    out["verdict"] = "partial" if out["young"]["twins"] < out["young"]["unchanged"] else "debunked"
    if out["all"]["twins"] < out["all"]["development"]:
        out["verdict"] = "validated"
    return out


# ============================================
# FRICTION DE STYLE ENTRE CLUB VENDEUR ET CLUB ACHETEUR (expérience 20)
# ============================================
#
# Question : un joueur qui change de club perd-il davantage que ce que le modèle de transfert prévoit
# quand le profil de l'effectif qui l'accueille est très différent de celui qu'il quitte ? Profils
# d'effectif sur les 9 dimensions du Recrutement (utils/recruitment.ts, SQUAD_DIMENSIONS : rangs 0-100
# dans le championnat, saison de départ), friction = écart moyen absolu des rangs. Test : les 405
# changements de championnat de la dernière saison close, hors de l'ajustement ; le coefficient de la
# friction est appris sur les transferts des saisons précédentes et appliqué tel quel.

# Copie des dimensions de utils/recruitment.ts (test_lab vérifie qu'elles restent identiques)
SQUAD_DIMENSIONS = {
    "finishing": ({"npxG per 90": 1, "Touches in box per 90": 1, "Shots on target per 90": 1}, False),
    "creation": ({"xA per 90": 1, "Key passes per 90": 1, "Shot-creating actions per 90": 1}, False),
    "progression": ({"Progressive passes per 90": 1, "Progressive runs per 90": 1, "Passes to final third per 90": 1}, False),
    "dribbling": ({"Dribbles per 90": 1, "Successful dribbles, %": 1}, False),
    "security": ({"Accurate passes, %": 1, "Dispossessed per 90": -1, "Miscontrols per 90": -1}, False),
    "duels": ({"Ground duels won, %": 1, "PAdj Tackles": 1, "Dribbled past per 90": -1}, False),
    "aerial": ({"Aerial duels won, %": 1, "Aerial duels won per 90": 1}, False),
    "recovery": ({"PAdj Interceptions": 1, "PAdj Recoveries": 1}, False),
    "goalkeeping": ({"Prevented goals per 90": 1, "Save rate, %": 1}, True),
}


def squad_profiles(players: pd.DataFrame) -> pd.DataFrame:
    """Profil de l'effectif par équipe-saison : score de chaque dimension (percentiles « plus c'est haut,
    mieux c'est », poids négatif inversé), moyenne pondérée par les minutes (gardiens pour la seule
    dimension Gardien), puis rang 0-100 parmi les équipes du championnat la même saison."""
    key = ["Competition", "_app_season", "Team ID"]
    d = players.dropna(subset=["Team ID", "Minutes played"])
    d = d[d["Minutes played"] > 0]
    out = d[key].drop_duplicates().reset_index(drop=True)
    for dim, (weights, goalkeepers) in SQUAD_DIMENSIONS.items():
        rows = d[(d["Position"] == "GK") == goalkeepers]
        num = np.zeros(len(rows))
        den = np.zeros(len(rows))
        for metric, w in weights.items():
            col = f"{metric} pct"
            if col not in rows:
                continue
            v = rows[col].to_numpy(float)
            ok = ~np.isnan(v)
            num += np.where(ok, abs(w) * np.where(w < 0, 100 - v, v), 0)
            den += np.where(ok, abs(w), 0)
        score = np.where(den > 0, num / np.where(den > 0, den, 1), np.nan)
        s = rows.assign(_score=score, _w=rows["Minutes played"].to_numpy(float)).dropna(subset=["_score"])
        if s.empty:
            out[f"dim_{dim}"] = np.nan
            continue
        s = s.assign(_ws=s["_score"] * s["_w"])
        agg = s.groupby(key)[["_ws", "_w"]].sum().reset_index()
        agg[f"value_{dim}"] = agg["_ws"] / agg["_w"]
        agg[f"dim_{dim}"] = agg.groupby(["Competition", "_app_season"])[f"value_{dim}"].rank(pct=True) * 100
        out = out.merge(agg[key + [f"dim_{dim}"]], on=key, how="left")
    out["n_teams"] = out.groupby(["Competition", "_app_season"])["Team ID"].transform("count")
    return out


def friction_effect(d: pd.DataFrame, dims: list[str], ridge: float = 50.0, boot: int = 1000) -> dict:
    """Le résidu du modèle (observé − prévu) dépend-il de la friction ? Coefficient appris sur les lignes
    d'apprentissage (`test` faux), erreur absolue moyenne avant / après correction sur les lignes de test.
    d : colonnes pred, true, friction, test et les écarts signés par dimension (dims)."""
    d = d.dropna(subset=["pred", "true", "friction"]).copy()
    d["residual"] = d["true"] - d["pred"]
    train, test = d[~d["test"]], d[d["test"]]
    if len(train) < 50 or len(test) < 30:
        return {"verdict": "measured", "pairs": int(len(test)), "note": "trop peu de transferts"}
    x = np.column_stack([np.ones(len(train)), train["friction"]])
    a, b = np.linalg.lstsq(x, train["residual"].to_numpy(), rcond=None)[0]
    xd = np.column_stack([np.ones(len(train)), np.nan_to_num(train[dims].to_numpy(float))])
    pen = ridge * np.eye(xd.shape[1])
    pen[0, 0] = 0
    wd = np.linalg.solve(xd.T @ xd + pen, xd.T @ train["residual"].to_numpy())
    err_model = np.abs(test["residual"].to_numpy())
    adj = test["pred"].to_numpy() + a + b * test["friction"].to_numpy()
    err_fric = np.abs(test["true"].to_numpy() - adj)
    adj_d = test["pred"].to_numpy() + np.column_stack([np.ones(len(test)), np.nan_to_num(test[dims].to_numpy(float))]) @ wd
    err_dims = np.abs(test["true"].to_numpy() - adj_d)
    rng = np.random.default_rng(RNG_SEED)
    gain = [float((err_model[i] - err_fric[i]).mean()) for i in (rng.integers(0, len(test), len(test)) for _ in range(boot))]
    ci = _ci(gain)
    r = _corr(test["friction"], err_model)
    r_ci = _boot_corr(test["friction"].to_numpy(), err_model, 500)
    improvement = float(err_model.mean() - err_fric.mean())
    verdict = "validated" if ci[0] > 0 and improvement >= 0.25 else ("partial" if improvement > 0 or r_ci[0] > 0 else "debunked")
    return {
        "pairs": int(len(test)), "trainPairs": int(len(train)),
        "mae": {"model": round(float(err_model.mean()), 2), "withFriction": round(float(err_fric.mean()), 2), "withDimensions": round(float(err_dims.mean()), 2)},
        "improvement": round(improvement, 2), "ci": ci, "coef": round(float(b), 2),
        "frictionMean": round(float(test["friction"].mean()), 3),
        "corrAbsResidual": round(r, 3), "corrCi": r_ci,
        "dimensionCoef": {dim: round(float(w), 3) for dim, w in zip(dims, wd[1:])},
        "verdict": verdict,
    }


def style_friction(players: pd.DataFrame, presets: dict, cups: set[str], tiers: dict[str, int], models) -> dict:
    """Expérience 20, sur les vraies données : paires de transfert du modèle (models._transfer_pairs),
    prévision du modèle complet pour chaque métrique puis indice des rôles du poste (comme la validation
    du Recrutement), résidu confronté à la friction entre les profils d'effectif des deux clubs."""
    metrics = [c[:-4] for c in players.columns if c.endswith(" pct")]
    pairs = models._transfer_pairs(players, metrics, cups)
    if pairs.empty:
        return {"verdict": "measured", "note": "aucune paire"}
    season = pairs["_app_season_next"].max()
    test = (pairs["_app_season_next"] == season).to_numpy()
    curves = models.age_curves(players[players["_app_season"] < season], metrics)["curves"]
    dev_all = models._development_pct(pairs, curves, metrics)
    fit = models._fit_transfer(pairs[~test].reset_index(drop=True), {m: v[~test] for m, v in dev_all.items()}, metrics, tiers)
    if not fit:
        return {"verdict": "measured", "note": "modèle de transfert non ajustable"}
    _, moved, _ = models._transfer_terms(pairs)
    forecast, truth = {}, {}
    for m in metrics:
        x = pairs[f"{m} pct"].to_numpy(float)
        base = np.where(np.isnan(dev_all[m]), x, dev_all[m])
        forecast[m] = models._transfer_predict(fit, pairs, base, m, tiers)
        truth[m] = pairs[f"{m} pct_next"].to_numpy(float)
    core = float(presets.get("coreWeight", 1.5))
    roles = pairs["Position"].to_numpy()
    rows = []
    for name, preset in presets["presets"].items():
        sel = np.isin(roles, preset["positions"]) & moved
        if not sel.any():
            continue
        p, t = models.role_index(forecast, preset, core), models.role_index(truth, preset, core)
        idx = np.nonzero(sel)[0]
        rows.append(pd.DataFrame({"pair": idx, "preset": name, "pred": p[idx], "true": t[idx], "test": test[idx]}))
    long = pd.concat(rows, ignore_index=True)
    profiles = squad_profiles(players)
    dims = [f"dim_{k}" for k in SQUAD_DIMENSIONS]
    seller = profiles.rename(columns={d: f"{d}_from" for d in dims})
    buyer = profiles.rename(columns={**{d: f"{d}_to" for d in dims}, "Team ID": "Team ID_next", "Competition": "Competition_next"})
    pk = pairs[["Team ID", "Competition", "_app_season", "Team ID_next", "Competition_next"]].reset_index().rename(columns={"index": "pair"})
    pk = pk.merge(seller[["Team ID", "Competition", "_app_season", *(f"{d}_from" for d in dims)]], on=["Team ID", "Competition", "_app_season"], how="left")
    pk = pk.merge(buyer[["Team ID_next", "Competition_next", "_app_season", *(f"{d}_to" for d in dims)]], on=["Team ID_next", "Competition_next", "_app_season"], how="left")
    for d in dims:
        pk[d] = (pk[f"{d}_to"] - pk[f"{d}_from"]) / 100
    pk["friction"] = pk[dims].abs().mean(axis=1, skipna=False)
    long = long.merge(pk[["pair", "friction", *dims]], on="pair", how="left")
    out = friction_effect(long, dims)
    out.update({"season": season, "movers": int(moved[test].sum()), "moversWithProfiles": int(long[long["test"]].dropna(subset=["friction"])["pair"].nunique()),
                "dimensions": list(SQUAD_DIMENSIONS)})
    return out


# ============================================
# EFFICACITÉ SUR COUPS DE PIED ARRÊTÉS (expérience 22)
# ============================================

SET_PIECE_SITUATIONS = ("FromCorner", "SetPiece", "FreeKick", "ThrowInSetPiece")


def set_piece_efficiency(shots: pd.DataFrame, current: str) -> dict:
    """Au-delà de la part d'xG sur phases arrêtées (expérience « Set pieces »), ce qui se répète d'une
    saison à l'autre : buts marqués au-delà de l'xG sur les tirs de phase arrêtée (finition et
    organisation, par tir), xG de phase arrêtée produit et concédé par match. Penalties exclus."""
    s = shots[shots["situation"] != "Penalty"].copy()
    s["sp"] = s["situation"].isin(SET_PIECE_SITUATIONS)
    s["goal"] = (s["event_type"] == "Goal") if "event_type" in s else False
    teams_of = s.groupby("match_id")["team_id"].agg(lambda v: tuple(sorted(set(v))))
    s["opponent"] = [next((t for t in teams_of.get(m, ()) if t != own), None) for m, own in zip(s["match_id"], s["team_id"])]
    key = ["comp", "app_season", "team_id"]
    sp = s[s["sp"]]
    forr = sp.groupby(key).agg(xg_for=("expected_goals", "sum"), goals_for=("goal", "sum"), shots_for=("sp", "size"), matches=("match_id", "nunique")).reset_index()
    against = (sp.dropna(subset=["opponent"]).rename(columns={"team_id": "shooter", "opponent": "team_id"})
               .groupby(key).agg(xg_against=("expected_goals", "sum")).reset_index())
    t = forr.merge(against, on=key, how="left")
    t = t[t["shots_for"] >= 10]
    t["over"] = (t["goals_for"] - t["xg_for"]) / t["shots_for"]
    t["xg_for_match"] = t["xg_for"] / t["matches"]
    t["xg_against_match"] = t["xg_against"] / t["matches"]
    closed = t[t["app_season"] != current]
    r_over, n = _season_pairs(closed, "over", ["team_id", "comp"])
    r_for, _ = _season_pairs(closed, "xg_for_match", ["team_id", "comp"])
    r_against, _ = _season_pairs(closed, "xg_against_match", ["team_id", "comp"])
    return {
        "pairs": n, "teamSeasons": int(len(t)),
        "overperformance": {"mean": round(float(t["over"].mean()), 4), "r": round(r_over, 3)},
        "xgForPerMatch": {"mean": round(float(t["xg_for_match"].mean()), 3), "r": round(r_for, 3)},
        "xgAgainstPerMatch": {"mean": round(float(t["xg_against_match"].mean()), 3), "r": round(r_against, 3)},
        "verdict": "validated" if r_over >= 0.3 else ("partial" if r_for >= 0.3 or r_against >= 0.3 else "debunked"),
    }
