"""
ScoutVision AI - Labo marché : peut-on battre le marché avec ce que ScoutVision possède déjà ?

Le marché de clôture est la meilleure prévision publique qui existe (poids 0 du modèle du
pipeline dans un mélange, CLV négatif : scripts/market.py). On ne le bat pas avec un meilleur
Poisson ; on cherche où il est lent (compositions), mince (ligues peu couvertes, coupes) ou
aveugle (interactions que personne ne modélise). Chaque expérience pose une question, se
valide sur des saisons que le modèle n'a pas vues, et rend un verdict (mêmes règles que lab.py).

Modèle de base : le modèle conjoint toutes compétitions (models.fit_joint), réajusté chaque
semaine sur les seuls matchs antérieurs : des probabilités 1-N-2 hors échantillon pour tous
les matchs, sur lesquelles chaque signal est testé. Test standard d'un signal : régression
multinomiale (domicile et extérieur contre nul) sur les logits du modèle de base, avec et
sans le signal, ajustée sur les saisons d'apprentissage et jugée sur la saison de test
(log-loss, intervalle bootstrap par match). Avec les cotes : gain contre la cote d'ouverture
jugé à la clôture (CLV), comme dans market.py. numpy et pandas seuls.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

import models

RNG_SEED = 7
EDGE_THRESHOLD = 0.05        # avantage minimal pour simuler un pari (market.EDGE_THRESHOLD)
MIN_TRAIN = 500


# ============================================
# OUTILS
# ============================================

def _ci(samples) -> list[float]:
    s = np.asarray(samples, float)
    s = s[~np.isnan(s)]
    if len(s) == 0:
        return [float("nan"), float("nan")]
    return [round(float(np.percentile(s, 2.5)), 4), round(float(np.percentile(s, 97.5)), 4)]


def _boot_mean(values: np.ndarray, n: int = 1000) -> list[float]:
    """Intervalle bootstrap de la moyenne (par observation)."""
    v = np.asarray(values, float)
    if len(v) < 2:
        return [float("nan"), float("nan")]
    rng = np.random.default_rng(RNG_SEED)
    idx = rng.integers(0, len(v), (n, len(v)))
    return _ci(v[idx].mean(axis=1))


def log_loss(p: np.ndarray, outcome: np.ndarray) -> np.ndarray:
    """Surprise de chaque match : -log de la probabilité donnée au résultat observé."""
    return -np.log(np.clip(p[np.arange(len(p)), outcome], 1e-12, None))


def rps(p: np.ndarray, outcome: np.ndarray) -> np.ndarray:
    cum = np.cumsum(p, axis=1)[:, :2]
    obs = np.cumsum(np.eye(3)[outcome], axis=1)[:, :2]
    return ((cum - obs) ** 2).sum(axis=1) / 2


def devig(odds: np.ndarray) -> np.ndarray:
    """Probabilités sans marge, méthode « power » (market.devig) ; lignes incomplètes -> NaN."""
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


def _logits(p: np.ndarray) -> np.ndarray:
    """Logits du modèle de base contre le nul : log(p_h / p_d), log(p_a / p_d)."""
    p = np.clip(p, 1e-6, None)
    return np.column_stack([np.log(p[:, 0] / p[:, 1]), np.log(p[:, 2] / p[:, 1])])


def multinomial_fit(x: np.ndarray, y: np.ndarray, l2: float = 1.0, iters: int = 50) -> np.ndarray:
    """Régression multinomiale (nul = référence) par Newton, pénalité ridge hors constantes.
    x : (n, k) avec une colonne de 1 ; y : 0 domicile, 1 nul, 2 extérieur. Renvoie (2, k)."""
    n, k = x.shape
    w = np.zeros((2, k))
    pen = l2 * np.eye(2 * k)
    pen[0, 0] = pen[k, k] = 0.0
    yh, ya = (y == 0).astype(float), (y == 2).astype(float)
    for _ in range(iters):
        eh, ea = np.exp(x @ w[0]), np.exp(x @ w[1])
        z = 1 + eh + ea
        ph, pa = eh / z, ea / z
        grad = np.concatenate([x.T @ (yh - ph), x.T @ (ya - pa)]) - pen @ w.ravel()
        hhh = x.T @ (x * (ph * (1 - ph))[:, None])
        haa = x.T @ (x * (pa * (1 - pa))[:, None])
        hha = -x.T @ (x * (ph * pa)[:, None])
        hess = np.block([[hhh, hha], [hha, haa]]) + pen
        step = np.linalg.solve(hess, grad)
        w = w + step.reshape(2, k)
        if np.max(np.abs(step)) < 1e-8:
            break
    return w


def multinomial_predict(x: np.ndarray, w: np.ndarray) -> np.ndarray:
    eh, ea = np.exp(x @ w[0]), np.exp(x @ w[1])
    z = 1 + eh + ea
    return np.column_stack([eh / z, 1 / z, ea / z])


def signal_gain(base: np.ndarray, signal: np.ndarray, outcome: np.ndarray, train: np.ndarray,
                test: np.ndarray, l2: float = 1.0) -> dict:
    """Le signal ajoute-t-il de l'information au modèle de base ? Deux régressions multinomiales
    sur les logits de base (recalibrage seul, puis avec le signal), ajustées sur `train`,
    jugées sur `test` : gain de log-loss par match et intervalle bootstrap, coefficients."""
    s = np.asarray(signal, float)
    ok = ~np.isnan(s) & ~np.isnan(base).any(axis=1)
    tr, te = train & ok, test & ok
    if tr.sum() < MIN_TRAIN or te.sum() < 50:
        return {"train": int(tr.sum()), "test": int(te.sum()), "gain": float("nan"), "ci": [float("nan")] * 2,
                "verdict": "measured"}
    lg = _logits(base)
    scale = s[tr].std() or 1.0
    x0 = np.column_stack([np.ones(len(s)), lg])
    x1 = np.column_stack([x0, s / scale])
    w0 = multinomial_fit(x0[tr], outcome[tr], l2)
    w1 = multinomial_fit(x1[tr], outcome[tr], l2)
    ll0 = log_loss(multinomial_predict(x0[te], w0), outcome[te])
    ll1 = log_loss(multinomial_predict(x1[te], w1), outcome[te])
    llb = log_loss(base[te], outcome[te])
    diff = ll0 - ll1
    ci = _boot_mean(diff)
    return {"train": int(tr.sum()), "test": int(te.sum()),
            "llBase": round(float(llb.mean()), 4), "llRecal": round(float(ll0.mean()), 4), "llSignal": round(float(ll1.mean()), 4),
            "gain": round(float(diff.mean()), 4), "ci": ci,
            "coef": [round(float(w1[0, -1]), 3), round(float(w1[1, -1]), 3)], "signalSd": round(float(scale), 4),
            "verdict": "validated" if ci[0] > 0 else ("partial" if diff.mean() > 0 and ci[1] > 0 and ci[0] > -diff.mean() else "debunked")}


# ============================================
# MATCHS ET MODÈLE DE BASE
# ============================================

def match_frame(match: pd.DataFrame, team_match: pd.DataFrame, cups: set[str]) -> pd.DataFrame:
    """Une ligne par match terminé : équipes, score, xG, issue (0 domicile, 1 nul, 2 extérieur)."""
    m = match[match["match_status"] == "finished"].copy()
    xg = team_match[team_match["is_home"] == True][["match_id", "xg_for", "xg_against"]]
    m = m.merge(xg.rename(columns={"xg_for": "xg_home", "xg_against": "xg_away"}), on="match_id", how="left")
    m = m.rename(columns={"home_team_id": "home", "away_team_id": "away", "score_home": "goals_home",
                          "score_away": "goals_away", "home_team_name": "home_name", "away_team_name": "away_name"})
    m["date"] = pd.to_datetime(m["date"], format="mixed", utc=True).dt.tz_localize(None)
    m["competition"] = m["comp"]
    m["league"] = ~m["comp"].isin(cups)
    m["outcome"] = np.where(m["goals_home"] > m["goals_away"], 0, np.where(m["goals_home"] == m["goals_away"], 1, 2))
    m = m.dropna(subset=["goals_home", "goals_away"]).drop_duplicates("match_id")
    return m.sort_values("date").reset_index(drop=True)


def domestic_leagues(mf: pd.DataFrame) -> dict[str, str]:
    """Championnat de chaque équipe : celui où elle a le plus joué (coupes écartées)."""
    lg = mf[mf["league"]]
    long = pd.concat([lg[["home", "comp"]].rename(columns={"home": "team"}),
                      lg[["away", "comp"]].rename(columns={"away": "team"})])
    return long.groupby("team")["comp"].agg(lambda s: s.value_counts().index[0]).to_dict()


def rolling_base(mf: pd.DataFrame, team_league: dict[str, str], start: pd.Timestamp,
                 step_days: int = 7, window_days: int = 730, fit=models.fit_joint) -> pd.DataFrame:
    """Probabilités hors échantillon : tous les `step_days`, le modèle conjoint est ajusté sur les
    matchs des `window_days` précédents et prédit les matchs de la période suivante.
    Renvoie match_id, p_home, p_draw, p_away, lh, la (buts attendus) et la date d'ajustement."""
    rows = []
    end = mf["date"].max()
    for at in pd.date_range(start, end, freq=f"{step_days}D"):
        test = mf[(mf["date"] >= at) & (mf["date"] < at + pd.Timedelta(days=step_days))]
        if test.empty:
            continue
        train = mf[(mf["date"] < at) & (mf["date"] >= at - pd.Timedelta(days=window_days))]
        if len(train) < MIN_TRAIN:
            continue
        model = fit(train, team_league, at)
        for r in test.itertuples():
            pr = model.probabilities(r.home, r.away)
            if pr is None:
                continue
            lh, la = model.rates(r.home, r.away)
            rows.append((r.match_id, pr[0], pr[1], pr[2], lh, la, at))
    return pd.DataFrame(rows, columns=["match_id", "p_home", "p_draw", "p_away", "lh", "la", "fitted_at"])


