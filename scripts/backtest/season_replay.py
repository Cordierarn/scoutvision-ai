"""
Étape 3 : replay historique et simulation de saison à partir des prédictions point-in-time déjà
figées (forecast predictions parquet). Aucun modèle n'est rappelé, aucune feature recalculée.

À une date de replay D : classement reconstruit avec les seuls matchs terminés avant D ; chaque
match restant prend sa prédiction immuable (ajustée la semaine du match, donc avec l'information
disponible juste avant ce match : « connaissance glissante », pas un état du modèle figé à D — limite
documentée) ; 20 000 saisons simulées (graine 7) : issue 1-N-2 tirée des probabilités, 3/1/0, puis les
règles de classement du registre (competition_rules). Politique de différence de buts : score tiré
conditionnellement à l'issue depuis les buts attendus du modèle (Poisson indépendants) quand le modèle en
produit, sinon depuis la distribution empirique des scores de la compétition sur les saisons antérieures ;
l'impact est mesuré contre une politique sans buts. Mode STRICT : la simulation n'existe que si tous les
matchs restants ont une prédiction ; COVERED_ONLY sert au diagnostic seulement.

  cd scripts && python3 -m backtest.season_replay                 # toutes les ligues supportées × 2 saisons × 4 points × 4 modèles (+ marché)
  cd scripts && python3 -m backtest.season_replay --competition ENG --season 2024-25 --date 2025-01-01
"""

from __future__ import annotations

import argparse
import hashlib
import json
import resource
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

from forecast_models.base import OUTCOME_INDEX, PROB_COLUMNS
from . import competition_rules as cr, predictions
from .run_models import GRIDS, OUT, PRED_DIR, RETRO_SEASON, VALIDATION_SEASON

SIMULATION_VERSION = "1.0.0"
N_SIMS = 20000
SEED = 7
MAX_GOALS = 10
REPLAY_POINTS = {"start": 0.0, "q25": 0.25, "q50": 0.5, "q75": 0.75}
MODELS = ["scoutvision_reproduced", "dixon_coles_decay", "elo", "xg_rolling"]
MARKET = "market_closing"
DEFAULT_MODEL = "scoutvision_reproduced"
GOAL_POLICIES = ("model", "empirical", "none")


# ============================================
# SAISON, DATES DE REPLAY, CLASSEMENT JOUÉ
# ============================================

def season_matches(dataset: pd.DataFrame, competition: str, season: str) -> pd.DataFrame:
    m = dataset[(dataset["competition"] == competition) & (dataset["season"] == season) & (dataset["stage"] == "regular_season")]
    return m.sort_values(["kickoff_utc", "match_id"], kind="stable").reset_index(drop=True)


def replay_dates(matches: pd.DataFrame) -> dict[str, pd.Timestamp]:
    """start = premier coup d'envoi ; qXX = coup d'envoi du match à la fraction XX des matchs (joués avant = strictement antérieurs)."""
    kick = matches["kickoff_utc"].to_numpy()
    out = {}
    for label, frac in REPLAY_POINTS.items():
        i = min(int(np.floor(frac * len(kick))), len(kick) - 1)
        out[label] = pd.Timestamp(kick[i])
    return out


def split(matches: pd.DataFrame, date: pd.Timestamp) -> tuple[pd.DataFrame, pd.DataFrame]:
    return matches[matches["kickoff_utc"] < date], matches[matches["kickoff_utc"] >= date]


def played_state(played: pd.DataFrame, teams: list[str], rules: cr.CompetitionRules) -> dict:
    """Points, différence, buts pour et matrices de confrontations directes des matchs terminés."""
    idx = {t: i for i, t in enumerate(teams)}
    T = len(teams)
    pts = np.zeros(T); gf = np.zeros(T); ga = np.zeros(T)
    h2h_pts = np.zeros((T, T)); h2h_gf = np.zeros((T, T))
    for r in played[played["usable_for_standings"]].itertuples(index=False):
        h, a = idx[r.home_team_id], idx[r.away_team_id]
        hg, ag = int(r.home_goals), int(r.away_goals)
        gf[h] += hg; ga[h] += ag; gf[a] += ag; ga[a] += hg
        h2h_gf[h, a] += hg; h2h_gf[a, h] += ag
        if hg > ag:
            pts[h] += rules.points_win; pts[a] += rules.points_loss; h2h_pts[h, a] += rules.points_win
        elif hg < ag:
            pts[a] += rules.points_win; pts[h] += rules.points_loss; h2h_pts[a, h] += rules.points_win
        else:
            pts[h] += rules.points_draw; pts[a] += rules.points_draw; h2h_pts[h, a] += rules.points_draw; h2h_pts[a, h] += rules.points_draw
    return {"pts": pts, "gd": gf - ga, "gf": gf, "h2h_pts": h2h_pts, "h2h_gf": h2h_gf, "played": int(played["usable_for_standings"].sum())}


