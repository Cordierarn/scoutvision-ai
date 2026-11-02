"""
Moteur de suggestions de paris (produit Labo paris, onglet « Matchs à venir »).

Pour un match : toutes les issues de tous les marchés Winamax relevés sont évaluées dans la simulation
(probabilité, espérance pour 1 €), filtrées (cote < 1,30, relevé de plus de 2 h, famille × compétition mal
calibrée en phase 2), classées selon le profil, dédoublonnées (deux paris quasi identiques du même match :
on garde le mieux classé), puis un combiné de 2 ou 3 sélections compatibles est proposé quand il a du sens.

Profils :
- « Sûr » : probabilité la plus forte, cote ≥ 1,30 ;
- « Équilibré » : score = probabilité × (1 + espérance) = p² × cote, c'est-à-dire la probabilité pondérée par
  le multiplicateur attendu de la mise : un pari très probable mais mal payé et un pari bien payé mais
  improbable sont tous deux pénalisés ;
- « Grosse cote » : cote ≥ 3,00, meilleure espérance.

Mises (fraction de la bankroll, calculée ici ; le navigateur n'applique que la bankroll saisie) : quart de
Kelly f = (p × cote − 1) / (cote − 1) / 4, plafonné à 5 % par pari et 15 % par match ; espérance négative →
mise fixe de 2 % signalée comme telle.
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field

import numpy as np

from . import markets as mk
from .simulate import Simulated

PROFILES = ("sur", "equilibre", "grosse_cote")
PROFILE_LABELS = {"sur": "Sûr", "equilibre": "Équilibré", "grosse_cote": "Grosse cote"}
MIN_ODDS = 1.30
BIG_ODDS = 3.00
MAX_AGE = dt.timedelta(hours=2)
MAX_SUGGESTIONS = 5
MIN_SUGGESTIONS = 3
KELLY_FRACTION = 0.25
CAP_PER_BET = 0.05
CAP_PER_MATCH = 0.15
FIXED_STAKE = 0.02
COMBO_MIN_SELECTIONS, COMBO_MAX_SELECTIONS = 2, 3


@dataclass
class Candidate:
    market_id: int
    outcome_id: int
    spec: mk.Spec
    odds: float
    odds_at: dt.datetime
    p: float                      # probabilité de gain (hors remboursement)
    ev: float                     # espérance pour 1 € misé
    win_mask: np.ndarray = field(repr=False)   # tirages où l'issue est gagnée (pour les combinés)
    group: str = ""
    label: str = ""
    excluded: str | None = None   # raison d'exclusion, None si admissible

    @property
    def family(self) -> str:
        return self.spec.family


@dataclass
class Suggestion:
    candidate: Candidate
    rank: int
    score: float
    stake_fraction: float
    stake_mode: str               # kelly | fixed


@dataclass
class Combo:
    candidates: list[Candidate]
    joint_p: float
    odds: float
    ev: float
    score: float
    stake_fraction: float
    stake_mode: str


# ----- évaluation des issues -----

def evaluate_candidates(sims: Simulated, outcomes: list[dict], kickoff: dt.datetime, now: dt.datetime,
                        excluded_families: set[tuple[str, str]] = frozenset(), competition: str = "") -> list[Candidate]:
    """`outcomes` : dicts {market_id, outcome_id, spec, odds, odds_at}. Chaque issue reçoit p, espérance, groupe
    de doublons et, le cas échéant, sa raison d'exclusion."""
    out = []
    for o in outcomes:
        spec: mk.Spec = o["spec"]
        h, a = sims.period(spec.period)
        settled = mk.settle_arrays(spec, h, a, sims.ht_home, sims.ht_away, sims.first_goal, sims.last_goal)
        n = settled.size
        win, half_win, push, half_loss, loss = (np.sum(settled == 1.0) / n, np.sum(settled == 0.5) / n, np.sum(np.isnan(settled)) / n,
                                                np.sum(settled == -0.5) / n, np.sum(settled == 0.0) / n)
        settled_share = 1.0 - push
        p = (win + 0.5 * half_win + 0.5 * half_loss) / settled_share if settled_share > 0 else float("nan")
        odds = float(o["odds"])
        ev = win * (odds - 1) + half_win * (odds - 1) / 2 - half_loss / 2 - loss
        c = Candidate(int(o["market_id"]), int(o["outcome_id"]), spec, odds, o["odds_at"], float(p), float(ev), settled == 1.0,
                      group=dedupe_group(spec), label=describe(spec, o.get("home", "Domicile"), o.get("away", "Extérieur")))
        if odds < MIN_ODDS:
            c.excluded = "cote_minimale"
        elif o["odds_at"] is None or (now - o["odds_at"]) > MAX_AGE or o["odds_at"] >= kickoff:
            c.excluded = "cote_ancienne"
        elif (spec.family, competition) in excluded_families:
            c.excluded = "famille_mal_calibree"
        elif not np.isfinite(p) or p <= 0:
            c.excluded = "probabilite_indisponible"
        out.append(c)
    return out


