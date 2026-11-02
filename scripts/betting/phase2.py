"""
Phase 2 du Labo paris : simulation de chaque match, probabilités par marché, calibration et comparaison
aux cotes Winamax. Tout est écrit sous `.research/betting/phase2/` (ignoré par Git).

  cd scripts
  python3 -m betting.phase2 variant      ajuste rho (Dixon-Coles) et k (binomiale négative) sur la saison
                                         d'ajustement, choisit la variante sur la saison de choix, la fige
  python3 -m betting.phase2 calibrate    calibration sans cotes par famille × compétition (saisons avec
                                         prévisions figées), tableau prédit / observé / N, log-loss, Brier
  python3 -m betting.phase2 compare      comparaison aux cotes Winamax (archive, vues H−1 et dernier relevé)
  python3 -m betting.phase2 synthesis    tableau famille × compétition classé
  python3 -m betting.phase2 all

Entrées : prévisions figées point-in-time de la recherche (`.research/forecast/predictions/{saison}.parquet`,
modèle `scoutvision_reproduced` par défaut), résultats détaillés (`betting.results`), archive de cotes et
appariement (phase 1). Aucun modèle n'est modifié ni réentraîné.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

from . import COMPETITIONS, RESEARCH, ROOT
from . import markets as mk
from . import simulate as sm
from .catalogue import load as load_catalogue
from .results import RESULTS, build as build_results, half_share

OUT = RESEARCH / "phase2"
PREDICTIONS = ROOT / ".research" / "forecast" / "predictions"
DEFAULT_MODEL = "scoutvision_reproduced"
FIT_SEASON, CHOICE_SEASON = "2024-25", "2025-26"          # saisons avec prévisions figées point-in-time
CALIBRATION_SEASONS = ("2024-25", "2025-26")
COMPARISON_SEASON = "2026-27"
BINS = [0.0, 0.05, 0.2, 0.4, 0.6, 0.8, 0.95, 1.0]
USABLE_MAX_GAP = 0.02      # écart moyen |prédit − observé| pondéré par N, en probabilité
USABLE_MIN_N = 500
BOOTSTRAP_DRAWS = 2000

# Issues canoniques de la calibration sans cotes (une par marché « complet » ou ligne usuelle)
CANONICAL: list[mk.Spec] = (
    [mk.Spec("1x2", p, 0.0, n) for p in ("fulltime", "p1") for n in ("1", "X", "2")]
    + [mk.Spec("doublechance", "fulltime", 0.0, n) for n in ("1X", "12", "X2")]
    + [mk.Spec("drawnobet", "fulltime", 0.0, n) for n in ("1", "2")]
    + [mk.Spec("totals", "fulltime", l, "Over") for l in (0.5, 1.5, 2.5, 3.5, 4.5)]
    + [mk.Spec("totals", "p1", l, "Over") for l in (0.5, 1.5, 2.5)]
    + [mk.Spec(t, "fulltime", l, "Over") for t in ("teamtotals-team1", "teamtotals-team2") for l in (0.5, 1.5, 2.5)]
    + [mk.Spec("spreads", "fulltime", h, "1") for h in (-2.5, -1.5, -0.5, 0.5, 1.5, 2.5)]
    + [mk.Spec("spreads", "p1", h, "1") for h in (-0.5, 0.5)]
    + [mk.Spec("correctscore", "fulltime", 0.0, f"{i}:{j}") for i in range(5) for j in range(5)]
    + [mk.Spec("correctscore", "p1", 0.0, f"{i}:{j}") for i in range(3) for j in range(3)]
    + [mk.Spec("exactscore", "fulltime", 0.0, n) for n in ("0", "1", "2", "3", "4", "5", "6+")]
    + [mk.Spec(t, "fulltime", 0.0, n) for t in ("exactscore-team1", "exactscore-team2") for n in ("0", "1", "2", "3+")]
    + [mk.Spec("bothteamsscore", p, 0.0, "Yes") for p in ("fulltime", "p1")]
    + [mk.Spec(t, "fulltime", 0.0, "Yes") for t in ("cleansheet-team1", "cleansheet-team2", "wintonil-team1", "wintonil-team2",
                                                   "toscoreinbh-team1", "toscoreinbh-team2", "winbothh-team1", "winbothh-team2",
                                                   "wineitherh-team1", "wineitherh-team2")]
    + [mk.Spec("winningmargin", "fulltime", 0.0, n) for n in ("Draw", "1 By 1", "1 By 2", "1 By 3+", "2 By 1", "2 By 2", "2 By 3+")]
    + [mk.Spec(t, "fulltime", 0.0, n) for t in ("firstgoal", "lastgoal") for n in ("1", "2", "No Goal")]
    + [mk.Spec("halftime-fulltime", "fulltime", 0.0, f"{a}/{b}") for a in "1X2" for b in "1X2"]
)


# ----- entrées -----

def load_predictions(seasons, model: str = DEFAULT_MODEL) -> pd.DataFrame:
    frames = []
    for s in seasons:
        p = PREDICTIONS / f"{s}.parquet"
        if p.exists():
            d = pd.read_parquet(p, columns=["match_id", "model_id", "fitted_at", "expected_goals_home", "expected_goals_away"])
            frames.append(d[d["model_id"] == model].assign(season=s))
    df = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()
    return df.dropna(subset=["expected_goals_home", "expected_goals_away"])


def load_results() -> pd.DataFrame:
    r = pd.read_parquet(RESULTS) if RESULTS.exists() else build_results()
    r = r[r["competition"].isin(COMPETITIONS) & ~r["awarded"] & ~r["extra_time"]]
    return r


def matches_with_predictions(seasons, model: str = DEFAULT_MODEL) -> pd.DataFrame:
    """Matchs joués des compétitions du Labo avec une prévision figée émise avant le coup d'envoi (anti-fuite)."""
    pred = load_predictions(seasons, model)
    res = load_results()
    df = res.merge(pred.drop(columns=["season"]), on="match_id", how="inner")
    # `fitted_at` est la date logique du réajustement hebdomadaire (walk-forward) : seules les rencontres
    # antérieures ont servi à l'ajustement ; une prévision datée après le coup d'envoi serait une fuite
    fitted = pd.to_datetime(df["fitted_at"], utc=True, errors="coerce")
    kick = pd.to_datetime(df["kickoff_utc"], utc=True)
    leak = fitted.isna() | (fitted > kick)
    if leak.any():
        raise RuntimeError(f"{int(leak.sum())} prévisions datées après le coup d'envoi : fuite, arrêt.")
    return df