# ============================================
# SCORES CONDITIONNELS À L'ISSUE
# ============================================

def _cells(max_goals: int) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    g = np.arange(max_goals + 1)
    hg, ag = np.meshgrid(g, g, indexing="ij")
    hg, ag = hg.ravel(), ag.ravel()
    outcome = np.where(hg > ag, 0, np.where(hg == ag, 1, 2))
    return hg, ag, outcome


def conditional_from_rates(lh: float, la: float, max_goals: int = MAX_GOALS) -> list[tuple[np.ndarray, np.ndarray, np.ndarray]]:
    """Pour chaque issue : (cdf, buts domicile, buts extérieur) des scores compatibles, Poisson indépendants."""
    from math import factorial
    g = np.arange(max_goals + 1)
    f = np.array([factorial(int(i)) for i in g], float)
    ph = np.exp(-lh) * lh ** g / f; pa = np.exp(-la) * la ** g / f
    m = (ph[:, None] * pa[None, :]).ravel()
    hg, ag, outcome = _cells(max_goals)
    out = []
    for o in range(3):
        sel = outcome == o
        p = m[sel]; p = p / p.sum()
        out.append((np.cumsum(p), hg[sel], ag[sel]))
    return out


def empirical_conditional(dataset: pd.DataFrame, competition: str, before: pd.Timestamp, max_goals: int = 8) -> list[tuple[np.ndarray, np.ndarray, np.ndarray]] | None:
    """Distribution des scores de la compétition par issue, matchs antérieurs à `before` seulement."""
    m = dataset[(dataset["competition"] == competition) & (dataset["kickoff_utc"] < before) & dataset["usable_for_model"]]
    if len(m) < 200:
        return None
    hg = m["home_goals"].clip(upper=max_goals).to_numpy(int); ag = m["away_goals"].clip(upper=max_goals).to_numpy(int)
    out = []
    for o, sel in ((0, hg > ag), (1, hg == ag), (2, hg < ag)):
        counts = np.zeros((max_goals + 1, max_goals + 1))
        np.add.at(counts, (hg[sel], ag[sel]), 1)
        cells_h, cells_a, outcome = _cells(max_goals)
        comp = outcome == o
        p = counts.ravel()[comp] + 0.5          # lissage : chaque score compatible garde une masse minimale
        p = p / p.sum()
        out.append((np.cumsum(p), cells_h[comp], cells_a[comp]))
    return out


def sample_scores(outcome: np.ndarray, cond: list, rng: np.random.Generator) -> tuple[np.ndarray, np.ndarray]:
    """Score tiré pour chaque simulation conditionnellement à l'issue déjà tirée."""
    u = rng.random(len(outcome))
    hg = np.zeros(len(outcome), int); ag = np.zeros(len(outcome), int)
    for o in range(3):
        sel = outcome == o
        if sel.any():
            cdf, h, a = cond[o]
            k = np.minimum(np.searchsorted(cdf, u[sel], side="right"), len(cdf) - 1)
            hg[sel] = h[k]; ag[sel] = a[k]
    return hg, ag


# ============================================
# CLASSEMENT (règles du registre)
# ============================================

