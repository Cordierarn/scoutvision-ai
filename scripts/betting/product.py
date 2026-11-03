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
rencontres à venir, buts attendus du pipeline (forecast.json). Le navigateur ne calcule que la mise à
partir de la bankroll saisie (fractions publiées ici).
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

from . import COMPETITIONS, RESEARCH, ROOT
from . import adjust, markets as mk, simulate as sm, suggest as sg
from .catalogue import load as load_catalogue
from .phase2 import OUT as PHASE2, frozen_variant, load_results as _pitchapi_results, matches_with_predictions
from .results import half_share

JOURNAL = RESEARCH / "journal" / "suggestions.parquet"
BILAN = RESEARCH / "product" / "bilan.json"
EXPORT_DIR = ROOT / "public" / "data" / "forecast" / "suggestions"
SEASON = "2026-27"
START_BANKROLL = 300.0
UPCOMING_DAYS = 7
JOURNAL_COLUMNS = ["suggestion_id", "published_at", "match_id", "fixture_id", "competition", "kickoff_utc", "profile", "rank", "kind", "market_id", "outcome_id",
                   "family", "label", "odds", "odds_at", "p", "ev", "stake_fraction", "stake_mode", "settled", "realised", "settled_at"]


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
    web = web[~web["match_id"].isin(base["match_id"])]
    return pd.concat([base, web], ignore_index=True) if len(web) else base


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


def outcomes_from_snapshots(snaps: pd.DataFrame, cat, before: pd.Timestamp, home: str, away: str) -> list[dict]:
    """Dernier relevé strictement antérieur à `before` pour chaque issue d'un match, en dicts pour `suggest`."""
    s = snaps[snaps["created_at"] < before].sort_values("created_at")
    if s.empty:
        return []
    last = s.groupby(["market_id", "outcome_id", "player_id"], dropna=False).last().reset_index()
    out = []
    for r in last.itertuples(index=False):
        market = cat.get(int(r.market_id))
        if market is None or market.player_prop or pd.notna(r.player_id):
            continue
        spec = market.spec(int(r.outcome_id))
        if spec is None:
            continue
        out.append({"market_id": int(r.market_id), "outcome_id": int(r.outcome_id), "spec": spec, "odds": float(r.price), "odds_at": r.created_at.to_pydatetime(),
                    "home": home, "away": away})
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


# ----- suggestion d'un match -----

