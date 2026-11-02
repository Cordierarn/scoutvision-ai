"""
Scoring prédictif, à partir des prédictions stockées (jamais en rappelant un modèle) : les résultats
sont joints ici seulement. Population commune = matchs prévus par tous les modèles comparés, utilisables
pour un modèle, avec résultat. Mesures : log-loss, RPS, Brier multiclasse, ECE (10 classes, moyenne des
trois issues), exactitude en annexe ; plus / moins 2,5 pour les modèles de buts. Décompositions : saison,
compétition, tiers de saison, classe de probabilité, favori domicile / extérieur. Bootstrap apparié par
bloc (date × compétition), 2 000 tirages : différence moyenne, IC 90 %, P(A meilleur que B).
Aucun ROI, aucun edge, aucun pari.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from forecast_models.base import OUTCOME_INDEX, PROB_COLUMNS

BOOT = 2000
SEED = 7
BINS = np.linspace(0, 1, 11)


def log_loss(p: np.ndarray, y: np.ndarray) -> np.ndarray:
    return -np.log(np.clip(p[np.arange(len(p)), y], 1e-12, None))


def rps(p: np.ndarray, y: np.ndarray) -> np.ndarray:
    cum = np.cumsum(p, axis=1)[:, :2]
    obs = np.cumsum(np.eye(3)[y], axis=1)[:, :2]
    return ((cum - obs) ** 2).sum(axis=1) / 2


def brier(p: np.ndarray, y: np.ndarray) -> np.ndarray:
    return ((p - np.eye(3)[y]) ** 2).sum(axis=1)


def calibration(prob: np.ndarray, hit: np.ndarray) -> dict:
    """10 classes : effectifs, probabilité moyenne, fréquence observée ; ECE pondéré."""
    bins = []
    idx = np.clip(np.digitize(prob, BINS[1:-1]), 0, 9)
    for b in range(10):
        m = idx == b
        if m.sum():
            bins.append({"lo": round(float(BINS[b]), 1), "hi": round(float(BINS[b + 1]), 1), "n": int(m.sum()),
                         "meanProbability": round(float(prob[m].mean()), 4), "observedFrequency": round(float(hit[m].mean()), 4)})
    ece = sum(abs(b["meanProbability"] - b["observedFrequency"]) * b["n"] for b in bins) / max(len(prob), 1)
    return {"ece": round(float(ece), 4), "bins": bins}


def summary(p: np.ndarray, y: np.ndarray) -> dict:
    cal = [calibration(p[:, k], (y == k).astype(float)) for k in range(3)]
    return {"matches": int(len(y)), "logLoss": round(float(log_loss(p, y).mean()), 4), "rps": round(float(rps(p, y).mean()), 4),
            "brier": round(float(brier(p, y).mean()), 4), "ece": round(float(np.mean([c["ece"] for c in cal])), 4),
            "accuracy": round(float((p.argmax(axis=1) == y).mean()), 4)}


def ou_summary(p_over: np.ndarray, over: np.ndarray) -> dict:
    q = np.clip(p_over, 1e-12, 1 - 1e-12)
    ll = -(over * np.log(q) + (1 - over) * np.log(1 - q))
    return {"matches": int(len(over)), "logLoss": round(float(ll.mean()), 4), "brier": round(float(((q - over) ** 2).mean()), 4),
            "calibration": calibration(p_over, over), "overRate": round(float(over.mean()), 4)}


def season_third(df: pd.DataFrame) -> pd.Series:
    rank = df.groupby(["competition", "season"])["kickoff_utc"].rank(pct=True)
    return pd.cut(rank, [0, 1 / 3, 2 / 3, 1.0001], labels=["early", "mid", "late"]).astype(str)


def evaluate(preds: dict[str, pd.DataFrame], dataset: pd.DataFrame, model_ids: list[str] | None = None) -> dict:
    """preds : model_id -> prédictions ; population commune aux modèles listés."""
    ids = model_ids or sorted(preds)
    base = dataset[dataset["usable_for_model"] & dataset["result_1x2"].notna()][
        ["match_id", "competition", "season", "kickoff_utc", "match_date", "result_1x2", "over_2_5"]].copy()
    common = set(base["match_id"])
    for m in ids:
        common &= set(preds[m]["match_id"])
    pop = base[base["match_id"].isin(common)].sort_values(["kickoff_utc", "match_id"]).reset_index(drop=True)
    pop["third"] = season_third(pop)
    y = pop["result_1x2"].map(OUTCOME_INDEX).to_numpy(int)
    over = pop["over_2_5"].astype(float).to_numpy()
    res = {"population": int(len(pop)), "models": {}, "byModel": {}}
    P = {}
    for m in ids:
        pr = preds[m].drop_duplicates("match_id").set_index("match_id").reindex(pop["match_id"])
        p = pr[PROB_COLUMNS].to_numpy(float); P[m] = p
        entry = {"overall": summary(p, y), "calibration": {k: calibration(p[:, i], (y == i).astype(float)) for i, k in enumerate(("home", "draw", "away"))},
                 "probabilityHistogram": np.histogram(p.max(axis=1), BINS)[0].astype(int).tolist()}
        for key, col in (("bySeason", "season"), ("byCompetition", "competition"), ("bySeasonThird", "third")):
            entry[key] = {str(k): summary(p[(pop[col] == k).to_numpy()], y[(pop[col] == k).to_numpy()]) for k in sorted(pop[col].unique())}
        fav = np.where(p[:, 0] >= p[:, 2], "home_favourite", "away_favourite")
        entry["byFavourite"] = {k: summary(p[fav == k], y[fav == k]) for k in ("home_favourite", "away_favourite") if (fav == k).any()}
        bucket = np.clip(np.digitize(p.max(axis=1), [0.4, 0.5, 0.6, 0.7]), 0, 4)
        labels = ["<0.4", "0.4-0.5", "0.5-0.6", "0.6-0.7", ">=0.7"]
        entry["byMaxProbability"] = {labels[b]: summary(p[bucket == b], y[bucket == b]) for b in range(5) if (bucket == b).any()}
        if "p_over_2_5" in pr and pr["p_over_2_5"].notna().all():
            entry["overUnder25"] = ou_summary(pr["p_over_2_5"].to_numpy(float), over)
        # couverture propre du modèle : tous ses matchs prévus (pas seulement la population commune)
        own = base.merge(preds[m].drop_duplicates("match_id")[["match_id"] + PROB_COLUMNS], on="match_id")
        entry["ownCoverage"] = {"matches": int(len(own)), **({k: v for k, v in summary(own[PROB_COLUMNS].to_numpy(float), own["result_1x2"].map(OUTCOME_INDEX).to_numpy(int)).items() if k != "matches"} if len(own) else {})}
        res["byModel"][m] = entry
    res["paired"] = paired_bootstrap(P, y, pop)
    return res


def paired_bootstrap(P: dict[str, np.ndarray], y: np.ndarray, pop: pd.DataFrame, draws: int = BOOT) -> list[dict]:
    """Pour chaque paire de modèles, différence de log-loss et de RPS (A − B, négatif = A meilleur) par
    bootstrap de blocs date × compétition."""
    blocks = (pop["match_date"].astype(str) + "|" + pop["competition"]).to_numpy()
    uniq, inv = np.unique(blocks, return_inverse=True)
    nb = len(uniq)
    rng = np.random.default_rng(SEED)
    draws_idx = rng.integers(0, nb, (draws, nb))
    counts = np.bincount(inv, minlength=nb).astype(float)
    ids = sorted(P)
    out = []
    per = {m: {"logLoss": log_loss(P[m], y), "rps": rps(P[m], y)} for m in ids}
    for i, a in enumerate(ids):
        for b in ids[i + 1:]:
            row = {"a": a, "b": b, "matches": int(len(y))}
            for metric in ("logLoss", "rps"):
                d = per[a][metric] - per[b][metric]
                sums = np.bincount(inv, d, minlength=nb)
                boot = (sums[draws_idx].sum(axis=1) / counts[draws_idx].sum(axis=1))
                row[metric] = {"meanDifference": round(float(d.mean()), 5), "ci90": [round(float(np.percentile(boot, 5)), 5), round(float(np.percentile(boot, 95)), 5)],
                               "pABetter": round(float((boot < 0).mean()), 4)}
            out.append(row)
    return out
