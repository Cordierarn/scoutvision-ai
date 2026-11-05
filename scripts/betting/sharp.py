"""
Référence « sharp » du Labo paris : probabilité juste d'une issue, lue dans les cotes de Pinnacle (sinon
Betfair Exchange) débarrassées de leur marge, et mouvement de ces cotes avant le match.

Pourquoi : le marché de clôture de Pinnacle est, sur toutes nos mesures, mieux calibré que notre simulation
(docs/betting-lab.md, phase 2 ; docs/forecast-research.md, poids du pool = 0). La probabilité de référence
d'un pari n'est donc pas celle du modèle mais un mélange p_ref ∝ p_modèle^w · p_sharp^(1−w), avec w = 0 tant
que l'étape 2 (porte de validation par segment) n'a pas montré qu'un segment mérite w > 0. L'espérance et la
mise se calculent ensuite sur la cote Winamax, là où le pari se joue.

Devigging : méthode de Shin (1993), qui attribue plus de marge aux outsiders qu'aux favoris (biais
favori-outsider), comparée à la méthode des puissances (p_i = q_i^k) et à la normalisation proportionnelle.
Toutes partent des probabilités implicites q_i = 1 / cote d'un marché complet (les issues se partagent la
probabilité 1).

Mouvement sharp : variation de p_sharp entre un relevé de référence (H−24, ou le plus ancien à au moins 3 h)
et le relevé courant, avec l'évolution de la limite de mise quand OddsPapi la fournit. Une baisse de la cote
d'une issue accompagnée d'une hausse de la limite (« limit-backed ») signe une prise de position
professionnelle ; dans le sens contraire d'une sélection, le coupe-circuit la refuse.
"""

from __future__ import annotations

import datetime as dt
import json
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pandas as pd

from . import RESEARCH, SHARP_BOOKMAKERS
from . import markets as mk

SHARP_MAX_AGE = dt.timedelta(hours=6)       # un relevé sharp plus vieux n'est pas une référence du moment
MOVE_REFERENCE = dt.timedelta(hours=24)     # relevé de référence du mouvement : H−24…
MOVE_MIN_GAP = dt.timedelta(hours=3)        # …ou, à défaut, le plus ancien à au moins 3 h du relevé courant
POOL_WEIGHTS = RESEARCH / "phase2" / "pool_weights.json"   # {"famille|compétition": w}, écrit par l'étape 2
TWO_WAY = ("totals", "teamtotals-team1", "teamtotals-team2", "spreads")


# ----- devigging -----

def implied(odds) -> np.ndarray:
    o = np.asarray(odds, dtype=float)
    if np.any(~np.isfinite(o)) or np.any(o <= 1.0):
        raise ValueError("cotes invalides")
    return 1.0 / o


def devig_proportional(q) -> np.ndarray:
    q = np.asarray(q, dtype=float)
    return q / q.sum()


def devig_power(q, tol: float = 1e-10) -> tuple[np.ndarray, float]:
    """p_i = q_i^k, k ≥ 1 tel que Σ p_i = 1 (dichotomie). Renvoie (p, k)."""
    q = np.asarray(q, dtype=float)
    if q.sum() <= 1.0:
        return q / q.sum(), 1.0
    lo, hi = 1.0, 1.0
    while (q ** hi).sum() > 1.0:
        hi *= 2.0
        if hi > 1e6:
            raise ValueError("marge trop forte pour la méthode des puissances")
    for _ in range(200):
        mid = 0.5 * (lo + hi)
        if (q ** mid).sum() > 1.0:
            lo = mid
        else:
            hi = mid
        if hi - lo < tol:
            break
    k = 0.5 * (lo + hi)
    p = q ** k
    return p / p.sum(), k


def devig_shin(q, tol: float = 1e-10) -> tuple[np.ndarray, float]:
    """Méthode de Shin : p_i = (√(z² + 4 (1 − z) q_i² / Σq) − z) / (2 (1 − z)), z ∈ [0, 1) tel que Σ p_i = 1.
    z est la part estimée de parieurs informés ; z = 0 redonne la normalisation proportionnelle des q_i / √Σq.
    Renvoie (p, z)."""
    q = np.asarray(q, dtype=float)
    total = q.sum()
    if total <= 1.0:
        return q / total, 0.0

    def probs(z: float) -> np.ndarray:
        return (np.sqrt(z * z + 4.0 * (1.0 - z) * q * q / total) - z) / (2.0 * (1.0 - z))

    lo, hi = 0.0, 1.0 - 1e-9
    if probs(lo).sum() < 1.0:
        return q / total, 0.0
    for _ in range(200):
        mid = 0.5 * (lo + hi)
        if probs(mid).sum() > 1.0:
            lo = mid
        else:
            hi = mid
        if hi - lo < tol:
            break
    z = 0.5 * (lo + hi)
    p = probs(z)
    return p / p.sum(), z


