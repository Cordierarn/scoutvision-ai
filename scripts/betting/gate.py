"""
Porte de validation universelle du moteur quantitatif (v2) : quels segments (famille de marché × compétition)
obtiennent un poids w > 0 du modèle dans la probabilité de référence, et avec quelle marge de calibration.

Trois catégories, trois jeux de données :

  A  marchés couverts par la référence sharp (1N2, plus/moins 2,5) : clôture Pinnacle de football-data
     (`.research/forecast/replay_market.parquet`, Shin), poids choisi sur 2024-25, évalué sur 2025-26 ;
  B  marchés fermés à deux issues sans référence sharp (plus/moins toutes lignes, plus/moins par équipe, les deux
     équipes marquent, clean sheet, gagne sans encaisser) : la référence est la probabilité dé-viguée de Winamax
     lui-même (`winamax_shin_prob`, Shin sur le dernier relevé complet avant le coup d'envoi), seule archive de
     cotes disponible (2026-27) ; poids choisi sur les premiers 60 % de la saison (ordre chronologique), évalué
     sur les 40 % suivants, jamais réoptimisé ;
  C  marchés à issues multiples sans cote de référence (score exact, écart de buts, nombre de buts exact) : la
     référence est la fréquence de base de la saison de validation (par compétition), 2024-25 → 2025-26.

Trois portes, hors échantillon, pour ouvrir un segment :
  1. gain de log-loss du pool p ∝ p_modèle^w · p_référence^(1−w) contre la référence seule, w > 0, intervalle
     bootstrap à 90 % entièrement positif, au moins 150 matchs par partie ;
  2. porte de calibration par bande (catégorie B) : parmi les sélections que le coupe-circuit prendrait (espérance
     p_pool · cote Winamax − 1 ≥ seuil de la famille), ni le côté « haut » (plus / oui) ni le côté « bas » (moins /
     non) ne doit montrer un biais directionnel significatif (fréquence observée − probabilité du pool, IC 90 %
     sous 0) ; c'est ce qui bloque un retour de la sur-sélection des « Moins » ;
  3. marge de calibration : l'erreur de calibration attendue hors échantillon du segment (ECE, 10 classes) est
     enregistrée et le coupe-circuit exige EV_min = EV_base + ECE (`circuit.ev_threshold`).

Sorties : `.research/betting/phase2/gate.json` (tous les segments, les trois catégories) et, avec --write,
`pool_weights.json` (`weights`, `margins`, `references` des seuls segments validés ; fichier vide mais présent
sinon : le produit lit w = 0 et la référence sharp).

  cd scripts
  python3 -m betting.gate [--validation 2024-25] [--test 2025-26] [--write] [--skip-b]
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import sys

import numpy as np
import pandas as pd

from . import BOOKMAKER, COMPETITIONS, RESEARCH, ROOT
from . import circuit
from . import markets as mk
from . import simulate as sm
from . import sharp
from .phase2 import OUT as PHASE2, frozen_variant, load_results, matches_with_predictions

REPLAY_MARKET = ROOT / ".research" / "forecast" / "replay_market.parquet"
GATE_REPORT = PHASE2 / "gate.json"
POOL_WEIGHTS = sharp.POOL_WEIGHTS
VALIDATION_SEASON = "2024-25"
TEST_SEASON = "2025-26"
ARCHIVE_SEASON = "2026-27"          # seule saison avec cotes Winamax archivées (catégorie B)
SPLIT_SHARE = 0.6                   # part chronologique de la saison d'archive servant à choisir w
WEIGHT_GRID = [round(w, 2) for w in np.arange(0.0, 1.0001, 0.05)]
MIN_MATCHES = 150          # par segment et par partie
BOOTSTRAP = 2000
CONFIDENCE = 0.90
SEED = 11
N_SIMS = 4000
MIN_SELECTIONS = 20        # sélections par côté pour juger un biais directionnel
ECE_BINS = 10
FAMILIES = {"1x2": "résultat", "ou25": "plus/moins"}
# catégorie B : famille → types de marché (temps réglementaire)
B_FAMILIES = {
    "plus/moins": ("totals",),
    "plus/moins équipe": ("teamtotals-team1", "teamtotals-team2"),
    "BTTS / clean sheet": ("bothteamsscore", "cleansheet-team1", "cleansheet-team2"),
    "gagne sans encaisser": ("wintonil-team1", "wintonil-team2"),
}
HIGH_SIDES = ("Over", "Yes")        # côté « haut » d'un marché à deux issues (l'autre côté est le complément)
# catégorie C : famille → grille d'issues
C_FAMILIES = ("score exact", "marge de victoire", "nombre de buts")
SCORE_CAP, MARGIN_CAP, TOTAL_CAP = 5, 4, 7


# ----- données (catégorie A) -----

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


def model_columns(d: pd.DataFrame, seasons, n_sims: int = N_SIMS) -> pd.DataFrame:
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


# ----- pool, score, calibration -----

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
    """Gain de log-loss du pool contre la référence seule, hors échantillon, avec intervalle bootstrap à 90 %."""
    ll_sharp = log_loss(pool_matrix(pm, ps, 0.0), y)
    ll_pool = log_loss(pool_matrix(pm, ps, w), y)
    diff = ll_sharp - ll_pool                                 # > 0 : le pool fait mieux
    rng = np.random.default_rng(seed)
    n = len(diff)
    means = np.array([diff[rng.integers(0, n, n)].mean() for _ in range(n_boot)]) if n else np.array([0.0])
    lo, hi = np.quantile(means, [(1 - CONFIDENCE) / 2, 1 - (1 - CONFIDENCE) / 2])
    return {"matches": int(n), "logLossSharp": round(float(ll_sharp.mean()), 5), "logLossPool": round(float(ll_pool.mean()), 5),
            "gain": round(float(diff.mean()), 5), "gainLow": round(float(lo), 5), "gainHigh": round(float(hi), 5)}


def expected_calibration_error(p: np.ndarray, y: np.ndarray, bins: int = ECE_BINS) -> float:
    """ECE : moyenne pondérée, par classe de probabilité prédite, de |fréquence observée − probabilité moyenne|.
    `p`, `y` : une probabilité et un règlement (0/1) par ligne ; pour un marché à issues multiples, une ligne par
    issue (la pondération par classe rend la mesure comparable entre familles)."""
    p = np.asarray(p, dtype=float); y = np.asarray(y, dtype=float)
    if len(p) == 0:
        return 0.0
    edges = np.linspace(0.0, 1.0, bins + 1)
    idx = np.clip(np.digitize(p, edges[1:-1]), 0, bins - 1)
    ece = 0.0
    for b in range(bins):
        m = idx == b
        if m.any():
            ece += m.mean() * abs(float(y[m].mean() - p[m].mean()))
    return float(ece)


def _bootstrap_mean_ci(values: np.ndarray, n_boot: int = BOOTSTRAP, seed: int = SEED) -> tuple[float, float]:
    rng = np.random.default_rng(seed)
    n = len(values)
    if n == 0:
        return (0.0, 0.0)
    means = np.array([values[rng.integers(0, n, n)].mean() for _ in range(n_boot)])
    lo, hi = np.quantile(means, [(1 - CONFIDENCE) / 2, 1 - (1 - CONFIDENCE) / 2])
    return float(lo), float(hi)


def band_gate(p_pool: np.ndarray, y: np.ndarray, odds_high: np.ndarray, odds_low: np.ndarray, family: str) -> dict:
    """Porte de calibration par bande d'un marché à deux issues. `p_pool`, `y` : côté haut ; sélections = issues dont
    l'espérance à la cote Winamax dépasse le seuil de la famille. Pour chaque côté : nombre, probabilité moyenne,
    fréquence observée, biais (observé − prédit) et son IC 90 %, rendement pour 1 € ; échec si un côté est
    significativement surestimé (borne haute du biais < 0). Un côté sous MIN_SELECTIONS n'est pas jugé."""
    thr = circuit.ev_threshold(family)
    out = {"threshold": thr, "sides": {}, "passed": True, "judged": False}
    for side, p, yy, odds in (("haut", p_pool, y, odds_high), ("bas", 1.0 - p_pool, 1.0 - y, odds_low)):
        sel = np.isfinite(odds) & (p * odds - 1.0 >= thr)
        n = int(sel.sum())
        block = {"selections": n}
        if n:
            bias = yy[sel] - p[sel]
            lo, hi = _bootstrap_mean_ci(bias)
            block.update({"pMean": round(float(p[sel].mean()), 4), "hitRate": round(float(yy[sel].mean()), 4), "bias": round(float(bias.mean()), 4),
                          "biasLow": round(lo, 4), "biasHigh": round(hi, 4), "roi": round(float((yy[sel] * odds[sel] - 1.0).mean()), 4)})
            if n >= MIN_SELECTIONS:
                block["judged"] = True
                out["judged"] = True
                if hi < 0:
                    block["verdict"] = "surestime"
                    out["passed"] = False
                else:
                    block["verdict"] = "ok"
        out["sides"][side] = block
    return out