def rank_tables(pts: np.ndarray, gd: np.ndarray, gf: np.ndarray, h2h_pts: np.ndarray | None, h2h_gf: np.ndarray | None,
                rules: cr.CompetitionRules) -> tuple[np.ndarray, np.ndarray]:
    """Rangs (1 = premier) de chaque équipe dans chaque simulation, et indicateur par simulation d'un
    départage approximatif (égalité non résolue par les critères reproductibles, ou groupe de 3+ à égalité
    de points dans une ligue à confrontation directe prioritaire)."""
    S, T = pts.shape
    key = pts.astype(np.int64) * 1_000_000 + (gd.astype(np.int64) + 1000) * 1000 + gf.astype(np.int64)
    order = np.argsort(-key, axis=1, kind="stable")
    sorted_key = np.take_along_axis(key, order, axis=1)
    sorted_pts = np.take_along_axis(pts, order, axis=1)
    approx = np.zeros(S, bool)
    h2h_first = cr.uses_head_to_head_first(rules)
    uses_h2h = cr.HEAD_TO_HEAD_POINTS in rules.tiebreaks and h2h_pts is not None
    if uses_h2h:
        sim = np.arange(S)[:, None]
        tie_pts = sorted_pts[:, :-1] == sorted_pts[:, 1:]                      # égalité de points entre voisins
        prev_tie = np.concatenate([np.zeros((S, 1), bool), tie_pts[:, :-1]], axis=1)
        next_tie = np.concatenate([tie_pts[:, 1:], np.zeros((S, 1), bool)], axis=1)
        isolated = tie_pts & ~prev_tie & ~next_tie                               # paires isolées
        groups3 = tie_pts & (prev_tie | next_tie)
        if h2h_first:
            approx |= groups3.any(axis=1)
            consider = isolated
        else:
            # confrontation directe seulement après différence et buts : paires à clé complète égale
            tie_key = sorted_key[:, :-1] == sorted_key[:, 1:]
            consider = isolated & tie_key
            approx |= (tie_key & ~isolated).any(axis=1)
        if consider.any():
            s_idx, p_idx = np.nonzero(consider)
            i = order[s_idx, p_idx]; j = order[s_idx, p_idx + 1]
            d = h2h_pts[s_idx, i, j] - h2h_pts[s_idx, j, i]
            if cr.HEAD_TO_HEAD_GD in rules.tiebreaks:
                gd_h2h = (h2h_gf[s_idx, i, j] - h2h_gf[s_idx, j, i]) - (h2h_gf[s_idx, j, i] - h2h_gf[s_idx, i, j])
                d = np.where(d == 0, gd_h2h, d)
            if h2h_first:
                # égalité en confrontation directe : la différence de buts générale (déjà dans l'ordre) tranche
                k_i, k_j = key[s_idx, i], key[s_idx, j]
                d = np.where(d == 0, k_i - k_j, d)
                unresolved = d == 0
            else:
                unresolved = d == 0
            approx[s_idx[unresolved]] = True
            swap = d < 0
            if swap.any():
                order[s_idx[swap], p_idx[swap]] = j[swap]; order[s_idx[swap], p_idx[swap] + 1] = i[swap]
    else:
        tie_key = sorted_key[:, :-1] == sorted_key[:, 1:]
        approx |= tie_key.any(axis=1)
    ranks = np.empty((S, T), int)
    np.put_along_axis(ranks, order, np.tile(np.arange(1, T + 1), (S, 1)), axis=1)
    return ranks, approx


# ============================================
# SIMULATION
# ============================================

def simulate(state: dict, remaining: pd.DataFrame, probs: np.ndarray, teams: list[str], rules: cr.CompetitionRules,
             conditional: list | None, n_sims: int = N_SIMS, seed: int = SEED, goal_policy: str = "model") -> dict:
    """probs : (M, 3) probabilités 1-N-2 des matchs restants ; conditional : liste par match (politique model)
    ou distribution unique (politique empirical) ou None (politique none)."""
    rng = np.random.default_rng(seed)
    idx = {t: i for i, t in enumerate(teams)}
    T, M = len(teams), len(remaining)
    hi = remaining["home_team_id"].map(idx).to_numpy(); ai = remaining["away_team_id"].map(idx).to_numpy()
    u = rng.random((n_sims, M))
    cum = np.cumsum(probs, axis=1)
    outcome = np.where(u < cum[:, 0], 0, np.where(u < cum[:, 1], 1, 2)).astype(np.int8)
    pts = np.tile(state["pts"], (n_sims, 1)); gf = np.tile(state["gf"], (n_sims, 1)); gd = np.tile(state["gd"], (n_sims, 1))
    uses_h2h = cr.HEAD_TO_HEAD_POINTS in rules.tiebreaks
    h2h_pts = np.tile(state["h2h_pts"], (n_sims, 1, 1)).astype(np.float32) if uses_h2h else None
    h2h_gf = np.tile(state["h2h_gf"], (n_sims, 1, 1)).astype(np.float32) if uses_h2h else None
    sim = np.arange(n_sims)
    for m in range(M):
        o = outcome[:, m]
        ph = np.where(o == 0, rules.points_win, np.where(o == 1, rules.points_draw, rules.points_loss))
        pa = np.where(o == 2, rules.points_win, np.where(o == 1, rules.points_draw, rules.points_loss))
        pts[:, hi[m]] += ph; pts[:, ai[m]] += pa
        if goal_policy == "none":
            hg = ag = None
        else:
            cond = conditional[m] if goal_policy == "model" else conditional
            hg, ag = sample_scores(o, cond, rng)
            gf[:, hi[m]] += hg; gf[:, ai[m]] += ag
            gd[:, hi[m]] += hg - ag; gd[:, ai[m]] += ag - hg
        if uses_h2h:
            h2h_pts[sim, hi[m], ai[m]] += ph; h2h_pts[sim, ai[m], hi[m]] += pa
            if hg is not None:
                h2h_gf[sim, hi[m], ai[m]] += hg; h2h_gf[sim, ai[m], hi[m]] += ag
    ranks, approx = rank_tables(pts, gd, gf, h2h_pts, h2h_gf, rules)
    return {"ranks": ranks, "points": pts, "approximate_share": float(approx.mean()), "n_sims": n_sims, "seed": seed, "goal_policy": goal_policy}


