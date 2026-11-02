"""
Ajustements des buts attendus (produit Labo paris), chacun testé hors échantillon et gardé seulement s'il
améliore la vraisemblance des scores sur la saison de vérification.

Base : buts attendus figés de la recherche (modèle ScoutVision reproduit). Ajustement multiplicatif :
log(xg_adj) = log(xg_base) + Σ β_k · feature_k, avec des features calculées point-in-time (seuls les matchs
antérieurs au coup d'envoi) :

- `form_att`, `form_def` : buts marqués / encaissés pondérés par un poids décroissant dans le temps
  (demi-vie en jours), séparés par terrain (matchs à domicile de l'équipe à domicile, à l'extérieur de
  l'équipe à l'extérieur), en écart logarithmique à la moyenne de la compétition ;
- `h2h` : différence de buts moyenne des confrontations directes des 5 dernières années, rétrécie vers 0 ;
- `half` : part des buts de première mi-temps propre à chaque équipe (pour les marchés de mi-temps), en
  écart à la part de la compétition.

Les β sont ajustés par maximum de vraisemblance de Poisson sur la saison d'ajustement (2024-25, seule
saison antérieure avec base figée) et évalués sur 2025-26 : log-loss du score exact (Dixon-Coles figé),
du 1N2, du plus/moins 2,5 et du 1N2 à la mi-temps. Les compositions officielles et absences ne sont pas
disponibles dans nos données : non testées.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field

import numpy as np
import pandas as pd
from scipy import optimize, stats

from . import RESEARCH
from . import simulate as sm

OUT = RESEARCH / "phase2"
HALF_LIVES = (60, 120, 240)       # jours
H2H_YEARS = 5
H2H_SHRINK = 3.0
FEATURES = ("form", "h2h", "half")


@dataclass
class Adjustment:
    half_life: int = 120
    beta: dict[str, float] = field(default_factory=dict)   # form_att_home, form_def_away, ... , h2h
    use_half: bool = False
    kept: list[str] = field(default_factory=list)

    def to_json(self) -> dict:
        return {"halfLife": self.half_life, "beta": self.beta, "useHalf": self.use_half, "kept": self.kept}

    @classmethod
    def from_json(cls, d: dict) -> "Adjustment":
        return cls(int(d["halfLife"]), dict(d["beta"]), bool(d["useHalf"]), list(d["kept"]))


# ----- features point-in-time -----

def _decayed(values: np.ndarray, ages_days: np.ndarray, half_life: float) -> tuple[float, float]:
    w = 0.5 ** (ages_days / half_life)
    return float((w * values).sum()), float(w.sum())


def compute_features(results: pd.DataFrame, half_life: int = 120) -> pd.DataFrame:
    """Une ligne par match avec form_att_home, form_def_home, form_att_away, form_def_away, h2h, half_home,
    half_away, calculées sur les seuls matchs terminés avant le coup d'envoi (tous terrains pour h2h et la
    mi-temps, terrain propre pour la forme)."""
    r = results.sort_values("kickoff_utc").reset_index(drop=True)
    kick = pd.to_datetime(r["kickoff_utc"], utc=True)
    comp_mean = {}
    # historique par équipe (domicile / extérieur) : listes (date, pour, contre, buts 1re mi-temps pour)
    home_hist: dict[str, list] = {}
    away_hist: dict[str, list] = {}
    all_hist: dict[str, list] = {}
    pair_hist: dict[tuple[str, str], list] = {}
    comp_hist: dict[str, list] = {}
    out = np.full((len(r), 7), np.nan)
    for i, m in enumerate(r.itertuples(index=False)):
        t = kick[i]
        # moyenne de la compétition (buts par équipe et par match, part de 1re mi-temps) avant le match
        ch = comp_hist.get(m.competition, [])
        if ch:
            ages = np.array([(t - d).days for d, *_ in ch], float)
            g = np.array([x for _, x, _ in ch], float); f = np.array([x for _, _, x in ch], float)
            wg, ww = _decayed(g, ages, half_life)
            mean_goals = wg / ww if ww > 0 else 1.35
            wf, _ = _decayed(f, ages, half_life)
            mean_half = wf / wg if wg > 0 else 0.45
        else:
            mean_goals, mean_half = 1.35, 0.45

        def venue_form(hist):
            if len(hist) < 3:
                return np.nan, np.nan
            ages = np.array([(t - d).days for d, *_ in hist], float)
            gf = np.array([x for _, x, _ in hist], float); ga = np.array([x for _, _, x in hist], float)
            wf, ww = _decayed(gf, ages, half_life); wa, _ = _decayed(ga, ages, half_life)
            return np.log((wf / ww + 0.1) / (mean_goals + 0.1)), np.log((wa / ww + 0.1) / (mean_goals + 0.1))

        def half_share(hist):
            if len(hist) < 5:
                return np.nan
            ages = np.array([(t - d).days for d, *_ in hist], float)
            g = np.array([x for _, x, _ in hist], float); f = np.array([x for _, _, x in hist], float)
            wg, _ = _decayed(g, ages, half_life); wf, _ = _decayed(f, ages, half_life)
            return (wf + 2 * mean_half) / (wg + 2) - mean_half   # rétréci vers la part de la compétition

        fa_h, fd_h = venue_form(home_hist.get(m.home_team_id, []))
        fa_a, fd_a = venue_form(away_hist.get(m.away_team_id, []))
        ph = pair_hist.get(tuple(sorted((m.home_team_id, m.away_team_id))), [])
        ph = [(d, diff) for d, diff in ph if (t - d).days <= 365 * H2H_YEARS]
        if ph:
            diffs = np.array([diff for _, diff in ph], float)
            h2h = diffs.mean() * len(ph) / (len(ph) + H2H_SHRINK)
        else:
            h2h = 0.0
        out[i] = [fa_h, fd_h, fa_a, fd_a, h2h, half_share(all_hist.get(m.home_team_id, [])), half_share(all_hist.get(m.away_team_id, []))]
        # mise à jour des historiques après le match
        home_hist.setdefault(m.home_team_id, []).append((t, m.ft_home, m.ft_away))
        away_hist.setdefault(m.away_team_id, []).append((t, m.ft_away, m.ft_home))
        all_hist.setdefault(m.home_team_id, []).append((t, m.ft_home, m.ht_home))
        all_hist.setdefault(m.away_team_id, []).append((t, m.ft_away, m.ht_away))
        key = tuple(sorted((m.home_team_id, m.away_team_id)))
        pair_hist.setdefault(key, []).append((t, (m.ft_home - m.ft_away) if key[0] == m.home_team_id else (m.ft_away - m.ft_home)))
        comp_hist.setdefault(m.competition, []).append((t, (m.ft_home + m.ft_away) / 2, (m.ht_home + m.ht_away) / 2))
    cols = ["form_att_home", "form_def_home", "form_att_away", "form_def_away", "h2h_raw", "half_home", "half_away"]
    feats = pd.DataFrame(out, columns=cols)
    feats["match_id"] = r["match_id"].to_numpy()
    # h2h du point de vue de l'équipe à domicile : signe selon l'ordre de la clé
    sign = np.where(r["home_team_id"].to_numpy() == np.array([min(a, b) for a, b in zip(r["home_team_id"], r["away_team_id"])]), 1.0, -1.0)
    feats["h2h"] = feats["h2h_raw"] * sign
    return feats.drop(columns="h2h_raw")


# ----- ajustement et évaluation -----

def _design(df: pd.DataFrame, which: str) -> tuple[np.ndarray, np.ndarray]:
    """Matrices de régresseurs (sans constante) pour les buts domicile et extérieur."""
    f = df.fillna(0.0)
    if which == "form":
        xh = np.column_stack([f["form_att_home"], f["form_def_away"]])
        xa = np.column_stack([f["form_att_away"], f["form_def_home"]])
    elif which == "h2h":
        xh = f[["h2h"]].to_numpy(float); xa = -f[["h2h"]].to_numpy(float)
    elif which == "form+h2h":
        xh = np.column_stack([f["form_att_home"], f["form_def_away"], f["h2h"]])
        xa = np.column_stack([f["form_att_away"], f["form_def_home"], -f["h2h"]])
    else:
        raise ValueError(which)
    return xh, xa


def fit_beta(df: pd.DataFrame, which: str) -> np.ndarray:
    """β par maximum de vraisemblance de Poisson, base figée en offset (mêmes β pour les deux équipes)."""
    xh, xa = _design(df, which)
    bh, ba = np.log(df["expected_goals_home"].to_numpy(float)), np.log(df["expected_goals_away"].to_numpy(float))
    yh, ya = df["ft_home"].to_numpy(float), df["ft_away"].to_numpy(float)

    def nll(beta):
        lh, la = bh + xh @ beta, ba + xa @ beta
        return float(np.sum(np.exp(lh) - yh * lh) + np.sum(np.exp(la) - ya * la)) + 0.5 * float(np.sum(beta ** 2))  # légère pénalité

    res = optimize.minimize(nll, np.zeros(xh.shape[1]), method="L-BFGS-B")
    return res.x


def apply_beta(df: pd.DataFrame, which: str, beta: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    xh, xa = _design(df, which)
    return (df["expected_goals_home"].to_numpy(float) * np.exp(xh @ beta), df["expected_goals_away"].to_numpy(float) * np.exp(xa @ beta))


def evaluate(df: pd.DataFrame, xg_h: np.ndarray, xg_a: np.ndarray, variant: sm.Variant, p1_home: np.ndarray | None = None,
             p1_away: np.ndarray | None = None, comp_half: float = 0.45) -> dict:
    """Log-loss score exact, 1N2, plus/moins 2,5 (loi conjointe) et 1N2 mi-temps (par échantillonnage)."""
    ll_s = ll_1 = ll_o = ll_h = 0.0
    n = len(df)
    rng = np.random.default_rng(1)
    for i, m in enumerate(df.itertuples(index=False)):
        mat = sm.score_matrix(float(xg_h[i]), float(xg_a[i]), variant)
        h, a = min(int(m.ft_home), sm.MAX_GOALS), min(int(m.ft_away), sm.MAX_GOALS)
        ll_s -= np.log(mat[h, a])
        p1, px, p2 = np.tril(mat, -1).sum(), np.trace(mat), np.triu(mat, 1).sum()
        ll_1 -= np.log({1: p1, 0: px, -1: p2}[int(np.sign(h - a))])
        idx = np.add.outer(np.arange(mat.shape[0]), np.arange(mat.shape[1]))
        po = mat[idx >= 3].sum()
        ll_o -= np.log(po if h + a >= 3 else 1 - po)
        # mi-temps : loi binomiale des buts de 1re période conditionnée au score final, intégrée sur la loi du score
        ph = comp_half if p1_home is None or not np.isfinite(p1_home[i]) else float(np.clip(p1_home[i], 0.2, 0.8))
        pa = comp_half if p1_away is None or not np.isfinite(p1_away[i]) else float(np.clip(p1_away[i], 0.2, 0.8))
        k = np.arange(sm.MAX_GOALS + 1)
        bh = stats.binom.pmf(k[:, None], k[None, :], ph)   # P(ht = i | ft = j)
        ba = stats.binom.pmf(k[:, None], k[None, :], pa)
        mh, ma = mat.sum(axis=1), mat.sum(axis=0)        # marginales (indépendance approchée pour la mi-temps)
        qh, qa = bh @ mh, ba @ ma
        joint = np.outer(qh, qa)
        s1 = int(np.sign(m.ht_home - m.ht_away))
        p = {1: np.tril(joint, -1).sum(), 0: np.trace(joint), -1: np.triu(joint, 1).sum()}[s1]
        ll_h -= np.log(max(p, 1e-9))
    return {"logLossScore": round(ll_s / n, 5), "logLoss1x2": round(ll_1 / n, 5), "logLossOver25": round(ll_o / n, 5), "logLossHalf1x2": round(ll_h / n, 5), "n": n}


def select(fit: pd.DataFrame, check: pd.DataFrame, variant: sm.Variant, comp_half: float = 0.45) -> tuple[Adjustment, dict]:
    """Teste chaque ajout sur la saison de vérification et ne garde que ce qui améliore le log-loss."""
    report = {"fitMatches": len(fit), "checkMatches": len(check), "tests": {}}
    base = evaluate(check, check["expected_goals_home"].to_numpy(float), check["expected_goals_away"].to_numpy(float), variant, comp_half=comp_half)
    report["base"] = base
    best_form = None
    for hl in HALF_LIVES:
        ff, fc = compute_features(pd.concat([fit, check]).drop_duplicates("match_id"), hl), None
        ffit = fit.merge(ff, on="match_id"); fchk = check.merge(ff, on="match_id")
        beta = fit_beta(ffit, "form")
        xh, xa = apply_beta(fchk, "form", beta)
        ev = evaluate(fchk, xh, xa, variant, comp_half=comp_half)
        report["tests"][f"form_hl{hl}"] = {"beta": [round(float(b), 4) for b in beta], **ev, "delta": round(ev["logLossScore"] - base["logLossScore"], 5)}
        if best_form is None or ev["logLossScore"] < best_form[1]:
            best_form = (hl, ev["logLossScore"], beta, ff)
    hl, _, beta_form, feats = best_form
    adj = Adjustment(half_life=hl)
    kept_form = best_form[1] < base["logLossScore"]
    current_h, current_a = (apply_beta(check.merge(feats, on="match_id"), "form", beta_form) if kept_form
                            else (check["expected_goals_home"].to_numpy(float), check["expected_goals_away"].to_numpy(float)))
    if kept_form:
        adj.beta.update({"form_att": float(beta_form[0]), "form_def": float(beta_form[1])}); adj.kept.append(f"form (demi-vie {hl} j)")
    ref_ll = min(best_form[1], base["logLossScore"])
    # confrontations directes, en plus de ce qui est gardé
    which = "form+h2h" if kept_form else "h2h"
    ffit = fit.merge(feats, on="match_id"); fchk = check.merge(feats, on="match_id")
    beta = fit_beta(ffit, which)
    xh, xa = apply_beta(fchk, which, beta)
    ev = evaluate(fchk, xh, xa, variant, comp_half=comp_half)
    report["tests"]["h2h"] = {"beta": [round(float(b), 4) for b in beta], **ev, "delta": round(ev["logLossScore"] - ref_ll, 5)}
    if ev["logLossScore"] < ref_ll:
        adj.beta["h2h"] = float(beta[-1])
        if kept_form:
            adj.beta.update({"form_att": float(beta[0]), "form_def": float(beta[1])})
        adj.kept.append("confrontations directes (5 ans)")
        current_h, current_a = xh, xa
        ref_ll = ev["logLossScore"]
    # mi-temps propre à chaque équipe : jugée sur le 1N2 de la 1re mi-temps
    ev_half = evaluate(fchk, current_h, current_a, variant, p1_home=comp_half + fchk["half_home"].to_numpy(float), p1_away=comp_half + fchk["half_away"].to_numpy(float), comp_half=comp_half)
    ev_ref = evaluate(fchk, current_h, current_a, variant, comp_half=comp_half)
    report["tests"]["half"] = {**ev_half, "deltaHalf1x2": round(ev_half["logLossHalf1x2"] - ev_ref["logLossHalf1x2"], 5)}
    if ev_half["logLossHalf1x2"] < ev_ref["logLossHalf1x2"]:
        adj.use_half = True; adj.kept.append("part de 1re mi-temps par équipe")
    report["tests"]["lineups"] = {"status": "non testé : aucune composition officielle ni absence avant le match dans les données"}
    report["final"] = evaluate(fchk, current_h, current_a, variant, p1_home=(comp_half + fchk["half_home"].to_numpy(float)) if adj.use_half else None,
                               p1_away=(comp_half + fchk["half_away"].to_numpy(float)) if adj.use_half else None, comp_half=comp_half)
    report["kept"] = adj.kept
    return adj, report


def features_as_of(results: pd.DataFrame, home_id: str, away_id: str, competition: str, at: pd.Timestamp, half_life: int = 120) -> pd.Series:
    """Features d'une rencontre à venir, calculées sur les matchs terminés avant `at` (mêmes formules que
    `compute_features`)."""
    r = results[pd.to_datetime(results["kickoff_utc"], utc=True) < at]
    kick = pd.to_datetime(r["kickoff_utc"], utc=True)
    ages_all = (at - kick).dt.days.to_numpy(float)
    comp = r["competition"] == competition
    if comp.any():
        g = ((r["ft_home"] + r["ft_away"]) / 2).to_numpy(float)[comp.to_numpy()]
        wg, ww = _decayed(g, ages_all[comp.to_numpy()], half_life)
        mean_goals = wg / ww if ww > 0 else 1.35
    else:
        mean_goals = 1.35

    def venue_form(mask, gf_col, ga_col):
        sub = r[mask]
        if len(sub) < 3:
            return np.nan, np.nan
        ages = ages_all[mask.to_numpy()]
        wf, ww = _decayed(sub[gf_col].to_numpy(float), ages, half_life); wa, _ = _decayed(sub[ga_col].to_numpy(float), ages, half_life)
        return np.log((wf / ww + 0.1) / (mean_goals + 0.1)), np.log((wa / ww + 0.1) / (mean_goals + 0.1))

    fa_h, fd_h = venue_form(r["home_team_id"] == home_id, "ft_home", "ft_away")
    fa_a, fd_a = venue_form(r["away_team_id"] == away_id, "ft_away", "ft_home")
    pair = r[(((r["home_team_id"] == home_id) & (r["away_team_id"] == away_id)) | ((r["home_team_id"] == away_id) & (r["away_team_id"] == home_id)))
             & (kick >= at - pd.Timedelta(days=365 * H2H_YEARS))]
    if len(pair):
        diffs = np.where(pair["home_team_id"] == home_id, pair["ft_home"] - pair["ft_away"], pair["ft_away"] - pair["ft_home"]).astype(float)
        h2h = float(diffs.mean() * len(pair) / (len(pair) + H2H_SHRINK))
    else:
        h2h = 0.0
    return pd.Series({"form_att_home": fa_h, "form_def_home": fd_h, "form_att_away": fa_a, "form_def_away": fd_a, "h2h": h2h, "half_home": np.nan, "half_away": np.nan})


def adjusted_xg(row, feats: pd.Series | None, adj: Adjustment) -> tuple[float, float]:
    """Buts attendus ajustés d'un match (features point-in-time déjà calculées ; absentes → base)."""
    xh, xa = float(row["expected_goals_home"]), float(row["expected_goals_away"])
    if feats is None or not adj.beta:
        return xh, xa
    g = lambda k: float(feats.get(k, 0.0)) if np.isfinite(feats.get(k, np.nan)) else 0.0
    lh = la = 0.0
    if "form_att" in adj.beta:
        lh += adj.beta["form_att"] * g("form_att_home") + adj.beta["form_def"] * g("form_def_away")
        la += adj.beta["form_att"] * g("form_att_away") + adj.beta["form_def"] * g("form_def_home")
    if "h2h" in adj.beta:
        lh += adj.beta["h2h"] * g("h2h"); la -= adj.beta["h2h"] * g("h2h")
    return xh * float(np.exp(lh)), xa * float(np.exp(la))


def save(adj: Adjustment, report: dict) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "adjustment.json").write_text(json.dumps({"adjustment": adj.to_json(), "report": report}, ensure_ascii=False, indent=1), encoding="utf-8")


def load() -> Adjustment:
    p = OUT / "adjustment.json"
    return Adjustment.from_json(json.loads(p.read_text(encoding="utf-8"))["adjustment"]) if p.exists() else Adjustment(beta={})
