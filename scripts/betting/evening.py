"""
Historique des soirées : les paris recommandés chaque soir, réglés sur les scores réels, avec cumul.

  cd scripts
  python3 -m betting.evening add --date 2026-11-02 --bets bets.json      enregistre les paris du soir (figés)
  python3 -m betting.evening rebuild [--profile equilibre] [--bankroll 300]
                                                                       soirées reconstruites depuis le journal des suggestions
                                                                       (dernière publication avant le coup d'envoi de chaque
                                                                       match), mises sur la bankroll courante, plafonnées
  python3 -m betting.evening settle --date 2026-11-02 [--scores scores.json]
                                                                       règle la soirée : scores fournis, sinon résultats
                                                                       PitchAPI + web (results_web) par identifiant de match
  python3 -m betting.evening settle --pending                          règle à nouveau les soirées des 7 derniers jours (scores corrigés compris)
  python3 -m betting.evening show                                      tableau des soirées et cumul

Fichiers (hors Git) : `.research/betting/product/evenings.json`. Une soirée saisie à la main n'est jamais modifiée ;
une soirée reconstruite depuis le journal (immuable) en est une projection, recalculée à chaque passage ; le règlement suit `markets.settle` (remboursements, demi-gains). Un combiné est réglé sélection par
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
import math
import sys
from pathlib import Path

import pandas as pd

from . import RESEARCH
from . import markets as mk
from .suggest import PROFILES

EVENINGS = RESEARCH / "product" / "evenings.json"


def load() -> dict:
    return json.loads(EVENINGS.read_text(encoding="utf-8")) if EVENINGS.exists() else {"evenings": []}


def save(data: dict) -> None:
    EVENINGS.parent.mkdir(parents=True, exist_ok=True)
    EVENINGS.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")


def _spec(d: dict) -> mk.Spec:
    return mk.Spec(d["market_type"], d.get("period", "fulltime"), float(d.get("handicap", 0.0)), d["outcome"])


def _result(s: dict) -> mk.Result:
    """Score d'un match : mi-temps et ordre des buts absents restent inconnus (jamais 0-0)."""
    ft, ht = s["ft"], s.get("ht") or [None, None]
    return mk.result_from(ft[0], ft[1], ht[0], ht[1], s.get("first_goal"), s.get("last_goal"))


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


MISSING_SCORE = object()      # score d'un match du pari absent : le règlement connu est conservé


def settle_bet(b: dict, scores: dict):
    """Renvoie (résultat lisible, gain net), (None, None) si un marché du pari ne peut pas être réglé avec le score
    connu (mi-temps ou ordre des buts inconnus : en attente), ou MISSING_SCORE si un score manque."""
    try:
        return _settle_bet(b, scores)
    except mk.MissingResult:
        return None, None


def _settle_bet(b: dict, scores: dict):
    if "combo" in b:
        legs = []
        for leg in b["combo"]:
            s = scores.get(leg.get("key") or b.get("match"))
            if s is None:
                return MISSING_SCORE
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
        return MISSING_SCORE
    x = mk.settle(_spec(b["spec"]), _result(s))
    label = {None: "remboursé", 1.0: "gagné", 0.0: "perdu", 0.5: "moitié gagnée", -0.5: "moitié perdue"}[x]
    return label, round(b["stake"] * mk.realised_return(x, float(b["odds"])), 2)


START_BANKROLL = 300.0


def journal_bets(profile: str = "equilibre") -> dict[str, list[dict]]:
    """Paris de chaque soirée (date UTC du coup d'envoi) depuis le journal : pour chaque match, la dernière publication du
    profil avant le coup d'envoi, avec sa fraction de mise publiée."""
    from .catalogue import load as load_catalogue
    from .product import JOURNAL
    if not JOURNAL.exists():
        return {}
    cat = load_catalogue()
    j = pd.read_parquet(JOURNAL)
    j = j[(j["profile"] == profile) & (j["kind"] == "simple") & (j["published_at"] < j["kickoff_utc"])]
    out: dict[str, list[dict]] = {}
    for match_id, g in j.groupby("match_id"):
        last = g[g["published_at"] == g["published_at"].max()].sort_values("rank")
        for r in last.itertuples(index=False):
            spec = cat[int(r.market_id)].spec(int(r.outcome_id))
            out.setdefault(str(r.kickoff_utc)[:10], []).append({
                "match": match_id, "match_id": match_id, "label": r.label, "odds": float(r.odds), "fraction": float(r.stake_fraction), "suggestion_id": r.suggestion_id,
                "spec": {"market_type": spec.market_type, "period": spec.period, "handicap": spec.handicap, "outcome": spec.outcome}})
    return out