# ----- catégorie A -----

def segment_arrays(d: pd.DataFrame, market: str) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    if market == "1x2":
        pm = d[["m_home", "m_draw", "m_away"]].to_numpy(float); ps = d[["s_home", "s_draw", "s_away"]].to_numpy(float)
        y = np.where(d["home_goals"] > d["away_goals"], 0, np.where(d["home_goals"] == d["away_goals"], 1, 2))
    else:
        pm = d[["m_over", "m_under"]].to_numpy(float); ps = d[["s_over", "s_under"]].to_numpy(float)
        y = np.where(d["home_goals"] + d["away_goals"] > 2.5, 0, 1)
    ok = ~np.isnan(pm).any(axis=1) & ~np.isnan(ps).any(axis=1)
    return pm[ok], ps[ok], y[ok]


def _ece_multi(pool: np.ndarray, y: np.ndarray) -> float:
    """ECE d'un marché à issues multiples : une ligne par issue (probabilité, gagnée ou non)."""
    onehot = np.zeros_like(pool); onehot[np.arange(len(y)), y] = 1.0
    return expected_calibration_error(pool.ravel(), onehot.ravel())


def run_gate(d: pd.DataFrame, validation: str = VALIDATION_SEASON, test: str = TEST_SEASON, min_matches: int = MIN_MATCHES) -> dict:
    """Catégorie A : pour chaque famille × compétition (et famille entière), poids choisi en validation, gain en test,
    ECE hors échantillon, verdict."""
    segments = []
    for market, family in FAMILIES.items():
        comps = [None] + sorted(d["competition"].unique())
        for comp in comps:
            v = d[(d["season"] == validation) & ((d["competition"] == comp) if comp else True)]
            t = d[(d["season"] == test) & ((d["competition"] == comp) if comp else True)]
            pmv, psv, yv = segment_arrays(v, market)
            pmt, pst, yt = segment_arrays(t, market)
            seg = {"category": "A", "family": family, "competition": comp or "toutes", "reference": "sharp", "validationMatches": int(len(yv)), "testMatches": int(len(yt))}
            if len(yv) < min_matches or len(yt) < min_matches:
                seg.update({"weight": 0.0, "verdict": "trop_peu_de_matchs"})
                segments.append(seg); continue
            w, scores = fit_weight(pmv, psv, yv)
            seg["weight"] = w
            seg["validationLogLossByWeight"] = {str(k): round(s, 5) for k, s in scores.items()}
            seg["test"] = evaluate(pmt, pst, yt, w)
            seg["ece"] = round(_ece_multi(pool_matrix(pmt, pst, w), yt), 4)
            seg["verdict"] = "poids_nul" if w == 0.0 else "valide" if seg["test"]["gainLow"] > 0 else "gain_non_significatif"
            segments.append(seg)
    return {"validationSeason": validation, "testSeason": test, "minMatches": min_matches, "reference": "pinnacle_closing_football_data", "segments": segments}