def split_seasons(mf: pd.DataFrame, test_season: str) -> tuple[np.ndarray, np.ndarray]:
    """Masques d'apprentissage (saisons antérieures) et de test (une saison close)."""
    s = mf["app_season"].to_numpy()
    return s < test_season, s == test_season


# ============================================
# CALIBRATION DU MODÈLE DE BASE
# ============================================

def calibration(mf: pd.DataFrame, base: np.ndarray, test_season: str) -> dict:
    """Les probabilités de base sont-elles bien calibrées ? Nuls prévus contre observés par
    compétition ; une seule constante de température T (p ∝ p^(1/T)) ajustée sur les saisons
    antérieures et jugée sur la saison de test ; diagramme de fiabilité de P(domicile)."""
    train, test = split_seasons(mf, test_season)
    out = mf["outcome"].to_numpy()
    ok = ~np.isnan(base).any(axis=1)
    train, test = train & ok, test & ok

    def temper(p, t):
        q = np.clip(p, 1e-9, None) ** (1 / t)
        return q / q.sum(axis=1, keepdims=True)

    grid = np.arange(0.7, 1.31, 0.01)
    lls = [log_loss(temper(base[train], t), out[train]).mean() for t in grid]
    t_best = float(grid[int(np.argmin(lls))])
    ll_raw = log_loss(base[test], out[test])
    ll_t = log_loss(temper(base[test], t_best), out[test])
    diff = ll_raw - ll_t
    ci = _boot_mean(diff)

    comps = mf["comp"].to_numpy()
    draws = {}
    for c in sorted(set(comps[test])):
        mask = test & (comps == c)
        if mask.sum() >= 100:
            draws[c] = {"matches": int(mask.sum()), "predicted": round(float(base[mask, 1].mean()), 3),
                        "observed": round(float((out[mask] == 1).mean()), 3)}
    bins = np.linspace(0, 1, 11)
    rel = []
    ph = base[test, 0]
    for lo, hi in zip(bins[:-1], bins[1:]):
        m = (ph >= lo) & (ph < hi)
        if m.sum() >= 20:
            rel.append({"lo": round(float(lo), 1), "hi": round(float(hi), 1), "n": int(m.sum()),
                        "predicted": round(float(ph[m].mean()), 3), "observed": round(float((out[test][m] == 0).mean()), 3)})
    ece = float(sum(abs(b["predicted"] - b["observed"]) * b["n"] for b in rel) / max(sum(b["n"] for b in rel), 1))
    draw_bias = float(np.mean([d["predicted"] - d["observed"] for d in draws.values()])) if draws else float("nan")
    return {"season": test_season, "matches": int(test.sum()), "temperature": round(t_best, 2),
            "llRaw": round(float(ll_raw.mean()), 4), "llTempered": round(float(ll_t.mean()), 4),
            "gain": round(float(diff.mean()), 4), "ci": ci, "ece": round(ece, 4), "reliability": rel,
            "draws": draws, "drawBias": round(draw_bias, 4),
            "verdict": "validated" if ci[0] > 0 and diff.mean() >= 0.002 else "debunked"}


# ============================================
# COUPES D'EUROPE : L'AVANTAGE INFORMATIONNEL
# ============================================

def cups_strength(mf: pd.DataFrame, base: np.ndarray, tiers: dict[str, int], team_league: dict[str, str],
                  cups: set[str]) -> dict:
    """En coupe d'Europe, le modèle conjoint (niveaux de championnat liés par les matchs de coupe)
    bat-il les fréquences 1-N-2 ? Par saison et par paire de niveaux des deux clubs."""
    is_cup = mf["comp"].isin(cups).to_numpy() & ~np.isnan(base).any(axis=1)
    out = mf["outcome"].to_numpy()
    seasons = mf["app_season"].to_numpy()
    dates = mf["date"].to_numpy()
    res = {"seasons": {}, "tiers": {}}
    order = np.argsort(dates)
    cum_counts = np.zeros(3)
    freq = np.full((len(mf), 3), np.nan)
    for i in order:                                  # fréquences des matchs de coupe antérieurs
        if is_cup[i]:
            if cum_counts.sum() >= 30:
                freq[i] = cum_counts / cum_counts.sum()
            cum_counts[out[i]] += 1
    ok = is_cup & ~np.isnan(freq).any(axis=1)
    for s in sorted(set(seasons[ok])):
        m = ok & (seasons == s)
        if m.sum() < 30:
            continue
        d = rps(freq[m], out[m]) - rps(base[m], out[m])
        res["seasons"][s] = {"matches": int(m.sum()), "rpsModel": round(float(rps(base[m], out[m]).mean()), 4),
                             "rpsFrequencies": round(float(rps(freq[m], out[m]).mean()), 4),
                             "llModel": round(float(log_loss(base[m], out[m]).mean()), 4),
                             "llFrequencies": round(float(log_loss(freq[m], out[m]).mean()), 4),
                             "gain": round(float(d.mean()), 4), "ci": _boot_mean(d)}
    th = mf["home"].map(lambda t: tiers.get(team_league.get(t, ""), 3)).to_numpy()
    ta = mf["away"].map(lambda t: tiers.get(team_league.get(t, ""), 3)).to_numpy()
    pair = np.where(np.minimum(th, ta) == 1, np.where(np.maximum(th, ta) == 1, "1-1", "1-2+"), "2+-2+")
    for p in ("1-1", "1-2+", "2+-2+"):
        m = ok & (pair == p)
        if m.sum() < 30:
            continue
        d = rps(freq[m], out[m]) - rps(base[m], out[m])
        res["tiers"][p] = {"matches": int(m.sum()), "rpsModel": round(float(rps(base[m], out[m]).mean()), 4),
                           "rpsFrequencies": round(float(rps(freq[m], out[m]).mean()), 4),
                           "gain": round(float(d.mean()), 4), "ci": _boot_mean(d)}
    last = res["seasons"].get(max(res["seasons"]), {}) if res["seasons"] else {}
    res["verdict"] = "validated" if last.get("ci", [0])[0] > 0 else ("partial" if last.get("gain", 0) > 0 else "debunked")
    res["matches"] = int(ok.sum())
    return res


# ============================================
# COMPOSITIONS : ABSENTS ET RUPTURE DE RÉSEAU
# ============================================

REGULAR_SHARE = 0.6      # titulaire habituel : a débuté 60 % des matchs précédents de la saison
MIN_PRIOR = 5            # ... sur au moins 5 matchs
XI_HALF_LIFE = 2.0       # onze probable : poids des titularisations divisé par deux tous les 2 matchs


def absence_features(lineup: pd.DataFrame, edges: pd.DataFrame, mf: pd.DataFrame) -> pd.DataFrame:
    """Par équipe et par match (toutes compétitions, saison par saison, matchs antérieurs seulement) :
    - regulars : titulaires habituels ; missing : ceux absents du onze du jour ;
    - missing_share : part des passes de l'équipe (réseaux des matchs antérieurs) qui passaient par
      les absents (rupture de réseau) ; missing_prev : absents déjà absents au match précédent ;
    - xi_hit : part du onze du jour retrouvée par le onze probable (titularisations récentes,
      pondération exponentielle) ; last_hit : même chose en reprenant le dernier onze.
    """
    lu = lineup[lineup["role"] == "starter"][["match_id", "team_id", "player_id"]].drop_duplicates()
    dates = mf.set_index("match_id")["date"]
    lu = lu[lu["match_id"].isin(dates.index)]
    lu["date"] = lu["match_id"].map(dates)
    lu["season"] = lu["match_id"].map(mf.set_index("match_id")["app_season"])
    # passes impliquant chaque joueur, par match et par équipe
    e = edges[edges["match_id"].isin(dates.index)]
    pp = pd.concat([e[["match_id", "team_id", "from_player_id", "passes"]].rename(columns={"from_player_id": "player_id"}),
                    e[["match_id", "team_id", "to_player_id", "passes"]].rename(columns={"to_player_id": "player_id"})])
    pp = pp.groupby(["match_id", "team_id", "player_id"])["passes"].sum()
    pass_by_match: dict[tuple[str, str], dict[str, float]] = {}
    for (mid, tid, pid), v in pp.items():
        pass_by_match.setdefault((mid, tid), {})[pid] = float(v)

    rows = []
    for (tid, season), g in lu.groupby(["team_id", "season"], sort=False):
        order = g.sort_values(["date", "match_id"]).groupby("match_id", sort=False)
        starts: dict[str, int] = {}
        weight: dict[str, float] = {}
        passes: dict[str, float] = {}
        total_passes = 0.0
        prev_xi: set[str] = set()
        prev_missing: set[str] = set()
        k = 0
        decay = 0.5 ** (1 / XI_HALF_LIFE)
        for mid, xi_df in order:
            xi = set(xi_df["player_id"])
            regulars = {p for p, n in starts.items() if k >= MIN_PRIOR and n / k >= REGULAR_SHARE}
            missing = regulars - xi
            share = sum(passes.get(p, 0.0) for p in missing) / total_passes if total_passes > 0 else 0.0
            top = sorted(weight, key=weight.get, reverse=True)[:11] if k > 0 else []
            rows.append((mid, tid, k, len(regulars), len(missing), share, len(missing & prev_missing),
                         len(xi & set(top)) / 11 if k > 0 else np.nan, len(xi & prev_xi) / 11 if k > 0 else np.nan))
            # mise à jour avec le match du jour
            for p in weight:
                weight[p] *= decay
            for p in xi:
                starts[p] = starts.get(p, 0) + 1
                weight[p] = weight.get(p, 0.0) + 1.0
            pm = pass_by_match.get((mid, tid))
            if pm:
                for p, v in pm.items():
                    passes[p] = passes.get(p, 0.0) + v
                total_passes += sum(pm.values()) / 2       # chaque passe compte pour deux joueurs
            prev_xi, prev_missing, k = xi, missing, k + 1
    return pd.DataFrame(rows, columns=["match_id", "team_id", "prior", "regulars", "missing", "missing_share",
                                       "missing_prev", "xi_hit", "last_hit"])


