"""
Export produit compact des replays de saison (étape 3 -> Simulateur de saison V1).

Lit .research/forecast/season_replays.json (recherche, 5,9 Mo, ignoré par Git) et écrit dans
public/data/forecast/replays/ (publié dans la release privée avec les autres données, jamais commité) :
  index.json                      schéma, génération, simulation, compétitions / saisons / points / dates, modèles, limites
  summary.json                    évolution de l'erreur, comparaison des modèles sur replays communs, calibration des objectifs
  {competition}/{season}.json     règles, équipes, replays (simulés ou indisponibles avec raison) : distributions de rang,
                                  points, objectifs, réel, erreurs, hash
Seuls les replays stricts complets sont marqués `simulated` ; aucun chemin local, aucune table brute.

  cd scripts && python3 -m backtest.export_replays
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

from . import SCHEMA_VERSION
from .run_models import OUT

ROOT = Path(__file__).resolve().parents[2]
DEST = ROOT / "public" / "data" / "forecast" / "replays"
MODEL_LABELS = {"scoutvision_reproduced": "ScoutVision", "elo": "Elo", "dixon_coles_decay": "Dixon-Coles", "xg_rolling": "Modèle xG",
                "market_closing": "Référence marché historique"}
MODEL_TECH = {"xg_rolling": "xg_rolling · fenêtre 20"}
POINT_LABELS = {"start": "Début", "q25": "25 %", "q50": "50 %", "q75": "75 %"}
LIMITATIONS = [
    "Replay à connaissance glissante : chaque rencontre restante utilise la prévision produite avant cette rencontre.",
    "Les matchs sont simulés indépendamment : les intervalles sont trop étroits en début de saison.",
    "Barrages, matchs d'appui et déductions de points ne sont pas modélisés.",
    "La confrontation directe n'est reproduite que pour les égalités à deux équipes.",
    "Seuls les replays dont toutes les rencontres restantes ont une prévision sont publiés.",
    "La référence marché historique est un repère, pas une prévision du marché actuel.",
]


def compact_replay(r: dict) -> dict:
    base = {"point": r["replayPoint"], "date": r["replayDate"], "model": r["model"]}
    if r["status"] != "ok":
        cov = r.get("coverage") or {}
        missing = int(cov.get("remaining", 0) - cov.get("covered", 0)) if cov else None
        reason = {"insufficient_coverage": f"{missing} rencontre{'s' if (missing or 0) > 1 else ''} restante{'s' if (missing or 0) > 1 else ''} sans prévision du modèle",
                  "no_predictions": "aucune prévision disponible pour ce modèle", "format_mismatch": "format de la saison différent de la règle",
                  "no_data": "aucune donnée"}.get(r["status"], r["status"])
        return {**base, "status": "unavailable", "reason": reason, "coverage": {"covered": cov.get("covered"), "remaining": cov.get("remaining")} if cov else None}
    teams = []
    for tid, t in r["teams_summary"].items():
        a = r["actualFinal"].get(tid, {})
        teams.append({"id": tid, "name": t["team"], "current": {"points": t["current"]["points"], "rank": t["current"]["rank"]} if "current" in t else None,
                      "rank": {k: t["rank"][k] for k in ("mean", "median", "p5", "p25", "p75", "p95")},
                      "points": {k: t["points"][k] for k in ("mean", "median", "p10", "p90")},
                      "dist": [round(float(x), 4) for x in t["rankingDistribution"]],
                      "objectives": t["objectives"], "actual": {"rank": a.get("rank"), "points": a.get("points")}})
    teams.sort(key=lambda t: t["rank"]["mean"])
    return {**base, "status": "simulated", "played": r["played"], "remaining": r["remaining"], "goalPolicy": r["goalPolicy"],
            "approximateTiebreakShare": r["approximateTiebreakShare"], "modelVersion": r["predictions"]["model_version"],
            "fittedAt": [r["predictions"]["fittedAtMin"], r["predictions"]["fittedAtMax"]], "resultHash": r["resultHash"],
            "teams": teams, "errors": r["errors"], "actualApproximateTiebreak": r.get("actualApproximateTiebreak", False)}


def comparison(replays: list[dict], models: list[str]) -> list[dict]:
    """Modèles comparés sur les replays simulés communs à tous."""
    ok = [r for r in replays if r["status"] == "ok"]
    keys = {}
    for r in ok:
        keys.setdefault((r["competition"], r["season"], r["replayPoint"]), set()).add(r["model"])
    common = {k for k, ms in keys.items() if all(m in ms for m in models)}
    out = []
    for m in models:
        rows = [r for r in ok if r["model"] == m and (r["competition"], r["season"], r["replayPoint"]) in common]
        if not rows:
            continue
        e = [r["errors"] for r in rows]
        out.append({"model": m, "replays": len(rows), "maeRank": round(float(np.mean([x["maeRank"] for x in e])), 3),
                    "maePoints": round(float(np.mean([x["maePoints"] for x in e])), 3), "spearman": round(float(np.mean([x["spearman"] for x in e])), 3),
                    "top1": round(float(np.mean([1.0 if x.get("top1Hit") else 0.0 for x in e])), 3),
                    "coverage80": round(float(np.mean([x["pointsInterval80Coverage"] for x in e])), 3)})
    return out


def objective_calibration(replays: list[dict], model: str) -> list[dict]:
    edges = [0, 0.05, 0.2, 0.4, 0.6, 0.8, 0.95, 1.0001]
    rows = []
    for r in replays:
        if r["status"] != "ok" or r["model"] != model:
            continue
        for tid, t in r["teams_summary"].items():
            a = r["actualFinal"][tid]["rank"]
            for key, obj in r["rules"]["objectives"].items():
                lo, hi = obj["positions"]
                rows.append((key, obj["label"], t["objectives"][key], 1.0 if lo <= a <= hi else 0.0))
    out = []
    for key in sorted({k for k, *_ in rows}):
        sub = [(p, y) for k, _, p, y in rows if k == key]
        label = next(l for k, l, *_ in rows if k == key)
        bins = []
        for lo, hi in zip(edges[:-1], edges[1:]):
            cell = [(p, y) for p, y in sub if lo <= p < hi]
            if cell:
                bins.append({"lo": lo, "hi": min(hi, 1.0), "n": len(cell), "predicted": round(float(np.mean([p for p, _ in cell])), 3),
                             "observed": round(float(np.mean([y for _, y in cell])), 3)})
        out.append({"objective": key, "label": label, "bins": bins})
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--source", type=Path, default=OUT / "season_replays.json")
    parser.add_argument("--dest", type=Path, default=DEST)
    args = parser.parse_args()
    d = json.loads(args.source.read_text(encoding="utf-8"))
    models = [m for m in d["models"]]
    args.dest.mkdir(parents=True, exist_ok=True)
    by_cs: dict[tuple[str, str], list[dict]] = {}
    for r in d["replays"]:
        if r["status"] == "no_data":
            continue
        by_cs.setdefault((r["competition"], r["season"]), []).append(r)
    rules_by = {c["key"]: c for c in d["competitions"]}
    index_comps = []
    total = 0
    for comp in sorted({c for c, _ in by_cs}):
        seasons = []
        for (c, season), rs in sorted(by_cs.items()):
            if c != comp:
                continue
            ok = [r for r in rs if r["status"] == "ok"]
            if not ok and not any(r["status"] == "insufficient_coverage" for r in rs):
                continue
            rule = rules_by[comp]
            names = {}
            for r in ok:
                names.update({tid: t["team"] for tid, t in r["teams_summary"].items()})
            dates = {}
            for r in rs:
                dates.setdefault(r["replayPoint"], r["replayDate"])
            payload = {"schemaVersion": SCHEMA_VERSION, "competition": comp, "season": season, "generatedAt": d["generatedAt"],
                       "simulationVersion": d["simulationVersion"], "nSims": d["nSims"], "seed": d["seed"],
                       "rules": {"name": rule["name"], "teams": rule["teams"], "rounds": rule["rounds"], "pointsWin": rule["points_win"], "pointsDraw": rule["points_draw"],
                                 "tiebreaks": rule["tiebreaks"], "exact": rule["exact"], "approximations": rule["approximations"], "objectives": rule["objectives"]},
                       "teams": names, "replays": [compact_replay(r) for r in sorted(rs, key=lambda r: (list(POINT_LABELS).index(r["replayPoint"]) if r["replayPoint"] in POINT_LABELS else 9, r["model"]))]}
            path = args.dest / comp / f"{season}.json"
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
            total += path.stat().st_size
            seasons.append({"season": season, "points": dates, "simulated": {m: [r["replayPoint"] for r in ok if r["model"] == m] for m in models}})
        if seasons:
            rule = rules_by[comp]
            index_comps.append({"key": comp, "name": rule["name"], "teams": rule["teams"], "exact": rule["exact"], "seasons": seasons})
    index = {"schemaVersion": SCHEMA_VERSION, "generatedAt": d["generatedAt"], "simulationVersion": d["simulationVersion"], "nSims": d["nSims"], "seed": d["seed"],
             "defaultModel": d["defaultModel"], "competitions": index_comps,
             "models": [{"id": m, "label": MODEL_LABELS.get(m, m), "technical": MODEL_TECH.get(m, m), "usesOdds": m == "market_closing"} for m in models],
             "replayPoints": [{"id": k, "label": v} for k, v in POINT_LABELS.items()], "limitations": LIMITATIONS,
             "unsupported": d["unsupported"]}
    (args.dest / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=1), encoding="utf-8")
    summary = {"schemaVersion": SCHEMA_VERSION, "generatedAt": d["generatedAt"], "evolution": d["evolution"], "comparison": comparison(d["replays"], models),
               "objectiveCalibration": {"model": d["defaultModel"], "bins": objective_calibration(d["replays"], d["defaultModel"])},
               "goalPolicyImpact": {"meanAbsDeltaTitle": round(float(np.mean([x["meanAbsDeltaTitle"] for x in d["goalPolicyImpact"]])), 4) if d["goalPolicyImpact"] else None,
                                    "meanAbsDeltaRelegation": round(float(np.mean([x["meanAbsDeltaRelegation"] for x in d["goalPolicyImpact"]])), 4) if d["goalPolicyImpact"] else None}}
    (args.dest / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    # Résultat de référence de l'étape 2B pour la page produit (sans ROI, mise ni pari)
    bt_path = OUT / "backtests.json"
    if bt_path.exists():
        bt = json.loads(bt_path.read_text(encoding="utf-8"))
        mb = bt.get("marketBenchmark")
        if mb:
            def season_block(season: str) -> dict | None:
                sb = mb["seasons"].get(season)
                if not sb:
                    return None
                full = sb["full"]
                paired = {p["model"]: p["logLoss"] for p in full["paired"]}
                return {"population": full["population"], "logLoss": {m: v["logLoss"] for m, v in full["scores"].items() if "logLoss" in v},
                        "vsMarket": paired}
            def date_range(season: str) -> list[str] | None:
                # Bornes réelles (dates de coup d'envoi) des rencontres évaluées face à la clôture : prévisions ∩ cotes de clôture
                pred_path, mkt_path = OUT / "predictions" / f"{season}.parquet", OUT / "replay_market.parquet"
                if not pred_path.exists() or not mkt_path.exists():
                    return None
                ids = pd.read_parquet(pred_path, columns=["match_id"])["match_id"].unique()
                col = f"mkt_{mb['reference']}_p_home"
                mkt = pd.read_parquet(mkt_path, columns=["match_id", "kickoff_utc", col])
                rows = mkt[mkt["match_id"].isin(ids)].dropna(subset=[col])
                if rows.empty:
                    return None
                return [str(rows["kickoff_utc"].min().date()), str(rows["kickoff_utc"].max().date())]
            scores = bt.get("scores", {})
            match_validation = {season: {m: v["overall"]["logLoss"] for m, v in scores[season]["main"]["byModel"].items()} for season in scores if "main" in scores[season]}
            bench = {"schemaVersion": SCHEMA_VERSION, "generatedAt": mb["generatedAt"], "headline": "Le marché de clôture reste plus précis que les modèles sportifs testés.",
                     "divergence": "Les grands écarts entre ScoutVision et le marché sont principalement du bruit du modèle dans les données historiques.",
                     "reference": mb["reference"], "periods": mb["periods"], "dateRanges": {s: date_range(s) for s in mb["seasons"]}, "coverage": mb["coverage"]["rates"]["global"],
                     "seasons": {s: season_block(s) for s in mb["seasons"]}, "pool": {m: {"selectedWeight": v["selectedWeight"], "interpretation": v["interpretation"]} for m, v in mb["pool"].items()},
                     "divergenceBuckets": {s: mb["divergence"][s].get("scoutvision_reproduced") for s in mb["divergence"]},
                     "matchValidation": match_validation, "limits": mb["limits"]}
            (args.dest.parent / "market_benchmark.json").write_text(json.dumps(bench, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    sizes = {"index": (args.dest / "index.json").stat().st_size, "summary": (args.dest / "summary.json").stat().st_size, "seasonsTotal": total,
             "seasonFiles": sum(len(c["seasons"]) for c in index_comps), "source": args.source.stat().st_size}
    print(json.dumps(sizes))
    return 0


if __name__ == "__main__":
    sys.exit(main())