def is_auto(ev: dict) -> bool:
    """Soirée produite à partir du journal (chaque pari porte son identifiant de suggestion), par opposition à une soirée
    saisie à la main (`add`), qui n'est jamais modifiée."""
    return bool(ev.get("bets")) and all(b.get("suggestion_id") for b in ev["bets"])


def capped_stakes(fractions: list[float], bankroll: float) -> list[float]:
    """Mises d'une soirée : fraction publiée × bankroll courante, ramenées proportionnellement à la bankroll si leur somme
    la dépasse (arrondi au centime par défaut : la somme ne dépasse jamais la bankroll)."""
    if bankroll <= 0:
        return [0.0 for _ in fractions]
    stakes = [round(bankroll * f, 2) for f in fractions]
    total = sum(stakes)
    if total > bankroll:
        stakes = [math.floor(s * bankroll / total * 100) / 100 for s in stakes]
    return stakes


def rebuild(today: dt.date, profile: str = "equilibre", bankroll: float = START_BANKROLL) -> list[dict]:
    """Soirées suivies, reconstruites à partir du journal (immuable) jusqu'à la veille de `today` : chaque soirée mise sur la
    bankroll courante (départ + gains nets des soirées précédentes, manuelles comprises), jamais plus que cette bankroll,
    puis est réglée sur les scores connus. Une soirée est une projection du journal : la reconstruire est idempotent, et
    un règlement corrigé ou une règle de mise corrigée s'y propagent. Les soirées saisies à la main ne changent pas."""
    data = load()
    existing = {e["date"]: e for e in data["evenings"]}
    by_date = {d: bets for d, bets in journal_bets(profile).items() if dt.date.fromisoformat(d) < today}
    dates = sorted(set(by_date) | {d for d, e in existing.items() if not is_auto(e)})
    out, bank = [], bankroll
    for d in dates:
        if d in existing and not is_auto(existing[d]):
            ev = existing[d]
        else:
            fractions = [b["fraction"] for b in by_date[d]]
            bets = [{**b, "stake": s, "result": None, "profit": None} for b, s in zip(by_date[d], capped_stakes(fractions, bank))]
            ev = {"date": d, "recorded_at": existing.get(d, {}).get("recorded_at") or dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
                  "profile": profile, "bankroll": round(bank, 2), "bets": bets, "settled": False}
            scores: dict = {}
            d0 = dt.date.fromisoformat(d)
            for k in range((today - d0).days + 1):
                scores.update(scores_from_results((d0 + dt.timedelta(days=k)).isoformat()))
            _settle_evening(ev, scores)
        out.append(ev)
        bank = round(bank + (ev.get("profit") or 0.0), 2)
    data["evenings"] = out
    save(data)
    return out


def scores_from_results(date: str) -> dict:
    """Scores des matchs du jour, par identifiant PitchAPI (résultats PitchAPI complétés par le web) ; mi-temps et ordre
    des buts inconnus valent None."""
    from .product import load_results
    r = load_results()
    r = r[pd.to_datetime(r["kickoff_utc"], utc=True).dt.strftime("%Y-%m-%d") == date]
    out = {}
    for m in r.itertuples():
        res = mk.result_from_row(m)
        out[m.match_id] = {"ft": [res.ft_home, res.ft_away], "ht": [res.ht_home, res.ht_away] if res.has_half_time else None,
                           "first_goal": res.first_goal, "last_goal": res.last_goal}
    return out