def summarise(sim: dict, teams: list[str], names: dict[str, str], rules: cr.CompetitionRules) -> dict:
    ranks, pts = sim["ranks"], sim["points"]
    S, T = ranks.shape
    out = {}
    for i, t in enumerate(teams):
        dist = np.bincount(ranks[:, i], minlength=T + 1)[1:] / S
        r = ranks[:, i]; p = pts[:, i]
        entry = {"team_id": t, "team": names.get(t, t),
                 "rank": {"mean": round(float(r.mean()), 3), "median": float(np.median(r)), "p5": float(np.percentile(r, 5)), "p25": float(np.percentile(r, 25)),
                          "p75": float(np.percentile(r, 75)), "p95": float(np.percentile(r, 95))},
                 "points": {"mean": round(float(p.mean()), 2), "median": float(np.median(p)), "p10": float(np.percentile(p, 10)), "p90": float(np.percentile(p, 90))},
                 "rankingDistribution": [round(float(x), 5) for x in dist],
                 "objectives": {k: round(float(((r >= v["positions"][0]) & (r <= v["positions"][1])).mean()), 4) for k, v in rules.objectives().items()}}
        out[t] = entry
    return out


# ============================================
# RÉEL ET VALIDATION
# ============================================

def actual_final(matches: pd.DataFrame, teams: list[str], rules: cr.CompetitionRules) -> dict:
    state = played_state(matches, teams, rules)
    h2h_pts = state["h2h_pts"][None] if cr.HEAD_TO_HEAD_POINTS in rules.tiebreaks else None
    h2h_gf = state["h2h_gf"][None] if h2h_pts is not None else None
    ranks, approx = rank_tables(state["pts"][None], state["gd"][None], state["gf"][None], h2h_pts, h2h_gf, rules)
    return {t: {"rank": int(ranks[0, i]), "points": float(state["pts"][i])} for i, t in enumerate(teams)} | {"_approximate": bool(approx[0]), "_played": state["played"]}


def _spearman(a: np.ndarray, b: np.ndarray) -> float:
    ra = pd.Series(a).rank().to_numpy(); rb = pd.Series(b).rank().to_numpy()
    return float(np.corrcoef(ra, rb)[0, 1]) if len(a) > 2 else float("nan")