def _side_signal(mf: pd.DataFrame, feat: pd.DataFrame, col: str) -> np.ndarray:
    """Signal d'un match = valeur de l'équipe à domicile moins celle de l'équipe à l'extérieur."""
    f = feat.set_index(["match_id", "team_id"])[col]
    h = pd.Series(list(zip(mf["match_id"], mf["home"]))).map(f).to_numpy(float)
    a = pd.Series(list(zip(mf["match_id"], mf["away"]))).map(f).to_numpy(float)
    return h - a


def absences(mf: pd.DataFrame, base: np.ndarray, feat: pd.DataFrame, test_season: str) -> dict:
    """Les absents déplacent-ils la probabilité au-delà du modèle de base ? Trois signaux (domicile
    moins extérieur) : nombre de titulaires habituels absents, part des passes qu'ils portaient
    (rupture de réseau), absents déjà absents au match précédent (connus avant l'annonce du onze).
    Et le onze probable : part du onze retrouvée avant l'annonce."""
    train, test = split_seasons(mf, test_season)
    out = mf["outcome"].to_numpy()
    lg = mf["league"].to_numpy()
    train, test = train & lg, test & lg
    res = {"season": test_season}
    for name, col in (("count", "missing"), ("share", "missing_share"), ("known", "missing_prev")):
        res[name] = signal_gain(base, _side_signal(mf, feat, col), out, train, test)
    # la rupture de réseau ajoute-t-elle au simple nombre d'absents ?
    s_count = _side_signal(mf, feat, "missing")
    s_share = _side_signal(mf, feat, "missing_share")
    ok = ~np.isnan(s_count) & ~np.isnan(s_share) & ~np.isnan(base).any(axis=1)
    tr, te = train & ok, test & ok
    if tr.sum() >= MIN_TRAIN and te.sum() >= 50:
        lgt = _logits(base)
        x1 = np.column_stack([np.ones(len(mf)), lgt, s_count / (s_count[tr].std() or 1)])
        x2 = np.column_stack([x1, s_share / (s_share[tr].std() or 1)])
        w1, w2 = multinomial_fit(x1[tr], out[tr]), multinomial_fit(x2[tr], out[tr])
        d = log_loss(multinomial_predict(x1[te], w1), out[te]) - log_loss(multinomial_predict(x2[te], w2), out[te])
        res["shareBeyondCount"] = {"gain": round(float(d.mean()), 4), "ci": _boot_mean(d)}
    f = feat.merge(mf[["match_id", "app_season", "league"]], on="match_id")
    f = f[f["league"] & (f["prior"] >= MIN_PRIOR)]
    by = f.groupby("app_season")[["xi_hit", "last_hit", "missing", "missing_share"]].mean()
    res["xi"] = {s: {"predicted": round(float(r["xi_hit"]), 3), "lastEleven": round(float(r["last_hit"]), 3),
                     "missing": round(float(r["missing"]), 2), "missingShare": round(float(r["missing_share"]), 3)}
                 for s, r in by.iterrows()}
    res["teamMatches"] = int(len(f))
    best = max(res[k]["gain"] for k in ("count", "share", "known") if not np.isnan(res[k]["gain"]))
    res["verdict"] = "validated" if any(res[k]["verdict"] == "validated" for k in ("count", "share", "known")) \
        else ("partial" if best > 0 else "debunked")
    return res


# ============================================
# COUPS DE PIED ARRÊTÉS
# ============================================

SET_PIECE_SITUATIONS = ("FromCorner", "SetPiece", "FreeKick", "ThrowInSetPiece")
SHRINK_MATCHES = 8


def set_piece_features(shot: pd.DataFrame, mf: pd.DataFrame) -> pd.DataFrame:
    """xG sur phases arrêtées (hors penalties) produit et concédé par match, par équipe, sur les
    matchs antérieurs de la saison, ramenés vers la moyenne de la compétition (SHRINK_MATCHES)."""
    s = shot[shot["situation"].isin(SET_PIECE_SITUATIONS)]
    sp = s.groupby(["match_id", "team_id"])["expected_goals"].sum().rename("sp").reset_index()
    sides = pd.concat([mf[["match_id", "comp", "app_season", "date", "home", "away"]].rename(columns={"home": "team_id", "away": "opp"}),
                       mf[["match_id", "comp", "app_season", "date", "away", "home"]].rename(columns={"away": "team_id", "home": "opp"})])
    sides = sides.merge(sp, on=["match_id", "team_id"], how="left").fillna({"sp": 0.0})
    against = sides[["match_id", "team_id", "sp"]].rename(columns={"team_id": "opp", "sp": "sp_against"})
    sides = sides.merge(against, on=["match_id", "opp"], how="left").fillna({"sp_against": 0.0})
    sides = sides.sort_values(["team_id", "app_season", "date", "match_id"])
    key = ["team_id", "app_season"]
    g = sides.groupby(key)
    sides["n"] = g.cumcount()
    sides["cum_for"] = g["sp"].cumsum() - sides["sp"]
    sides["cum_against"] = g["sp_against"].cumsum() - sides["sp_against"]
    mean = sides.groupby(["comp", "app_season"])["sp"].transform("mean")
    k = SHRINK_MATCHES
    sides["sp_for_rate"] = (sides["cum_for"] + k * mean) / (sides["n"] + k)
    sides["sp_against_rate"] = (sides["cum_against"] + k * mean) / (sides["n"] + k)
    return sides[["match_id", "team_id", "n", "sp_for_rate", "sp_against_rate"]]


def set_piece_signal(mf: pd.DataFrame, base: np.ndarray, feat: pd.DataFrame, test_season: str) -> dict:
    """Le xG attendu sur coups de pied arrêtés (attaque de l'une contre défense de l'autre) ajoute-t-il
    au modèle de base, qui ne voit que des forces globales ?"""
    train, test = split_seasons(mf, test_season)
    lg = mf["league"].to_numpy()
    f = feat.set_index(["match_id", "team_id"])
    h = pd.Series(list(zip(mf["match_id"], mf["home"])))
    a = pd.Series(list(zip(mf["match_id"], mf["away"])))
    exp_home = h.map(f["sp_for_rate"]).to_numpy(float) + a.map(f["sp_against_rate"]).to_numpy(float)
    exp_away = a.map(f["sp_for_rate"]).to_numpy(float) + h.map(f["sp_against_rate"]).to_numpy(float)
    n_ok = (h.map(f["n"]).to_numpy(float) >= MIN_PRIOR) & (a.map(f["n"]).to_numpy(float) >= MIN_PRIOR)
    signal = np.where(n_ok, exp_home - exp_away, np.nan)
    res = signal_gain(base, signal, mf["outcome"].to_numpy(), train & lg, test & lg)
    res["season"] = test_season
    res["meanExpected"] = round(float(np.nanmean(exp_home[n_ok & lg])), 3)
    return res


# ============================================
# ARBITRE × PROFIL DE FAUTES : LE CARTON ROUGE
# ============================================

def red_card_features(mf: pd.DataFrame, event: pd.DataFrame) -> pd.DataFrame:
    """Par équipe et par match : probabilité de recevoir un carton rouge estimée avant le match, à
    partir du taux de rouges de l'arbitre, des rouges et des jaunes de l'équipe et de l'adversaire
    sur leurs matchs antérieurs (toutes saisons, ramenés vers la moyenne)."""
    ev = event[event["event_type"].isin(["redcard", "yellowcard"]) & event["match_id"].isin(mf["match_id"])]
    cards = ev.groupby(["match_id", "team_id", "event_type"]).size().unstack(fill_value=0).reset_index()
    for c in ("redcard", "yellowcard"):
        if c not in cards:
            cards[c] = 0
    sides = pd.concat([mf[["match_id", "date", "referee", "home", "away"]].assign(is_home=1).rename(columns={"home": "team_id", "away": "opp"}),
                       mf[["match_id", "date", "referee", "away", "home"]].assign(is_home=0).rename(columns={"away": "team_id", "home": "opp"})])
    sides = sides.merge(cards, on=["match_id", "team_id"], how="left").fillna({"redcard": 0, "yellowcard": 0})
    sides["red"] = (sides["redcard"] > 0).astype(float)
    sides = sides.sort_values(["date", "match_id"])
    mean_red, mean_yel = sides["red"].mean(), sides["yellowcard"].mean()

    def prior_rate(col: str, by: str, mean: float, k: float) -> np.ndarray:
        g = sides.groupby(by, sort=False)
        n = g.cumcount()
        cum = g[col].cumsum() - sides[col]
        return ((cum + k * mean) / (n + k)).to_numpy(float)

    sides["ref_red"] = prior_rate("red", "referee", mean_red, 40)
    sides["team_red"] = prior_rate("red", "team_id", mean_red, 40)
    sides["team_yellow"] = prior_rate("yellowcard", "team_id", mean_yel, 20)
    opp = sides[["match_id", "team_id", "team_yellow", "team_red"]].rename(columns={"team_id": "opp", "team_yellow": "opp_yellow", "team_red": "opp_red"})
    sides = sides.merge(opp, on=["match_id", "opp"], how="left")
    sides.loc[sides["referee"].isna() | (sides["referee"] == ""), "ref_red"] = mean_red
    return sides[["match_id", "team_id", "is_home", "red", "ref_red", "team_red", "team_yellow", "opp_yellow", "opp_red"]]


