"""
Étape 2A : baselines sportives en walk-forward, prédictions immuables, scoring prédictif.

  python3 -m backtest.run_models --phase all            # depuis scripts/
  python3 -m backtest.run_models --phase validation      # candidats et grilles préenregistrées sur 2024-25
  python3 -m backtest.run_models --phase final           # modèles retenus : 2025-26 (évaluation rétrospective
                                                         #   hors ajustement du modèle) et 2026-27 (figé, non évalué)
  python3 -m backtest.run_models --phase score           # scoring depuis les parquets, backtests.json

Aucune cote, aucun pari, aucune calibration post-hoc. Sorties dans .research/forecast/ (ignoré par Git).
"""

from __future__ import annotations

import argparse
import json
import resource
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

from forecast_models import elo, form, frequency, poisson, scoutvision, xg
from forecast_models.base import parameters_hash
from . import SCHEMA_VERSION, predictions, registry, scoring, walk_forward

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / ".research" / "forecast"
PRED_DIR = OUT / "predictions"
VALIDATION_SEASON, RETRO_SEASON, PROSPECTIVE_SEASON = "2024-25", "2025-26", "2026-27"
RETRO_LABEL = "évaluation rétrospective hors ajustement du modèle"

# Grilles préenregistrées (sélection sur la validation 2024-25 seulement)
GRIDS = {"elo": elo.ELO_GRID, "dixon_coles_decay": [{"half_life": h} for h in poisson.HALF_LIFE_GRID],
         "xg_rolling": [{"window": w} for w in xg.WINDOW_GRID]}


def candidates(stored: pd.DataFrame) -> list[tuple[str, object, dict | None]]:
    """(famille, modèle, paramètres de grille) ; None = modèle unique."""
    out = [("league_frequency", frequency.LeagueFrequency(), None), ("home_advantage", frequency.HomeAdvantage(), None),
           ("form_ridge", form.form_model(), None), ("standings_ppm", form.standings_model(), None),
           ("poisson", poisson.poisson_model(), None), ("dixon_coles", poisson.dixon_coles_model(), None),
           ("scoutvision_reproduced", scoutvision.ScoutVisionReproduced(), None),
           ("scoutvision_stored", scoutvision.ScoutVisionStored(stored), None)]
    out += [("elo", elo.Elo(**g), g) for g in GRIDS["elo"]]
    out += [("dixon_coles_decay", poisson.dixon_coles_decay_model(**g), g) for g in GRIDS["dixon_coles_decay"]]
    out += [("xg_rolling", xg.RollingXG(**g), g) for g in GRIDS["xg_rolling"]]
    return out


def build_selected(selection: dict, stored: pd.DataFrame) -> list[tuple[str, object, dict | None]]:
    out = []
    for fam, m, g in candidates(stored):
        if fam in GRIDS:
            if g == selection[fam]["parameters"]:
                out.append((fam, m, g))
        else:
            out.append((fam, m, g))
    return out


def season_bounds(dataset: pd.DataFrame, seasons: list[str]) -> tuple[pd.Timestamp, pd.Timestamp]:
    k = dataset.loc[dataset["season"].isin(seasons), "kickoff_utc"]
    return k.min().normalize(), k.max().normalize() + pd.Timedelta(days=1)