def validate(summary: dict, actual: dict, rules: cr.CompetitionRules) -> dict:
    teams = [t for t in summary]
    mean_pts = np.array([summary[t]["points"]["mean"] for t in teams]); act_pts = np.array([actual[t]["points"] for t in teams])
    mean_rank = np.array([summary[t]["rank"]["mean"] for t in teams]); act_rank = np.array([actual[t]["rank"] for t in teams])
    p10 = np.array([summary[t]["points"]["p10"] for t in teams]); p90 = np.array([summary[t]["points"]["p90"] for t in teams])
    obj = rules.objectives()
    res = {"maePoints": round(float(np.abs(mean_pts - act_pts).mean()), 3), "maeRank": round(float(np.abs(mean_rank - act_rank).mean()), 3),
           "spearman": round(_spearman(mean_rank, act_rank), 4),
           "pointsInterval80Coverage": round(float(((act_pts >= p10) & (act_pts <= p90)).mean()), 4),
           "rankLogScore": round(float(np.mean([-np.log(max(summary[t]["rankingDistribution"][actual[t]["rank"] - 1], 1e-6)) for t in teams])), 4)}
    title = [t for t in teams if actual[t]["rank"] == 1]
    if title and "title" in obj:
        best = max(teams, key=lambda t: summary[t]["objectives"]["title"])
        res["top1Hit"] = bool(best == title[0]); res["championProbability"] = summary[title[0]]["objectives"]["title"]
    for key in ("continental", "promotion", "relegation"):
        if key in obj:
            lo, hi = obj[key]["positions"]
            y = np.array([1.0 if lo <= actual[t]["rank"] <= hi else 0.0 for t in teams]); p = np.array([summary[t]["objectives"][key] for t in teams])
            res[f"{key}Brier"] = round(float(((p - y) ** 2).mean()), 4)
    return res


# ============================================
# ORCHESTRATION
# ============================================

def prediction_lookup(season: str, selection: dict, model: str, market: pd.DataFrame | None) -> pd.DataFrame | None:
    """Prédictions figées d'un modèle (ou probabilités de clôture du marché), indexées par match_id."""
    if model == MARKET:
        if market is None:
            return None
        cols = [f"mkt_market_closing_pinnacle_p_{n}" for n in ("home", "draw", "away")]
        m = market[market["season"] == season][["match_id"] + cols + ["mkt_closing_source"]].dropna(subset=cols)
        m = m.rename(columns=dict(zip(cols, PROB_COLUMNS))).assign(model_id=MARKET, model_version="closing", fitted_at=pd.NaT, prediction_created_at=None,
                                                                   expected_goals_home=np.nan, expected_goals_away=np.nan)
        return m.set_index("match_id")
    preds = predictions.read(PRED_DIR / f"{season}.parquet")
    block = preds[preds["model_id"] == model]
    if model in GRIDS and selection and model in selection:
        block = block[block["parameters_hash"] == selection[model]["parameters_hash"]]
    return block.drop_duplicates("match_id").set_index("match_id") if len(block) else None


