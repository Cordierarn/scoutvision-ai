"""
Étape 2B : benchmark marché réel sur les prédictions déjà figées (aucun modèle rappelé, aucun
hyperparamètre rouvert). Question : les modèles sportifs contiennent-ils une information prédictive
supplémentaire par rapport au marché ? Aucun ROI, aucune mise, aucun pari.

  cd scripts && python3 -m backtest.market_benchmark            # lit .research/forecast/odds_raw/, écrit replay_market.parquet,
                                                                 # odds_ingestion_manifest.json, join_quality.json, backtests.json (bloc marketBenchmark)
  cd scripts && python3 -m backtest.market_benchmark --audit-only

Benchmarks : market_snapshot_avg (moyenne disponible), market_snapshot_pinnacle, market_closing_pinnacle
(référence ; repli market_closing_avg enregistré par ligne). De-vig power en principal, proportionnel en
sensibilité. Pool logarithmique p ∝ p_model^w · p_market^(1−w), w choisi sur 2024-25 seulement puis figé
sur 2025-26. Buckets de divergence |p_model − p_market|. Direction snapshot → clôture (descriptif).
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

from forecast_models.base import OUTCOME_INDEX, PROB_COLUMNS
from . import SCHEMA_VERSION, odds as odds_mod, predictions, registry, scoring
from .run_models import GRIDS, OUT, PRED_DIR, RETRO_SEASON, VALIDATION_SEASON, RETRO_LABEL

ODDS_RAW = OUT / "odds_raw"
SEASONS = ["2021-22", "2022-23", "2023-24", "2024-25", "2025-26", "2026-27"]
SPORT_MODELS = ["scoutvision_reproduced", "dixon_coles_decay", "elo", "xg_rolling"]
OU_MODELS = ["poisson", "dixon_coles", "dixon_coles_decay", "xg_rolling"]
BENCHMARKS = {"market_snapshot_avg": ("odds_avg_snapshot", None), "market_snapshot_pinnacle": ("odds_ps_snapshot", None),
              "market_closing_pinnacle": ("odds_ps_closing", "odds_avg_closing")}      # (colonne, repli)
REFERENCE = "market_closing_pinnacle"
POOL_GRID = [round(w, 2) for w in np.arange(0, 1.001, 0.1)]
BIG5 = ["ENG", "ESP", "ITA", "GER", "FRA"]
DIVERGENCE_EDGES = [0, 0.02, 0.05, 0.10, 0.15, 1.01]
DIVERGENCE_LABELS = ["0-2", "2-5", "5-10", "10-15", "15+"]
DEVIG_METHOD = "power"


# ============================================
# DATASET MARCHÉ
# ============================================

def build_market_dataset(dataset: pd.DataFrame, odds_dir: Path) -> tuple[pd.DataFrame, dict]:
    """Jointure classée des cotes réelles aux lignes du dataset, probabilités de marché (brutes, surcote,
    de-vig), repli de clôture enregistré ; rapport d'ingestion et de qualité de jointure."""
    audit = odds_mod.audit_directory(odds_dir, SEASONS)
    odds, files = odds_mod.load_directory(odds_dir, SEASONS)
    if odds.empty:
        raise FileNotFoundError(f"aucun CSV football-data dans {odds_dir}")
    mapping, votes = odds_mod.map_teams(odds, dataset)
    match_status, odds_status = odds_mod.classify_join(dataset, odds, mapping)
    df = odds_mod.attach(dataset, odds, match_status)
    # probabilités de marché par benchmark
    df["mkt_closing_source"] = None
    for bench, (col, fallback) in BENCHMARKS.items():
        names = ("home", "draw", "away")
        o = df[[f"{col}_{n}" for n in names]].to_numpy(float, copy=True)
        source = np.where(np.isfinite(o).all(axis=1), col, None).astype(object)
        if fallback:
            fb = df[[f"{fallback}_{n}" for n in names]].to_numpy(float)
            use = ~np.isfinite(o).all(axis=1) & np.isfinite(fb).all(axis=1)
            o[use] = fb[use]; source[use] = fallback
            df["mkt_closing_source"] = source
        raw, over = odds_mod.implied(o)
        p = odds_mod.devig(o, DEVIG_METHOD)
        q = odds_mod.devig(o, "proportional")
        for i, n in enumerate(names):
            df[f"mkt_{bench}_raw_{n}"] = raw[:, i]; df[f"mkt_{bench}_p_{n}"] = p[:, i]; df[f"mkt_{bench}_prop_{n}"] = q[:, i]
        df[f"mkt_{bench}_overround"] = over
    # plus / moins 2,5 : clôture Pinnacle, repli moyenne clôture
    o = df[["odds_p_ou_closing_over", "odds_p_ou_closing_under"]].to_numpy(float, copy=True)
    fb = df[["odds_avg_ou_closing_over", "odds_avg_ou_closing_under"]].to_numpy(float)
    src = np.where(np.isfinite(o).all(axis=1), "odds_p_ou_closing", None).astype(object)
    use = ~np.isfinite(o).all(axis=1) & np.isfinite(fb).all(axis=1); o[use] = fb[use]; src[use] = "odds_avg_ou_closing"
    raw, over = odds_mod.implied(o); p = odds_mod.devig(o, DEVIG_METHOD)
    df["mkt_ou_closing_source"] = src; df["mkt_ou_closing_raw_over"] = raw[:, 0]; df["mkt_ou_closing_overround"] = over
    df["mkt_ou_closing_p_over"] = p[:, 0]
    df["mkt_devig_method"] = DEVIG_METHOD
    report = join_quality(df, odds_status, votes, audit, files)
    return df, report