# ----- marché complet d'un bookmaker de référence -----

@dataclass
class Reference:
    """Probabilités justes d'un marché chez un bookmaker de référence, à un instant donné."""

    bookmaker: str
    market_id: int
    at: dt.datetime                       # date du relevé le plus récent du marché
    overround: float                      # Σ 1 / cote − 1
    z: float                              # paramètre de Shin
    shin: dict[int, float]                # outcome_id → probabilité (Shin)
    power: dict[int, float]               # outcome_id → probabilité (puissances)
    prices: dict[int, float]              # outcome_id → cote
    limits: dict[int, float] = field(default_factory=dict)   # outcome_id → limite de mise (si fournie)

    def probability(self, outcome_id: int, method: str = "shin") -> float | None:
        return (self.shin if method == "shin" else self.power).get(outcome_id)


def devig_complete(specs: list[mk.Spec]) -> bool:
    """Marché dont les issues se partagent la probabilité 1 : marchés complets au sens de `markets.is_complete`,
    plus les lignes à deux issues de plus/moins et de handicap quelle que soit la ligne (quart et entier
    compris : les remboursements sont symétriques, la marge se lit sur les deux prix)."""
    if not specs:
        return False
    t = specs[0].market_type
    names = {s.outcome for s in specs}
    if t in TWO_WAY:
        return names in ({"Over", "Under"}, {"1", "2"}) and len(specs) == 2
    return mk.is_complete(specs)


def latest_prices(snaps: pd.DataFrame, bookmaker: str, market_id: int, before: pd.Timestamp) -> pd.DataFrame:
    """Dernier relevé de chaque issue d'un marché chez `bookmaker`, strictement avant `before`."""
    s = snaps[(snaps["bookmaker"] == bookmaker) & (snaps["market_id"] == market_id) & (snaps["created_at"] < before) & snaps["player_id"].isna()]
    if s.empty:
        return s
    return s.sort_values("created_at").groupby("outcome_id", as_index=False).last()


def market_reference(snaps: pd.DataFrame, cat, market_id: int, before: pd.Timestamp, bookmakers=SHARP_BOOKMAKERS,
                     max_age: dt.timedelta | None = SHARP_MAX_AGE) -> Reference | None:
    """Référence d'un marché : premier bookmaker de la liste qui cote toutes ses issues (marché complet) dans
    un relevé récent (`max_age` avant `before`, None pour ne pas borner). None sinon : pas de référence, pas de
    pari (jamais une probabilité inventée)."""
    market = cat.get(int(market_id))
    if market is None or market.player_prop:
        return None
    for bookmaker in bookmakers:
        last = latest_prices(snaps, bookmaker, int(market_id), before)
        if last.empty:
            continue
        specs = [market.spec(int(o)) for o in last["outcome_id"]]
        if any(s is None for s in specs) or not devig_complete(specs):
            continue
        at = last["created_at"].max()
        if max_age is not None and (pd.Timestamp(before) - at) > max_age:
            continue
        prices = {int(o): float(p) for o, p in zip(last["outcome_id"], last["price"])}
        if any(p <= 1.0 for p in prices.values()):
            continue
        ids = list(prices)
        q = implied([prices[i] for i in ids])
        shin, z = devig_shin(q)
        power, _ = devig_power(q)
        limits = {int(o): float(l) for o, l in zip(last["outcome_id"], last["limit"]) if pd.notna(l)} if "limit" in last else {}
        return Reference(bookmaker, int(market_id), at.to_pydatetime(), float(q.sum() - 1.0), float(z), dict(zip(ids, shin.tolist())),
                         dict(zip(ids, power.tolist())), prices, limits)
    return None


# ----- probabilité de référence : pool modèle / sharp -----