def run_phase(dataset: pd.DataFrame, input_hash: str, models: list, seasons: list[str], tiers: dict, quick: bool,
              window_days_for: dict | None = None) -> dict:
    """Walk-forward de chaque modèle sur la période des saisons demandées ; écriture par saison."""
    start, end = season_bounds(dataset, seasons)
    if quick:
        end = start + pd.Timedelta(days=28)
    reports = {}
    for fam, model, grid in models:
        t0 = time.time()
        wd = (window_days_for or {}).get(fam)
        pred, rep = walk_forward.run(model, dataset, start, end, input_hash, window_days=wd, context_extra={"competition_tiers": tiers})
        pred = pred.merge(dataset[["match_id", "season"]], on="match_id")
        key = f"{fam}:{model.metadata()['parameters_hash']}"
        reports[key] = {"family": fam, "model": rep.model, "grid": grid, "weeks": rep.weeks, "fixtures": rep.fixtures,
                        "predicted": rep.predicted, "reasons": rep.reasons, "byCompetition": rep.by_competition, "bySeason": rep.by_season,
                        "fitSeconds": round(rep.fit_seconds, 1), "predictSeconds": round(rep.predict_seconds, 1), "totalSeconds": round(time.time() - t0, 1),
                        "windowDays": wd, "predictionHash": {}}
        for season in seasons:
            block = pred[pred["season"] == season].drop(columns=["season"])
            if block.empty:
                continue
            meta = predictions.write(PRED_DIR / f"{season}.parquet", block, overwrite=True)
            reports[key]["predictionHash"][season] = predictions.logical_hash(block)
            registry.upsert(OUT / "forecast_registry.json", {
                "model_id": model.model_id, "model_version": model.model_version, "family": model.family, "parameters": model.parameters,
                "parameters_hash": model.metadata()["parameters_hash"], "features": getattr(model, "parameters", {}).get("features", "see model docstring"),
                "uses_xg": model.uses_xg, "uses_odds": model.uses_odds, "window": season, "window_kind": "expanding" if wd is None else f"rolling_{wd}d",
                "date": datetime.now(timezone.utc).isoformat(timespec="seconds"), "input_hash": input_hash,
                "prediction_hash": reports[key]["predictionHash"][season], "matches_predicted": int(len(block)),
                "matches_scored": 0 if season == PROSPECTIVE_SEASON else int(len(block)),
                "status": "incomplete" if rep.predicted < 0.5 * rep.fixtures else ("baseline" if model.family == "baseline" else "challenger"),
                "note": "prédictions figées, résultats verrouillés jusqu'à la clôture de la saison" if season == PROSPECTIVE_SEASON else
                        (RETRO_LABEL if season == RETRO_SEASON else "validation"),
            })
        print(f"  {key:40s} {rep.predicted:6d}/{rep.fixtures:6d} prévus, fit {rep.fit_seconds:6.1f}s, predict {rep.predict_seconds:5.1f}s", flush=True)
    return reports


def select(dataset: pd.DataFrame, reports: dict) -> dict:
    """Pour chaque grille, le paramétrage de plus faible log-loss sur la population commune de la famille (2024-25)."""
    preds = predictions.read(PRED_DIR / f"{VALIDATION_SEASON}.parquet")
    selection = {}
    for fam, grid in GRIDS.items():
        members = {k: v for k, v in reports.items() if v["family"] == fam}
        by = {k: preds[(preds["model_id"] == v["model"]["model_id"]) & (preds["parameters_hash"] == v["model"]["parameters_hash"])] for k, v in members.items()}
        ev = scoring.evaluate(by, dataset)
        scores = {k: ev["byModel"][k]["overall"]["logLoss"] for k in by}
        best = min(scores, key=scores.get)
        selection[fam] = {"parameters": members[best]["grid"], "parameters_hash": members[best]["model"]["parameters_hash"],
                          "validationLogLoss": scores[best], "population": ev["population"],
                          "tested": [{"parameters": v["grid"], "logLoss": scores[k], "rps": ev["byModel"][k]["overall"]["rps"]} for k, v in members.items()],
                          "criterion": "log-loss minimale sur 2024-25, population commune de la famille"}
    return selection


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--phase", choices=["validation", "final", "score", "all"], default="all")
    parser.add_argument("--quick", action="store_true", help="4 semaines seulement (fumée)")
    args = parser.parse_args()
    t0 = time.time()
    dataset = pd.read_parquet(OUT / "replay_pitchapi.parquet")
    meta = json.loads((OUT / "replay_pitchapi.meta.json").read_text())
    input_hash = meta["inputHash"]
    index = json.loads((ROOT / "public" / "data" / "index.json").read_text(encoding="utf-8")) if (ROOT / "public" / "data" / "index.json").exists() else {"competitions": []}
    tiers = {c["key"]: int(c.get("tier", 2)) for c in index["competitions"]}
    stored = scoutvision.load_stored(ROOT / ".cache" / "pitchapi")
    report_path = OUT / "run_reports.json"
    reports = json.loads(report_path.read_text()) if report_path.exists() else {}

    if args.phase in ("validation", "all"):
        print(f"Validation {VALIDATION_SEASON} : {len(candidates(stored))} candidats", flush=True)
        reports["validation"] = run_phase(dataset, input_hash, candidates(stored), [VALIDATION_SEASON], tiers, args.quick,
                                          window_days_for={"scoutvision_reproduced": scoutvision.WINDOW_DAYS})
        reports["selection"] = select(dataset, reports["validation"])
        for fam, s in reports["selection"].items():
            print(f"  sélection {fam}: {s['parameters']} (log-loss {s['validationLogLoss']})", flush=True)
        report_path.write_text(json.dumps(reports, indent=1, default=str))
    if args.phase in ("final", "all"):
        print(f"Final : {RETRO_SEASON} ({RETRO_LABEL}) et {PROSPECTIVE_SEASON} (figé)", flush=True)
        reports["final"] = run_phase(dataset, input_hash, build_selected(reports["selection"], stored), [RETRO_SEASON, PROSPECTIVE_SEASON], tiers,
                                     args.quick, window_days_for={"scoutvision_reproduced": scoutvision.WINDOW_DAYS})
        report_path.write_text(json.dumps(reports, indent=1, default=str))
    if args.phase in ("score", "all"):
        write_backtests(dataset, reports, meta, t0)
    return 0