def suggest_match(sims: sm.Simulated, outcomes: list[dict], kickoff: dt.datetime, now: dt.datetime, competition: str, excluded: set, ctx: dict,
                  home: str, away: str) -> dict:
    cands = sg.evaluate_candidates(sims, outcomes, kickoff, now, excluded, competition)
    profiles = {}
    for profile in sg.PROFILES:
        ranked = sg.rank(cands, profile)
        combo = sg.combine(ranked, profile)
        profiles[profile] = {
            "suggestions": [{"rank": s.rank, "marketId": s.candidate.market_id, "outcomeId": s.candidate.outcome_id, "family": s.candidate.family,
                             "label": s.candidate.label, "odds": round(s.candidate.odds, 2), "oddsAt": s.candidate.odds_at.isoformat(), "p": round(s.candidate.p, 4),
                             "ev": round(s.candidate.ev, 4), "stakeFraction": s.stake_fraction, "stakeMode": s.stake_mode, "reasons": reasons(s.candidate, ctx, home, away)}
                            for s in ranked],
            "combo": None if combo is None else {"labels": [c.label for c in combo.candidates], "marketIds": [c.market_id for c in combo.candidates],
                                                 "outcomeIds": [c.outcome_id for c in combo.candidates], "jointP": round(combo.joint_p, 4), "odds": round(combo.odds, 2),
                                                 "ev": round(combo.ev, 4), "stakeFraction": combo.stake_fraction, "stakeMode": combo.stake_mode},
        }
    excluded_counts = {}
    for c in cands:
        if c.excluded:
            excluded_counts[c.excluded] = excluded_counts.get(c.excluded, 0) + 1
    return {"profiles": profiles, "evaluated": len(cands), "excluded": excluded_counts}


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
        res = suggest_match(sims, outcomes, kick.to_pydatetime(), kick.to_pydatetime(), m.competition, excluded, ctx, m.home_team_name, m.away_team_name)
        result = mk.Result(int(m.ft_home), int(m.ft_away), int(m.ht_home), int(m.ht_away), m.first_goal, m.last_goal)
        for profile, block in res["profiles"].items():
            for sgg in block["suggestions"]:
                spec = cat[sgg["marketId"]].spec(sgg["outcomeId"])
                settled = mk.settle(spec, result)
                rows.append({"match_id": m.match_id, "competition": m.competition, "kickoff_utc": kick, "profile": profile, "kind": "simple", "rank": sgg["rank"],
                             "family": sgg["family"], "odds": sgg["odds"], "p": sgg["p"], "ev": sgg["ev"], "stake_fraction": sgg["stakeFraction"], "stake_mode": sgg["stakeMode"],
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
    return out


def summarise(tab: pd.DataFrame) -> dict:
    out = {"start": START_BANKROLL, "profiles": {}}
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
        entry.update({"status": "ok", "kickoff": kickoff.isoformat(), "oddsAt": latest.isoformat(), "oddsStale": (pd.Timestamp(now) - pd.Timestamp(latest)) > sg.MAX_AGE})
        hid, aid = teams.get(m["home"]), teams.get(m["away"])
        feats = adjust.features_as_of(results, hid, aid, m["competition"], pd.Timestamp(now), adj.half_life) if hid and aid else None
        xh, xa = adjust.adjusted_xg({"expected_goals_home": m["xgHome"], "expected_goals_away": m["xgAway"]}, feats, adj)
        sims = sm.simulate(xh, xa, comp_half.get(m["competition"], 0.45), variant)
        ctx = {"home": team_context(results, hid, "home", pd.Timestamp(now)) if hid else None, "away": team_context(results, aid, "away", pd.Timestamp(now)) if aid else None,
               "h2h": h2h_context(results, hid, aid, pd.Timestamp(now)) if hid and aid else None, "xg": (xh, xa)}
        res = suggest_match(sims, outcomes, kickoff, now, m["competition"], excluded, ctx, m["home"], m["away"])
        entry.update(res)
        entry["xg"] = [round(xh, 2), round(xa, 2)]
        out.append(entry)
    return out


def journal_append(entries: list[dict], published_at: dt.datetime, results: pd.DataFrame, cat) -> pd.DataFrame:
    """Ajoute au journal les suggestions publiées (jamais réécrites : clé = match, profil, issue, horodatage du
    relevé) et règle celles dont le match est terminé."""
    existing = pd.read_parquet(JOURNAL) if JOURNAL.exists() else pd.DataFrame(columns=JOURNAL_COLUMNS)
    rows = []
    for e in entries:
        if e.get("status") != "ok":
            continue
        for profile, block in e["profiles"].items():
            for s in block["suggestions"]:
                sid = hashlib.sha1(f"{e['matchId']}|{profile}|{s['marketId']}|{s['outcomeId']}|{s['oddsAt']}".encode()).hexdigest()[:16]
                rows.append({"suggestion_id": sid, "published_at": published_at.isoformat(), "match_id": e["matchId"], "fixture_id": None, "competition": e["competition"],
                             "kickoff_utc": e["kickoff"], "profile": profile, "rank": s["rank"], "kind": "simple", "market_id": s["marketId"], "outcome_id": s["outcomeId"],
                             "family": s["family"], "label": s["label"], "odds": s["odds"], "odds_at": s["oddsAt"], "p": s["p"], "ev": s["ev"],
                             "stake_fraction": s["stakeFraction"], "stake_mode": s["stakeMode"], "settled": None, "realised": None, "settled_at": None})
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
    JOURNAL.parent.mkdir(parents=True, exist_ok=True)
    journal.to_parquet(JOURNAL, index=False)
    return journal


def export(entries: list[dict], generated_at: dt.datetime) -> Path:
    bilan = json.loads(BILAN.read_text(encoding="utf-8")) if BILAN.exists() else None
    journal = pd.read_parquet(JOURNAL) if JOURNAL.exists() else pd.DataFrame(columns=JOURNAL_COLUMNS)
    settled = journal[journal["settled"].notna()]
    js = {"published": int(len(journal)), "settled": int(len(settled)),
          "byProfile": {p: {"bets": int(len(g)), "hitRate": round(float((g["settled"] > 0).mean()), 4) if len(g) else None, "returnFlat": round(float(g["realised"].mean()), 4) if len(g) else None}
                        for p, g in settled.groupby("profile")}}
    payload = {"schemaVersion": "1.0.0", "generatedAt": generated_at.isoformat(timespec="seconds"), "season": SEASON, "bookmaker": "Winamax FR (OddsPapi)",
               "profiles": [{"id": p, "label": sg.PROFILE_LABELS[p]} for p in sg.PROFILES], "defaultProfile": "equilibre", "defaultBankroll": START_BANKROLL,
               "rules": {"minOdds": sg.MIN_ODDS, "bigOdds": sg.BIG_ODDS, "maxAgeHours": 2, "kellyFraction": sg.KELLY_FRACTION, "capPerBet": sg.CAP_PER_BET,
                         "capPerMatch": sg.CAP_PER_MATCH, "fixedStake": sg.FIXED_STAKE},
               "matches": entries, "bilan": bilan, "journal": js}
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
        journal_append(entries, now, load_results(), load_catalogue())
        ok = [e for e in entries if e.get("status") == "ok"]
        print(f"{len(entries)} rencontres à venir, {len(ok)} avec cotes et suggestions")
        if args.cmd in ("export", "all"):
            p = export(entries, now)
            print(f"{p} ({p.stat().st_size // 1024} Ko)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