# ----- catégorie B : marchés fermés à deux issues, référence Winamax dé-viguée -----

def _high_side(spec: mk.Spec) -> bool | None:
    """True si l'issue est le côté « haut » (plus / oui), False pour le complément, None si le marché n'est pas à deux issues."""
    if spec.outcome in HIGH_SIDES:
        return True
    if spec.outcome in ("Under", "No"):
        return False
    return None


def _winamax_last(snaps: pd.DataFrame) -> pd.DataFrame:
    """Dernier relevé Winamax de chaque issue (avant le coup d'envoi déjà filtré par l'appelant)."""
    s = snaps[(snaps["bookmaker"] == BOOKMAKER) & snaps["player_id"].isna()].sort_values("created_at")
    return s.groupby(["fixture_id", "market_id", "outcome_id"], as_index=False).last()


def build_rows_b(matches: pd.DataFrame, snaps: pd.DataFrame, cat, variant: sm.Variant, n_sims: int = N_SIMS, families: dict = B_FAMILIES) -> pd.DataFrame:
    """Une ligne par match × marché à deux issues (côté haut) : probabilité du modèle, probabilité dé-viguée de Winamax
    (Shin sur le dernier relevé complet avant le coup d'envoi), cotes brutes des deux côtés, règlement du côté haut.
    `matches` : match_id, fixture_id, competition, kickoff_utc, expected_goals_*, ft_*, ht_*, first_goal, last_goal.
    Les remboursements (lignes entières touchées) sont écartés."""
    types = {t: fam for fam, ts in families.items() for t in ts}
    kick = pd.to_datetime(matches.set_index("fixture_id")["kickoff_utc"], utc=True)
    s = snaps[snaps["fixture_id"].isin(kick.index)].copy()
    s["created_at"] = pd.to_datetime(s["created_at"], utc=True)
    s = s[s["created_at"] < s["fixture_id"].map(kick)]
    last = _winamax_last(s)
    rows = []
    for m in matches.itertuples(index=False):
        g = last[last["fixture_id"] == m.fixture_id]
        if g.empty:
            continue
        sims = sm.simulate(float(m.expected_goals_home), float(m.expected_goals_away), 0.45, variant, n=n_sims)
        result = mk.Result(int(m.ft_home), int(m.ft_away), int(m.ht_home), int(m.ht_away), str(m.first_goal), str(m.last_goal))
        for mid, gm in g.groupby("market_id"):
            market = cat.get(int(mid))
            if market is None or market.period != "fulltime" or market.market_type not in types:
                continue
            specs = {int(o): market.spec(int(o)) for o in gm["outcome_id"]}
            if len(specs) != 2 or any(sp is None for sp in specs.values()):
                continue
            prices = {int(o): float(p) for o, p in zip(gm["outcome_id"], gm["price"])}
            if any(p <= 1.0 for p in prices.values()):
                continue
            high = {o: _high_side(sp) for o, sp in specs.items()}
            if set(high.values()) != {True, False}:
                continue
            o_high = next(o for o, h in high.items() if h); o_low = next(o for o, h in high.items() if not h)
            settled = mk.settle(specs[o_high], result)
            if settled is None or settled not in (0.0, 1.0):
                continue
            q = sharp.implied([prices[o_high], prices[o_low]])
            shin, _ = sharp.devig_shin(q)
            rows.append({"match_id": m.match_id, "competition": m.competition, "kickoff": kick[m.fixture_id], "family": types[market.market_type],
                         "market_type": market.market_type, "handicap": float(specs[o_high].handicap), "p_model": float(mk.probability(specs[o_high], sims)),
                         "p_wx": float(shin[0]), "odds_high": prices[o_high], "odds_low": prices[o_low], "overround": float(q.sum() - 1.0), "y": float(settled)})
    return pd.DataFrame(rows)


