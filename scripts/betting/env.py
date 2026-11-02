"""Lecture de la clé OddsPapi : variable d'environnement, sinon `.env.local` à la racine (jamais affichée)."""

from __future__ import annotations

import os
from pathlib import Path

from . import ROOT

KEY_NAME = "ODDSPAPI_API_KEY"


def load_env_file(path: Path = ROOT / ".env.local") -> None:
    """Charge les variables absentes de l'environnement depuis un fichier `NOM=valeur` (sans écraser)."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.split("=", 1)
        name, value = name.strip(), value.strip().strip('"').strip("'")
        if name and name not in os.environ:
            os.environ[name] = value


def api_key() -> str:
    load_env_file()
    key = os.environ.get(KEY_NAME, "").strip()
    if not key:
        raise RuntimeError(f"{KEY_NAME} absente : définir la variable d'environnement ou .env.local (jamais commité).")
    return key