def _settle_evening(ev: dict, scores: dict) -> dict:
    for b in ev["bets"]:
        out = settle_bet(b, scores)
        if out is MISSING_SCORE:
            continue
        b["result"], b["profit"] = out
    ev["settled"] = all(b["result"] is not None for b in ev["bets"])
    ev["scores"] = {**ev.get("scores", {}), **scores}
    ev["stake"] = round(sum(b["stake"] for b in ev["bets"]), 2)
    ev["profit"] = round(sum(b["profit"] for b in ev["bets"] if b["profit"] is not None), 2)
    ev["won"] = sum(1 for b in ev["bets"] if b["result"] in ("gagné", "moitié gagnée"))
    return ev


def settle(date: str, scores: dict) -> dict | None:
    """Règle (ou règle à nouveau) chaque pari de la soirée dont les scores sont connus : un règlement fait sur un score
    corrigé depuis est remplacé, un pari dont la mi-temps est inconnue repasse en attente. Un pari sans score garde son
    règlement."""
    data = load()
    ev = next((e for e in data["evenings"] if e["date"] == date), None)
    if ev is None:
        print(f"Aucune soirée {date} : rien à régler.")
        return None
    _settle_evening(ev, scores)
    save(data)
    return ev


def settle_pending(today: dt.date, days: int = 7) -> list[dict]:
    """Règle à nouveau les soirées des `days` derniers jours, réglées ou non (combiné sur plusieurs soirs, résultat
    publié en retard, score corrigé depuis), avec les scores de leur date jusqu'à aujourd'hui, par identifiant de match."""
    done = []
    for ev in load()["evenings"]:
        d0 = dt.date.fromisoformat(ev["date"])
        if d0 > today or (today - d0).days > days:
            continue
        scores: dict = {}
        for k in range((today - d0).days + 1):
            scores.update(scores_from_results((d0 + dt.timedelta(days=k)).isoformat()))
        e = settle(ev["date"], scores)
        if e:
            done.append(e)
    return done


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
    au = sub.add_parser("rebuild"); au.add_argument("--profile", default="equilibre", choices=PROFILES); au.add_argument("--bankroll", type=float, default=START_BANKROLL)
    s = sub.add_parser("settle"); s.add_argument("--date"); s.add_argument("--scores", type=Path); s.add_argument("--pending", action="store_true")
    sub.add_parser("show")
    args = p.parse_args(argv)
    if args.cmd == "add":
        e = add(args.date, json.loads(args.bets.read_text(encoding="utf-8")))
        print(f"{len(e['bets'])} paris enregistrés pour {args.date}, misé {sum(b['stake'] for b in e['bets']):.2f} €")
    elif args.cmd == "rebuild":
        evs = rebuild(dt.datetime.now(dt.timezone.utc).date(), args.profile, args.bankroll)
        auto = [e for e in evs if is_auto(e)]
        print(f"{len(auto)} soirée(s) reconstruites depuis le journal (profil {args.profile}, bankroll de départ {args.bankroll:.2f} €, mises plafonnées à la bankroll courante)")
    elif args.cmd == "settle" and args.pending:
        for e in settle_pending(dt.datetime.now(dt.timezone.utc).date()):
            print(f"Soirée {e['date']} : gain net {e['profit']:+.2f} €, {e['won']} gagnés sur {len(e['bets'])}{'' if e['settled'] else ' (scores manquants)'}")
    elif args.cmd == "settle":
        if not args.date:
            p.error("settle : --date ou --pending")
        scores = json.loads(args.scores.read_text(encoding="utf-8")) if args.scores else scores_from_results(args.date)
        e = settle(args.date, scores)
        for b in (e["bets"] if e else []):
            lab = b.get("label") or " + ".join(l["label"] for l in b["combo"])
            profit = "" if b["profit"] is None else f"{b['profit']:+.2f} €"
            print(f"  {b['match']:34s} {lab:58s} {b.get('odds', '') if 'odds' in b else '':>5} mise {b['stake']:6.2f} € → {b['result'] or 'en attente':14s} {profit}")
        if e:
            print(f"Soirée {args.date} : misé {e['stake']:.2f} €, gain net {e['profit']:+.2f} €, {e['won']} gagnés sur {len(e['bets'])}{'' if e['settled'] else ' (scores manquants)'}")
    print(show())
    return 0


if __name__ == "__main__":
    sys.exit(main())
