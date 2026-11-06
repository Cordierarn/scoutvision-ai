"""
Marchés d'équipe Winamax (catalogue OddsPapi) : probabilité d'une issue lue dans la simulation d'un match,
et règlement de cette issue sur le résultat réel.

Convention OddsPapi (vérifiée sur l'archive) : `period` ∈ fulltime / p1 (1re mi-temps) / p2 ; `handicap`
porte la ligne (totaux) ou le handicap ajouté aux buts de l'équipe 1 (domicile) ; `outcomeName` nomme
l'issue (« 1 », « X », « 2 », « Over », « Under », « Yes », « No », « 2:1 », « 3+ », « 1 By 2 », « X/1 »…).

Règlement (règles usuelles des paris football Winamax : temps réglementaire, prolongations exclues, but
contre son camp crédité à l'équipe bénéficiaire) : un résultat vaut 1 (gagné), 0 (perdu), 0.5 (moitié
gagnée, moitié remboursée), -0.5 (moitié perdue, moitié remboursée), None (remboursé). Handicaps et
totaux : ligne entière → remboursé en cas d'égalité ; ligne en quart → moitié de la mise sur chacune des
deux lignes voisines.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass

import numpy as np

from .simulate import Simulated

FAMILIES = {
    "1x2": "résultat", "doublechance": "résultat", "drawnobet": "résultat",
    "totals": "plus/moins", "teamtotals-team1": "plus/moins équipe", "teamtotals-team2": "plus/moins équipe",
    "spreads": "handicap asiatique",
    "correctscore": "score exact", "exactscore": "nombre de buts", "exactscore-team1": "nombre de buts équipe", "exactscore-team2": "nombre de buts équipe",
    "bothteamsscore": "BTTS / clean sheet", "cleansheet-team1": "BTTS / clean sheet", "cleansheet-team2": "BTTS / clean sheet",
    "wintonil-team1": "gagne sans encaisser", "wintonil-team2": "gagne sans encaisser",
    "toscoreinbh-team1": "mi-temps (équipe)", "toscoreinbh-team2": "mi-temps (équipe)", "winbothh-team1": "mi-temps (équipe)", "winbothh-team2": "mi-temps (équipe)",
    "wineitherh-team1": "mi-temps (équipe)", "wineitherh-team2": "mi-temps (équipe)",
    "winningmargin": "marge de victoire", "firstgoal": "premier / dernier but", "lastgoal": "premier / dernier but",
    "halftime-fulltime": "mi-temps / fin de match",
}
SUPPORTED = tuple(FAMILIES)


@dataclass(frozen=True)
class Result:
    """Résultat réel : buts par période, équipe du premier et du dernier but ('home', 'away', 'none')."""

    ft_home: int
    ft_away: int
    ht_home: int
    ht_away: int
    first_goal: str = "none"
    last_goal: str = "none"

    def period(self, period: str) -> tuple[int, int]:
        if period == "fulltime":
            return self.ft_home, self.ft_away
        if period == "p1":
            return self.ht_home, self.ht_away
        if period == "p2":
            return self.ft_home - self.ht_home, self.ft_away - self.ht_away
        raise ValueError(period)


@dataclass(frozen=True)
class Spec:
    market_type: str
    period: str
    handicap: float
    outcome: str

    @property
    def family(self) -> str:
        return FAMILIES[self.market_type]

    @property
    def segment(self) -> str:
        """Clé de segment de la porte de validation et des poids du pool : la famille, suffixée de la période quand le
        marché porte sur une mi-temps (« plus/moins (1re mi-temps) ») ; la famille seule au temps réglementaire."""
        return self.family if self.period == "fulltime" else f"{self.family} ({'1re' if self.period == 'p1' else '2e'} mi-temps)"


def _team(market_type: str) -> int:
    return 2 if market_type.endswith("team2") else 1


# ----- règlement vectorisé -----

def _line_outcome(value: np.ndarray, line: float, over: bool) -> np.ndarray:
    """Totaux et handicaps asiatiques : ligne entière (égalité remboursée = nan), demie, ou quart (moitié
    de la mise sur chaque ligne voisine). `value` = total de buts ou marge avec handicap."""
    if round(line * 4) % 2 == 1:  # .25 / .75
        return _combine_half(_line_outcome(value, line - 0.25, over), _line_outcome(value, line + 0.25, over))
    whole = float(line).is_integer()
    win = (value > line) if over else (value < line)
    out = win.astype(float)
    if whole:
        out = np.where(value == line, np.nan, out)
    return out


def _combine_half(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """Deux demi-mises : 1 & 1 → 1 ; 1 & nan → 0.5 ; 0 & nan → -0.5 ; 0 & 0 → 0 (1 & 0 est impossible sur
    deux lignes voisines)."""
    pa, pb = np.isnan(a), np.isnan(b)
    both = np.where(a == b, a, 0.0)
    return np.where(pa & pb, np.nan, np.where(pa, np.where(b == 1, 0.5, -0.5), np.where(pb, np.where(a == 1, 0.5, -0.5), both)))


def settle_arrays(spec: Spec, h, a, ht_h=None, ht_a=None, first=None, last=None) -> np.ndarray:
    """Règlement vectorisé : `h`, `a` = buts de la période du marché ; scores de mi-temps et équipe du
    premier / dernier but (0 aucun, 1 domicile, 2 extérieur) pour les marchés qui en dépendent.
    Renvoie un tableau float : 1, 0, 0.5, -0.5 ou nan (remboursé)."""
    t, name, line = spec.market_type, spec.outcome, spec.handicap
    h = np.asarray(h, dtype=float); a = np.asarray(a, dtype=float)
    sign = np.sign(h - a)
    if t == "1x2":
        return (sign == {"1": 1, "X": 0, "2": -1}[name]).astype(float)
    if t == "doublechance":
        return {"1X": sign >= 0, "12": sign != 0, "X2": sign <= 0, "2X": sign <= 0}[name].astype(float)
    if t == "drawnobet":
        return np.where(sign == 0, np.nan, (sign == (1 if name == "1" else -1)).astype(float))
    if t == "totals":
        return _line_outcome(h + a, line, name == "Over")
    if t in ("teamtotals-team1", "teamtotals-team2"):
        return _line_outcome(h if _team(t) == 1 else a, line, name == "Over")
    if t == "spreads":
        # handicap ajouté aux buts de l'équipe 1 : « 1 » gagne si h − a > −handicap, « 2 » si a − h > handicap ;
        # la ligne (et son éventuel quart) est le handicap lui-même
        return _line_outcome(h - a, -line, True) if name == "1" else _line_outcome(a - h, line, True)
    if t == "correctscore":
        sh, sa = (int(x) for x in name.split(":"))
        return ((h == sh) & (a == sa)).astype(float)
    if t in ("exactscore", "exactscore-team1", "exactscore-team2"):
        v = h + a if t == "exactscore" else (h if _team(t) == 1 else a)
        return ((v >= int(name[:-1])) if name.endswith("+") else (v == int(name))).astype(float)
    if t == "bothteamsscore":
        both = (h > 0) & (a > 0)
        return (both if name == "Yes" else ~both).astype(float)
    if t in ("cleansheet-team1", "cleansheet-team2"):
        cs = (a == 0) if _team(t) == 1 else (h == 0)
        return (cs if name == "Yes" else ~cs).astype(float)
    if t in ("wintonil-team1", "wintonil-team2"):
        ok = ((h > a) & (a == 0)) if _team(t) == 1 else ((a > h) & (h == 0))
        return (ok if name == "Yes" else ~ok).astype(float)
    if t == "winningmargin":
        if name == "Draw":
            return (sign == 0).astype(float)
        mt = re.match(r"([12]) By (\d+)(\+?)$", name)
        team, k, plus = int(mt.group(1)), int(mt.group(2)), mt.group(3) == "+"
        m = np.abs(h - a)
        side = sign == (1 if team == 1 else -1)
        return (side & ((m >= k) if plus else (m == k))).astype(float)
    ht_h = np.asarray(ht_h, dtype=float); ht_a = np.asarray(ht_a, dtype=float)
    sh_h, sh_a = h - ht_h, a - ht_a
    if t in ("toscoreinbh-team1", "toscoreinbh-team2"):
        ok = ((ht_h > 0) & (sh_h > 0)) if _team(t) == 1 else ((ht_a > 0) & (sh_a > 0))
        return (ok if name == "Yes" else ~ok).astype(float)
    if t in ("winbothh-team1", "winbothh-team2"):
        ok = ((ht_h > ht_a) & (sh_h > sh_a)) if _team(t) == 1 else ((ht_a > ht_h) & (sh_a > sh_h))
        return (ok if name == "Yes" else ~ok).astype(float)
    if t in ("wineitherh-team1", "wineitherh-team2"):
        ok = ((ht_h > ht_a) | (sh_h > sh_a)) if _team(t) == 1 else ((ht_a > ht_h) | (sh_a > sh_h))
        return (ok if name == "Yes" else ~ok).astype(float)
    if t == "halftime-fulltime":
        code = {"1": 1, "X": 0, "2": -1}
        p1, p2 = name.split("/")
        return ((np.sign(ht_h - ht_a) == code[p1]) & (sign == code[p2])).astype(float)
    if t in ("firstgoal", "lastgoal"):
        arr = np.asarray(first if t == "firstgoal" else last)
        return (arr == {"1": 1, "2": 2, "No Goal": 0}[name]).astype(float)
    raise ValueError(f"marché non pris en charge : {t}")


def settle(spec: Spec, result: Result) -> float | None:
    """Règlement scalaire sur le résultat réel : 1, 0, 0.5, -0.5 ou None (remboursé)."""
    h, a = result.period(spec.period)
    code = {"home": 1, "away": 2, "none": 0}
    out = settle_arrays(spec, np.array([h]), np.array([a]), np.array([result.ht_home]), np.array([result.ht_away]),
                        np.array([code[result.first_goal]]), np.array([code[result.last_goal]]))
    v = float(out[0])
    return None if math.isnan(v) else v


def outcome_distribution(spec: Spec, sims: Simulated) -> dict[str, float]:
    """Probabilités de règlement d'une issue dans la simulation : win, half_win, push, half_loss, loss."""
    h, a = sims.period(spec.period)
    out = settle_arrays(spec, h, a, sims.ht_home, sims.ht_away, sims.first_goal, sims.last_goal)
    n = out.size
    return {"win": float(np.sum(out == 1.0)) / n, "half_win": float(np.sum(out == 0.5)) / n, "push": float(np.sum(np.isnan(out))) / n,
            "half_loss": float(np.sum(out == -0.5)) / n, "loss": float(np.sum(out == 0.0)) / n}


