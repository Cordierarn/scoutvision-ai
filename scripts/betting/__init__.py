"""
Labo paris (scripts/betting) : cotes Winamax FR via OddsPapi, archive horodatée, appariement avec les
matchs PitchAPI, puis (phases suivantes) simulation, probabilités par marché, sélection et suivi.

Périmètre : Big 5, Championship, Liga Portugal, Eredivisie, Ligue des champions, Ligue Europa, Ligue Conférence ; bookmaker `winamax.fr` ; plan OddsPapi « normal ».
Tout ce qui est téléchargé vit sous `.research/betting/` (ignoré par Git). La clé API est lue dans
l'environnement (`ODDSPAPI_API_KEY`, ou `.env.local` à la racine du dépôt) et n'est jamais écrite.
"""

from __future__ import annotations

from pathlib import Path

SCHEMA_VERSION = "1.0.0"
BOOKMAKER = "winamax.fr"
SPORT_ID = 10  # football chez OddsPapi

# Tournois OddsPapi des compétitions ScoutVision (identifiants lus dans /v4/fixtures, phases 0 et 1)
TOURNAMENTS: dict[str, int] = {"ENG": 17, "ESP": 8, "GER": 35, "ITA": 23, "FRA": 34, "ENG2": 18, "POR": 238, "NED": 37,
                               "UCL": 7, "UEL": 679, "UECL": 34480}
BIG5 = ("ENG", "ESP", "GER", "ITA", "FRA")
COMPETITIONS = tuple(TOURNAMENTS)  # périmètre de l'archive : Big 5, Championship, Liga Portugal, Eredivisie, coupes d'Europe

ROOT = Path(__file__).resolve().parents[2]
RESEARCH = ROOT / ".research" / "betting"