def dedupe_group(spec: mk.Spec) -> str:
    """Clé des paris quasi identiques d'un même match (même direction sur le même objet)."""
    t, n, per = spec.market_type, spec.outcome, spec.period
    if t in ("1x2", "drawnobet"):
        return f"{ {'1': 'home', 'X': 'draw', '2': 'away'}[n] }|{per}"
    if t == "doublechance":
        return f"{ {'1X': 'home', 'X2': 'away', '2X': 'away', '12': 'nodraw'}[n] }|{per}"
    if t == "spreads":
        return f"{'home' if n == '1' else 'away'}|{per}"
    if t in ("wintonil-team1", "winbothh-team1", "wineitherh-team1"):
        return f"{'home' if n == 'Yes' else 'nothome'}|{per}"
    if t in ("wintonil-team2", "winbothh-team2", "wineitherh-team2"):
        return f"{'away' if n == 'Yes' else 'notaway'}|{per}"
    if t == "totals":
        return f"{'over' if n == 'Over' else 'under'}|{per}"
    if t == "exactscore":
        return f"{'over' if n.endswith('+') else 'exact-total'}|{per}"
    if t in ("teamtotals-team1", "exactscore-team1"):
        return f"{'team1-over' if n in ('Over',) or n.endswith('+') else 'team1-under' if n == 'Under' else 'team1-exact'}|{per}"
    if t in ("teamtotals-team2", "exactscore-team2"):
        return f"{'team2-over' if n in ('Over',) or n.endswith('+') else 'team2-under' if n == 'Under' else 'team2-exact'}|{per}"
    if t == "bothteamsscore":
        return f"{'btts' if n == 'Yes' else 'nobtts'}|{per}"
    if t == "cleansheet-team1":
        return f"{'team2-under' if n == 'Yes' else 'team2-over'}|{per}"
    if t == "cleansheet-team2":
        return f"{'team1-under' if n == 'Yes' else 'team1-over'}|{per}"
    if t in ("toscoreinbh-team1", "toscoreinbh-team2"):
        return f"{t}|{n}"
    return f"{t}|{per}"


def describe(spec: mk.Spec, home: str, away: str) -> str:
    """Libellé en clair d'une sélection."""
    t, n, h, per = spec.market_type, spec.outcome, spec.handicap, spec.period
    team = {1: home, 2: away}
    suffix = {"fulltime": "", "p1": " (1re mi-temps)", "p2": " (2e mi-temps)"}[per]
    line = f"{h:g}".replace(".", ",")
    if t == "1x2":
        base = {"1": f"{home} gagne", "X": "Match nul", "2": f"{away} gagne"}[n]
    elif t == "doublechance":
        base = {"1X": f"{home} gagne ou nul", "12": f"{home} ou {away} gagne", "X2": f"{away} gagne ou nul", "2X": f"{away} gagne ou nul"}[n]
    elif t == "drawnobet":
        base = f"{team[int(n)]} gagne, remboursé si nul"
    elif t == "totals":
        base = f"{'Plus' if n == 'Over' else 'Moins'} de {line} buts"
    elif t in ("teamtotals-team1", "teamtotals-team2"):
        base = f"{team[1 if t.endswith('team1') else 2]} : {'plus' if n == 'Over' else 'moins'} de {line} buts"
    elif t == "spreads":
        tm = team[int(n)]
        hh = h if n == "1" else -h
        base = f"{tm} avec handicap {hh:+g}".replace(".", ",")
    elif t == "correctscore":
        base = f"Score exact {n.replace(':', '-')}"
    elif t == "exactscore":
        base = f"{n.replace('+', ' buts ou plus') if n.endswith('+') else n + ' but' + ('s' if n != '1' else '')} dans le match"
    elif t in ("exactscore-team1", "exactscore-team2"):
        base = f"{team[1 if t.endswith('team1') else 2]} : {n.replace('+', ' buts ou plus') if n.endswith('+') else n + ' but' + ('s' if n != '1' else '')}"
    elif t == "bothteamsscore":
        base = "Les deux équipes marquent" if n == "Yes" else "Au moins une équipe ne marque pas"
    elif t in ("cleansheet-team1", "cleansheet-team2"):
        tm = team[1 if t.endswith('team1') else 2]
        base = f"{tm} n'encaisse pas" if n == "Yes" else f"{tm} encaisse au moins un but"
    elif t in ("wintonil-team1", "wintonil-team2"):
        tm = team[1 if t.endswith('team1') else 2]
        base = f"{tm} gagne sans encaisser" if n == "Yes" else f"{tm} ne gagne pas sans encaisser"
    elif t in ("toscoreinbh-team1", "toscoreinbh-team2"):
        tm = team[1 if t.endswith('team1') else 2]
        base = f"{tm} marque dans les deux mi-temps" if n == "Yes" else f"{tm} ne marque pas dans les deux mi-temps"
    elif t in ("winbothh-team1", "winbothh-team2"):
        tm = team[1 if t.endswith('team1') else 2]
        base = f"{tm} gagne les deux mi-temps" if n == "Yes" else f"{tm} ne gagne pas les deux mi-temps"
    elif t in ("wineitherh-team1", "wineitherh-team2"):
        tm = team[1 if t.endswith('team1') else 2]
        base = f"{tm} gagne au moins une mi-temps" if n == "Yes" else f"{tm} ne gagne aucune mi-temps"
    elif t == "winningmargin":
        if n == "Draw":
            base = "Match nul"
        else:
            tm, k = n.split(" By ")
            base = f"{team[int(tm)]} gagne de {k.replace('+', ' buts ou plus')}{'' if '+' in k else ' but' + ('s' if k != '1' else '')}"
    elif t in ("firstgoal", "lastgoal"):
        what = "Premier" if t == "firstgoal" else "Dernier"
        base = "Aucun but" if n == "No Goal" else f"{what} but pour {team[int(n)]}"
    elif t == "halftime-fulltime":
        a, b = n.split("/")
        lab = {"1": home, "X": "nul", "2": away}
        base = f"Mi-temps {lab[a]} / fin de match {lab[b]}"
    else:
        base = f"{t} {n}"
    return base + suffix