def write_backtests(dataset: pd.DataFrame, reports: dict, meta: dict, t0: float) -> None:
    out = {"generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"), "schemaVersion": SCHEMA_VERSION,
           "datasetInputHash": meta["inputHash"], "datasetLogicalHash": meta["logicalHash"],
           "windows": {"W1": {"train": "2021-22 → 2023-24", "validation": VALIDATION_SEASON, "retrospective": f"{RETRO_SEASON} ({RETRO_LABEL})"},
                       "W2": {"train": "→ 2025-26", "prospective": f"{PROSPECTIVE_SEASON} : prédictions figées, résultats verrouillés jusqu'à la clôture"}},
           "refit": "hebdomadaire, fenêtre expansive (scoutvision_reproduced : glissante 730 j comme en production)",
           "selection": reports.get("selection"), "gridsPreRegistered": GRIDS, "runs": {k: reports.get(k) for k in ("validation", "final")},
           "scores": {}, "notes": [
               "Aucune cote, aucun pari, aucune calibration post-hoc : calibration brute mesurée seulement.",
               "Population commune = matchs prévus par tous les modèles comparés ; scoutvision_stored évalué à part sur ses propres matchs.",
               "Matchs attribués exclus du scoring (usable_for_model = false).",
               f"{RETRO_SEASON} : {RETRO_LABEL} (résultats déjà observés indirectement dans ScoutVision) ; {PROSPECTIVE_SEASON} non évalué.",
           ]}
    for season in (VALIDATION_SEASON, RETRO_SEASON):
        path = PRED_DIR / f"{season}.parquet"
        if not path.exists():
            continue
        preds = predictions.read(path)
        groups = {}
        for (mid, ph), g in preds.groupby(["model_id", "parameters_hash"]):
            key = mid if mid not in GRIDS else f"{mid}:{ph}"
            if season == RETRO_SEASON or mid not in GRIDS:
                key = mid
            groups.setdefault(key, g)
        main = [k for k in groups if k != "scoutvision_stored" and ":" not in k] if season == RETRO_SEASON else [k for k in groups if k != "scoutvision_stored"]
        sel = reports.get("selection") or {}
        if season == VALIDATION_SEASON:
            # sur la validation : un seul membre par grille (le retenu) dans la comparaison principale
            main = [k for k in groups if k != "scoutvision_stored" and (":" not in k or any(k == f"{fam}:{s['parameters_hash']}" for fam, s in sel.items()))]
        scores = {"main": scoring.evaluate({k: groups[k] for k in main}, dataset)}
        if "scoutvision_stored" in groups:
            scores["scoutvisionStoredSubset"] = scoring.evaluate({k: groups[k] for k in main + ["scoutvision_stored"]}, dataset)
        if season == VALIDATION_SEASON:
            scores["gridMembers"] = {fam: scoring.evaluate({k: groups[k] for k in groups if k.startswith(f"{fam}:")}, dataset) for fam in GRIDS}
        out["scores"][season] = scores
        print(f"  {season}: population {scores['main']['population']}, " + ", ".join(f"{m} {v['overall']['logLoss']}" for m, v in scores["main"]["byModel"].items()), flush=True)
    sizes = {p.name: p.stat().st_size for p in PRED_DIR.glob("*.parquet")} if PRED_DIR.exists() else {}
    out["performance"] = {"totalSeconds": round(time.time() - t0, 1), "peakMemoryMb": round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024),
                          "artefactBytes": sizes}
    out["limits"] = ["pas de cotes dans cette étape", "classement V1 approximatif", "repos surestimé (coupes nationales absentes)",
                     "scoutvision_stored : huit mois de prévisions, date de fabrication inconnue",
                     "scoutvision_reproduced : mêmes fonctions, pas les mêmes données brutes ni la même date de fabrication que le pipeline"]
    (OUT / "backtests.json").write_text(json.dumps(out, indent=1, ensure_ascii=False, default=str), encoding="utf-8")
    print(f"backtests.json écrit ({out['performance']['totalSeconds']}s, pic mémoire {out['performance']['peakMemoryMb']} Mo)")


if __name__ == "__main__":
    sys.exit(main())