def join_quality(df: pd.DataFrame, odds_status: pd.DataFrame, votes: pd.DataFrame, audit: list[dict], files: list[Path]) -> dict:
    status_counts = df["join_status"].value_counts().to_dict()
    with_file = df["competition"].isin(set(odds_mod.MAIN_LEAGUES) | set(odds_mod.EXTRA_LEAGUES))
    rows = []
    for (comp, season), g in df[with_file].groupby(["competition", "season"]):
        o = odds_status[(odds_status["competition"] == comp)]
        o = o[(o["odds_date"] >= g["match_date"].min()) & (o["odds_date"] <= g["match_date"].max())]
        rows.append({"competition": comp, "season": season, "scoutvisionMatches": int(len(g)), "footballDataRows": int(len(o)),
                     "matchedExact": int((g["join_status"] == "matched_exact").sum()), "matchedMapped": int((g["join_status"] == "matched_mapped").sum()),
                     "ambiguous": int((g["join_status"] == "ambiguous").sum()), "unmatched": int((g["join_status"] == "unmatched").sum()),
                     "footballDataUnmatched": int((o["status"] != "matched").sum()),
                     "snapshot1x2": int(g["odds_has_snapshot_1x2"].sum()), "closing1x2": int(g["odds_has_closing_1x2"].sum()),
                     "snapshotOu25": int(g["odds_has_snapshot_ou25"].sum()), "closingOu25": int(g["odds_has_closing_ou25"].sum()),
                     "pinnacleSnapshot": int(df.loc[g.index, "odds_ps_snapshot_home"].notna().sum()), "pinnacleClosing": int(df.loc[g.index, "odds_ps_closing_home"].notna().sum())})
    table = pd.DataFrame(rows)

    def rate(mask) -> dict:
        g = df[mask]
        n = len(g)
        return {"matches": int(n), "matchedRate": round(float(g["join_status"].isin(["matched_exact", "matched_mapped"]).mean()), 4) if n else None,
                "closing1x2Rate": round(float(g["odds_has_closing_1x2"].mean()), 4) if n else None}
    secondary = [c for c in odds_mod.MAIN_LEAGUES if c not in BIG5]
    amb = odds_status[odds_status["status"] == "ambiguous"].head(20)
    return {
        "files": [p.name for p in files], "ingestion": audit, "teamsMapped": int(len(votes.drop_duplicates(["competition", "odds_name"]))),
        "mappingVotes": votes.to_dict(orient="records")[:5000], "statusCounts": status_counts,
        "byCompetitionSeason": table.to_dict(orient="records"),
        "rates": {"global": rate(with_file), "big5": rate(df["competition"].isin(BIG5)), "mainOtherLeagues": rate(df["competition"].isin(secondary)),
                  "newFileLeagues": rate(df["competition"].isin(odds_mod.EXTRA_LEAGUES)),
                  "byCompetition": {c: rate(df["competition"] == c) for c in sorted(set(df.loc[with_file, "competition"]))}},
        "ambiguousExamples": amb[["competition", "odds_date", "odds_home_name", "odds_away_name", "odds_source_file"]].astype(str).to_dict(orient="records"),
        "unmatchedFootballDataByReason": odds_status["status"].value_counts().to_dict(),
        "closingSource": df["mkt_closing_source"].value_counts(dropna=False).astype(int).to_dict() if "mkt_closing_source" in df else {},
        "overround": {b: {"mean": round(float(np.nanmean(df[f"mkt_{b}_overround"])), 4), "p10": round(float(np.nanpercentile(df[f"mkt_{b}_overround"].dropna(), 10)), 4),
                          "p90": round(float(np.nanpercentile(df[f"mkt_{b}_overround"].dropna(), 90)), 4)} for b in BENCHMARKS if df[f"mkt_{b}_overround"].notna().any()},
    }