def probability(spec: Spec, sims: Simulated) -> float:
    """Probabilité de gain de l'issue hors remboursement : P(gagné | non remboursé), les demi-mises comptant
    pour moitié. Vaut P(gagné) sur un marché sans remboursement."""
    d = outcome_distribution(spec, sims)
    settled = 1.0 - d["push"]
    if settled <= 0:
        return float("nan")
    return (d["win"] + 0.5 * d["half_win"] + 0.5 * d["half_loss"]) / settled


def expected_return(spec: Spec, sims: Simulated, odds: float) -> float:
    """Espérance du gain net pour 1 unité misée à la cote `odds`."""
    d = outcome_distribution(spec, sims)
    return d["win"] * (odds - 1) + d["half_win"] * (odds - 1) / 2 - d["half_loss"] / 2 - d["loss"]


def realised_return(settlement: float | None, odds: float) -> float:
    """Gain net réel pour 1 unité misée."""
    if settlement is None:
        return 0.0
    return {1.0: odds - 1, 0.5: (odds - 1) / 2, -0.5: -0.5, 0.0: -1.0}[settlement]


def is_complete(specs: list[Spec]) -> bool:
    """Un marché « complet » partitionne les issues (somme des probabilités 1) sans remboursement ni demi-mise."""
    if not specs:
        return False
    t = specs[0].market_type
    names = {s.outcome for s in specs}
    if t in ("1x2", "firstgoal", "lastgoal"):
        return len(names) == 3
    if t == "halftime-fulltime":
        return len(names) == 9
    if t in ("bothteamsscore", "cleansheet-team1", "cleansheet-team2", "wintonil-team1", "wintonil-team2", "toscoreinbh-team1", "toscoreinbh-team2",
             "winbothh-team1", "winbothh-team2", "wineitherh-team1", "wineitherh-team2"):
        return names == {"Yes", "No"}
    if t in ("totals", "teamtotals-team1", "teamtotals-team2"):
        return names == {"Over", "Under"} and round(specs[0].handicap * 2) % 2 == 1  # demi-ligne seulement
    if t == "spreads":
        return names == {"1", "2"} and round(specs[0].handicap * 2) % 2 == 1
    if t in ("exactscore", "exactscore-team1", "exactscore-team2"):
        plus = [int(n[:-1]) for n in names if n.endswith("+")]
        exact = {int(n) for n in names if not n.endswith("+")}
        return len(plus) == 1 and exact == set(range(plus[0]))
    if t == "winningmargin":
        plus = sorted(int(re.match(r"[12] By (\d+)\+$", n).group(1)) for n in names if n.endswith("+"))
        if "Draw" not in names or len(plus) != 2 or plus[0] != plus[1]:
            return False
        return all(f"{team} By {m}" in names for team in (1, 2) for m in range(1, plus[0]))
    return False  # score exact (pas d'issue « autre »), double chance et remboursé si nul : incomplets ou recouvrants


def devig_proportional(implied: np.ndarray) -> np.ndarray:
    """Probabilités sans marge d'un marché complet : normalisation proportionnelle des 1 / cote."""
    implied = np.asarray(implied, dtype=float)
    return implied / implied.sum()
