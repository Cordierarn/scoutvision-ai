"""
Appariement OddsPapi ↔ matchs PitchAPI : même compétition, coup d'envoi à ± 1 jour, similarité des noms
d'équipes (jetons normalisés, accents retirés, mots génériques ignorés) avec une table d'alias apprise.

Règles : un match n'est apparié que si le meilleur candidat dépasse le seuil et est unique ; un match
sans candidat suffisant est listé dans les échecs, jamais apparié « au plus proche ».
La table d'alias (`.research/betting/aliases.json`, ignorée par Git) associe un nom OddsPapi à un nom
PitchAPI ; elle s'enrichit des appariements validés et peut être complétée à la main.
"""

from __future__ import annotations

import json
import re
import unicodedata
from difflib import SequenceMatcher
from pathlib import Path

import pandas as pd

from . import RESEARCH

ALIASES_PATH = RESEARCH / "aliases.json"
THRESHOLD = 0.5
DAY_TOLERANCE = 1
# Seuls les sigles de forme juridique sont ignorés : « City », « United », « Real », « Atlético », « Athletic »
# distinguent des clubs d'une même ville et restent des jetons.
STOP = {"fc", "cf", "sc", "ac", "as", "ud", "cd", "sd", "rc", "afc", "de", "la", "el", "le", "les", "du", "des", "the", "calcio", "us", "ss",
        "ssc", "bk", "if", "fk", "sk", "sv", "vfb", "vfl", "tsg", "fsv", "bsc", "ca", "cs", "ks", "gks", "fbc", "spor", "kulubu", "ae", "pae",
        "ssd", "asd", "aso", "sa", "sg", "hsv", "ffc", "ii", "b", "cp", "sl", "ogc", "rcd", "osc", "ec", "krc", "kv", "kvc", "kaa", "rsc",
        "1", "1899", "04", "05", "09", "1900", "1904", "1906", "1907", "1909", "1910", "1919", "1860"}
FUZZY_RATIO = 0.75
SUBSET_SCORE = 0.9


SPECIAL = str.maketrans({"ł": "l", "Ł": "L", "ø": "o", "Ø": "O", "đ": "d", "Đ": "D", "ß": "ss", "æ": "ae", "Æ": "AE", "œ": "oe", "Œ": "OE", "ı": "i"})


def normalize(name: str) -> set[str]:
    s = unicodedata.normalize("NFKD", (name or "").translate(SPECIAL)).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"[^a-z0-9 ]", " ", s)
    return {t for t in s.split() if t not in STOP}


def _token_equal(x: str, y: str) -> bool:
    if x == y:
        return True
    if len(x) >= 4 and len(y) >= 4:
        return SequenceMatcher(None, x, y).ratio() >= FUZZY_RATIO
    return False


def similarity(a: str, b: str) -> float:
    """Jaccard des jetons avec égalité floue (« munchen » ≈ « munich ») ; un nom entièrement contenu dans
    l'autre (« Real Sociedad » ⊂ « Real Sociedad San Sebastian ») vaut au moins SUBSET_SCORE."""
    ta, tb = normalize(a), normalize(b)
    if not ta or not tb:
        return 0.0
    matched = 0
    rest = set(tb)
    for x in ta:
        hit = next((y for y in rest if _token_equal(x, y)), None)
        if hit is not None:
            matched += 1
            rest.discard(hit)
    jaccard = matched / (len(ta) + len(tb) - matched)
    if matched and (matched == len(ta) or matched == len(tb)):
        return max(jaccard, SUBSET_SCORE)
    return jaccard


def load_aliases(path: Path = ALIASES_PATH) -> dict[str, str]:
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


def save_aliases(aliases: dict[str, str], path: Path = ALIASES_PATH) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(dict(sorted(aliases.items())), ensure_ascii=False, indent=1), encoding="utf-8")


def team_score(oddspapi_name: str, pitchapi_name: str, aliases: dict[str, str]) -> float:
    if aliases.get(oddspapi_name) == pitchapi_name:
        return 1.0
    return similarity(oddspapi_name, pitchapi_name)


def match_fixtures(fixtures: pd.DataFrame, matches: pd.DataFrame, aliases: dict[str, str] | None = None,
                   threshold: float = THRESHOLD, day_tolerance: int = DAY_TOLERANCE) -> tuple[pd.DataFrame, pd.DataFrame]:
    """`fixtures` : fixture_id, competition, start_time (UTC), home_name, away_name.
    `matches` : match_id, competition, kickoff_utc, home_team_name, away_team_name.
    Renvoie (appariés[match_id, fixture_id, score], échecs[match_id, reason, best_fixture_id, best_score])."""
    aliases = aliases or {}
    fx = fixtures.copy()
    fx["day"] = pd.to_datetime(fx["start_time"], utc=True).dt.floor("D")
    by_comp = {c: g for c, g in fx.groupby("competition")}
    matched, failures = [], []
    for m in matches.itertuples(index=False):
        day = pd.Timestamp(m.kickoff_utc)
        day = (day.tz_localize("UTC") if day.tzinfo is None else day.tz_convert("UTC")).floor("D")
        cands = by_comp.get(m.competition)
        if cands is None:
            failures.append((m.match_id, "competition_absente", None, 0.0))
            continue
        window = cands[(cands["day"] - day).abs() <= pd.Timedelta(days=day_tolerance)]
        scored = sorted(((min(team_score(f.home_name, m.home_team_name, aliases), team_score(f.away_name, m.away_team_name, aliases)), f.fixture_id)
                         for f in window.itertuples(index=False)), key=lambda t: -t[0])
        if not scored or scored[0][0] <= 0:
            failures.append((m.match_id, "aucun_candidat", None, 0.0))
        elif scored[0][0] < threshold:
            failures.append((m.match_id, "score_insuffisant", scored[0][1], round(scored[0][0], 3)))
        elif len(scored) > 1 and scored[1][0] == scored[0][0]:
            failures.append((m.match_id, "ambigu", scored[0][1], round(scored[0][0], 3)))
        else:
            matched.append((m.match_id, scored[0][1], round(scored[0][0], 3)))
    return (pd.DataFrame(matched, columns=["match_id", "fixture_id", "score"]),
            pd.DataFrame(failures, columns=["match_id", "reason", "best_fixture_id", "best_score"]))


def learn_aliases(matched: pd.DataFrame, fixtures: pd.DataFrame, matches: pd.DataFrame, aliases: dict[str, str]) -> dict[str, str]:
    """Ajoute aux alias les paires de noms des appariements retenus (nom OddsPapi → nom PitchAPI)."""
    out = dict(aliases)
    f = fixtures.set_index("fixture_id")
    m = matches.set_index("match_id")
    for r in matched.itertuples(index=False):
        out.setdefault(f.loc[r.fixture_id, "home_name"], m.loc[r.match_id, "home_team_name"])
        out.setdefault(f.loc[r.fixture_id, "away_name"], m.loc[r.match_id, "away_team_name"])
    return out