def pool(p_model: float, p_sharp: float, w: float) -> float:
    """Pool logarithmique sur une issue et son complément : p ∝ p_m^w · p_s^(1−w), renormalisé. w = 0 → p_sharp."""
    w = min(1.0, max(0.0, float(w)))
    if w == 0.0:
        return float(p_sharp)
    if w == 1.0:
        return float(p_model)
    a = (p_model ** w) * (p_sharp ** (1.0 - w))
    b = ((1.0 - p_model) ** w) * ((1.0 - p_sharp) ** (1.0 - w))
    return float(a / (a + b)) if a + b > 0 else float(p_sharp)


class PoolWeights:
    """Poids w du modèle par segment famille × compétition : 0 par défaut (le marché sharp fait foi), relevé
    seulement par l'étape 2 quand le poids hors échantillon d'un segment est strictement positif."""

    def __init__(self, weights: dict[str, float] | None = None):
        self.weights = {k: float(v) for k, v in (weights or {}).items()}

    @classmethod
    def load(cls, path: Path = POOL_WEIGHTS) -> "PoolWeights":
        if path.exists():
            raw = json.loads(path.read_text(encoding="utf-8"))
            return cls(raw.get("weights", raw) if isinstance(raw, dict) else {})
        return cls()

    def weight(self, family: str, competition: str) -> float:
        return self.weights.get(f"{family}|{competition}", self.weights.get(family, 0.0))


# ----- mouvement sharp -----

@dataclass
class SharpMove:
    bookmaker: str
    from_at: dt.datetime
    to_at: dt.datetime
    p_from: float                 # probabilité Shin de l'issue au relevé de référence
    p_to: float                   # … au relevé courant
    limit_from: float | None      # limite de mise sur le marché (max des issues) à la référence, si fournie
    limit_to: float | None

    @property
    def delta(self) -> float:
        return self.p_to - self.p_from

    @property
    def limit_up(self) -> bool | None:
        if self.limit_from is None or self.limit_to is None:
            return None
        return self.limit_to > self.limit_from


def _reference_at(snaps: pd.DataFrame, bookmaker: str, market_id: int, now: pd.Timestamp) -> pd.Timestamp | None:
    s = snaps[(snaps["bookmaker"] == bookmaker) & (snaps["market_id"] == market_id) & (snaps["created_at"] < now)]
    if s.empty:
        return None
    before_h24 = s[s["created_at"] <= now - MOVE_REFERENCE]
    if not before_h24.empty:
        return before_h24["created_at"].max()
    old = s[s["created_at"] <= now - MOVE_MIN_GAP]
    return old["created_at"].min() if not old.empty else None


def sharp_move(snaps: pd.DataFrame, cat, market_id: int, outcome_id: int, now: pd.Timestamp, reference: Reference) -> SharpMove | None:
    """Mouvement de la probabilité Shin d'une issue chez le bookmaker de la référence courante, entre le relevé
    de référence (H−24, sinon le plus ancien à ≥ 3 h) et `reference` (relevé courant). None sans historique."""
    t0 = _reference_at(snaps, reference.bookmaker, int(market_id), pd.Timestamp(now))
    if t0 is None:
        return None
    then = market_reference(snaps, cat, market_id, t0 + pd.Timedelta(microseconds=1), bookmakers=(reference.bookmaker,), max_age=None)
    if then is None or outcome_id not in then.shin or outcome_id not in reference.shin:
        return None
    lim = lambda r: (max(r.limits.values()) if r.limits else None)
    return SharpMove(reference.bookmaker, then.at, reference.at, then.shin[outcome_id], reference.shin[outcome_id], lim(then), lim(reference))


def closing_reference(snaps: pd.DataFrame, cat, market_id: int, kickoff: pd.Timestamp) -> Reference | None:
    """Clôture sharp d'un marché : dernier relevé complet avant le coup d'envoi, sans borne d'âge (la clôture
    est le dernier prix connu, même vieux) ; sert au CLV."""
    return market_reference(snaps, cat, market_id, pd.Timestamp(kickoff), max_age=None)


def clv(odds_taken: float, p_fair_closing: float) -> float:
    """Closing line value : cote prise × probabilité juste de clôture − 1 (= cote prise / cote juste − 1)."""
    return float(odds_taken) * float(p_fair_closing) - 1.0