def split_chronological(rows: pd.DataFrame, share: float = SPLIT_SHARE) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Matchs triés par coup d'envoi : les premiers `share` servent à choisir w, les suivants à évaluer."""
    kicks = rows.drop_duplicates("match_id").sort_values("kickoff")
    n_fit = int(round(len(kicks) * share))
    fit_ids = set(kicks["match_id"].iloc[:n_fit])
    return rows[rows["match_id"].isin(fit_ids)], rows[~rows["match_id"].isin(fit_ids)]


def _two_way(rows: pd.DataFrame) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    pm = np.column_stack([rows["p_model"].to_numpy(float), 1.0 - rows["p_model"].to_numpy(float)])
    ps = np.column_stack([rows["p_wx"].to_numpy(float), 1.0 - rows["p_wx"].to_numpy(float)])
    y = np.where(rows["y"].to_numpy(float) >= 0.5, 0, 1)
    return pm, ps, y


def run_gate_b(rows: pd.DataFrame, min_matches: int = MIN_MATCHES, share: float = SPLIT_SHARE) -> dict:
    """Catégorie B : par famille × compétition (et famille entière), poids choisi sur la première partie chronologique,
    gain, porte de calibration par bande et ECE sur la seconde ; verdict."""
    if rows.empty:
        return {"season": ARCHIVE_SEASON, "split": share, "segments": []}
    fit, test = split_chronological(rows, share)
    segments = []
    for family in B_FAMILIES:
        comps = [None] + sorted(rows["competition"].unique())
        for comp in comps:
            f = fit[(fit["family"] == family) & ((fit["competition"] == comp) if comp else True)]
            t = test[(test["family"] == family) & ((test["competition"] == comp) if comp else True)]
            nf, nt = f["match_id"].nunique(), t["match_id"].nunique()
            seg = {"category": "B", "family": family, "competition": comp or "toutes", "reference": "winamax", "validationMatches": int(nf), "testMatches": int(nt),
                   "validationRows": int(len(f)), "testRows": int(len(t))}
            if nf < min_matches or nt < min_matches:
                seg.update({"weight": 0.0, "verdict": "trop_peu_de_matchs"})
                segments.append(seg); continue
            pmv, psv, yv = _two_way(f)
            pmt, pst, yt = _two_way(t)
            w, scores = fit_weight(pmv, psv, yv)
            pool_t = pool_matrix(pmt, pst, w)[:, 0]
            seg["weight"] = w
            seg["validationLogLossByWeight"] = {str(k): round(s, 5) for k, s in scores.items()}
            seg["test"] = evaluate(pmt, pst, yt, w)
            seg["ece"] = round(expected_calibration_error(pool_t, t["y"].to_numpy(float)), 4)
            seg["eceModelAlone"] = round(expected_calibration_error(t["p_model"].to_numpy(float), t["y"].to_numpy(float)), 4)
            seg["band"] = band_gate(pool_t, t["y"].to_numpy(float), t["odds_high"].to_numpy(float), t["odds_low"].to_numpy(float), family)
            seg["bandModelAlone"] = band_gate(t["p_model"].to_numpy(float), t["y"].to_numpy(float), t["odds_high"].to_numpy(float), t["odds_low"].to_numpy(float), family)
            if w == 0.0:
                seg["verdict"] = "poids_nul"
            elif seg["test"]["gainLow"] <= 0:
                seg["verdict"] = "gain_non_significatif"
            elif not seg["band"]["passed"]:
                seg["verdict"] = "biais_directionnel"
            else:
                seg["verdict"] = "valide"
            segments.append(seg)
    return {"season": ARCHIVE_SEASON, "split": share, "segments": segments}