def half_share_prior(results: pd.DataFrame) -> dict[tuple[str, str], float]:
    """p_first_half par (compétition, saison) estimée sur les saisons strictement antérieures (repli 0,45)."""
    hs = half_share(results)
    out = {}
    for comp, g in hs.groupby("competition"):
        g = g.sort_values("season")
        for s in results.loc[results["competition"] == comp, "season"].unique():
            prior = g[g["season"] < s]
            out[(comp, s)] = float(prior["first"].sum() / prior["total"].sum()) if prior["total"].sum() > 0 else 0.45
    return out


# ----- variante -----

def choose_variant(model: str = DEFAULT_MODEL) -> dict:
    fit = matches_with_predictions([FIT_SEASON], model)
    choice = matches_with_predictions([CHOICE_SEASON], model)
    cols = ["expected_goals_home", "expected_goals_away", "ft_home", "ft_away"]
    fx = [fit[c].to_numpy(float) for c in cols]
    cx = [choice[c].to_numpy(float) for c in cols]
    report = {"fitSeason": FIT_SEASON, "choiceSeason": CHOICE_SEASON, "fitMatches": len(fit), "choiceMatches": len(choice), "model": model, "variants": {}}
    best = None
    for name in sm.VARIANTS:
        v = sm.fit_variant(name, *fx)
        scores = _variant_scores(v, *cx)
        report["variants"][name] = {"rho": v.rho, "dispersion": v.dispersion, **scores}
        if best is None or scores["logLossScore"] < best[1]:
            best = (v, scores["logLossScore"])
    v = best[0]
    report["chosen"] = {"name": v.name, "rho": v.rho, "dispersion": v.dispersion, "criterion": "log-loss du score exact sur la saison de choix"}
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "variant.json").write_text(json.dumps(report, indent=1), encoding="utf-8")
    return report


