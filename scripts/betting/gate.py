"""
Étape 2 du moteur quantitatif : porte de validation par segment (famille × compétition).

Question : notre simulation apporte-t-elle, quelque part, une information que la clôture Pinnacle n'a pas
déjà ? Mesure (Pitcan 2026, déjà employée pour le 1N2 dans docs/forecast-research.md) : poids w du modèle
dans un pool logarithmique p ∝ p_modèle^w · p_sharp^(1−w), choisi sur une saison de validation, puis
évalué sur la saison suivante, jamais réoptimisé. Un segment n'obtient un poids w > 0 dans le produit
(`pool_weights.json`, lu par le coupe-circuit) que si, hors échantillon, le pool bat la clôture seule avec
un intervalle de confiance à 90 % entièrement positif et assez de matchs.

Marchés : 1N2 (famille « résultat ») et plus/moins 2,5 (« plus/moins »), ceux dont football-data donne la
clôture Pinnacle (dataset de la recherche, `.research/forecast/replay_market.parquet`, cotes brutes
`odds_ps_closing_*` et `odds_p_ou_closing_*`) ; le handicap asiatique viendra avec son import. Probabilités
sharp : méthode de Shin sur les cotes de clôture. Probabilités du modèle : simulation de phase 2 (variante
figée) sur les buts attendus figés avant le match (anti-fuite, `phase2.matches_with_predictions`).

  cd scripts
  python3 -m betting.gate [--validation 2024-25] [--test 2025-26] [--write]
    → .research/betting/phase2/gate.json (tous les segments) et, avec --write, pool_weights.json
      (segments validés seulement ; fichier vide si aucun, jamais absent : le produit lit w = 0).
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import sys

import numpy as np
import pandas as pd

from . import COMPETITIONS, ROOT
from . import markets as mk
from . import simulate as sm
from . import sharp
from .phase2 import OUT as PHASE2, frozen_variant, matches_with_predictions

REPLAY_MARKET = ROOT / ".research" / "forecast" / "replay_market.parquet"
GATE_REPORT = PHASE2 / "gate.json"
POOL_WEIGHTS = sharp.POOL_WEIGHTS
VALIDATION_SEASON = "2024-25"
TEST_SEASON = "2025-26"
WEIGHT_GRID = [round(w, 2) for w in np.arange(0.0, 1.0001, 0.05)]
MIN_MATCHES = 150          # par segment et par saison
BOOTSTRAP = 2000
CONFIDENCE = 0.90
SEED = 11
FAMILIES = {"1x2": "résultat", "ou25": "plus/moins"}


# ----- données -----

def load_closing(competitions=COMPETITIONS, path=REPLAY_MARKET) -> pd.DataFrame:
    """Matchs du Labo avec clôture Pinnacle brute (1N2 et/ou plus/moins 2,5) et résultat."""
    if not path.exists():
        raise RuntimeError(f"{path} absent : lancer la recherche prévision (backtest.market_benchmark) d'abord.")
    cols = ["match_id", "competition", "season", "home_goals", "away_goals", "odds_ps_closing_home", "odds_ps_closing_draw", "odds_ps_closing_away",
            "odds_p_ou_closing_over", "odds_p_ou_closing_under"]
    d = pd.read_parquet(path, columns=cols)
    d = d[d["competition"].isin(competitions) & d["home_goals"].notna() & d["away_goals"].notna()].copy()
    return d


def shin_columns(d: pd.DataFrame) -> pd.DataFrame:
    """Probabilités de Shin de la clôture : s_home / s_draw / s_away et s_over / s_under (NaN sans cotes)."""
    d = d.copy()
    for c in ("s_home", "s_draw", "s_away", "s_over", "s_under"):
        d[c] = np.nan
    ok = d[["odds_ps_closing_home", "odds_ps_closing_draw", "odds_ps_closing_away"]].gt(1.0).all(axis=1)
    for i in d.index[ok]:
        p, _ = sharp.devig_shin(sharp.implied(d.loc[i, ["odds_ps_closing_home", "odds_ps_closing_draw", "odds_ps_closing_away"]].to_numpy(float)))
        d.loc[i, ["s_home", "s_draw", "s_away"]] = p
    ok = d[["odds_p_ou_closing_over", "odds_p_ou_closing_under"]].gt(1.0).all(axis=1)
    for i in d.index[ok]:
        p, _ = sharp.devig_shin(sharp.implied(d.loc[i, ["odds_p_ou_closing_over", "odds_p_ou_closing_under"]].to_numpy(float)))
        d.loc[i, ["s_over", "s_under"]] = p
    return d


def model_columns(d: pd.DataFrame, seasons, n_sims: int = 4000) -> pd.DataFrame:
    """Probabilités du modèle (simulation sur buts attendus figés) : m_home / m_draw / m_away / m_over / m_under."""
    pred = matches_with_predictions(seasons)[["match_id", "expected_goals_home", "expected_goals_away"]]
    variant = frozen_variant()
    d = d.merge(pred, on="match_id", how="inner")
    out = {k: [] for k in ("m_home", "m_draw", "m_away", "m_over", "m_under")}
    over = mk.Spec("totals", "fulltime", 2.5, "Over")
    for r in d.itertuples(index=False):
        sims = sm.simulate(float(r.expected_goals_home), float(r.expected_goals_away), 0.45, variant, n=n_sims)
        h, a = sims.period("fulltime")
        out["m_home"].append(float(np.mean(h > a))); out["m_draw"].append(float(np.mean(h == a))); out["m_away"].append(float(np.mean(h < a)))
        po = mk.probability(over, sims)
        out["m_over"].append(po); out["m_under"].append(1.0 - po)
    for k, v in out.items():
        d[k] = v
    return d


# ----- pool et score -----

def pool_matrix(pm: np.ndarray, ps: np.ndarray, w: float) -> np.ndarray:
    """Pool logarithmique ligne par ligne (issues en colonnes), renormalisé."""
    eps = 1e-6
    a = np.clip(pm, eps, 1) ** w * np.clip(ps, eps, 1) ** (1.0 - w)
    return a / a.sum(axis=1, keepdims=True)


def log_loss(p: np.ndarray, y: np.ndarray) -> np.ndarray:
    """Log-loss par match : −log p(issue réalisée) ; y = indice de la colonne gagnante."""
    return -np.log(np.clip(p[np.arange(len(y)), y], 1e-6, 1.0))


def fit_weight(pm: np.ndarray, ps: np.ndarray, y: np.ndarray, grid=WEIGHT_GRID) -> tuple[float, dict]:
    """Poids de la grille qui minimise le log-loss moyen du pool (validation)."""
    scores = {w: float(log_loss(pool_matrix(pm, ps, w), y).mean()) for w in grid}
    best = min(scores, key=lambda w: (scores[w], w))      # à égalité, le plus petit poids
    return best, scores


def evaluate(pm: np.ndarray, ps: np.ndarray, y: np.ndarray, w: float, n_boot: int = BOOTSTRAP, seed: int = SEED) -> dict:
    """Gain de log-loss du pool contre la clôture seule, hors échantillon, avec intervalle bootstrap à 90 %."""
    ll_sharp = log_loss(pool_matrix(pm, ps, 0.0), y)
    ll_pool = log_loss(pool_matrix(pm, ps, w), y)
    diff = ll_sharp - ll_pool                                 # > 0 : le pool fait mieux
    rng = np.random.default_rng(seed)
    n = len(diff)
    means = np.array([diff[rng.integers(0, n, n)].mean() for _ in range(n_boot)]) if n else np.array([0.0])
    lo, hi = np.quantile(means, [(1 - CONFIDENCE) / 2, 1 - (1 - CONFIDENCE) / 2])
    return {"matches": int(n), "logLossSharp": round(float(ll_sharp.mean()), 5), "logLossPool": round(float(ll_pool.mean()), 5),
            "gain": round(float(diff.mean()), 5), "gainLow": round(float(lo), 5), "gainHigh": round(float(hi), 5)}


def segment_arrays(d: pd.DataFrame, market: str) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    if market == "1x2":
        pm = d[["m_home", "m_draw", "m_away"]].to_numpy(float); ps = d[["s_home", "s_draw", "s_away"]].to_numpy(float)
        y = np.where(d["home_goals"] > d["away_goals"], 0, np.where(d["home_goals"] == d["away_goals"], 1, 2))
    else:
        pm = d[["m_over", "m_under"]].to_numpy(float); ps = d[["s_over", "s_under"]].to_numpy(float)
        y = np.where(d["home_goals"] + d["away_goals"] > 2.5, 0, 1)
    ok = ~np.isnan(pm).any(axis=1) & ~np.isnan(ps).any(axis=1)
    return pm[ok], ps[ok], y[ok]


def run_gate(d: pd.DataFrame, validation: str = VALIDATION_SEASON, test: str = TEST_SEASON, min_matches: int = MIN_MATCHES) -> dict:
    """Pour chaque famille × compétition (et famille entière) : poids choisi en validation, gain en test, verdict."""
    segments = []
    for market, family in FAMILIES.items():
        comps = [None] + sorted(d["competition"].unique())
        for comp in comps:
            v = d[(d["season"] == validation) & ((d["competition"] == comp) if comp else True)]
            t = d[(d["season"] == test) & ((d["competition"] == comp) if comp else True)]
            pmv, psv, yv = segment_arrays(v, market)
            pmt, pst, yt = segment_arrays(t, market)
            seg = {"family": family, "competition": comp or "toutes", "validationMatches": int(len(yv)), "testMatches": int(len(yt))}
            if len(yv) < min_matches or len(yt) < min_matches:
                seg.update({"weight": 0.0, "verdict": "trop_peu_de_matchs"})
                segments.append(seg); continue
            w, scores = fit_weight(pmv, psv, yv)
            seg["weight"] = w
            seg["validationLogLossByWeight"] = {str(k): round(s, 5) for k, s in scores.items()}
            seg["test"] = evaluate(pmt, pst, yt, w)
            if w == 0.0:
                seg["verdict"] = "poids_nul"
            elif seg["test"]["gainLow"] > 0:
                seg["verdict"] = "valide"
            else:
                seg["verdict"] = "gain_non_significatif"
            segments.append(seg)
    weights = {f"{s['family']}|{s['competition']}": s["weight"] for s in segments if s["verdict"] == "valide" and s["competition"] != "toutes"}
    return {"generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"), "validationSeason": validation, "testSeason": test,
            "minMatches": min_matches, "confidence": CONFIDENCE, "grid": WEIGHT_GRID, "devig": "shin", "reference": "pinnacle_closing_football_data",
            "segments": segments, "weights": weights}


def write_weights(report: dict, path=POOL_WEIGHTS) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"generatedAt": report["generatedAt"], "validationSeason": report["validationSeason"], "testSeason": report["testSeason"],
                                "weights": report["weights"]}, ensure_ascii=False, indent=1), encoding="utf-8")


def summary_lines(report: dict) -> list[str]:
    out = [f"Porte de validation : poids choisi sur {report['validationSeason']}, évalué sur {report['testSeason']} (clôture Pinnacle, Shin)"]
    for s in report["segments"]:
        t = s.get("test")
        line = f"  {s['family']:11s} {s['competition']:7s} n={s['validationMatches']}/{s['testMatches']:<5} w={s['weight']:.2f}"
        if t:
            line += f" gain={t['gain']:+.5f} [{t['gainLow']:+.5f}; {t['gainHigh']:+.5f}]"
        out.append(line + f"  → {s['verdict']}")
    out.append(f"Segments validés : {len(report['weights'])} ({', '.join(f'{k} w={v}' for k, v in report['weights'].items()) or 'aucun'})")
    return out


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--validation", default=VALIDATION_SEASON)
    parser.add_argument("--test", default=TEST_SEASON)
    parser.add_argument("--write", action="store_true", help="écrit pool_weights.json (segments validés seulement)")
    args = parser.parse_args(argv)
    d = shin_columns(load_closing())
    d = model_columns(d, [args.validation, args.test])
    report = run_gate(d, args.validation, args.test)
    PHASE2.mkdir(parents=True, exist_ok=True)
    GATE_REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    print("\n".join(summary_lines(report)))
    if args.write:
        write_weights(report)
        print(f"{POOL_WEIGHTS} écrit ({len(report['weights'])} segment(s))")
    return 0


if __name__ == "__main__":
    sys.exit(main())