def run_replay(dataset: pd.DataFrame, competition: str, season: str, date: pd.Timestamp, label: str, model: str, lookup: pd.DataFrame | None,
               n_sims: int = N_SIMS, seed: int = SEED, mode: str = "strict", goal_policy: str | None = None) -> dict:
    rules = cr.RULES[competition]
    matches = season_matches(dataset, competition, season)
    teams = sorted(set(matches["home_team_id"]) | set(matches["away_team_id"]))
    names = {**dict(zip(matches["home_team_id"], matches["home_team_name"])), **dict(zip(matches["away_team_id"], matches["away_team_name"]))}
    played, remaining = split(matches, date)
    base = {"competition": competition, "season": season, "replayPoint": label, "replayDate": date.isoformat(), "model": model,
            "teams": len(teams), "played": int(len(played)), "remaining": int(len(remaining)), "rules": {"tiebreaks": list(rules.tiebreaks), "exact": rules.exact,
            "approximations": list(rules.approximations), "objectives": rules.objectives()}}
    if len(teams) != rules.teams or len(matches) != rules.matches:
        return {**base, "status": "format_mismatch", "note": f"{len(teams)} équipes, {len(matches)} matchs : règle {rules.teams} / {rules.matches}"}
    if lookup is None:
        return {**base, "status": "no_predictions"}
    covered = remaining["match_id"].isin(lookup.index)
    base["coverage"] = {"covered": int(covered.sum()), "remaining": int(len(remaining)), "share": round(float(covered.mean()), 4) if len(remaining) else 1.0}
    if mode == "strict" and not covered.all():
        return {**base, "status": "insufficient_coverage", "missing": remaining.loc[~covered, "match_id"].tolist()[:20]}
    rem = remaining[covered] if mode != "strict" else remaining
    pr = lookup.reindex(rem["match_id"])
    probs = pr[PROB_COLUMNS].to_numpy(float)
    has_goals = pr[["expected_goals_home", "expected_goals_away"]].notna().all(axis=None) and len(rem) > 0
    policy = goal_policy or ("model" if has_goals else "empirical")
    if policy == "model" and not has_goals:
        policy = "empirical"
    conditional = None
    if policy == "model":
        conditional = [conditional_from_rates(float(h), float(a)) for h, a in zip(pr["expected_goals_home"], pr["expected_goals_away"])]
    elif policy == "empirical":
        conditional = empirical_conditional(dataset, competition, matches["kickoff_utc"].min())
        if conditional is None:
            policy = "none"
    state = played_state(played, teams, rules)
    t0 = time.time()
    sim = simulate(state, rem, probs, teams, rules, conditional, n_sims, seed, policy)
    summary = summarise(sim, teams, names, rules)
    # situation réelle à la date de replay (classement des matchs terminés)
    cur_ranks, _ = rank_tables(state["pts"][None], state["gd"][None], state["gf"][None],
                               state["h2h_pts"][None] if cr.HEAD_TO_HEAD_POINTS in rules.tiebreaks else None,
                               state["h2h_gf"][None] if cr.HEAD_TO_HEAD_POINTS in rules.tiebreaks else None, rules)
    for i, t in enumerate(teams):
        summary[t]["current"] = {"points": float(state["pts"][i]), "rank": int(cur_ranks[0, i]), "goalDifference": float(state["gd"][i])}
    actual = actual_final(matches, teams, rules)
    fitted = pd.to_datetime(pr["fitted_at"], errors="coerce") if "fitted_at" in pr else pd.Series(dtype="datetime64[ns]")
    return {**base, "status": "ok", "mode": mode, "nSims": n_sims, "seed": seed, "goalPolicy": policy,
            "approximateTiebreakShare": round(sim["approximate_share"], 4), "approximateTiebreakLabel": "Classement simulé avec départage approximatif" if sim["approximate_share"] > 0 or not rules.exact else None,
            "predictions": {"model_id": str(pr["model_id"].iloc[0]) if len(pr) else model, "model_version": str(pr["model_version"].iloc[0]) if len(pr) else None,
                            "fittedAtMin": fitted.min().isoformat() if fitted.notna().any() else None, "fittedAtMax": fitted.max().isoformat() if fitted.notna().any() else None,
                            "createdAt": sorted({str(x) for x in pr.get("prediction_created_at", pd.Series(dtype=object)).dropna().unique()})[:3],
                            "knowledge": "glissante : chaque match restant utilise la prédiction ajustée la semaine de ce match"},
            "teams_summary": summary, "actualFinal": {t: v for t, v in actual.items() if not t.startswith("_")},
            "actualApproximateTiebreak": actual["_approximate"], "errors": validate(summary, actual, rules), "seconds": round(time.time() - t0, 2)}