def load_rows_b(season: str = ARCHIVE_SEASON, n_sims: int = N_SIMS) -> pd.DataFrame:
    """Lignes de la catégorie B sur l'archive Winamax : matchs joués de la saison avec prévision figée et rencontre appariée."""
    from .product import load_catalogue
    df = matches_with_predictions([season])
    matched = pd.read_parquet(RESEARCH / "matches.parquet")[["match_id", "fixture_id"]]
    df = df.merge(matched, on="match_id", how="inner")
    if df.empty:
        return pd.DataFrame()
    cols = ["fixture_id", "bookmaker", "market_id", "outcome_id", "player_id", "created_at", "price"]
    frames = [pd.read_parquet(p, columns=cols) for c in COMPETITIONS for p in sorted((RESEARCH / "odds" / c).glob(f"{season}.parquet"))]
    snaps = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame(columns=cols)
    snaps = snaps[snaps["fixture_id"].isin(df["fixture_id"])]
    return build_rows_b(df, snaps, load_catalogue(), frozen_variant(), n_sims)


# ----- catégorie C : issues multiples, référence = fréquence de base -----

def c_outcome(family: str, h: int, a: int) -> int:
    """Indice de l'issue réalisée dans la grille de la famille (bornée)."""
    if family == "score exact":
        return min(h, SCORE_CAP) * (SCORE_CAP + 1) + min(a, SCORE_CAP)
    if family == "marge de victoire":
        return int(np.clip(h - a, -MARGIN_CAP, MARGIN_CAP) + MARGIN_CAP)
    return min(h + a, TOTAL_CAP)


