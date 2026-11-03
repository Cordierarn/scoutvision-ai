"""
Historique des soirées : les paris recommandés chaque soir, réglés sur les scores réels, avec cumul.

  cd scripts
  python3 -m betting.evening add --date 2026-11-02 --bets bets.json      enregistre les paris du soir (figés)
  python3 -m betting.evening auto --date 2026-11-02 [--profile equilibre] [--bankroll 300]
                                                                       paris du soir lus dans le journal des suggestions
                                                                       (dernière publication avant le coup d'envoi de chaque match)
  python3 -m betting.evening settle --date 2026-11-02 [--scores scores.json]
                                                                       règle la soirée : scores fournis, sinon résultats
                                                                       PitchAPI + web (results_web) par identifiant de match
  python3 -m betting.evening show                                      tableau des soirées et cumul

Fichiers (hors Git) : `.research/betting/product/evenings.json`. Un pari enregistré n'est jamais modifié ;
le règlement suit `markets.settle` (remboursements, demi-gains). Un combiné est réglé sélection par
sélection : une perdue → perdu ; une remboursée → sa cote est retirée.

`bets.json` : liste de {"match": "...", "label": "...", "spec": {market_type, period, handicap, outcome},
"odds": 1.52, "stake": 12.66} ou, pour un combiné, {"match": "...", "combo": [ {label, spec, odds, key}, ... ],
"stake": 8.36}. `scores.json` : {"clé du match": {"ft": [2, 0], "ht": [1, 0], "first_goal": "home",
"last_goal": "home"}} ; les buts de mi-temps sont nécessaires aux marchés de 1re mi-temps.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
from pathlib import Path

import pandas as pd

from . import RESEARCH
from . import markets as mk

EVENINGS = RESEARCH / "product" / "evenings.json"


def load() -> dict:
    return json.loads(EVENINGS.read_text(encoding="utf-8")) if EVENINGS.exists() else {"evenings": []}


def save(data: dict) -> None:
    EVENINGS.parent.mkdir(parents=True, exist_ok=True)
    EVENINGS.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")


def _spec(d: dict) -> mk.Spec:
    return mk.Spec(d["market_type"], d.get("period", "fulltime"), float(d.get("handicap", 0.0)), d["outcome"])


def _result(s: dict) -> mk.Result:
    ft, ht = s["ft"], s.get("ht") or [0, 0]
    return mk.Result(int(ft[0]), int(ft[1]), int(ht[0]), int(ht[1]), s.get("first_goal", "none"), s.get("last_goal", "none"))


def add(date: str, bets: list[dict]) -> dict:
    data = load()
    if any(e["date"] == date for e in data["evenings"]):
        raise SystemExit(f"La soirée {date} existe déjà : un pari enregistré n'est jamais modifié.")
    for b in bets:
        b["stake"] = round(float(b["stake"]), 2)
        b["result"] = None
        b["profit"] = None
    data["evenings"].append({"date": date, "recorded_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"), "bets": bets, "settled": False})
    save(data)
    return data["evenings"][-1]


def settle_bet(b: dict, scores: dict) -> tuple[str | None, float | None]:
    """Renvoie (résultat lisible, gain net) ou (None, None) si un score manque."""
    if "combo" in b:
        legs = []
        for leg in b["combo"]:
            s = scores.get(leg.get("key") or b.get("match"))
            if s is None:
                return None, None
            legs.append(mk.settle(_spec(leg["spec"]), _result(s)))
        if any(x in (0.0, -0.5) for x in legs):
            return "perdu", -b["stake"]
        odds = 1.0
        for leg, x in zip(b["combo"], legs):
            if x == 1.0:
                odds *= float(leg["odds"])
            elif x == 0.5:
                odds *= (1 + (float(leg["odds"]) - 1) / 2)
        return ("remboursé" if odds == 1.0 else "gagné"), round(b["stake"] * (odds - 1.0), 2)
    s = scores.get(b["match"])
    if s is None:
        return None, None
    x = mk.settle(_spec(b["spec"]), _result(s))
    label = {None: "remboursé", 1.0: "gagné", 0.0: "perdu", 0.5: "moitié gagnée", -0.5: "moitié perdue"}[x]
    return label, round(b["stake"] * mk.realised_return(x, float(b["odds"])), 2)


def auto_bets(date: str, profile: str = "equilibre", bankroll: float = 300.0) -> list[dict]:
    """Paris de la soirée depuis le journal : pour chaque match du jour, la dernière publication avant le coup
    d'envoi, profil choisi, mise = fraction publiée × bankroll (arrondie au centime)."""
    from .catalogue import load as load_catalogue
    from .product import JOURNAL
    if not JOURNAL.exists():
        return []
    cat = load_catalogue()
    j = pd.read_parquet(JOURNAL)
    j = j[(j["profile"] == profile) & (j["kickoff_utc"].astype(str).str.startswith(date)) & (j["published_at"] < j["kickoff_utc"])]
    bets = []
    for match_id, g in j.groupby("match_id"):
        last = g[g["published_at"] == g["published_at"].max()].sort_values("rank")
        for r in last.itertuples(index=False):
            spec = cat[int(r.market_id)].spec(int(r.outcome_id))
            bets.append({"match": match_id, "match_id": match_id, "label": r.label, "spec": {"market_type": spec.market_type, "period": spec.period, "handicap": spec.handicap, "outcome": spec.outcome},
                         "odds": float(r.odds), "stake": round(bankroll * float(r.stake_fraction), 2), "suggestion_id": r.suggestion_id})
    return bets


