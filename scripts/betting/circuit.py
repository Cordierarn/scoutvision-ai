"""
Coupe-circuit « pas de pari » et dimensionnement de la mise (étape 1 du moteur quantitatif du Labo paris).

Principe : par défaut le marché est efficient et la réponse est « pas de pari ». Une sélection n'est jouable
que si une référence sharp existe, si son espérance face à la probabilité de référence dépasse un seuil, et
si aucune des règles d'exclusion ne s'applique. Tout est calculé ici, en Python, à partir de constantes
figées ; le LLM ne fait que commenter le verdict.

Règles d'exclusion (code → sens) :
- reference_absente     : aucun marché complet chez Pinnacle ni Betfair Exchange pour cette issue ;
- ev_insuffisant        : EV < 2,5 % (handicap asiatique, plus/moins) ou < 4 % (autres marchés) ;
- winner_curse          : EV > 20 %, ou écart p_ref − p_sharp > 15 points : plus probablement une donnée
                          non observée qu'une erreur du marché (« anomalie suspecte ») ;
- sharp_contraire       : la probabilité sharp de la sélection a baissé depuis le relevé de référence avec
                          une limite de mise en hausse (mouvement limit-backed), ou a fortement baissé
                          quand la limite est inconnue ;
- favori_surperformant  : favori coté sous 1,55 dont l'équipe a nettement dépassé ses xG (OPD) sur ses
                          derniers matchs ;
- cote_minimale, cote_ancienne, famille_mal_calibree, probabilite_indisponible : règles antérieures,
  conservées (suggest.evaluate_candidates).

Avertissements (n'empêchent pas le pari, abaissent le plafond de mise) :
- dependance_joueur_cle : à plus de 12 h du coup d'envoi, une des deux équipes dépend fortement d'un
                          joueur dont la présence n'est pas connue ; plafond divisé par deux ;
- limite_inconnue       : OddsPapi ne fournit pas la limite de mise du bookmaker de référence.

Mise : Kelly rétréci f = κ · (p_ref · cote − 1) / (cote − 1), κ = 0,15 (Baker & McHale, 2013 : rétrécir la
fraction selon l'incertitude des paramètres ; jamais le Kelly plein), plafonnée à 2,5 % de la bankroll par
pari, 1 % au-delà d'une cote de 3,50, 5 % par match.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

from . import markets as mk
from .sharp import Reference, SharpMove, pool

EV_MIN_LOW_MARGIN = 0.025
EV_MIN = 0.04
LOW_MARGIN_FAMILIES = {"handicap asiatique", "plus/moins", "plus/moins équipe"}
EV_MAX = 0.20
EDGE_MAX = 0.15
FAVORITE_ODDS = 1.55
SHARP_MOVE = 0.015              # baisse de p_sharp (points) avec limite en hausse
SHARP_MOVE_STRONG = 0.03        # baisse sans information de limite
KAPPA = 0.15
CAP_PER_BET = 0.025
CAP_HIGH_ODDS = 0.01
HIGH_ODDS = 3.5
CAP_PER_MATCH = 0.05
DEPENDENCY_CAP_FACTOR = 0.5
LINEUP_HOURS = 12

BLOCK_LABELS = {
    "reference_absente": "pas de référence Pinnacle / Betfair pour ce marché",
    "ev_insuffisant": "espérance insuffisante face au marché sharp",
    "winner_curse": "écart au marché trop grand pour être crédible (anomalie suspecte)",
    "sharp_contraire": "mouvement sharp contraire (cote en baisse, limite en hausse)",
    "favori_surperformant": "favori qui vient de dépasser nettement ses xG",
    "cote_minimale": "cote sous le minimum",
    "cote_ancienne": "cote trop ancienne",
    "famille_mal_calibree": "famille mal calibrée dans cette compétition",
    "probabilite_indisponible": "probabilité du modèle indisponible",
}
WARNING_LABELS = {
    "dependance_joueur_cle": "forte dépendance à un joueur clé, composition inconnue : plafond de mise réduit",
    "limite_inconnue": "limite de mise du bookmaker de référence inconnue",
}


@dataclass
class Assessment:
    p_model: float
    p_sharp: float | None
    p_ref: float
    w: float
    ev: float | None                     # espérance pour 1 € sur la cote Winamax, face à p_ref
    edge: float | None                   # p_ref − p_sharp
    blocks: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    stake_fraction: float = 0.0
    sharp_bookmaker: str | None = None
    sharp_at: str | None = None
    sharp_overround: float | None = None
    move: dict | None = None

    @property
    def verdict(self) -> str:
        return "no_bet" if self.blocks else "bet"


def backed_team(spec: mk.Spec) -> str | None:
    """Équipe (« home » / « away ») dont la sélection parie la réussite, pour la règle du favori ; None sinon."""
    t, n = spec.market_type, spec.outcome
    if t in ("1x2", "drawnobet", "spreads"):
        return {"1": "home", "2": "away"}.get(n)
    if t == "doublechance":
        return {"1X": "home", "X2": "away", "2X": "away"}.get(n)
    if t in ("wintonil-team1", "winbothh-team1", "wineitherh-team1", "cleansheet-team1") and n == "Yes":
        return "home"
    if t in ("wintonil-team2", "winbothh-team2", "wineitherh-team2", "cleansheet-team2") and n == "Yes":
        return "away"
    if t == "winningmargin" and n != "Draw":
        return {"1": "home", "2": "away"}.get(n.split(" ")[0])
    return None


def shrink_kelly(p: float, odds: float, kappa: float = KAPPA) -> float:
    """Fraction de Kelly rétrécie : κ · (p · o − 1) / (o − 1), 0 sans avantage."""
    if odds <= 1.0 or p <= 0.0:
        return 0.0
    return max(0.0, kappa * (p * odds - 1.0) / (odds - 1.0))


def stake_cap(odds: float, dependency: bool) -> float:
    cap = CAP_HIGH_ODDS if odds > HIGH_ODDS else CAP_PER_BET
    return cap * (DEPENDENCY_CAP_FACTOR if dependency else 1.0)


def ev_threshold(family: str) -> float:
    return EV_MIN_LOW_MARGIN if family in LOW_MARGIN_FAMILIES else EV_MIN


def assess(p_model: float, odds: float, family: str, spec: mk.Spec, reference: Reference | None, outcome_id: int, w: float,
           move: SharpMove | None = None, overperforming: dict[str, bool] | None = None, dependency: dict[str, str | None] | None = None,
           hours_to_kickoff: float | None = None) -> Assessment:
    """Verdict et mise d'une sélection déjà admissible par les règles antérieures.

    `overperforming` : {"home": bool, "away": bool} (OPD) ; `dependency` : {"home": nom du hub ou None, "away": …}.
    """
    p_sharp = reference.probability(outcome_id) if reference is not None else None
    if p_sharp is None:
        a = Assessment(p_model, None, p_model, w, None, None, blocks=["reference_absente"])
        return a
    p_ref = pool(p_model, p_sharp, w)
    ev = p_ref * odds - 1.0
    a = Assessment(p_model, p_sharp, p_ref, w, ev, p_ref - p_sharp, sharp_bookmaker=reference.bookmaker, sharp_at=reference.at.isoformat(),
                   sharp_overround=reference.overround)
    if ev < ev_threshold(family):
        a.blocks.append("ev_insuffisant")
    if ev > EV_MAX or (p_ref - p_sharp) > EDGE_MAX:
        a.blocks.append("winner_curse")
    if move is not None:
        a.move = {"from": move.from_at.isoformat(), "to": move.to_at.isoformat(), "pFrom": round(move.p_from, 4), "pTo": round(move.p_to, 4),
                  "limitFrom": move.limit_from, "limitTo": move.limit_to}
        if move.limit_up is None:
            a.warnings.append("limite_inconnue")
            if move.delta <= -SHARP_MOVE_STRONG:
                a.blocks.append("sharp_contraire")
        elif move.limit_up and move.delta <= -SHARP_MOVE:
            a.blocks.append("sharp_contraire")
    team = backed_team(spec)
    if team and odds < FAVORITE_ODDS and (overperforming or {}).get(team):
        a.blocks.append("favori_surperformant")
    dependent = None
    if hours_to_kickoff is not None and hours_to_kickoff > LINEUP_HOURS and dependency:
        names = [n for n in (dependency.get("home"), dependency.get("away")) if n]
        if names:
            dependent = names
            a.warnings.append("dependance_joueur_cle")
    if not a.blocks:
        a.stake_fraction = round(min(stake_cap(odds, bool(dependent)), shrink_kelly(p_ref, odds)), 4)
    return a


def cap_match(fractions: list[float], cap: float = CAP_PER_MATCH) -> list[float]:
    """Mises d'un même match plafonnées ensemble : réduction proportionnelle au-delà de `cap`."""
    total = sum(fractions)
    if total <= cap or total <= 0:
        return [round(f, 4) for f in fractions]
    return [math.floor(f * cap / total * 1e4) / 1e4 for f in fractions]     # arrondi par défaut : la somme reste ≤ cap