def _logit_fit(x: np.ndarray, y: np.ndarray, l2: float = 1.0, iters: int = 60) -> np.ndarray:
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
    n1 = float(y.sum()); n0 = len(y) - n1
    return float((rank[y == 1].sum() - n1 * (n1 + 1) / 2) / (n1 * n0)) if n1 and n0 else float("nan")


def red_cards(mf: pd.DataFrame, base_rates: np.ndarray, base: np.ndarray, feat: pd.DataFrame, test_season: str) -> dict:
    """L'arbitre et le profil de fautes annoncent-ils un carton rouge, et le rouge annoncé change-t-il
    la distribution des buts ? (1) logistique du rouge par équipe, AUC hors échantillon ;
    (2) plus de 2,5 buts : la probabilité de rouge ajoute-t-elle au Poisson du modèle de base ?
    (3) 1-N-2 : différence de probabilité de rouge entre les deux équipes."""
    seasons = mf.set_index("match_id")["app_season"]
    f = feat.copy()
    f["season"] = f["match_id"].map(seasons)
    tr, te = (f["season"] < test_season).to_numpy(), (f["season"] == test_season).to_numpy()
    cols = ["ref_red", "team_red", "team_yellow", "opp_yellow", "is_home"]
    x = np.column_stack([np.ones(len(f)), f[cols].to_numpy(float)])
    mu, sd = x[tr, 1:].mean(axis=0), x[tr, 1:].std(axis=0)
    x[:, 1:] = (x[:, 1:] - mu) / np.where(sd > 0, sd, 1)
    y = f["red"].to_numpy(float)
    w = _logit_fit(x[tr], y[tr])
    p_red = 1 / (1 + np.exp(-x @ w))
    auc = _auc(p_red[te], y[te])
    base_auc = _auc(x[te, 1], y[te])            # l'arbitre seul
    f["p_red"] = p_red
    pr = f.set_index(["match_id", "team_id"])["p_red"]
    h = pd.Series(list(zip(mf["match_id"], mf["home"]))).map(pr).to_numpy(float)
    a = pd.Series(list(zip(mf["match_id"], mf["away"]))).map(pr).to_numpy(float)

    train, test = split_seasons(mf, test_season)
    lg = mf["league"].to_numpy()
    out = mf["outcome"].to_numpy()
    res = {"season": test_season, "teamMatches": int(te.sum()), "redRate": round(float(y[te].mean()), 4),
           "auc": round(auc, 3), "aucRefereeOnly": round(base_auc, 3),
           "coef": {c: round(float(v), 3) for c, v in zip(cols, w[1:])},
           "outcome": signal_gain(base, h - a, out, train & lg, test & lg)}
    # plus de 2,5 buts : Poisson sur les buts attendus du modèle, avec et sans la probabilité de rouge
    lam = base_rates.sum(axis=1)
    ok = ~np.isnan(lam) & ~np.isnan(h) & ~np.isnan(a) & lg
    p_over = 1 - np.exp(-lam) * (1 + lam + lam ** 2 / 2)
    over = ((mf["goals_home"] + mf["goals_away"]) > 2.5).to_numpy(float)
    lo = np.log(np.clip(p_over, 1e-6, 1 - 1e-6) / np.clip(1 - p_over, 1e-6, None))
    x0 = np.column_stack([np.ones(len(mf)), lo])
    x1 = np.column_stack([x0, h + a])
    tr2, te2 = train & ok, test & ok
    if tr2.sum() >= MIN_TRAIN and te2.sum() >= 50:
        w0, w1 = _logit_fit(x0[tr2], over[tr2]), _logit_fit(x1[tr2], over[tr2])
        q0, q1 = 1 / (1 + np.exp(-x1[te2] @ np.append(w0, 0))), 1 / (1 + np.exp(-x1[te2] @ w1))
        ll = lambda q: -(over[te2] * np.log(q) + (1 - over[te2]) * np.log(1 - q))
        d = ll(q0) - ll(q1)
        res["overUnder"] = {"matches": int(te2.sum()), "llPoisson": round(float(ll(q0).mean()), 4), "llWithRed": round(float(ll(q1).mean()), 4),
                            "gain": round(float(d.mean()), 4), "ci": _boot_mean(d), "coef": round(float(w1[-1]), 3)}
    gains = [res["outcome"]["gain"]] + ([res["overUnder"]["gain"]] if "overUnder" in res else [])
    cis = [res["outcome"]["ci"]] + ([res["overUnder"]["ci"]] if "overUnder" in res else [])
    res["verdict"] = "validated" if any(c[0] > 0 for c in cis) else ("partial" if auc > 0.6 else "debunked")
    return res


# ============================================
# ENJEU ASYMÉTRIQUE EN FIN DE SAISON
# ============================================

def stakes_features(mf: pd.DataFrame, base: pd.DataFrame, last_share: float = 0.3, n_sims: int = 2000) -> pd.DataFrame:
    """Enjeu de chaque match de fin de saison (dernier tiers), par équipe : variation de la probabilité
    d'un objectif (titre, top 4, relégation) entre victoire et défaite dans des saisons simulées à
    partir du classement du jour et des probabilités de base (models.simulate_season)."""
    rows = []
    b = base.set_index("match_id")
    for (comp, season), g in mf[mf["league"]].groupby(["comp", "app_season"]):
        g = g.sort_values("date")
        if len(g) < 100:
            continue
        probs = g[["match_id"]].join(b[["p_home", "p_draw", "p_away"]], on="match_id")
        probs = probs.fillna({"p_home": 1 / 3, "p_draw": 1 / 3, "p_away": 1 / 3})
        fx_all = pd.DataFrame({"match_id": g["match_id"].to_numpy(), "date": g["date"].to_numpy(),
                               "home_id": g["home"].to_numpy(), "away_id": g["away"].to_numpy(),
                               "p_home": probs["p_home"].to_numpy(), "p_draw": probs["p_draw"].to_numpy(),
                               "p_away": probs["p_away"].to_numpy()})
        teams = sorted(set(g["home"]) | set(g["away"]))
        names = {**dict(zip(g["home"], g["home_name"])), **dict(zip(g["away"], g["away_name"]))}
        dates = sorted(set(g["date"].iloc[int(len(g) * (1 - last_share)):]))
        for d in dates:
            played = g[g["date"] < d]
            pts = {t: 0.0 for t in teams}; diff = {t: 0.0 for t in teams}
            for r in played.itertuples():
                gd = r.goals_home - r.goals_away
                pts[r.home] += 3 if gd > 0 else 1 if gd == 0 else 0
                pts[r.away] += 3 if gd < 0 else 1 if gd == 0 else 0
                diff[r.home] += gd; diff[r.away] -= gd
            table = pd.DataFrame({"team_id": teams, "team": [names[t] for t in teams],
                                  "points": [pts[t] for t in teams], "diff": [diff[t] for t in teams]})
            fx = fx_all[fx_all["date"] >= d]
            _, lev = models.simulate_season(table, fx, n=n_sims, leverage_until=d)
            for mid, entry in lev.items():
                for side, team in (("home", "home_id"), ("away", "away_id")):
                    if side in entry:
                        tid = fx.loc[fx["match_id"] == mid, team].iloc[0]
                        rows.append((mid, tid, entry[side]["delta"], entry[side]["objective"]))
    return pd.DataFrame(rows, columns=["match_id", "team_id", "leverage", "objective"])


def stakes(mf: pd.DataFrame, base: np.ndarray, feat: pd.DataFrame, test_season: str) -> dict:
    """En fin de saison, l'équipe qui a plus à gagner fait-elle mieux que prévu ? Signal : enjeu de
    l'équipe à domicile moins celui de l'équipe à l'extérieur ; et « rien à jouer » d'un seul côté."""
    train, test = split_seasons(mf, test_season)
    lg = mf["league"].to_numpy()
    s = _side_signal(mf, feat, "leverage")
    f = feat.set_index(["match_id", "team_id"])["leverage"]
    h = pd.Series(list(zip(mf["match_id"], mf["home"]))).map(f).to_numpy(float)
    a = pd.Series(list(zip(mf["match_id"], mf["away"]))).map(f).to_numpy(float)
    out = mf["outcome"].to_numpy()
    res = {"season": test_season, "difference": signal_gain(base, s, out, train & lg, test & lg)}
    # résidu de points par situation (saison de test) : les deux ont un enjeu, un seul, aucun
    ok = test & lg & ~np.isnan(h) & ~np.isnan(a) & ~np.isnan(base).any(axis=1)
    exp_home_pts = 3 * base[:, 0] + base[:, 1]
    pts_home = np.where(out == 0, 3, np.where(out == 1, 1, 0))
    resid = pts_home - exp_home_pts
    big = 0.05
    groups = {"homeOnly": (h >= big) & (a < big), "awayOnly": (h < big) & (a >= big), "both": (h >= big) & (a >= big),
              "none": (h < big) & (a < big)}
    res["homeResidual"] = {k: {"matches": int((ok & m).sum()), "residual": round(float(resid[ok & m].mean()), 3),
                               "ci": _boot_mean(resid[ok & m])} for k, m in groups.items() if (ok & m).sum() >= 30}
    res["matches"] = int(ok.sum())
    res["verdict"] = res["difference"]["verdict"]
    return res


