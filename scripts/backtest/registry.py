"""
Registre de recherche : une entrée par (modèle, version, paramètres, fenêtre) avec features, dates,
hash des entrées et des prédictions, couverture, statut (baseline | challenger | incomplete | rejected).
Aucun champion à l'étape 2A. Fichier .research/forecast/forecast_registry.json (ignoré par Git).
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

STATUSES = ("baseline", "challenger", "incomplete", "rejected")


def load(path: Path) -> list[dict]:
    return json.loads(path.read_text(encoding="utf-8"))["entries"] if path.exists() else []


def save(path: Path, entries: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"updatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"), "champion": None,
                                "entries": entries}, indent=1, ensure_ascii=False, default=str), encoding="utf-8")


def upsert(path: Path, entry: dict) -> list[dict]:
    required = ("model_id", "model_version", "parameters", "parameters_hash", "features", "window", "date", "input_hash",
                "prediction_hash", "matches_predicted", "matches_scored", "status")
    missing = [k for k in required if k not in entry]
    if missing:
        raise ValueError(f"entrée de registre incomplète : {missing}")
    if entry["status"] not in STATUSES:
        raise ValueError(f"statut inconnu : {entry['status']}")
    entries = load(path)
    key = (entry["model_id"], entry["model_version"], entry["parameters_hash"], entry["window"])
    entries = [e for e in entries if (e["model_id"], e["model_version"], e["parameters_hash"], e["window"]) != key]
    entries.append(entry)
    save(path, entries)
    return entries