def scores_from_results(date: str) -> dict:
    """Scores des matchs du jour, par identifiant PitchAPI (résultats PitchAPI complétés par le web)."""
    from .product import load_results
    r = load_results()
    r = r[pd.to_datetime(r["kickoff_utc"], utc=True).dt.strftime("%Y-%m-%d") == date]
    return {m.match_id: {"ft": [int(m.ft_home), int(m.ft_away)], "ht": [int(m.ht_home), int(m.ht_away)], "first_goal": m.first_goal, "last_goal": m.last_goal} for m in r.itertuples()}


def settle(date: str, scores: dict) -> dict:
    data = load()
    ev = next((e for e in data["evenings"] if e["date"] == date), None)
    if ev is None:
        raise SystemExit(f"Aucune soirée {date}.")
    pending = 0
    for b in ev["bets"]:
        if b["result"] is not None:
            continue
        res, profit = settle_bet(b, scores)
        if res is None:
            pending += 1
            continue
        b["result"], b["profit"] = res, profit
    ev["settled"] = pending == 0
    ev["scores"] = {**ev.get("scores", {}), **scores}
    ev["stake"] = round(sum(b["stake"] for b in ev["bets"]), 2)
    ev["profit"] = round(sum(b["profit"] for b in ev["bets"] if b["profit"] is not None), 2)
    ev["won"] = sum(1 for b in ev["bets"] if b["result"] in ("gagné", "moitié gagnée"))
    save(data)
    return ev


def show() -> str:
    data = load()
    lines = [f"{'Soirée':10s} {'Paris':>5s} {'Gagnés':>6s} {'Misé':>9s} {'Gain net':>9s} {'Cumul':>9s}  État"]
    cumul = 0.0
    for e in data["evenings"]:
        profit = e.get("profit")
        cumul += profit or 0.0
        lines.append(f"{e['date']:10s} {len(e['bets']):5d} {e.get('won', 0):6d} {e.get('stake', sum(b['stake'] for b in e['bets'])):9.2f} {(profit if profit is not None else 0):9.2f} {cumul:9.2f}  {'réglée' if e.get('settled') else 'en attente'}")
    return "\n".join(lines)


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("add"); a.add_argument("--date", required=True); a.add_argument("--bets", type=Path, required=True)
    au = sub.add_parser("auto"); au.add_argument("--date", required=True); au.add_argument("--profile", default="equilibre"); au.add_argument("--bankroll", type=float, default=300.0)
    s = sub.add_parser("settle"); s.add_argument("--date", required=True); s.add_argument("--scores", type=Path)
    sub.add_parser("show")
    args = p.parse_args(argv)
    if args.cmd == "add":
        e = add(args.date, json.loads(args.bets.read_text(encoding="utf-8")))
        print(f"{len(e['bets'])} paris enregistrés pour {args.date}, misé {sum(b['stake'] for b in e['bets']):.2f} €")
    elif args.cmd == "auto":
        bets = auto_bets(args.date, args.profile, args.bankroll)
        if not bets:
            print(f"Aucune suggestion publiée avant coup d'envoi pour {args.date} (profil {args.profile}).")
        elif any(ev["date"] == args.date for ev in load()["evenings"]):
            print(f"Soirée {args.date} déjà enregistrée : inchangée.")
        else:
            e = add(args.date, bets)
            print(f"{len(e['bets'])} paris enregistrés pour {args.date} depuis le journal, misé {sum(b['stake'] for b in e['bets']):.2f} €")
    elif args.cmd == "settle":
        scores = json.loads(args.scores.read_text(encoding="utf-8")) if args.scores else scores_from_results(args.date)
        e = settle(args.date, scores)
        for b in e["bets"]:
            lab = b.get("label") or " + ".join(l["label"] for l in b["combo"])
            print(f"  {b['match']:34s} {lab:58s} {b.get('odds', '') if 'odds' in b else '':>5} mise {b['stake']:6.2f} € → {b['result'] or 'en attente':14s} {('' if b['profit'] is None else f'{b['profit']:+.2f} €')}")
        print(f"Soirée {args.date} : misé {e['stake']:.2f} €, gain net {e['profit']:+.2f} €, {e['won']} gagnés sur {len(e['bets'])}{'' if e['settled'] else ' (scores manquants)'}")
    print(show())
    return 0


if __name__ == "__main__":
    sys.exit(main())