# ============================================
# RÉACTION AU BUT ENCAISSÉ
# ============================================

def goal_reaction(mf: pd.DataFrame, event: pd.DataFrame, shot: pd.DataFrame, min_goals: int = 8) -> dict:
    """« Réagir au but encaissé » est-il un trait d'équipe ? xG produit dans les 10 minutes qui
    suivent un but encaissé, rapporté au xG habituel de l'équipe ; fiabilité entre matchs pairs et
    impairs d'une même saison (équipes avec au moins `min_goals` buts encaissés de chaque côté)."""
    ids = set(mf["match_id"])
    ev = event[(event["event_type"] == "goal") & (event["is_cancelled"] != True) & event["match_id"].isin(ids)
               & event["period"].isin(["FirstHalf", "SecondHalf"])].copy()
    ev["t"] = np.where(ev["period"] == "FirstHalf", np.minimum(ev["minute"], 45), np.minimum(ev["minute"], 90)).astype(float)
    sides = pd.concat([mf[["match_id", "comp", "app_season", "home", "away"]].rename(columns={"home": "team_id", "away": "opp"}),
                       mf[["match_id", "comp", "app_season", "away", "home"]].rename(columns={"away": "team_id", "home": "opp"})])
    # buts encaissés = buts crédités à l'adversaire
    conceded = ev[["match_id", "team_id", "t"]].rename(columns={"team_id": "opp"}).merge(sides, on=["match_id", "opp"])
    sh = shot[shot["match_id"].isin(ids) & shot["period"].isin(["FirstHalf", "SecondHalf"])].copy()
    sh["t"] = np.where(sh["period"] == "FirstHalf", np.minimum(sh["minute"], 45), np.minimum(sh["minute"], 90)).astype(float)
    x = sh[["match_id", "team_id", "t", "expected_goals"]].merge(conceded[["match_id", "team_id", "t"]].rename(columns={"t": "tc"}),
                                                                 on=["match_id", "team_id"])
    after = x[(x["t"] > x["tc"]) & (x["t"] <= x["tc"] + 10)].groupby(["match_id", "team_id"])["expected_goals"].sum()
    per_match = conceded.groupby(["match_id", "team_id"]).size().rename("conceded").reset_index()
    per_match = per_match.join(after.rename("xg_after"), on=["match_id", "team_id"]).fillna({"xg_after": 0.0})
    total = sh.groupby(["match_id", "team_id"])["expected_goals"].sum().rename("xg_total")
    per_match = per_match.join(total, on=["match_id", "team_id"]).fillna({"xg_total": 0.0})
    per_match = per_match.merge(sides[["match_id", "team_id", "comp", "app_season"]], on=["match_id", "team_id"])
    per_match = per_match.sort_values("match_id")
    per_match["half"] = per_match.groupby(["team_id", "app_season"]).cumcount() % 2
    agg = per_match.groupby(["comp", "app_season", "team_id", "half"]).agg(
        conceded=("conceded", "sum"), xg_after=("xg_after", "sum"), xg_total=("xg_total", "sum"), games=("match_id", "nunique")).reset_index()
    agg = agg[agg["conceded"] >= min_goals]
    agg["reaction"] = (agg["xg_after"] / (10 * agg["conceded"])) / (agg["xg_total"] / (90 * agg["games"])).replace(0, np.nan)
    wide = agg.pivot_table(index=["comp", "app_season", "team_id"], columns="half", values="reaction").dropna()
    r = float(np.corrcoef(wide[0], wide[1])[0, 1]) if len(wide) > 10 else float("nan")
    rng = np.random.default_rng(RNG_SEED)
    a, b = wide[0].to_numpy(), wide[1].to_numpy()
    ci = _ci([np.corrcoef(a[i], b[i])[0, 1] for i in (rng.integers(0, len(a), len(a)) for _ in range(1000))]) if len(wide) > 10 else [np.nan, np.nan]
    return {"teamSeasons": int(len(wide)), "meanReaction": round(float(agg["reaction"].mean()), 3), "r": round(r, 3), "ci": ci,
            "verdict": "validated" if r >= 0.3 else ("partial" if r >= 0.1 else "debunked")}


# ============================================
# COTES : CHARGEMENT ÉTENDU (football-data.co.uk)
# ============================================
#
# market.py ne garde que la clôture et la moyenne d'avant match des deux dernières saisons. Le
# labo lit toutes les saisons disponibles et davantage de colonnes : chaque bookmaker (dispersion),
# plus / moins de 2,5 et handicap asiatique à l'ouverture et à la clôture (cohérence inter-marchés).

BOOKMAKERS = ("B365", "BW", "PS", "WH", "VC", "IW")


def _num(df: pd.DataFrame, col: str) -> pd.Series:
    return pd.to_numeric(df[col], errors="coerce") if col in df else pd.Series(np.nan, index=df.index)


def _cols(df: pd.DataFrame, prefix: str, suffixes=("H", "D", "A")) -> np.ndarray:
    return np.column_stack([_num(df, f"{prefix}{s}") for s in suffixes])


def _first(*arrays: np.ndarray) -> np.ndarray:
    out = np.full(arrays[0].shape, np.nan)
    for a in arrays:
        fill = np.isnan(out).any(axis=1) & ~np.isnan(a).any(axis=1)
        out[fill] = a[fill]
    return out


def normalize_odds(df: pd.DataFrame, comp: str, home: str, away: str, hg: str, ag: str) -> pd.DataFrame:
    """Un match par ligne : clôture et ouverture 1-N-2, cotes par bookmaker, plus / moins 2,5,
    handicap asiatique (ligne et cotes), à l'ouverture et à la clôture quand elles existent."""
    close = _first(_cols(df, "BFEC"), _cols(df, "PSC"), _cols(df, "AvgC"))
    pre = _first(_cols(df, "Avg"), _cols(df, "PS"), _cols(df, "B365"))
    out = pd.DataFrame({
        "competition": comp,
        "date": pd.to_datetime(df["Date"], dayfirst=True, errors="coerce"),
        "home_name": df[home].astype(str).str.strip(), "away_name": df[away].astype(str).str.strip(),
        "goals_home": _num(df, hg), "goals_away": _num(df, ag),
        "close_h": close[:, 0], "close_d": close[:, 1], "close_a": close[:, 2],
        "pre_h": pre[:, 0], "pre_d": pre[:, 1], "pre_a": pre[:, 2],
        "ou_pre_over": _num(df, "Avg>2.5"), "ou_pre_under": _num(df, "Avg<2.5"),
        "ou_close_over": _first(_cols(df, "AvgC", (">2.5", "<2.5")), _cols(df, "PC", (">2.5", "<2.5")))[:, 0],
        "ou_close_under": _first(_cols(df, "AvgC", (">2.5", "<2.5")), _cols(df, "PC", (">2.5", "<2.5")))[:, 1],
        "ah_pre_line": _num(df, "AHh"), "ah_pre_h": _num(df, "AvgAHH"), "ah_pre_a": _num(df, "AvgAHA"),
        "ah_close_line": _num(df, "AHCh"), "ah_close_h": _num(df, "AvgCAHH"), "ah_close_a": _num(df, "AvgCAHA"),
    })
    for b in BOOKMAKERS:
        o = _cols(df, b)
        out[f"{b}_h"], out[f"{b}_d"], out[f"{b}_a"] = o[:, 0], o[:, 1], o[:, 2]
    return out.dropna(subset=["date", "goals_home", "goals_away"])


def load_odds(cache_dir, seasons: list[str], main_leagues: dict[str, str], extra_leagues: dict[str, str], fetch) -> pd.DataFrame:
    """Toutes les saisons `seasons` (codes 2122, 2223...) des championnats principaux et le fichier
    complet des autres ; `fetch(url, cache, max_age_hours)` = market.fetch_csv."""
    base = "https://www.football-data.co.uk"
    frames = []
    for comp, div in main_leagues.items():
        for code in seasons:
            try:
                df = fetch(f"{base}/mmz4281/{code}/{div}.csv", cache_dir / f"{code}_{div}.csv", 24 * 30)
            except Exception as e:                       # noqa: BLE001 - une saison manquante n'arrête pas le reste
                print(f"  football-data {comp} {code} : {e}")
                continue
            frames.append(normalize_odds(df, comp, "HomeTeam", "AwayTeam", "FTHG", "FTAG"))
    for comp, code in extra_leagues.items():
        try:
            df = fetch(f"{base}/new/{code}.csv", cache_dir / f"new_{code}.csv", 12)
        except Exception as e:                           # noqa: BLE001
            print(f"  football-data {comp} : {e}")
            continue
        frames.append(normalize_odds(df, comp, "Home", "Away", "HG", "AG"))
    return pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()