# ============================================
# PRÉDICTIONS FIGÉES ET BENCHMARKS
# ============================================

def frozen_predictions(season: str, selection: dict, model_ids: list[str]) -> dict[str, pd.DataFrame]:
    """Blocs de prédictions déjà écrits : pour une famille à grille, le paramétrage retenu sur 2024-25."""
    preds = predictions.read(PRED_DIR / f"{season}.parquet")
    out = {}
    for m in model_ids:
        block = preds[preds["model_id"] == m]
        if m in GRIDS:
            block = block[block["parameters_hash"] == selection[m]["parameters_hash"]]
        if len(block):
            out[m] = block
    return out


def market_frames(df: pd.DataFrame, method_suffix: str = "p") -> dict[str, pd.DataFrame]:
    """Benchmarks au format prédiction (match_id, p_home, p_draw, p_away), lignes complètes seulement."""
    out = {}
    for bench in BENCHMARKS:
        cols = [f"mkt_{bench}_{method_suffix}_{n}" for n in ("home", "draw", "away")]
        sub = df[["match_id"] + cols].dropna()
        out[bench] = sub.rename(columns=dict(zip(cols, PROB_COLUMNS)))
    return out


def population_scores(df: pd.DataFrame, models: dict[str, pd.DataFrame], markets: dict[str, pd.DataFrame], mask: pd.Series | None = None) -> dict:
    """Comparaison appariée modèles + marché de référence sur la population commune ; benchmarks snapshot
    évalués sur la même population quand ils y sont disponibles."""
    data = df if mask is None else df[mask]
    group = {**models, REFERENCE: markets[REFERENCE]}
    ev = scoring.evaluate(group, data)
    res = {"population": ev["population"], "scores": {m: ev["byModel"][m]["overall"] for m in group}, "paired": []}
    for p in ev["paired"]:
        if REFERENCE in (p["a"], p["b"]):
            model, sign = (p["b"], -1) if p["a"] == REFERENCE else (p["a"], 1)
            # delta = modèle − marché (négatif = modèle meilleur)
            res["paired"].append({"model": model, **{k: {"delta": round(sign * p[k]["meanDifference"], 5),
                                                          "ci90": sorted([round(sign * x, 5) for x in p[k]["ci90"]]),
                                                          "pModelBetter": round(p[k]["pABetter"] if sign == 1 else 1 - p[k]["pABetter"], 4)}
                                                      for k in ("logLoss", "rps")}})
    # benchmarks snapshot sur la même population
    for bench in ("market_snapshot_avg", "market_snapshot_pinnacle"):
        common = markets[bench][markets[bench]["match_id"].isin(set(data["match_id"]))]
        if len(common) >= 50:
            sub = scoring.evaluate({bench: common, REFERENCE: markets[REFERENCE]}, data)
            res["scores"][bench] = {**sub["byModel"][bench]["overall"], "note": f"population {sub['population']} (lignes avec ce benchmark)",
                                    "referenceOnSamePopulation": sub["byModel"][REFERENCE]["overall"]["logLoss"]}
    return res