def _variant_scores(v: sm.Variant, xg_h, xg_a, ft_h, ft_a) -> dict:
    ll_score, ll_1x2, ll_ou, n = 0.0, 0.0, 0.0, 0
    for mh, ma, h, a in zip(xg_h, xg_a, ft_h, ft_a):
        m = sm.score_matrix(float(mh), float(ma), v)
        hh, aa = min(int(h), sm.MAX_GOALS), min(int(a), sm.MAX_GOALS)
        ll_score -= np.log(m[hh, aa])
        p1, px, p2 = np.tril(m, -1).sum(), np.trace(m), np.triu(m, 1).sum()
        ll_1x2 -= np.log({1: p1, 0: px, -1: p2}[int(np.sign(h - a))])
        idx = np.add.outer(np.arange(m.shape[0]), np.arange(m.shape[1]))
        po = m[idx >= 3].sum()
        ll_ou -= np.log(po if h + a >= 3 else 1 - po)
        n += 1
    return {"logLossScore": round(ll_score / n, 5), "logLoss1x2": round(ll_1x2 / n, 5), "logLossOver25": round(ll_ou / n, 5), "n": n}


def frozen_variant() -> sm.Variant:
    p = OUT / "variant.json"
    if not p.exists():
        raise RuntimeError("variant.json absent : lancer `python3 -m betting.phase2 variant` d'abord.")
    c = json.loads(p.read_text(encoding="utf-8"))["chosen"]
    return sm.Variant(c["name"], rho=float(c["rho"]), dispersion=float(c["dispersion"]))


# ----- calibration sans cotes -----

def calibrate(model: str = DEFAULT_MODEL, seasons=CALIBRATION_SEASONS, specs: list[mk.Spec] = CANONICAL, n_sims: int = sm.N_SIMS) -> dict:
    df = matches_with_predictions(seasons, model)
    variant = frozen_variant()
    shares = half_share_prior(load_results())
    rows = []
    for m in df.itertuples(index=False):
        s = sm.simulate(float(m.expected_goals_home), float(m.expected_goals_away), shares.get((m.competition, m.season), 0.45), variant, n=n_sims)
        result = mk.Result(int(m.ft_home), int(m.ft_away), int(m.ht_home), int(m.ht_away), m.first_goal, m.last_goal)
        for spec in specs:
            settled = mk.settle(spec, result)
            if settled is None:
                continue
            rows.append((m.match_id, m.competition, m.season, spec.family, spec.market_type, spec.period, spec.handicap, spec.outcome,
                         mk.probability(spec, s), settled if settled in (0.0, 1.0) else 0.5 + settled / 2 if settled != 0.5 else 0.75))
    tab = pd.DataFrame(rows, columns=["match_id", "competition", "season", "family", "market_type", "period", "handicap", "outcome", "p", "y"])
    tab["y"] = tab["y"].clip(0, 1)
    tab.to_parquet(OUT / "calibration_rows.parquet", index=False)
    report = {"model": model, "seasons": list(seasons), "variant": variant.__dict__, "matches": int(df["match_id"].nunique()), "usableMaxGap": USABLE_MAX_GAP,
              "usableMinN": USABLE_MIN_N, "byFamily": {}, "byFamilyCompetition": {}}
    for fam, g in tab.groupby("family"):
        report["byFamily"][fam] = _calibration_block(g)
    for (fam, comp), g in tab.groupby(["family", "competition"]):
        report["byFamilyCompetition"][f"{fam}|{comp}"] = _calibration_block(g)
    (OUT / "calibration.json").write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    return report


def _calibration_block(g: pd.DataFrame) -> dict:
    p, y = g["p"].to_numpy(float), g["y"].to_numpy(float)
    eps = 1e-9
    ll = float(-np.mean(y * np.log(np.clip(p, eps, 1)) + (1 - y) * np.log(np.clip(1 - p, eps, 1))))
    brier = float(np.mean((p - y) ** 2))
    bins = []
    cut = pd.cut(p, BINS, include_lowest=True, right=False)
    gap_num, gap_den = 0.0, 0
    for interval, gg in g.groupby(cut, observed=True):
        n = len(gg)
        pm, om = float(gg["p"].mean()), float(gg["y"].mean())
        bins.append({"bin": f"{interval.left:.2f}-{interval.right:.2f}", "n": n, "predicted": round(pm, 4), "observed": round(om, 4)})
        gap_num += n * abs(pm - om); gap_den += n
    gap = gap_num / gap_den if gap_den else float("nan")
    return {"n": int(len(g)), "logLoss": round(ll, 5), "brier": round(brier, 5), "meanGap": round(gap, 4), "bins": bins,
            "usable": bool(len(g) >= USABLE_MIN_N and gap <= USABLE_MAX_GAP)}


# ----- comparaison à Winamax -----

