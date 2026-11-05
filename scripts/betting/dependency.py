"""
Dépendance d'une équipe à un joueur clé, lue dans les données publiées de ScoutVision
(public/data/players/<saison>.json) : part de l'intermédiarité du réseau de passes (« Network betweenness »)
détenue par le joueur le plus central parmi les titulaires habituels, et son impact RAPM net.

Usage : à plus de 12 h du coup d'envoi, aucune composition n'est connue ; si l'équipe dépend fortement
d'un « hub » (McHale & Relton, 2018), la valeur d'un pari sur ce match repose en partie sur sa présence
incertaine. Le coupe-circuit ne bloque pas (règle réservée au cas où la valeur repose *principalement*
sur lui, qu'on ne sait pas mesurer), il abaisse le plafond de mise et signale le joueur. Sans données
(équipe absente de la saison, trop peu de matchs), aucune dépendance n'est affirmée.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from . import ROOT

PLAYERS_DIR = ROOT / "public" / "data" / "players"
REGULAR_SHARE = 0.4          # titulaire habituel : au moins 40 % des minutes de son équipe
MIN_MATCHES = 3
DEPENDENCY_SHARE = 0.30      # un joueur qui porte ≥ 30 % de l'intermédiarité des titulaires = forte dépendance


@dataclass(frozen=True)
class Dependency:
    player: str
    share: float             # part de l'intermédiarité des titulaires habituels
    rapm_net: float | None
    regulars: int

    @property
    def strong(self) -> bool:
        return self.share >= DEPENDENCY_SHARE and self.regulars >= 6

    def as_dict(self) -> dict:
        return {"player": self.player, "share": round(self.share, 3), "rapmNet": None if self.rapm_net is None else round(self.rapm_net, 3), "strong": self.strong}


class TeamDependencies:
    """Dépendances par identifiant d'équipe pour une saison ; calcul paresseux, données publiées seulement."""

    def __init__(self, rows: list[dict]):
        self.by_team: dict[str, list[dict]] = {}
        for r in rows:
            self.by_team.setdefault(str(r.get("Team ID")), []).append(r)
        self._cache: dict[str, Dependency | None] = {}

    @classmethod
    def load(cls, season: str, players_dir: Path = PLAYERS_DIR) -> "TeamDependencies":
        path = players_dir / f"{season}.json"
        if not path.exists():
            return cls([])
        raw = json.loads(path.read_text(encoding="utf-8"))
        cols = raw["columns"]
        keep = ["Team ID", "Player", "Matches played", "Minutes share", "Network betweenness", "RAPM net"]
        idx = {c: cols.index(c) for c in keep if c in cols}
        return cls([{c: row[i] for c, i in idx.items()} for row in raw["rows"]])

    def of(self, team_id: str | None) -> Dependency | None:
        if not team_id:
            return None
        if team_id not in self._cache:
            self._cache[team_id] = self._compute(team_id)
        return self._cache[team_id]

    def _compute(self, team_id: str) -> Dependency | None:
        num = lambda v: float(v) if isinstance(v, (int, float)) and v == v else None
        regulars = [r for r in self.by_team.get(team_id, []) if (num(r.get("Minutes share")) or 0.0) >= REGULAR_SHARE and (num(r.get("Matches played")) or 0) >= MIN_MATCHES]
        weights = [(r, num(r.get("Network betweenness"))) for r in regulars]
        weights = [(r, w) for r, w in weights if w is not None and w > 0]
        if len(weights) < 4:
            return None
        total = sum(w for _, w in weights)
        hub, w = max(weights, key=lambda x: x[1])
        return Dependency(str(hub.get("Player")), w / total if total > 0 else 0.0, num(hub.get("RAPM net")), len(regulars))