def pool(model: pd.DataFrame, market: pd.DataFrame, df: pd.DataFrame, weights: list[float]) -> dict:
    """Log-loss du pool logarithmique pour chaque poids de la grille, sur la population commune."""
    base = df[df["usable_for_model"] & df["result_1x2"].notna()][["match_id", "result_1x2"]]
    j = base.merge(model[["match_id"] + PROB_COLUMNS], on="match_id").merge(market[["match_id"] + PROB_COLUMNS], on="match_id", suffixes=("_m", "_k"))
    y = j["result_1x2"].map(OUTCOME_INDEX).to_numpy(int)
    pm = j[[f"{c}_m" for c in PROB_COLUMNS]].to_numpy(float); pk = j[[f"{c}_k" for c in PROB_COLUMNS]].to_numpy(float)
    out = {}
    for w in weights:
        p = np.clip(pm, 1e-12, None) ** w * np.clip(pk, 1e-12, None) ** (1 - w)
        p = p / p.sum(axis=1, keepdims=True)
        out[w] = round(float(scoring.log_loss(p, y).mean()), 5)
    return {"population": int(len(j)), "logLossByWeight": out}


def interpret_weight(w: float) -> str:
    if w == 0:
        return "Le modèle n'apporte pas d'information supplémentaire mesurable au marché sur la validation."
    if w <= 0.2:
        return "Information marginale."
    return "Information complémentaire mesurable."


def divergence(model: pd.DataFrame, market: pd.DataFrame, df: pd.DataFrame) -> list[dict]:
    """Quand le modèle et le marché divergent, qui a raison ? Par (match, issue), buckets de |Δ|."""
    base = df[df["usable_for_model"] & df["result_1x2"].notna()][["match_id", "result_1x2"]]
    j = base.merge(model[["match_id"] + PROB_COLUMNS], on="match_id").merge(market[["match_id"] + PROB_COLUMNS], on="match_id", suffixes=("_m", "_k"))
    y = j["result_1x2"].map(OUTCOME_INDEX).to_numpy(int)
    pm = j[[f"{c}_m" for c in PROB_COLUMNS]].to_numpy(float); pk = j[[f"{c}_k" for c in PROB_COLUMNS]].to_numpy(float)
    ll_diff = scoring.log_loss(pm, y) - scoring.log_loss(pk, y)
    rows = []
    delta = pm - pk
    hit = (np.arange(3)[None, :] == y[:, None]).astype(float)
    maxabs = np.abs(delta).max(axis=1)
    for lo, hi, label in zip(DIVERGENCE_EDGES[:-1], DIVERGENCE_EDGES[1:], DIVERGENCE_LABELS):
        sel = (np.abs(delta) >= lo) & (np.abs(delta) < hi)
        up = sel & (delta > 0)
        mm = (maxabs >= lo) & (maxabs < hi)
        rows.append({"bucket": label, "outcomes": int(sel.sum()), "matches": int(mm.sum()),
                     "meanModelProbability": round(float(pm[sel].mean()), 4) if sel.any() else None,
                     "meanMarketProbability": round(float(pk[sel].mean()), 4) if sel.any() else None,
                     "observedFrequency": round(float(hit[sel].mean()), 4) if sel.any() else None,
                     "modelHigher": {"outcomes": int(up.sum()), "meanModel": round(float(pm[up].mean()), 4) if up.any() else None,
                                     "meanMarket": round(float(pk[up].mean()), 4) if up.any() else None,
                                     "observedFrequency": round(float(hit[up].mean()), 4) if up.any() else None},
                     "logLossDifferential": round(float(ll_diff[mm].mean()), 5) if mm.any() else None})
    return rows


