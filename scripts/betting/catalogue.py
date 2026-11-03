"""Catalogue des marchés OddsPapi (football) : identifiants → type, période, ligne, issues. Lu dans
`.research/betting/markets_catalogue.json`, sinon téléchargé une fois via le client (cache 30 jours)."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from . import RESEARCH, SPORT_ID
from .markets import FAMILIES, Spec

CATALOGUE = RESEARCH / "markets_catalogue.json"


@dataclass(frozen=True)
class Market:
    market_id: int
    market_type: str
    period: str
    handicap: float
    outcomes: dict[int, str]   # outcome_id → nom
    player_prop: bool

    def spec(self, outcome_id: int) -> Spec | None:
        name = self.outcomes.get(outcome_id)
        if name is None or self.market_type not in FAMILIES:
            return None
        return Spec(self.market_type, self.period, float(self.handicap), name)


def load(path: Path = CATALOGUE, client=None) -> dict[int, Market]:
    if path.exists():
        raw = json.loads(path.read_text(encoding="utf-8"))
    else:
        if client is None:
            from .client import OddsPapiClient
            try:
                client = OddsPapiClient()
            except RuntimeError as exc:
                raise RuntimeError(f"Catalogue des marchés absent ({path}) et clé OddsPapi indisponible : lancer `betting.fetch fixtures` avec la clé pour le constituer. {exc}") from exc
        raw = client.markets(SPORT_ID)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(raw, ensure_ascii=False), encoding="utf-8")
    return parse(raw)


def parse(raw: list[dict]) -> dict[int, Market]:
    out = {}
    for m in raw:
        if m.get("sportId") not in (None, SPORT_ID):
            continue
        out[int(m["marketId"])] = Market(int(m["marketId"]), m["marketType"], m["period"], float(m.get("handicap") or 0.0),
                                         {int(o["outcomeId"]): o["outcomeName"] for o in m.get("outcomes", [])}, bool(m.get("playerProp")))
    return out