def join_odds(mf: pd.DataFrame, odds: pd.DataFrame, mapping: dict[tuple[str, str], str]) -> pd.DataFrame:
    """Cotes jointes aux matchs (même compétition, mêmes équipes, date à un jour près)."""
    h = odds.copy()
    h["home"] = [mapping.get((c, n)) for c, n in zip(h["competition"], h["home_name"])]
    h["away"] = [mapping.get((c, n)) for c, n in zip(h["competition"], h["away_name"])]
    h = h.dropna(subset=["home", "away"])
    h["day"] = h["date"].dt.normalize()
    m = mf[["match_id", "competition", "date", "home", "away"]].copy()
    m["day"] = m["date"].dt.normalize()
    joined = []
    for shift in (0, -1, 1):
        j = m.merge(h.assign(day=h["day"] + pd.Timedelta(days=shift)).drop(columns=["date", "competition"]),
                    left_on=["competition", "day", "home", "away"], right_on=["competition", "day", "home", "away"])
        joined.append(j)
    df = pd.concat(joined).drop_duplicates("match_id")
    return df.drop(columns=["day", "date", "home", "away", "competition"])


def odds_arrays(d: pd.DataFrame) -> dict[str, np.ndarray]:
    """Probabilités sans marge : clôture, ouverture, chaque bookmaker ; dispersion entre bookmakers."""
    close = devig(d[["close_h", "close_d", "close_a"]].to_numpy(float))
    pre = devig(d[["pre_h", "pre_d", "pre_a"]].to_numpy(float))
    books = []
    for b in BOOKMAKERS:
        cols = [f"{b}_h", f"{b}_d", f"{b}_a"]
        if all(c in d for c in cols):
            books.append(devig(d[cols].to_numpy(float)))
    stack = np.stack(books) if books else np.full((1, len(d), 3), np.nan)
    n_books = (~np.isnan(stack[:, :, 0])).sum(axis=0)
    disp = np.where(n_books >= 3, np.nanstd(stack[:, :, 0], axis=0), np.nan)
    return {"close": close, "pre": pre, "dispersion": disp, "books": n_books,
            "pre_odds": d[["pre_h", "pre_d", "pre_a"]].to_numpy(float)}


def bet_stats(p: np.ndarray, pre_odds: np.ndarray, close: np.ndarray, outcome: np.ndarray, mask: np.ndarray,
              edge: float = EDGE_THRESHOLD) -> dict:
    """Paris simulés : issue où p × cote d'ouverture − 1 > edge ; jugés à la clôture sans marge (CLV)
    et au rendement, avec erreurs-types (market._bet_stats)."""
    ok = mask & ~np.isnan(pre_odds).any(axis=1) & ~np.isnan(close).any(axis=1) & ~np.isnan(p).any(axis=1)
    if ok.sum() == 0:
        return {"bets": 0}
    ev = p[ok] * pre_odds[ok] - 1
    rows, cols = np.nonzero(ev > edge)
    if len(rows) == 0:
        return {"bets": 0}
    price = pre_odds[ok][rows, cols]
    clv = price * close[ok][rows, cols] - 1
    profit = np.where(outcome[ok][rows] == cols, price - 1, -1.0)
    se = lambda v: round(float(v.std(ddof=1) / np.sqrt(len(v))), 4) if len(v) > 1 else 0.0
    return {"bets": int(len(rows)), "clv": round(float(clv.mean()), 4), "clvSe": se(clv),
            "roi": round(float(profit.mean()), 4), "roiSe": se(profit)}


def pool_weight(pm: np.ndarray, pk: np.ndarray, outcome: np.ndarray) -> float:
    best = (0.0, np.inf)
    for w in np.linspace(0, 1, 21):
        p = pm ** w * pk ** (1 - w)
        p = p / p.sum(axis=1, keepdims=True)
        ll = log_loss(p, outcome).mean()
        if ll < best[1]:
            best = (float(w), ll)
    return round(best[0], 2)


# ============================================
# CIBLE = LA CLÔTURE (E0)
# ============================================

def closing_target(mf: pd.DataFrame, base: np.ndarray, od: dict, outcome: np.ndarray, train: np.ndarray, test: np.ndarray) -> dict:
    """Prédire la cote de clôture plutôt que le résultat : régression (ridge) des logits de clôture sur
    les logits du modèle de base et de l'ouverture, ajustée sur `train`, jugée sur `test` :
    mouvement ouverture → clôture expliqué, log-loss sur les résultats, paris contre l'ouverture
    jugés à la clôture (CLV), pour le modèle de base seul et pour le prédicteur de clôture."""
    close, pre = od["close"], od["pre"]
    ok = ~np.isnan(close).any(axis=1) & ~np.isnan(pre).any(axis=1) & ~np.isnan(base).any(axis=1)
    tr, te = train & ok, test & ok
    if tr.sum() < MIN_TRAIN or te.sum() < 50:
        return {"train": int(tr.sum()), "test": int(te.sum()), "verdict": "measured"}
    lb, lp, lc = _logits(base), _logits(pre), _logits(close)
    x = np.column_stack([np.ones(len(mf)), lb, lp])
    lam = 1.0
    pen = lam * np.eye(x.shape[1]); pen[0, 0] = 0
    w = np.linalg.solve(x[tr].T @ x[tr] + pen, x[tr].T @ lc[tr])            # (k, 2)
    pred = x @ w
    p_hat = np.column_stack([np.exp(pred[:, 0]), np.ones(len(mf)), np.exp(pred[:, 1])])
    p_hat = p_hat / p_hat.sum(axis=1, keepdims=True)
    move = lc[te] - lp[te]
    explained = pred[te] - lp[te]
    r = float(np.corrcoef(move[:, 0], explained[:, 0])[0, 1]) if te.sum() > 2 else float("nan")
    # un prédicteur naïf : la clôture = l'ouverture
    mse_naive = float((move ** 2).mean())
    mse_model = float(((lc[te] - pred[te]) ** 2).mean())
    res = {"train": int(tr.sum()), "test": int(te.sum()),
           "movementR": round(r, 3), "movementExplained": round(1 - mse_model / mse_naive, 4),
           "llOpening": round(float(log_loss(pre[te], outcome[te]).mean()), 4),
           "llClosing": round(float(log_loss(close[te], outcome[te]).mean()), 4),
           "llBase": round(float(log_loss(base[te], outcome[te]).mean()), 4),
           "llPredicted": round(float(log_loss(p_hat[te], outcome[te]).mean()), 4),
           "coefBase": [round(float(w[1, 0]), 3), round(float(w[2, 1]), 3)],
           "coefOpening": [round(float(w[3, 0]), 3), round(float(w[4, 1]), 3)],
           "betsBase": bet_stats(base, od["pre_odds"], close, outcome, te),
           "betsPredicted": bet_stats(p_hat, od["pre_odds"], close, outcome, te)}
    bp = res["betsPredicted"]
    res["verdict"] = "validated" if bp.get("bets", 0) >= 30 and bp["clv"] - 2 * bp["clvSe"] > 0 \
        else ("partial" if res["movementExplained"] > 0.05 else "debunked")
    return res


# ============================================
# DISPERSION ENTRE BOOKMAKERS (E7)
# ============================================

def dispersion(mf: pd.DataFrame, base: np.ndarray, od: dict, outcome: np.ndarray, train: np.ndarray, test: np.ndarray) -> dict:
    """Quand les bookmakers sont en désaccord, le modèle vaut-il davantage ? Par tercile de dispersion
    (écart-type de P(domicile) sans marge entre bookmakers, ouverture) : poids du modèle dans le
    mélange avec l'ouverture ajusté sur `train`, log-loss et CLV sur `test`."""
    disp, pre, close = od["dispersion"], od["pre"], od["close"]
    ok = ~np.isnan(disp) & ~np.isnan(pre).any(axis=1) & ~np.isnan(base).any(axis=1) & ~np.isnan(close).any(axis=1)
    tr, te = train & ok, test & ok
    if tr.sum() < MIN_TRAIN or te.sum() < 150:
        return {"train": int(tr.sum()), "test": int(te.sum()), "verdict": "measured"}
    cuts = np.nanpercentile(disp[tr], [33.3, 66.7])
    tercile = np.digitize(disp, cuts)
    groups = {}
    for k, name in enumerate(("low", "mid", "high")):
        m_tr, m_te = tr & (tercile == k), te & (tercile == k)
        w = pool_weight(base[m_tr], pre[m_tr], outcome[m_tr])
        p = base[m_te] ** w * pre[m_te] ** (1 - w)
        p = p / p.sum(axis=1, keepdims=True)
        groups[name] = {"matches": int(m_te.sum()), "dispersion": round(float(disp[m_te].mean()), 4), "weight": w,
                        "llOpening": round(float(log_loss(pre[m_te], outcome[m_te]).mean()), 4),
                        "llClosing": round(float(log_loss(close[m_te], outcome[m_te]).mean()), 4),
                        "llPool": round(float(log_loss(p, outcome[m_te]).mean()), 4),
                        "bets": bet_stats(base, od["pre_odds"], close, outcome, m_te)}
    hi = groups["high"]["bets"]
    res = {"train": int(tr.sum()), "test": int(te.sum()), "groups": groups,
           "verdict": "validated" if hi.get("bets", 0) >= 30 and hi["clv"] - 2 * hi["clvSe"] > 0
           else ("partial" if groups["high"]["weight"] > groups["low"]["weight"] else "debunked")}
    return res


# ============================================
# COHÉRENCE INTER-MARCHÉS (E8)
# ============================================

def _poisson_over(lam: np.ndarray, line: float = 2.5) -> np.ndarray:
    k = np.arange(int(np.floor(line)) + 1)
    from math import factorial
    f = np.array([factorial(int(i)) for i in k], float)
    return 1 - (np.exp(-lam)[:, None] * lam[:, None] ** k / f).sum(axis=1)


