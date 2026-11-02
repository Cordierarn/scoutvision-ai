"""
Téléchargement explicite des CSV football-data.co.uk (recherche prévision, étape 2B) vers un répertoire
local ignoré par Git, depuis une machine ou une CI qui atteint le domaine. Aucun fichier réel n'est
commité ; le workflow research-odds.yml publie l'archive dans la release privée du dépôt de données.

  cd scripts && python3 -m backtest.odds_fetch --out ../.research/forecast/odds_raw
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import odds

SEASONS = ["2021-22", "2022-23", "2023-24", "2024-25", "2025-26", "2026-27"]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    paths = odds.download(args.out, SEASONS)
    listing = [{"name": p.name, "bytes": p.stat().st_size} for p in sorted(paths) if p.exists()]
    (args.out / "download_listing.json").write_text(json.dumps({"seasons": SEASONS, "files": listing}, indent=1), encoding="utf-8")
    print(f"{len(listing)} fichiers dans {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