def result_hash(result: dict) -> str:
    payload = {t: (v["rankingDistribution"], v["points"]) for t, v in result.get("teams_summary", {}).items()}
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()[:16]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--competition"); parser.add_argument("--season"); parser.add_argument("--date")
    parser.add_argument("--models", default=",".join(MODELS + [MARKET]))
    parser.add_argument("--n-sims", type=int, default=N_SIMS); parser.add_argument("--seed", type=int, default=SEED)
    parser.add_argument("--quick", action="store_true", help="une ligue, deux points de replay")
    args = parser.parse_args()
    t0 = time.time()
    dataset = pd.read_parquet(OUT / "replay_pitchapi.parquet")
    meta = json.loads((OUT / "replay_pitchapi.meta.json").read_text())
    selection = json.loads((OUT / "run_reports.json").read_text()).get("selection", {})
    market = pd.read_parquet(OUT / "replay_market.parquet") if (OUT / "replay_market.parquet").exists() else None
    comps = [args.competition] if args.competition else (["ENG"] if args.quick else cr.supported())
    seasons = [args.season] if args.season else [VALIDATION_SEASON, RETRO_SEASON]
    models = args.models.split(",")
    replays, impact = [], []
    for comp in comps:
        for season in seasons:
            matches = season_matches(dataset, comp, season)
            if matches.empty:
                replays.append({"competition": comp, "season": season, "status": "no_data"}); continue
            dates = {"custom": pd.Timestamp(args.date)} if args.date else replay_dates(matches)
            if args.quick:
                dates = {k: v for k, v in list(dates.items())[:2]}
            for model in models:
                lookup = prediction_lookup(season, selection, model, market)
                for label, date in dates.items():
                    r = run_replay(dataset, comp, season, date, label, model, lookup, args.n_sims, args.seed)
                    r["resultHash"] = result_hash(r)
                    replays.append(r)
                    status = r["status"] if r["status"] != "ok" else f"MAE rang {r['errors']['maeRank']} pts {r['errors']['maePoints']} approx {r['approximateTiebreakShare']} ({r['seconds']}s)"
                    print(f"  {comp} {season} {label:6s} {model:24s} {status}", flush=True)
                    # impact de la politique de différence de buts, au point q50
                    if r["status"] == "ok" and label == "q50" and r["goalPolicy"] != "none":
                        alt = run_replay(dataset, comp, season, date, label, model, lookup, args.n_sims, args.seed, goal_policy="none")
                        d_title = np.mean([abs(r["teams_summary"][t]["objectives"].get("title", 0) - alt["teams_summary"][t]["objectives"].get("title", 0)) for t in r["teams_summary"]])
                        d_rel = np.mean([abs(r["teams_summary"][t]["objectives"].get("relegation", 0) - alt["teams_summary"][t]["objectives"].get("relegation", 0)) for t in r["teams_summary"]])
                        d_rank = np.mean([abs(r["teams_summary"][t]["rank"]["mean"] - alt["teams_summary"][t]["rank"]["mean"]) for t in r["teams_summary"]])
                        impact.append({"competition": comp, "season": season, "model": model, "policy": r["goalPolicy"], "approximateShareNone": alt["approximateTiebreakShare"],
                                       "approximateSharePolicy": r["approximateTiebreakShare"], "meanAbsDeltaTitle": round(float(d_title), 5),
                                       "meanAbsDeltaRelegation": round(float(d_rel), 5), "meanAbsDeltaMeanRank": round(float(d_rank), 4)})
    ok = [r for r in replays if r["status"] == "ok"]
    curve = {}
    for r in ok:
        c = curve.setdefault(r["model"], {}).setdefault(r["replayPoint"], {"n": 0, "maeRank": 0.0, "maePoints": 0.0, "spearman": 0.0, "coverage80": 0.0, "top1": 0})
        c["n"] += 1; c["maeRank"] += r["errors"]["maeRank"]; c["maePoints"] += r["errors"]["maePoints"]; c["spearman"] += r["errors"]["spearman"]
        c["coverage80"] += r["errors"]["pointsInterval80Coverage"]; c["top1"] += int(r["errors"].get("top1Hit", False))
    for m, pts in curve.items():
        for lab, c in pts.items():
            n = c.pop("n"); c.update({k: round(v / n, 4) for k, v in c.items()}); c["replays"] = n
    out = {"generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"), "inputHash": meta["inputHash"], "simulationVersion": SIMULATION_VERSION,
           "nSims": args.n_sims, "seed": args.seed, "defaultModel": DEFAULT_MODEL, "marketLabel": "Référence marché historique",
           "competitions": [{"key": k, **{f: getattr(cr.RULES[k], f) for f in ("name", "teams", "rounds", "points_win", "points_draw", "tiebreaks", "approximations")},
                             "objectives": cr.RULES[k].objectives(), "exact": cr.RULES[k].exact} for k in comps],
           "unsupported": cr.UNSUPPORTED, "seasons": seasons, "replayPoints": list(REPLAY_POINTS), "models": models,
           "replays": replays, "evolution": curve, "goalPolicyImpact": impact,
           "limits": ["connaissance glissante : la prédiction de chaque match restant est celle ajustée la semaine du match, pas un état du modèle figé à la date de replay",
                      "barrages, matchs d'appui et déductions de points non modélisés", "confrontation directe appliquée aux égalités à deux équipes",
                      "mode strict : aucune simulation quand un match restant n'a pas de prédiction"],
           "performance": {"totalSeconds": round(time.time() - t0, 1), "peakMemoryMb": round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024),
                           "replays": len(replays), "ok": len(ok)}}
    path = OUT / "season_replays.json"
    path.write_text(json.dumps(out, indent=1, ensure_ascii=False, default=str), encoding="utf-8")
    print(f"season_replays.json : {len(ok)}/{len(replays)} replays simulés, {out['performance']['totalSeconds']}s, pic {out['performance']['peakMemoryMb']} Mo, {path.stat().st_size / 1e6:.1f} Mo")
    return 0


if __name__ == "__main__":
    sys.exit(main())