def compare(model: str = DEFAULT_MODEL, season: str = COMPARISON_SEASON, n_sims: int = sm.N_SIMS) -> dict:
    df = matches_with_predictions([season], model)
    variant = frozen_variant()
    shares = half_share_prior(load_results())
    cat = load_catalogue()
    matched = pd.read_parquet(RESEARCH / "matches.parquet")
    fixtures = pd.read_parquet(RESEARCH / "fixtures.parquet").set_index("fixture_id")
    views = pd.concat([pd.read_parquet(p) for c in COMPETITIONS for p in sorted((RESEARCH / "views" / c).glob("*.parquet"))], ignore_index=True)
    views = views.merge(matched, on="fixture_id", how="inner")
    df = df.merge(matched, on="match_id", how="inner")
    rows = []
    for m in df.itertuples(index=False):
        v = views[views["match_id"] == m.match_id]
        if v.empty:
            continue
        kick = fixtures.loc[m.fixture_id, "start_time"]
        assert (v["kickoff"] == kick).all()
        s = sm.simulate(float(m.expected_goals_home), float(m.expected_goals_away), shares.get((m.competition, m.season), 0.45), variant, n=n_sims)
        result = mk.Result(int(m.ft_home), int(m.ft_away), int(m.ht_home), int(m.ht_away), m.first_goal, m.last_goal)
        for r in v.itertuples(index=False):
            market = cat.get(int(r.market_id))
            spec = market.spec(int(r.outcome_id)) if market else None
            if spec is None or market.player_prop:
                continue
            settled = mk.settle(spec, result)
            dist = mk.outcome_distribution(spec, s)
            p = mk.probability(spec, s)
            for view in ("h1", "last"):
                price, at = getattr(r, f"{view}_price"), getattr(r, f"{view}_at")
                if price is None or not np.isfinite(price) or price <= 1.0:
                    continue
                assert pd.Timestamp(at) < kick  # aucun relevé postérieur au coup d'envoi
                rows.append((m.match_id, m.competition, int(r.market_id), int(r.outcome_id), spec.family, spec.market_type, spec.period, spec.handicap,
                             spec.outcome, view, float(price), p, mk.expected_return(spec, s, float(price)), settled, mk.realised_return(settled, float(price))))
    tab = pd.DataFrame(rows, columns=["match_id", "competition", "market_id", "outcome_id", "family", "market_type", "period", "handicap", "outcome",
                                      "view", "odds", "p", "expected_return", "settled", "realised"])
    tab = _attach_winamax_probability(tab, cat)
    tab.to_parquet(OUT / "comparison_rows.parquet", index=False)
    report = {"model": model, "season": season, "variant": variant.__dict__, "matches": int(tab["match_id"].nunique()), "views": {}}
    for view in ("h1", "last"):
        t = tab[tab["view"] == view]
        report["views"][view] = {"byFamily": {f: _comparison_block(g) for f, g in t.groupby("family")},
                                 "byFamilyCompetition": {f"{f}|{c}": _comparison_block(g) for (f, c), g in t.groupby(["family", "competition"])}}
    (OUT / "comparison.json").write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    return report


def _attach_winamax_probability(tab: pd.DataFrame, cat) -> pd.DataFrame:
    """Probabilité Winamax sans marge (normalisation proportionnelle) sur les marchés complets, par vue."""
    tab = tab.copy()
    tab["q"] = np.nan
    tab["complete"] = False
    for (mid, view, match_id), g in tab.groupby(["match_id", "view", "market_id"]):
        specs = [mk.Spec(r.market_type, r.period, r.handicap, r.outcome) for r in g.itertuples(index=False)]
        if mk.is_complete(specs):
            q = mk.devig_proportional(1.0 / g["odds"].to_numpy(float))
            tab.loc[g.index, "q"] = q
            tab.loc[g.index, "complete"] = True
    return tab