def _home_cover(lh: np.ndarray, la: np.ndarray, line: np.ndarray, max_goals: int = 10) -> np.ndarray:
    """P(buts domicile + ligne > buts extérieur), Poisson indépendants (lignes sans remboursement)."""
    g = np.arange(max_goals + 1)
    from math import factorial
    f = np.array([factorial(int(i)) for i in g], float)
    ph = np.exp(-lh)[:, None] * lh[:, None] ** g / f
    pa = np.exp(-la)[:, None] * la[:, None] ** g / f
    diff = g[:, None] - g[None, :]
    cover = np.zeros(len(lh))
    for i in range(len(lh)):
        cover[i] = (ph[i][:, None] * pa[i][None, :] * (diff + line[i] > 0)).sum()
    return cover


def implied_rates(p_over: np.ndarray, p_cover: np.ndarray, line: np.ndarray, iters: int = 40) -> tuple[np.ndarray, np.ndarray]:
    """Buts attendus (domicile, extérieur) tels que P(plus de 2,5) = p_over et P(domicile couvre la
    ligne) = p_cover : total par bissection sur le plus / moins, partage par bissection sur le handicap."""
    n = len(p_over)
    lo, hi = np.full(n, 0.5), np.full(n, 6.0)
    for _ in range(iters):
        mid = (lo + hi) / 2
        over = _poisson_over(mid)
        lo = np.where(over < p_over, mid, lo)
        hi = np.where(over < p_over, hi, mid)
    total = (lo + hi) / 2
    lo, hi = np.full(n, 0.05), np.full(n, 0.95)
    for _ in range(iters):
        mid = (lo + hi) / 2
        cover = _home_cover(total * mid, total * (1 - mid), line)
        lo = np.where(cover < p_cover, mid, lo)
        hi = np.where(cover < p_cover, hi, mid)
    share = (lo + hi) / 2
    return total * share, total * (1 - share)


def _poisson_1x2(lh: np.ndarray, la: np.ndarray, rho: float = 0.0, max_goals: int = 10) -> np.ndarray:
    g = np.arange(max_goals + 1)
    from math import factorial
    f = np.array([factorial(int(i)) for i in g], float)
    ph = np.exp(-lh)[:, None] * lh[:, None] ** g / f
    pa = np.exp(-la)[:, None] * la[:, None] ** g / f
    out = np.zeros((len(lh), 3))
    for i in range(len(lh)):
        m = ph[i][:, None] * pa[i][None, :]
        x, y = np.meshgrid(g, g, indexing="ij")
        m = m * models._dc_tau(x, y, np.full(x.shape, lh[i]), np.full(x.shape, la[i]), rho)
        m = m / m.sum()
        out[i] = [np.tril(m, -1).sum(), np.trace(m), np.triu(m, 1).sum()]
    return out


def market_coherence(d: pd.DataFrame, od: dict, outcome: np.ndarray, train: np.ndarray, test: np.ndarray,
                     rho: float = -0.03) -> dict:
    """Le 1-N-2 d'ouverture est-il cohérent avec le plus / moins 2,5 et le handicap asiatique du même
    moment ? Buts attendus impliqués par ces deux marchés -> 1-N-2 implicite ; écart au 1-N-2 coté.
    L'écart annonce-t-il le mouvement vers la clôture, et le 1-N-2 implicite bat-il le 1-N-2 coté ?"""
    line = d["ah_pre_line"].to_numpy(float)
    ou = devig(d[["ou_pre_over", "ou_pre_under"]].to_numpy(float))
    ah = devig(d[["ah_pre_h", "ah_pre_a"]].to_numpy(float))
    pre, close = od["pre"], od["close"]
    half = ~np.isnan(line) & (np.abs(line * 2 - np.round(line * 2)) < 1e-9) & (np.round(line * 2) % 2 == 1)
    ok = half & ~np.isnan(ou).any(axis=1) & ~np.isnan(ah).any(axis=1) & ~np.isnan(pre).any(axis=1) & ~np.isnan(close).any(axis=1)
    if ok.sum() < 300:
        return {"matches": int(ok.sum()), "verdict": "measured"}
    lh, la = implied_rates(ou[ok, 0], ah[ok, 0], line[ok])
    implied = np.full((len(d), 3), np.nan)
    implied[ok] = _poisson_1x2(lh, la, rho)
    gap = _logits(np.where(np.isnan(implied), 1 / 3, implied)) - _logits(np.where(np.isnan(pre), 1 / 3, pre))
    move = _logits(np.where(np.isnan(close), 1 / 3, close)) - _logits(np.where(np.isnan(pre), 1 / 3, pre))
    te = test & ok
    tr = train & ok
    r = float(np.corrcoef(gap[te, 0], move[te, 0])[0, 1]) if te.sum() > 2 else float("nan")
    w = pool_weight(implied[tr], pre[tr], outcome[tr]) if tr.sum() >= MIN_TRAIN else float("nan")
    res = {"matches": int(ok.sum()), "train": int(tr.sum()), "test": int(te.sum()),
           "meanAbsGap": round(float(np.abs(gap[ok]).mean()), 4), "movementR": round(r, 3),
           "weightImplied": w,
           "llOpening": round(float(log_loss(pre[te], outcome[te]).mean()), 4) if te.sum() else None,
           "llImplied": round(float(log_loss(implied[te], outcome[te]).mean()), 4) if te.sum() else None,
           "llClosing": round(float(log_loss(close[te], outcome[te]).mean()), 4) if te.sum() else None,
           "bets": bet_stats(implied, od["pre_odds"], close, outcome, te)}
    b = res["bets"]
    res["verdict"] = "validated" if b.get("bets", 0) >= 30 and b["clv"] - 2 * b["clvSe"] > 0 \
        else ("partial" if r > 0.1 else "debunked")
    return res


# ============================================
# CHANCE ACCUMULÉE ET MARCHÉ (E4)
# ============================================

def luck_features(mf: pd.DataFrame) -> pd.DataFrame:
    """Chance accumulée d'une équipe sur la saison, avant chaque match : points réels moins points
    attendus (Poisson sur les xG du match), cumulés sur les matchs antérieurs de la saison."""
    lg = mf[mf["league"] & mf["xg_home"].notna() & mf["xg_away"].notna()]
    from math import factorial
    k = np.arange(11)
    f = np.array([factorial(int(i)) for i in k], float)
    ph = np.exp(-lg["xg_home"].to_numpy()[:, None]) * lg["xg_home"].to_numpy()[:, None] ** k / f
    pa = np.exp(-lg["xg_away"].to_numpy()[:, None]) * lg["xg_away"].to_numpy()[:, None] ** k / f
    joint = ph[:, :, None] * pa[:, None, :]
    diff = k[None, :, None] - k[None, None, :]
    xh = 3 * (joint * (diff > 0)).sum((1, 2)) + (joint * (diff == 0)).sum((1, 2))
    xa = 3 * (joint * (diff < 0)).sum((1, 2)) + (joint * (diff == 0)).sum((1, 2))
    out = lg["outcome"].to_numpy()
    rows = pd.concat([
        pd.DataFrame({"match_id": lg["match_id"], "team_id": lg["home"], "app_season": lg["app_season"], "date": lg["date"],
                      "luck": np.where(out == 0, 3, np.where(out == 1, 1, 0)) - xh}),
        pd.DataFrame({"match_id": lg["match_id"], "team_id": lg["away"], "app_season": lg["app_season"], "date": lg["date"],
                      "luck": np.where(out == 2, 3, np.where(out == 1, 1, 0)) - xa}),
    ]).sort_values(["team_id", "app_season", "date", "match_id"])
    g = rows.groupby(["team_id", "app_season"])
    rows["n"] = g.cumcount()
    rows["luck_to_date"] = g["luck"].cumsum() - rows["luck"]
    return rows[["match_id", "team_id", "n", "luck_to_date"]]


def luck_market(mf: pd.DataFrame, od: dict, feat: pd.DataFrame, outcome: np.ndarray, train: np.ndarray, test: np.ndarray) -> dict:
    """Le marché d'ouverture regarde-t-il encore le classement plutôt que les xG ? Signal : chance
    accumulée (points − points attendus) de l'équipe à domicile moins celle de l'extérieur, testé
    contre l'ouverture ; CLV d'un pari « contre l'équipe chanceuse »."""
    pre, close = od["pre"], od["close"]
    f = feat.set_index(["match_id", "team_id"])
    h = pd.Series(list(zip(mf["match_id"], mf["home"])))
    a = pd.Series(list(zip(mf["match_id"], mf["away"])))
    enough = (h.map(f["n"]).to_numpy(float) >= MIN_PRIOR) & (a.map(f["n"]).to_numpy(float) >= MIN_PRIOR)
    s = np.where(enough, h.map(f["luck_to_date"]).to_numpy(float) - a.map(f["luck_to_date"]).to_numpy(float), np.nan)
    res = signal_gain(pre, s, outcome, train, test)
    # paris : probabilités recalibrées avec le signal contre l'ouverture, jugées à la clôture
    ok = ~np.isnan(s) & ~np.isnan(pre).any(axis=1)
    tr, te = train & ok, test & ok
    if tr.sum() >= MIN_TRAIN and te.sum() >= 50:
        x = np.column_stack([np.ones(len(mf)), _logits(np.where(np.isnan(pre), 1 / 3, pre)), s / (np.nanstd(s[tr]) or 1)])
        w = multinomial_fit(x[tr], outcome[tr])
        res["bets"] = bet_stats(multinomial_predict(x, w), od["pre_odds"], close, outcome, te)
    return res