def c_model_probs(matrix: np.ndarray, family: str) -> np.ndarray:
    """Probabilités du modèle sur la grille de la famille, à partir de la loi conjointe du score."""
    n = matrix.shape[0]
    h, a = np.meshgrid(np.arange(n), np.arange(n), indexing="ij")
    if family == "score exact":
        k = (SCORE_CAP + 1) ** 2
        idx = np.minimum(h, SCORE_CAP) * (SCORE_CAP + 1) + np.minimum(a, SCORE_CAP)
    elif family == "marge de victoire":
        k = 2 * MARGIN_CAP + 1
        idx = np.clip(h - a, -MARGIN_CAP, MARGIN_CAP) + MARGIN_CAP
    else:
        k = TOTAL_CAP + 1
        idx = np.minimum(h + a, TOTAL_CAP)
    out = np.zeros(k)
    np.add.at(out, idx.ravel(), matrix.ravel())
    return out / out.sum()


def build_rows_c(matches: pd.DataFrame, variant: sm.Variant) -> dict[str, dict]:
    """Par famille : matrices (matchs × issues) des probabilités du modèle et indice de l'issue réalisée."""
    out = {fam: {"pm": [], "y": [], "competition": [], "season": []} for fam in C_FAMILIES}
    for m in matches.itertuples(index=False):
        matrix = sm.score_matrix(float(m.expected_goals_home), float(m.expected_goals_away), variant)
        for fam in C_FAMILIES:
            out[fam]["pm"].append(c_model_probs(matrix, fam)); out[fam]["y"].append(c_outcome(fam, int(m.ft_home), int(m.ft_away)))
            out[fam]["competition"].append(m.competition); out[fam]["season"].append(m.season)
    return {fam: {"pm": np.array(v["pm"]), "y": np.array(v["y"]), "competition": np.array(v["competition"]), "season": np.array(v["season"])} for fam, v in out.items()}


def base_rate(y: np.ndarray, k: int, prior: float = 1.0) -> np.ndarray:
    """Fréquence de base lissée (Laplace) des issues."""
    counts = np.bincount(y, minlength=k).astype(float) + prior
    return counts / counts.sum()


def run_gate_c(data: dict[str, dict], validation: str = VALIDATION_SEASON, test: str = TEST_SEASON, min_matches: int = MIN_MATCHES) -> dict:
    """Catégorie C : pool du modèle avec la fréquence de base de la saison de validation (par compétition, sinon
    toutes compétitions), poids choisi en validation, gain et ECE en test."""
    segments = []
    for fam, d in data.items():
        comps = [None] + sorted(set(d["competition"]))
        for comp in comps:
            sel_c = np.ones(len(d["y"]), bool) if comp is None else d["competition"] == comp
            v = sel_c & (d["season"] == validation); t = sel_c & (d["season"] == test)
            seg = {"category": "C", "family": fam, "competition": comp or "toutes", "reference": "base_rate", "validationMatches": int(v.sum()), "testMatches": int(t.sum())}
            if v.sum() < min_matches or t.sum() < min_matches:
                seg.update({"weight": 0.0, "verdict": "trop_peu_de_matchs"})
                segments.append(seg); continue
            k = d["pm"].shape[1]
            base = base_rate(d["y"][v], k)
            psv = np.tile(base, (int(v.sum()), 1)); pst = np.tile(base, (int(t.sum()), 1))
            w, scores = fit_weight(d["pm"][v], psv, d["y"][v])
            seg["weight"] = w
            seg["validationLogLossByWeight"] = {str(kk): round(s, 5) for kk, s in scores.items()}
            seg["test"] = evaluate(d["pm"][t], pst, d["y"][t], w)
            seg["ece"] = round(_ece_multi(pool_matrix(d["pm"][t], pst, w), d["y"][t]), 4)
            seg["verdict"] = "poids_nul" if w == 0.0 else "valide" if seg["test"]["gainLow"] > 0 else "gain_non_significatif"
            segments.append(seg)
    return {"validationSeason": validation, "testSeason": test, "segments": segments}