def _comparison_block(g: pd.DataFrame) -> dict:
    out = {"outcomes": int(len(g)), "matches": int(g["match_id"].nunique())}
    settled = g[g["settled"].notna()]
    comp = settled[settled["complete"] & (settled["settled"].isin([0.0, 1.0]))]
    if len(comp):
        y = comp["settled"].to_numpy(float)
        eps = 1e-9
        ll_us = float(-np.mean(np.where(y == 1, np.log(np.clip(comp["p"], eps, 1)), 0)) * len(comp) / max(y.sum(), 1))
        ll_wx = float(-np.mean(np.where(y == 1, np.log(np.clip(comp["q"], eps, 1)), 0)) * len(comp) / max(y.sum(), 1))
        out["completeMarkets"] = int(comp.groupby(["match_id", "market_id"]).ngroups)
        out["logLossOurs"] = round(ll_us, 5)
        out["logLossWinamax"] = round(ll_wx, 5)
        out["logLossDelta"] = round(ll_us - ll_wx, 5)
    value = settled[settled["expected_return"] > 0]
    out["valueShare"] = round(len(value) / len(settled), 4) if len(settled) else None
    out["valueBets"] = int(len(value))
    if len(value):
        ret = value["realised"].to_numpy(float)
        out["valueReturn"] = round(float(ret.mean()), 4)
        out["valueHitRate"] = round(float(np.mean(value["settled"].to_numpy(float) > 0)), 4)
        out["valueReturnCI90"] = _cluster_bootstrap(value["match_id"].to_numpy(), ret)
    return out


def _cluster_bootstrap(clusters: np.ndarray, values: np.ndarray, draws: int = BOOTSTRAP_DRAWS, seed: int = 11) -> list[float]:
    """Intervalle à 90 % du rendement moyen par rééchantillonnage des matchs (paris du même match corrélés)."""
    rng = np.random.default_rng(seed)
    ids = np.unique(clusters)
    if len(ids) < 2:
        return [float("nan"), float("nan")]
    sums = pd.Series(values).groupby(clusters).agg(["sum", "count"])
    s, c = sums["sum"].to_numpy(float), sums["count"].to_numpy(float)
    means = []
    for _ in range(draws):
        idx = rng.integers(0, len(ids), len(ids))
        means.append(s[idx].sum() / c[idx].sum())
    return [round(float(np.percentile(means, 5)), 4), round(float(np.percentile(means, 95)), 4)]


# ----- synthèse -----

def synthesis() -> pd.DataFrame:
    cal = json.loads((OUT / "calibration.json").read_text(encoding="utf-8"))
    cmp_ = json.loads((OUT / "comparison.json").read_text(encoding="utf-8"))
    rows = []
    for key, c in cmp_["views"]["h1"]["byFamilyCompetition"].items():
        fam, comp = key.split("|")
        k = cal["byFamilyCompetition"].get(key, {})
        last = cmp_["views"]["last"]["byFamilyCompetition"].get(key, {})
        rows.append({"family": fam, "competition": comp, "calibrationUsable": k.get("usable"), "calibrationGap": k.get("meanGap"), "calibrationN": k.get("n"),
                     "logLossDeltaH1": c.get("logLossDelta"), "valueBetsH1": c.get("valueBets"), "valueReturnH1": c.get("valueReturn"),
                     "valueReturnCI90H1": c.get("valueReturnCI90"), "valueBetsLast": last.get("valueBets"), "valueReturnLast": last.get("valueReturn"),
                     "valueReturnCI90Last": last.get("valueReturnCI90")})
    df = pd.DataFrame(rows)
    # classement : calibration utilisable d'abord, puis borne basse de l'intervalle du rendement H−1, puis rendement
    df["lowCI"] = df["valueReturnCI90H1"].map(lambda x: x[0] if isinstance(x, list) and x and x[0] == x[0] else -9)
    df = df.sort_values(["calibrationUsable", "lowCI", "valueReturnH1"], ascending=[False, False, False]).drop(columns="lowCI")
    df.to_csv(OUT / "synthesis.csv", index=False)
    df.to_json(OUT / "synthesis.json", orient="records", indent=1)
    return df


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("cmd", choices=["variant", "calibrate", "compare", "synthesis", "all"])
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--sims", type=int, default=sm.N_SIMS)
    args = parser.parse_args(argv)
    OUT.mkdir(parents=True, exist_ok=True)
    if args.cmd in ("variant", "all"):
        r = choose_variant(args.model)
        print("variante :", json.dumps(r["chosen"]), "| scores", json.dumps(r["variants"]))
    if args.cmd in ("calibrate", "all"):
        r = calibrate(args.model, n_sims=args.sims)
        print(f"calibration : {r['matches']} matchs ; familles utilisables : {[f for f, b in r['byFamily'].items() if b['usable']]}")
    if args.cmd in ("compare", "all"):
        r = compare(args.model, n_sims=args.sims)
        print(f"comparaison : {r['matches']} matchs appariés avec cotes")
    if args.cmd in ("synthesis", "all"):
        df = synthesis()
        print(df.head(20).to_string(index=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