# ============================================
# LE NOUVEL ENTRAÎNEUR ET LE MARCHÉ (E3)
# ============================================

def coach_change_features(lineup: pd.DataFrame, mf: pd.DataFrame, window: int = 5, min_spell: int = 5) -> pd.DataFrame:
    """Par équipe et par match : nombre de matchs depuis un changement d'entraîneur (0 = premier match
    du nouvel entraîneur), changement = nouveau nom qui reste au moins `min_spell` matchs."""
    lu = lineup[["match_id", "team_id", "coach_name"]].drop_duplicates(["match_id", "team_id"])
    lu = lu.merge(mf[["match_id", "date"]], on="match_id").sort_values(["team_id", "date", "match_id"])
    rows = []
    for tid, g in lu.groupby("team_id", sort=False):
        coaches = g["coach_name"].fillna("").to_numpy()
        mids = g["match_id"].to_numpy()
        since = np.full(len(g), np.nan)
        current, k = coaches[0] if len(coaches) else "", np.nan
        for i in range(len(g)):
            c = coaches[i]
            if c and c != current:
                # vrai changement : le nouveau nom tient au moins min_spell matchs
                ahead = coaches[i:i + min_spell]
                if len(ahead) == min_spell and (ahead == c).all():
                    current, k = c, 0
                else:
                    since[i] = k if not np.isnan(k) else np.nan
                    continue
            since[i] = k
            if not np.isnan(k):
                k += 1
        rows.append(pd.DataFrame({"match_id": mids, "team_id": tid, "since_change": since}))
    out = pd.concat(rows, ignore_index=True)
    out["new_coach"] = (out["since_change"] < window).astype(float)
    return out


def coach_market(mf: pd.DataFrame, od: dict, base: np.ndarray, feat: pd.DataFrame, outcome: np.ndarray,
                 train: np.ndarray, test: np.ndarray) -> dict:
    """Le marché croit-il encore au rebond du nouvel entraîneur (que le Labo a démenti) ? Signal :
    nouvel entraîneur (5 premiers matchs) à domicile moins à l'extérieur, contre l'ouverture et contre
    le modèle de base ; CLV d'un pari contre l'équipe au nouvel entraîneur."""
    pre, close = od["pre"], od["close"]
    s = _side_signal(mf, feat, "new_coach")
    res = {"changes": int((feat["since_change"] == 0).sum()),
           "vsOpening": signal_gain(pre, s, outcome, train, test), "vsBase": signal_gain(base, s, outcome, train, test)}
    ok = ~np.isnan(s) & ~np.isnan(pre).any(axis=1) & ~np.isnan(close).any(axis=1)
    te = test & ok & (s != 0)
    # résidu du marché : résultat moins probabilité d'ouverture, pour l'équipe au nouvel entraîneur
    if te.sum() >= 30:
        new_home = te & (s > 0)
        new_away = te & (s < 0)
        resid = np.concatenate([(outcome[new_home] == 0) - pre[new_home, 0], (outcome[new_away] == 2) - pre[new_away, 2]])
        res["marketResidual"] = {"matches": int(len(resid)), "mean": round(float(resid.mean()), 4), "ci": _boot_mean(resid)}
        # pari « contre » : l'adversaire du nouvel entraîneur, à l'ouverture, jugé à la clôture
        side = np.where(s > 0, 2, 0)
        price = od["pre_odds"][te][np.arange(te.sum()), side[te]]
        fair = close[te][np.arange(te.sum()), side[te]]
        clv = price * fair - 1
        res["fadeBets"] = {"bets": int(te.sum()), "clv": round(float(clv.mean()), 4),
                           "clvSe": round(float(clv.std(ddof=1) / np.sqrt(len(clv))), 4) if len(clv) > 1 else 0.0}
    fb = res.get("fadeBets", {})
    res["verdict"] = "validated" if fb.get("bets", 0) >= 30 and fb["clv"] - 2 * fb["clvSe"] > 0 \
        else ("partial" if res["vsOpening"]["verdict"] in ("validated", "partial") else "debunked")
    return res


# ============================================
# CARTE D'EFFICIENCE (E12) ET EMPILEMENT (E14)
# ============================================

def efficiency_map(mf: pd.DataFrame, base: np.ndarray, od: dict, outcome: np.ndarray, train: np.ndarray, test: np.ndarray) -> dict:
    """Par compétition : où le modèle de base apporte-t-il quelque chose au marché d'ouverture ?
    Poids du modèle ajusté sur `train`, log-loss ouverture / clôture / mélange sur `test`, CLV du
    modèle contre l'ouverture, dispersion moyenne entre bookmakers et ampleur du mouvement."""
    pre, close, disp = od["pre"], od["close"], od["dispersion"]
    ok = ~np.isnan(pre).any(axis=1) & ~np.isnan(close).any(axis=1) & ~np.isnan(base).any(axis=1)
    comps = mf["comp"].to_numpy()
    rows = {}
    for c in sorted(set(comps[test & ok])):
        tr, te = train & ok & (comps == c), test & ok & (comps == c)
        if tr.sum() < 100 or te.sum() < 50:
            continue
        w = pool_weight(base[tr], pre[tr], outcome[tr])
        p = base[te] ** w * pre[te] ** (1 - w)
        p = p / p.sum(axis=1, keepdims=True)
        d = log_loss(pre[te], outcome[te]) - log_loss(p, outcome[te])
        move = np.abs(_logits(close[te]) - _logits(pre[te])).mean()
        rows[c] = {"matches": int(te.sum()), "weight": w,
                   "llOpening": round(float(log_loss(pre[te], outcome[te]).mean()), 4),
                   "llClosing": round(float(log_loss(close[te], outcome[te]).mean()), 4),
                   "llBase": round(float(log_loss(base[te], outcome[te]).mean()), 4),
                   "llPool": round(float(log_loss(p, outcome[te]).mean()), 4),
                   "poolGain": round(float(d.mean()), 4), "poolCi": _boot_mean(d),
                   "dispersion": round(float(np.nanmean(disp[te])), 4) if np.isfinite(np.nanmean(disp[te])) else None,
                   "movement": round(float(move), 4),
                   "bets": bet_stats(base, od["pre_odds"], close, outcome, te)}
        rows[c]["verdict"] = "validated" if rows[c]["poolCi"][0] > 0 else ("partial" if w > 0 and d.mean() > 0 else "debunked")
    n_val = sum(r["verdict"] == "validated" for r in rows.values())
    return {"competitions": rows, "validated": n_val,
            "verdict": "validated" if n_val >= 3 else ("partial" if n_val >= 1 else "debunked")}


def stack(mf: pd.DataFrame, base: np.ndarray, od: dict, signals: dict[str, np.ndarray], outcome: np.ndarray,
          train: np.ndarray, test: np.ndarray) -> dict:
    """Empilement : régression multinomiale sur les logits du modèle de base, de l'ouverture et des
    signaux retenus, ajustée sur `train`, jugée sur `test` contre l'ouverture recalibrée ; CLV."""
    pre, close = od["pre"], od["close"]
    ok = ~np.isnan(pre).any(axis=1) & ~np.isnan(base).any(axis=1) & ~np.isnan(close).any(axis=1)
    cols = []
    names = []
    for name, s in signals.items():
        s = np.asarray(s, float)
        if np.isnan(s[train & ok]).mean() < 0.5:
            cols.append(np.where(np.isnan(s), 0.0, s))
            names.append(name)
    tr, te = train & ok, test & ok
    if tr.sum() < MIN_TRAIN or te.sum() < 100:
        return {"train": int(tr.sum()), "test": int(te.sum()), "verdict": "measured"}
    x0 = np.column_stack([np.ones(len(mf)), _logits(np.where(np.isnan(pre), 1 / 3, pre))])
    xb = np.column_stack([x0, _logits(np.where(np.isnan(base), 1 / 3, base))])
    xs = np.column_stack([xb] + [c / (c[tr].std() or 1) for c in cols]) if cols else xb
    w0, wb, ws = multinomial_fit(x0[tr], outcome[tr]), multinomial_fit(xb[tr], outcome[tr]), multinomial_fit(xs[tr], outcome[tr])
    p0, pb, ps = multinomial_predict(x0[te], w0), multinomial_predict(xb[te], wb), multinomial_predict(xs[te], ws)
    d = log_loss(p0, outcome[te]) - log_loss(ps, outcome[te])
    full = np.full((len(mf), 3), np.nan); full[te] = ps
    res = {"train": int(tr.sum()), "test": int(te.sum()), "signals": names,
           "llOpening": round(float(log_loss(p0, outcome[te]).mean()), 4),
           "llWithBase": round(float(log_loss(pb, outcome[te]).mean()), 4),
           "llStack": round(float(log_loss(ps, outcome[te]).mean()), 4),
           "llClosing": round(float(log_loss(close[te], outcome[te]).mean()), 4),
           "gain": round(float(d.mean()), 4), "ci": _boot_mean(d),
           "coef": {n: [round(float(ws[0, xb.shape[1] + i]), 3), round(float(ws[1, xb.shape[1] + i]), 3)] for i, n in enumerate(names)},
           "bets": bet_stats(full, od["pre_odds"], close, outcome, te)}
    b = res["bets"]
    res["verdict"] = "validated" if b.get("bets", 0) >= 30 and b["clv"] - 2 * b["clvSe"] > 0 \
        else ("partial" if res["ci"][0] > 0 else "debunked")
    return res