# ----- assemblage -----

def assemble(a: dict, b: dict, c: dict) -> dict:
    """Rapport complet et tables du produit : poids, marges (ECE) et référence des seuls segments validés (jamais la
    ligne « toutes » d'une catégorie A ; pour B la ligne « toutes » s'écrit sous la clé de la famille seule, que
    `PoolWeights` lit comme repli pour toutes les compétitions)."""
    weights, margins, references = {}, {}, {}
    for seg in a["segments"] + b["segments"] + c["segments"]:
        if seg["verdict"] != "valide" or seg["category"] == "C":
            continue
        if seg["category"] == "A" and seg["competition"] == "toutes":
            continue
        key = seg["family"] if seg["competition"] == "toutes" else f"{seg['family']}|{seg['competition']}"
        weights[key] = seg["weight"]; margins[key] = seg.get("ece", 0.0); references[key] = seg["reference"]
    return {"generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"), "confidence": CONFIDENCE, "grid": WEIGHT_GRID, "devig": "shin",
            "minMatches": MIN_MATCHES, "categoryA": a, "categoryB": b, "categoryC": c, "weights": weights, "margins": margins, "references": references}


def write_weights(report: dict, path=POOL_WEIGHTS) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"generatedAt": report["generatedAt"], "weights": report["weights"], "margins": report["margins"], "references": report["references"]},
                               ensure_ascii=False, indent=1), encoding="utf-8")


def summary_lines(report: dict) -> list[str]:
    out = []
    for cat, title in (("categoryA", "Catégorie A (clôture Pinnacle, Shin)"), ("categoryB", "Catégorie B (Winamax dé-vigué, Shin, archive 2026-27, 60 / 40 chronologique)"),
                       ("categoryC", "Catégorie C (fréquence de base)")):
        block = report.get(cat) or {}
        out.append(f"{title} :")
        for s in block.get("segments", []):
            t = s.get("test")
            line = f"  {s['family']:22s} {s['competition']:7s} n={s['validationMatches']}/{s['testMatches']:<5} w={s['weight']:.2f}"
            if t:
                line += f" gain={t['gain']:+.5f} [{t['gainLow']:+.5f}; {t['gainHigh']:+.5f}] ece={s.get('ece', 0):.3f}"
            band = s.get("band")
            if band:
                sides = band["sides"]
                line += " | sélections haut/bas " + "/".join(str(sides[k]["selections"]) for k in ("haut", "bas"))
                if band["judged"]:
                    line += " " + ", ".join(f"{k}:{sides[k].get('verdict', '-')}" for k in ("haut", "bas") if sides[k].get("judged"))
            out.append(line + f"  → {s['verdict']}")
    out.append(f"Segments validés : {len(report['weights'])} ({', '.join(f'{k} w={v} ece={report['margins'][k]:.3f}' for k, v in report['weights'].items()) or 'aucun'})")
    return out


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--validation", default=VALIDATION_SEASON)
    parser.add_argument("--test", default=TEST_SEASON)
    parser.add_argument("--write", action="store_true", help="écrit pool_weights.json (segments validés seulement)")
    parser.add_argument("--skip-b", action="store_true", help="sans la catégorie B (archive Winamax absente)")
    args = parser.parse_args(argv)
    d = shin_columns(load_closing())
    d = model_columns(d, [args.validation, args.test])
    a = run_gate(d, args.validation, args.test)
    rows_b = pd.DataFrame() if args.skip_b else load_rows_b()
    b = run_gate_b(rows_b)
    variant = frozen_variant()
    c = run_gate_c(build_rows_c(matches_with_predictions([args.validation, args.test]), variant), args.validation, args.test)
    report = assemble(a, b, c)
    PHASE2.mkdir(parents=True, exist_ok=True)
    GATE_REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    print("\n".join(summary_lines(report)))
    if args.write:
        write_weights(report)
        print(f"{POOL_WEIGHTS} écrit ({len(report['weights'])} segment(s))")
    return 0


if __name__ == "__main__":
    sys.exit(main())