# ----- classement -----

def score(c: Candidate, profile: str) -> float:
    if profile == "sur":
        return c.p
    if profile == "equilibre":
        return c.p * (1.0 + c.ev)
    if profile == "grosse_cote":
        return c.ev
    raise ValueError(profile)


def admissible(c: Candidate, profile: str) -> bool:
    if c.excluded:
        return False
    if profile == "grosse_cote" and c.odds < BIG_ODDS:
        return False
    return True


def kelly_fraction(p: float, odds: float) -> float:
    """Fraction de Kelly entière (avant le quart) pour une issue sans remboursement ; 0 si pas d'avantage."""
    if odds <= 1.0:
        return 0.0
    return max(0.0, (p * odds - 1.0) / (odds - 1.0))


def stake_for(p: float, odds: float, ev: float) -> tuple[float, str]:
    if ev <= 0:
        return FIXED_STAKE, "fixed"
    return min(CAP_PER_BET, KELLY_FRACTION * kelly_fraction(p, odds)), "kelly"


def rank(candidates: list[Candidate], profile: str, max_n: int = MAX_SUGGESTIONS) -> list[Suggestion]:
    """Classement d'un profil : admissibles, triés par score, un seul pari par groupe de doublons, mises
    plafonnées par match."""
    ok = sorted((c for c in candidates if admissible(c, profile)), key=lambda c: score(c, profile), reverse=True)
    seen, chosen = set(), []
    for c in ok:
        if c.group in seen:
            continue
        seen.add(c.group)
        chosen.append(c)
        if len(chosen) >= max_n:
            break
    out = []
    for i, c in enumerate(chosen, 1):
        f, mode = stake_for(c.p, c.odds, c.ev)
        out.append(Suggestion(c, i, score(c, profile), f, mode))
    total = sum(s.stake_fraction for s in out)
    if total > CAP_PER_MATCH:
        for s in out:
            s.stake_fraction *= CAP_PER_MATCH / total
    for s in out:
        s.stake_fraction = round(s.stake_fraction, 4)
    return out


def combine(suggestions: list[Suggestion], profile: str) -> Combo | None:
    """Combiné de 2 ou 3 sélections de groupes différents, compatibles (co-occurrence possible) et non
    emboîtées (l'une n'implique pas l'autre), probabilité jointe lue dans la simulation, cote = produit.
    Proposé quand il a du sens : espérance jointe ≥ 0, ou profil « Sûr » avec probabilité jointe ≥ 0,45."""
    cands = [s.candidate for s in suggestions]
    best = None
    for k in range(COMBO_MIN_SELECTIONS, COMBO_MAX_SELECTIONS + 1):
        for combo in _combinations(cands, k):
            if len({c.group.split("|")[0] for c in combo}) < k:
                continue
            mask = np.logical_and.reduce([c.win_mask for c in combo])
            joint = float(mask.mean())
            if joint <= 0 or any(abs(joint - c.win_mask.mean()) < 1e-12 for c in combo):
                continue  # incompatibles, ou emboîtées
            odds = float(np.prod([c.odds for c in combo]))
            ev = joint * odds - 1.0
            sc = {"sur": joint, "equilibre": joint * (1 + ev), "grosse_cote": ev}[profile]
            if profile == "grosse_cote" and odds < BIG_ODDS:
                continue
            if best is None or sc > best[0]:
                best = (sc, combo, joint, odds, ev)
    if best is None:
        return None
    sc, combo, joint, odds, ev = best
    if not (ev >= 0 or (profile == "sur" and joint >= 0.45)):
        return None
    f, mode = stake_for(joint, odds, ev)
    return Combo(list(combo), joint, odds, ev, sc, round(min(f, CAP_PER_BET), 4), mode)


def _combinations(items, k):
    n = len(items)
    if k == 2:
        for i in range(n):
            for j in range(i + 1, n):
                yield (items[i], items[j])
    elif k == 3:
        for i in range(n):
            for j in range(i + 1, n):
                for l in range(j + 1, n):
                    yield (items[i], items[j], items[l])