def clv_direction(model: pd.DataFrame, df: pd.DataFrame) -> dict:
    """Descriptif : quand le modèle donne plus que le snapshot moyen à une issue, la clôture (référence)
    bouge-t-elle dans le même sens ? Aucun profit, aucune mise."""
    cols_s = [f"mkt_market_snapshot_avg_p_{n}" for n in ("home", "draw", "away")]
    cols_c = [f"mkt_{REFERENCE}_p_{n}" for n in ("home", "draw", "away")]
    j = df[["match_id"] + cols_s + cols_c].dropna().merge(model[["match_id"] + PROB_COLUMNS], on="match_id")
    ps, pc, pm = j[cols_s].to_numpy(float), j[cols_c].to_numpy(float), j[PROB_COLUMNS].to_numpy(float)
    move = pc - ps
    prefer = pm > ps + 0.01; against = pm < ps - 0.01
    def side(mask):
        return {"outcomes": int(mask.sum()), "shareClosingMovedUp": round(float((move[mask] > 0).mean()), 4) if mask.any() else None,
                "meanClosingMove": round(float(move[mask].mean()), 5) if mask.any() else None}
    return {"matches": int(len(j)), "modelAboveSnapshot": side(prefer), "modelBelowSnapshot": side(against), "neutral": side(~prefer & ~against),
            "note": "part des issues dont la probabilité de clôture dépasse le snapshot, selon que le modèle était au-dessus ou en dessous du snapshot (seuil 1 pt)"}


def ou_benchmark(df: pd.DataFrame, models: dict[str, pd.DataFrame]) -> dict:
    """Plus / moins 2,5 : modèles de buts contre la clôture du marché, population commune, bootstrap apparié."""
    base = df[df["usable_for_model"] & df["over_2_5"].notna() & df["mkt_ou_closing_p_over"].notna()][["match_id", "competition", "match_date", "over_2_5", "mkt_ou_closing_p_over"]]
    avail = {m: p[p["p_over_2_5"].notna()][["match_id", "p_over_2_5"]] for m, p in models.items() if "p_over_2_5" in p}
    common = set(base["match_id"])
    for p in avail.values():
        common &= set(p["match_id"])
    pop = base[base["match_id"].isin(common)].sort_values("match_id").reset_index(drop=True)
    if len(pop) < 100:
        return {"population": int(len(pop)), "note": "population insuffisante"}
    y = pop["over_2_5"].astype(float).to_numpy()
    probs = {"market_closing_ou25": pop["mkt_ou_closing_p_over"].to_numpy(float)}
    for m, p in avail.items():
        probs[m] = p.set_index("match_id").reindex(pop["match_id"])["p_over_2_5"].to_numpy(float)
    def ll(q):
        q = np.clip(q, 1e-12, 1 - 1e-12); return -(y * np.log(q) + (1 - y) * np.log(1 - q))
    res = {"population": int(len(pop)), "overRate": round(float(y.mean()), 4), "scores": {}, "paired": []}
    for m, q in probs.items():
        res["scores"][m] = {"logLoss": round(float(ll(q).mean()), 4), "brier": round(float(((q - y) ** 2).mean()), 4),
                            "ece": scoring.calibration(q, y)["ece"], "calibration": scoring.calibration(q, y)["bins"]}
    blocks = (pop["match_date"].astype(str) + "|" + pop["competition"]).to_numpy()
    uniq, inv = np.unique(blocks, return_inverse=True)
    rng = np.random.default_rng(scoring.SEED); idx = rng.integers(0, len(uniq), (scoring.BOOT, len(uniq)))
    counts = np.bincount(inv, minlength=len(uniq)).astype(float)
    for m in avail:
        d = ll(probs[m]) - ll(probs["market_closing_ou25"])
        sums = np.bincount(inv, d, minlength=len(uniq)); boot = sums[idx].sum(axis=1) / counts[idx].sum(axis=1)
        res["paired"].append({"model": m, "logLoss": {"delta": round(float(d.mean()), 5), "ci90": [round(float(np.percentile(boot, 5)), 5), round(float(np.percentile(boot, 95)), 5)],
                                                      "pModelBetter": round(float((boot < 0).mean()), 4)}})
    return res


