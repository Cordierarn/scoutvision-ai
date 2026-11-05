"""
Produit Labo paris : suggestions de paris pour l'onglet « Matchs à venir », rejeu de la saison en cours,
journal immuable des suggestions publiées et export de l'artefact privé lu par le frontend.

  cd scripts
  python3 -m betting.product replay        rejeu 2026-27 (cotes du dernier relevé avant coup d'envoi, données
                                           antérieures au match seulement) → bilan par profil, famille, compétition
  python3 -m betting.product suggest       suggestions des rencontres à venir (archive des cotes, âge ≤ 2 h),
                                           journal, règlement des suggestions passées
  python3 -m betting.product export        public/data/forecast/suggestions/index.json
  python3 -m betting.product all

Probabilités : simulation de phase 2 (variante figée) sur les buts attendus ajustés (`adjust.py`) ; pour les
rencontres à venir, buts attendus du pipeline (forecast.json). Référence : probabilités de Shin du marché
sharp (Pinnacle, sinon Betfair Exchange, `sharp.py`), coupe-circuit et Kelly rétréci (`circuit.py`) ; les
combinés sont désactivés (corrélation intra-match non mesurable face au marché). CLV de chaque pari publié :
cote prise × probabilité juste de clôture − 1. Le navigateur ne calcule que la mise à partir de la bankroll
saisie (fractions publiées ici).
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

from . import BOOKMAKER, COMPETITIONS, RESEARCH, ROOT
from . import adjust, circuit, dependency, markets as mk, opd, sharp, simulate as sm, suggest as sg
from .catalogue import load as load_catalogue
from .phase2 import OUT as PHASE2, frozen_variant, load_results as _pitchapi_results, matches_with_predictions
from .results import half_share

JOURNAL = RESEARCH / "journal" / "suggestions.parquet"
BILAN = RESEARCH / "product" / "bilan.json"
EXPORT_DIR = ROOT / "public" / "data" / "forecast" / "suggestions"
SEASON = "2026-27"
START_BANKROLL = 300.0
UPCOMING_DAYS = 7
QUANT_COLUMNS = ["p_sharp", "p_ref", "ev_ref", "pool_w", "sharp_bookmaker", "closing_p_sharp", "clv"]
JOURNAL_COLUMNS = ["suggestion_id", "published_at", "match_id", "fixture_id", "competition", "kickoff_utc", "profile", "rank", "kind", "market_id", "outcome_id",
                   "family", "label", "odds", "odds_at", "p", "ev", "stake_fraction", "stake_mode", "settled", "realised", "settled_at"] + QUANT_COLUMNS


# ----- données communes -----

def load_results() -> pd.DataFrame:
    """Résultats PitchAPI, complétés par les résultats web (ESPN) des rencontres pas encore exportées par le
    pipeline : le règlement du journal n'attend pas l'export du lundi ou du vendredi."""
    base = _pitchapi_results()
    web_path = RESEARCH / "results_web.parquet"
    if not web_path.exists():
        return base
    from .results_web import as_results
    web = as_results(pd.read_parquet(web_path))
    web = web[~web["match_id"].isin(base["match_id"])].copy()
    if web.empty:
        return base
    # identifiants d'équipe PitchAPI retrouvés par le nom (sinon le nom lui-même, jamais une valeur nulle)
    ids = {**dict(zip(base["away_team_name"], base["away_team_id"])), **dict(zip(base["home_team_name"], base["home_team_id"]))}
    web["home_team_id"] = [ids.get(n, n) for n in web["home_team_name"]]
    web["away_team_id"] = [ids.get(n, n) for n in web["away_team_name"]]
    return pd.concat([base, web], ignore_index=True)


def excluded_families() -> set[tuple[str, str]]:
    p = PHASE2 / "calibration.json"
    if not p.exists():
        return set()
    cal = json.loads(p.read_text(encoding="utf-8"))
    return {tuple(k.split("|")) for k, v in cal["byFamilyCompetition"].items() if not v["usable"]}


def competition_half(results: pd.DataFrame, season: str) -> dict[str, float]:
    hs = half_share(results)
    out = {}
    for comp, g in hs.groupby("competition"):
        prior = g[g["season"] < season]
        out[comp] = float(prior["first"].sum() / prior["total"].sum()) if prior["total"].sum() > 0 else 0.45
    return out


WITHDRAWN_TOLERANCE = pd.Timedelta(minutes=5)     # un passage de relevé dure quelques secondes par rencontre


def outcomes_from_snapshots(snaps: pd.DataFrame, cat, before: pd.Timestamp, home: str, away: str) -> list[dict]:
    """Dernier relevé Winamax strictement antérieur à `before` pour chaque issue d'un match, en dicts pour
    `suggest` (les bookmakers de référence restent dans `snaps` pour le coupe-circuit)."""
    s = snaps[(snaps["created_at"] < before) & (snaps["bookmaker"] == BOOKMAKER)].sort_values("created_at")
    if s.empty:
        return []
    last = s.groupby(["market_id", "outcome_id", "player_id"], dropna=False).last().reset_index()
    latest_pull = s["created_at"].max()                 # une issue absente du dernier passage n'est plus proposée par Winamax
    out = []
    for r in last.itertuples(index=False):
        market = cat.get(int(r.market_id))
        if market is None or market.player_prop or pd.notna(r.player_id):
            continue
        spec = market.spec(int(r.outcome_id))
        if spec is None:
            continue
        out.append({"market_id": int(r.market_id), "outcome_id": int(r.outcome_id), "spec": spec, "odds": float(r.price), "odds_at": r.created_at.to_pydatetime(),
                    "home": home, "away": away, "withdrawn": bool(r.created_at < latest_pull - WITHDRAWN_TOLERANCE)})
    return out


# ----- contexte et raisons -----

def team_context(results: pd.DataFrame, team_id: str, venue: str, before: pd.Timestamp, n: int = 5) -> dict | None:
    r = results[(results["kickoff_utc"] < before)]
    if venue == "home":
        g = r[r["home_team_id"] == team_id].sort_values("kickoff_utc").tail(n)
        gf, ga = g["ft_home"], g["ft_away"]; h1 = g["ht_home"]
    else:
        g = r[r["away_team_id"] == team_id].sort_values("kickoff_utc").tail(n)
        gf, ga = g["ft_away"], g["ft_home"]; h1 = g["ht_away"]
    if len(g) < 3:
        return None
    w = int((gf > ga).sum()); d = int((gf == ga).sum()); l = int((gf < ga).sum())
    return {"n": len(g), "w": w, "d": d, "l": l, "gf": float(gf.mean()), "ga": float(ga.mean()), "firstHalfShare": float(h1.sum() / gf.sum()) if gf.sum() > 0 else None}


def h2h_context(results: pd.DataFrame, home_id: str, away_id: str, before: pd.Timestamp, years: int = 5) -> dict | None:
    r = results[(results["kickoff_utc"] < before) & (results["kickoff_utc"] >= before - pd.Timedelta(days=365 * years))]
    g = r[((r["home_team_id"] == home_id) & (r["away_team_id"] == away_id)) | ((r["home_team_id"] == away_id) & (r["away_team_id"] == home_id))]
    if g.empty:
        return None
    hw = int(((g["home_team_id"] == home_id) & (g["ft_home"] > g["ft_away"])).sum() + ((g["away_team_id"] == home_id) & (g["ft_away"] > g["ft_home"])).sum())
    d = int((g["ft_home"] == g["ft_away"]).sum())
    return {"n": len(g), "homeWins": hw, "draws": d, "awayWins": len(g) - hw - d, "goals": float((g["ft_home"] + g["ft_away"]).mean()),
            "btts": float(((g["ft_home"] > 0) & (g["ft_away"] > 0)).mean())}


def _fmt(x: float) -> str:
    return f"{x:.1f}".replace(".", ",")


def reasons(c: sg.Candidate, ctx: dict, home: str, away: str) -> list[str]:
    """Deux ou trois raisons tirées des données, choisies selon la nature de la sélection."""
    hc, ac, hh = ctx.get("home"), ctx.get("away"), ctx.get("h2h")
    xg = ctx.get("xg")
    side = c.group.split("|")[0]
    out = []
    if hc:
        out.append(f"{home} à domicile : {hc['w']} V {hc['d']} N {hc['l']} D sur {hc['n']}, {_fmt(hc['gf'])} marqué / {_fmt(hc['ga'])} encaissé par match")
    if ac:
        out.append(f"{away} à l'extérieur : {ac['w']} V {ac['d']} N {ac['l']} D sur {ac['n']}, {_fmt(ac['gf'])} marqué / {_fmt(ac['ga'])} encaissé par match")
    if xg:
        out.append(f"Buts attendus du modèle : {_fmt(xg[0])} – {_fmt(xg[1])}" + (f", xG récents {_fmt(ctx['xgRecent'][0])} / {_fmt(ctx['xgRecent'][1])}" if ctx.get("xgRecent") else ""))
    if side in ("over", "under", "btts", "nobtts", "team1-over", "team2-over", "team1-under", "team2-under", "exact-total") and hh:
        out.append(f"Confrontations directes ({hh['n']}) : {_fmt(hh['goals'])} buts par match, les deux marquent {hh['btts'] * 100:.0f} %")
    elif hh and side in ("home", "away", "draw", "nodraw", "nothome", "notaway"):
        out.append(f"Confrontations directes ({hh['n']}) : {hh['homeWins']} V {hh['draws']} N {hh['awayWins']} D pour {home}")
    if c.spec.period == "p1" and hc and hc.get("firstHalfShare") is not None and ac and ac.get("firstHalfShare") is not None:
        out.append(f"Buts de 1re mi-temps : {hc['firstHalfShare'] * 100:.0f} % ({home}), {ac['firstHalfShare'] * 100:.0f} % ({away})")
    # ordre : la raison la plus liée au pari d'abord
    if side in ("over", "under", "btts", "nobtts", "exact-total") and len(out) > 2 and xg:
        out = [out[2]] + [o for o in out if o != out[2]]
    return out[:3]


# ----- référence sharp, OPD, dépendance : contexte quantitatif d'un passage -----

class Quant:
    """Données du coupe-circuit chargées une fois par passage : poids du pool par segment, xG par match (OPD),
    dépendances aux joueurs clés de la saison."""

    def __init__(self, results: pd.DataFrame, season: str = None, weights: sharp.PoolWeights | None = None,
                 xg_matches: pd.DataFrame | None = None, deps: dependency.TeamDependencies | None = None):
        self.weights = weights or sharp.PoolWeights.load()
        self.xg = xg_matches if xg_matches is not None else opd.load_xg_matches(results)
        self.deps = deps or dependency.TeamDependencies.load(season or SEASON)

    def team_flags(self, home_id: str | None, away_id: str | None, before: pd.Timestamp) -> dict:
        out = {}
        for side, tid in (("home", home_id), ("away", away_id)):
            o = opd.team_opd(self.xg, tid, before) if tid else None
            d = self.deps.of(tid)
            out[side] = {"opd": o.as_dict() if o else None, "dependency": d.as_dict() if d else None,
                         "overperforming": bool(o and o.overperforming), "hub": d.player if d and d.strong else None}
        return out


def _sharp_reason(a: circuit.Assessment, odds: float) -> str:
    bk = {"pinnacle": "Pinnacle", "betfair-ex": "Betfair Exchange"}.get(a.sharp_bookmaker or "", a.sharp_bookmaker or "marché sharp")
    pooled = f", référence {a.p_ref * 100:.1f} % (pool w = {a.w:g})" if a.w > 0 else ""
    return (f"Marché sharp ({bk}, sans marge) : {a.p_sharp * 100:.1f} %{pooled} ; cote Winamax {odds:.2f} → espérance {a.ev * 100:+.1f} %").replace(".", ",")


def _assessment_fields(c: sg.Candidate) -> dict:
    a = c.assessment
    if a is None:
        return {"pSharp": None, "pRef": round(c.p, 4), "evRef": round(c.ev, 4), "poolW": None, "sharpBookmaker": None, "sharpAt": None, "warnings": [], "verdict": "non_evalue"}
    return {"pSharp": None if a.p_sharp is None else round(a.p_sharp, 4), "pRef": round(a.p_ref, 4), "evRef": None if a.ev is None else round(a.ev, 4), "poolW": a.w,
            "sharpBookmaker": a.sharp_bookmaker, "sharpAt": a.sharp_at, "warnings": list(a.warnings), "verdict": a.verdict}


# ----- suggestion d'un match -----

BOOKMAKER_NAMES = {"pinnacle": "Pinnacle", "betfair-ex": "Betfair Exchange", BOOKMAKER: "Winamax sans marge"}


def _explore_block(cands: list, snaps: pd.DataFrame | None, cat, before: pd.Timestamp, refs: dict | None, ctx: dict, home: str, away: str) -> list[dict]:
    """Profil exploratoire (suggest.EXPLORE_PROFILE) : issues que le coupe-circuit refuse faute d'espérance, classées
    par espérance face au marché sans marge (sharp si coté, sinon Winamax complet par la méthode de Shin). Vide sans
    archive (tests, diagnostics) : jamais une probabilité de marché inventée."""
    if snaps is None or cat is None or refs is None:
        return []
    winamax: dict[int, sharp.Reference | None] = {}

    def market_probability(c):
        ref = refs.get(c.market_id)
        if ref is None:
            if c.market_id not in winamax:
                winamax[c.market_id] = sharp.market_reference(snaps, cat, c.market_id, before, bookmakers=(BOOKMAKER,))
            ref = winamax[c.market_id]
        if ref is None or c.outcome_id not in ref.shin:
            return None
        return ref.shin[c.outcome_id], ref.bookmaker

    out = []
    picks = sg.explore(cands, market_probability)
    for i, (c, p_mkt, ev_mkt, ref) in enumerate(picks, start=1):
        name = BOOKMAKER_NAMES.get(ref, ref)
        why = (f"Hors coupe-circuit : marché {name} {p_mkt * 100:.1f} %, moteur {c.p * 100:.1f} %, cote {c.odds:.2f} → espérance face au marché "
               f"{ev_mkt * 100:+.1f} %").replace(".", ",")
        out.append({"rank": i, "marketId": c.market_id, "outcomeId": c.outcome_id, "family": c.family, "label": c.label, "odds": round(c.odds, 2),
                    "oddsAt": c.odds_at.isoformat(), "p": round(c.p, 4), "ev": round(c.ev, 4), "stakeFraction": sg.EXPLORE_STAKE, "stakeMode": "fixed",
                    "pSharp": round(p_mkt, 4), "pRef": round(p_mkt, 4), "evRef": round(ev_mkt, 4), "poolW": None, "sharpBookmaker": ref,
                    "sharpAt": None, "warnings": [], "verdict": "exploratoire", "reasons": [why] + reasons(c, ctx, home, away)})
    return out


def suggest_match(sims: sm.Simulated, outcomes: list[dict], kickoff: dt.datetime, now: dt.datetime, competition: str, excluded: set, ctx: dict,
                  home: str, away: str, snaps: pd.DataFrame | None = None, cat=None, quant: Quant | None = None,
                  team_ids: tuple[str | None, str | None] = (None, None)) -> dict:
    """Sélections d'un match par profil, après le coupe-circuit quand l'archive (`snaps`, tous bookmakers) et le
    catalogue sont fournis ; sinon classement sur le seul modèle (tests, diagnostics)."""
    cands = sg.evaluate_candidates(sims, outcomes, kickoff, now, excluded, competition)
    before = pd.Timestamp(min(now, kickoff))
    flags, coverage, refs = None, None, {}
    if snaps is not None and cat is not None:
        weights = quant.weights if quant else sharp.PoolWeights()

        def reference_of(mid: int):
            if mid not in refs:
                ref = sharp.market_reference(snaps, cat, mid, before)
                if ref is None:
                    # catégorie B : segment validé par la porte sur la probabilité dé-viguée de Winamax lui-même ; la
                    # référence est alors le marché Winamax complet (Shin), la cote jouée reste la cote Winamax brute
                    market = cat.get(mid)
                    fam = next((sp.family for sp in (market.spec(int(o)) for o in market.outcomes) if sp is not None), None) if market is not None else None
                    if fam and weights.reference(fam, competition) == "winamax" and weights.weight(fam, competition) > 0:
                        ref = sharp.market_reference(snaps, cat, mid, before, bookmakers=(BOOKMAKER,))
                refs[mid] = ref
            return refs[mid]

        def move_of(mid: int, oid: int, ref: sharp.Reference):
            return sharp.sharp_move(snaps, cat, mid, oid, before, ref)

        flags = quant.team_flags(team_ids[0], team_ids[1], before) if quant else {"home": {}, "away": {}}
        hours = (pd.Timestamp(kickoff) - pd.Timestamp(now)).total_seconds() / 3600.0
        sg.apply_circuit(cands, reference_of, lambda fam: weights.weight(fam, competition), move_of, margin_of=lambda fam: weights.margin(fam, competition),
                         overperforming={k: v.get("overperforming", False) for k, v in flags.items()},
                         dependency={k: v.get("hub") for k, v in flags.items()}, hours_to_kickoff=hours)
        markets = {c.market_id for c in cands}
        coverage = round(sum(1 for m in markets if reference_of(m) is not None) / len(markets), 3) if markets else None
    profiles = {}
    for profile in sg.PROFILES:
        ranked = sg.rank(cands, profile)
        profiles[profile] = {
            "suggestions": [{"rank": s.rank, "marketId": s.candidate.market_id, "outcomeId": s.candidate.outcome_id, "family": s.candidate.family,
                             "label": s.candidate.label, "odds": round(s.candidate.odds, 2), "oddsAt": s.candidate.odds_at.isoformat(), "p": round(s.candidate.p, 4),
                             "ev": round(s.candidate.ev, 4), "stakeFraction": s.stake_fraction, "stakeMode": s.stake_mode, **_assessment_fields(s.candidate),
                             "reasons": ([_sharp_reason(s.candidate.assessment, s.candidate.odds)] if s.candidate.assessment else []) + reasons(s.candidate, ctx, home, away)}
                            for s in ranked],
            "combo": None,   # combinés désactivés : la corrélation entre sélections d'un même match n'est pas mesurable face au marché sharp
        }
    # pas de combiné d'un même match : ses sélections sont liées et Winamax ne paie pas le produit des cotes (MyMatch) ;
    # les combinés exploratoires se font entre matchs différents (explore_day_combos, à l'export)
    profiles[sg.EXPLORE_PROFILE] = {"suggestions": _explore_block(cands, snaps, cat, before, refs if snaps is not None and cat is not None else None, ctx, home, away),
                                    "combo": None}
    excluded_counts: dict[str, int] = {}
    for c in cands:
        if c.excluded:
            excluded_counts[c.excluded] = excluded_counts.get(c.excluded, 0) + 1
    # meilleure sélection du modèle refusée par le coupe-circuit : ce que l'on aurait joué avant, et pourquoi on ne le joue plus
    refused = [c for c in cands if c.assessment is not None and c.assessment.blocks]
    best = max(refused, key=lambda c: c.p * (1.0 + c.ev), default=None)
    no_bet = None
    if best is not None:
        a = best.assessment
        no_bet = {"label": best.label, "family": best.family, "odds": round(best.odds, 2), "p": round(best.p, 4), "pSharp": None if a.p_sharp is None else round(a.p_sharp, 4),
                  "evRef": None if a.ev is None else round(a.ev, 4), "reasons": [circuit.BLOCK_LABELS.get(b, b) for b in a.blocks], "codes": list(a.blocks)}
    out = {"profiles": profiles, "evaluated": len(cands), "excluded": excluded_counts, "noBet": no_bet, "sharpCoverage": coverage}
    if flags is not None:
        out["teams"] = flags
    return out


# ----- rejeu de la saison -----

def replay(season: str = SEASON) -> dict:
    """Rejeu sans fuite : prévisions figées (fitted_at ≤ coup d'envoi), features point-in-time, dernier relevé
    avant le coup d'envoi ; bankroll de 300 € par profil, mises de la bankroll courante."""
    df = matches_with_predictions([season])
    results = load_results()
    variant = frozen_variant(); adj = adjust.load(); cat = load_catalogue(); excluded = excluded_families()
    feats = adjust.compute_features(results, adj.half_life).set_index("match_id")
    comp_half = competition_half(results, season)
    matched = pd.read_parquet(RESEARCH / "matches.parquet")
    fixtures = pd.read_parquet(RESEARCH / "fixtures.parquet").set_index("fixture_id")
    snaps = pd.concat([pd.read_parquet(p) for c in COMPETITIONS for p in sorted((RESEARCH / "odds" / c).glob("*.parquet"))], ignore_index=True)
    df = df.merge(matched, on="match_id").sort_values("kickoff_utc")
    quant = Quant(results, season)
    rows = []
    for m in df.itertuples(index=False):
        kick = pd.Timestamp(m.kickoff_utc)
        s = snaps[snaps["fixture_id"] == m.fixture_id]
        outcomes = outcomes_from_snapshots(s, cat, kick, m.home_team_name, m.away_team_name)
        if not outcomes:
            continue
        xh, xa = adjust.adjusted_xg({"expected_goals_home": m.expected_goals_home, "expected_goals_away": m.expected_goals_away}, feats.loc[m.match_id] if m.match_id in feats.index else None, adj)
        sims = sm.simulate(xh, xa, comp_half.get(m.competition, 0.45), variant)
        ctx = {}
        res = suggest_match(sims, outcomes, kick.to_pydatetime(), kick.to_pydatetime(), m.competition, excluded, ctx, m.home_team_name, m.away_team_name,
                            snaps=s, cat=cat, quant=quant, team_ids=(m.home_team_id, m.away_team_id))
        result = mk.Result(int(m.ft_home), int(m.ft_away), int(m.ht_home), int(m.ht_away), m.first_goal, m.last_goal)
        for profile, block in res["profiles"].items():
            for sgg in block["suggestions"]:
                spec = cat[sgg["marketId"]].spec(sgg["outcomeId"])
                settled = mk.settle(spec, result)
                closing = sharp.closing_reference(s, cat, sgg["marketId"], kick)
                p_close = closing.probability(sgg["outcomeId"]) if closing else None
                rows.append({"match_id": m.match_id, "competition": m.competition, "kickoff_utc": kick, "profile": profile, "kind": "simple", "rank": sgg["rank"],
                             "family": sgg["family"], "odds": sgg["odds"], "p": sgg["p"], "ev": sgg["ev"], "stake_fraction": sgg["stakeFraction"], "stake_mode": sgg["stakeMode"],
                             "p_sharp": sgg["pSharp"], "p_ref": sgg["pRef"], "ev_ref": sgg["evRef"], "clv": None if p_close is None else sharp.clv(sgg["odds"], p_close),
                             "settled": settled, "realised": mk.realised_return(settled, sgg["odds"])})
            combo = block["combo"]
            if combo:
                sett = [mk.settle(cat[mid].spec(oid), result) for mid, oid in zip(combo["marketIds"], combo["outcomeIds"])]
                # combiné : une sélection remboursée retire sa cote ; une perdue perd tout ; demi-gains non combinés (sélections sans remboursement ici)
                if any(x in (0.0, -0.5) for x in sett):
                    realised, settled = -1.0, 0.0            # une sélection perdue : le combiné est perdu
                else:
                    eff = float(np.prod([o if x == 1.0 else 1.0 for o, x in zip(_combo_odds(combo, cat, snaps, m.fixture_id, kick), sett)]))
                    realised, settled = eff - 1.0, 1.0        # sélection remboursée : sa cote est retirée du combiné
                rows.append({"match_id": m.match_id, "competition": m.competition, "kickoff_utc": kick, "profile": profile, "kind": "combine", "rank": 0,
                             "family": "combiné", "odds": combo["odds"], "p": combo["jointP"], "ev": combo["ev"], "stake_fraction": combo["stakeFraction"],
                             "stake_mode": combo["stakeMode"], "settled": settled, "realised": realised})
    tab = pd.DataFrame(rows)
    (RESEARCH / "product").mkdir(parents=True, exist_ok=True)
    tab.to_parquet(RESEARCH / "product" / "replay_rows.parquet", index=False)
    bilan = summarise(tab)
    BILAN.write_text(json.dumps(bilan, ensure_ascii=False, indent=1), encoding="utf-8")
    return bilan


def _combo_odds(combo: dict, cat, snaps: pd.DataFrame, fixture_id: str, kick: pd.Timestamp) -> list[float]:
    s = snaps[(snaps["fixture_id"] == fixture_id) & (snaps["created_at"] < kick)].sort_values("created_at")
    out = []
    for mid, oid in zip(combo["marketIds"], combo["outcomeIds"]):
        g = s[(s["market_id"] == mid) & (s["outcome_id"] == oid)]
        out.append(float(g["price"].iloc[-1]) if len(g) else 1.0)
    return out


def bankroll_curve(bets: pd.DataFrame, start: float = START_BANKROLL) -> tuple[list[dict], float, float]:
    """Évolution de la bankroll : les paris d'un même match sont misés ensemble sur la bankroll courante,
    arrondis au centime ; renvoie la courbe (par match), la bankroll finale et le pire creux."""
    bank, peak, drawdown, curve = start, start, 0.0, []
    for kick, g in bets.sort_values("kickoff_utc").groupby("kickoff_utc", sort=True):
        stakes = [round(bank * f, 2) for f in g["stake_fraction"]]
        total = sum(stakes)
        if total > bank:
            stakes = [round(s * bank / total, 2) for s in stakes]
        for stake, realised in zip(stakes, g["realised"]):
            bank = round(bank + stake * realised, 2)
        peak = max(peak, bank); drawdown = max(drawdown, (peak - bank) / peak if peak > 0 else 0.0)
        curve.append({"date": str(kick.date()), "bankroll": bank})
        if bank <= 0:
            break
    return curve, bank, drawdown


def _block(g: pd.DataFrame) -> dict:
    settled = g[g["settled"].notna()]
    out = {"bets": int(len(g)), "hitRate": round(float((settled["settled"] > 0).mean()), 4) if len(settled) else None,
           "returnFlat": round(float(g["realised"].mean()), 4) if len(g) else None}
    out.update(clv_block(g))
    return out


def clv_block(g: pd.DataFrame) -> dict:
    """CLV moyen et part des paris qui battent la clôture juste, sur les paris où la clôture sharp est connue."""
    if "clv" not in g:
        return {"clvBets": 0, "meanClv": None, "clvBeatRate": None}
    c = pd.to_numeric(g["clv"], errors="coerce").dropna()
    return {"clvBets": int(len(c)), "meanClv": round(float(c.mean()), 4) if len(c) else None, "clvBeatRate": round(float((c > 0).mean()), 4) if len(c) else None}


def summarise(tab: pd.DataFrame) -> dict:
    out = {"start": START_BANKROLL, "profiles": {}}
    if tab.empty:
        tab = pd.DataFrame(columns=["match_id", "competition", "kickoff_utc", "profile", "kind", "rank", "family", "odds", "p", "ev", "stake_fraction", "stake_mode",
                                    "p_sharp", "p_ref", "ev_ref", "clv", "settled", "realised"])
    for profile in sg.PROFILES:
        g = tab[tab["profile"] == profile]
        simple = g[g["kind"] == "simple"]
        curve, final, dd = bankroll_curve(simple)
        out["profiles"][profile] = {"overall": {**_block(simple), "finalBankroll": final, "maxDrawdown": round(dd, 4), "curve": curve[-120:]},
                                    "combos": _block(g[g["kind"] == "combine"]),
                                    "byFamily": {f: _block(gg) for f, gg in simple.groupby("family")},
                                    "byCompetition": {c: _block(gg) for c, gg in simple.groupby("competition")}}
    return out


# ----- rencontres à venir, journal, export -----

def upcoming_suggestions(now: dt.datetime | None = None, days: int = UPCOMING_DAYS) -> list[dict]:
    now = now or dt.datetime.now(dt.timezone.utc)
    variant = frozen_variant(); adj = adjust.load(); cat = load_catalogue(); excluded = excluded_families()
    results = load_results()
    comp_half = competition_half(results, SEASON)
    forecast = json.loads((ROOT / "public" / "data" / "forecast.json").read_text(encoding="utf-8"))
    fc = {m["match_id"]: m for m in forecast["matches"]}
    fixtures = pd.read_parquet(RESEARCH / "fixtures.parquet")
    matched = pd.read_parquet(RESEARCH / "matches.parquet").set_index("match_id")
    snaps = pd.concat([pd.read_parquet(p) for c in COMPETITIONS for p in sorted((RESEARCH / "odds" / c).glob("*.parquet"))], ignore_index=True)
    horizon = pd.Timestamp(now) + pd.Timedelta(days=days)
    teams = results.drop_duplicates("home_team_name").set_index("home_team_name")["home_team_id"].to_dict()
    teams.update(results.drop_duplicates("away_team_name").set_index("away_team_name")["away_team_id"].to_dict())
    quant = Quant(results, SEASON)
    out = []
    for mid, m in fc.items():
        kick = pd.Timestamp(m["date"], tz="UTC")
        if m["competition"] not in COMPETITIONS or kick < pd.Timestamp(now).normalize() or kick > horizon:
            continue
        entry = {"matchId": mid, "competition": m["competition"], "date": m["date"], "home": m["home"], "away": m["away"], "status": "no_odds"}
        if mid not in matched.index:
            out.append(entry); continue
        fixture_id = matched.loc[mid, "fixture_id"]
        f = fixtures[fixtures["fixture_id"] == fixture_id].iloc[0]
        kickoff = f["start_time"].to_pydatetime()
        s = snaps[snaps["fixture_id"] == fixture_id]
        outcomes = outcomes_from_snapshots(s, cat, min(pd.Timestamp(now), pd.Timestamp(kickoff)), m["home"], m["away"])
        if not outcomes or m.get("xgHome") is None or m.get("xgAway") is None:
            out.append(entry); continue
        latest = max(o["odds_at"] for o in outcomes)
        stale = (pd.Timestamp(now) - pd.Timestamp(latest)) > sg.MAX_AGE
        entry.update({"fixtureId": str(fixture_id), "kickoff": kickoff.isoformat(), "oddsAt": latest.isoformat(), "oddsStale": bool(stale)})
        if stale:
            # cotes non rafraîchies depuis plus de MAX_AGE : rien n'est évalué (une cote périmée n'est pas une cote) ; le
            # relevé match par match de `fetch upcoming --refresh-stale` les rattrape au passage suivant
            entry["status"] = "no_odds"
            out.append(entry); continue
        entry["status"] = "ok"
        hid, aid = teams.get(m["home"]), teams.get(m["away"])
        feats = adjust.features_as_of(results, hid, aid, m["competition"], pd.Timestamp(now), adj.half_life) if hid and aid else None
        xh, xa = adjust.adjusted_xg({"expected_goals_home": m["xgHome"], "expected_goals_away": m["xgAway"]}, feats, adj)
        sims = sm.simulate(xh, xa, comp_half.get(m["competition"], 0.45), variant)
        ctx = {"home": team_context(results, hid, "home", pd.Timestamp(now)) if hid else None, "away": team_context(results, aid, "away", pd.Timestamp(now)) if aid else None,
               "h2h": h2h_context(results, hid, aid, pd.Timestamp(now)) if hid and aid else None, "xg": (xh, xa)}
        res = suggest_match(sims, outcomes, kickoff, now, m["competition"], excluded, ctx, m["home"], m["away"], snaps=s, cat=cat, quant=quant, team_ids=(hid, aid))
        entry.update(res)
        entry["xg"] = [round(xh, 2), round(xa, 2)]
        out.append(entry)
    return out


def journal_append(entries: list[dict], published_at: dt.datetime, results: pd.DataFrame, cat, snaps: pd.DataFrame | None = None) -> pd.DataFrame:
    """Ajoute au journal les suggestions publiées (jamais réécrites : clé = match, profil, issue, horodatage du
    relevé), règle celles dont le match est terminé et, quand l'archive (`snaps`) porte la clôture sharp du
    marché, calcule le CLV de chaque suggestion dont le coup d'envoi est passé."""
    existing = pd.read_parquet(JOURNAL) if JOURNAL.exists() else pd.DataFrame(columns=JOURNAL_COLUMNS)
    for col in JOURNAL_COLUMNS:            # journal antérieur à l'étape 1 : colonnes quantitatives absentes
        if col not in existing.columns:
            existing[col] = None
    existing = existing[JOURNAL_COLUMNS]
    rows = []
    for e in entries:
        if e.get("status") != "ok":
            continue
        for profile, block in e["profiles"].items():
            for s in block["suggestions"]:
                sid = hashlib.sha1(f"{e['matchId']}|{profile}|{s['marketId']}|{s['outcomeId']}|{s['oddsAt']}".encode()).hexdigest()[:16]
                rows.append({"suggestion_id": sid, "published_at": published_at.isoformat(), "match_id": e["matchId"], "fixture_id": e.get("fixtureId"), "competition": e["competition"],
                             "kickoff_utc": e["kickoff"], "profile": profile, "rank": s["rank"], "kind": "simple", "market_id": s["marketId"], "outcome_id": s["outcomeId"],
                             "family": s["family"], "label": s["label"], "odds": s["odds"], "odds_at": s["oddsAt"], "p": s["p"], "ev": s["ev"],
                             "stake_fraction": s["stakeFraction"], "stake_mode": s["stakeMode"], "settled": None, "realised": None, "settled_at": None,
                             "p_sharp": s.get("pSharp"), "p_ref": s.get("pRef"), "ev_ref": s.get("evRef"), "pool_w": s.get("poolW"), "sharp_bookmaker": s.get("sharpBookmaker"),
                             "closing_p_sharp": None, "clv": None})
    new = pd.DataFrame(rows, columns=JOURNAL_COLUMNS)
    new = new[~new["suggestion_id"].isin(existing["suggestion_id"])]
    journal = pd.concat([existing, new], ignore_index=True) if len(new) else existing
    # règlement des suggestions dont le match est terminé
    res = results.set_index("match_id")
    pending = journal["settled"].isna() & journal["match_id"].isin(res.index)
    for i in journal[pending].index:
        r = res.loc[journal.at[i, "match_id"]]
        spec = cat[int(journal.at[i, "market_id"])].spec(int(journal.at[i, "outcome_id"]))
        settled = mk.settle(spec, mk.Result(int(r.ft_home), int(r.ft_away), int(r.ht_home), int(r.ht_away), r.first_goal, r.last_goal))
        journal.at[i, "settled"] = -2.0 if settled is None else settled   # -2 = remboursé
        journal.at[i, "realised"] = mk.realised_return(settled, float(journal.at[i, "odds"]))
        journal.at[i, "settled_at"] = published_at.isoformat()
    # CLV : clôture sharp (dernier relevé complet avant le coup d'envoi) des suggestions dont le match a commencé
    if snaps is not None and not snaps.empty:
        kick = pd.to_datetime(journal["kickoff_utc"], utc=True, format="ISO8601")
        todo = journal["clv"].isna() & journal["fixture_id"].notna() & (kick <= pd.Timestamp(published_at))
        for i in journal[todo].index:
            s = snaps[snaps["fixture_id"] == journal.at[i, "fixture_id"]]
            closing = sharp.closing_reference(s, cat, int(journal.at[i, "market_id"]), kick[i]) if not s.empty else None
            p_close = closing.probability(int(journal.at[i, "outcome_id"])) if closing else None
            if p_close is not None:
                journal.at[i, "closing_p_sharp"] = round(p_close, 4)
                journal.at[i, "clv"] = round(sharp.clv(float(journal.at[i, "odds"]), p_close), 4)
    JOURNAL.parent.mkdir(parents=True, exist_ok=True)
    journal.to_parquet(JOURNAL, index=False)
    return journal


HISTORY_DAYS = 14
SETTLED_STATUS = {1.0: "won", 0.0: "lost", 0.5: "half_won", -0.5: "half_lost", -2.0: "void"}
EVENING_STATUS = {"gagné": "won", "perdu": "lost", "remboursé": "void", "moitié gagnée": "half_won", "moitié perdue": "half_lost"}


def match_names(results: pd.DataFrame) -> dict[str, tuple[str, str]]:
    """Équipes de chaque match (résultats, puis rencontres à venir de forecast.json)."""
    names = {m: (h, a) for m, h, a in zip(results["match_id"], results["home_team_name"], results["away_team_name"])}
    forecast = ROOT / "public" / "data" / "forecast.json"
    if forecast.exists():
        for m in json.loads(forecast.read_text(encoding="utf-8")).get("matches", []):
            names.setdefault(m["match_id"], (m["home"], m["away"]))
    return names


def history(journal: pd.DataFrame, results: pd.DataFrame, names: dict, now: dt.datetime, days: int = HISTORY_DAYS) -> list[dict]:
    """Suggestions des matchs commencés ces `days` derniers jours, par jour (UTC) puis par match : pour chaque
    profil, la dernière publication avant le coup d'envoi (celle qu'on pouvait jouer) et son règlement."""
    if journal.empty:
        return []
    j = journal[journal["kind"] == "simple"].copy()
    j["kick"] = pd.to_datetime(j["kickoff_utc"], utc=True, format="ISO8601")
    j["pub"] = pd.to_datetime(j["published_at"], utc=True, format="ISO8601")
    now = pd.Timestamp(now)
    j = j[(j["pub"] < j["kick"]) & (j["kick"] <= now) & (j["kick"] >= now - pd.Timedelta(days=days))]
    if j.empty:
        return []
    j = j[j["pub"] == j.groupby(["match_id", "profile"])["pub"].transform("max")].sort_values(["kick", "match_id", "profile", "rank"])
    scores = results.drop_duplicates("match_id").set_index("match_id")
    by_day: dict[str, list[dict]] = {}
    for mid, g in j.groupby("match_id", sort=False):
        kick = g["kick"].iloc[0]
        home, away = names.get(mid, (None, None))
        score = [int(scores.at[mid, "ft_home"]), int(scores.at[mid, "ft_away"])] if mid in scores.index else None
        profiles = {}
        for prof, gp in g.groupby("profile", sort=False):
            num = lambda v: None if v is None or (isinstance(v, float) and np.isnan(v)) or pd.isna(v) else round(float(v), 4)
            profiles[prof] = [{"label": r.label, "family": r.family, "odds": round(float(r.odds), 2), "p": round(float(r.p), 4), "ev": round(float(r.ev), 4),
                               "stakeFraction": round(float(r.stake_fraction), 5), "stakeMode": r.stake_mode,
                               "pSharp": num(getattr(r, "p_sharp", None)), "evRef": num(getattr(r, "ev_ref", None)), "clv": num(getattr(r, "clv", None)),
                               "status": "pending" if pd.isna(r.settled) else SETTLED_STATUS.get(float(r.settled), "pending"),
                               "realised": None if pd.isna(r.realised) else round(float(r.realised), 4)} for r in gp.itertuples(index=False)]
        by_day.setdefault(kick.strftime("%Y-%m-%d"), []).append({"matchId": mid, "competition": g["competition"].iloc[0], "kickoff": kick.isoformat(),
                                                                "home": home, "away": away, "score": score, "profiles": profiles})
    return [{"date": d, "matches": ms} for d, ms in sorted(by_day.items(), reverse=True)]


def evening_details(evening: dict, names: dict) -> list[dict]:
    """Paris d'une soirée suivie, lisibles : match, sélection, cote, mise, statut, gain net."""
    out = []
    for b in evening.get("bets", []):
        mid = b.get("match_id")
        match = " – ".join(names[mid]) if mid in names else b.get("match")
        if "combo" in b:
            odds = float(np.prod([float(leg["odds"]) for leg in b["combo"]]))
            label, legs = " + ".join(leg["label"] for leg in b["combo"]), len(b["combo"])
        else:
            odds, label, legs = float(b["odds"]), b["label"], 0
        out.append({"match": match, "label": label, "legs": legs, "odds": round(odds, 2), "stake": round(float(b["stake"]), 2),
                    "status": EVENING_STATUS.get(b.get("result"), "pending"), "profit": b.get("profit")})
    return out


def explore_day_combos(entries: list[dict]) -> list[dict]:
    """Combinés du jour du profil exploratoire, par date de coup d'envoi (heure de Paris) : la meilleure sélection
    exploratoire de chaque match, combinée entre matchs différents (suggest.day_combos)."""
    by_day: dict[str, list[dict]] = {}
    for e in entries:
        block = (e.get("profiles") or {}).get(sg.EXPLORE_PROFILE) or {}
        top = (block.get("suggestions") or [None])[0]
        if e.get("status") != "ok" or not top or top.get("pRef") is None or not e.get("kickoff"):
            continue
        day = pd.Timestamp(e["kickoff"]).tz_convert("Europe/Paris").strftime("%Y-%m-%d")
        by_day.setdefault(day, []).append({"matchId": e["matchId"], "match": f"{e['home']} – {e['away']}", "label": top["label"], "odds": top["odds"],
                                           "pRef": top["pRef"], "p": top["p"], "kickoff": e["kickoff"]})
    return [{"date": d, "combos": sg.day_combos(legs)} for d, legs in sorted(by_day.items()) if len(legs) >= 2]


def export(entries: list[dict], generated_at: dt.datetime) -> Path:
    bilan = json.loads(BILAN.read_text(encoding="utf-8")) if BILAN.exists() else None
    journal = pd.read_parquet(JOURNAL) if JOURNAL.exists() else pd.DataFrame(columns=JOURNAL_COLUMNS)
    for col in JOURNAL_COLUMNS:
        if col not in journal.columns:
            journal[col] = None
    settled = journal[journal["settled"].notna()]
    js = {"published": int(len(journal)), "settled": int(len(settled)),
          "byProfile": {p: {"bets": int(len(g)), "hitRate": round(float((g["settled"] > 0).mean()), 4) if len(g) else None, "returnFlat": round(float(g["realised"].mean()), 4) if len(g) else None,
                            **clv_block(journal[journal["profile"] == p])}
                        for p, g in settled.groupby("profile")}}
    results = load_results()
    names = match_names(results)
    evenings_path = RESEARCH / "product" / "evenings.json"
    evenings = []
    if evenings_path.exists():
        cumul = 0.0
        for e in json.loads(evenings_path.read_text(encoding="utf-8")).get("evenings", []):
            profit = e.get("profit")
            cumul += profit or 0.0
            evenings.append({"date": e["date"], "bets": len(e["bets"]), "won": e.get("won", 0), "stake": round(e.get("stake", sum(b["stake"] for b in e["bets"])), 2),
                             "profit": profit, "cumulative": round(cumul, 2), "settled": bool(e.get("settled")), "details": evening_details(e, names)})
    payload = {"schemaVersion": "1.1.0", "generatedAt": generated_at.isoformat(timespec="seconds"), "season": SEASON, "bookmaker": "Winamax FR (OddsPapi)",
               "profiles": [{"id": p, "label": sg.PROFILE_LABELS[p]} for p in (*sg.PROFILES, sg.EXPLORE_PROFILE)], "defaultProfile": "equilibre", "defaultBankroll": START_BANKROLL,
               "rules": {"minOdds": sg.MIN_ODDS, "bigOdds": sg.BIG_ODDS, "maxAgeHours": 2, "kappa": circuit.KAPPA, "capPerBet": circuit.CAP_PER_BET,
                         "capPerMatch": circuit.CAP_PER_MATCH, "capHighOdds": circuit.CAP_HIGH_ODDS, "highOdds": circuit.HIGH_ODDS, "evMin": circuit.EV_MIN,
                         "evMinLowMargin": circuit.EV_MIN_LOW_MARGIN, "evMax": circuit.EV_MAX, "edgeMax": circuit.EDGE_MAX, "favoriteOdds": circuit.FAVORITE_ODDS,
                         "lineupHours": circuit.LINEUP_HOURS, "combos": False,
                         "explore": {"minOdds": sg.EXPLORE_MIN_ODDS, "maxOdds": sg.EXPLORE_MAX_ODDS, "maxPerMatch": sg.EXPLORE_MAX, "stake": sg.EXPLORE_STAKE}},
               "reference": {"bookmakers": list(sharp.SHARP_BOOKMAKERS), "method": "shin", "poolWeights": sharp.PoolWeights.load().weights, "calibrationMargins": sharp.PoolWeights.load().margins,
                             "blockLabels": circuit.BLOCK_LABELS, "warningLabels": circuit.WARNING_LABELS},
               "matches": entries, "exploreCombos": explore_day_combos(entries), "bilan": bilan, "journal": js, "evenings": evenings[-30:],
               "history": history(journal, results, names, generated_at)}
    EXPORT_DIR.mkdir(parents=True, exist_ok=True)
    path = EXPORT_DIR / "index.json"
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return path


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("cmd", choices=["replay", "suggest", "export", "all"])
    args = parser.parse_args(argv)
    now = dt.datetime.now(dt.timezone.utc)
    if args.cmd in ("replay", "all"):
        b = replay()
        for p, v in b["profiles"].items():
            o = v["overall"]
            print(f"{sg.PROFILE_LABELS[p]:12s} paris {o['bets']:5d} réussite {o['hitRate']} rendement {o['returnFlat']} bankroll finale {o['finalBankroll']} creux {o['maxDrawdown']}")
    if args.cmd in ("suggest", "export", "all"):
        entries = upcoming_suggestions(now)
        snaps = pd.concat([pd.read_parquet(p) for c in COMPETITIONS for p in sorted((RESEARCH / "odds" / c).glob("*.parquet"))], ignore_index=True)
        journal_append(entries, now, load_results(), load_catalogue(), snaps)
        ok = [e for e in entries if e.get("status") == "ok"]
        print(f"{len(entries)} rencontres à venir, {len(ok)} avec cotes et suggestions")
        if args.cmd in ("export", "all"):
            p = export(entries, now)
            print(f"{p} ({p.stat().st_size // 1024} Ko)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