# ============================================
# ORCHESTRATION
# ============================================

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--odds-dir", type=Path, default=ODDS_RAW)
    parser.add_argument("--audit-only", action="store_true")
    parser.add_argument("--force", action="store_true", help="continuer malgré une anomalie de jointure (diagnostic affiché)")
    args = parser.parse_args()
    t0 = time.time()
    dataset = pd.read_parquet(OUT / "replay_pitchapi.parquet")
    df, report = build_market_dataset(dataset, args.odds_dir)
    (OUT / "odds_ingestion_manifest.json").write_text(json.dumps({"generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                                                                 "files": report["files"], "ingestion": report["ingestion"]}, indent=1, ensure_ascii=False, default=str), encoding="utf-8")
    (OUT / "join_quality.json").write_text(json.dumps({k: v for k, v in report.items() if k != "ingestion"}, indent=1, ensure_ascii=False, default=str), encoding="utf-8")
    df.to_parquet(OUT / "replay_market.parquet", index=False)
    r = report["rates"]
    print(f"jointure : global {r['global']}, big5 {r['big5']}, ambiguës {report['statusCounts'].get('ambiguous', 0)}, "
          f"clôture source {report['closingSource']}, surcote {report['overround']}", flush=True)
    anomalies = []
    if (r["global"]["matchedRate"] or 0) < 0.85:
        anomalies.append(f"taux d'appariement global {r['global']['matchedRate']} < 0,85")
    if report["statusCounts"].get("ambiguous", 0) > 0.01 * max(r["global"]["matches"], 1):
        anomalies.append(f"{report['statusCounts'].get('ambiguous', 0)} lignes ambiguës")
    if anomalies and not args.force:
        print("STOP avant benchmark :", *anomalies, sep="\n  ")
        return 2
    if args.audit_only:
        return 0

    reports = json.loads((OUT / "run_reports.json").read_text())
    selection = reports["selection"]
    markets = {s: market_frames(df[df["season"] == s]) for s in (VALIDATION_SEASON, RETRO_SEASON)}
    block = {"generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"), "question": "Les modèles sportifs contiennent-ils une information "
             "prédictive supplémentaire par rapport au marché ?", "periods": {VALIDATION_SEASON: "validation", RETRO_SEASON: RETRO_LABEL},
             "reference": REFERENCE, "closingFallback": report["closingSource"], "devig": {"main": DEVIG_METHOD, "sensitivity": "proportional"},
             "sources": {"files": report["files"], "providers": "voir odds_ingestion_manifest.json"}, "coverage": {"rates": r, "statusCounts": report["statusCounts"]},
             "overround": report["overround"], "sportModels": SPORT_MODELS, "usesOdds": {m: False for m in SPORT_MODELS} | {b: True for b in BENCHMARKS},
             "seasons": {}, "pool": {}, "divergence": {}, "clvDirection": {}, "overUnder25": {}, "limits": [
                 "snapshot = cotes disponibles à la collecte football-data (non horodatées), jamais « ouverture »",
                 "repli clôture moyenne quand Pinnacle manque (enregistré par ligne)", "aucune cote pour CRO, CZE, KOR, KSA, SRB, UCL, UEL, UECL",
                 "plus / moins 2,5 dans les ligues principales seulement", "poids du pool choisi sur 2024-25 et figé ; aucune réoptimisation sur 2025-26",
                 "analyse descriptive : aucun ROI, aucune mise, aucun pari"]}
    for season in (VALIDATION_SEASON, RETRO_SEASON):
        sub = df[df["season"] == season]
        models = frozen_predictions(season, selection, SPORT_MODELS)
        ou_models = frozen_predictions(season, selection, OU_MODELS)
        mk = markets[season]
        season_block = {"full": population_scores(sub, models, mk),
                        "big5": population_scores(sub, models, mk, sub["competition"].isin(BIG5)),
                        "mainOtherLeagues": population_scores(sub, models, mk, sub["competition"].isin([c for c in odds_mod.MAIN_LEAGUES if c not in BIG5])),
                        "newFileLeagues": population_scores(sub, models, mk, sub["competition"].isin(odds_mod.EXTRA_LEAGUES)),
                        "byCompetition": {}}
        for comp in sorted(set(sub.loc[sub["odds_has_closing_1x2"], "competition"])):
            ps = population_scores(sub, models, mk, sub["competition"] == comp)
            if ps["population"] >= 50:
                season_block["byCompetition"][comp] = {"population": ps["population"], "scores": {m: v["logLoss"] for m, v in ps["scores"].items()},
                                                       "paired": [{"model": p["model"], "logLoss": p["logLoss"]} for p in ps["paired"]]}
        # sensibilité de-vig : la référence proportionnelle
        prop = market_frames(sub, "prop")
        season_block["devigSensitivity"] = {"proportional": population_scores(sub, models, {**mk, REFERENCE: prop[REFERENCE]})["scores"][REFERENCE]}
        block["seasons"][season] = season_block
        block["divergence"][season] = {m: divergence(models[m], mk[REFERENCE], sub) for m in models}
        block["clvDirection"][season] = {m: clv_direction(models[m], sub) for m in models}
        block["overUnder25"][season] = ou_benchmark(sub, ou_models)
        print(f"  {season}: population {season_block['full']['population']}, " + ", ".join(f"{m} {v['logLoss']}" for m, v in season_block["full"]["scores"].items()), flush=True)
    # pool : poids choisi sur la validation, figé sur 2025-26
    val_models = frozen_predictions(VALIDATION_SEASON, selection, SPORT_MODELS)
    retro_models = frozen_predictions(RETRO_SEASON, selection, SPORT_MODELS)
    for m in SPORT_MODELS:
        v = pool(val_models[m], markets[VALIDATION_SEASON][REFERENCE], df[df["season"] == VALIDATION_SEASON], POOL_GRID)
        w = min(v["logLossByWeight"], key=v["logLossByWeight"].get)
        rr = pool(retro_models[m], markets[RETRO_SEASON][REFERENCE], df[df["season"] == RETRO_SEASON], [0.0, w])
        block["pool"][m] = {"grid": POOL_GRID, "validation": v, "selectedWeight": w, "interpretation": interpret_weight(w),
                            "retrospective": {"population": rr["population"], "logLossMarket": rr["logLossByWeight"][0.0], "logLossPool": rr["logLossByWeight"][w],
                                              "gainVsMarket": round(rr["logLossByWeight"][0.0] - rr["logLossByWeight"][w], 5), "weightFrozen": True}}
        print(f"  pool {m}: w = {w} ({block['pool'][m]['interpretation']}) ; 2025-26 marché {rr['logLossByWeight'][0.0]} → pool {rr['logLossByWeight'][w]}", flush=True)
    # registre : benchmarks
    for bench in list(BENCHMARKS) + ["market_closing_avg"]:
        registry.upsert(OUT / "forecast_registry.json", {
            "model_id": bench, "model_version": "1.0.0", "type": "benchmark", "family": "benchmark", "parameters": {"devig": DEVIG_METHOD},
            "parameters_hash": DEVIG_METHOD, "features": "football-data odds", "uses_xg": False, "uses_odds": True, "window": "2024-25,2025-26",
            "date": datetime.now(timezone.utc).isoformat(timespec="seconds"), "input_hash": "odds_raw", "prediction_hash": "n/a (cotes)",
            "matches_predicted": int(df["odds_has_closing_1x2"].sum()) if "closing" in bench else int(df["odds_has_snapshot_1x2"].sum()),
            "matches_scored": int(df[df["season"].isin([VALIDATION_SEASON, RETRO_SEASON])]["odds_has_closing_1x2"].sum()), "status": "baseline"})
    bt_path = OUT / "backtests.json"
    bt = json.loads(bt_path.read_text(encoding="utf-8"))
    bt["marketBenchmark"] = block
    bt_path.write_text(json.dumps(bt, indent=1, ensure_ascii=False, default=str), encoding="utf-8")
    print(f"backtests.json : bloc marketBenchmark écrit ({time.time() - t0:.0f}s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
